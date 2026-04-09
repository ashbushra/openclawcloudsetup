#!/usr/bin/env bash

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
RESET='\033[0m'

clear
echo -e "${RED}====================================================="
echo -e " 🔥 WARNING: OPENCLAW NUKE PROTOCOL INITIATED 🔥"
echo -e "=====================================================${RESET}"
echo -e "This will permanently destroy:"
echo -e "  - All running OpenClaw containers"
echo -e "  - Docker networks and volumes associated with the stack"
echo -e "  - The entire ./config directory (WireGuard keys, Phase state, passwords)\n"

read -p "$(echo -e ${YELLOW}Are you absolutely sure? Type 'y' to nuke: ${RESET})" -n 1 -r
echo

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "\n${RED}💣 Executing teardown...${RESET}"
    
    # Take down containers, remove orphans, and delete named volumes
    docker-compose down -v --remove-orphans
    
    # Wipe the local config folder (run as sudo if docker wrote files as root)
    if [ -d "./config" ]; then
        echo -e "${RED}🗑️  Wiping local configuration files...${RESET}"
        sudo rm -rf ./config
    fi
    
    echo -e "\n${GREEN}✅ Nuke complete. The slate is wiped clean.${RESET}\n"
else
    echo -e "\n${GREEN}😅 Nuke aborted. Your stack is safe.${RESET}\n"
fi