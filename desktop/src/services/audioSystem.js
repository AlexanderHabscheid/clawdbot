/**
 * Unified Audio System for Centris AI
 *
 * ============================================================================
 * SIMPLIFIED AUDIO ARCHITECTURE (January 2026)
 * ============================================================================
 *
 * This file provides the UNIFIED AUDIO STREAM that eliminates mic conflicts.
 *
 * HOW IT WORKS:
 * - UnifiedAudioManager creates ONE MediaStream at app startup
 * - This stream is SHARED by wake word detection AND recording
 * - No more race conditions when switching between modes
 *
 * FILE RESPONSIBILITIES:
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  audioSystem.js (THIS FILE)              │ audioManager.js              │
 * │  ─────────────────────────────────────── │ ─────────────────────────────│
 * │  • UnifiedAudioManager (shared stream)   │ • Recording start/stop       │
 * │  • TTSPlaybackService (voice output)     │ • Native audio capture       │
 * │  • AudioInputManager (status/legacy)     │ • Transcription handling     │
 * │                                          │ • Mode management (action/   │
 * │  Used by: wakeWordService.js             │   dictation)                 │
 * │           useAudioRecording.js (stream)  │ • Text pasting               │
 * │           useTTSPlayback.js              │                              │
 * │                                          │ Used by: useAudioRecording   │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * THE CLEAN PIPELINE:
 * 1. Native Audio (C++) → captures audio with low latency
 * 2. Socket.IO → streams to backend at /ws/audio/stream
 * 3. Backend → routes to Deepgram via Cloudflare AI Gateway
 * 4. Cloudflare → transcribes, checks pattern cache
 * 5. Agent → executes tools
 *
 * DELETED FILES (January 2026):
 * - localKeywordSpotter.js - Energy-based VAD, replaced by native audio VAD
 *
 * Architecture follows: desktop/native-audio/ARCHITECTURE.md
 */

// ============================================
// UNIFIED AUDIO MANAGER - Single Mic Stream
// ============================================
// This is the CORE component that fixes race conditions
// between wake word detection and globe key dictation

class UnifiedAudioManager {
  constructor() {
    // Single audio stream - THE key to avoiding race conditions
    this.mediaStream = null;
    this.audioContext = null;
    this.analyser = null;
    this.sourceNode = null;
    this.scriptProcessor = null;

    // Stream state
    this.isStreamActive = false;
    this.isInitializing = false;

    // Mode: 'idle' | 'wake-word' | 'recording'
    this.mode = "idle";

    // Dictation buffer for recording mode
    this.dictationBuffer = [];
    this.isRecordingDictation = false;
    this.dictationStartTime = null;

    // Wake word detection state
    this.wakeWordEnabled = true;
    this.wakeWordSensitivity = 0.5;

    // Audio level tracking
    this.currentAudioLevel = 0;
    this.audioLevelHistory = [];
    this.maxHistoryLength = 30; // ~0.5 seconds at 60fps

    // Callbacks
    this.onAudioLevel = null;
    this.onWakeWordDetected = null;
    this.onDictationReady = null;
    this.onError = null;
    this.onStateChange = null;

    // Simple wake word detection using audio patterns
    // This is a fallback - can be enhanced with Picovoice/Vosk
    this.speechDetectionThreshold = 0.15;
    this.silenceThreshold = 0.05;
    this.consecutiveSpeechFrames = 0;
    this.requiredSpeechFrames = 10; // ~166ms of speech to trigger

    console.log("[UnifiedAudioManager] 🎵 Initialized - ready for single-stream audio");
  }

  /**
   * Initialize the unified audio stream
   * This creates ONE MediaStream that's shared by all consumers
   */
  async initialize() {
    if (this.isInitializing) {
      console.log("[UnifiedAudioManager] Already initializing, waiting...");
      return this.waitForInitialization();
    }

    if (this.isStreamActive && this.mediaStream) {
      console.log("[UnifiedAudioManager] Stream already active");
      return true;
    }

    this.isInitializing = true;

    try {
      console.log("[UnifiedAudioManager] 🎤 Requesting microphone access (single stream)...");

      // OPTIMIZED FOR SPEECH DETECTION:
      // - noiseSuppression: false - Don't filter whispers
      // - autoGainControl: true - Boost quiet speech
      // - echoCancellation: false - Preserve audio clarity
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true,
          sampleRate: 16000,
        },
      });

      console.log("[UnifiedAudioManager] ✅ Microphone access granted");

      // Create AudioContext for processing
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000,
      });

      // Create source from stream
      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);

      // Create analyser for audio levels
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.8;
      this.sourceNode.connect(this.analyser);

      // Create script processor for raw audio access
      // This allows us to feed audio to both wake word detection AND recording
      const bufferSize = 4096;
      this.scriptProcessor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);
      this.sourceNode.connect(this.scriptProcessor);
      this.scriptProcessor.connect(this.audioContext.destination);

      // Process audio data
      this.scriptProcessor.onaudioprocess = (event) => {
        this.processAudioData(event.inputBuffer.getChannelData(0));
      };

      this.isStreamActive = true;
      this.isInitializing = false;

      // Start audio level monitoring
      this.startAudioLevelMonitoring();

      console.log("[UnifiedAudioManager] 🎵 Unified audio stream active");
      this.onStateChange?.({ isStreamActive: true, mode: this.mode });

      return true;
    } catch (error) {
      this.isInitializing = false;
      console.error("[UnifiedAudioManager] ❌ Failed to initialize:", error);
      this.onError?.({
        code: "STREAM_INIT_FAILED",
        message: error.message,
      });
      return false;
    }
  }

  /**
   * Wait for initialization to complete
   */
  async waitForInitialization() {
    const maxWait = 5000; // 5 seconds
    const checkInterval = 100;
    let waited = 0;

    while (this.isInitializing && waited < maxWait) {
      await new Promise((resolve) => setTimeout(resolve, checkInterval));
      waited += checkInterval;
    }

    return this.isStreamActive;
  }

  /**
   * Process raw audio data
   * This is called continuously while the stream is active
   */
  processAudioData(audioData) {
    if (!this.isStreamActive) {
      return;
    }

    // Calculate RMS audio level
    let sum = 0;
    for (let i = 0; i < audioData.length; i++) {
      sum += audioData[i] * audioData[i];
    }
    const rms = Math.sqrt(sum / audioData.length);
    this.currentAudioLevel = rms;

    // Track audio level history for pattern detection
    this.audioLevelHistory.push(rms);
    if (this.audioLevelHistory.length > this.maxHistoryLength) {
      this.audioLevelHistory.shift();
    }

    // If in recording mode, buffer the audio
    if (this.isRecordingDictation) {
      // Convert Float32Array to Int16Array for efficient storage
      const int16Data = new Int16Array(audioData.length);
      for (let i = 0; i < audioData.length; i++) {
        const s = Math.max(-1, Math.min(1, audioData[i]));
        int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.dictationBuffer.push(int16Data);
    }

    // Simple speech detection for wake word mode
    // This detects voice activity and can be replaced with Picovoice/Vosk later
    if (this.wakeWordEnabled && this.mode === "wake-word") {
      if (rms > this.speechDetectionThreshold * this.wakeWordSensitivity) {
        this.consecutiveSpeechFrames++;
        if (this.consecutiveSpeechFrames >= this.requiredSpeechFrames) {
          // Speech detected - could trigger wake word callback
          // For now this is just activity detection
          // Real wake word detection would use Picovoice Porcupine
        }
      } else {
        this.consecutiveSpeechFrames = 0;
      }
    }
  }

  /**
   * Start continuous audio level monitoring
   */
  startAudioLevelMonitoring() {
    if (!this.analyser) {
      return;
    }

    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);

    const monitor = () => {
      if (!this.isStreamActive) {
        return;
      }

      this.analyser.getByteFrequencyData(dataArray);

      // Calculate average level (0-255)
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const average = sum / dataArray.length;

      // Notify callback
      if (this.onAudioLevel) {
        this.onAudioLevel({
          level: average,
          levelPercent: Math.floor((average / 255) * 100),
          frequencies: dataArray,
          rms: this.currentAudioLevel,
        });
      }

      requestAnimationFrame(monitor);
    };

    requestAnimationFrame(monitor);
  }

  /**
   * Start dictation recording
   * Uses the existing unified stream - no new mic access needed!
   */
  startDictation() {
    if (!this.isStreamActive) {
      console.warn("[UnifiedAudioManager] Cannot start dictation - stream not active");
      return false;
    }

    console.log("[UnifiedAudioManager] 🎤 Starting dictation (using unified stream)");

    this.dictationBuffer = [];
    this.isRecordingDictation = true;
    this.dictationStartTime = Date.now();
    this.mode = "recording";

    this.onStateChange?.({ isStreamActive: true, mode: "recording", isRecording: true });

    return true;
  }

  /**
   * Stop dictation recording and return the audio data
   */
  stopDictation() {
    if (!this.isRecordingDictation) {
      console.warn("[UnifiedAudioManager] Not recording dictation");
      return null;
    }

    console.log("[UnifiedAudioManager] 🛑 Stopping dictation");

    this.isRecordingDictation = false;
    this.mode = this.wakeWordEnabled ? "wake-word" : "idle";

    const duration = this.dictationStartTime ? (Date.now() - this.dictationStartTime) / 1000 : 0;

    // Combine all buffered audio into single array
    const totalLength = this.dictationBuffer.reduce((acc, buf) => acc + buf.length, 0);
    const combinedAudio = new Int16Array(totalLength);
    let offset = 0;
    for (const buffer of this.dictationBuffer) {
      combinedAudio.set(buffer, offset);
      offset += buffer.length;
    }

    this.dictationBuffer = [];
    this.dictationStartTime = null;

    this.onStateChange?.({ isStreamActive: true, mode: this.mode, isRecording: false });

    // Notify that dictation audio is ready
    if (this.onDictationReady) {
      this.onDictationReady({
        audio: combinedAudio,
        duration: duration,
        sampleRate: 16000,
      });
    }

    return {
      audio: combinedAudio,
      duration: duration,
      sampleRate: 16000,
    };
  }

  /**
   * Enable/disable wake word detection mode
   */
  setWakeWordMode(enabled, sensitivity = 0.5) {
    this.wakeWordEnabled = enabled;
    this.wakeWordSensitivity = sensitivity;

    if (enabled && !this.isRecordingDictation) {
      this.mode = "wake-word";
    } else if (!enabled && !this.isRecordingDictation) {
      this.mode = "idle";
    }

    console.log(`[UnifiedAudioManager] Wake word mode: ${enabled ? "enabled" : "disabled"}`);
  }

  /**
   * Get the raw MediaStream for components that need it
   * (e.g., MediaRecorder for native audio fallback)
   */
  getMediaStream() {
    return this.mediaStream;
  }

  /**
   * Check if stream is active
   */
  isActive() {
    return this.isStreamActive && this.mediaStream !== null;
  }

  /**
   * Get current state
   */
  getState() {
    return {
      isStreamActive: this.isStreamActive,
      mode: this.mode,
      isRecording: this.isRecordingDictation,
      wakeWordEnabled: this.wakeWordEnabled,
      audioLevel: this.currentAudioLevel,
    };
  }

  /**
   * Set callbacks
   */
  setCallbacks({ onAudioLevel, onWakeWordDetected, onDictationReady, onError, onStateChange }) {
    if (onAudioLevel) {
      this.onAudioLevel = onAudioLevel;
    }
    if (onWakeWordDetected) {
      this.onWakeWordDetected = onWakeWordDetected;
    }
    if (onDictationReady) {
      this.onDictationReady = onDictationReady;
    }
    if (onError) {
      this.onError = onError;
    }
    if (onStateChange) {
      this.onStateChange = onStateChange;
    }
  }

  /**
   * Stop the unified audio stream
   * Only call this when the app is shutting down or user explicitly disables audio
   */
  shutdown() {
    console.log("[UnifiedAudioManager] 🛑 Shutting down unified audio stream");

    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = null;
    }

    if (this.audioContext && this.audioContext.state !== "closed") {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    this.isStreamActive = false;
    this.isRecordingDictation = false;
    this.mode = "idle";
    this.dictationBuffer = [];

    this.onStateChange?.({ isStreamActive: false, mode: "idle" });
  }
}

// ============================================
// TTS PLAYBACK SERVICE
// ============================================

class TTSPlaybackService {
  constructor() {
    this.currentAudio = null;
    this.audioQueue = [];
    this.isPlaying = false;
    this.volume = 1.0;
    this.onPlaybackStart = null;
    this.onPlaybackEnd = null;
    this.onPlaybackError = null;
    this.onQueueChange = null;
  }

  /**
   * Set playback callbacks
   */
  setCallbacks({ onPlaybackStart, onPlaybackEnd, onPlaybackError, onQueueChange }) {
    this.onPlaybackStart = onPlaybackStart;
    this.onPlaybackEnd = onPlaybackEnd;
    this.onPlaybackError = onPlaybackError;
    this.onQueueChange = onQueueChange;
  }

  /**
   * Play voice response from a blob URL
   * @param {string} blobUrl - URL to the audio blob (can be blob:// or https://)
   * @param {Object} options - Playback options
   * @param {boolean} options.interrupt - If true, stops current playback and plays immediately
   * @param {number} options.volume - Volume level (0.0 - 1.0)
   * @returns {Promise<boolean>} - Resolves when playback completes
   */
  async playVoiceResponse(blobUrl, options = {}) {
    const { interrupt = false, volume = this.volume } = options;

    if (!blobUrl) {
      console.error("[TTSPlayback] No blob URL provided");
      return false;
    }

    console.log("[TTSPlayback] 🔊 Playing voice response:", blobUrl.substring(0, 50) + "...");

    if (interrupt && this.isPlaying) {
      this.stop();
    }

    if (this.isPlaying && !interrupt) {
      // Queue the audio for later playback
      console.log("[TTSPlayback] 📋 Queueing audio for later playback");
      this.audioQueue.push({ blobUrl, options });
      this.onQueueChange?.(this.audioQueue.length);
      return true;
    }

    return this._playAudio(blobUrl, volume);
  }

  /**
   * Internal method to play audio
   */
  async _playAudio(blobUrl, volume) {
    return new Promise((resolve) => {
      try {
        this.currentAudio = new Audio(blobUrl);
        this.currentAudio.volume = volume;

        this.currentAudio.onloadeddata = () => {
          console.log("[TTSPlayback] ✅ Audio loaded, duration:", this.currentAudio.duration, "s");
        };

        this.currentAudio.onplay = () => {
          console.log("[TTSPlayback] ▶️ Playback started");
          this.isPlaying = true;
          this.onPlaybackStart?.();
        };

        this.currentAudio.onended = () => {
          console.log("[TTSPlayback] ⏹️ Playback ended");
          this.isPlaying = false;
          this.currentAudio = null;
          this.onPlaybackEnd?.();

          // Play next in queue if any
          this._playNextInQueue();
          resolve(true);
        };

        this.currentAudio.onerror = (error) => {
          console.error("[TTSPlayback] ❌ Playback error:", error);
          this.isPlaying = false;
          this.currentAudio = null;
          this.onPlaybackError?.({
            title: "Audio Playback Error",
            description: "Failed to play voice response. Check audio output settings.",
            error,
          });
          resolve(false);
        };

        // Start playback
        this.currentAudio.play().catch((error) => {
          console.error("[TTSPlayback] ❌ Play promise rejected:", error);
          this.isPlaying = false;

          // Handle autoplay restrictions
          if (error.name === "NotAllowedError") {
            this.onPlaybackError?.({
              title: "Autoplay Blocked",
              description: "Browser blocked audio playback. Click to enable audio.",
            });
          }
          resolve(false);
        });
      } catch (error) {
        console.error("[TTSPlayback] ❌ Error creating audio:", error);
        this.onPlaybackError?.({
          title: "Audio Error",
          description: error.message,
        });
        resolve(false);
      }
    });
  }

  /**
   * Play next audio in queue
   */
  _playNextInQueue() {
    if (this.audioQueue.length > 0) {
      const next = this.audioQueue.shift();
      this.onQueueChange?.(this.audioQueue.length);
      console.log("[TTSPlayback] 📋 Playing next in queue, remaining:", this.audioQueue.length);
      this._playAudio(next.blobUrl, next.options?.volume || this.volume);
    }
  }

  /**
   * Stop current playback
   */
  stop() {
    if (this.currentAudio) {
      console.log("[TTSPlayback] 🛑 Stopping playback");
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
      this.isPlaying = false;
      this.onPlaybackEnd?.();
    }
  }

  /**
   * Pause current playback
   */
  pause() {
    if (this.currentAudio && this.isPlaying) {
      console.log("[TTSPlayback] ⏸️ Pausing playback");
      this.currentAudio.pause();
    }
  }

  /**
   * Resume paused playback
   */
  resume() {
    if (this.currentAudio && !this.isPlaying) {
      console.log("[TTSPlayback] ▶️ Resuming playback");
      this.currentAudio.play();
    }
  }

  /**
   * Set volume
   * @param {number} level - Volume level (0.0 - 1.0)
   */
  setVolume(level) {
    this.volume = Math.max(0, Math.min(1, level));
    if (this.currentAudio) {
      this.currentAudio.volume = this.volume;
    }
    console.log("[TTSPlayback] 🔊 Volume set to:", Math.round(this.volume * 100) + "%");
  }

  /**
   * Clear the audio queue
   */
  clearQueue() {
    this.audioQueue = [];
    this.onQueueChange?.(0);
    console.log("[TTSPlayback] 🗑️ Queue cleared");
  }

  /**
   * Get playback state
   */
  getState() {
    return {
      isPlaying: this.isPlaying,
      queueLength: this.audioQueue.length,
      volume: this.volume,
      currentTime: this.currentAudio?.currentTime || 0,
      duration: this.currentAudio?.duration || 0,
    };
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    this.stop();
    this.clearQueue();
    this.onPlaybackStart = null;
    this.onPlaybackEnd = null;
    this.onPlaybackError = null;
    this.onQueueChange = null;
  }
}

// ============================================
// AUDIO INPUT MANAGER (Microphone)
// ============================================

class AudioInputManager {
  constructor() {
    this.isRecording = false;
    this.isProcessing = false;
    this.useNativeAudio = false;
    this.nativeAudioAvailable = false;
    this.nativeAudioInitialized = false;
    this.onStateChange = null;
    this.onError = null;
    this.onTranscript = null;
    this.onAudioLevel = null;
  }

  /**
   * Check if native audio is available and initialize
   */
  async checkNativeAudioAvailability() {
    try {
      if (window.electronAPI?.nativeAudioAvailable) {
        this.nativeAudioAvailable = await window.electronAPI.nativeAudioAvailable();
        console.log("[AudioInput] Native audio available:", this.nativeAudioAvailable);
        return this.nativeAudioAvailable;
      }
    } catch (error) {
      console.warn("[AudioInput] Failed to check native audio:", error);
    }
    this.nativeAudioAvailable = false;
    return false;
  }

  /**
   * Get audio input source preference
   */
  getPreferredSource() {
    if (this.nativeAudioAvailable) {
      return "native"; // Core Audio / WASAPI - <700ms latency
    }
    return "web"; // MediaRecorder fallback - ~1500ms latency
  }

  /**
   * Get audio system status for debugging
   */
  async getStatus() {
    const nativeAvailable = await this.checkNativeAudioAvailability();

    return {
      nativeAudioAvailable: nativeAvailable,
      preferredSource: this.getPreferredSource(),
      isRecording: this.isRecording,
      isProcessing: this.isProcessing,
      estimatedLatency: nativeAvailable ? "<700ms" : "~1500ms",
    };
  }
}

// ============================================
// UNIFIED AUDIO SYSTEM
// ============================================

class AudioSystem {
  constructor() {
    // UNIFIED AUDIO MANAGER - Single stream for all audio input
    // This eliminates race conditions between wake word and recording
    this.unified = new UnifiedAudioManager();

    // TTS Playback (OUTPUT)
    this.tts = new TTSPlaybackService();

    // Audio Input (MICROPHONE) - Legacy, use unified instead
    this.input = new AudioInputManager();

    console.log("[AudioSystem] 🎵 Unified Audio System initialized");
  }

  /**
   * Initialize the unified audio stream
   * Call this once at app startup to enable always-on audio
   */
  async initializeUnifiedStream() {
    return this.unified.initialize();
  }

  /**
   * Start dictation using the unified stream
   * No mic conflicts - uses the existing stream
   */
  startDictation() {
    return this.unified.startDictation();
  }

  /**
   * Stop dictation and get the recorded audio
   */
  stopDictation() {
    return this.unified.stopDictation();
  }

  /**
   * Enable/disable wake word detection
   */
  setWakeWordMode(enabled, sensitivity = 0.5) {
    this.unified.setWakeWordMode(enabled, sensitivity);
  }

  /**
   * Get the unified MediaStream for components that need raw access
   */
  getMediaStream() {
    return this.unified.getMediaStream();
  }

  /**
   * Check if unified stream is active
   */
  isStreamActive() {
    return this.unified.isActive();
  }

  /**
   * Set unified audio callbacks
   */
  setUnifiedCallbacks(callbacks) {
    this.unified.setCallbacks(callbacks);
  }

  /**
   * Play a voice response from blob URL
   * This is the main method to call for TTS playback
   */
  async playVoiceResponse(blobUrl, options = {}) {
    return this.tts.playVoiceResponse(blobUrl, options);
  }

  /**
   * Stop voice playback
   */
  stopVoice() {
    this.tts.stop();
  }

  /**
   * Get full audio system status
   */
  async getStatus() {
    const inputStatus = await this.input.getStatus();
    const outputStatus = this.tts.getState();
    const unifiedStatus = this.unified.getState();

    return {
      unified: unifiedStatus,
      input: inputStatus,
      output: outputStatus,
      summary: {
        unifiedStreamActive: unifiedStatus.isStreamActive,
        nativeAudioWorking: inputStatus.nativeAudioAvailable,
        ttsPlaying: outputStatus.isPlaying,
        latency: inputStatus.estimatedLatency,
      },
    };
  }

  /**
   * Cleanup all audio resources
   */
  cleanup() {
    this.unified.shutdown();
    this.tts.cleanup();
    console.log("[AudioSystem] 🧹 Audio system cleaned up");
  }
}

// ============================================
// SINGLETON INSTANCES
// ============================================

let audioSystemInstance = null;
let unifiedAudioManagerInstance = null;

/**
 * Get the audio system instance
 */
function getAudioSystem() {
  if (!audioSystemInstance) {
    audioSystemInstance = new AudioSystem();
  }
  return audioSystemInstance;
}

/**
 * Get the unified audio manager instance directly
 * Use this when you need direct access to the unified stream
 */
function getUnifiedAudioManager() {
  if (!unifiedAudioManagerInstance) {
    unifiedAudioManagerInstance = new UnifiedAudioManager();
  }
  return unifiedAudioManagerInstance;
}

// Export for ES modules and CommonJS
export {
  AudioSystem,
  UnifiedAudioManager,
  TTSPlaybackService,
  AudioInputManager,
  getAudioSystem,
  getUnifiedAudioManager,
};
export default getAudioSystem;
