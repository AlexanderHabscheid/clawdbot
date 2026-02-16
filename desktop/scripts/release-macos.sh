#!/bin/bash
# Centris Desktop - macOS Release Script
# Creates signed and notarized DMG for distribution

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "═══════════════════════════════════════════════════════════════"
echo "  Centris Desktop - macOS Release Build"
echo "═══════════════════════════════════════════════════════════════"

# Check for required tools
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is required but not installed"
    exit 1
fi

# Check for signing identity (optional for unsigned builds)
SIGN_ARGS=""
if [ -z "$CSC_IDENTITY_AUTO_DISCOVERY" ] || [ "$CSC_IDENTITY_AUTO_DISCOVERY" = "false" ]; then
    echo "⚠️  Code signing disabled (CSC_IDENTITY_AUTO_DISCOVERY=false)"
    echo "   Building unsigned app for testing..."
    SIGN_ARGS="--config.mac.identity=null"
else
    echo "✅ Code signing enabled"
    # Check for notarization credentials
    if [ -n "$APPLE_ID" ] && [ -n "$APPLE_APP_SPECIFIC_PASSWORD" ]; then
        echo "✅ Notarization credentials found"
    else
        echo "⚠️  Notarization credentials not found"
        echo "   Set APPLE_ID and APPLE_APP_SPECIFIC_PASSWORD for notarization"
    fi
fi

# Clean previous builds
echo ""
echo "🧹 Cleaning previous builds..."
rm -rf dist/

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm ci

# Compile native binaries
echo ""
echo "🔧 Compiling native binaries..."
npm run compile:all

# Build renderer
echo ""
echo "🎨 Building React renderer..."
npm run build:renderer

# Build Electron app
echo ""
echo "📦 Building Electron app..."
if [ -n "$SIGN_ARGS" ]; then
    npx electron-builder --mac $SIGN_ARGS
else
    npx electron-builder --mac
fi

# Show output
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  ✅ Build Complete!"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "Output files:"
ls -la dist/*.dmg dist/*.zip 2>/dev/null || echo "  (no DMG/ZIP files found)"
echo ""
echo "To test the app:"
echo "  open dist/mac-arm64/Centris\\ AI.app"
echo ""
echo "To distribute:"
echo "  Upload dist/*.dmg to centris.ai/download"
