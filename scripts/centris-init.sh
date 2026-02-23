#!/bin/sh
# Centris gateway defaults — runs on every container start via docker-entrypoint.sh.
# Writes config JSON directly to avoid booting the full CLI (saves ~30s startup).

CONFIG_DIR="$HOME/.openclaw"
CONFIG_FILE="$CONFIG_DIR/openclaw.json"

mkdir -p "$CONFIG_DIR"

# ── Log which critical env vars are present (values are never printed) ────────
echo "[centris-init] Environment check:"
check_var() {
  if [ -n "$(eval echo "\$$1")" ]; then
    echo "  $1=set"
  else
    echo "  $1=MISSING"
  fi
}
check_var OPENCLAW_GATEWAY_TOKEN
check_var GEMINI_API_KEY
check_var OPENAI_API_KEY
check_var ANTHROPIC_API_KEY
check_var OPENROUTER_API_KEY
check_var DEEPGRAM_API_KEY
check_var BRAVE_API_KEY
check_var CENTRIS_EXTENSION_TOKEN
check_var ELEVENLABS_API_KEY
check_var CLOUDFLARE_ACCOUNT_ID
check_var SUPABASE_URL
check_var SUPABASE_ANON_KEY
check_var SUPABASE_SERVICE_ROLE_KEY
check_var DATABASE_URL
check_var DISCORD_BOT_TOKEN
check_var TELEGRAM_BOT_TOKEN
echo "[centris-init] (at least one model provider key is required)"

# ── Auto-generate gateway token on cloud platforms if missing ─────────────────
# Cloud platforms (Railway/Render/Heroku) set $PORT. The entrypoint injects
# --bind lan, which requires auth. Generate a random token so the gateway can
# start without manually configuring OPENCLAW_GATEWAY_TOKEN.
if [ -n "$PORT" ] && [ -z "$OPENCLAW_GATEWAY_TOKEN" ]; then
  export OPENCLAW_GATEWAY_TOKEN="$(head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 32)"
  echo "[centris-init] Generated ephemeral OPENCLAW_GATEWAY_TOKEN for cloud platform (PORT=$PORT)"
fi

# ── Write / patch Centris config ──────────────────────────────────────────────
if [ -f "$CONFIG_FILE" ]; then
  if ! grep -q '"centris"' "$CONFIG_FILE" 2>/dev/null; then
    echo "[centris-init] Existing config found but missing centris profile, patching"
    node -e "
      const fs = require('fs');
      const f = '$CONFIG_FILE';
      const c = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (!c.tools) c.tools = {};
      if (!c.tools.profile || c.tools.profile === 'full') c.tools.profile = 'centris';
      if (!c.session) c.session = {};
      if (!c.session.dmScope || c.session.dmScope === 'main') c.session.dmScope = 'per-channel-peer';
      if (!c.models) c.models = {};
      if (!c.models.providers) c.models.providers = {};
      if (!c.models.providers.google) c.models.providers.google = {};
      if (!c.models.providers.google.baseUrl) c.models.providers.google.baseUrl = 'https://gateway.ai.cloudflare.com/v1/7cd2b493d94c63bba7fb6b1813984ce0/centris-ai-gateway/google-ai-studio/v1beta';
      if (!Array.isArray(c.models.providers.google.models)) c.models.providers.google.models = [];
      if (!c.agents) c.agents = {};
      if (!c.agents.defaults) c.agents.defaults = {};
      if (!c.agents.defaults.model) c.agents.defaults.model = {};
      const m = c.agents.defaults.model.primary || '';
      if (!m || m.includes('claude-opus')) c.agents.defaults.model.primary = 'google/gemini-2.5-flash-lite';
      if (!c.gateway) c.gateway = {};
      if (!c.gateway.http) c.gateway.http = {};
      if (!c.gateway.http.endpoints) c.gateway.http.endpoints = {};
      if (!c.gateway.http.endpoints.chatCompletions) c.gateway.http.endpoints.chatCompletions = {};
      c.gateway.http.endpoints.chatCompletions.enabled = true;
      fs.writeFileSync(f, JSON.stringify(c, null, 2));
    "
  fi
else
  cat > "$CONFIG_FILE" << 'CONF'
{
  "tools": {
    "profile": "centris"
  },
  "session": {
    "dmScope": "per-channel-peer"
  },
  "models": {
    "providers": {
      "google": {
        "baseUrl": "https://gateway.ai.cloudflare.com/v1/7cd2b493d94c63bba7fb6b1813984ce0/centris-ai-gateway/google-ai-studio/v1beta",
        "models": []
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "google/gemini-2.5-flash-lite"
      }
    }
  },
  "gateway": {
    "http": {
      "endpoints": {
        "chatCompletions": {
          "enabled": true
        }
      }
    }
  }
}
CONF
  echo "[centris-init] Created config with centris profile, Gemini default model, Cloudflare AI Gateway, and /v1/chat/completions enabled"
fi
