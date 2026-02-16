#!/bin/bash
# Script to switch from monolithic background.js to modular architecture
# Run this from the extension/ directory

set -e

echo "=== Centris Extension Modular Switchover ==="

# Check we're in the right directory
if [ ! -f "background.js" ] || [ ! -f "background_new.js" ]; then
    echo "Error: Must run from extension/ directory"
    exit 1
fi

# Backup the original
echo "1. Backing up original background.js..."
cp background.js background_original.js
echo "   -> Saved as background_original.js"

# Switch to new modular version
echo "2. Switching to modular background.js..."
cp background_new.js background.js
echo "   -> background.js is now the modular version"

# Verify modules exist
echo "3. Verifying modules..."
MODULES=(
    "modules/utils.js"
    "modules/config.js"
    "modules/logging.js"
    "modules/errors.js"
    "modules/native_messaging.js"
    "modules/websocket.js"
    "modules/connection_manager.js"
    "modules/element_cache.js"
    "modules/visuals.js"
    "modules/interactions.js"
    "modules/wait_strategies.js"
    "modules/dialogs.js"
    "modules/snapshot.js"
    "modules/element_finder.js"
    "modules/reading_mode.js"
)

for module in "${MODULES[@]}"; do
    if [ -f "$module" ]; then
        echo "   ✅ $module"
    else
        echo "   ❌ MISSING: $module"
    fi
done

echo ""
echo "=== Switchover Complete ==="
echo ""
echo "To test:"
echo "1. Open chrome://extensions"
echo "2. Find 'Centris AI' and click 'Reload'"
echo "3. Check the service worker console for errors"
echo ""
echo "To rollback:"
echo "  cp background_original.js background.js"
echo ""
