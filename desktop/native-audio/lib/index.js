/**
 * Centris Native Audio Module - JavaScript Wrapper
 *
 * This module wraps the native C++ audio capture module and provides
 * a clean JavaScript API with event emitter pattern.
 */

const path = require("path");
const EventEmitter = require("events");

// Load native module
let nativeAudio;
try {
  nativeAudio = require("../build/Release/centris_audio.node");
} catch (err) {
  try {
    nativeAudio = require("../build/Debug/centris_audio.node");
  } catch (err2) {
    console.error("[NativeAudio] Failed to load native module:", err.message);
    console.error("[NativeAudio] Debug build also failed:", err2.message);
    nativeAudio = null;
  }
}

/**
 * Native Audio Capture
 *
 * Provides low-latency audio capture using native OS APIs:
 * - macOS: Core Audio
 * - Windows: WASAPI
 * - Linux: PulseAudio
 *
 * @example
 * const { NativeAudioCapture } = require('centris-native-audio');
 *
 * const capture = new NativeAudioCapture();
 *
 * capture.on('audioLevel', (level) => {
 *   console.log('Audio level:', level);
 * });
 *
 * capture.on('voiceStart', () => {
 *   console.log('Voice started');
 * });
 *
 * capture.on('voiceEnd', () => {
 *   console.log('Voice ended');
 * });
 *
 * capture.on('transcript', (result) => {
 *   console.log('Transcript:', result.text, result.isFinal ? '(final)' : '(partial)');
 * });
 *
 * await capture.initialize({
 *   deviceId: 'default',
 *   sampleRate: 16000,
 *   vadEnabled: true,
 *   backendUrl: 'wss://api.centris.ai/v1/stream'
 * });
 *
 * capture.start();
 * // ... later
 * capture.stop();
 */
class NativeAudioCapture extends EventEmitter {
  constructor() {
    super();

    this._native = null;
    this._initialized = false;
    this._running = false;
    this._config = null;

    // Check if native module is available
    if (!nativeAudio) {
      console.warn("[NativeAudio] Native module not available, falling back to Web APIs");
    }
  }

  /**
   * Check if native audio is available
   */
  static isAvailable() {
    return nativeAudio !== null;
  }

  /**
   * Get available input devices
   * @returns {Array<{id: string, name: string, isDefault: boolean, maxChannels: number, defaultSampleRate: number}>}
   */
  static getInputDevices() {
    if (!nativeAudio) {
      return [];
    }
    try {
      return nativeAudio.CentrisAudio.getInputDevices();
    } catch (err) {
      console.error("[NativeAudio] Failed to get input devices:", err.message);
      return [];
    }
  }

  /**
   * Get default input device
   * @returns {{id: string, name: string, isDefault: boolean, maxChannels: number, defaultSampleRate: number} | null}
   */
  static getDefaultInputDevice() {
    if (!nativeAudio) {
      return null;
    }
    try {
      return nativeAudio.CentrisAudio.getDefaultInputDevice();
    } catch (err) {
      console.error("[NativeAudio] Failed to get default input device:", err.message);
      return null;
    }
  }

  /**
   * Initialize the audio capture
   * @param {Object} config Configuration options
   * @param {string} [config.deviceId='default'] Audio input device ID
   * @param {number} [config.sampleRate=16000] Sample rate in Hz
   * @param {number} [config.channels=1] Number of channels (1=mono, 2=stereo)
   * @param {boolean} [config.vadEnabled=true] Enable Voice Activity Detection
   * @param {number} [config.vadThreshold=0.5] VAD sensitivity (0.0 - 1.0)
   * @param {string} [config.backendUrl] WebSocket URL for streaming
   * @param {string} [config.authToken] Authentication token
   * @returns {Promise<boolean>} True if initialization succeeded
   */
  async initialize(config = {}) {
    if (this._initialized) {
      return true;
    }

    this._config = {
      deviceId: config.deviceId || "default",
      sampleRate: config.sampleRate || 16000,
      channels: config.channels || 1,
      vadEnabled: config.vadEnabled !== false,
      vadThreshold: config.vadThreshold || 0.06, // Low threshold for whispered speech
      backendUrl: config.backendUrl || "",
      authToken: config.authToken || "",
    };

    if (!nativeAudio) {
      console.warn("[NativeAudio] Native module not available");
      return false;
    }

    try {
      this._native = new nativeAudio.CentrisAudio();
      const result = this._native.initialize(this._config);

      if (result) {
        this._setupCallbacks();
        this._initialized = true;
      }

      return result;
    } catch (err) {
      console.error("[NativeAudio] Failed to initialize:", err.message);
      return false;
    }
  }

  /**
   * Start audio capture
   * @returns {boolean} True if started successfully
   */
  start() {
    if (!this._initialized || !this._native) {
      console.error("[NativeAudio] Not initialized");
      return false;
    }

    if (this._running) {
      return true;
    }

    try {
      const result = this._native.start();
      if (result) {
        this._running = true;
        this.emit("started");
      }
      return result;
    } catch (err) {
      console.error("[NativeAudio] Failed to start:", err.message);
      return false;
    }
  }

  /**
   * Stop audio capture
   * @returns {boolean} True if stopped successfully
   */
  stop() {
    if (!this._native) {
      return true;
    }

    if (!this._running) {
      return true;
    }

    try {
      const result = this._native.stop();
      if (result) {
        this._running = false;
        this.emit("stopped");
      }
      return result;
    } catch (err) {
      console.error("[NativeAudio] Failed to stop:", err.message);
      return false;
    }
  }

  /**
   * Shutdown and release resources
   */
  shutdown() {
    if (!this._native) {
      return;
    }

    try {
      this._native.shutdown();
      this._native = null;
      this._initialized = false;
      this._running = false;
      this.emit("shutdown");
    } catch (err) {
      console.error("[NativeAudio] Failed to shutdown:", err.message);
    }
  }

  /**
   * Check if currently capturing
   * @returns {boolean}
   */
  isRunning() {
    if (!this._native) {
      return false;
    }
    try {
      return this._native.isRunning();
    } catch (err) {
      return false;
    }
  }

  /**
   * Get capture statistics
   * @returns {{totalSamples: number, droppedSamples: number, avgLatencyMs: number, maxLatencyMs: number, bytesTransmitted: number, messagesReceived: number, avgProcessingMs: number}}
   */
  getStats() {
    if (!this._native) {
      return {
        totalSamples: 0,
        droppedSamples: 0,
        avgLatencyMs: 0,
        maxLatencyMs: 0,
        bytesTransmitted: 0,
        messagesReceived: 0,
        avgProcessingMs: 0,
      };
    }
    try {
      return this._native.getStats();
    } catch (err) {
      console.error("[NativeAudio] Failed to get stats:", err.message);
      return {};
    }
  }

  /**
   * Get queued audio chunks for IPC bridging
   * JavaScript should call this periodically and send chunks via Socket.IO
   * @returns {Array<{sequence: number, data: Buffer}>}
   */
  getQueuedAudioChunks() {
    if (!this._native) {
      return [];
    }
    try {
      return this._native.getQueuedAudioChunks();
    } catch (err) {
      console.error("[NativeAudio] Failed to get queued chunks:", err.message);
      return [];
    }
  }

  /**
   * Setup native callbacks
   * @private
   */
  _setupCallbacks() {
    // Note: In the current implementation, callbacks are set up in the native module
    // and events are emitted via ThreadSafeFunction. This method is a placeholder
    // for future enhancements like dynamic callback registration.
  }
}

/**
 * Create a simple audio level monitor
 * Useful for debugging and testing without full capture
 */
class AudioLevelMonitor extends EventEmitter {
  constructor() {
    super();
    this._capture = new NativeAudioCapture();
    this._intervalId = null;
  }

  async start(config = {}) {
    const initialized = await this._capture.initialize({
      ...config,
      vadEnabled: true,
      backendUrl: "", // No backend connection for monitor
    });

    if (!initialized) {
      return false;
    }

    this._capture.on("audioLevel", (level) => {
      this.emit("level", level);
    });

    this._capture.on("voiceStart", () => {
      this.emit("voiceStart");
    });

    this._capture.on("voiceEnd", () => {
      this.emit("voiceEnd");
    });

    return this._capture.start();
  }

  stop() {
    this._capture.stop();
    this._capture.shutdown();
  }
}

module.exports = {
  NativeAudioCapture,
  AudioLevelMonitor,
  isAvailable: NativeAudioCapture.isAvailable,
  getInputDevices: NativeAudioCapture.getInputDevices,
  getDefaultInputDevice: NativeAudioCapture.getDefaultInputDevice,
};
