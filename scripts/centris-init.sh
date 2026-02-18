#!/bin/sh
# Centris gateway defaults — runs on every container start via docker-entrypoint.sh.
# Writes config JSON directly to avoid booting the full CLI (saves ~30s startup).

CONFIG_DIR="$HOME/.openclaw"
CONFIG_FILE="$CONFIG_DIR/openclaw.json"

mkdir -p "$CONFIG_DIR"

if [ -f "$CONFIG_FILE" ]; then
  # Config exists — patch in Centris defaults only if not already set
  if ! grep -q '"centris"' "$CONFIG_FILE" 2>/dev/null; then
    echo "[centris-init] Existing config found but missing centris profile, patching"
    # Use node one-liner to merge without full CLI boot
    node -e "
      const fs = require('fs');
      const f = '$CONFIG_FILE';
      const c = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (!c.tools) c.tools = {};
      if (!c.tools.profile || c.tools.profile === 'full') c.tools.profile = 'centris';
      if (!c.agents) c.agents = {};
      if (!c.agents.defaults) c.agents.defaults = {};
      if (!c.agents.defaults.model) c.agents.defaults.model = {};
      const m = c.agents.defaults.model.primary || '';
      if (!m || m.includes('claude-opus')) c.agents.defaults.model.primary = 'google/gemini-2.5-flash-lite';
      fs.writeFileSync(f, JSON.stringify(c, null, 2));
    "
  fi
else
  # Fresh container — write minimal Centris config
  cat > "$CONFIG_FILE" << 'CONF'
{
  "tools": {
    "profile": "centris"
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "google/gemini-2.5-flash-lite"
      }
    }
  }
}
CONF
  echo "[centris-init] Created config with tools.profile=centris, model=google/gemini-2.5-flash-lite"
fi
