#!/bin/sh
# OpenClaw Docker entrypoint with init script support.
#
# Runs any executable scripts found in /openclaw-init.d/ before starting
# the main process. This allows users to mount custom initialization
# scripts (e.g., install dependencies, apply patches, start services)
# without overriding the entire entrypoint.
#
# Usage in docker-compose.yml:
#   volumes:
#     - ./my-init-scripts:/openclaw-init.d:ro

INIT_DIR="/openclaw-init.d"

if [ -d "$INIT_DIR" ] && [ "$(ls -A "$INIT_DIR" 2>/dev/null)" ]; then
  echo "[centris] Running init scripts from $INIT_DIR..."
  for script in "$INIT_DIR"/*; do
    [ -f "$script" ] || continue
    if [ -x "$script" ]; then
      echo "[centris] Running $(basename "$script")..."
      output=$("$script" 2>&1) || echo "[centris] WARNING: $(basename "$script") exited with status $?"
      [ -n "$output" ] && printf '%s\n' "$output" | sed 's/^/  /'
    else
      echo "[centris] Skipping $(basename "$script") (not executable)"
    fi
  done
  echo "[centris] Init complete."
fi

# Cloud platform auto-detection: Railway/Render/Heroku set $PORT.
# When detected, bridge to OPENCLAW_GATEWAY_PORT and inject --bind lan
# so the gateway is reachable through the platform's reverse proxy.
if [ -n "$PORT" ] && [ -z "$OPENCLAW_GATEWAY_PORT" ]; then
  export OPENCLAW_GATEWAY_PORT="$PORT"
  echo "[centris] Cloud platform detected (PORT=$PORT)"
fi

if [ -n "$PORT" ]; then
  # Rewrite CMD to include --bind lan when running on a cloud platform.
  # Only injects if the original CMD doesn't already contain --bind.
  case "$*" in
    *--bind*) ;;
    *"gateway"*)
      set -- "$@" --bind lan
      echo "[centris] Bound to LAN for cloud platform"
      ;;
  esac
fi

exec "$@"
