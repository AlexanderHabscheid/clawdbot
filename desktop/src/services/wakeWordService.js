/**
 * Wake Word Detection Service for Centris AI
 *
 * OPTIONAL FEATURE - Globe/Fn key is the primary activation method.
 *
 * HYBRID ARCHITECTURE (January 2026):
 * 1. PRIMARY: OpenWakeWord (ONNX) - 100% OFFLINE, FREE, no API costs
 * 2. FALLBACK: Web Speech API - Requires internet (Google servers)
 *
 * OpenWakeWord Benefits:
 * - 100% offline - works without internet
 * - 100% free - Apache 2.0 license, no API costs
 * - Custom wake words - train "Hey Centris" via Google Colab
 * - Fast - ~80ms inference per frame
 *
 * Design Principles:
 * - Offline first: Try OpenWakeWord before Web Speech API
 * - Silent failure: Network issues don't spam errors (Globe key still works)
 * - Optional by default: User must explicitly enable in Preferences
 * - Graceful degradation: Falls back silently when unavailable
 * - Minimal logging: Only critical info, no verbose debug spam
 */

// Import ONNX Runtime for offline wake word detection
let ort = null;
try {
  ort = require("onnxruntime-web");
} catch (err) {
  // Silent - Web Speech API will be used as fallback
}

class WakeWordService {
  constructor() {
    // ========== OFFLINE MODE (OpenWakeWord) ==========
    this.useOfflineMode = false; // Will be set true if model loads successfully
    this.onnxSession = null;
    this.melSession = null;
    this.embeddingSession = null;
    this.audioContext = null;
    this.audioWorklet = null;
    this.mediaStream = null;

    // Audio processing buffers for OpenWakeWord
    this.frameSize = 1280; // 80ms at 16kHz
    this.audioBuffer = new Float32Array(this.frameSize);
    this.bufferIndex = 0;
    this.melBuffer = []; // Rolling buffer for mel spectrograms
    this.embeddingBuffer = []; // Rolling buffer for embeddings
    this.offlineThreshold = 0.5; // Detection threshold for ONNX model

    // ========== ONLINE MODE (Web Speech API) ==========
    this.recognition = null;
    this.isListening = false;
    this.isEnabled = false;
    this.isPaused = false;
    this.onWakeWordDetected = null;
    this.onError = null;
    this.onStatusChange = null;

    // Wake phrases to listen for (case-insensitive matching) - for Web Speech API fallback
    // EXPANDED: Include many variations of how speech recognition might hear "Hey Centris"
    this.wakePhrases = [
      // Primary phrases
      "hey centris",
      "hey sentris",
      "hey census",
      "hey centres",
      "hey center",
      "hey central",
      "hey centric",
      "hey sentry",
      "hey century",
      "hey centre",
      "hey send",
      "hey sent",
      // OK variations
      "ok centris",
      "okay centris",
      "ok sentris",
      "okay sentris",
      // Misheard variations
      "a centris",
      "a sentris",
      "ace centris",
      "hey sensors",
      "hey census",
      "hey centriс",
      "hey centrist",
      // Short forms (may be heard without "hey")
      "centris",
      "sentris",
    ];

    // LOWERED: More permissive threshold for better detection
    // Web Speech API confidence can be low even for correct matches
    this.confidenceThreshold = 0.3;
    this.restartDelay = 100; // FASTER restart for better responsiveness

    // Restart tracking - MORE RESILIENT
    this.restartAttempts = 0;
    this.maxRestartAttempts = 15; // INCREASED - try harder before giving up
    this.restartResetTimeout = null;
    this.scheduledRestartTimeout = null;

    // Network error handling - MORE TOLERANT
    this.consecutiveNetworkErrors = 0;
    this.maxConsecutiveNetworkErrors = 10; // INCREASED - tolerate more errors before giving up
    this.networkErrorBackoff = 3000; // REDUCED - 3s backoff (was 10s)
    this.networkErrorTimeout = null;
    this.networkSuccessResetTimeout = null;
    this.isNetworkUnavailable = false;
    this.isInNetworkBackoff = false;
    this.silentMode = true; // Don't spam console with errors

    // Auto-recovery timer - periodically try to reconnect
    this.autoRecoveryInterval = null;

    // Check if SpeechRecognition is available
    this.speechRecognitionAvailable = this.checkAvailability();

    // Try to initialize offline mode
    this.initializeOfflineMode();
  }

  /**
   * Initialize OpenWakeWord offline mode
   * Loads ONNX models for 100% offline wake word detection
   */
  async initializeOfflineMode() {
    if (!ort) {
      return false;
    }

    try {
      // Get model path from Electron or use default
      let modelPath = "/models/hey_centris.onnx";

      if (window.electronAPI?.getResourcePath) {
        try {
          modelPath = await window.electronAPI.getResourcePath("models/hey_centris.onnx");
        } catch (e) {
          // Use default path
        }
      }

      // Check if model file exists
      try {
        const response = await fetch(modelPath, { method: "HEAD" });
        if (!response.ok) {
          return false;
        }
      } catch (e) {
        return false;
      }

      // Load the ONNX model with WebGPU or WASM backend
      this.onnxSession = await ort.InferenceSession.create(modelPath, {
        executionProviders: ["webgpu", "wasm"],
        graphOptimizationLevel: "all",
      });

      this.useOfflineMode = true;
      return true;
    } catch (err) {
      this.useOfflineMode = false;
      return false;
    }
  }

  /**
   * Connect to Unified Audio Manager (simplified - just track state)
   */
  connectToUnifiedAudio(unifiedAudioManager) {
    return true;
  }

  /**
   * Disconnect from Unified Audio Manager
   */
  disconnectFromUnifiedAudio() {
    // No-op
  }

  /**
   * Check if Web Speech API is available
   */
  checkAvailability() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    return !!SpeechRecognition;
  }

  /**
   * Check network connectivity before starting
   */
  async checkNetworkConnectivity() {
    if (!navigator.onLine) {
      return false;
    }
    // Quick DNS check - if this fails, Web Speech API will too
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      await fetch("https://www.google.com/generate_204", {
        method: "HEAD",
        mode: "no-cors",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Log helper - respects silent mode
   */
  log(message, level = "info") {
    if (this.silentMode && level !== "error") {
      return;
    }
    const prefix = "[WakeWord]";
    if (level === "error") {
      console.error(prefix, message);
    } else {
      console.log(prefix, message);
    }
  }

  /**
   * Initialize the speech recognition engine
   */
  initialize() {
    if (!this.speechRecognitionAvailable) {
      return false;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.recognition = new SpeechRecognition();

    // Configure for continuous wake word detection
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = "en-US";
    this.recognition.maxAlternatives = 3;

    // Set up event handlers
    this.recognition.onstart = () => {
      this.isListening = true;
      this.restartAttempts = 0;
      this.isNetworkUnavailable = false;
      this.onStatusChange?.({ isListening: true, status: "listening" });

      // Reset network error counter after sustained success
      if (this.networkSuccessResetTimeout) {
        clearTimeout(this.networkSuccessResetTimeout);
      }
      this.networkSuccessResetTimeout = setTimeout(() => {
        if (this.isListening && !this.isNetworkUnavailable) {
          this.consecutiveNetworkErrors = 0;
        }
      }, 10000);
    };

    this.recognition.onend = () => {
      this.isListening = false;

      if (this.isPaused) {
        this.onStatusChange?.({ isListening: false, status: "paused" });
        return;
      }

      if (this.isInNetworkBackoff) {
        this.onStatusChange?.({ isListening: false, status: "network_backoff" });
        return;
      }

      if (this.isEnabled) {
        this.scheduleRestart();
      } else {
        this.onStatusChange?.({ isListening: false, status: "stopped" });
      }
    };

    this.recognition.onerror = (event) => {
      // Cancel success reset timer
      if (this.networkSuccessResetTimeout) {
        clearTimeout(this.networkSuccessResetTimeout);
        this.networkSuccessResetTimeout = null;
      }

      // Handle specific errors - SILENTLY for network issues
      switch (event.error) {
        case "no-speech":
          // Normal - no speech detected, will restart
          break;
        case "audio-capture":
          this.onError?.({
            code: "AUDIO_CAPTURE_ERROR",
            message: "Microphone not available for wake word detection",
          });
          this.isEnabled = false;
          break;
        case "not-allowed":
          this.onError?.({
            code: "PERMISSION_DENIED",
            message: "Microphone permission required for wake word detection",
          });
          this.isEnabled = false;
          break;
        case "network":
          // SILENT HANDLING - don't spam errors, Globe key still works
          this.consecutiveNetworkErrors++;
          this.isInNetworkBackoff = true;

          if (this.consecutiveNetworkErrors >= this.maxConsecutiveNetworkErrors) {
            // Stop silently - user doesn't need to know, Globe key works
            this.isNetworkUnavailable = true;
            this.isInNetworkBackoff = false;
            this.isEnabled = false;
            // Only notify once, silently
            this.onError?.({
              code: "NETWORK_UNAVAILABLE",
              message: "Wake word unavailable (no internet). Use Globe key instead.",
            });
            this.onStatusChange?.({ isListening: false, status: "network_error" });
            return;
          }

          // Silent backoff retry
          if (this.networkErrorTimeout) {
            clearTimeout(this.networkErrorTimeout);
          }

          const backoffDelay = this.networkErrorBackoff * this.consecutiveNetworkErrors;
          this.networkErrorTimeout = setTimeout(() => {
            this.isInNetworkBackoff = false;
            if (this.isEnabled && !this.isNetworkUnavailable && !this.isPaused) {
              this.startRecognition();
            }
          }, backoffDelay);
          break;
        case "aborted":
          // Normal - recognition was aborted
          break;
        default:
          // Other errors - still silent
          break;
      }
    };

    this.recognition.onresult = (event) => {
      this.processResults(event.results);
    };

    return true;
  }

  /**
   * Check if a word sounds like "centris" using simple phonetic matching
   * This catches many speech recognition variations
   */
  soundsLikeCentris(word) {
    if (!word || word.length < 4) {
      return false;
    }

    // Common patterns that indicate "centris"
    const centrisPatterns = [
      /^cent/i, // starts with "cent"
      /^sent/i, // starts with "sent" (common mishearing)
      /^cen[st]/i, // "cens", "cent"
      /tris$/i, // ends with "tris"
      /trus$/i, // ends with "trus"
      /tres$/i, // ends with "tres"
      /tress$/i, // ends with "tress"
      /ntri/i, // contains "ntri"
      /ntr[iy]/i, // contains "ntry" or "ntri"
    ];

    return centrisPatterns.some((pattern) => pattern.test(word));
  }

  /**
   * Check if transcript contains wake word pattern
   * More flexible than exact phrase matching
   */
  containsWakePattern(transcript) {
    const words = transcript.split(/\s+/);

    // Look for "hey/ok/okay" followed by anything that sounds like "centris"
    for (let i = 0; i < words.length - 1; i++) {
      const trigger = words[i].toLowerCase();
      const target = words[i + 1].toLowerCase();

      if (["hey", "ok", "okay", "a", "ace", "ay", "eh"].includes(trigger)) {
        if (this.soundsLikeCentris(target)) {
          return true;
        }
      }
    }

    // Also check if just "centris" alone is heard (without trigger word)
    for (const word of words) {
      // Exact or very close matches to "centris"/"sentris"
      if (["centris", "sentris", "centres", "census"].includes(word.toLowerCase())) {
        return true;
      }
    }

    return false;
  }

  /**
   * Process speech recognition results
   */
  processResults(results) {
    // Check all results (including interim) for wake word
    for (let i = 0; i < results.length; i++) {
      const result = results[i];

      // Check each alternative interpretation
      for (let j = 0; j < result.length; j++) {
        const alternative = result[j];
        const transcript = alternative.transcript.toLowerCase().trim();
        const confidence = alternative.confidence;

        // METHOD 1: Check exact phrase matches from our list
        for (const phrase of this.wakePhrases) {
          if (transcript.includes(phrase)) {
            // Only trigger if confidence is high enough or it's a final result
            if (confidence >= this.confidenceThreshold || result.isFinal) {
              this.handleWakeWordDetected(transcript, confidence);
              return;
            }
          }
        }

        // METHOD 2: Fuzzy phonetic matching for variations we didn't list
        if (this.containsWakePattern(transcript)) {
          if (confidence >= this.confidenceThreshold || result.isFinal) {
            this.handleWakeWordDetected(transcript, confidence);
            return;
          }
        }
      }
    }
  }

  /**
   * Handle wake word detection
   */
  handleWakeWordDetected(transcript, confidence) {
    // Temporarily stop listening while dictation is active
    this.stop();

    // Notify listeners
    this.onWakeWordDetected?.({
      transcript,
      confidence,
      timestamp: Date.now(),
    });

    // Update status
    this.onStatusChange?.({
      isListening: false,
      status: "triggered",
      lastWakeWord: transcript,
    });
  }

  /**
   * Schedule a restart of the recognition service
   */
  scheduleRestart() {
    // Don't restart if network is unavailable or paused
    if (this.isNetworkUnavailable || this.isPaused) {
      return;
    }

    // Cancel any previously scheduled restart
    if (this.scheduledRestartTimeout) {
      clearTimeout(this.scheduledRestartTimeout);
      this.scheduledRestartTimeout = null;
    }

    this.restartAttempts++;

    if (this.restartAttempts > this.maxRestartAttempts) {
      // Wait longer before trying again
      this.scheduledRestartTimeout = setTimeout(() => {
        this.restartAttempts = 0;
        if (this.isEnabled && !this.isNetworkUnavailable && !this.isPaused) {
          this.startRecognition();
        }
      }, 5000);
      return;
    }

    // Reset restart counter after successful period
    if (this.restartResetTimeout) {
      clearTimeout(this.restartResetTimeout);
    }
    this.restartResetTimeout = setTimeout(() => {
      this.restartAttempts = 0;
    }, 10000);

    // Schedule restart
    this.scheduledRestartTimeout = setTimeout(() => {
      if (this.isEnabled && !this.isListening && !this.isNetworkUnavailable && !this.isPaused) {
        this.startRecognition();
      }
    }, this.restartDelay);
  }

  /**
   * Start the speech recognition
   */
  startRecognition() {
    if (!this.recognition) {
      if (!this.initialize()) {
        return false;
      }
    }

    try {
      this.recognition.start();
      return true;
    } catch (error) {
      // May throw if already started
      if (error.message?.includes("already started")) {
        return true;
      }
      return false;
    }
  }

  /**
   * Start wake word detection
   * PRIORITY: OpenWakeWord (offline) > Web Speech API (online)
   */
  start() {
    if (this.isEnabled && this.isListening) {
      return { success: true, message: "Already listening" };
    }

    // Try offline mode first (OpenWakeWord)
    if (this.useOfflineMode && this.onnxSession) {
      return this.startOfflineMode();
    }

    // Fallback to Web Speech API
    if (!this.speechRecognitionAvailable) {
      return { success: false, error: "No wake word detection available" };
    }

    if (this.isNetworkUnavailable) {
      return { success: false, error: "Network unavailable for speech recognition" };
    }

    this.isEnabled = true;
    this.isPaused = false;
    this.isInNetworkBackoff = false;
    this.consecutiveNetworkErrors = 0;
    this.isNetworkUnavailable = false;

    // Start auto-recovery timer for resilience
    this.startAutoRecovery();

    if (this.startRecognition()) {
      this.onStatusChange?.({ isListening: true, status: "listening" });
      return { success: true };
    } else {
      this.isEnabled = false;
      return { success: false, error: "Failed to start recognition" };
    }
  }

  /**
   * Start offline wake word detection using OpenWakeWord (ONNX)
   * 100% offline, no API costs, no internet required
   */
  async startOfflineMode() {
    try {
      // Get microphone access
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true,
        },
      });

      // Create audio context at 16kHz for OpenWakeWord
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000,
      });

      const source = this.audioContext.createMediaStreamSource(this.mediaStream);

      // Use ScriptProcessorNode for audio processing
      // Note: AudioWorklet would be better for production but requires more setup
      const processor = this.audioContext.createScriptProcessor(1024, 1, 1);

      processor.onaudioprocess = async (e) => {
        if (!this.isListening || this.isPaused) {
          return;
        }

        const inputData = e.inputBuffer.getChannelData(0);
        await this.processOfflineAudio(inputData);
      };

      source.connect(processor);
      processor.connect(this.audioContext.destination);

      this.audioWorklet = processor;
      this.isEnabled = true;
      this.isListening = true;
      this.isPaused = false;

      this.onStatusChange?.({ isListening: true, status: "listening", mode: "offline" });

      return { success: true, mode: "offline" };
    } catch (err) {
      // Fall back to Web Speech API
      if (this.speechRecognitionAvailable) {
        this.useOfflineMode = false;
        return this.start();
      }

      return { success: false, error: err.message };
    }
  }

  /**
   * Process audio chunk for offline wake word detection
   * Runs ONNX inference on 80ms audio frames
   */
  async processOfflineAudio(chunk) {
    try {
      // Accumulate audio samples into frame buffer
      for (let i = 0; i < chunk.length; i++) {
        this.audioBuffer[this.bufferIndex++] = chunk[i];

        // Process when we have a full 80ms frame
        if (this.bufferIndex >= this.frameSize) {
          const probability = await this.runOfflineInference(this.audioBuffer);

          if (probability > this.offlineThreshold) {
            // Pause listening while handling detection
            this.isListening = false;

            this.onWakeWordDetected?.({
              transcript: "hey centris",
              confidence: probability,
              timestamp: Date.now(),
              mode: "offline",
            });

            this.onStatusChange?.({
              isListening: false,
              status: "triggered",
              lastWakeWord: "hey centris",
              mode: "offline",
            });

            return;
          }

          // Slide window by half (50% overlap)
          this.audioBuffer.copyWithin(0, this.frameSize / 2);
          this.bufferIndex = this.frameSize / 2;
        }
      }
    } catch (err) {
      // Silently handle inference errors to avoid spam
      if (!this.silentMode) {
        console.error("[WakeWordService] Offline inference error:", err);
      }
    }
  }

  /**
   * Run ONNX inference on audio frame
   * Returns probability of wake word (0-1)
   */
  async runOfflineInference(audioFrame) {
    if (!this.onnxSession) {
      return 0;
    }

    try {
      // Create input tensor from audio frame
      const inputTensor = new ort.Tensor("float32", audioFrame, [1, this.frameSize]);

      // Run inference
      const results = await this.onnxSession.run({
        input: inputTensor,
      });

      // Get output probability
      const outputName = this.onnxSession.outputNames[0];
      const output = results[outputName].data;

      return output[0] || 0;
    } catch (err) {
      // Return 0 on error (no detection)
      return 0;
    }
  }

  /**
   * Start auto-recovery timer that periodically checks if we should retry
   */
  startAutoRecovery() {
    // Clear any existing interval
    if (this.autoRecoveryInterval) {
      clearInterval(this.autoRecoveryInterval);
    }

    // Every 30 seconds, check if we should try to reconnect
    this.autoRecoveryInterval = setInterval(() => {
      if (this.isEnabled && this.isNetworkUnavailable && !this.isListening && !this.isPaused) {
        this.isNetworkUnavailable = false;
        this.consecutiveNetworkErrors = 0;
        this.startRecognition();
      }
    }, 30000);
  }

  /**
   * Stop auto-recovery timer
   */
  stopAutoRecovery() {
    if (this.autoRecoveryInterval) {
      clearInterval(this.autoRecoveryInterval);
      this.autoRecoveryInterval = null;
    }
  }

  /**
   * Stop wake word detection
   */
  stop() {
    this.isEnabled = false;
    this.isPaused = false;
    this.isInNetworkBackoff = false;

    // Cancel auto-recovery
    this.stopAutoRecovery();

    // Cancel any scheduled restart
    if (this.scheduledRestartTimeout) {
      clearTimeout(this.scheduledRestartTimeout);
      this.scheduledRestartTimeout = null;
    }

    // Cancel network error backoff
    if (this.networkErrorTimeout) {
      clearTimeout(this.networkErrorTimeout);
      this.networkErrorTimeout = null;
    }

    // Cancel network success reset
    if (this.networkSuccessResetTimeout) {
      clearTimeout(this.networkSuccessResetTimeout);
      this.networkSuccessResetTimeout = null;
    }

    // Stop offline mode (OpenWakeWord)
    this.stopOfflineMode();

    // Stop Web Speech API recognition
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (error) {
        // May throw if not started - ignore
      }
    }

    this.isListening = false;
    this.onStatusChange?.({ isListening: false, status: "stopped" });

    return { success: true };
  }

  /**
   * Stop offline mode and clean up resources
   */
  stopOfflineMode() {
    // Disconnect audio processor
    if (this.audioWorklet) {
      try {
        this.audioWorklet.disconnect();
      } catch (e) {}
      this.audioWorklet = null;
    }

    // Stop media stream
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    // Close audio context
    if (this.audioContext && this.audioContext.state !== "closed") {
      try {
        this.audioContext.close();
      } catch (e) {}
      this.audioContext = null;
    }

    // Reset buffers
    this.bufferIndex = 0;
    this.audioBuffer = new Float32Array(this.frameSize);
  }

  /**
   * Temporarily pause (for when dictation is active)
   */
  pause() {
    // Set paused FIRST to prevent auto-restart in onend handler
    this.isPaused = true;

    // Cancel any scheduled restart
    if (this.scheduledRestartTimeout) {
      clearTimeout(this.scheduledRestartTimeout);
      this.scheduledRestartTimeout = null;
    }

    // Stop Web Speech API recognition
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (error) {
        // Ignore - may already be stopped
      }
    }
    this.isListening = false;
    // Don't set isEnabled = false so we can resume later
    this.onStatusChange?.({ isListening: false, status: "paused" });
  }

  /**
   * Resume after pause
   */
  resume() {
    // Clear paused state
    this.isPaused = false;

    if (!this.isEnabled) {
      return;
    }

    // Add small delay to ensure microphone is fully released from recording
    setTimeout(() => {
      if (!this.isPaused && this.isEnabled) {
        this.startRecognition();
      }
    }, 200);
  }

  /**
   * Set callbacks
   */
  setCallbacks({ onWakeWordDetected, onError, onStatusChange }) {
    this.onWakeWordDetected = onWakeWordDetected;
    this.onError = onError;
    this.onStatusChange = onStatusChange;
  }

  /**
   * Add a custom wake phrase
   */
  addWakePhrase(phrase) {
    const normalized = phrase.toLowerCase().trim();
    if (!this.wakePhrases.includes(normalized)) {
      this.wakePhrases.push(normalized);
    }
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      isAvailable: this.speechRecognitionAvailable || this.useOfflineMode,
      isEnabled: this.isEnabled,
      isListening: this.isListening,
      isPaused: this.isPaused,
      isNetworkUnavailable: this.isNetworkUnavailable,
      isInNetworkBackoff: this.isInNetworkBackoff,
      wakePhrases: this.wakePhrases,
      consecutiveNetworkErrors: this.consecutiveNetworkErrors,
      // Offline mode status
      isOfflineMode: this.useOfflineMode,
      offlineModelLoaded: !!this.onnxSession,
    };
  }

  /**
   * Cleanup - fully destroys the service (use sparingly, prefer stop())
   */
  cleanup() {
    this.stop(); // This already calls stopAutoRecovery()

    if (this.restartResetTimeout) {
      clearTimeout(this.restartResetTimeout);
    }
    if (this.networkErrorTimeout) {
      clearTimeout(this.networkErrorTimeout);
    }
    if (this.scheduledRestartTimeout) {
      clearTimeout(this.scheduledRestartTimeout);
    }
    if (this.networkSuccessResetTimeout) {
      clearTimeout(this.networkSuccessResetTimeout);
    }

    // Cleanup offline mode
    this.stopOfflineMode();

    // Release ONNX session
    if (this.onnxSession) {
      try {
        this.onnxSession.release();
      } catch (e) {}
      this.onnxSession = null;
    }

    this.recognition = null;
    this.onWakeWordDetected = null;
    this.onError = null;
    this.onStatusChange = null;
  }

  /**
   * Check if offline mode is available
   */
  isOfflineModeAvailable() {
    return this.useOfflineMode && !!this.onnxSession;
  }

  /**
   * Force switch to offline or online mode
   */
  setOfflineMode(enabled) {
    if (enabled && !this.onnxSession) {
      return false;
    }
    this.useOfflineMode = enabled;
    return true;
  }
}

// Singleton instance
let wakeWordServiceInstance = null;

/**
 * Get the wake word service instance
 */
export function getWakeWordService() {
  if (!wakeWordServiceInstance) {
    wakeWordServiceInstance = new WakeWordService();
  }
  return wakeWordServiceInstance;
}

export { WakeWordService };
export default getWakeWordService;
