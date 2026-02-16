# Centris + Clawdbot Merge Plan

**Status: MERGE COMPLETE**

All phases have been executed. The Python backend has been removed. Centris features (voice, Deepgram, dictation, security) are now running in TypeScript through the clawdbot gateway.

---

## What Was Done

### Phase 1: Security Hardening (COMPLETE)

1. **`src/security/hidden-text.ts`** — Ported from Centris `backend/security/hidden_text.py`. Detects and removes zero-width characters, bidi overrides, Unicode tag characters, and excessive combining marks (zalgo). Integrated into `src/security/external-content.ts` so all external content is cleaned before reaching the LLM.

2. **`src/security/destructive-guard.ts`** — Ported from Centris `backend/security/destructive_operation_guard.py`. Classifies operations as safe/cautious/destructive/critical/forbidden and blocks dangerous commands (e.g., `rm -rf /`, disk formatting) and operations on protected system paths. Integrated at **two** enforcement points:
   - `src/gateway/tools-invoke-http.ts` — blocks destructive HTTP API calls before execution
   - `src/agents/pi-tool-definition-adapter.ts` — blocks destructive agent tool calls before execution

3. **`src/gateway/rate-limit.ts`** — Token-bucket rate limiter ported from Centris `backend/security/network_hardening.py`. Per-IP, per-endpoint rate limiting with configurable limits. Default: 120 req/min general, 60 req/min for `/tools/invoke`, 30 req/min for `/v1/chat/completions`.

4. **CORS + Security Headers** — Added to `src/gateway/server-http.ts`:
   - CORS preflight handling with origin validation (uses existing `origin-check.ts`)
   - `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`
   - Rate limiting skips loopback (local dev/tools), enforced for all external IPs

### Phase 2: Voice / Audio Path (COMPLETE)

1. **`src/audio/deepgram-streaming.ts`** — Deepgram WebSocket streaming adapter ported from `backend/audio/deepgram_streaming_adapter.py`. Session management, partial/final transcript accumulation, dynamic `@deepgram/sdk` import.

2. **`src/audio/dictation-cleanup.ts`** — Rule-based text cleanup ported from `backend/services/dictation_service.py`. Self-correction detection, filler removal, stutter dedup, contraction fixes, informal-to-formal, ~5ms.

3. **`src/gateway/centris-voice.ts`** — Voice WebSocket endpoint at `/ws/centris/voice`. Protocol:
   - `recording_start` → creates Deepgram session
   - `audio` → forwards base64 PCM chunks
   - `voice_end` → finalizes transcript, returns action or dictation result
   - `mode_switch` → toggles between action/dictation

4. **Wired into gateway** — `src/gateway/server-http.ts` upgrade handler routes `/ws/centris/voice` to `handleCentrisVoiceConnection`.

### Phase 3: Electron App Rewiring (COMPLETE)

1. **`desktop/src/services/centrisBackendService.js`** — Rewritten to use clawdbot gateway:
   - Health check via `POST /tools/invoke` (404 = alive)
   - Voice via WebSocket at `ws://127.0.0.1:18789/ws/centris/voice`
   - Task execution via `POST /tools/invoke` with Bash tool
   - Mode management is now client-side
   - Preferences stored locally (no backend dependency)
   - Gateway token via `CENTRIS_GATEWAY_TOKEN` env var

2. **`desktop/src/helpers/backendManager.js`** — Rewritten: no longer auto-starts Python; monitors gateway health on port 18789.

3. **`desktop/src/utils/constants.js`** — Updated: `GATEWAY_PORT=18789`, `GATEWAY_URL`, `GATEWAY_WS_URL`. Legacy aliases kept for compatibility.

### Phase 4: Chrome Extension Rewiring (COMPLETE)

1. **`extension/modules/config.js`** — Updated:
   - `GATEWAY_WS_URL` = `ws://127.0.0.1:18789/ws/centris/voice`
   - `LOCAL_BACKEND_URL` now points to gateway
   - Auto-detection probes gateway WebSocket
   - Cloud fallback kept as emergency backup

### Phase 5: Python Backend Removal (COMPLETE)

The entire `backend/` directory has been deleted. Key components were ported to TypeScript before removal:

- Audio: `deepgram_streaming_adapter.py` → `src/audio/deepgram-streaming.ts`
- Dictation: `dictation_service.py` → `src/audio/dictation-cleanup.ts`
- Security: `hidden_text.py` → `src/security/hidden-text.ts`
- Security: `destructive_operation_guard.py` → `src/security/destructive-guard.ts`
- Security: `network_hardening.py` → `src/gateway/rate-limit.ts` + CORS in `server-http.ts`

---

## New File Map

```
src/
├── audio/
│   ├── deepgram-streaming.ts       # Deepgram WebSocket streaming adapter
│   └── dictation-cleanup.ts        # Rule-based dictation text cleanup
├── gateway/
│   ├── centris-voice.ts            # Voice WebSocket endpoint (/ws/centris/voice)
│   ├── rate-limit.ts               # Token-bucket rate limiter
│   ├── rate-limit.test.ts          # Rate limiter tests
│   └── server-http.ts              # Updated: CORS, security headers, rate limiting, voice routing
├── security/
│   ├── external-content.ts         # Updated: integrates hidden-text cleanup
│   ├── hidden-text.ts              # Zero-width, bidi, zalgo detection/removal
│   ├── hidden-text.test.ts         # Hidden text tests
│   ├── destructive-guard.ts        # Operation classification + forbidden command blocking
│   └── destructive-guard.test.ts   # Destructive guard tests
├── agents/
│   └── pi-tool-definition-adapter.ts  # Updated: destructive guard before tool execution
desktop/
├── src/services/centrisBackendService.js  # Rewired to gateway
├── src/helpers/backendManager.js          # Gateway health monitor (no auto-start)
└── src/utils/constants.js                 # Gateway URL constants
extension/
└── modules/config.js                      # Rewired to gateway WebSocket
```

---

## How It Works (End-to-End Voice Flow)

```
User presses push-to-talk key (Electron)
  → Electron captures audio via native-audio
  → Sends base64 PCM chunks via WebSocket to ws://127.0.0.1:18789/ws/centris/voice
  → Gateway forwards chunks to Deepgram WebSocket (streaming)
  → Deepgram returns partial transcripts → forwarded to Electron for display
  → User releases key → voice_end → finalize transcript
  → If action mode: return transcript to Electron → Electron sends to agent
  → If dictation mode: cleanup text → return cleaned text → paste into focused field
```

---

## Centris Profile Setup (REQUIRED)

The Centris system only activates its lean prompt (~2,000 tokens) and domain routing
when `tools.profile` is set to `"centris"`. Without this, every request uses the full
OpenClaw prompt (~6,800 tokens) with no tool filtering — wasting tokens on every call.

Set up via CLI:

```bash
openclaw config set tools.profile centris
```

Or in `~/.openclaw/config.yaml`:

```yaml
tools:
  profile: centris
```

This enables:

- **Lean system prompt**: ~2,000 tokens vs ~6,800 (saves ~4,800 tokens/request)
- **Domain routing**: keyword-based classification narrows tools per turn (browser/computer/file/general)
- **Context pruning**: stale tool results auto-removed (saves 5K-20K tokens in multi-step tasks)
- **Snapshot capping**: browser and computer tool outputs capped at ~1K tokens each

## Remaining Tasks

- [ ] Add `@deepgram/sdk` to `package.json` dependencies
- [ ] Test end-to-end voice flow with Electron app running against gateway
- [ ] Port native messaging host (`extension/native-host/centris_host.py`) to Node or remove
- [ ] Consider porting Cloudflare Workers (`cloudflare-workers/`) or removing
- [ ] Consider porting `connectors/` (Google Workspace) to clawdbot connector pattern
- [ ] Add authentication to the voice WebSocket endpoint (currently open for localhost)
- [ ] Run full test suite to verify no regressions
