#!/bin/sh
# Centris gateway defaults — runs on every container start via docker-entrypoint.sh.
# Sets the Centris tool profile and Gemini Flash Lite model if not already configured.

set -e

CONFIG_CMD="node /app/openclaw.mjs config"

# Activate the Centris tool profile (lean prompts, domain routing, context pruning)
current_profile=$($CONFIG_CMD get tools.profile 2>/dev/null || echo "")
if [ -z "$current_profile" ] || [ "$current_profile" = "full" ]; then
  $CONFIG_CMD set tools.profile centris
  echo "[centris-init] Set tools.profile=centris"
fi

# Default model: Gemini 2.5 Flash Lite (fast + cheap for voice-first UX)
current_model=$($CONFIG_CMD get agents.defaults.model.primary 2>/dev/null || echo "")
if [ -z "$current_model" ] || echo "$current_model" | grep -q "anthropic/claude-opus"; then
  $CONFIG_CMD set agents.defaults.model.primary google/gemini-2.5-flash-lite
  echo "[centris-init] Set model=google/gemini-2.5-flash-lite"
fi
