/**
 * AudioManager - Recording & Transcription Handler for Centris AI
 *
 * ============================================================================
 * SIMPLIFIED AUDIO ARCHITECTURE (January 2026)
 * ============================================================================
 *
 * This file handles ALL recording, transcription, and text injection logic.
 * It works WITH audioSystem.js (which provides the unified mic stream).
 *
 * WHAT THIS FILE DOES:
 * - Start/stop recording (native audio priority, Web API fallback)
 * - Stream audio to backend via Socket.IO
 * - Handle transcription results from backend
 * - Mode management (action vs dictation)
 * - Text pasting/injection
 * - Audio visualization
 *
 * THE CLEAN PIPELINE:
 * 1. startRecording() → native audio (C++) or Web API fallback
 * 2. Audio streams to backend via Socket.IO → /ws/audio/stream
 * 3. Backend routes to Deepgram via Cloudflare AI Gateway
 * 4. Transcript received → mode-specific handling:
 *    - Dictation mode: clean up text → paste into app
 *    - Action mode: backend executes tools → show result
 *
 * INTEGRATION WITH audioSystem.js:
 * - In Web API mode, we try to use the unified stream from audioSystem.js
 * - This prevents mic conflicts with wake word detection
 * - Native audio mode bypasses this (handles mic directly via C++)
 *
 * See audioSystem.js for the unified stream architecture.
 */

const isDebugMode =
  typeof process !== "undefined" &&
  (process.env.OPENWHISPR_DEBUG === "true" || process.env.NODE_ENV === "development");
const SHORT_CLIP_DURATION_SECONDS = 2.5;
const REASONING_CACHE_TTL = 30000; // 30 seconds

// Reusable AudioContext instance for performance
let sharedAudioContext = null;
const getAudioContext = () => {
  if (!sharedAudioContext) {
    sharedAudioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  return sharedAudioContext;
};

const debugLogger = {
  logReasoning: async (stage, details) => {
    if (!isDebugMode) {
      return;
    }

    if (window.electronAPI?.logReasoning) {
      try {
        await window.electronAPI.logReasoning(stage, details);
      } catch (error) {
        // Silent fail
      }
    }
  },
};

class AudioManager {
  constructor() {
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.isRecording = false;
    this.isProcessing = false;
    this.isStarting = false; // RACE CONDITION FIX: Track if we're in the process of starting
    this.shouldAbortStart = false; // RACE CONDITION FIX: Flag to abort start if stop is called early
    this.onStateChange = null;
    this.onError = null;
    this.onTranscriptionComplete = null;
    this.cachedApiKey = null;
    this.cachedTranscriptionEndpoint = null;
    this.recordingStartTime = null;
    this.reasoningAvailabilityCache = { value: false, expiresAt: 0 };
    this.cachedReasoningPreference = null;
    // Mode management: 'action' (default) or 'dictation'
    this.mode = this.getMode();
    this.onModeChange = null;

    // Real-time audio visualization
    this.audioContext = null;
    this.analyser = null;
    this.dataArray = null;
    this.mediaStream = null; // Keep stream alive for visualization
    this.visualizationCallback = null;
    this.visualizationAnimationFrame = null;

    // Native audio support (Wispr Flow-level performance)
    this.nativeAudioAvailable = false;
    this.nativeAudioInitialized = false;
    this.nativeAudioCapturing = false;
    this.useNativeAudio = false; // Will be set based on availability
    this.nativeAudioEventListeners = [];
    this.backendUrl = null; // Backend URL for native audio streaming
    this.cachedWorkingDeviceId = null; // Cached working microphone ID (auto-detected)

    // Accumulated transcript for native audio streaming
    // Partials are accumulated here, then pasted when isFinal is received
    this.accumulatedTranscript = "";
  }

  getMode() {
    if (typeof window !== "undefined" && window.localStorage) {
      return localStorage.getItem("centrisMode") || "action";
    }
    return "action";
  }

  setMode(mode, broadcast = true) {
    if (mode !== "action" && mode !== "dictation") {
      // Invalid mode - default to 'action'
      mode = "action";
    }
    this.mode = mode;
    if (typeof window !== "undefined" && window.localStorage) {
      localStorage.setItem("centrisMode", mode);
    }
    this.onModeChange?.(mode);

    // Broadcast mode change to all windows (including Preferences window)
    // This ensures UI stays in sync across all windows when mode is switched via voice
    if (broadcast && window.electronAPI?.broadcastModeChange) {
      console.log("[AudioManager] 📣 Broadcasting mode change via IPC:", mode);
      window.electronAPI.broadcastModeChange(mode).catch((err) => {
        console.warn("[AudioManager] Failed to broadcast mode change:", err);
      });
    }
  }

  detectModeSwitch(text) {
    const normalized = text.toLowerCase().trim();
    const dictationPatterns = [
      /centris\s+dictation\s+mode/i,
      /centris\s+switch\s+to\s+dictation\s+mode/i,
      /centris\s+dictation/i,
      /switch\s+to\s+dictation/i,
    ];
    const actionPatterns = [
      /centris\s+action\s+mode/i,
      /centris\s+switch\s+to\s+action\s+mode/i,
      /centris\s+action/i,
      /switch\s+to\s+action/i,
    ];

    if (dictationPatterns.some((pattern) => pattern.test(normalized))) {
      return "dictation";
    }
    if (actionPatterns.some((pattern) => pattern.test(normalized))) {
      return "action";
    }
    return null;
  }

  setCallbacks({ onStateChange, onError, onTranscriptionComplete, onModeChange, onAudioLevel }) {
    this.onStateChange = onStateChange;
    this.onError = onError;
    this.onTranscriptionComplete = onTranscriptionComplete;
    this.onModeChange = onModeChange;
    this.visualizationCallback = onAudioLevel; // For real-time audio level updates
  }

  /**
   * Check if native audio is available and initialize if possible
   */
  async checkNativeAudioAvailability() {
    try {
      if (window.electronAPI?.nativeAudioAvailable) {
        this.nativeAudioAvailable = await window.electronAPI.nativeAudioAvailable();

        if (this.nativeAudioAvailable) {
          // Use default backend URL directly to avoid import issues
          this.backendUrl = "http://127.0.0.1:5001";

          // Setup native audio event listeners
          this.setupNativeAudioListeners();
        }
      }
    } catch (error) {
      this.nativeAudioAvailable = false;
    }
    return this.nativeAudioAvailable;
  }

  /**
   * Setup event listeners for native audio
   */
  setupNativeAudioListeners() {
    if (!this.nativeAudioAvailable || !window.electronAPI) {
      return;
    }

    // Remove existing listeners
    this.cleanupNativeAudioListeners();

    // Audio level updates
    if (window.electronAPI.onNativeAudioLevel) {
      const levelListener = (level) => {
        if (this.visualizationCallback) {
          // Convert native audio level (0-1) to visualization format (0-255)
          const levelPercent = Math.floor(level * 100);
          this.visualizationCallback({
            level: level * 255,
            levelPercent: levelPercent,
            frequencies: null,
            timeData: null,
          });
        }
      };
      // CRITICAL: Store the cleanup function returned by the registration
      const cleanup = window.electronAPI.onNativeAudioLevel(levelListener);
      this.nativeAudioEventListeners.push({ type: "level", cleanup });
    }

    // Voice start/end events
    if (window.electronAPI.onNativeAudioVoiceStart) {
      const voiceStartListener = () => {};
      const cleanup = window.electronAPI.onNativeAudioVoiceStart(voiceStartListener);
      this.nativeAudioEventListeners.push({ type: "voiceStart", cleanup });
    }

    if (window.electronAPI.onNativeAudioVoiceEnd) {
      const voiceEndListener = () => {};
      const cleanup = window.electronAPI.onNativeAudioVoiceEnd(voiceEndListener);
      this.nativeAudioEventListeners.push({ type: "voiceEnd", cleanup });
    }

    // Transcript events (streaming)
    if (window.electronAPI.onNativeAudioTranscript) {
      const transcriptListener = (result) => {
        this.handleNativeAudioTranscript(result);
      };
      const cleanup = window.electronAPI.onNativeAudioTranscript(transcriptListener);
      this.nativeAudioEventListeners.push({ type: "transcript", cleanup });
    }

    // Dictation result event - provides pre-cleaned text from backend
    if (window.electronAPI.onNativeAudioDictationResult) {
      const dictationResultListener = async (result) => {
        try {
          if (result && result.text && result.injectText) {
            await this.safePaste(result.text);

            this.onTranscriptionComplete?.({
              success: true,
              text: result.text,
              originalText: result.originalText,
              source: "native-audio-dictation",
              mode: "dictation",
              cleanupMethod: result.cleanupMethod,
              cleanupMs: result.cleanupMs,
              alreadyPasted: true,
            });
          }
        } catch (error) {
          this.onError?.({
            title: "Dictation Error",
            description: error.message || "Failed to inject dictation text",
          });
        }
      };
      const cleanup = window.electronAPI.onNativeAudioDictationResult(dictationResultListener);
      this.nativeAudioEventListeners.push({ type: "dictationResult", cleanup });
    }

    // Action result event - provides execution result from backend action mode
    if (window.electronAPI.onNativeAudioActionResult) {
      const actionResultListener = async (result) => {
        try {
          if (result.success) {
            this.onTranscriptionComplete?.({
              success: true,
              text: result.response || result.text || "Action completed",
              source: "native-audio-action",
              mode: "action",
              executed: true,
              result: result,
            });
          } else {
            this.onError?.({
              title: "Action Failed",
              description: result.error || "Failed to execute action",
            });
          }
        } catch (error) {
          this.onError?.({
            title: "Action Error",
            description: error.message || "Failed to process action result",
          });
        }
      };
      const cleanup = window.electronAPI.onNativeAudioActionResult(actionResultListener);
      this.nativeAudioEventListeners.push({ type: "actionResult", cleanup });
    }

    // Action update event - streaming updates during action execution (silent - for UI only)
    if (window.electronAPI.onNativeAudioActionUpdate) {
      const actionUpdateListener = (update) => {
        // Updates can be used for real-time UI feedback during action execution
      };
      const cleanup = window.electronAPI.onNativeAudioActionUpdate(actionUpdateListener);
      this.nativeAudioEventListeners.push({ type: "actionUpdate", cleanup });
    }

    // Error events
    if (window.electronAPI.onNativeAudioError) {
      const errorListener = (error) => {
        this.onError?.({
          title: "Native Audio Error",
          description: error.message || "An error occurred with native audio capture",
        });
      };
      const cleanup = window.electronAPI.onNativeAudioError(errorListener);
      this.nativeAudioEventListeners.push({ type: "error", cleanup });
    }

    // Started/stopped events
    if (window.electronAPI.onNativeAudioStarted) {
      const startedListener = () => {
        this.nativeAudioCapturing = true;
        this.isRecording = true;
        this.onStateChange?.({ isRecording: true, isProcessing: false });
      };
      const cleanup = window.electronAPI.onNativeAudioStarted(startedListener);
      this.nativeAudioEventListeners.push({ type: "started", cleanup });
    }

    if (window.electronAPI.onNativeAudioStopped) {
      const stoppedListener = () => {
        this.nativeAudioCapturing = false;
        this.isRecording = false;
        this.onStateChange?.({ isRecording: false, isProcessing: false });
      };
      const cleanup = window.electronAPI.onNativeAudioStopped(stoppedListener);
      this.nativeAudioEventListeners.push({ type: "stopped", cleanup });
    }
  }

  /**
   * Cleanup native audio event listeners
   * CRITICAL: Must actually call the cleanup functions returned by the preload API
   * to remove listeners and prevent duplicate event handling
   */
  cleanupNativeAudioListeners() {
    if (this.nativeAudioEventListeners && this.nativeAudioEventListeners.length > 0) {
      this.nativeAudioEventListeners.forEach(({ type, cleanup }) => {
        if (typeof cleanup === "function") {
          try {
            cleanup();
          } catch (err) {
            // Silent cleanup
          }
        }
      });
    }
    this.nativeAudioEventListeners = [];
  }

  /**
   * Handle streaming transcript from native audio
   * IMPORTANT: The backend sends partial transcripts for real-time display, and a final
   * transcript that contains the COMPLETE re-transcription of all audio.
   * We do NOT accumulate partials + final - the final IS the complete text.
   */
  async handleNativeAudioTranscript(result) {
    try {
      if (!result) {
        return;
      }

      const transcribedText = result.text?.trim() || "";
      const isFinal = result.isFinal === true;

      // For partial transcripts, just accumulate for display purposes (not for pasting)
      if (!isFinal) {
        if (transcribedText) {
          this.accumulatedTranscript = (this.accumulatedTranscript || "") + " " + transcribedText;
        }
        return;
      }

      // Clear accumulated transcript since we're using the final complete version
      this.accumulatedTranscript = "";
      const fullTranscript = transcribedText;

      if (!fullTranscript) {
        return;
      }

      // Check for mode switch commands
      const newMode = this.detectModeSwitch(fullTranscript);
      if (newMode && newMode !== this.mode) {
        this.setMode(newMode);
        this.onTranscriptionComplete?.({
          success: true,
          text: `Switched to ${newMode} mode`,
          source: "native-audio",
          modeSwitch: true,
        });
        return;
      }

      // Wait for backend events (dictation_result or action_result)
    } catch (error) {
      console.error("[AudioManager] ❌ Error handling transcript:", error);
      this.onError?.({
        title: "Transcript Processing Error",
        description: error.message || "Failed to process transcript",
      });
    }
  }

  async startRecording() {
    // Clear accumulated transcript from previous recording
    this.accumulatedTranscript = "";

    try {
      if (this.isRecording || this.isStarting) {
        return false;
      }

      // RACE CONDITION FIX: Set isStarting immediately before any async operations
      // This ensures stopRecording() knows we're in the process of starting
      this.isStarting = true;
      this.shouldAbortStart = false;

      // CRITICAL: Check microphone permission in REAL-TIME before recording
      if (window.electronAPI?.checkMicrophonePermission) {
        try {
          const permStatus = await window.electronAPI.checkMicrophonePermission();

          if (!permStatus.granted) {
            this.onError?.({
              title: "Microphone Permission Required",
              description:
                "Microphone access has been revoked. Please re-enable it in System Settings → Privacy & Security → Microphone.",
            });
            if (window.electronAPI?.openSystemPreferences) {
              window.electronAPI.openSystemPreferences("microphone");
            }
            return false;
          }
        } catch (permError) {
          // Continue anyway - permission check is best-effort
        }
      }

      // CRITICAL: Capture the focused text field BEFORE we do anything else
      if (window.electronAPI?.captureFocus) {
        try {
          await window.electronAPI.captureFocus();
        } catch (focusError) {
          // Continue anyway - we'll inject into whatever is focused at injection time
        }
      }

      // Check native audio availability if not already checked
      if (!this.nativeAudioAvailable && window.electronAPI?.nativeAudioAvailable) {
        await this.checkNativeAudioAvailability();
      }

      // Try native audio first if available
      if (this.nativeAudioAvailable) {
        return await this.startNativeAudioRecording();
      }

      // Fallback to Web APIs
      return await this.startWebAPIRecording();
    } catch (error) {
      // Reset state on error
      this.isRecording = false;
      this.isProcessing = false;
      this.onStateChange?.({ isRecording: false, isProcessing: false });

      // Provide standardized error messages
      let errorTitle = "Recording Error";
      let errorDescription = `Failed to access microphone: ${error.message}`;

      if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
        errorTitle = "Microphone Access Denied";
        errorDescription =
          "Please grant microphone permission in your system settings and try again.";
      } else if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
        errorTitle = "No Microphone Found";
        errorDescription = "No microphone was detected. Please connect a microphone and try again.";
      } else if (error.name === "NotReadableError" || error.name === "TrackStartError") {
        errorTitle = "Microphone In Use";
        errorDescription =
          "The microphone is being used by another application. Please close other apps and try again.";
      }

      this.onError?.({
        title: errorTitle,
        description: errorDescription,
      });
      return false;
    } finally {
      // RACE CONDITION FIX: Always clear isStarting flag when startRecording completes
      this.isStarting = false;
    }
  }

  /**
   * Start native audio recording (Wispr Flow-level performance)
   */
  async startNativeAudioRecording() {
    try {
      // Define backendUrl at function scope so it's available for native audio config
      const backendUrl = this.backendUrl || "http://127.0.0.1:5001";

      // CRITICAL: Check if Centris backend is available before using native audio
      if (window.electronAPI?.ensureBackendRunning) {
        try {
          const result = await window.electronAPI.ensureBackendRunning();

          if (!result.success || !result.running) {
            this.nativeAudioAvailable = false;
            return await this.startWebAPIRecording();
          }
        } catch (backendError) {
          this.nativeAudioAvailable = false;
          return await this.startWebAPIRecording();
        }
      } else {
        // Fallback: Direct health check if backend manager not available
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 2000);
          const healthCheck = await fetch(`${backendUrl}/api/health`, {
            signal: controller.signal,
            method: "GET",
          });
          clearTimeout(timeoutId);

          if (!healthCheck.ok) {
            this.nativeAudioAvailable = false;
            return await this.startWebAPIRecording();
          }
        } catch (healthError) {
          this.nativeAudioAvailable = false;
          return await this.startWebAPIRecording();
        }
      }

      // RACE CONDITION FIX: Check if stop was called during async operations
      if (this.shouldAbortStart) {
        this.isStarting = false;
        this.shouldAbortStart = false;
        return false;
      }

      // Initialize native audio if not already initialized
      if (!this.nativeAudioInitialized) {
        // Use cached device if available (FAST PATH - no auto-detection needed)
        let deviceId = this.cachedWorkingDeviceId || "default";

        // Only run auto-detection on first use OR if we don't have a cached device
        if (!this.cachedWorkingDeviceId && window.electronAPI?.nativeAudioFindWorkingMic) {
          try {
            const micResult = await window.electronAPI.nativeAudioFindWorkingMic();

            // RACE CONDITION FIX: Check again after async operation
            if (this.shouldAbortStart) {
              this.isStarting = false;
              this.shouldAbortStart = false;
              return false;
            }

            if (micResult.deviceId && !micResult.fallback) {
              deviceId = micResult.deviceId;
              this.cachedWorkingDeviceId = deviceId;
            } else if (micResult.fallback) {
              this.cachedWorkingDeviceId = "default";
            }
          } catch (detectError) {
            this.cachedWorkingDeviceId = "default";
          }
        }

        const config = {
          deviceId: deviceId,
          sampleRate: 16000,
          channels: 1,
          bitsPerSample: 16,
          bufferSizeMs: 20, // INCREASED from 10ms: 20ms buffers for better audio quality
          vadEnabled: true,
          vadThreshold: 0.03, // TUNED: Balanced threshold for clear speech and whispers
          vadSilenceMs: 400, // MATCHED WITH BACKEND: 400ms silence timeout (was 600)
          backendUrl: backendUrl,
          authToken: "", // Add auth token if needed
        };

        const initResult = await window.electronAPI.nativeAudioInitialize(config);
        if (!initResult.success) {
          throw new Error(initResult.error || "Failed to initialize native audio");
        }
        this.nativeAudioInitialized = true;
      }

      // Start native audio capture
      const startResult = await window.electronAPI.nativeAudioStart();
      if (!startResult.success) {
        throw new Error(startResult.error || "Failed to start native audio");
      }

      this.useNativeAudio = true;
      this.nativeAudioCapturing = true;
      this.isRecording = true;
      this.recordingStartTime = Date.now();
      this.onStateChange?.({ isRecording: true, isProcessing: false });

      return true;
    } catch (error) {
      this.nativeAudioInitialized = false;
      this.nativeAudioCapturing = false;
      this.cachedWorkingDeviceId = null;
      this.isRecording = false;
      this.onStateChange?.({ isRecording: false, isProcessing: false });

      // Fallback to Web APIs
      return await this.startWebAPIRecording();
    }
  }

  /**
   * Start Web API recording (fallback)
   * Can optionally use the unified audio stream to avoid mic conflicts
   */
  async startWebAPIRecording() {
    let stream = null;

    // UNIFIED AUDIO MODE: Try to get stream from unified audio manager first
    try {
      const { getUnifiedAudioManager } = await import("../services/audioSystem.js");
      const unifiedManager = getUnifiedAudioManager();

      if (unifiedManager && unifiedManager.isActive()) {
        stream = unifiedManager.getMediaStream();
        if (!stream || !stream.active) {
          stream = null;
        }
      }
    } catch (err) {
      // Unified audio not available - will get our own stream
    }

    // FALLBACK: Get our own stream if unified not available
    if (!stream) {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true,
          sampleRate: 16000,
        },
      });
    }

    try {
      // Store stream for visualization (keep it alive during recording)
      this.mediaStream = stream;

      // Setup real-time audio visualization
      this.setupAudioVisualization(stream);

      // Create MediaRecorder with HIGH QUALITY settings for whispered speech
      // Higher bitrate preserves subtle audio details in quiet speech
      const options = {
        mimeType: "audio/webm;codecs=opus",
        audioBitsPerSecond: 64000, // 64 kbps - 4x higher for better whisper capture
      };

      // Try to use optimal codec, fallback to default if not supported
      let mediaRecorder;
      try {
        mediaRecorder = new MediaRecorder(stream, options);
      } catch (error) {
        // Fallback to default MediaRecorder if codec not supported
        mediaRecorder = new MediaRecorder(stream);
      }

      this.mediaRecorder = mediaRecorder;
      this.audioChunks = [];
      this.recordingStartTime = Date.now();

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = async () => {
        try {
          this.isRecording = false;
          this.isProcessing = true;
          this.onStateChange?.({ isRecording: false, isProcessing: true });

          // Check if we have valid audio chunks
          const validChunks = this.audioChunks.filter((chunk) => chunk && chunk.size > 0);
          if (validChunks.length === 0) {
            console.log("[AudioManager] ⚠️ No valid audio chunks to process");
            this.isProcessing = false;
            this.audioChunks = [];
            this.onStateChange?.({ isRecording: false, isProcessing: false });
            this.cleanupStream();
            return;
          }

          // Wispr Flow style: Create blob from chunks
          const audioBlob = new Blob(validChunks, { type: "audio/webm;codecs=opus" });
          this.audioChunks = [];

          // Minimum blob size check (corrupted blobs are typically very small)
          const MIN_BLOB_SIZE = 500; // bytes - minimum for valid webm with audio
          if (audioBlob.size < MIN_BLOB_SIZE) {
            console.log("[AudioManager] ⚠️ Audio blob too small:", audioBlob.size, "bytes");
            this.isProcessing = false;
            this.onStateChange?.({ isRecording: false, isProcessing: false });
            this.cleanupStream();
            return;
          }

          // Validate EBML header (webm files start with 0x1A 0x45 0xDF 0xA3)
          const headerBytes = new Uint8Array(await audioBlob.slice(0, 4).arrayBuffer());
          const isValidWebm =
            headerBytes[0] === 0x1a &&
            headerBytes[1] === 0x45 &&
            headerBytes[2] === 0xdf &&
            headerBytes[3] === 0xa3;
          if (!isValidWebm) {
            console.log("[AudioManager] ⚠️ Invalid webm header, blob may be corrupted");
            this.isProcessing = false;
            this.onStateChange?.({ isRecording: false, isProcessing: false });
            this.cleanupStream();
            return;
          }

          const durationSeconds = this.recordingStartTime
            ? (Date.now() - this.recordingStartTime) / 1000
            : null;
          this.recordingStartTime = null;

          // Minimum duration check
          const MIN_DURATION_SECONDS = 0.15;
          if (durationSeconds !== null && durationSeconds < MIN_DURATION_SECONDS) {
            console.log("[AudioManager] ⏭️ Recording too short:", durationSeconds, "s");
            this.isProcessing = false;
            this.onStateChange?.({ isRecording: false, isProcessing: false });
            this.cleanupStream();
            return;
          }

          // Process the audio (Wispr Flow style)
          await this.processAudio(audioBlob, { durationSeconds });

          // Clean up stream and visualization
          this.cleanupStream();
        } catch (error) {
          this.isProcessing = false;
          this.isRecording = false;
          this.onStateChange?.({ isRecording: false, isProcessing: false });
          this.onError?.({
            title: "Processing Error",
            description: `Failed to process recording: ${error.message}`,
          });
          // Clean up stream on error
          this.cleanupStream();
        }
      };

      this.mediaRecorder.onerror = (event) => {
        this.isRecording = false;
        this.isProcessing = false;
        this.onStateChange?.({ isRecording: false, isProcessing: false });
        this.onError?.({
          title: "Recording Error",
          description: "An error occurred during recording. Please try again.",
        });
        this.cleanupStream();
      };

      // Wispr Flow style: Start recording with 100ms intervals for live visualization
      this.mediaRecorder.start(100);
      this.isRecording = true;
      this.onStateChange?.({ isRecording: true, isProcessing: false });

      // Start real-time visualization
      this.startVisualization();

      return true;
    } catch (error) {
      // Reset state on error
      this.isRecording = false;
      this.isProcessing = false;
      this.onStateChange?.({ isRecording: false, isProcessing: false });

      // Provide standardized error messages
      let errorTitle = "Recording Error";
      let errorDescription = `Failed to access microphone: ${error.message}`;

      if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
        errorTitle = "Microphone Access Denied";
        errorDescription =
          "Please grant microphone permission in your system settings and try again.";
      } else if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
        errorTitle = "No Microphone Found";
        errorDescription = "No microphone was detected. Please connect a microphone and try again.";
      } else if (error.name === "NotReadableError" || error.name === "TrackStartError") {
        errorTitle = "Microphone In Use";
        errorDescription =
          "The microphone is being used by another application. Please close other apps and try again.";
      }

      this.onError?.({
        title: errorTitle,
        description: errorDescription,
      });
      return false;
    }
  }

  /**
   * Setup audio visualization using Web Audio API AnalyserNode
   * This provides real-time audio level data for waveform visualization
   */
  setupAudioVisualization(stream) {
    try {
      // Create or reuse AudioContext
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }

      // Create analyser node
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.8;

      // Connect microphone stream to analyser
      const source = this.audioContext.createMediaStreamSource(stream);
      source.connect(this.analyser);

      // Create buffer for frequency data
      const bufferLength = this.analyser.frequencyBinCount;
      this.dataArray = new Uint8Array(bufferLength);
    } catch (error) {
      // Don't fail recording if visualization fails
    }
  }

  /**
   * Start real-time audio level visualization
   * Continuously reads audio levels and calls the callback
   */
  startVisualization() {
    if (!this.analyser || !this.dataArray) {
      return;
    }

    const visualize = () => {
      if (!this.isRecording) {
        return;
      }

      // Get frequency data
      this.analyser.getByteFrequencyData(this.dataArray);

      // Calculate average volume (0-255 scale)
      let sum = 0;
      for (let i = 0; i < this.dataArray.length; i++) {
        sum += this.dataArray[i];
      }
      const average = sum / this.dataArray.length;

      // Also get time domain data for waveform
      const timeData = new Uint8Array(this.analyser.fftSize);
      this.analyser.getByteTimeDomainData(timeData);

      // Call callback with audio level and frequency data
      if (this.visualizationCallback) {
        this.visualizationCallback({
          level: average, // 0-255
          levelPercent: Math.floor((average / 255) * 100), // 0-100
          frequencies: this.dataArray, // Full frequency array
          timeData: timeData, // Time domain data for waveform
        });
      }

      // Continue animation
      this.visualizationAnimationFrame = requestAnimationFrame(visualize);
    };

    visualize();
  }

  /**
   * Stop visualization
   */
  stopVisualization() {
    if (this.visualizationAnimationFrame) {
      cancelAnimationFrame(this.visualizationAnimationFrame);
      this.visualizationAnimationFrame = null;
    }

    // Notify callback that visualization stopped
    if (this.visualizationCallback) {
      this.visualizationCallback({
        level: 0,
        levelPercent: 0,
        frequencies: null,
        timeData: null,
      });
    }
  }

  /**
   * Get current audio level (0-100)
   * Useful for quick level checks without continuous callbacks
   */
  getAudioLevel() {
    if (!this.analyser || !this.dataArray || !this.isRecording) {
      return 0;
    }

    this.analyser.getByteFrequencyData(this.dataArray);

    let sum = 0;
    for (let i = 0; i < this.dataArray.length; i++) {
      sum += this.dataArray[i];
    }

    return Math.floor((sum / this.dataArray.length / 255) * 100);
  }

  async processAudio(audioBlob, metadata = {}) {
    try {
      // Additional duration check using blob size as fallback
      const durationSeconds = metadata.durationSeconds;
      const MIN_DURATION_SECONDS = 0.15;

      if (durationSeconds !== null && durationSeconds < MIN_DURATION_SECONDS) {
        this.isProcessing = false;
        this.onStateChange?.({ isRecording: false, isProcessing: false });
        return;
      }

      // Validate audio blob
      if (!audioBlob || audioBlob.size === 0) {
        throw new Error("Invalid audio data");
      }

      // Wispr Flow style: Convert blob to arrayBuffer for transcription
      const arrayBuffer = await audioBlob.arrayBuffer();

      // Validate array buffer size (max 10MB)
      const MAX_AUDIO_SIZE = 10 * 1024 * 1024;
      if (arrayBuffer.byteLength > MAX_AUDIO_SIZE) {
        throw new Error("Audio file too large. Maximum size is 10MB.");
      }

      const result = await window.electronAPI?.transcribeCentrisAudio?.(arrayBuffer);

      if (!result) {
        throw new Error("Centris backend IPC handler not available");
      }

      // Handle "too short" errors gracefully
      if (!result.success && result.error && result.error.includes("too short")) {
        this.isProcessing = false;
        this.onStateChange?.({ isRecording: false, isProcessing: false });
        return;
      }

      if (result.success && result.text) {
        const transcribedText = result.text.trim();

        if (!transcribedText) {
          this.isProcessing = false;
          this.onStateChange?.({ isRecording: false, isProcessing: false });
          return;
        }

        // Check for mode switch commands
        const newMode = this.detectModeSwitch(transcribedText);
        if (newMode && newMode !== this.mode) {
          this.setMode(newMode);
          this.onTranscriptionComplete?.({
            success: true,
            text: `Switched to ${newMode} mode`,
            source: "centris-backend",
            modeSwitch: true,
          });
          return;
        }

        // Process based on current mode
        if (this.mode === "dictation") {
          try {
            const cleanedText = await this.cleanupDictationText(transcribedText);
            await this.safePaste(cleanedText);
            this.onTranscriptionComplete?.({
              success: true,
              text: cleanedText,
              originalText: transcribedText,
              source: "centris-backend",
              mode: "dictation",
            });
          } catch (cleanupError) {
            await this.safePaste(transcribedText);
            this.onTranscriptionComplete?.({
              success: true,
              text: transcribedText,
              source: "centris-backend",
              mode: "dictation",
              fallback: true,
            });
          }
        } else {
          await this.processActionMode(transcribedText, "centris-backend");
        }
      } else {
        throw new Error(result.error || "Transcription failed");
      }
    } catch (error) {
      if (error.message !== "No audio detected") {
        this.onError?.({
          title: "Transcription Error",
          description: error.message || "Failed to transcribe audio. Please try again.",
        });
      }
    } finally {
      this.isProcessing = false;
      this.onStateChange?.({ isRecording: false, isProcessing: false });
    }
  }

  async processWithLocalWhisper(audioBlob, model = "base", metadata = {}) {
    try {
      const arrayBuffer = await audioBlob.arrayBuffer();
      const language = localStorage.getItem("preferredLanguage");
      const options = { model };
      if (language && language !== "auto") {
        options.language = language;
      }

      const result = await window.electronAPI.transcribeLocalWhisper(arrayBuffer, options);

      if (result.success && result.text) {
        const transcribedText = result.text.trim();

        // Check for mode switch commands
        const newMode = this.detectModeSwitch(transcribedText);
        if (newMode && newMode !== this.mode) {
          this.setMode(newMode);
          this.onTranscriptionComplete?.({
            success: true,
            text: `Switched to ${newMode} mode`,
            source: "local",
            modeSwitch: true,
          });
          return {
            success: true,
            text: `Switched to ${newMode} mode`,
            source: "local",
            modeSwitch: true,
          };
        }

        // Process based on current mode
        if (this.mode === "dictation") {
          // Dictation mode: clean up text with LLM then paste
          const cleanedText = await this.cleanupDictationText(transcribedText);
          await this.safePaste(cleanedText);
          this.onTranscriptionComplete?.({
            success: true,
            text: cleanedText,
            originalText: transcribedText,
            source: "local",
            mode: "dictation",
          });
          return { success: true, text: cleanedText, source: "local" };
        } else {
          // Action mode
          await this.processActionMode(transcribedText, "local");
          const processedText = await this.processTranscription(transcribedText, "local");
          return { success: true, text: processedText || transcribedText, source: "local" };
        }
      } else if (result.success === false && result.message === "No audio detected") {
        this.onError?.({
          title: "No Audio Detected",
          description:
            "The recording contained no detectable audio. Please check your microphone settings.",
        });
        throw new Error("No audio detected");
      } else {
        throw new Error(result.error || "Local Whisper transcription failed");
      }
    } catch (error) {
      if (error.message === "No audio detected") {
        throw error;
      }

      const allowOpenAIFallback = localStorage.getItem("allowOpenAIFallback") === "true";
      const isLocalMode = localStorage.getItem("useLocalWhisper") === "true";

      if (allowOpenAIFallback && isLocalMode) {
        try {
          const fallbackResult = await this.processWithOpenAIAPI(audioBlob, metadata);
          return { ...fallbackResult, source: "openai-fallback" };
        } catch (fallbackError) {
          throw new Error(
            `Local Whisper failed: ${error.message}. OpenAI fallback also failed: ${fallbackError.message}`,
            { cause: fallbackError },
            { cause: error },
          );
        }
      } else {
        throw new Error(`Local Whisper failed: ${error.message}`, { cause: error });
      }
    }
  }

  async getAPIKey() {
    if (this.cachedApiKey) {
      return this.cachedApiKey;
    }

    let apiKey = await window.electronAPI.getOpenAIKey();
    if (!apiKey || apiKey.trim() === "" || apiKey === "your_openai_api_key_here") {
      apiKey = localStorage.getItem("openaiApiKey");
    }

    if (!apiKey || apiKey.trim() === "" || apiKey === "your_openai_api_key_here") {
      throw new Error(
        "OpenAI API key not found. Please set your API key in the .env file or Control Panel.",
      );
    }

    this.cachedApiKey = apiKey;
    return apiKey;
  }

  async optimizeAudio(audioBlob) {
    return new Promise((resolve) => {
      const audioContext = getAudioContext(); // Reuse shared AudioContext
      const reader = new FileReader();

      reader.onload = async () => {
        try {
          const arrayBuffer = reader.result;
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

          // Convert to 16kHz mono for smaller size and faster upload
          const sampleRate = 16000;
          const channels = 1;
          const length = Math.floor(audioBuffer.duration * sampleRate);
          const offlineContext = new OfflineAudioContext(channels, length, sampleRate);

          const source = offlineContext.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(offlineContext.destination);
          source.start();

          const renderedBuffer = await offlineContext.startRendering();
          const wavBlob = this.audioBufferToWav(renderedBuffer);
          resolve(wavBlob);
        } catch (error) {
          // If optimization fails, use original
          resolve(audioBlob);
        }
      };

      reader.onerror = () => resolve(audioBlob);
      reader.readAsArrayBuffer(audioBlob);
    });
  }

  audioBufferToWav(buffer) {
    const length = buffer.length;
    const arrayBuffer = new ArrayBuffer(44 + length * 2);
    const view = new DataView(arrayBuffer);
    const sampleRate = buffer.sampleRate;
    const channelData = buffer.getChannelData(0);

    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, "RIFF");
    view.setUint32(4, 36 + length * 2, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, length * 2, true);

    let offset = 44;
    for (let i = 0; i < length; i++) {
      const sample = Math.max(-1, Math.min(1, channelData[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }

    return new Blob([arrayBuffer], { type: "audio/wav" });
  }

  async processWithReasoningModel(text, model, agentName) {
    debugLogger.logReasoning("CALLING_REASONING_SERVICE", {
      model,
      agentName,
      textLength: text.length,
    });

    const startTime = Date.now();

    try {
      const result = await ReasoningService.processText(text, model, agentName);

      const processingTime = Date.now() - startTime;

      debugLogger.logReasoning("REASONING_SERVICE_COMPLETE", {
        model,
        processingTimeMs: processingTime,
        resultLength: result.length,
        success: true,
      });

      return result;
    } catch (error) {
      const processingTime = Date.now() - startTime;

      debugLogger.logReasoning("REASONING_SERVICE_ERROR", {
        model,
        processingTimeMs: processingTime,
        error: error.message,
        stack: error.stack,
      });

      throw error;
    }
  }

  async isReasoningAvailable() {
    if (typeof window === "undefined" || !window.localStorage) {
      return false;
    }

    const storedValue = localStorage.getItem("useReasoningModel");
    const now = Date.now();
    const cacheValid =
      this.reasoningAvailabilityCache &&
      now < this.reasoningAvailabilityCache.expiresAt &&
      this.cachedReasoningPreference === storedValue;

    if (cacheValid) {
      return this.reasoningAvailabilityCache.value;
    }

    debugLogger.logReasoning("REASONING_STORAGE_CHECK", {
      storedValue,
      typeOfStoredValue: typeof storedValue,
      isTrue: storedValue === "true",
      isTruthy: !!storedValue && storedValue !== "false",
    });

    const useReasoning = storedValue === "true" || (!!storedValue && storedValue !== "false");

    if (!useReasoning) {
      this.reasoningAvailabilityCache = {
        value: false,
        expiresAt: now + REASONING_CACHE_TTL,
      };
      this.cachedReasoningPreference = storedValue;
      return false;
    }

    try {
      const isAvailable = await ReasoningService.isAvailable();

      debugLogger.logReasoning("REASONING_AVAILABILITY", {
        isAvailable,
        reasoningEnabled: useReasoning,
        finalDecision: useReasoning && isAvailable,
      });

      this.reasoningAvailabilityCache = {
        value: isAvailable,
        expiresAt: now + REASONING_CACHE_TTL,
      };
      this.cachedReasoningPreference = storedValue;

      return isAvailable;
    } catch (error) {
      debugLogger.logReasoning("REASONING_AVAILABILITY_ERROR", {
        error: error.message,
        stack: error.stack,
      });

      this.reasoningAvailabilityCache = {
        value: false,
        expiresAt: now + REASONING_CACHE_TTL,
      };
      this.cachedReasoningPreference = storedValue;
      return false;
    }
  }

  async cleanupDictationText(text) {
    /**Clean up dictation text via backend (optimized for speed - 220+ WPM).
     *
     * Uses backend DictationService with GPT-4o-mini for instant cleanup.
     * Falls back to original text if backend is unavailable.
     */

    // Check if cleanup is enabled (default: true)
    const cleanupEnabled =
      typeof window !== "undefined" && window.localStorage
        ? localStorage.getItem("dictationCleanupEnabled") !== "false"
        : true;

    if (!cleanupEnabled) {
      return text; // Return raw transcription if cleanup disabled
    }

    try {
      // Use backend service for cleanup (optimized for speed)
      // Dynamic import - works with both ESM and CommonJS modules
      const module = await import("../services/centrisBackendService.js");
      const CentrisBackendService = module.default || module;
      const backendService = new CentrisBackendService();

      // Check if backend is available
      const isHealthy = await backendService.checkHealth();
      if (!isHealthy) {
        console.warn("[AudioManager] Backend not healthy, skipping cleanup");
        // Fallback to original text if backend unavailable
        return text;
      }

      // Call backend dictation cleanup endpoint
      const result = await backendService.cleanupDictationText(text, "dictation");

      if (result.success && result.cleanedText) {
        return result.cleanedText;
      } else {
        // Backend returned fallback text or failed - use fallback
        return result.cleanedText || text; // Use fallback cleaned text or original
      }
    } catch (error) {
      console.warn("[AudioManager] Cleanup error, using original text:", error.message);
      // Return original text if cleanup fails
      return text;
    }
  }

  normalizeRuntimeUrl(candidate) {
    if (!candidate || typeof candidate !== "string") {
      return null;
    }
    const trimmed = candidate.trim();
    if (!trimmed) {
      return null;
    }
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }
    if (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(trimmed)) {
      return `https://${trimmed}`;
    }
    return null;
  }

  parseDeterministicRuntimeIntent(text) {
    const normalized = (text || "").trim().toLowerCase();
    if (!normalized) {
      return null;
    }

    const runRouteMatch = normalized.match(/^(?:run|execute)\s+route\s+([a-z0-9._:-]+)$/i);
    if (runRouteMatch) {
      return {
        kind: "route.run",
        params: { routeId: runRouteMatch[1] },
        description: `run route ${runRouteMatch[1]}`,
      };
    }

    const recordStartMatch = normalized.match(
      /^(?:start|begin)\s+(?:route\s+)?record(?:ing)?(?:\s+(?:for|intent)\s+(.+))?$/i,
    );
    if (recordStartMatch) {
      const intent = (recordStartMatch[1] || "").trim() || "voice.runtime";
      return {
        kind: "route.record.start",
        params: { intent },
        description: `start route recording (${intent})`,
      };
    }

    if (/^(?:stop|end)\s+(?:route\s+)?record(?:ing)?$/i.test(normalized)) {
      return {
        kind: "route.record.stop",
        params: {},
        description: "stop route recording",
      };
    }

    if (/^(?:observe|snapshot|scan)(?:\s+(?:runtime|browser|page))?$/i.test(normalized)) {
      return {
        kind: "observe",
        params: { instruction: text },
        description: "observe runtime",
      };
    }

    const navigateMatch = normalized.match(
      /^(?:go to|navigate to|open)\s+([a-z0-9./:_-]+\.[a-z]{2,}(?:\/\S*)?|https?:\/\/\S+)$/i,
    );
    if (navigateMatch) {
      const url = this.normalizeRuntimeUrl(navigateMatch[1]);
      if (url) {
        return {
          kind: "act",
          params: { kind: "navigate", value: url },
          description: `navigate to ${url}`,
        };
      }
    }

    const pressMatch = normalized.match(/^(?:press|hit)\s+(enter|tab|escape|esc)$/i);
    if (pressMatch) {
      const key = pressMatch[1].toLowerCase() === "esc" ? "Escape" : pressMatch[1];
      return {
        kind: "act",
        params: { kind: "press", value: key },
        description: `press ${key}`,
      };
    }

    const scrollMatch = normalized.match(/^scroll\s+(up|down)$/i);
    if (scrollMatch) {
      return {
        kind: "act",
        params: { kind: "scroll", value: scrollMatch[1].toLowerCase() },
        description: `scroll ${scrollMatch[1].toLowerCase()}`,
      };
    }

    return null;
  }

  async tryDeterministicRuntimeAction(text) {
    if (!window.electronAPI) {
      return { handled: false, success: false };
    }

    const intent = this.parseDeterministicRuntimeIntent(text);
    if (!intent) {
      return { handled: false, success: false };
    }

    try {
      let response = null;
      if (intent.kind === "observe" && window.electronAPI.observeRuntime) {
        response = await window.electronAPI.observeRuntime(intent.params);
      } else if (intent.kind === "route.run" && window.electronAPI.routeRunRuntime) {
        response = await window.electronAPI.routeRunRuntime(intent.params);
      } else if (intent.kind === "route.record.start" && window.electronAPI.routeRecordStart) {
        response = await window.electronAPI.routeRecordStart(intent.params);
      } else if (intent.kind === "route.record.stop" && window.electronAPI.routeRecordStop) {
        response = await window.electronAPI.routeRecordStop(intent.params);
      } else if (intent.kind === "act" && window.electronAPI.actRuntime) {
        response = await window.electronAPI.actRuntime(intent.params);
      } else if (window.electronAPI.actionApiCall) {
        response = await window.electronAPI.actionApiCall(intent.kind, intent.params);
      } else {
        return { handled: false, success: false };
      }

      if (response?.ok) {
        return {
          handled: true,
          success: true,
          response,
          description: intent.description,
        };
      }

      return {
        handled: true,
        success: false,
        error: response?.error?.message || "runtime authority request failed",
      };
    } catch (error) {
      return {
        handled: true,
        success: false,
        error: error?.message || "runtime authority request failed",
      };
    }
  }

  async processActionMode(text, source) {
    // Action mode: process intent and execute actions via backend
    // CRITICAL: NO fallback to pasting - action mode should execute commands, not paste text
    // If something fails, show an error. User can switch to dictation mode if they want to paste.
    try {
      // Prefer deterministic runtime authority commands first.
      // If this path succeeds, we avoid an LLM round-trip entirely.
      const deterministic = await this.tryDeterministicRuntimeAction(text);
      if (deterministic.handled && deterministic.success) {
        this.onTranscriptionComplete?.({
          success: true,
          text: text,
          source: "runtime-authority",
          mode: "action",
          executed: true,
          result: deterministic.response?.result ?? deterministic.response,
        });
        return;
      }

      // Dynamic import - works with both ESM and CommonJS modules
      const module = await import("../services/centrisBackendService.js");
      const CentrisBackendService = module.default || module;
      const backendService = new CentrisBackendService();

      // Check if backend is available
      const isHealthy = await backendService.checkHealth();
      if (!isHealthy) {
        // Backend unavailable - show error, DO NOT paste
        console.error("[AudioManager] ❌ Backend not available for action mode");
        this.onError?.({
          title: "Backend Unavailable",
          description:
            "Cannot execute action - backend is not running. Try switching to dictation mode to paste text.",
        });
        this.onTranscriptionComplete?.({
          success: false,
          text: text,
          source: source,
          mode: "action",
          error: "Backend unavailable",
        });
        return;
      }

      // Get monitor context for monitor-aware actions
      // This allows the AI to understand commands like "open files on monitor 1"
      let monitorContext = null;
      try {
        if (window.electronAPI?.getCursorDisplayInfo) {
          const displayInfo = await window.electronAPI.getCursorDisplayInfo();
          monitorContext = {
            currentDisplay: displayInfo.currentDisplay,
            allDisplays: displayInfo.allDisplays,
            displayCount: displayInfo.displayCount,
            cursorPosition: displayInfo.cursorPosition,
          };
          console.log("[AudioManager] 📺 Monitor context:", {
            displayCount: monitorContext.displayCount,
            currentDisplay:
              monitorContext.currentDisplay.number || monitorContext.currentDisplay.index + 1,
          });
        }
      } catch (error) {
        console.warn("[AudioManager] ⚠️ Could not get monitor context:", error);
        // Continue without monitor context - backend will work without it
      }

      // Send to backend for task execution with monitor context
      const result = await backendService.executeTask(text, monitorContext);

      if (result.success) {
        // Backend executed the task
        // The backend should handle pasting/actions internally
        this.onTranscriptionComplete?.({
          success: true,
          text: result.data?.response || text,
          source: "centris-backend",
          mode: "action",
          executed: true,
          result: result.data,
        });
      } else {
        // Task execution failed - show error, DO NOT paste
        console.error("[AudioManager] ❌ Action execution failed:", result.error);
        this.onError?.({
          title: "Action Failed",
          description:
            result.error || "Failed to execute action. Try again or switch to dictation mode.",
        });
        this.onTranscriptionComplete?.({
          success: false,
          text: text,
          source: source,
          mode: "action",
          error: result.error,
        });
      }
    } catch (error) {
      // Exception occurred - show error, DO NOT paste
      console.error("[AudioManager] ❌ Action mode error:", error);
      this.onError?.({
        title: "Action Error",
        description:
          error.message || "Failed to execute action. Try again or switch to dictation mode.",
      });
      this.onTranscriptionComplete?.({
        success: false,
        text: text,
        source: source,
        mode: "action",
        error: error.message,
      });
    }
  }

  async processTranscription(text, source) {
    const normalizedText = typeof text === "string" ? text.trim() : "";

    debugLogger.logReasoning("TRANSCRIPTION_RECEIVED", {
      source,
      textLength: normalizedText.length,
      textPreview: normalizedText.substring(0, 100) + (normalizedText.length > 100 ? "..." : ""),
      timestamp: new Date().toISOString(),
    });

    const reasoningModel =
      typeof window !== "undefined" && window.localStorage
        ? localStorage.getItem("reasoningModel") || "gpt-4o-mini"
        : "gpt-4o-mini";
    const reasoningProvider =
      typeof window !== "undefined" && window.localStorage
        ? localStorage.getItem("reasoningProvider") || "auto"
        : "auto";
    const agentName =
      typeof window !== "undefined" && window.localStorage
        ? localStorage.getItem("agentName") || null
        : null;
    const useReasoning = await this.isReasoningAvailable();

    debugLogger.logReasoning("REASONING_CHECK", {
      useReasoning,
      reasoningModel,
      reasoningProvider,
      agentName,
    });

    if (useReasoning) {
      try {
        const preparedText = normalizedText;

        debugLogger.logReasoning("SENDING_TO_REASONING", {
          preparedTextLength: preparedText.length,
          model: reasoningModel,
          provider: reasoningProvider,
        });

        const result = await this.processWithReasoningModel(
          preparedText,
          reasoningModel,
          agentName,
        );

        debugLogger.logReasoning("REASONING_SUCCESS", {
          resultLength: result.length,
          resultPreview: result.substring(0, 100) + (result.length > 100 ? "..." : ""),
          processingTime: new Date().toISOString(),
        });

        return result;
      } catch (error) {
        debugLogger.logReasoning("REASONING_FAILED", {
          error: error.message,
          stack: error.stack,
          fallbackToCleanup: true,
        });
      }
    }

    debugLogger.logReasoning("USING_STANDARD_CLEANUP", {
      reason: useReasoning ? "Reasoning failed" : "Reasoning not enabled",
    });

    return normalizedText;
  }

  async processWithOpenAIAPI(audioBlob, metadata = {}) {
    const language = localStorage.getItem("preferredLanguage");
    const allowLocalFallback = localStorage.getItem("allowLocalFallback") === "true";
    const fallbackModel = localStorage.getItem("fallbackWhisperModel") || "base";

    try {
      const durationSeconds = metadata.durationSeconds ?? null;
      const shouldSkipOptimizationForDuration =
        typeof durationSeconds === "number" &&
        durationSeconds > 0 &&
        durationSeconds < SHORT_CLIP_DURATION_SECONDS;

      const shouldOptimize = !shouldSkipOptimizationForDuration && audioBlob.size > 1024 * 1024;

      const [apiKey, optimizedAudio] = await Promise.all([
        this.getAPIKey(),
        shouldOptimize ? this.optimizeAudio(audioBlob) : Promise.resolve(audioBlob),
      ]);

      const formData = new FormData();
      formData.append("file", optimizedAudio, "audio.wav");
      formData.append("model", "whisper-1");

      if (language && language !== "auto") {
        formData.append("language", language);
      }

      const response = await fetch(this.getTranscriptionEndpoint(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error: ${response.status} ${errorText}`);
      }

      const result = await response.json();

      if (result.text) {
        const transcribedText = result.text.trim();

        // Check for mode switch commands
        const newMode = this.detectModeSwitch(transcribedText);
        if (newMode && newMode !== this.mode) {
          this.setMode(newMode);
          this.onTranscriptionComplete?.({
            success: true,
            text: `Switched to ${newMode} mode`,
            source: "openai",
            modeSwitch: true,
          });
          return {
            success: true,
            text: `Switched to ${newMode} mode`,
            source: "openai",
            modeSwitch: true,
          };
        }

        // Process based on current mode
        if (this.mode === "dictation") {
          // Dictation mode: clean up text with LLM then paste
          const cleanedText = await this.cleanupDictationText(transcribedText);
          await this.safePaste(cleanedText);
          this.onTranscriptionComplete?.({
            success: true,
            text: cleanedText,
            originalText: transcribedText,
            source: "openai",
            mode: "dictation",
          });
          return { success: true, text: cleanedText, source: "openai" };
        } else {
          // Action mode
          await this.processActionMode(transcribedText, "openai");
          const text = await this.processTranscription(transcribedText, "openai");
          const source = (await this.isReasoningAvailable()) ? "openai-reasoned" : "openai";
          return { success: true, text, source };
        }
      } else {
        throw new Error("No text transcribed");
      }
    } catch (error) {
      const isOpenAIMode = localStorage.getItem("useLocalWhisper") !== "true";

      if (allowLocalFallback && isOpenAIMode) {
        try {
          const arrayBuffer = await audioBlob.arrayBuffer();
          const options = { model: fallbackModel };
          if (language && language !== "auto") {
            options.language = language;
          }

          const result = await window.electronAPI.transcribeLocalWhisper(arrayBuffer, options);

          if (result.success && result.text) {
            const transcribedText = result.text.trim();

            // Check for mode switch commands
            const newMode = this.detectModeSwitch(transcribedText);
            if (newMode && newMode !== this.mode) {
              this.setMode(newMode);
              this.onTranscriptionComplete?.({
                success: true,
                text: `Switched to ${newMode} mode`,
                source: "local-fallback",
                modeSwitch: true,
              });
              return {
                success: true,
                text: `Switched to ${newMode} mode`,
                source: "local-fallback",
                modeSwitch: true,
              };
            }

            // Process based on current mode
            if (this.mode === "dictation") {
              // Dictation mode: clean up text with LLM then paste
              const cleanedText = await this.cleanupDictationText(transcribedText);
              await this.safePaste(cleanedText);
              this.onTranscriptionComplete?.({
                success: true,
                text: cleanedText,
                originalText: transcribedText,
                source: "local-fallback",
                mode: "dictation",
              });
              return { success: true, text: cleanedText, source: "local-fallback" };
            } else {
              // Action mode
              await this.processActionMode(transcribedText, "local-fallback");
              const text = await this.processTranscription(transcribedText, "local-fallback");
              if (text) {
                return { success: true, text, source: "local-fallback" };
              }
            }
          }
          throw error;
        } catch (fallbackError) {
          throw new Error(
            `OpenAI API failed: ${error.message}. Local fallback also failed: ${fallbackError.message}`,
            { cause: error },
            { cause: fallbackError },
          );
        }
      }

      throw error;
    }
  }

  getTranscriptionEndpoint() {
    if (this.cachedTranscriptionEndpoint) {
      return this.cachedTranscriptionEndpoint;
    }

    try {
      const stored =
        typeof localStorage !== "undefined"
          ? localStorage.getItem("cloudTranscriptionBaseUrl") || ""
          : "";
      const trimmed = stored.trim();
      const base = trimmed ? trimmed : API_ENDPOINTS.TRANSCRIPTION_BASE;
      const normalizedBase = normalizeBaseUrl(base);

      if (!normalizedBase) {
        this.cachedTranscriptionEndpoint = API_ENDPOINTS.TRANSCRIPTION;
        return API_ENDPOINTS.TRANSCRIPTION;
      }

      const isLocalhost =
        normalizedBase.includes("://localhost") || normalizedBase.includes("://127.0.0.1");
      if (!normalizedBase.startsWith("https://") && !isLocalhost) {
        // Non-HTTPS endpoint rejected for security - using default
        this.cachedTranscriptionEndpoint = API_ENDPOINTS.TRANSCRIPTION;
        return API_ENDPOINTS.TRANSCRIPTION;
      }

      let endpoint;
      if (/\/audio\/(transcriptions|translations)$/i.test(normalizedBase)) {
        endpoint = normalizedBase;
      } else {
        endpoint = buildApiUrl(normalizedBase, "/audio/transcriptions");
      }

      this.cachedTranscriptionEndpoint = endpoint;
      return endpoint;
    } catch (error) {
      // Fallback to default endpoint on error
      this.cachedTranscriptionEndpoint = API_ENDPOINTS.TRANSCRIPTION;
      return API_ENDPOINTS.TRANSCRIPTION;
    }
  }

  async safePaste(text) {
    try {
      // Restore focus to the original text field before pasting
      if (window.electronAPI?.restoreFocus) {
        try {
          const focusResult = await window.electronAPI.restoreFocus();
          if (focusResult?.restored) {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        } catch (restoreError) {
          // Continue anyway - paste to current focus
        }
      }

      // Use simple clipboard + Cmd+V paste
      await window.electronAPI.pasteText(text);

      // Clear stored focus after successful paste
      this.clearStoredFocus();

      return true;
    } catch (error) {
      this.onError?.({
        title: "Paste Error",
        description: "Failed to paste text. Please check accessibility permissions.",
      });

      this.clearStoredFocus();
      return false;
    }
  }

  /**
   * Clear the stored focus target
   * Called after text injection to prevent stale focus data
   */
  clearStoredFocus() {
    if (window.electronAPI?.clearFocus) {
      window.electronAPI.clearFocus().catch(() => {
        // Ignore clear errors
      });
    }
  }

  async saveTranscription(text) {
    try {
      if (!text || typeof text !== "string" || text.trim().length === 0) {
        return false;
      }

      // Save via IPC to main process database
      if (window.electronAPI?.saveTranscription) {
        await window.electronAPI.saveTranscription(text);
        return true;
      }
      return false;
    } catch (error) {
      // Silent fail - don't interrupt user flow if saving fails
      return false;
    }
  }

  getState() {
    return {
      isRecording: this.isRecording,
      isProcessing: this.isProcessing,
    };
  }

  /**
   * Stop recording (handles both native audio and Web API)
   * This is the main entry point for stopping - called on globe key release
   */
  stopRecording() {
    // RACE CONDITION FIX: Handle case where stop is called during startup
    if (this.isStarting) {
      this.shouldAbortStart = true;
      this.isStarting = false;
      this.onStateChange?.({ isRecording: false, isProcessing: false });
      return true;
    }

    // CRITICAL: Handle native audio first
    if (this.useNativeAudio && this.nativeAudioCapturing) {
      this.stopNativeAudioRecording();
      return true;
    }

    // Handle Web API recording
    if (this.mediaRecorder && this.isRecording) {
      try {
        this.mediaRecorder.stop();
        this.isRecording = false;
        this.onStateChange?.({ isRecording: false, isProcessing: this.isProcessing });
        this.stopVisualization();
        return true;
      } catch (error) {
        // Continue to fallback
      }
    }

    // Fallback: Force state update even if no recorder is active
    if (this.isRecording) {
      this.isRecording = false;
      this.onStateChange?.({ isRecording: false, isProcessing: false });
      this.stopVisualization();
      return true;
    }

    return false;
  }

  /**
   * Stop native audio recording
   */
  async stopNativeAudioRecording() {
    // CRITICAL: Update state IMMEDIATELY before async call
    const wasRecording = this.isRecording;
    this.nativeAudioCapturing = false;
    this.isRecording = false;

    // Notify state change immediately so UI updates
    if (wasRecording) {
      this.onStateChange?.({ isRecording: false, isProcessing: false });
    }

    // Now stop the native audio (this can be async)
    if (window.electronAPI?.nativeAudioStop) {
      try {
        await window.electronAPI.nativeAudioStop();
      } catch (error) {
        // State already updated above
      }
    }
  }

  /**
   * Clean up media stream and audio context
   */
  cleanupStream() {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    // Note: We don't close audioContext here as it might be reused
    // Only disconnect analyser if it exists
    if (this.analyser) {
      try {
        this.analyser.disconnect();
      } catch (e) {
        // Ignore disconnect errors
      }
      this.analyser = null;
    }

    this.dataArray = null;
  }

  cleanup() {
    // Clear stored focus
    this.clearStoredFocus();

    // RACE CONDITION FIX: Reset starting state on cleanup
    this.isStarting = false;
    this.shouldAbortStart = false;

    // Stop native audio if using it
    if (this.useNativeAudio && this.nativeAudioCapturing) {
      this.stopNativeAudioRecording();
    }

    // Shutdown native audio
    if (this.nativeAudioInitialized && window.electronAPI?.nativeAudioShutdown) {
      window.electronAPI.nativeAudioShutdown().catch(() => {
        // Ignore shutdown errors
      });
      this.nativeAudioInitialized = false;
    }

    // Cleanup native audio listeners
    this.cleanupNativeAudioListeners();

    // Stop Web API recording
    if (this.mediaRecorder && this.isRecording) {
      this.stopRecording();
    }

    // Stop visualization
    this.stopVisualization();

    // Clean up stream
    this.cleanupStream();

    // Close audio context if it exists
    if (this.audioContext && this.audioContext.state !== "closed") {
      this.audioContext.close().catch(() => {
        // Ignore close errors
      });
      this.audioContext = null;
    }

    this.onStateChange = null;
    this.onError = null;
    this.onTranscriptionComplete = null;
    this.visualizationCallback = null;
  }
}

export default AudioManager;
