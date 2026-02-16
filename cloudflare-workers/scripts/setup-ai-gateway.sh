#!/bin/bash
# ==============================================================================
# Cloudflare AI Gateway Setup Script for Centris AI
# ==============================================================================
# This script creates and configures the AI Gateway in Cloudflare.
#
# AI Gateway provides:
# - Semantic caching for LLM requests (30-50% cost reduction)
# - Request logging and analytics  
# - Rate limiting to prevent API abuse
# - Provider failover (automatic fallback)
# - Real-time metrics dashboard
#
# Gateway URL format:
# https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_name}/{provider}/chat/completions
# ==============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo ""
echo -e "${BLUE}╔══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║       🌐 Cloudflare AI Gateway Setup for Centris AI              ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Configuration
ACCOUNT_ID="7cd2b493d94c63bba7fb6b1813984ce0"
GATEWAY_NAME="centris-ai-gateway"
GATEWAY_SLUG="centris-ai-gateway"

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo -e "${RED}❌ Wrangler CLI not found!${NC}"
    echo "   Install with: npm install -g wrangler"
    exit 1
fi

# Check if logged in
echo -e "${YELLOW}Checking Cloudflare login status...${NC}"
if ! wrangler whoami &> /dev/null; then
    echo -e "${RED}❌ Not logged in to Cloudflare!${NC}"
    echo "   Run: wrangler login"
    exit 1
fi

echo -e "${GREEN}✅ Wrangler authenticated${NC}"
echo ""

# ==============================================================================
# AI Gateway must be created via the Cloudflare Dashboard
# ==============================================================================
echo -e "${BLUE}══════════════════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}📝 AI Gateway Creation Instructions${NC}"
echo -e "${BLUE}══════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "AI Gateway must be created through the Cloudflare Dashboard:"
echo ""
echo "1. Go to: https://dash.cloudflare.com/${ACCOUNT_ID}/ai/ai-gateway"
echo "   (Or: Cloudflare Dashboard → AI → AI Gateway)"
echo ""
echo "2. Click 'Create Gateway'"
echo ""
echo "3. Configure the gateway:"
echo "   - Name: ${GATEWAY_NAME}"
echo "   - Slug: ${GATEWAY_SLUG}"
echo ""
echo "4. Enable these features:"
echo "   ✅ Caching (IMPORTANT: Enable for 30-50% cost reduction)"
echo "      - Cache TTL: 3600 seconds (1 hour)"
echo "      - Enable semantic caching"
echo "   ✅ Request Logging"
echo "   ✅ Analytics"
echo "   ⚠️  Rate Limiting: 100 requests/minute (adjust based on usage)"
echo ""
echo "5. Save the gateway"
echo ""

# Print gateway URLs
echo -e "${BLUE}══════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}🔗 Your AI Gateway Endpoints${NC}"
echo -e "${BLUE}══════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Once created, your gateway endpoints will be:"
echo ""
echo -e "${YELLOW}DeepSeek:${NC}"
echo "  https://gateway.ai.cloudflare.com/v1/${ACCOUNT_ID}/${GATEWAY_SLUG}/deepseek/chat/completions"
echo ""
echo -e "${YELLOW}OpenAI:${NC}"
echo "  https://gateway.ai.cloudflare.com/v1/${ACCOUNT_ID}/${GATEWAY_SLUG}/openai/chat/completions"
echo ""
echo -e "${YELLOW}Anthropic:${NC}"
echo "  https://gateway.ai.cloudflare.com/v1/${ACCOUNT_ID}/${GATEWAY_SLUG}/anthropic/messages"
echo ""
echo -e "${YELLOW}Google (Gemini):${NC}"
echo "  https://gateway.ai.cloudflare.com/v1/${ACCOUNT_ID}/${GATEWAY_SLUG}/google-ai-studio/v1beta/models/{model}:generateContent"
echo ""

# Create env file additions
ENV_FILE="/Users/ahabscheid/Downloads/centris-ai/.env.aigateway"
echo -e "${BLUE}══════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}📄 Creating environment configuration...${NC}"
echo -e "${BLUE}══════════════════════════════════════════════════════════════════${NC}"
echo ""

cat > "$ENV_FILE" << EOF
# ==============================================================================
# Cloudflare AI Gateway Configuration
# ==============================================================================
# Add these to your .env file to enable AI Gateway routing

# AI Gateway Settings
CLOUDFLARE_ACCOUNT_ID=${ACCOUNT_ID}
CLOUDFLARE_AI_GATEWAY_SLUG=${GATEWAY_SLUG}
CLOUDFLARE_AI_GATEWAY_URL=https://gateway.ai.cloudflare.com/v1/${ACCOUNT_ID}/${GATEWAY_SLUG}

# Enable AI Gateway routing (set to true after creating gateway)
USE_AI_GATEWAY=true

# Per-provider gateway URLs (auto-generated)
AI_GATEWAY_DEEPSEEK_URL=https://gateway.ai.cloudflare.com/v1/${ACCOUNT_ID}/${GATEWAY_SLUG}/deepseek
AI_GATEWAY_OPENAI_URL=https://gateway.ai.cloudflare.com/v1/${ACCOUNT_ID}/${GATEWAY_SLUG}/openai  
AI_GATEWAY_ANTHROPIC_URL=https://gateway.ai.cloudflare.com/v1/${ACCOUNT_ID}/${GATEWAY_SLUG}/anthropic
AI_GATEWAY_GEMINI_URL=https://gateway.ai.cloudflare.com/v1/${ACCOUNT_ID}/${GATEWAY_SLUG}/google-ai-studio

# Workers Gateway URL (your deployed Worker)
CLOUDFLARE_GATEWAY_URL=https://centris-gateway.a-7cd.workers.dev
USE_CLOUDFLARE_GATEWAY=true
CLOUDFLARE_CACHE_ENABLED=true
EOF

echo -e "${GREEN}✅ Created: ${ENV_FILE}${NC}"
echo ""
echo "Add these settings to your .env file:"
echo ""
cat "$ENV_FILE"
echo ""

# Print next steps
echo -e "${BLUE}══════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ Next Steps${NC}"
echo -e "${BLUE}══════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "1. Create the AI Gateway in Cloudflare Dashboard"
echo "   https://dash.cloudflare.com/${ACCOUNT_ID}/ai/ai-gateway"
echo ""
echo "2. Append the contents of .env.aigateway to your .env file:"
echo "   cat ${ENV_FILE} >> /Users/ahabscheid/Downloads/centris-ai/.env"
echo ""
echo "3. Redeploy the Worker with AI Gateway support:"
echo "   cd /Users/ahabscheid/Downloads/centris-ai/cloudflare-workers/centris-gateway"
echo "   wrangler deploy"
echo ""
echo "4. Test the integration:"
echo "   curl https://centris-gateway.a-7cd.workers.dev/api/chat -X POST \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"messages\":[{\"role\":\"user\",\"content\":\"Hello\"}],\"model\":\"deepseek-chat\"}'"
echo ""

echo -e "${GREEN}🎉 AI Gateway setup instructions complete!${NC}"
echo ""
