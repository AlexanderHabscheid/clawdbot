/**
 * AudioTestService - Main Process Audio Testing
 *
 * Provides actual microphone recording and playback testing for Centris AI.
 * This runs in the Electron main process and provides reliable permission verification.
 *
 * Features:
 * - List audio input devices
 * - Test microphone recording with actual audio capture
 * - Test audio playback
 * - Verify permissions with real-world tests
 */

const { systemPreferences, app } = require("electron");
const { spawn, exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const EventEmitter = require("events");

// Logger fallback
let logger;
try {
  const loggerModule = require("../utils/logger");
  logger = loggerModule.default || loggerModule;
} catch (e) {
  logger = { log: console.log, error: console.error, warn: console.warn };
}

class AudioTestService extends EventEmitter {
  constructor() {
    super();
    this.platform = process.platform;
    this.appName = app.getName();
    this.isDev = process.env.NODE_ENV === "development";
    this.tempDir = path.join(os.tmpdir(), "centris-audio-test");
    this.testRecordingPath = path.join(this.tempDir, "test-recording.wav");

    // Ensure temp directory exists
    this.ensureTempDir();
  }

  /**
   * Ensure temp directory exists for test recordings
   */
  ensureTempDir() {
    try {
      if (!fs.existsSync(this.tempDir)) {
        fs.mkdirSync(this.tempDir, { recursive: true });
      }
    } catch (error) {
      logger.error("[AudioTestService] Failed to create temp directory:", error);
    }
  }

  /**
   * Get list of available audio input devices
   * Uses macOS system_profiler for accurate device listing
   */
  async getAudioInputDevices() {
    if (this.platform !== "darwin") {
      return {
        success: true,
        devices: [{ name: "Default Microphone", id: "default", isDefault: true }],
        message: "Non-macOS platform - using default device",
      };
    }

    return new Promise((resolve) => {
      // Use system_profiler for accurate device listing on macOS
      exec("system_profiler SPAudioDataType -json", { timeout: 10000 }, (error, stdout) => {
        if (error) {
          // Fallback: try sox for device listing
          this.getAudioDevicesViaSox()
            .then(resolve)
            .catch(() => {
              resolve({
                success: true,
                devices: [{ name: "Default Microphone", id: "default", isDefault: true }],
                message: "Could not enumerate devices, using default",
                fallback: true,
              });
            });
          return;
        }

        try {
          const data = JSON.parse(stdout);
          const audioData = data.SPAudioDataType || [];
          const devices = [];

          audioData.forEach((item) => {
            // Look for input devices
            if (item._items) {
              item._items.forEach((device) => {
                if (
                  device.coreaudio_input_source ||
                  device._name?.toLowerCase().includes("input") ||
                  device._name?.toLowerCase().includes("microphone")
                ) {
                  devices.push({
                    name: device._name || "Unknown Device",
                    id: device.coreaudio_device_manufacturer || device._name || "unknown",
                    manufacturer: device.coreaudio_device_manufacturer || "Unknown",
                    isDefault: devices.length === 0,
                    source: device.coreaudio_input_source || "default",
                  });
                }
              });
            }
          });

          // If no devices found, add default
          if (devices.length === 0) {
            devices.push({ name: "Default Microphone", id: "default", isDefault: true });
          }

          resolve({
            success: true,
            devices,
            count: devices.length,
          });
        } catch (parseError) {
          resolve({
            success: true,
            devices: [{ name: "Default Microphone", id: "default", isDefault: true }],
            message: "Could not parse device list",
            fallback: true,
          });
        }
      });
    });
  }

  /**
   * Fallback device listing using sox
   */
  async getAudioDevicesViaSox() {
    return new Promise((resolve, reject) => {
      exec(
        "sox --help-format coreaudio 2>&1 | grep -i input",
        { timeout: 5000 },
        (error, stdout) => {
          if (stdout && stdout.trim()) {
            const devices = [{ name: "System Default", id: "default", isDefault: true }];
            resolve({ success: true, devices, source: "sox" });
          } else {
            reject(new Error("No devices found via sox"));
          }
        },
      );
    });
  }

  /**
   * Test microphone permission by actually recording audio
   * This is the most reliable test - if it works, permission is granted
   *
   * @param {number} durationSeconds - Duration to record (default 2 seconds)
   * @returns {Object} Test result with success status and details
   */
  async testMicrophoneRecording(durationSeconds = 2) {
    if (this.platform !== "darwin") {
      return { success: true, message: "Not macOS - recording assumed to work" };
    }

    // First check permission status
    const permStatus = systemPreferences.getMediaAccessStatus("microphone");
    logger.log(`[AudioTestService] Microphone status: ${permStatus}`);

    if (permStatus === "not-determined") {
      // Try to request permission
      try {
        const granted = await systemPreferences.askForMediaAccess("microphone");
        if (!granted) {
          return {
            success: false,
            message: "Microphone permission denied",
            permissionStatus: "denied",
            action: "Please grant microphone permission in System Settings",
          };
        }
      } catch (error) {
        return {
          success: false,
          message: `Failed to request permission: ${error.message}`,
          permissionStatus: "error",
        };
      }
    } else if (permStatus === "denied") {
      return {
        success: false,
        message: "Microphone permission denied",
        permissionStatus: "denied",
        action:
          "Please enable microphone access in System Settings > Privacy & Security > Microphone",
        appToEnable: this.isDev ? "Terminal, Cursor, or Electron" : this.appName,
      };
    }

    // Permission should be granted - now do the actual recording test
    return this.performRecordingTest(durationSeconds);
  }

  /**
   * Perform actual audio recording test using sox or ffmpeg
   */
  async performRecordingTest(durationSeconds = 2) {
    // Clean up any previous test recording
    this.cleanupTestFiles();

    // Try sox first (more commonly available on macOS)
    const soxResult = await this.recordWithSox(durationSeconds);
    if (soxResult.success) {
      return soxResult;
    }

    // Try ffmpeg as fallback
    const ffmpegResult = await this.recordWithFfmpeg(durationSeconds);
    if (ffmpegResult.success) {
      return ffmpegResult;
    }

    // Try rec (part of sox) as last resort
    const recResult = await this.recordWithRec(durationSeconds);
    if (recResult.success) {
      return recResult;
    }

    // All recording methods failed
    return {
      success: false,
      message: "Recording test failed - no audio recording tool available",
      details: "Install sox or ffmpeg: brew install sox ffmpeg",
      soxError: soxResult.error,
      ffmpegError: ffmpegResult.error,
      recError: recResult.error,
      permissionLikely: true, // If we got here, permission is likely granted but tools missing
    };
  }

  /**
   * Record audio using sox
   */
  async recordWithSox(durationSeconds) {
    return new Promise((resolve) => {
      const args = [
        "-d", // Use default audio device
        "-t",
        "wav", // Output format
        "-r",
        "16000", // Sample rate
        "-c",
        "1", // Mono
        "-b",
        "16", // 16-bit
        this.testRecordingPath, // Output file
        "trim",
        "0",
        String(durationSeconds), // Duration
      ];

      logger.log(`[AudioTestService] Testing with sox: sox ${args.join(" ")}`);

      const recordProcess = spawn("sox", args, { timeout: (durationSeconds + 5) * 1000 });

      let stderr = "";
      let stdout = "";

      recordProcess.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      recordProcess.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      recordProcess.on("error", (error) => {
        resolve({
          success: false,
          error: `sox not found: ${error.message}`,
          tool: "sox",
        });
      });

      recordProcess.on("close", (code) => {
        if (code === 0 && fs.existsSync(this.testRecordingPath)) {
          const stats = fs.statSync(this.testRecordingPath);
          const hasAudioData = stats.size > 1000; // More than header = has audio

          resolve({
            success: hasAudioData,
            message: hasAudioData
              ? `Recording successful! Captured ${stats.size} bytes`
              : "Recording file too small - no audio captured",
            tool: "sox",
            fileSize: stats.size,
            duration: durationSeconds,
            recordingPath: this.testRecordingPath,
            canPlayback: hasAudioData,
          });
        } else {
          resolve({
            success: false,
            error: stderr || "sox recording failed",
            code,
            tool: "sox",
          });
        }
      });
    });
  }

  /**
   * Record audio using ffmpeg
   */
  async recordWithFfmpeg(durationSeconds) {
    return new Promise((resolve) => {
      const args = [
        "-f",
        "avfoundation", // macOS audio framework
        "-i",
        ":0", // Default audio input (format is video:audio)
        "-t",
        String(durationSeconds), // Duration
        "-ar",
        "16000", // Sample rate
        "-ac",
        "1", // Mono
        "-y", // Overwrite output
        this.testRecordingPath,
      ];

      logger.log(`[AudioTestService] Testing with ffmpeg: ffmpeg ${args.join(" ")}`);

      const recordProcess = spawn("ffmpeg", args, { timeout: (durationSeconds + 5) * 1000 });

      let stderr = "";

      recordProcess.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      recordProcess.on("error", (error) => {
        resolve({
          success: false,
          error: `ffmpeg not found: ${error.message}`,
          tool: "ffmpeg",
        });
      });

      recordProcess.on("close", (code) => {
        if (code === 0 && fs.existsSync(this.testRecordingPath)) {
          const stats = fs.statSync(this.testRecordingPath);
          const hasAudioData = stats.size > 1000;

          resolve({
            success: hasAudioData,
            message: hasAudioData
              ? `Recording successful! Captured ${stats.size} bytes`
              : "Recording file too small - no audio captured",
            tool: "ffmpeg",
            fileSize: stats.size,
            duration: durationSeconds,
            recordingPath: this.testRecordingPath,
            canPlayback: hasAudioData,
          });
        } else {
          // Check for permission errors in stderr
          const permissionDenied =
            stderr.includes("not allowed") ||
            stderr.includes("permission") ||
            stderr.includes("access denied");

          resolve({
            success: false,
            error: permissionDenied
              ? "Permission denied"
              : stderr.substring(0, 500) || "ffmpeg recording failed",
            code,
            tool: "ffmpeg",
            permissionIssue: permissionDenied,
          });
        }
      });
    });
  }

  /**
   * Record audio using rec (part of sox)
   */
  async recordWithRec(durationSeconds) {
    return new Promise((resolve) => {
      const args = [
        "-r",
        "16000",
        "-c",
        "1",
        "-b",
        "16",
        this.testRecordingPath,
        "trim",
        "0",
        String(durationSeconds),
      ];

      logger.log(`[AudioTestService] Testing with rec: rec ${args.join(" ")}`);

      const recordProcess = spawn("rec", args, { timeout: (durationSeconds + 5) * 1000 });

      let stderr = "";

      recordProcess.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      recordProcess.on("error", (error) => {
        resolve({
          success: false,
          error: `rec not found: ${error.message}`,
          tool: "rec",
        });
      });

      recordProcess.on("close", (code) => {
        if (code === 0 && fs.existsSync(this.testRecordingPath)) {
          const stats = fs.statSync(this.testRecordingPath);
          const hasAudioData = stats.size > 1000;

          resolve({
            success: hasAudioData,
            message: hasAudioData
              ? `Recording successful! Captured ${stats.size} bytes`
              : "Recording file too small - no audio captured",
            tool: "rec",
            fileSize: stats.size,
            duration: durationSeconds,
            recordingPath: this.testRecordingPath,
            canPlayback: hasAudioData,
          });
        } else {
          resolve({
            success: false,
            error: stderr || "rec recording failed",
            code,
            tool: "rec",
          });
        }
      });
    });
  }

  /**
   * Play back the test recording
   * Returns success if audio plays without error
   */
  async testAudioPlayback() {
    if (this.platform !== "darwin") {
      return { success: true, message: "Not macOS - playback assumed to work" };
    }

    if (!fs.existsSync(this.testRecordingPath)) {
      return {
        success: false,
        message: "No test recording available. Run recording test first.",
        needsRecording: true,
      };
    }

    // Try afplay (built into macOS)
    const afplayResult = await this.playWithAfplay();
    if (afplayResult.success) {
      return afplayResult;
    }

    // Try sox play
    const soxPlayResult = await this.playWithSox();
    if (soxPlayResult.success) {
      return soxPlayResult;
    }

    return {
      success: false,
      message: "Playback test failed",
      afplayError: afplayResult.error,
      soxPlayError: soxPlayResult.error,
    };
  }

  /**
   * Play audio using afplay (built into macOS)
   */
  async playWithAfplay() {
    return new Promise((resolve) => {
      const playProcess = spawn("afplay", [this.testRecordingPath], { timeout: 10000 });

      let stderr = "";

      playProcess.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      playProcess.on("error", (error) => {
        resolve({
          success: false,
          error: `afplay error: ${error.message}`,
          tool: "afplay",
        });
      });

      playProcess.on("close", (code) => {
        resolve({
          success: code === 0,
          message: code === 0 ? "Audio playback successful!" : "Playback failed",
          tool: "afplay",
          error: code !== 0 ? stderr : null,
        });
      });
    });
  }

  /**
   * Play audio using sox
   */
  async playWithSox() {
    return new Promise((resolve) => {
      const playProcess = spawn("play", [this.testRecordingPath], { timeout: 10000 });

      let stderr = "";

      playProcess.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      playProcess.on("error", (error) => {
        resolve({
          success: false,
          error: `play error: ${error.message}`,
          tool: "sox play",
        });
      });

      playProcess.on("close", (code) => {
        resolve({
          success: code === 0,
          message: code === 0 ? "Audio playback successful!" : "Playback failed",
          tool: "sox play",
          error: code !== 0 ? stderr : null,
        });
      });
    });
  }

  /**
   * Play a system sound to test audio output
   * This doesn't require a test recording
   */
  async playSystemSound() {
    if (this.platform !== "darwin") {
      return { success: true, message: "Not macOS - sound test skipped" };
    }

    return new Promise((resolve) => {
      // Use afplay with a system sound
      const systemSounds = [
        "/System/Library/Sounds/Ping.aiff",
        "/System/Library/Sounds/Pop.aiff",
        "/System/Library/Sounds/Glass.aiff",
        "/System/Library/Sounds/Tink.aiff",
      ];

      // Find first available sound
      const soundPath = systemSounds.find((p) => fs.existsSync(p));

      if (!soundPath) {
        resolve({
          success: false,
          message: "No system sounds found",
        });
        return;
      }

      const playProcess = spawn("afplay", [soundPath], { timeout: 5000 });

      playProcess.on("error", (error) => {
        resolve({
          success: false,
          error: `Sound test error: ${error.message}`,
        });
      });

      playProcess.on("close", (code) => {
        resolve({
          success: code === 0,
          message: code === 0 ? "System sound played successfully!" : "Sound test failed",
          soundPlayed: soundPath,
        });
      });
    });
  }

  /**
   * Get comprehensive audio test results
   * Tests: permission status, recording capability, playback capability
   */
  async runFullAudioTest() {
    logger.log("[AudioTestService] Running full audio test...");

    const results = {
      timestamp: new Date().toISOString(),
      platform: this.platform,
      appName: this.appName,
      isDev: this.isDev,
      tests: {},
    };

    // 1. Check permission status
    if (this.platform === "darwin") {
      const permStatus = systemPreferences.getMediaAccessStatus("microphone");
      results.tests.permissionStatus = {
        status: permStatus,
        granted: permStatus === "granted",
        canRequest: permStatus === "not-determined",
      };
    } else {
      results.tests.permissionStatus = { granted: true, status: "not-applicable" };
    }

    // 2. List audio devices
    const devices = await this.getAudioInputDevices();
    results.tests.audioDevices = devices;

    // 3. Test recording (if permission is granted or can be requested)
    if (results.tests.permissionStatus.granted || results.tests.permissionStatus.canRequest) {
      const recordTest = await this.testMicrophoneRecording(2);
      results.tests.recording = recordTest;

      // 4. Test playback (only if recording succeeded)
      if (recordTest.success && recordTest.canPlayback) {
        const playbackTest = await this.testAudioPlayback();
        results.tests.playback = playbackTest;
      } else {
        results.tests.playback = {
          skipped: true,
          reason: "Recording test did not produce playable audio",
        };
      }
    } else {
      results.tests.recording = {
        skipped: true,
        reason: "Microphone permission not granted",
      };
      results.tests.playback = {
        skipped: true,
        reason: "Recording test skipped",
      };
    }

    // 5. Test system sound (independent of microphone)
    const systemSoundTest = await this.playSystemSound();
    results.tests.systemSound = systemSoundTest;

    // Overall result
    results.success = results.tests.recording?.success === true;
    results.summary = this.generateSummary(results);

    logger.log("[AudioTestService] Full audio test complete:", results.summary);

    return results;
  }

  /**
   * Generate human-readable summary
   */
  generateSummary(results) {
    const parts = [];

    if (results.tests.permissionStatus?.granted) {
      parts.push("✅ Microphone permission granted");
    } else {
      parts.push("❌ Microphone permission not granted");
    }

    if (results.tests.recording?.success) {
      parts.push(`✅ Recording works (${results.tests.recording.tool})`);
    } else if (results.tests.recording?.skipped) {
      parts.push(`⏭️ Recording skipped: ${results.tests.recording.reason}`);
    } else {
      parts.push("❌ Recording failed");
    }

    if (results.tests.playback?.success) {
      parts.push("✅ Playback works");
    } else if (results.tests.playback?.skipped) {
      parts.push("⏭️ Playback skipped");
    } else {
      parts.push("❌ Playback failed");
    }

    if (results.tests.systemSound?.success) {
      parts.push("✅ Audio output works");
    }

    return parts.join(" | ");
  }

  /**
   * Clean up test recording files
   */
  cleanupTestFiles() {
    try {
      if (fs.existsSync(this.testRecordingPath)) {
        fs.unlinkSync(this.testRecordingPath);
      }
    } catch (error) {
      logger.warn("[AudioTestService] Could not cleanup test files:", error);
    }
  }

  /**
   * Get permission troubleshooting instructions
   */
  getTroubleshootingInstructions() {
    if (this.platform !== "darwin") {
      return { instructions: [], note: "Not macOS" };
    }

    const instructions = [];

    if (this.isDev) {
      instructions.push({
        title: "⚠️ Development Mode Notice",
        description:
          'When running in development mode, permissions are associated with the terminal/IDE that launched the app (e.g., "Cursor", "Terminal", "iTerm").',
        steps: [
          "Open System Settings > Privacy & Security > Microphone",
          'Look for "Cursor", "Terminal", "iTerm", or "Electron"',
          "Enable microphone access for the app that launched Centris",
          "Restart the app after granting permission",
        ],
      });

      instructions.push({
        title: "🚀 For Proper Permissions",
        description: "Build and install the app to get its own permission entry:",
        steps: [
          "Run: npm run build",
          "Install from: dist/Centris AI-*.dmg",
          'The installed app will request permissions as "Centris AI"',
        ],
      });
    } else {
      instructions.push({
        title: "Grant Microphone Permission",
        description: "Centris AI needs microphone access for voice commands.",
        steps: [
          "Open System Settings > Privacy & Security > Microphone",
          'Find "Centris AI" in the list',
          "Toggle the switch to enable microphone access",
          "Return to Centris AI",
        ],
      });
    }

    instructions.push({
      title: "Grant Accessibility Permission",
      description:
        "Centris AI needs accessibility access for keyboard shortcuts and text insertion.",
      steps: [
        "Open System Settings > Privacy & Security > Accessibility",
        "Click the lock icon to make changes (enter password)",
        `Find "${this.isDev ? "Electron or Cursor" : "Centris AI"}" in the list`,
        "Check the box to enable accessibility",
        "Return to Centris AI",
      ],
    });

    return {
      instructions,
      isDev: this.isDev,
      appName: this.appName,
    };
  }
}

module.exports = AudioTestService;
