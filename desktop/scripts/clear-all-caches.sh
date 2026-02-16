#!/bin/bash

# Script to clear ALL caches (Vite, Electron, Node modules)
# Usage: ./scripts/clear-all-caches.sh

echo "🧹 Clearing all caches..."

cd "$(dirname "$0")/.."

# 1. Clear Vite cache
echo "📦 Clearing Vite cache..."
rm -rf src/.vite
rm -rf src/dist
rm -rf node_modules/.vite
echo "✅ Vite cache cleared"

# 2. Clear Electron cache
echo "⚡ Clearing Electron cache..."
rm -rf ~/Library/Application\ Support/Centris\ AI/Cache
rm -rf ~/Library/Application\ Support/Centris\ AI/Code\ Cache
rm -rf ~/Library/Application\ Support/Centris\ AI/GPUCache
rm -rf ~/Library/Application\ Support/Centris\ AI/ShaderCache
rm -rf ~/Library/Caches/Centris\ AI
echo "✅ Electron cache cleared"

# 3. Clear build artifacts
echo "🔨 Clearing build artifacts..."
rm -rf dist
rm -rf build
echo "✅ Build artifacts cleared"

# 4. Clear npm cache (optional, uncomment if needed)
# echo "📦 Clearing npm cache..."
# npm cache clean --force
# echo "✅ npm cache cleared"

echo ""
echo "✅ All caches cleared!"
echo "🔄 Restart the dev server: npm run dev"
