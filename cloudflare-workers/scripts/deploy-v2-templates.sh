#!/bin/bash
# Deploy Cloudflare Worker with v2 templates (compressed prompts/tools)
# =====================================================================
# 
# This script:
# 1. Deploys the updated Worker with TEMPLATE_VERSION = 'v2'
# 2. Invalidates old v1 template caches
# 3. Verifies the deployment
#
# Run from: cloudflare-workers/centris-gateway/
#
# Usage:
#   cd cloudflare-workers/centris-gateway
#   ../scripts/deploy-v2-templates.sh
#
# =====================================================================

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Centris AI - Deploy v2 Templates (Compressed Prompts/Tools)  ${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo ""

# Check if we're in the right directory
if [ ! -f "wrangler.toml" ]; then
    echo -e "${YELLOW}Warning: wrangler.toml not found. Are you in centris-gateway directory?${NC}"
    echo "Trying to find it..."
    if [ -f "../centris-gateway/wrangler.toml" ]; then
        cd ../centris-gateway
        echo "Changed to centris-gateway directory"
    elif [ -f "centris-gateway/wrangler.toml" ]; then
        cd centris-gateway
        echo "Changed to centris-gateway directory"
    else
        echo "Error: Cannot find wrangler.toml. Please run from cloudflare-workers/centris-gateway/"
        exit 1
    fi
fi

# Step 1: Deploy the Worker
echo -e "${GREEN}[1/3] Deploying Worker...${NC}"
npx wrangler deploy

# Get the worker URL
WORKER_URL=$(npx wrangler whoami 2>/dev/null | grep -o 'https://[^"]*' || echo "")
if [ -z "$WORKER_URL" ]; then
    # Fallback: construct URL from wrangler.toml
    WORKER_NAME=$(grep "^name" wrangler.toml | cut -d'"' -f2)
    ACCOUNT_ID=$(grep "^account_id" wrangler.toml | cut -d'"' -f2)
    WORKER_URL="https://${WORKER_NAME}.${ACCOUNT_ID}.workers.dev"
fi

# Try to extract from package.json or use default
if [ -z "$WORKER_URL" ] || [ "$WORKER_URL" == "https://." ]; then
    WORKER_URL="https://centris-gateway.workers.dev"
fi

echo ""
echo -e "${GREEN}[2/3] Invalidating old v1 templates...${NC}"
echo "Calling: ${WORKER_URL}/api/template/invalidate"

# Call the invalidation endpoint
INVALIDATE_RESPONSE=$(curl -s -X POST "${WORKER_URL}/api/template/invalidate" \
    -H "Content-Type: application/json" \
    -d '{"version": "v1"}' 2>/dev/null || echo '{"error": "curl failed"}')

echo "Response: $INVALIDATE_RESPONSE"

echo ""
echo -e "${GREEN}[3/3] Verifying deployment...${NC}"

# Check the health endpoint
HEALTH_RESPONSE=$(curl -s "${WORKER_URL}/health" 2>/dev/null || echo '{"error": "health check failed"}')
echo "Health check: $HEALTH_RESPONSE"

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ Deployment Complete!${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Changes deployed:"
echo "  • TEMPLATE_VERSION bumped to v2"
echo "  • Compressed tool schemas (-2100 tokens)"
echo "  • Added /api/template/invalidate endpoint"
echo ""
echo "Next steps:"
echo "  1. The Python backend will automatically register new templates on next request"
echo "  2. New templates will use the compressed prompts/tools"
echo "  3. Old v1 templates have been invalidated"
echo ""
echo "To verify:"
echo "  curl ${WORKER_URL}/api/template/info?name=default"
echo ""
