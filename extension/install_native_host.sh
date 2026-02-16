#!/bin/bash
#
# Centris Native Messaging Host Installer (macOS/Linux)
#
# This script installs the native messaging host for the Centris Chrome extension.
# It sets up the host script and manifest so Chrome can communicate with the desktop app.
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║       Centris Native Messaging Host Installer              ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_DIR="${SCRIPT_DIR}/native-host"

# Check if host files exist
if [ ! -f "${HOST_DIR}/centris_host.py" ]; then
    echo -e "${RED}Error: centris_host.py not found in ${HOST_DIR}${NC}"
    exit 1
fi

if [ ! -f "${HOST_DIR}/com.centris.host.json" ]; then
    echo -e "${RED}Error: com.centris.host.json not found in ${HOST_DIR}${NC}"
    exit 1
fi

# Detect OS
OS="unknown"
if [[ "$OSTYPE" == "darwin"* ]]; then
    OS="macos"
    CHROME_NATIVE_HOST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
    CHROMIUM_NATIVE_HOST_DIR="$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
    BRAVE_NATIVE_HOST_DIR="$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    OS="linux"
    CHROME_NATIVE_HOST_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
    CHROMIUM_NATIVE_HOST_DIR="$HOME/.config/chromium/NativeMessagingHosts"
    BRAVE_NATIVE_HOST_DIR="$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"
else
    echo -e "${RED}Error: Unsupported OS: $OSTYPE${NC}"
    echo "Please use install_native_host.bat for Windows"
    exit 1
fi

echo -e "${GREEN}Detected OS: ${OS}${NC}"
echo

# Get extension ID from user (or use placeholder)
echo -e "${YELLOW}Enter your Chrome extension ID (from chrome://extensions):${NC}"
echo -e "${BLUE}(Leave blank to use placeholder - you can update it later)${NC}"
read -r EXTENSION_ID

if [ -z "$EXTENSION_ID" ]; then
    EXTENSION_ID="EXTENSION_ID_PLACEHOLDER"
    echo -e "${YELLOW}Using placeholder. Remember to update the manifest with your actual extension ID!${NC}"
fi

# Determine installation path for host script
HOST_INSTALL_PATH="/usr/local/bin/centris_host.py"

echo
echo -e "${BLUE}Installation paths:${NC}"
echo "  Host script: ${HOST_INSTALL_PATH}"
echo "  Chrome manifest: ${CHROME_NATIVE_HOST_DIR}/com.centris.host.json"
echo

# Install host script
echo -e "${BLUE}Installing host script...${NC}"
if [ -w "/usr/local/bin" ]; then
    cp "${HOST_DIR}/centris_host.py" "${HOST_INSTALL_PATH}"
    chmod +x "${HOST_INSTALL_PATH}"
else
    echo -e "${YELLOW}Need sudo to install to /usr/local/bin${NC}"
    sudo cp "${HOST_DIR}/centris_host.py" "${HOST_INSTALL_PATH}"
    sudo chmod +x "${HOST_INSTALL_PATH}"
fi
echo -e "${GREEN}✓ Host script installed${NC}"

# Create manifest directories
echo -e "${BLUE}Creating manifest directories...${NC}"
mkdir -p "${CHROME_NATIVE_HOST_DIR}"
mkdir -p "${CHROMIUM_NATIVE_HOST_DIR}" 2>/dev/null || true
mkdir -p "${BRAVE_NATIVE_HOST_DIR}" 2>/dev/null || true
echo -e "${GREEN}✓ Directories created${NC}"

# Create manifest with correct paths
echo -e "${BLUE}Installing manifests...${NC}"

# Generate manifest content
MANIFEST_CONTENT=$(cat <<EOF
{
  "name": "com.centris.host",
  "description": "Centris AI Native Messaging Host - Enables fast communication between Chrome extension and desktop app",
  "path": "${HOST_INSTALL_PATH}",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://${EXTENSION_ID}/"
  ]
}
EOF
)

# Install for Chrome
echo "${MANIFEST_CONTENT}" > "${CHROME_NATIVE_HOST_DIR}/com.centris.host.json"
echo -e "${GREEN}✓ Chrome manifest installed${NC}"

# Install for Chromium (if directory exists)
if [ -d "$(dirname "${CHROMIUM_NATIVE_HOST_DIR}")" ]; then
    mkdir -p "${CHROMIUM_NATIVE_HOST_DIR}"
    echo "${MANIFEST_CONTENT}" > "${CHROMIUM_NATIVE_HOST_DIR}/com.centris.host.json"
    echo -e "${GREEN}✓ Chromium manifest installed${NC}"
fi

# Install for Brave (if directory exists)
if [ -d "$(dirname "${BRAVE_NATIVE_HOST_DIR}")" ]; then
    mkdir -p "${BRAVE_NATIVE_HOST_DIR}"
    echo "${MANIFEST_CONTENT}" > "${BRAVE_NATIVE_HOST_DIR}/com.centris.host.json"
    echo -e "${GREEN}✓ Brave manifest installed${NC}"
fi

# Verify installation
echo
echo -e "${BLUE}Verifying installation...${NC}"

if [ -x "${HOST_INSTALL_PATH}" ]; then
    echo -e "${GREEN}✓ Host script is executable${NC}"
else
    echo -e "${RED}✗ Host script not executable${NC}"
fi

if [ -f "${CHROME_NATIVE_HOST_DIR}/com.centris.host.json" ]; then
    echo -e "${GREEN}✓ Chrome manifest exists${NC}"
else
    echo -e "${RED}✗ Chrome manifest not found${NC}"
fi

# Test Python availability
if command -v python3 &> /dev/null; then
    echo -e "${GREEN}✓ Python3 is available${NC}"
else
    echo -e "${RED}✗ Python3 not found - install Python 3.x${NC}"
fi

echo
echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║              Installation Complete!                        ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
echo
echo -e "${BLUE}Next steps:${NC}"
echo "1. Open Chrome and go to chrome://extensions/"
echo "2. Find your Centris extension and copy its ID"
echo "3. If you used a placeholder, update the manifest:"
echo "   ${CHROME_NATIVE_HOST_DIR}/com.centris.host.json"
echo "4. Reload the extension"
echo "5. The extension will now use Native Messaging (faster!)"
echo
echo -e "${YELLOW}Note: If the extension falls back to WebSocket, check:${NC}"
echo "  - Extension ID matches the one in the manifest"
echo "  - Host script path is correct in the manifest"
echo "  - Python3 is available in PATH"
echo

