#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# Setup Context Vectorize - Instant User Context Detection
# ═══════════════════════════════════════════════════════════════════════════════
#
# This script sets up the Context Vectorize system in Cloudflare:
#   1. Creates the Vectorize index for context signatures
#   2. Deploys the updated worker
#   3. Populates the index with pre-computed embeddings
#
# Prerequisites:
#   - wrangler CLI installed (npm install -g wrangler)
#   - Logged in to Cloudflare (wrangler login)
#   - centris-gateway worker already deployed
#
# Usage:
#   ./scripts/setup-context-vectorize.sh
#
# ═══════════════════════════════════════════════════════════════════════════════

set -e  # Exit on error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_DIR="$(dirname "$SCRIPT_DIR")/centris-gateway"

echo "═══════════════════════════════════════════════════════════════════════════"
echo "🎯 Context Vectorize Setup"
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "❌ wrangler CLI not found. Install with: npm install -g wrangler"
    exit 1
fi

# Check if logged in
if ! wrangler whoami &> /dev/null; then
    echo "❌ Not logged in to Cloudflare. Run: wrangler login"
    exit 1
fi

echo "✅ wrangler CLI ready"
echo ""

# Navigate to worker directory
cd "$WORKER_DIR"
echo "📁 Working in: $WORKER_DIR"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Step 1: Create Vectorize Index
# ═══════════════════════════════════════════════════════════════════════════════

echo "📊 Step 1: Creating Vectorize index..."
echo ""

# Check if index already exists
if wrangler vectorize list 2>/dev/null | grep -q "centris-contexts"; then
    echo "   ℹ️  Index 'centris-contexts' already exists"
else
    echo "   Creating 'centris-contexts' index (768 dimensions, cosine metric)..."
    wrangler vectorize create centris-contexts --dimensions 768 --metric cosine
    echo "   ✅ Index created"
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Step 2: Deploy Worker
# ═══════════════════════════════════════════════════════════════════════════════

echo "🚀 Step 2: Deploying worker..."
echo ""

wrangler deploy
echo ""
echo "   ✅ Worker deployed"
echo ""

# Get the worker URL
WORKER_URL=$(wrangler whoami 2>/dev/null | grep -oE 'https://[a-zA-Z0-9.-]+\.workers\.dev' | head -1)
if [ -z "$WORKER_URL" ]; then
    # Fallback: construct URL from account
    WORKER_URL="https://centris-gateway.$(wrangler whoami 2>/dev/null | grep -oE '[a-zA-Z0-9-]+\.workers\.dev' | head -1)"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# Step 3: Populate Index
# ═══════════════════════════════════════════════════════════════════════════════

echo "📥 Step 3: Populating context signatures..."
echo ""

# Wait for worker to be ready
sleep 2

# Populate the index
RESPONSE=$(curl -s -X POST "${WORKER_URL}/api/context/populate" \
    -H "Content-Type: application/json")

if echo "$RESPONSE" | grep -q '"success":true'; then
    INDEXED=$(echo "$RESPONSE" | grep -oE '"contextsIndexed":[0-9]+' | grep -oE '[0-9]+')
    echo "   ✅ Indexed ${INDEXED:-?} context signatures"
else
    echo "   ⚠️  Populate response: $RESPONSE"
    echo "   (This might be OK if already populated)"
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Step 4: Test Context Detection
# ═══════════════════════════════════════════════════════════════════════════════

echo "🧪 Step 4: Testing context detection..."
echo ""

# Test blank desktop context
TEST_RESPONSE=$(curl -s -X POST "${WORKER_URL}/api/context/detect" \
    -H "Content-Type: application/json" \
    -d '{"appName":"Finder","bundleId":"com.apple.finder","windowTitle":""}')

if echo "$TEST_RESPONSE" | grep -q '"desktop-blank"'; then
    echo "   ✅ Blank desktop context detected correctly!"
else
    echo "   ⚠️  Test response: $TEST_RESPONSE"
fi

# Test Chrome context
TEST_RESPONSE=$(curl -s -X POST "${WORKER_URL}/api/context/detect" \
    -H "Content-Type: application/json" \
    -d '{"appName":"Google Chrome","bundleId":"com.google.Chrome","url":"https://mail.google.com"}')

if echo "$TEST_RESPONSE" | grep -q '"chrome-gmail"'; then
    echo "   ✅ Gmail context detected correctly!"
else
    echo "   ⚠️  Test response: $TEST_RESPONSE"
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
# Done!
# ═══════════════════════════════════════════════════════════════════════════════

echo "═══════════════════════════════════════════════════════════════════════════"
echo "✅ Context Vectorize Setup Complete!"
echo "═══════════════════════════════════════════════════════════════════════════"
echo ""
echo "Your endpoints are ready:"
echo ""
echo "  📍 Detect Context:        POST ${WORKER_URL}/api/context/detect"
echo "  📋 List Signatures:       GET  ${WORKER_URL}/api/context/signatures"
echo "  🔄 Populate Index:        POST ${WORKER_URL}/api/context/populate"
echo ""
echo "Example usage:"
echo ""
echo "  curl -X POST ${WORKER_URL}/api/context/detect \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"appName\":\"Finder\",\"bundleId\":\"com.apple.finder\",\"windowTitle\":\"\"}'"
echo ""
echo "Next steps:"
echo "  1. Update CENTRIS_GATEWAY_URL in your .env file"
echo "  2. Restart the backend to pick up context detection"
echo "  3. Test by activating Centris from different apps!"
echo ""
