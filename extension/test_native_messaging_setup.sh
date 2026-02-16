#!/bin/bash
#
# Quick test script to verify Native Messaging setup for development
#

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     Native Messaging Development Setup Test                ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo

PASSED=0
FAILED=0
WARNINGS=0

# Get script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Try to find project root (look for extension directory or go up one level)
if [ -d "${SCRIPT_DIR}/native-host" ]; then
    # Running from extension directory
    PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
    EXTENSION_DIR="${SCRIPT_DIR}"
elif [ -d "${SCRIPT_DIR}/extension/native-host" ]; then
    # Running from project root
    PROJECT_ROOT="${SCRIPT_DIR}"
    EXTENSION_DIR="${SCRIPT_DIR}/extension"
else
    # Try parent directory
    PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
    EXTENSION_DIR="${PROJECT_ROOT}/extension"
fi

# Test 1: Host script exists in extension directory
echo -e "${BLUE}Test 1: Host script in extension directory${NC}"
HOST_SCRIPT="${EXTENSION_DIR}/native-host/centris_host.py"
if [ -f "${HOST_SCRIPT}" ]; then
    echo -e "${GREEN}✓ Host script exists: ${HOST_SCRIPT}${NC}"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}✗ Host script missing: ${HOST_SCRIPT}${NC}"
    echo -e "${YELLOW}  → This is needed for Electron app to install it${NC}"
    FAILED=$((FAILED + 1))
fi
echo

# Test 2: Host script is executable (if installed)
echo -e "${BLUE}Test 2: Installed host script${NC}"
if [ -f "/usr/local/bin/centris_host.py" ]; then
    if [ -x "/usr/local/bin/centris_host.py" ]; then
        echo -e "${GREEN}✓ Host script installed and executable: /usr/local/bin/centris_host.py${NC}"
        PASSED=$((PASSED + 1))
    else
        echo -e "${YELLOW}⚠ Host script installed but not executable${NC}"
        echo -e "${YELLOW}  → Run: chmod +x /usr/local/bin/centris_host.py${NC}"
        WARNINGS=$((WARNINGS + 1))
    fi
elif [ -f "$HOME/Library/Application Support/Centris/centris_host.py" ]; then
    if [ -x "$HOME/Library/Application Support/Centris/centris_host.py" ]; then
        echo -e "${GREEN}✓ Host script installed in user directory (fallback location)${NC}"
        PASSED=$((PASSED + 1))
    else
        echo -e "${YELLOW}⚠ Host script in user directory but not executable${NC}"
        WARNINGS=$((WARNINGS + 1))
    fi
else
    echo -e "${YELLOW}⚠ Host script not yet installed${NC}"
    echo -e "${YELLOW}  → Will be installed automatically when Electron app starts${NC}"
    WARNINGS=$((WARNINGS + 1))
fi
echo

# Test 3: Manifest exists
echo -e "${BLUE}Test 3: Native Messaging manifest${NC}"
MANIFEST="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.centris.host.json"
if [ -f "$MANIFEST" ]; then
    echo -e "${GREEN}✓ Manifest exists${NC}"
    
    # Check for placeholder
    if grep -q "EXTENSION_ID_PLACEHOLDER" "$MANIFEST" 2>/dev/null; then
        echo -e "${YELLOW}⚠ Manifest has placeholder extension ID${NC}"
        echo -e "${YELLOW}  → Will auto-update when extension connects${NC}"
        echo -e "${YELLOW}  → Or run: ./install_native_host.sh with your extension ID${NC}"
        WARNINGS=$((WARNINGS + 1))
    else
        echo -e "${GREEN}✓ Manifest has extension ID configured${NC}"
        PASSED=$((PASSED + 1))
    fi
    
    # Check path in manifest
    MANIFEST_PATH=$(grep -o '"path": "[^"]*"' "$MANIFEST" | cut -d'"' -f4)
    if [ -n "$MANIFEST_PATH" ]; then
        if [ -f "$MANIFEST_PATH" ]; then
            echo -e "${GREEN}✓ Manifest path is valid: $MANIFEST_PATH${NC}"
            PASSED=$((PASSED + 1))
        else
            echo -e "${RED}✗ Manifest path invalid: $MANIFEST_PATH${NC}"
            echo -e "${YELLOW}  → Path in manifest doesn't exist${NC}"
            FAILED=$((FAILED + 1))
        fi
    fi
else
    echo -e "${YELLOW}⚠ Manifest not yet installed${NC}"
    echo -e "${YELLOW}  → Will be created automatically when Electron app starts${NC}"
    WARNINGS=$((WARNINGS + 1))
fi
echo

# Test 4: Python3 available
echo -e "${BLUE}Test 4: Python3 availability${NC}"
if command -v python3 &> /dev/null; then
    PYTHON_VERSION=$(python3 --version 2>&1)
    echo -e "${GREEN}✓ Python3 available: $PYTHON_VERSION${NC}"
    PASSED=$((PASSED + 1))
    
    # Test if host script can run
    if [ -f "${HOST_SCRIPT}" ]; then
        if python3 -m py_compile "${HOST_SCRIPT}" 2>/dev/null; then
            echo -e "${GREEN}✓ Host script syntax is valid${NC}"
            PASSED=$((PASSED + 1))
        else
            echo -e "${RED}✗ Host script has syntax errors${NC}"
            FAILED=$((FAILED + 1))
        fi
    fi
else
    echo -e "${RED}✗ Python3 not found in PATH${NC}"
    echo -e "${YELLOW}  → Install Python 3.x (brew install python3 or python.org)${NC}"
    FAILED=$((FAILED + 1))
fi
echo

# Test 5: Extension directory structure
echo -e "${BLUE}Test 5: Extension files${NC}"
if [ -f "${EXTENSION_DIR}/manifest.json" ]; then
    echo -e "${GREEN}✓ Extension manifest.json exists${NC}"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}✗ Extension manifest.json missing: ${EXTENSION_DIR}/manifest.json${NC}"
    FAILED=$((FAILED + 1))
fi

if [ -f "${EXTENSION_DIR}/background.js" ]; then
    echo -e "${GREEN}✓ Extension background.js exists${NC}"
    PASSED=$((PASSED + 1))
else
    echo -e "${RED}✗ Extension background.js missing: ${EXTENSION_DIR}/background.js${NC}"
    FAILED=$((FAILED + 1))
fi
echo

# Test 6: Extension ID saved (if backend has run)
echo -e "${BLUE}Test 6: Extension ID tracking${NC}"
EXTENSION_ID_FILE="$HOME/.centris/extension_id.txt"
if [ -f "${EXTENSION_ID_FILE}" ]; then
    EXTENSION_ID=$(cat "${EXTENSION_ID_FILE}" 2>/dev/null | tr -d '\n')
    if [ -n "${EXTENSION_ID}" ] && [ "${EXTENSION_ID}" != "EXTENSION_ID_PLACEHOLDER" ]; then
        echo -e "${GREEN}✓ Extension ID saved: ${EXTENSION_ID}${NC}"
        echo -e "${BLUE}  → Desktop app will auto-update manifests with this ID${NC}"
        PASSED=$((PASSED + 1))
    else
        echo -e "${YELLOW}⚠ Extension ID file exists but has placeholder${NC}"
        WARNINGS=$((WARNINGS + 1))
    fi
else
    echo -e "${YELLOW}⚠ Extension ID not yet saved${NC}"
    echo -e "${YELLOW}  → Will be saved when extension connects to backend${NC}"
    WARNINGS=$((WARNINGS + 1))
fi
echo

# Summary
echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                      Test Summary                           ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo
echo -e "${GREEN}Passed: ${PASSED}${NC}"
if [ $WARNINGS -gt 0 ]; then
    echo -e "${YELLOW}Warnings: ${WARNINGS}${NC}"
fi
if [ $FAILED -gt 0 ]; then
    echo -e "${RED}Failed: ${FAILED}${NC}"
fi
echo

if [ $FAILED -eq 0 ]; then
    if [ $WARNINGS -eq 0 ]; then
        echo -e "${GREEN}✅ All tests passed! Native Messaging is ready.${NC}"
        echo
        echo -e "${BLUE}Next steps:${NC}"
        echo "1. Start backend: python -m backend.main"
        echo "2. Start desktop app: cd desktop && npm run dev"
        echo "3. Load extension in Chrome: chrome://extensions → Load unpacked"
        echo "4. Extension will auto-connect (Native Messaging if installed, WebSocket otherwise)"
        echo "5. Check extension console (F12) for connection status"
    else
        echo -e "${YELLOW}⚠ Some warnings - but setup should work${NC}"
        echo -e "${YELLOW}  → Electron app will handle missing pieces automatically${NC}"
        echo
        echo -e "${BLUE}Quick start:${NC}"
        echo "1. Start backend: python -m backend.main"
        echo "2. Start desktop app: cd desktop && npm run dev"
        echo "3. Load extension in Chrome → It will auto-connect!"
    fi
else
    echo -e "${RED}❌ Some tests failed - please fix issues above${NC}"
    echo
    echo -e "${YELLOW}Note: Most issues will be auto-fixed when you start the desktop app${NC}"
    exit 1
fi

