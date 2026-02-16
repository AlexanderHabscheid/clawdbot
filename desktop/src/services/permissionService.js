/**
 * PermissionService - Comprehensive macOS Permission Handling
 *
 * Handles microphone and accessibility permissions for Centris AI.
 * Includes real-time testing, status checking, and user guidance.
 */

const { systemPreferences, app, shell } = require("electron");
const { exec, spawn } = require("child_process");
const permissions = require("node-mac-permissions");
const EventEmitter = require("events");
const loggerModule = require("../utils/logger");
const logger = loggerModule.default || loggerModule;

class PermissionService extends EventEmitter {
  constructor() {
    super();
    this.platform = process.platform;
    this.appName = app.getName();
    this.isDev = process.env.NODE_ENV === "development";
  }

  /**
   * Get comprehensive permission status for ALL permissions
   */
  async getStatus() {
    if (this.platform !== "darwin") {
      return {
        microphone: true,
        accessibility: true,
        screenRecording: true,
        inputMonitoring: true,
        coreGranted: true,
        advancedGranted: true,
        allGranted: true,
        platform: this.platform,
      };
    }

    const [micStatus, accessibilityStatus, screenStatus, inputStatus] = await Promise.all([
      this.checkMicrophonePermission(),
      this.checkAccessibilityPermission(),
      this.checkScreenRecordingPermission(),
      this.checkInputMonitoringPermission(),
    ]);

    const coreGranted = micStatus.granted && accessibilityStatus.granted;
    const advancedGranted = screenStatus.granted && inputStatus.granted;

    return {
      // Core permissions
      microphone: micStatus.granted,
      accessibility: accessibilityStatus.granted,
      coreGranted: coreGranted,

      // Advanced permissions
      screenRecording: screenStatus.granted,
      inputMonitoring: inputStatus.granted,
      advancedGranted: advancedGranted,

      // All permissions
      allGranted: coreGranted && advancedGranted,

      // Detailed status
      microphoneStatus: micStatus,
      accessibilityStatus: accessibilityStatus,
      screenRecordingStatus: screenStatus,
      inputMonitoringStatus: inputStatus,

      appName: this.appName,
      isDev: this.isDev,
    };
  }

  /**
   * Check screen recording permission
   */
  async checkScreenRecordingPermission() {
    if (this.platform !== "darwin") {
      return { granted: true, canRequest: false, status: "granted" };
    }

    try {
      const status = permissions.getAuthStatus("screen");
      const granted = status === "authorized";

      logger.log(`[PermissionService] Screen recording status: ${status}`);

      return {
        granted,
        canRequest: status === "not-determined",
        status: status,
        // Screen recording also enables system audio capture
        enablesSystemAudio: granted,
      };
    } catch (error) {
      logger.error("[PermissionService] Error checking screen recording:", error);
      return { granted: false, canRequest: false, error: error.message };
    }
  }

  /**
   * Check input monitoring permission
   */
  async checkInputMonitoringPermission() {
    if (this.platform !== "darwin") {
      return { granted: true, canRequest: false, status: "granted" };
    }

    try {
      const status = permissions.getAuthStatus("input-monitoring");
      const granted = status === "authorized";

      logger.log(`[PermissionService] Input monitoring status: ${status}`);

      return {
        granted,
        canRequest: status === "not-determined",
        status: status,
      };
    } catch (error) {
      logger.error("[PermissionService] Error checking input monitoring:", error);
      return { granted: false, canRequest: false, error: error.message };
    }
  }

  /**
   * Check microphone permission using multiple methods
   */
  async checkMicrophonePermission() {
    if (this.platform !== "darwin") {
      return { granted: true, canRequest: false, status: "granted" };
    }

    try {
      // Primary method: Use Electron's systemPreferences (most reliable)
      const electronStatus = systemPreferences.getMediaAccessStatus("microphone");
      const granted = electronStatus === "granted";
      const canRequest = electronStatus === "not-determined";

      logger.log(`[PermissionService] Microphone status (Electron): ${electronStatus}`);

      // Secondary check: Use node-mac-permissions for TCC database status
      let tccStatus = null;
      try {
        tccStatus = permissions.getAuthStatus("microphone");
        logger.log(`[PermissionService] Microphone status (TCC): ${tccStatus}`);
      } catch (e) {
        // Silent fail - Electron status is sufficient
      }

      return {
        granted,
        canRequest,
        status: electronStatus,
        tccStatus: tccStatus,
      };
    } catch (error) {
      logger.error("[PermissionService] Error checking microphone:", error);
      return { granted: false, canRequest: false, error: error.message };
    }
  }

  /**
   * Request microphone permission
   */
  async requestMicrophonePermission() {
    if (this.platform !== "darwin") {
      return { granted: true };
    }

    try {
      // First try Electron's built-in method
      const granted = await systemPreferences.askForMediaAccess("microphone");
      logger.log(`[PermissionService] Microphone request result: ${granted}`);

      if (!granted) {
        // If not granted, open System Settings
        await this.openSystemSettings("microphone");
      }

      return { granted };
    } catch (error) {
      logger.error("[PermissionService] Error requesting microphone:", error);

      // Fallback: Open System Settings
      await this.openSystemSettings("microphone");
      return { granted: false, error: error.message };
    }
  }

  /**
   * Test microphone by actually accessing it
   * This is the only 100% reliable test
   * Uses AudioTestService for comprehensive testing
   */
  async testMicrophone() {
    if (this.platform !== "darwin") {
      return { success: true, message: "Not macOS" };
    }

    try {
      // Use AudioTestService for comprehensive recording test
      const AudioTestService = require("./audioTestService");
      const audioTestService = new AudioTestService();

      // Perform actual recording test (2 seconds)
      const result = await audioTestService.testMicrophoneRecording(2);

      return {
        success: result.success,
        message:
          result.message || (result.success ? "Microphone recording works!" : "Recording failed"),
        tool: result.tool,
        fileSize: result.fileSize,
        canPlayback: result.canPlayback,
        permissionStatus: result.permissionStatus,
        action: result.action,
        appToEnable: result.appToEnable,
      };
    } catch (error) {
      logger.error("[PermissionService] Microphone test error:", error);

      // Fallback to FFmpeg device listing
      return this._testMicrophoneWithFfmpeg();
    }
  }

  /**
   * Fallback microphone test using FFmpeg device listing
   */
  async _testMicrophoneWithFfmpeg() {
    return new Promise((resolve) => {
      // Use FFmpeg to test microphone access
      // This is a real test that requires actual permission
      const testProcess = spawn(
        "ffmpeg",
        ["-f", "avfoundation", "-list_devices", "true", "-i", ""],
        { timeout: 5000 },
      );

      let output = "";
      let hasAudioDevice = false;

      testProcess.stderr.on("data", (data) => {
        output += data.toString();
        // Look for audio input devices in the output
        if (output.includes("[AVFoundation") && output.includes("audio")) {
          hasAudioDevice = true;
        }
      });

      testProcess.on("close", () => {
        // FFmpeg always exits with error for -list_devices, that's expected
        resolve({
          success: hasAudioDevice,
          message: hasAudioDevice
            ? "Audio devices accessible"
            : "No audio devices found or permission denied",
          output: output.substring(0, 500), // First 500 chars for debugging
          tool: "ffmpeg",
        });
      });

      testProcess.on("error", (err) => {
        // FFmpeg not installed - fall back to Electron API check
        resolve({
          success: false,
          message: "FFmpeg not available for real test. Install with: brew install ffmpeg",
          fallback: true,
          tool: "none",
        });
      });

      // Timeout after 3 seconds
      setTimeout(() => {
        testProcess.kill();
        resolve({
          success: false,
          message: "Microphone test timed out",
          tool: "ffmpeg-timeout",
        });
      }, 3000);
    });
  }

  /**
   * Check accessibility permission using multiple methods
   */
  async checkAccessibilityPermission() {
    if (this.platform !== "darwin") {
      return { granted: true, canRequest: false, status: "granted" };
    }

    try {
      // Primary method: node-mac-permissions TCC database check
      // This is more reliable than osascript in dev mode
      const tccStatus = permissions.getAuthStatus("accessibility");
      const granted = tccStatus === "authorized";

      logger.log(`[PermissionService] Accessibility status (TCC): ${tccStatus}`);

      return {
        granted,
        canRequest: false, // Accessibility can never be requested programmatically
        status: granted ? "authorized" : "denied",
        tccStatus: tccStatus,
        needsManualEnable: !granted,
        appToEnable: this.isDev ? "Electron" : this.appName,
      };
    } catch (error) {
      logger.error(
        "[PermissionService] TCC check failed, using osascript fallback:",
        error.message,
      );

      // Fallback: Use osascript test
      // WARNING: This may give false positives in dev mode (inherits from Terminal)
      return this._checkAccessibilityWithOsascript();
    }
  }

  /**
   * Fallback accessibility check using osascript
   */
  async _checkAccessibilityWithOsascript() {
    return new Promise((resolve) => {
      const testProcess = spawn("osascript", [
        "-e",
        'tell application "System Events" to get name of first process',
      ]);

      let errorOutput = "";

      testProcess.stderr.on("data", (data) => {
        errorOutput += data.toString();
      });

      testProcess.on("close", (code) => {
        const granted = code === 0 && !errorOutput.includes("not allowed");

        if (this.isDev && granted) {
          logger.warn(
            "[PermissionService] osascript check returned granted in dev mode - may be false positive",
          );
        }

        resolve({
          granted,
          canRequest: false,
          status: granted ? "authorized" : "denied",
          checkMethod: "osascript",
          possibleFalsePositive: this.isDev && granted,
          appToEnable: this.isDev ? "Electron" : this.appName,
        });
      });

      testProcess.on("error", (err) => {
        resolve({
          granted: false,
          canRequest: false,
          status: "error",
          error: err.message,
        });
      });
    });
  }

  /**
   * Test accessibility by attempting to use it
   * This performs a real accessibility action to verify permission
   */
  async testAccessibility() {
    if (this.platform !== "darwin") {
      return { success: true, message: "Not macOS" };
    }

    return new Promise((resolve) => {
      // Try to get the frontmost application name
      // This requires actual accessibility permission
      const testProcess = spawn("osascript", [
        "-e",
        'tell application "System Events" to get name of first application process whose frontmost is true',
      ]);

      let stdout = "";
      let stderr = "";

      testProcess.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      testProcess.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      testProcess.on("close", (code) => {
        const success = code === 0 && stdout.trim().length > 0 && !stderr.includes("not allowed");

        resolve({
          success,
          message: success
            ? `Accessibility working (frontmost app: ${stdout.trim()})`
            : "Accessibility permission required",
          appToEnable: this.isDev ? "Electron" : this.appName,
        });
      });

      testProcess.on("error", (err) => {
        resolve({
          success: false,
          message: `Test failed: ${err.message}`,
        });
      });

      // Timeout
      setTimeout(() => {
        testProcess.kill();
        resolve({
          success: false,
          message: "Accessibility test timed out",
        });
      }, 3000);
    });
  }

  /**
   * Request accessibility permission (opens System Settings)
   */
  async requestAccessibilityPermission() {
    if (this.platform !== "darwin") {
      return { granted: true };
    }

    // Accessibility cannot be requested programmatically
    // We must open System Settings and guide the user
    await this.openSystemSettings("accessibility");

    // Check current status
    const status = await this.checkAccessibilityPermission();
    return {
      granted: status.granted,
      message: status.granted
        ? "Accessibility permission granted"
        : `Please enable "${status.appToEnable}" in Accessibility settings`,
      appToEnable: status.appToEnable,
    };
  }

  /**
   * Prompt the user to add the app to accessibility
   * Uses a more aggressive approach for first-time setup
   */
  async promptAccessibilityPermission() {
    if (this.platform !== "darwin") {
      return { granted: true };
    }

    // On macOS Monterey+, we can try to trigger the accessibility prompt
    // by performing an action that requires it
    return new Promise((resolve) => {
      // This AppleScript will trigger the accessibility dialog if not granted
      const triggerScript = `
        tell application "System Events"
          try
            keystroke ""
          on error
            -- This triggers the accessibility prompt
          end try
        end tell
      `;

      exec(`osascript -e '${triggerScript}'`, async (error) => {
        // Wait a moment for the prompt to appear
        await new Promise((r) => setTimeout(r, 500));

        // Open System Settings regardless
        await this.openSystemSettings("accessibility");

        // Check status
        const status = await this.checkAccessibilityPermission();
        resolve({
          granted: status.granted,
          promptTriggered: true,
          appToEnable: status.appToEnable,
        });
      });
    });
  }

  /**
   * Open System Settings to a specific privacy pane
   */
  async openSystemSettings(pane) {
    if (this.platform !== "darwin") {
      return { success: false, reason: "Not macOS" };
    }

    const urls = {
      microphone: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
      accessibility:
        "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
      screen: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
      input: "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent",
    };

    const url = urls[pane] || urls.accessibility;

    logger.log(`[PermissionService] Opening System Settings: ${pane}`);

    return new Promise((resolve) => {
      exec(`open "${url}"`, (error) => {
        if (!error) {
          logger.log(`[PermissionService] Opened ${pane} settings successfully`);
          resolve({ success: true });
          return;
        }

        // Fallback to shell.openExternal
        shell
          .openExternal(url)
          .then(() => {
            logger.log(`[PermissionService] Opened via shell.openExternal`);
            resolve({ success: true });
          })
          .catch((err) => {
            logger.error(`[PermissionService] Failed to open settings:`, err);
            resolve({ success: false, error: err.message });
          });
      });
    });
  }

  /**
   * Get user-friendly instructions for granting permissions
   */
  getInstructions(permission) {
    const appName = this.isDev ? "Cursor, Terminal, or Electron" : this.appName;

    if (permission === "microphone") {
      return {
        title: "Microphone Access Required",
        steps: [
          'Click "Grant Access" to open System Settings',
          `Find "${appName}" in the list`,
          "Toggle the switch to enable microphone access",
          "Return to Centris AI",
        ],
        note: this.isDev
          ? '⚠️ Development Mode: Look for "Cursor", "Terminal", "iTerm", or "Electron" in the list - permissions are inherited from the app that launched Centris AI.'
          : null,
        devNote: this.isDev
          ? 'To test with proper "Centris AI" permissions, build and install the app: npm run build'
          : null,
      };
    }

    if (permission === "accessibility") {
      return {
        title: "Accessibility Access Required",
        steps: [
          'Click "Open Settings" to open System Settings',
          "You may need to click the lock icon 🔒 to make changes",
          `Find "${appName}" in the list`,
          "Check the box or toggle the switch to enable",
          "Return to Centris AI",
        ],
        note: this.isDev
          ? '⚠️ Development Mode: Look for "Cursor", "Terminal", "iTerm", or "Electron" in the accessibility list. Permissions are inherited from the app that launched Centris AI.'
          : "If you don't see Centris AI in the list, try running the app again after granting permission",
        devNote: this.isDev
          ? 'To test with proper "Centris AI" permissions, build and install the app: npm run build'
          : null,
      };
    }

    if (permission === "screen-recording" || permission === "screen") {
      return {
        title: "Screen Recording Access",
        steps: [
          'Click "Enable" to open System Settings',
          "Navigate to Privacy & Security → Screen Recording",
          "You may need to click the lock icon 🔒 to make changes",
          `Find "${appName}" in the list`,
          "Toggle the switch to enable screen recording",
          "Return to Centris AI",
        ],
        note: this.isDev
          ? '⚠️ Development Mode: Look for "Cursor", "Terminal", "iTerm", or "Electron" in the screen recording list.'
          : "Screen Recording also enables system audio capture for meeting transcription.",
        benefits: [
          "Enables AI vision for visual context awareness",
          "OCR text extraction from any application",
          "System audio capture for meeting transcription",
          "Visual grounding for UI automation",
        ],
      };
    }

    if (permission === "input-monitoring" || permission === "input") {
      return {
        title: "Input Monitoring Access",
        steps: [
          'Click "Enable" to open System Settings',
          "Navigate to Privacy & Security → Input Monitoring",
          "You may need to click the lock icon 🔒 to make changes",
          `Find "${appName}" in the list`,
          "Toggle the switch to enable input monitoring",
          "Return to Centris AI",
        ],
        note: this.isDev
          ? '⚠️ Development Mode: Look for "Cursor", "Terminal", "iTerm", or "Electron" in the input monitoring list.'
          : "Input Monitoring enables keyboard context awareness for smarter AI assistance.",
        benefits: [
          "Typing context for better AI suggestions",
          "Smart autocomplete based on what you type",
          "Command and shortcut detection",
          "Workflow pattern recognition",
        ],
        privacy:
          "All keyboard data is processed locally. Centris never sends your keystrokes to external servers.",
      };
    }

    return null;
  }

  /**
   * Get comprehensive troubleshooting information
   */
  getTroubleshootingInfo() {
    return {
      isDev: this.isDev,
      appName: this.appName,
      platform: this.platform,
      bundleId: this.isDev ? "development (inherited)" : "com.centris.app",
      permissionNote: this.isDev
        ? "In development mode, macOS associates permissions with the parent process (Terminal, Cursor, etc.) instead of the app itself. Build and install the app for proper permission handling."
        : 'Permissions are associated with "Centris AI".',
      howToFix: this.isDev
        ? [
            "1. For microphone: Open System Settings > Privacy & Security > Microphone",
            '2. Enable access for "Cursor", "Terminal", or whichever app launched the development server',
            "3. For accessibility: Open System Settings > Privacy & Security > Accessibility",
            '4. Enable access for "Cursor", "Terminal", or "Electron"',
            "",
            '💡 For proper "Centris AI" permissions:',
            "   - Run: npm run build",
            "   - Install from: dist/Centris AI-*.dmg",
            "   - The installed app will have its own permission entries",
          ]
        : [
            "1. For microphone: Open System Settings > Privacy & Security > Microphone",
            '2. Find "Centris AI" and enable access',
            "3. For accessibility: Open System Settings > Privacy & Security > Accessibility",
            '4. Find "Centris AI" and enable access',
            "5. Restart Centris AI after granting permissions",
          ],
    };
  }
}

module.exports = PermissionService;
