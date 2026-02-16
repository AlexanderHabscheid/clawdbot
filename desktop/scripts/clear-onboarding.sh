#!/bin/bash

# Quick script to clear all onboarding data
# Usage: ./scripts/clear-onboarding.sh

echo "🧹 Clearing all onboarding data..."

# Run the Node.js script
cd "$(dirname "$0")/.."
node scripts/clear-onboarding-complete.js

echo ""
echo "💡 Tip: You can also reset onboarding from within the app:"
echo "   - Open DevTools (Cmd+Option+I)"
echo "   - Run: window.electronAPI.resetOnboarding()"
echo "   - Reload: location.reload()"
