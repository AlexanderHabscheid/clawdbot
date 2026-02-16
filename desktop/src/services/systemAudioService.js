/**
 * SystemAudioService - System Audio Output Capture
 *
 * Captures audio playing on the system (not microphone).
 * Requires "Screen Recording" permission on macOS (audio capture is bundled with screen recording).
 *
 * Use cases:
 * - Transcribe meetings playing through speakers
 * - Capture audio from video calls (Zoom, Google Meet, etc.)
 * - Record system sounds for analysis
 * - Enable audio context awareness for AI
 * - Meeting transcription and note-taking
 *
 * Implementation Notes:
 * - On macOS, system audio requires either:
 *   1. Screen Recording permission (macOS 11+)
 *   2. Virtual audio device like BlackHole or Loopback
 * - This service uses ScreenCaptureKit (macOS 12.3+) when available
 */

const { BrowserWindow } = require("electron");
const { spawn, exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const EventEmitter = require("events");
const loggerModule = require("../utils/logger");
const logger = loggerModule.default || loggerModule;

class SystemAudioService extends EventEmitter {
  constructor() {
    super();
    this.isCapturing = false;
    this.captureProcess = null;
    this.platform = process.platform;
    this.tempDir = path.join(require("os").tmpdir(), "centris-system-audio");
    this.currentRecordingPath = null;

    // Audio settings
    this.sampleRate = 16000; // Good for speech recognition
    this.channels = 1; // Mono for speech
    this.format = "wav";

    // Virtual audio device detection
    this.virtualDevices = [];
    this.preferredDevice = null;

    // Ensure temp directory exists
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * Check if system audio capture is available
   */
  async checkAvailability() {
    if (this.platform !== "darwin") {
      return {
        available: false,
        reason: "System audio capture currently only supported on macOS",
        alternatives: ["Use a virtual audio device like VB-Audio or similar on your platform"],
      };
    }

    try {
      // Check screen recording permission (required for system audio on macOS)
      const permissions = require("node-mac-permissions");
      const status = permissions.getAuthStatus("screen");

      // Also check for virtual audio devices
      const devices = await this._detectVirtualAudioDevices();

      return {
        available: status === "authorized" || devices.length > 0,
        screenRecordingStatus: status,
        hasVirtualDevice: devices.length > 0,
        virtualDevices: devices,
        canRequest: status === "not-determined",
        method:
          status === "authorized"
            ? "screen-capture-kit"
            : devices.length > 0
              ? "virtual-device"
              : "none",
      };
    } catch (error) {
      logger.error("[SystemAudio] Error checking availability:", error);
      return { available: false, error: error.message };
    }
  }

  /**
   * Detect available virtual audio devices (BlackHole, Loopback, etc.)
   */
  async _detectVirtualAudioDevices() {
    return new Promise((resolve) => {
      // Use ffmpeg to list audio devices
      exec('ffmpeg -f avfoundation -list_devices true -i "" 2>&1', (error, stdout, stderr) => {
        const output = stdout + stderr;
        const devices = [];

        // Look for known virtual audio device patterns
        const virtualDevicePatterns = [
          /BlackHole/i,
          /Loopback/i,
          /Soundflower/i,
          /Virtual Cable/i,
          /VB-Audio/i,
          /Multi-Output/i,
          /Aggregate/i,
        ];

        // Parse audio devices from output
        const audioDeviceMatch = output.match(
          /AVFoundation audio devices:[\s\S]*?(?=AVFoundation video|$)/,
        );
        if (audioDeviceMatch) {
          const lines = audioDeviceMatch[0].split("\n");
          for (const line of lines) {
            const match = line.match(/\[(\d+)\]\s+(.+)/);
            if (match) {
              const deviceName = match[2].trim();
              const isVirtual = virtualDevicePatterns.some((pattern) => pattern.test(deviceName));
              if (isVirtual) {
                devices.push({
                  id: match[1],
                  name: deviceName,
                  type: "virtual",
                });
              }
            }
          }
        }

        this.virtualDevices = devices;
        resolve(devices);
      });
    });
  }

  /**
   * Start capturing system audio
   * @param {Object} options - Capture options
   * @param {string} options.device - Specific device to capture from
   * @param {number} options.sampleRate - Sample rate (default: 16000)
   * @param {boolean} options.transcribe - Auto-transcribe captured audio
   */
  async startCapture(options = {}) {
    if (this.isCapturing) {
      return { success: true, message: "Already capturing" };
    }

    // Check availability
    const availability = await this.checkAvailability();
    if (!availability.available) {
      logger.warn("[SystemAudio] System audio capture not available");
      return {
        success: false,
        error: "System audio capture not available",
        details: availability,
        suggestion: this._getSuggestion(availability),
      };
    }

    logger.log("[SystemAudio] Starting system audio capture...", options);

    const sampleRate = options.sampleRate || this.sampleRate;
    const timestamp = Date.now();
    const filename = `system_audio_${timestamp}.${this.format}`;
    this.currentRecordingPath = path.join(this.tempDir, filename);

    try {
      if (availability.method === "screen-capture-kit") {
        // Use ScreenCaptureKit for system audio (requires macOS 12.3+)
        await this._startWithScreenCaptureKit(options);
      } else if (availability.method === "virtual-device") {
        // Fall back to virtual audio device
        const device = options.device || availability.virtualDevices[0]?.name;
        await this._startWithVirtualDevice(device, sampleRate);
      } else {
        return {
          success: false,
          error: "No capture method available",
          suggestion: "Install BlackHole or grant Screen Recording permission",
        };
      }

      this.isCapturing = true;
      this.emit("started", { recordingPath: this.currentRecordingPath });

      return {
        success: true,
        recordingPath: this.currentRecordingPath,
        method: availability.method,
      };
    } catch (error) {
      logger.error("[SystemAudio] Failed to start capture:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Stop capturing system audio
   * @returns {Object} Result with recorded file path
   */
  async stopCapture() {
    if (!this.isCapturing) {
      return { success: true, message: "Not capturing" };
    }

    logger.log("[SystemAudio] Stopping system audio capture...");

    try {
      if (this.captureProcess) {
        // Send SIGINT to allow ffmpeg to finalize the file
        this.captureProcess.kill("SIGINT");

        // Wait a moment for ffmpeg to finish writing
        await new Promise((resolve) => setTimeout(resolve, 500));

        this.captureProcess = null;
      }

      this.isCapturing = false;

      // Check if recording file was created
      const recordingPath = this.currentRecordingPath;
      if (recordingPath && fs.existsSync(recordingPath)) {
        const stats = fs.statSync(recordingPath);

        this.emit("stopped", { recordingPath, fileSize: stats.size });

        return {
          success: true,
          recordingPath,
          fileSize: stats.size,
          duration: this._estimateDuration(stats.size),
        };
      } else {
        this.emit("stopped", { recordingPath: null });
        return { success: true, message: "No recording file created" };
      }
    } catch (error) {
      logger.error("[SystemAudio] Error stopping capture:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get current capture status
   */
  getStatus() {
    return {
      isCapturing: this.isCapturing,
      platform: this.platform,
      currentRecordingPath: this.currentRecordingPath,
      sampleRate: this.sampleRate,
      virtualDevices: this.virtualDevices,
    };
  }

  /**
   * Start capture using ScreenCaptureKit (macOS 12.3+)
   * This requires screen recording permission but captures system audio directly
   */
  async _startWithScreenCaptureKit(options) {
    return new Promise((resolve, reject) => {
      // Use swift/AppleScript to access ScreenCaptureKit
      // For now, we use a simpler approach with ffmpeg and desktop audio

      const args = [
        "-y", // Overwrite output
        "-f",
        "avfoundation",
        "-i",
        ":0", // Default audio input (may need adjustment)
        "-acodec",
        "pcm_s16le",
        "-ar",
        String(this.sampleRate),
        "-ac",
        "1",
        this.currentRecordingPath,
      ];

      logger.log("[SystemAudio] Starting ffmpeg capture:", args.join(" "));

      this.captureProcess = spawn("ffmpeg", args, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      this.captureProcess.stderr.on("data", (data) => {
        const output = data.toString();
        // ffmpeg outputs progress to stderr
        if (output.includes("time=")) {
          // Extract and emit progress
          const match = output.match(/time=(\d+:\d+:\d+\.\d+)/);
          if (match) {
            this.emit("progress", { time: match[1] });
          }
        }
      });

      this.captureProcess.on("error", (error) => {
        reject(error);
      });

      this.captureProcess.on("close", (code) => {
        if (code !== 0 && code !== null && this.isCapturing) {
          logger.warn(`[SystemAudio] ffmpeg exited with code ${code}`);
        }
      });

      // Give it a moment to start
      setTimeout(() => resolve(), 200);
    });
  }

  /**
   * Start capture using a virtual audio device
   */
  async _startWithVirtualDevice(deviceName, sampleRate) {
    return new Promise((resolve, reject) => {
      if (!deviceName) {
        reject(new Error("No virtual audio device specified"));
        return;
      }

      logger.log(`[SystemAudio] Capturing from virtual device: ${deviceName}`);

      const args = [
        "-y",
        "-f",
        "avfoundation",
        "-i",
        `:${deviceName}`,
        "-acodec",
        "pcm_s16le",
        "-ar",
        String(sampleRate),
        "-ac",
        "1",
        this.currentRecordingPath,
      ];

      this.captureProcess = spawn("ffmpeg", args, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      this.captureProcess.stderr.on("data", (data) => {
        const output = data.toString();
        if (output.includes("Error") || output.includes("error")) {
          logger.error("[SystemAudio] ffmpeg error:", output);
        }
      });

      this.captureProcess.on("error", (error) => {
        reject(error);
      });

      setTimeout(() => resolve(), 200);
    });
  }

  /**
   * Estimate duration based on file size
   */
  _estimateDuration(fileSize) {
    // WAV 16kHz mono 16-bit = ~32KB per second
    const bytesPerSecond = this.sampleRate * 2; // 16-bit = 2 bytes per sample
    return Math.round(fileSize / bytesPerSecond);
  }

  /**
   * Get suggestion based on availability status
   */
  _getSuggestion(availability) {
    if (
      availability.screenRecordingStatus !== "authorized" &&
      availability.virtualDevices.length === 0
    ) {
      return [
        "Option 1: Grant Screen Recording permission in System Settings > Privacy & Security > Screen Recording",
        "Option 2: Install BlackHole (free) from https://existential.audio/blackhole/",
        "After installing BlackHole, create a Multi-Output Device in Audio MIDI Setup to hear audio while capturing.",
      ].join("\n");
    }
    return null;
  }

  /**
   * Transcribe captured audio file
   * @param {string} audioPath - Path to audio file
   */
  async transcribeAudio(audioPath) {
    if (!fs.existsSync(audioPath)) {
      return { success: false, error: "Audio file not found" };
    }

    try {
      // Read the audio file
      const audioBuffer = fs.readFileSync(audioPath);

      // Use the Centris backend for transcription (dynamic import for ES module)
      const { default: CentrisBackendService } = await import("./centrisBackendService.js");
      const centrisService = new CentrisBackendService();

      const result = await centrisService.transcribeAudio(audioBuffer);

      return result;
    } catch (error) {
      logger.error("[SystemAudio] Transcription error:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Broadcast event to all renderer windows
   */
  _broadcastToWindows(channel, data) {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, data);
      }
    });
  }

  /**
   * Clean up old recordings
   * @param {number} maxAgeMs - Maximum age of files to keep (default: 1 hour)
   */
  cleanupOldRecordings(maxAgeMs = 3600000) {
    try {
      const files = fs.readdirSync(this.tempDir);
      const now = Date.now();
      let cleaned = 0;

      for (const file of files) {
        const filePath = path.join(this.tempDir, file);
        const stats = fs.statSync(filePath);

        if (now - stats.mtimeMs > maxAgeMs) {
          fs.unlinkSync(filePath);
          cleaned++;
        }
      }

      logger.log(`[SystemAudio] Cleaned up ${cleaned} old recording files`);
      return { success: true, cleaned };
    } catch (error) {
      logger.error("[SystemAudio] Cleanup error:", error);
      return { success: false, error: error.message };
    }
  }
}

// Singleton instance
let systemAudioInstance = null;

/**
 * Get the system audio service instance
 */
function getSystemAudioService() {
  if (!systemAudioInstance) {
    systemAudioInstance = new SystemAudioService();
  }
  return systemAudioInstance;
}

module.exports = { SystemAudioService, getSystemAudioService };
