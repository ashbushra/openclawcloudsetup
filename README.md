# OpenClaw · Zero-Trust AI Agent 🦞

A fully containerized, cloud-agnostic architecture for self-hosting the OpenClaw AI agent. 

This stack prioritizes security by utilizing a two-phase deployment strategy. It isolates the administrative dashboard behind a strictly internal WireGuard VPN subnet, ensuring the agent control panel is completely invisible to the public internet.

## 🏗️ Architecture

The stack is orchestrated via `docker-compose` and consists of three microservices:
* **WireGuard (`openclaw-wg`)**: Handles secure, zero-trust network access. Auto-generates server and client keys on the first boot.
* **Nginx (`openclaw-nginx`)**: Acts as a reverse proxy. Initially exposes a secure one-time bootstrap portal, then automatically pivots to drop all traffic outside of the `10.0.0.0/24` VPN subnet.
* **Admin Server (`openclaw-admin`)**: A custom Node.js/Express dashboard that manages the OpenClaw child process, streams real-time logs, and tracks model routing statistics.

## 📋 Prerequisites

* A Linux host (Ubuntu/Debian recommended, though any Docker-compatible OS works).
* [Docker](https://docs.docker.com/engine/install/) and [Docker Compose](https://docs.docker.com/compose/install/) installed.
* Port `51820/udp` open on your host firewall. Port `80` and `443` open temporarily for initial setup.

## 🚀 Quick Start

**1. Clone the repository and navigate to the directory:**
```bash
git clone <your-repo-url>
cd openclawcloud