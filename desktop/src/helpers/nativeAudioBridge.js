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
const { io } = require("socket.io-client");
const WebSocket = require("ws");

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
/** True when backendUrl is the Centris gateway (Railway); use /ws/centris/voice instead of Socket.IO */
function isCentrisGatewayUrl(backendUrl) {
  if (!backendUrl || typeof backendUrl !== "string") {
    return false;
  }
  const u = backendUrl.replace(/\/$/, "").toLowerCase();
  return (
    u.startsWith("https://") ||
    u.includes("centris-ai-production") ||
    u.includes("railway") ||
    u.includes("up.railway.app")
  );
}

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
    this.centrisVoiceMode = false; // Use Centris gateway /ws/centris/voice (raw WebSocket)
    this.centrisVoiceWs = null; // WebSocket for Centris voice when centrisVoiceMode is true

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

        if (this.centrisVoiceWs) {
          try {
            this.centrisVoiceWs.close();
          } catch (e) {}
          this.centrisVoiceWs = null;
        }
        this.centrisVoiceMode = false;

        // Centris gateway (Railway): use /ws/centris/voice; otherwise Socket.IO
        if (config.backendUrl) {
          if (isCentrisGatewayUrl(config.backendUrl)) {
            this.centrisVoiceMode = true;
            await this.setupCentrisVoiceConnection(config.backendUrl, config.authToken || "");
          } else {
            await this.setupWebSocketConnection(config.backendUrl, config.authToken || "");
          }
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
    ipcMain.handle("native-audio-start", async () => {
      if (!this.capture || !this.isInitialized) {
        return { success: false, error: "Not initialized" };
      }

      try {
        // CONTEXT DETECTION: Capture what user is looking at BEFORE starting capture
        let userContext = null;
        try {
          const { getContextCollector } = require("../services/contextCollector");
          const collector = getContextCollector();
          userContext = await collector.getCurrentContext({ useCloud: false });
        } catch (contextErr) {
          // Context detection is optional - don't block recording if it fails
        }

        // PREPRIMING: Send recording_start to backend BEFORE starting capture
        if (this.centrisVoiceMode && this.centrisVoiceWs && this.centrisVoiceWs.readyState === 1) {
          this.centrisVoiceWs.send(
            JSON.stringify({
              type: "recording_start",
              sessionId: `voice-${Date.now()}`,
              sampleRate: 16000,
              channels: 1,
              mode: "action",
            }),
          );
        } else if (this.wsClient && this.wsClient.connected) {
          this.wsClient.emit("recording_start", {
            context: userContext
              ? {
                  id: userContext.id,
                  appName: userContext.appName || userContext.systemState?.appName,
                  bundleId: userContext.bundleId || userContext.systemState?.bundleId,
                  windowTitle: userContext.windowTitle || userContext.systemState?.windowTitle,
                  url: userContext.url || userContext.systemState?.url,
                  capabilities: userContext.capabilities,
                  available_tools: userContext.available_tools,
                  context_prompt: userContext.context_prompt,
                  confidence: userContext.confidence,
                }
              : null,
            timestamp: Date.now(),
          });
        }

        const result = this.capture.start();
        this.isCapturing = result;

        // Start audio chunk polling to forward audio to backend via Socket.IO
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

        // CRITICAL: Manually send voice_end to finalize transcription
        if (this.centrisVoiceMode && this.centrisVoiceWs && this.centrisVoiceWs.readyState === 1) {
          this.centrisVoiceWs.send(JSON.stringify({ type: "voice_end" }));
        } else if (this.wsClient && this.wsClient.connected) {
          this.wsClient.emit("voice_end");
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
   * Setup Centris gateway voice WebSocket (/ws/centris/voice).
   * Used when backendUrl is the Railway gateway; protocol is JSON (recording_start, audio, voice_end).
   */
  async setupCentrisVoiceConnection(backendUrl, authToken = "") {
    const base = backendUrl.replace(/\/$/, "").trim();
    const wssBase = base.startsWith("https")
      ? base.replace(/^https/, "wss")
      : base.replace(/^http/, "ws");
    let wssUrl = `${wssBase}/ws/centris/voice`;
    if (authToken) {
      wssUrl += `?token=${encodeURIComponent(authToken)}`;
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Centris voice WebSocket connection timeout"));
      }, 10000);
      try {
        this.centrisVoiceWs = new WebSocket(wssUrl);
        this.centrisVoiceWs.on("open", () => {
          clearTimeout(timeout);
          this.sendToWindows("native-audio-ws-connected", {});
          resolve();
        });
        this.centrisVoiceWs.on("message", (data) => {
          try {
            const msg = typeof data === "string" ? JSON.parse(data) : JSON.parse(data.toString());
            const type = msg.type;
            if (type === "result") {
              this.sendToWindows("native-audio-voice-result", {
                text: msg.text || "",
                mode: msg.mode === "dictation" ? "dictation" : "action",
              });
            } else if (type === "transcript") {
              this.sendToWindows(
                "native-audio-transcript",
                {
                  text: msg.text || "",
                  isFinal: msg.partial === false,
                  timestamp: Date.now(),
                  mode: msg.mode || null,
                },
                true,
              );
            } else if (type === "error") {
              this.sendToWindows("native-audio-error", { message: msg.message || "Voice error" });
            }
            // session_started: no need to forward
          } catch (err) {
            console.error("[NativeAudioBridge] Centris voice message parse error:", err.message);
          }
        });
        this.centrisVoiceWs.on("error", (err) => {
          this.sendToWindows("native-audio-error", {
            message: `Centris voice error: ${err.message || err}`,
          });
        });
        this.centrisVoiceWs.on("close", () => {
          this.sendToWindows("native-audio-ws-disconnected", { reason: "close" });
        });
      } catch (err) {
        clearTimeout(timeout);
        reject(err);
      }
    });
  }

  /**
   * Setup Socket.IO connection for streaming transcription
   */
  async setupWebSocketConnection(backendUrl, authToken = "") {
    try {
      // Convert HTTP URL to Socket.IO URL (Socket.IO uses HTTP/HTTPS, not ws/wss)
      let socketUrl = backendUrl.replace(/\/$/, "");

      // Close existing connection if any
      if (this.wsClient) {
        this.wsClient.disconnect();
      }

      // Create Socket.IO connection with namespace
      const socketOptions = {
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 5,
        timeout: 10000,
      };

      if (authToken) {
        socketOptions.auth = {
          token: authToken,
        };
        socketOptions.extraHeaders = {
          Authorization: `Bearer ${authToken}`,
        };
      }

      this.wsClient = io(`${socketUrl}/ws/audio/stream`, socketOptions);
      this.wsUrl = socketUrl;
      this.audioSequence = 0;

      // Setup Socket.IO event handlers
      this.wsClient.on("connect", () => {
        this.sendToWindows("native-audio-ws-connected", {});
      });

      this.wsClient.on("connected", (data) => {
        // Connection confirmed
      });

      this.wsClient.on("transcript", (message) => {
        try {
          if (message && message.text) {
            this.sendToWindows(
              "native-audio-transcript",
              {
                text: message.text,
                isFinal: message.isFinal || false,
                timestamp: message.timestamp || Date.now(),
                mode: message.mode || null,
              },
              true,
            );
          }
        } catch (err) {
          // Silent error handling
        }
      });

      // Handle dictation_result event - provides cleaned text for dictation mode
      this.wsClient.on("dictation_result", (message) => {
        try {
          if (message && message.cleaned_text) {
            this.sendToWindows(
              "native-audio-dictation-result",
              {
                text: message.cleaned_text,
                originalText: message.original_text,
                cleanupMethod: message.cleanup_method,
                cleanupMs: message.cleanup_ms,
                injectText: message.inject_text ?? true,
                timestamp: Date.now(),
              },
              true,
            );
          }
        } catch (err) {
          // Silent error handling
        }
      });

      // Handle action_result event - provides execution result from action mode
      this.wsClient.on("action_result", (message) => {
        try {
          // Reset action update counter and last notified tool
          this._actionUpdateCount = 0;
          this._lastNotifiedTool = null;

          // COMPLETION NOTIFICATION: Show what was accomplished on user's Mac
          if (message.success && message.response) {
            const truncatedResponse =
              message.response.length > 100
                ? message.response.substring(0, 100) + "..."
                : message.response;
            showNativeNotification("✅ Task Complete", truncatedResponse, false);
          } else if (!message.success) {
            showNativeNotification(
              "❌ Task Failed",
              message.error || "Something went wrong",
              false,
            );
          }

          this.sendToWindows(
            "native-audio-action-result",
            {
              success: message.success,
              response: message.response,
              error: message.error,
              text: message.text,
              tool_calls: message.tool_calls,
              timestamp: Date.now(),
            },
            true,
          );
        } catch (err) {
          // Silent error handling
        }
      });

      // Handle action_update event - streaming updates during action execution (minimal logging)
      this._actionUpdateCount = 0;
      this._lastNotifiedTool = null;
      this.wsClient.on("action_update", (message) => {
        try {
          this._actionUpdateCount++;

          // REAL-TIME USER FEEDBACK: Show native notification for tool calls
          // This is especially important since browser visualization may be blocked by CSP on Gmail, etc.
          if (message.type === "tool_call" && message.tool_name) {
            // Only notify if it's a different tool than last time (avoid repeated notifications)
            if (message.tool_name !== this._lastNotifiedTool) {
              this._lastNotifiedTool = message.tool_name;
              const displayName =
                TOOL_DISPLAY_NAMES[message.tool_name] || `⚡ ${message.tool_name}`;

              // Build notification body with relevant details from tool arguments
              let body = "";
              const args = message.arguments || {};

              // Parse arguments (may be string or object)
              let parsedArgs = args;
              if (typeof args === "string") {
                try {
                  parsedArgs = JSON.parse(args);
                } catch (e) {
                  parsedArgs = {};
                }
              }

              // Build descriptive notification body based on tool type
              if (message.tool_name === "navigate_browser") {
                body = parsedArgs.url || "";
              } else if (message.tool_name === "click_node") {
                // Try to get node description from the message context
                body = parsedArgs.description || `Node #${parsedArgs.node_id || "?"}`;
              } else if (message.tool_name === "input_text_node") {
                const text = (parsedArgs.text || "").substring(0, 30);
                body = text
                  ? `"${text}${parsedArgs.text?.length > 30 ? "..." : ""}"`
                  : `Node #${parsedArgs.node_id || "?"}`;
              } else if (message.tool_name === "find_and_click") {
                body = parsedArgs.description || "";
              } else if (message.tool_name === "find_and_type") {
                body = parsedArgs.description
                  ? `${parsedArgs.description}: "${(parsedArgs.text || "").substring(0, 20)}..."`
                  : "";
              } else if (message.tool_name === "write_file" || message.tool_name === "read_file") {
                body = parsedArgs.file_path || parsedArgs.path || "";
              } else if (message.tool_name === "open_application") {
                body = parsedArgs.app_name || parsedArgs.name || "";
              } else if (message.tool_name === "execute_terminal_command") {
                const cmd = parsedArgs.command || "";
                body = cmd.length > 40 ? cmd.substring(0, 40) + "..." : cmd;
              }

              showNativeNotification(
                "Centris AI",
                `${displayName}${body ? ": " + body : ""}`,
                true,
              );
            }
          }

          // Send streaming updates to pill windows for real-time feedback
          this.sendToWindows("native-audio-action-update", message, true);
        } catch (err) {
          // Silent error handling
        }
      });

      this.wsClient.on("error", (error) => {
        this.sendToWindows("native-audio-error", {
          message: `Socket.IO error: ${error.message || error}`,
        });
      });

      this.wsClient.on("disconnect", (reason) => {
        const isBackendCrash = reason === "transport close" || reason === "ping timeout";

        this.sendToWindows("native-audio-ws-disconnected", {
          reason,
          possibleBackendCrash: isBackendCrash,
        });
      });

      this.wsClient.on("connect_error", (error) => {
        let errorMessage = `Connection error: ${error.message}`;
        if (error.message && error.message.includes("ECONNREFUSED")) {
          errorMessage = "Backend not running - please start Centris backend";
        } else if (error.message && error.message.includes("timeout")) {
          errorMessage = "Backend connection timeout - check if backend is running";
        }

        this.sendToWindows("native-audio-error", {
          message: errorMessage,
          originalError: error.message,
        });
      });

      // Wait for connection to be established
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Socket.IO connection timeout"));
        }, 10000);

        this.wsClient.once("connect", () => {
          clearTimeout(timeout);
          resolve();
        });

        this.wsClient.once("connect_error", (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });
    } catch (err) {
      // Don't fail initialization if Socket.IO fails
    }
  }

  /**
   * Send audio chunk to backend (Socket.IO or Centris voice WebSocket)
   */
  sendAudioChunk(audioData) {
    if (this.centrisVoiceMode && this.centrisVoiceWs && this.centrisVoiceWs.readyState === 1) {
      try {
        this.centrisVoiceWs.send(
          JSON.stringify({ type: "audio", data: audioData.toString("base64") }),
        );
        return true;
      } catch (err) {
        return false;
      }
    }
    if (!this.wsClient || !this.wsClient.connected) {
      return false;
    }

    try {
      const message = {
        type: "audio",
        sequence: this.audioSequence++,
        data: audioData.toString("base64"),
        timestamp: Date.now(),
      };

      this.wsClient.emit("audio", message);
      return true;
    } catch (err) {
      return false;
    }
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
      // Note: Don't send any data - the backend handler takes no arguments
      if (this.wsClient && this.wsClient.connected) {
        this.wsClient.emit("voice_end");
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
    console.log("[NativeAudioBridge]    WebSocket connected:", this.wsClient?.connected);
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

    const wsReady = this.centrisVoiceMode
      ? this.centrisVoiceWs && this.centrisVoiceWs.readyState === 1
      : this.wsClient && this.wsClient.connected;
    if (!this.capture || !wsReady) {
      this._pollDebugCounter++;
      if (this._pollDebugCounter === 1 || this._pollDebugCounter % 100 === 0) {
        console.log("[NativeAudioBridge] ⚠️ pollAndSendAudioChunks skip:", {
          hasCapture: !!this.capture,
          centrisVoice: this.centrisVoiceMode,
          wsReady,
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
        if (this.centrisVoiceMode && this.centrisVoiceWs && this.centrisVoiceWs.readyState === 1) {
          this.centrisVoiceWs.send(
            JSON.stringify({ type: "audio", data: chunk.data.toString("base64") }),
          );
        } else {
          const message = {
            type: "audio",
            sequence: chunk.sequence,
            data: chunk.data.toString("base64"),
            timestamp: Date.now(),
          };
          this.wsClient.emit("audio", message);
        }
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

    // Close Socket.IO connection
    if (this.wsClient) {
      this.wsClient.disconnect();
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
