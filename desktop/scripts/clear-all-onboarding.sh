#!/bin/bash

# Script to clear all onboarding data (electron-store + localStorage)

echo "🧹 Clearing all onboarding data..."

# Clear electron-store
cd "$(dirname "$0")/.."
node -e "
const Store = require('electron-store');
const store = new Store();
store.delete('hasCompletedOnboarding');
console.log('✅ Cleared onboarding from electron-store');
"

# Find and clear localStorage files
# Electron stores localStorage in: ~/Library/Application Support/Centris AI/Local Storage/
LOCAL_STORAGE_DIR="$HOME/Library/Application Support/Centris AI/Local Storage"
if [ -d "$LOCAL_STORAGE_DIR" ]; then
    echo "📁 Found localStorage directory: $LOCAL_STORAGE_DIR"
    # Remove localStorage files (they'll be recreated on next launch)
    rm -rf "$LOCAL_STORAGE_DIR"/*
    echo "✅ Cleared localStorage files"
else
    echo "ℹ️  localStorage directory not found (app may not have run yet)"
fi

# Also check for the config file
CONFIG_FILE="$HOME/Library/Application Support/Centris AI/config.json"
if [ -f "$CONFIG_FILE" ]; then
    echo "📄 Found config file, removing onboarding key..."
    # Use node to safely remove just the onboarding key
    node -e "
    const fs = require('fs');
    const path = '$CONFIG_FILE';
    try {
        const config = JSON.parse(fs.readFileSync(path, 'utf8'));
        delete config.hasCompletedOnboarding;
        fs.writeFileSync(path, JSON.stringify(config, null, 2));
        console.log('✅ Removed onboarding from config.json');
    } catch (e) {
        console.log('ℹ️  Could not modify config.json:', e.message);
    }
    "
fi

echo ""
echo "✅ All onboarding data cleared!"
echo "🔄 Restart the app to see the onboarding screen again."
