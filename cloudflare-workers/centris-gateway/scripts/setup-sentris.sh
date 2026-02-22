#!/usr/bin/env bash
# Setup sentris.io custom domain, Cloudflare Worker, and Railway config
# Run from repo root or cloudflare-workers/centris-gateway/
#
# Prerequisites:
#   - wrangler: npm install -g wrangler && wrangler login
#   - railway: brew install railway (or npm i -g @railway/cli) && railway login
#   - sentris.io zone in your Cloudflare account

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATEWAY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$GATEWAY_DIR/../.." && pwd)"

echo "=== Sentris.io + Cloudflare + Railway Setup ==="
echo ""

# ─── Step 1: Delete existing api.sentris.io DNS record (if any) ───
echo "Step 1: DNS record for api.sentris.io"
echo "  If you have an existing AAAA record (api → 100::), DELETE it in:"
echo "  Cloudflare Dashboard → sentris.io → DNS → Records"
echo "  Custom Domain will create the correct record on deploy."
echo ""
read -p "  Press Enter when ready (or if no record exists)..."

# ─── Step 2: Deploy Cloudflare Worker ───
echo ""
echo "Step 2: Deploy Cloudflare Worker"
cd "$GATEWAY_DIR"
wrangler deploy

# ─── Step 3: Set Railway URL secret (optional override) ───
echo ""
echo "Step 3: Set RAILWAY_GATEWAY_URL secret (optional)"
echo "  Default: https://centris-ai-production.up.railway.app"
read -p "  Set custom Railway URL? [y/N] " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  echo "  Enter Railway gateway URL:"
  wrangler secret put RAILWAY_GATEWAY_URL
else
  echo "  Skipped (using default)"
fi

# ─── Step 4: Railway variables ───
echo ""
echo "Step 4: Railway variables"
echo "  Run these in your Centris Railway project directory (or after railway link):"
echo ""
echo "  railway variables set GEMINI_API_KEY=\$(op read 'op://Private/Gemini/api_key' 2>/dev/null || echo 'YOUR_GEMINI_KEY')"
echo ""
echo "  # Optional: override AI Gateway baseUrl via env (centris-init.sh already sets it in config)"
echo "  # railway variables set OPENCLAW_LOAD_SHELL_ENV=1"
echo ""
read -p "  Open Railway project now to set variables? [y/N] " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  if command -v railway &>/dev/null; then
    cd "$REPO_ROOT"
    railway link 2>/dev/null || true
    railway variables
  else
    echo "  Install Railway CLI: brew install railway"
  fi
fi

# ─── Step 5: Verify ───
echo ""
echo "Step 5: Verify"
echo "  curl https://api.sentris.io/health"
echo "  curl -X POST https://api.sentris.io/v1/chat/completions -H 'Content-Type: application/json' -d '{\"model\":\"gemini\",\"messages\":[{\"role\":\"user\",\"content\":\"Hi\"}]}'"
echo ""
echo "=== Done ==="
