#!/usr/bin/env bash
set -e

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RESET='\033[0m'

clear
echo -e "${CYAN}🚀 Booting OpenClaw Docker Stack...${RESET}\n"

# Spin up the stack, building the admin-server image if necessary
docker-compose up -d --build

echo -e "\n${GREEN}✅ Containers are up! Waiting 3 seconds for initialization...${RESET}"
sleep 3

echo -e "\n${CYAN}── Container Status ──────────────────────────${RESET}"
docker-compose ps

echo -e "\n${YELLOW}── Next Steps ──────────────────────────────${RESET}"
echo -e "1. Grab your WireGuard client config:"
echo -e "   ${GREEN}cat config/wireguard/peer1/peer1.conf${RESET}"
echo -e "2. Connect your VPN client."
echo -e "3. Navigate to: ${GREEN}http://10.0.0.1/setup/$(grep -oP '(?<="setupToken": ")[^"]*' config/openclaw/state.json 2>/dev/null || echo "<token-loading-check-logs>")${RESET}"
echo -e "4. After setup, the admin portal will be at ${GREEN}http://10.0.0.1/admin${RESET}\n"

echo -e "To view live logs, run: ${CYAN}docker logs -f openclaw-admin${RESET}\n"