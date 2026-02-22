// Centris Backend Service - Handles communication with the Centris Gateway
// Uses CommonJS for compatibility with both main process (require) and renderer (Vite import)
//
// Voice transcription is handled via WebSocket at /ws/centris/voice.
// Task execution goes through /v1/chat/completions so Gemini reasons about
// which tools to invoke (browser, file, bash, system) — not hardcoded to Bash.
// Mode management is client-side.

// ---------------------------------------------------------------------------
// Connection strategy (zero config for users)
// ---------------------------------------------------------------------------
// Packaged builds always hit the production Railway gateway.
// Developers can override with CENTRIS_GATEWAY_URL for local dev.
// There is no auto-detect toggle — packaged app → cloud, dev build → override.

// HTTP traffic goes through Cloudflare (sentris.io) for WAF, caching, analytics.
// WebSocket stays direct to Railway — CF Workers can't proxy long-lived WS.
const PRODUCTION_GATEWAY_URL = "https://api.sentris.io";
const PRODUCTION_GATEWAY_WS_URL = "wss://centris-ai-production.up.railway.app";

const GATEWAY_URL =
  (typeof process !== "undefined" && process.env?.CENTRIS_GATEWAY_URL) ||
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_CENTRIS_GATEWAY_URL) ||
  PRODUCTION_GATEWAY_URL;

const GATEWAY_WS_URL =
  (typeof process !== "undefined" && process.env?.CENTRIS_GATEWAY_WS_URL) ||
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_CENTRIS_GATEWAY_WS_URL) ||
  PRODUCTION_GATEWAY_WS_URL;

const BACKEND_TIMEOUT_MS = 30000;
const BACKEND_HEALTH_CHECK_TIMEOUT_MS = 3000;
const MAX_AUDIO_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const AGENT_TASK_TIMEOUT_MS = 300000; // 5 min for complex multi-tool tasks

let DesktopBridgeClient = null;
try {
  ({ DesktopBridgeClient } = require("./desktopBridgeClient.js"));
} catch {
  // Renderer process — bridge client only works in main process
}

// Simple logger fallback (avoid importing complex loggers in renderer)
const logger = {
  log: (...args) => console.log("[CentrisBackend]", ...args),
  error: (...args) => console.error("[CentrisBackend]", ...args),
  warn: (...args) => console.warn("[CentrisBackend]", ...args),
  debug: (...args) => console.debug("[CentrisBackend]", ...args),
};

class CentrisBackendService {
  constructor(gatewayUrl = null) {
    this.baseURL = gatewayUrl || GATEWAY_URL;
    this.wsURL = (gatewayUrl || GATEWAY_WS_URL).replace(/^http/, "ws");
    this.connected = false;
    this.healthCheckPromise = null;
    this.voiceWs = null;
    this.currentMode = "action"; // Client-side mode tracking
    this.gatewayToken =
      (typeof process !== "undefined" && process.env?.OPENCLAW_GATEWAY_TOKEN) ||
      (typeof process !== "undefined" && process.env?.CENTRIS_GATEWAY_TOKEN) ||
      null;
    this.desktopBridge = null;
  }

  /** Get auth headers for gateway requests */
  _authHeaders() {
    const headers = { "Content-Type": "application/json" };
    if (this.gatewayToken) {
      headers["Authorization"] = `Bearer ${this.gatewayToken}`;
    }
    return headers;
  }

  /** Check if the gateway is reachable via /health endpoint */
  async checkHealth(retries = 1) {
    if (this.healthCheckPromise) {
      return this.healthCheckPromise;
    }
    this.healthCheckPromise = (async () => {
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), BACKEND_HEALTH_CHECK_TIMEOUT_MS);
          const response = await fetch(`${this.baseURL}/health`, {
            method: "GET",
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
          this.connected = response.ok;
          if (this.connected && !this.desktopBridge) {
            this.connectDesktopBridge();
          }
          this.healthCheckPromise = null;
          return this.connected;
        } catch (error) {
          if (attempt === retries) {
            this.connected = false;
            this.healthCheckPromise = null;
            return false;
          }
          await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
        }
      }
      this.healthCheckPromise = null;
      return false;
    })();
    return this.healthCheckPromise;
  }

  // =========================================================================
  // Voice WebSocket (Deepgram streaming via gateway)
  // =========================================================================

  /** Connect to the gateway's Centris voice WebSocket */
  connectVoice() {
    return new Promise((resolve, reject) => {
      if (this.voiceWs && this.voiceWs.readyState === WebSocket.OPEN) {
        resolve(this.voiceWs);
        return;
      }
      try {
        let url = `${this.wsURL}/ws/centris/voice`;
        // Attach token as query param for WebSocket auth (headers not supported in browser WS)
        const voiceToken =
          (typeof process !== "undefined" && process.env?.CENTRIS_EXTENSION_TOKEN) ||
          this.gatewayToken;
        if (voiceToken) {
          url += `?token=${encodeURIComponent(voiceToken)}`;
        }
        this.voiceWs = new WebSocket(url);
        this.voiceWs.onopen = () => {
          logger.log("Voice WebSocket connected");
          resolve(this.voiceWs);
        };
        this.voiceWs.onerror = (err) => {
          logger.error("Voice WebSocket error:", err);
          reject(err);
        };
        this.voiceWs.onclose = () => {
          logger.log("Voice WebSocket closed");
          this.voiceWs = null;
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  /** Start a voice recording session over WebSocket */
  async startVoiceRecording(sessionId, sampleRate = 16000, channels = 1) {
    const ws = await this.connectVoice();
    ws.send(
      JSON.stringify({
        type: "recording_start",
        sessionId,
        sampleRate,
        channels,
        mode: this.currentMode,
      }),
    );
  }

  /** Send an audio chunk (base64-encoded PCM) */
  sendAudioChunk(base64Data) {
    if (this.voiceWs && this.voiceWs.readyState === WebSocket.OPEN) {
      this.voiceWs.send(JSON.stringify({ type: "audio", data: base64Data }));
    }
  }

  /** Signal end of voice input (push-to-talk release) */
  sendVoiceEnd() {
    if (this.voiceWs && this.voiceWs.readyState === WebSocket.OPEN) {
      this.voiceWs.send(JSON.stringify({ type: "voice_end" }));
    }
  }

  /** Register a callback for voice messages */
  onVoiceMessage(callback) {
    if (this.voiceWs) {
      this.voiceWs.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          callback(data);
        } catch (err) {
          logger.error("Voice message parse error:", err);
        }
      };
    }
  }

  // =========================================================================
  // Desktop Bridge (native desktop control via WebSocket)
  // =========================================================================

  /**
   * Connect the desktop bridge to the gateway. This lets the cloud gateway
   * send desktop control commands (snapshot, click, type, etc.) to this
   * Electron app, which executes them via the native accessibility module.
   * Should be called from the main process only.
   */
  connectDesktopBridge() {
    if (
      process.platform !== "darwin" &&
      process.env.CENTRIS_ENABLE_NON_MAC_BRIDGE !== "1" &&
      process.env.NODE_ENV !== "development"
    ) {
      logger.warn("Desktop bridge disabled: Centris GA currently supports macOS only");
      return;
    }
    if (!DesktopBridgeClient) {
      logger.debug("Desktop bridge not available (renderer process or module not found)");
      return;
    }
    if (this.desktopBridge && this.desktopBridge.connected) {
      logger.debug("Desktop bridge already connected");
      return;
    }

    // Use extension token for desktop bridge auth (same token, same validation)
    const extensionToken =
      (typeof process !== "undefined" && process.env?.CENTRIS_EXTENSION_TOKEN) ||
      this.gatewayToken ||
      null;

    this.desktopBridge = new DesktopBridgeClient({
      wsURL: this.wsURL,
      token: extensionToken,
    });
    this.desktopBridge.connect();
    logger.log("Desktop bridge connecting to", this.wsURL);
  }

  /** Disconnect the desktop bridge */
  disconnectDesktopBridge() {
    if (this.desktopBridge) {
      this.desktopBridge.destroy();
      this.desktopBridge = null;
      logger.log("Desktop bridge disconnected");
    }
  }

  /** Check if the desktop bridge is connected */
  isDesktopBridgeConnected() {
    return this.desktopBridge?.connected ?? false;
  }

  // =========================================================================
  // Task execution via /v1/chat/completions (Gemini agent reasoning)
  // =========================================================================
  //
  // Voice transcript → Gemini → tool selection (browser, file, bash, system)
  // → tool execution → result. Gemini decides what to do, not this client.

  async executeTask(instruction, monitorContext = null, onUpdate = null) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), AGENT_TASK_TIMEOUT_MS);

      // Build the message payload for the OpenAI-compatible chat endpoint.
      // The gateway routes this to Gemini, which has access to all tools:
      // browser snapshot/click/type, file read/write, bash, system control, etc.
      const messages = [
        {
          role: "system",
          content:
            "You are Centris, a voice-controlled computer assistant. " +
            "The user speaks a command and you execute it using the tools available to you.\n\n" +
            "BROWSER CONTROL:\n" +
            "You control the user's REAL Chrome browser through the centris_browser tool. " +
            "This is their actual browser with their real logged-in sessions, cookies, and accounts.\n" +
            '- Use action="snapshot" to see interactive elements on the page (returns DOM structure, NOT a screenshot).\n' +
            '- Use action="click" with nodeId from the snapshot to click elements.\n' +
            '- Use action="type" with nodeId and text to type into inputs.\n' +
            '- Use action="navigate" with url to go to a page.\n' +
            "- NEVER request screenshots. You read the page through DOM snapshots only.\n" +
            "- After any click/type/navigate, take a new snapshot to see the updated page state.\n" +
            "- Pass instruction= with your current task when taking snapshots so relevant elements are prioritized.\n\n" +
            "OTHER TOOLS:\n" +
            "You can also read and write files, run shell commands, open applications, and interact with the system.\n\n" +
            "Be concise. Execute the task, then confirm what you did.",
        },
        {
          role: "user",
          content: instruction,
        },
      ];

      // Add monitor context (active window, screen state) if available
      if (monitorContext) {
        messages[0].content += `\n\nCurrent context: ${JSON.stringify(monitorContext)}`;
      }

      const response = await fetch(`${this.baseURL}/v1/chat/completions`, {
        method: "POST",
        headers: this._authHeaders(),
        body: JSON.stringify({
          model: "gemini", // Gateway resolves this to the configured Gemini model
          messages,
          stream: false,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const data = await response.json();

      if (response.ok && data.choices && data.choices.length > 0) {
        const result = data.choices[0].message?.content || "";
        if (onUpdate) {
          onUpdate({ type: "complete", result });
        }
        return { success: true, data: result };
      }

      return {
        success: false,
        error: data?.error?.message || `HTTP ${response.status}: Task execution failed`,
      };
    } catch (error) {
      logger.error("Task execution error:", error);
      return { success: false, error: error.message || "Task execution failed" };
    }
  }

  // =========================================================================
  // Streaming task execution (for real-time feedback in the UI)
  // =========================================================================

  async executeTaskStreaming(instruction, monitorContext = null, onChunk = null) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), AGENT_TASK_TIMEOUT_MS);

      const messages = [
        {
          role: "system",
          content:
            "You are Centris, a voice-controlled computer assistant. " +
            "Execute the user's command using your tools. " +
            "For browser control, use centris_browser with DOM snapshots (never screenshots). " +
            "Be concise. Execute, then confirm.",
        },
        { role: "user", content: instruction },
      ];

      if (monitorContext) {
        messages[0].content += `\n\nCurrent context: ${JSON.stringify(monitorContext)}`;
      }

      const response = await fetch(`${this.baseURL}/v1/chat/completions`, {
        method: "POST",
        headers: this._authHeaders(),
        body: JSON.stringify({
          model: "gemini",
          messages,
          stream: true,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return {
          success: false,
          error: errorData?.error?.message || `HTTP ${response.status}`,
        };
      }

      // Read SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (!line.startsWith("data: ")) {
            continue;
          }
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") {
            continue;
          }

          try {
            const parsed = JSON.parse(payload);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              fullContent += delta;
              if (onChunk) {
                onChunk({ type: "chunk", content: delta, accumulated: fullContent });
              }
            }
          } catch {
            // skip malformed SSE lines
          }
        }
      }

      return { success: true, data: fullContent };
    } catch (error) {
      logger.error("Streaming task error:", error);
      return { success: false, error: error.message || "Streaming task failed" };
    }
  }

  // =========================================================================
  // Dictation cleanup — now client-side (no backend needed)
  // =========================================================================

  async cleanupDictationText(text, _mode = "dictation") {
    return {
      success: true,
      cleanedText: text, // Voice WS already sends cleaned text
      originalText: text,
    };
  }

  isConnected() {
    return this.connected;
  }

  // =========================================================================
  // Mode management (client-side)
  // =========================================================================

  async getModeStatus() {
    return { success: true, mode: this.currentMode };
  }

  async switchMode(mode) {
    if (mode !== "action" && mode !== "dictation") {
      return { success: false, error: "Invalid mode. Must be 'action' or 'dictation'." };
    }
    this.currentMode = mode;

    // Notify voice WebSocket if connected
    if (this.voiceWs && this.voiceWs.readyState === WebSocket.OPEN) {
      this.voiceWs.send(JSON.stringify({ type: "mode_switch", mode }));
    }

    return { success: true, mode: this.currentMode, modeSwitched: true };
  }

  async switchToActionMode() {
    return this.switchMode("action");
  }

  async switchToDictationMode() {
    return this.switchMode("dictation");
  }

  // =========================================================================
  // Preferences — stored locally (no backend dependency)
  // =========================================================================

  async getSupportedLanguages() {
    return {
      success: true,
      languages: [
        { code: "en", name: "English" },
        { code: "es", name: "Spanish" },
        { code: "fr", name: "French" },
        { code: "de", name: "German" },
        { code: "zh", name: "Chinese" },
        { code: "ja", name: "Japanese" },
        { code: "ko", name: "Korean" },
        { code: "pt", name: "Portuguese" },
        { code: "it", name: "Italian" },
        { code: "ru", name: "Russian" },
      ],
    };
  }

  async getUserPreferences(_userId = "default") {
    return { success: true, preferences: {} };
  }

  async saveUserPreferences(_preferences, _userId = "default") {
    return { success: true, preferences: {} };
  }

  async saveLanguagePreference(languageCode) {
    return this.saveUserPreferences({ language: languageCode });
  }
}

// ES Module exports for Vite renderer
export { CentrisBackendService };
export default CentrisBackendService;
