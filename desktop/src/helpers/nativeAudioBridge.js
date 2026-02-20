/**
 * Native Audio Bridge
 *
 * Bridges the native audio module to the Electron renderer process.
 * Provides IPC handlers and manages the native audio capture lifecycle.
 *
 * This module should be imported in the main process (main.js).
 *
 * CRITICAL: IPC handlers are set up immediately on module load to prevent
 * race conditions where the renderer queries before handlers exist.
 */

const { ipcMain, Notification } = require("electron");
const path = require("path");
let WebSocketClient;
try {
  WebSocketClient = require("ws");
} catch {
  // ws not available as direct dep; try globalThis (Node 22+)
  WebSocketClient = globalThis.WebSocket;
}

const PRODUCTION_GATEWAY_URL = "https://centris-ai-production.up.railway.app";
const PRODUCTION_GATEWAY_WS_URL = "wss://centris-ai-production.up.railway.app";

function resolveGatewayUrl() {
  return (
    process.env.CENTRIS_GATEWAY_URL || process.env.OPENCLAW_GATEWAY_URL || PRODUCTION_GATEWAY_URL
  );
}

function resolveGatewayWsUrl() {
  const explicit = process.env.CENTRIS_GATEWAY_WS_URL || process.env.OPENCLAW_GATEWAY_WS_URL;
  if (explicit) return explicit;
  const httpUrl = resolveGatewayUrl();
  return httpUrl.replace(/^http/, "ws");
}

function resolveGatewayToken() {
  return (
    process.env.CENTRIS_EXTENSION_TOKEN ||
    process.env.OPENCLAW_GATEWAY_TOKEN ||
    process.env.CENTRIS_GATEWAY_TOKEN ||
    null
  );
}

// Human-readable tool names for notifications
const TOOL_DISPLAY_NAMES = {
  navigate_browser: "🌐 Navigating",
  get_interactive_snapshot: "🔍 Scanning page elements",
  click_node: "👆 Clicking element",
  input_text_node: "⌨️ Typing text",
  find_and_click: "🎯 Finding & clicking",
  find_and_type: "🎯 Finding & typing",
  get_page_content: "📄 Reading page content",
  write_file: "📝 Writing file",
  read_file: "📖 Reading file",
  open_file: "📂 Opening file",
  open_application: "📱 Opening app",
  close_application: "❌ Closing app",
  execute_terminal_command: "💻 Running command",
  get_clipboard: "📋 Getting clipboard",
  set_clipboard: "📋 Setting clipboard",
  scroll_page: "📜 Scrolling page",
  take_browser_screenshot: "📸 Taking screenshot",
};

/**
 * Show a native macOS notification
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @param {boolean} silent - Whether to suppress the sound
 */
function showNativeNotification(title, body, silent = true) {
  try {
    if (Notification.isSupported()) {
      const notification = new Notification({
        title,
        body,
        silent,
        timeoutType: "default", // Auto-dismiss
      });
      notification.show();
    }
  } catch (err) {
    // Silently fail - notifications are nice-to-have
    console.debug("[NativeAudioBridge] Notification failed:", err.message);
  }
}

// Try to load native audio module
let NativeAudioCapture = null;
let nativeAudioAvailable = false;

try {
  const nativeAudio = require("../../native-audio/lib");
  NativeAudioCapture = nativeAudio.NativeAudioCapture;
  nativeAudioAvailable = nativeAudio.isAvailable();
} catch (err) {
  // Native audio not available - will use Web APIs
}

/**
 * Native Audio Bridge for Electron
 */
class NativeAudioBridge {
  constructor() {
    this.capture = null;
    this.mainWindow = null;
    this.windowManager = null; // Reference to WindowManager for accessing pill windows
    this.isInitialized = false;
    this.isCapturing = false;
    this.wsClient = null; // WebSocket client for streaming transcription
    this.wsUrl = null; // WebSocket URL from config
    this.audioSequence = 0; // Sequence number for audio chunks
    this.ipcHandlersSetup = false;
    this.audioChunkPollingInterval = null; // Interval for polling audio chunks from native module

    // CRITICAL: Set up IPC handlers immediately in constructor
    this.setupIPCHandlers();
  }

  /**
   * Initialize the bridge with the main window reference
   * @param {BrowserWindow} mainWindow
   * @param {WindowManager} windowManager - Optional WindowManager for accessing pill windows
   */
  initialize(mainWindow, windowManager = null) {
    this.mainWindow = mainWindow;
    this.windowManager = windowManager;
  }

  /**
   * Set the WindowManager reference (can be called after initialize)
   * @param {WindowManager} windowManager
   */
  setWindowManager(windowManager) {
    this.windowManager = windowManager;
  }

  /**
   * Send IPC event to all relevant windows (pill windows if available, otherwise mainWindow)
   * This ensures dictation events reach the pill UI where the recording is displayed
   * @param {string} channel - IPC channel name
   * @param {any} data - Data to send
   * @param {boolean} silent - If true, don't log (for high-frequency events)
   */
  sendToWindows(channel, data, silent = false) {
    let sentCount = 0;

    // PRIORITY 1: Send to pill windows (where dictation UI is displayed)
    if (
      this.windowManager &&
      this.windowManager.pillUIWindows &&
      this.windowManager.pillUIWindows.length > 0
    ) {
      this.windowManager.pillUIWindows.forEach((win, index) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send(channel, data);
          sentCount++;
        }
      });
      if (sentCount > 0) {
        return true;
      }
    }

    // FALLBACK: Single pill window reference
    if (
      this.windowManager &&
      this.windowManager.pillUIWindow &&
      !this.windowManager.pillUIWindow.isDestroyed()
    ) {
      this.windowManager.pillUIWindow.webContents.send(channel, data);
      return true;
    }

    // FALLBACK 2: Main window (for onboarding or if no pill windows)
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
      return true;
    }

    if (!silent) {
      console.warn(`[NativeAudioBridge] ⚠️ Cannot send ${channel} - no windows available`);
    }
    return false;
  }

  /**
   * Setup IPC handlers for renderer communication
   * Called once in constructor - prevents race conditions with renderer
   */
  setupIPCHandlers() {
    // Prevent double registration
    if (this.ipcHandlersSetup) {
      return;
    }
    this.ipcHandlersSetup = true;

    // Check if native audio is available
    ipcMain.handle("native-audio-available", () => {
      return nativeAudioAvailable;
    });

    // Get input devices
    ipcMain.handle("native-audio-get-devices", () => {
      if (!nativeAudioAvailable) {
        return [];
      }
      try {
        return NativeAudioCapture.getInputDevices();
      } catch (err) {
        console.error("[NativeAudioBridge] Failed to get devices:", err.message);
        return [];
      }
    });

    // Get default device
    ipcMain.handle("native-audio-get-default-device", () => {
      if (!nativeAudioAvailable) {
        return null;
      }
      try {
        return NativeAudioCapture.getDefaultInputDevice();
      } catch (err) {
        console.error("[NativeAudioBridge] Failed to get default device:", err.message);
        return null;
      }
    });

    // Test a specific device for audio signal
    ipcMain.handle("native-audio-test-device", async (event, deviceId) => {
      if (!nativeAudioAvailable) {
        return { hasSignal: false, rms: 0, error: "Native audio not available" };
      }

      try {
        // Create a temporary capture instance for testing
        const testCapture = new NativeAudioCapture();
        const testConfig = {
          deviceId: deviceId || "",
          sampleRate: 16000,
          channels: 1,
          bitsPerSample: 16,
          bufferSizeMs: 20,
          vadEnabled: false, // Disable VAD for raw audio capture
        };

        const initialized = await testCapture.initialize(testConfig);
        if (!initialized) {
          return { hasSignal: false, rms: 0, deviceId, error: "Failed to initialize" };
        }

        // Start capturing
        testCapture.start();

        // Wait 300ms to collect audio samples
        await new Promise((resolve) => setTimeout(resolve, 300));

        // Get audio chunks and calculate RMS
        let totalSamples = 0;
        let sumSquares = 0;

        const chunks = testCapture.getQueuedAudioChunks();
        for (const chunk of chunks) {
          // Each chunk.data is a Buffer of 16-bit PCM samples
          for (let i = 0; i < chunk.data.length; i += 2) {
            const sample = chunk.data.readInt16LE(i);
            sumSquares += sample * sample;
            totalSamples++;
          }
        }

        // Stop and cleanup
        testCapture.stop();
        testCapture.shutdown();

        // Calculate RMS (normalized to 0-1 range)
        const rms = totalSamples > 0 ? Math.sqrt(sumSquares / totalSamples) / 32768.0 : 0;
        const hasSignal = rms > 0.001;

        return { hasSignal, rms, deviceId: deviceId || "default" };
      } catch (err) {
        return { hasSignal: false, rms: 0, deviceId, error: err.message };
      }
    });

    // Find the first working microphone (one that captures actual audio)
    ipcMain.handle("native-audio-find-working-mic", async () => {
      if (!nativeAudioAvailable) {
        return { deviceId: null, error: "Native audio not available" };
      }

      try {
        const devices = NativeAudioCapture.getInputDevices();

        // CRITICAL FIX: Prioritize built-in MacBook microphone
        // Sort devices to test MacBook/Built-in mics first, then external devices
        // This prevents wasting time testing iPhone mics that won't work
        const sortedDevices = [...devices].toSorted((a, b) => {
          const aName = (a.name || "").toLowerCase();
          const bName = (b.name || "").toLowerCase();

          // Priority 1: MacBook Air/Pro built-in microphone (highest priority)
          const aIsMacBook = aName.includes("macbook") || aName.includes("built");
          const bIsMacBook = bName.includes("macbook") || bName.includes("built");
          if (aIsMacBook && !bIsMacBook) {
            return -1;
          }
          if (bIsMacBook && !aIsMacBook) {
            return 1;
          }

          // Priority 2: Avoid iPhone/iPad mics (they're usually silent when connected)
          const aIsPhone = aName.includes("iphone") || aName.includes("ipad");
          const bIsPhone = bName.includes("iphone") || bName.includes("ipad");
          if (aIsPhone && !bIsPhone) {
            return 1;
          } // Push iPhone to the end
          if (bIsPhone && !aIsPhone) {
            return -1;
          }

          // Priority 3: Keep original order for other devices
          return 0;
        });

        // Test each device in priority order
        for (const device of sortedDevices) {
          // Create a temporary capture instance for testing
          const testCapture = new NativeAudioCapture();
          const testConfig = {
            deviceId: device.id,
            sampleRate: 16000,
            channels: 1,
            bitsPerSample: 16,
            bufferSizeMs: 20,
            vadEnabled: false,
          };

          try {
            const initialized = await testCapture.initialize(testConfig);
            if (!initialized) {
              continue;
            }

            testCapture.start();
            // OPTIMIZED: Reduced wait time from 250ms to 150ms for faster detection
            await new Promise((resolve) => setTimeout(resolve, 150));

            // Calculate RMS from captured audio
            let totalSamples = 0;
            let sumSquares = 0;

            const chunks = testCapture.getQueuedAudioChunks();
            for (const chunk of chunks) {
              for (let i = 0; i < chunk.data.length; i += 2) {
                const sample = chunk.data.readInt16LE(i);
                sumSquares += sample * sample;
                totalSamples++;
              }
            }

            testCapture.stop();
            testCapture.shutdown();

            const rms = totalSamples > 0 ? Math.sqrt(sumSquares / totalSamples) / 32768.0 : 0;

            // CRITICAL FIX: For MacBook mic, accept even if RMS is low
            // The built-in mic works reliably even if it's quiet during detection
            const deviceName = (device.name || "").toLowerCase();
            const isMacBookMic = deviceName.includes("macbook") || deviceName.includes("built");
            const threshold = isMacBookMic ? 0.00001 : 0.001; // Lower threshold for MacBook mic

            if (rms > threshold || isMacBookMic) {
              return {
                deviceId: device.id,
                deviceName: device.name,
                rms,
              };
            }
          } catch (err) {
            try {
              testCapture.shutdown();
            } catch (e) {}
          }
        }

        // No working mic found - return default as fallback
        return { deviceId: "default", deviceName: "Default", rms: 0, fallback: true };
      } catch (err) {
        return { deviceId: "default", error: err.message };
      }
    });

    // Initialize capture
    ipcMain.handle("native-audio-initialize", async (event, config) => {
      if (!nativeAudioAvailable) {
        return { success: false, error: "Native audio not available" };
      }

      try {
        // Cleanup existing capture if any
        if (this.capture) {
          this.capture.shutdown();
        }

        // Setup WebSocket connection for streaming transcription
        if (config.backendUrl) {
          await this.setupWebSocketConnection(config.backendUrl, config.authToken || "");
        }

        this.capture = new NativeAudioCapture();

        // Setup event forwarding to renderer
        this.setupEventForwarding();

        const result = await this.capture.initialize(config);
        this.isInitialized = result;

        return { success: result };
      } catch (err) {
        console.error("[NativeAudioBridge] Failed to initialize:", err.message);
        return { success: false, error: err.message };
      }
    });

    // Start capture
    ipcMain.handle("native-audio-start", async (event, mode) => {
      if (!this.capture || !this.isInitialized) {
        return { success: false, error: "Not initialized" };
      }

      try {
        const voiceMode = mode === "dictation" ? "dictation" : "action";

        // Send recording_start to gateway voice WebSocket
        if (this.isVoiceConnected()) {
          this.wsClient.send(
            JSON.stringify({
              type: "recording_start",
              sessionId: `voice-${Date.now()}`,
              sampleRate: 16000,
              channels: 1,
              mode: voiceMode,
            }),
          );
        }

        const result = this.capture.start();
        this.isCapturing = result;

        // Start audio chunk polling to forward audio to gateway via WebSocket
        if (result) {
          this.startAudioChunkPolling();
        }

        return { success: result };
      } catch (err) {
        console.error("[NativeAudioBridge] Failed to start:", err.message);
        return { success: false, error: err.message };
      }
    });

    // Stop capture
    ipcMain.handle("native-audio-stop", () => {
      if (!this.capture) {
        return { success: true };
      }

      try {
        // Stop audio chunk polling first
        this.stopAudioChunkPolling();

        const result = this.capture.stop();
        this.isCapturing = false;

        // Send voice_end to finalize transcription on the gateway
        if (this.isVoiceConnected()) {
          this.wsClient.send(JSON.stringify({ type: "voice_end" }));
        }

        return { success: result };
      } catch (err) {
        return { success: false, error: err.message };
      }
    });

    // Shutdown
    ipcMain.handle("native-audio-shutdown", () => {
      if (this.capture) {
        this.capture.shutdown();
        this.capture = null;
        this.isInitialized = false;
        this.isCapturing = false;
      }
      return { success: true };
    });

    // Get stats
    ipcMain.handle("native-audio-get-stats", () => {
      if (!this.capture) {
        return null;
      }
      try {
        return this.capture.getStats();
      } catch (err) {
        return null;
      }
    });

    // Check if capturing
    ipcMain.handle("native-audio-is-capturing", () => {
      return this.isCapturing;
    });
  }

  /**
   * Setup raw WebSocket connection to gateway /ws/centris/voice endpoint.
   * The gateway speaks a simple JSON protocol (see centris-voice.ts).
   */
  async setupWebSocketConnection(backendUrl, authToken = "") {
    try {
      // Close existing connection if any
      if (this.wsClient) {
        try {
          this.wsClient.close();
        } catch {}
        this.wsClient = null;
      }

      // Resolve WebSocket URL for the voice endpoint
      const wsBaseUrl = resolveGatewayWsUrl();
      const token = authToken || resolveGatewayToken() || "";
      let voiceUrl = `${wsBaseUrl}/ws/centris/voice`;
      if (token) {
        voiceUrl += `?token=${encodeURIComponent(token)}`;
      }

      this.wsUrl = wsBaseUrl;
      this.audioSequence = 0;
      this._actionUpdateCount = 0;
      this._lastNotifiedTool = null;

      if (!WebSocketClient) {
        console.error("[NativeAudioBridge] WebSocket client not available");
        return;
      }

      console.log(`[NativeAudioBridge] Connecting voice WS to ${wsBaseUrl}/ws/centris/voice`);
      this.wsClient = new WebSocketClient(voiceUrl);

      this.wsClient.on("open", () => {
        console.log("[NativeAudioBridge] Voice WebSocket connected");
        this.sendToWindows("native-audio-ws-connected", {});
      });

      this.wsClient.on("message", (raw) => {
        try {
          const rawStr = typeof raw === "string" ? raw : raw.toString("utf-8");
          const message = JSON.parse(rawStr);
          this._handleGatewayVoiceMessage(message);
        } catch (err) {
          console.error("[NativeAudioBridge] Failed to parse voice message:", err.message);
        }
      });

      this.wsClient.on("error", (error) => {
        console.error("[NativeAudioBridge] Voice WS error:", error.message);
        this.sendToWindows("native-audio-error", {
          message: `Voice connection error: ${error.message || error}`,
        });
      });

      this.wsClient.on("close", (code, reason) => {
        const reasonStr = reason ? reason.toString() : "";
        console.log(`[NativeAudioBridge] Voice WS closed: ${code} ${reasonStr}`);
        this.sendToWindows("native-audio-ws-disconnected", {
          reason: reasonStr || `code=${code}`,
          possibleBackendCrash: code === 1006,
        });
      });

      // Wait for connection to be established
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Voice WebSocket connection timeout"));
        }, 10000);

        const onOpen = () => {
          clearTimeout(timeout);
          this.wsClient.removeListener("error", onError);
          resolve();
        };
        const onError = (err) => {
          clearTimeout(timeout);
          this.wsClient.removeListener("open", onOpen);
          reject(err);
        };

        this.wsClient.once("open", onOpen);
        this.wsClient.once("error", onError);
      });
    } catch (err) {
      console.warn("[NativeAudioBridge] Voice WS setup failed (non-fatal):", err.message);
    }
  }

  /**
   * Handle an incoming message from the gateway voice WebSocket.
   * Maps the gateway JSON protocol to the existing IPC events the renderer expects.
   */
  _handleGatewayVoiceMessage(message) {
    const type = message.type;

    if (type === "transcript") {
      this.sendToWindows(
        "native-audio-transcript",
        {
          text: message.text || "",
          isFinal: !message.partial,
          timestamp: Date.now(),
          mode: message.mode || null,
        },
        true,
      );
      return;
    }

    if (type === "result") {
      const mode = message.mode || "action";
      const text = message.text || "";

      if (mode === "dictation") {
        this.sendToWindows(
          "native-audio-dictation-result",
          {
            text: text,
            originalText: text,
            cleanupMethod: "gateway",
            cleanupMs: 0,
            injectText: true,
            timestamp: Date.now(),
          },
          true,
        );
      } else {
        // Action mode: send as a final transcript so the renderer can
        // execute the action via CentrisBackendService.executeTask().
        this.sendToWindows(
          "native-audio-transcript",
          {
            text: text,
            isFinal: true,
            timestamp: Date.now(),
            mode: "action",
          },
          true,
        );
      }
      return;
    }

    if (type === "session_started") {
      console.log(
        `[NativeAudioBridge] Voice session started: ${message.sessionId} (${message.mode})`,
      );
      return;
    }

    if (type === "mode_changed") {
      console.log(`[NativeAudioBridge] Voice mode changed to: ${message.mode}`);
      return;
    }

    if (type === "error") {
      console.error("[NativeAudioBridge] Gateway voice error:", message.message);
      showNativeNotification("❌ Voice Error", message.message || "Something went wrong", false);
      this.sendToWindows("native-audio-error", {
        message: message.message || "Gateway voice error",
      });
      return;
    }

    if (type === "action_update") {
      this._actionUpdateCount = (this._actionUpdateCount || 0) + 1;

      if (message.tool_name && message.tool_name !== this._lastNotifiedTool) {
        this._lastNotifiedTool = message.tool_name;
        const displayName = TOOL_DISPLAY_NAMES[message.tool_name] || `⚡ ${message.tool_name}`;
        showNativeNotification("Centris AI", displayName, true);
      }

      this.sendToWindows("native-audio-action-update", message, true);
      return;
    }
  }

  /**
   * Send audio chunk to gateway via raw WebSocket
   */
  sendAudioChunk(audioData) {
    if (!this.wsClient || this.wsClient.readyState !== WebSocketClient.OPEN) {
      return false;
    }

    try {
      this.wsClient.send(
        JSON.stringify({
          type: "audio",
          data: audioData.toString("base64"),
        }),
      );
      return true;
    } catch (err) {
      return false;
    }
  }

  /**
   * Check if the voice WebSocket is connected
   */
  isVoiceConnected() {
    return this.wsClient && this.wsClient.readyState === WebSocketClient?.OPEN;
  }

  /**
   * Setup event forwarding from native module to renderer
   * IMPORTANT: Events are sent to pill windows if available (where dictation UI is displayed)
   */
  setupEventForwarding() {
    if (!this.capture) {
      return;
    }

    // Audio level - high frequency, always silent
    this.capture.on("audioLevel", (level) => {
      this.sendToWindows("native-audio-level", level, true);
    });

    // Voice start
    this.capture.on("voiceStart", () => {
      this.sendToWindows("native-audio-voice-start", {});
    });

    // Voice end
    this.capture.on("voiceEnd", () => {
      this.sendToWindows("native-audio-voice-end", {});
      // Send voice_end event to backend for final transcription
      if (this.isVoiceConnected()) {
        this.wsClient.send(JSON.stringify({ type: "voice_end" }));
      }
    });

    // NOTE: Native module transcript events are DISABLED to prevent duplicates.
    // We use backend transcription via WebSocket (this.wsClient.on('transcript'...))
    // which provides better accuracy with Faster-Whisper and proper mode routing.
    // The native capture module's transcript event is for local-only processing
    // which we don't use since all transcription goes through the backend.
    //
    // REMOVED (caused duplicate transcripts):
    // this.capture.on('transcript', (result) => {
    //   this.sendToWindows('native-audio-transcript', result, true);
    // });

    // Error
    this.capture.on("error", (error) => {
      this.sendToWindows("native-audio-error", error);
    });

    // Started
    this.capture.on("started", () => {
      this.sendToWindows("native-audio-started", {});
    });

    // Stopped
    this.capture.on("stopped", () => {
      this.sendToWindows("native-audio-stopped", {});
    });
  }

  /**
   * Start polling for audio chunks from native module and send via Socket.IO
   * This bridges the gap between native audio capture and Socket.IO transmission
   */
  startAudioChunkPolling() {
    if (this.audioChunkPollingInterval) {
      return; // Already polling
    }

    // Reset counters for fresh polling session
    this.audioChunksSent = 0;
    this._noChunksCounter = 0;
    this._pollDebugCounter = 0;
    this._firstChunkSentTime = null;
    this._totalBytesSent = 0;

    console.log("[NativeAudioBridge] 🎤 Starting audio chunk polling (20ms interval)");
    console.log("[NativeAudioBridge]    WebSocket connected:", this.isVoiceConnected());
    console.log("[NativeAudioBridge]    Native capture active:", !!this.capture);

    this.audioChunkPollingInterval = setInterval(() => {
      this.pollAndSendAudioChunks();
    }, 20);
  }

  /**
   * Stop audio chunk polling
   */
  stopAudioChunkPolling() {
    if (this.audioChunkPollingInterval) {
      clearInterval(this.audioChunkPollingInterval);
      this.audioChunkPollingInterval = null;

      // Send any remaining chunks
      this.pollAndSendAudioChunks();

      // Log final stats
      const elapsedMs = this._firstChunkSentTime ? Date.now() - this._firstChunkSentTime : 0;
      console.log("[NativeAudioBridge] 🛑 Audio polling stopped - FINAL STATS:", {
        totalChunksSent: this.audioChunksSent || 0,
        totalBytesSent: this._totalBytesSent || 0,
        totalKB: ((this._totalBytesSent || 0) / 1024).toFixed(1),
        durationMs: elapsedMs,
        durationSec: (elapsedMs / 1000).toFixed(1),
        avgChunksPerSec:
          elapsedMs > 0 ? ((this.audioChunksSent || 0) / (elapsedMs / 1000)).toFixed(1) : 0,
      });

      // CRITICAL: Warn if no audio was sent
      if (!this.audioChunksSent || this.audioChunksSent === 0) {
        console.error("[NativeAudioBridge] ❌ NO AUDIO CHUNKS WERE SENT! Check:");
        console.error("   1. Is the microphone working?");
        console.error("   2. Is the native audio module capturing?");
        console.error("   3. Is the Socket.IO connection established?");
      }
    }
  }

  /**
   * Poll for audio chunks and send them via Socket.IO
   */
  pollAndSendAudioChunks() {
    if (this._pollDebugCounter === undefined) {
      this._pollDebugCounter = 0;
    }

    if (!this.capture || !this.isVoiceConnected()) {
      this._pollDebugCounter++;
      if (this._pollDebugCounter === 1 || this._pollDebugCounter % 100 === 0) {
        console.log("[NativeAudioBridge] ⚠️ pollAndSendAudioChunks skip:", {
          hasCapture: !!this.capture,
          hasWsClient: !!this.wsClient,
          wsReady: this.wsClient?.readyState,
          pollCount: this._pollDebugCounter,
        });
      }
      return;
    }

    try {
      if (typeof this.capture.getQueuedAudioChunks !== "function") {
        if (!this._warnedMissingMethod) {
          this._warnedMissingMethod = true;
          console.error(
            "[NativeAudioBridge] ❌ getQueuedAudioChunks method not found on capture object!",
          );
        }
        return;
      }

      const chunks = this.capture.getQueuedAudioChunks();

      for (const chunk of chunks) {
        this.wsClient.send(
          JSON.stringify({
            type: "audio",
            data: chunk.data.toString("base64"),
          }),
        );
        this._totalBytesSent = (this._totalBytesSent || 0) + chunk.data.length;
      }

      if (this.audioChunksSent === undefined) {
        this.audioChunksSent = 0;
        this._noChunksCounter = 0;
      }

      if (chunks.length > 0) {
        // Log first chunk
        if (this.audioChunksSent === 0) {
          this._firstChunkSentTime = Date.now();
          console.log("[NativeAudioBridge] 🎤 FIRST AUDIO CHUNK sent:", {
            chunkSize: chunks[0].data.length,
            sequence: chunks[0].sequence,
          });
        }

        this.audioChunksSent += chunks.length;
        this._noChunksCounter = 0;

        // Log every 50 chunks (roughly every second)
        if (this.audioChunksSent % 50 === 0) {
          const elapsedMs = Date.now() - (this._firstChunkSentTime || Date.now());
          console.log(
            `[NativeAudioBridge] 📊 Audio progress: ${this.audioChunksSent} chunks, ${(this._totalBytesSent / 1024).toFixed(1)}KB, ${(elapsedMs / 1000).toFixed(1)}s`,
          );
        }
      } else {
        this._noChunksCounter++;
        // Log if no chunks for a while (250+ iterations = 5+ seconds)
        if (this._noChunksCounter === 250) {
          console.warn(
            "[NativeAudioBridge] ⚠️ No audio chunks received from native module for 5+ seconds",
          );
        }
      }
    } catch (err) {
      console.error("[NativeAudioBridge] ❌ Error polling audio chunks:", err.message);
    }
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    // Stop audio chunk polling
    this.stopAudioChunkPolling();

    // Close WebSocket connection
    if (this.wsClient) {
      try {
        this.wsClient.close();
      } catch {}
      this.wsClient = null;
    }

    if (this.capture) {
      this.capture.shutdown();
      this.capture = null;
    }
    this.isInitialized = false;
    this.isCapturing = false;
  }
}

// Export singleton instance
const nativeAudioBridge = new NativeAudioBridge();

module.exports = {
  NativeAudioBridge,
  nativeAudioBridge,
  isNativeAudioAvailable: () => nativeAudioAvailable,
};
