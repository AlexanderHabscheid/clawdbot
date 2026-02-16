#!/bin/bash
# Centris Desktop - Quick Unsigned Build for Testing
# Creates DMG without code signing for local testing

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "═══════════════════════════════════════════════════════════════"
echo "  Centris Desktop - Unsigned Build (for testing)"
echo "═══════════════════════════════════════════════════════════════"

# Disable code signing
export CSC_IDENTITY_AUTO_DISCOVERY=false

# Clean previous builds
echo "🧹 Cleaning..."
rm -rf dist/

# Build
echo "📦 Building..."
npm run build:mac:unsigned

echo ""
echo "✅ Done! Test the app:"
echo "   open dist/mac-arm64/Centris\\ AI.app"
echo ""
echo "DMG location:"
ls -la dist/*.dmg 2>/dev/null || echo "   (check dist/ folder)"
