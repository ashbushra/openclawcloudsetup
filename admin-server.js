#!/usr/bin/env node
'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const session = require('express-session');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = 3000;
const CFG = '/etc/openclaw';
const STATE_FILE = `${CFG}/state.json`;

// Ensure config dir exists
if (!fs.existsSync(CFG)) fs.mkdirSync(CFG, { recursive: true });

// ── State Management ──────────────────────────────────────────
const defaultState = { phase: 1, setupToken: crypto.randomBytes(12).toString('hex'), defaultPassword: `ChangeMe@${crypto.randomBytes(2).toString('hex')}` };
const readState = () => { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { writeState(defaultState); return defaultState; } };
const writeState = (s) => fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
const getPhase = () => readState().phase || 1;

// ── OpenClaw Process Manager ──────────────────────────────────
let clawProcess = null;
let logBuffer = [];
let routingStats = { sonnet: 0, kimi: 0, total: 0 };
let startTime = null;

const startClaw = () => {
  if (clawProcess) return false;
  clawProcess = spawn('openclaw', ['start', '--config', `${CFG}/openclaw.json`]);
  startTime = new Date();
  
  const handleLog = (data) => {
    const lines = data.toString().split('\n').filter(Boolean);
    lines.forEach(line => {
      const tsLine = `[${new Date().toISOString()}] ${line}`;
      logBuffer.push(tsLine);
      if (logBuffer.length > 200) logBuffer.shift();
      
      // Calculate routing stats on the fly
      if (line.includes('claude-sonnet')) { routingStats.sonnet++; routingStats.total++; }
      if (line.includes('kimi-k2')) { routingStats.kimi++; routingStats.total++; }
    });
  };

  clawProcess.stdout.on('data', handleLog);
  clawProcess.stderr.on('data', (data) => handleLog(`[ERROR] ${data}`));
  clawProcess.on('close', () => { clawProcess = null; startTime = null; });
  return true;
};

const stopClaw = () => {
  if (!clawProcess) return false;
  clawProcess.kill();
  clawProcess = null;
  startTime = null;
  return true;
};

// ── Middleware ────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: crypto.randomBytes(32).toString('hex'),
  resave: false, saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 8 * 60 * 60 * 1000 } // Secure false for local reverse proxy
}));

const requireAuth = (req, res, next) => (req.session && req.session.authenticated) ? next() : res.status(401).json({ error: 'Unauthorized' });

// ── Routes: Phase 1 (Bootstrap) ───────────────────────────────
app.get('/setup/:token', (req, res) => {
  if (getPhase() !== 1) return res.status(404).send('Not found');
  if (req.params.token !== readState().setupToken) return res.status(403).send('Invalid token');
  res.sendFile(path.join(__dirname, 'public', 'setup.html'));
});

app.post('/setup/:token/credentials', async (req, res) => {
  const state = readState();
  if (getPhase() !== 1 || req.params.token !== state.setupToken) return res.status(403).json({ error: 'Forbidden' });

  const { username, password, confirmPassword } = req.body;
  if (!username || password.length < 12 || password !== confirmPassword || password === state.defaultPassword) {
    return res.status(400).json({ error: 'Invalid credentials. Ensure password is 12+ chars and not the default.' });
  }

  const hash = await bcrypt.hash(password, 12);
  fs.writeFileSync(`${CFG}/.htpasswd`, `${username}:${hash}\n`);
  state.adminUser = username;
  state.credsDone = true;
  writeState(state);
  res.json({ ok: true });
});

app.post('/setup/:token/configure', async (req, res) => {
  const state = readState();
  if (getPhase() !== 1 || req.params.token !== state.setupToken) return res.status(403).json({ error: 'Forbidden' });
  if (!state.credsDone) return res.status(400).json({ error: 'Complete credentials first' });

  const { anthropicKey, kimiKey } = req.body;
  const config = {
    agents: { defaults: { models: ['anthropic/claude-sonnet-4', 'moonshot/kimi-k2.5'], routing: { default: 'moonshot/kimi-k2.5', rules: [] } } },
    models: { providers: { anthropic: { apiKey: anthropicKey }, moonshot: { baseUrl: 'https://api.moonshot.cn/v1', apiKey: kimiKey, apiType: 'openai-completions' } } }
  };

  fs.writeFileSync(`${CFG}/openclaw.json`, JSON.stringify(config, null, 2));
  
  // Pivot Phase
  state.phase = 2;
  state.setupToken = null;
  writeState(state);
  
  startClaw(); // Auto-start the agent

  // In Docker, we just tell Nginx to reload its config to enforce Phase 2
  spawn('wget', ['-qO-', 'http://nginx/reload']); 
  
  res.json({ ok: true });
});

// ── Routes: Phase 2 (Admin) ───────────────────────────────────
app.post('/admin/login', async (req, res) => {
  if (getPhase() !== 2) return res.status(404).json({ error: 'Not found' });
  const { username, password } = req.body;
  const state = readState();
  
  if (username !== state.adminUser) return res.status(401).json({ error: 'Invalid credentials' });
  const storedHash = fs.readFileSync(`${CFG}/.htpasswd`, 'utf8').split(':')[1]?.trim();
  
  if (await bcrypt.compare(password, storedHash)) {
    req.session.authenticated = true;
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

app.get('/admin/api/status', requireAuth, (req, res) => {
  res.json({
    status: clawProcess ? 'active' : 'inactive',
    uptime: startTime ? startTime.toISOString() : null,
    memoryKb: clawProcess ? process.memoryUsage().rss / 1024 : 0
  });
});

app.get('/admin/api/logs', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  
  // Send buffer
  logBuffer.forEach(line => res.write(`data: ${JSON.stringify(line)}\n\n`));
  
  // Hook real-time
  const liveLogger = (data) => {
    data.toString().split('\n').filter(Boolean).forEach(l => res.write(`data: ${JSON.stringify(l)}\n\n`));
  };
  if (clawProcess) clawProcess.stdout.on('data', liveLogger);
  
  req.on('close', () => { if (clawProcess) clawProcess.stdout.off('data', liveLogger); });
});

app.get('/admin/api/routing', requireAuth, (req, res) => {
  res.json({ sonnet: { count: routingStats.sonnet }, kimi: { count: routingStats.kimi }, total: routingStats.total || 1 });
});

app.post('/admin/api/control/:action', requireAuth, (req, res) => {
  const { action } = req.params;
  if (action === 'start') startClaw();
  if (action === 'stop') stopClaw();
  if (action === 'restart') { stopClaw(); setTimeout(startClaw, 1000); }
  res.json({ ok: true });
});

app.get('/admin/api/wireguard', requireAuth, (req, res) => {
  // Read the client config generated by the linuxserver/wireguard container
  try {
    const wgConf = fs.readFileSync('/etc/wireguard-ro/peer1/peer1.conf', 'utf8');
    res.json({ serverPublicKey: 'Auto-managed by container', peers: [{ allowedIps: '10.0.0.2', pubkey: 'See client config snippet' }], clientConfig: wgConf });
  } catch(e) {
    res.json({ peers: [] });
  }
});

app.listen(PORT, '0.0.0.0', () => console.log(`[openclaw-admin] Listening | Phase: ${getPhase()}`));