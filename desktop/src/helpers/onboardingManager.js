const { exec } = require("child_process");
const { shell } = require("electron");
const permissions = require("node-mac-permissions");
// Handle ES module interop - logger might be exported as { default: Logger }
const loggerModule = require("../utils/logger");
const logger = loggerModule.default || loggerModule;

/**
 * Reliable macOS System Settings/Preferences opener
 * Works on both old System Preferences and new System Settings (Ventura+)
 *
 * Supports ALL permission types:
 * - microphone: Voice dictation
 * - accessibility: UI control, text insertion
 * - screen: Screen recording for AI vision
 * - input: Input monitoring for keyboard events
 */
class OnboardingManager {
  constructor() {
    this.platform = process.platform;
  }

  /**
   * Opens macOS System Settings/Preferences to a specific privacy pane
   * @param {string} pane - 'microphone', 'accessibility', 'screen', or 'input'
   * @returns {Promise<boolean>} - true if successful
   */
  async openSystemPrivacyPane(pane) {
    if (this.platform !== "darwin") {
      logger.warn("[OnboardingManager] Not macOS, skipping System Settings");
      return false;
    }

    const urls = {
      microphone: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
      accessibility:
        "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
      screen: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
      input: "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent",
      "input-monitoring":
        "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent",
      "screen-recording":
        "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
    };

    const url = urls[pane];
    if (!url) {
      console.error(`[OnboardingManager] Unknown pane: ${pane}`);
      return false;
    }

    logger.log(`[OnboardingManager] Opening ${pane} privacy pane...`);

    // Method 1: Use 'open' command (most reliable on macOS)
    return new Promise((resolve) => {
      exec(`open "${url}"`, (error) => {
        if (!error) {
          logger.log(`[OnboardingManager] Successfully opened using 'open' command`);
          resolve(true);
          return;
        }

        logger.log(`[OnboardingManager] 'open' command failed, trying shell.openExternal...`);

        // Method 2: Try shell.openExternal
        shell
          .openExternal(url)
          .then(() => {
            logger.log(`[OnboardingManager] Successfully opened using shell.openExternal`);
            resolve(true);
          })
          .catch((err) => {
            console.error(`[OnboardingManager] shell.openExternal failed:`, err);

            // Method 3: Last resort - open System Settings app directly
            logger.log(`[OnboardingManager] Opening System Settings app directly...`);
            exec("open -b com.apple.systempreferences", (error2) => {
              if (error2) {
                // Try with System Settings (Ventura+)
                exec("open -b com.apple.systempreferences", () => {
                  logger.log(
                    `[OnboardingManager] Opened System Settings app (user must navigate manually)`,
                  );
                  resolve(false); // Not ideal, but app is open
                });
              } else {
                resolve(false); // App opened but not to specific pane
              }
            });
          });
      });
    });
  }

  /**
   * Check microphone permission status
   */
  async checkMicrophonePermission() {
    if (this.platform !== "darwin") {
      return { granted: true, canRequest: false };
    }

    try {
      const status = permissions.getAuthStatus("microphone");
      return {
        granted: status === "authorized",
        canRequest: status === "not-determined",
        status: status,
      };
    } catch (error) {
      console.error("[OnboardingManager] Error checking microphone permission:", error);
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
      const status = await permissions.askForMicrophoneAccess();
      const granted = status === "authorized";

      if (!granted) {
        // Open System Settings if not granted
        await this.openSystemPrivacyPane("microphone");
      }

      return { granted };
    } catch (error) {
      console.error("[OnboardingManager] Error requesting microphone permission:", error);
      await this.openSystemPrivacyPane("microphone");
      return { granted: false, error: error.message };
    }
  }

  /**
   * Check accessibility permission status
   */
  async checkAccessibilityPermission() {
    if (this.platform !== "darwin") {
      return { granted: true, canRequest: false };
    }

    try {
      const status = permissions.getAuthStatus("accessibility");
      return {
        granted: status === "authorized",
        canRequest: false, // Can't programmatically request, user must enable manually
        status: status,
      };
    } catch (error) {
      console.error("[OnboardingManager] Error checking accessibility permission:", error);

      // Fallback: Try using AppleScript to test if we can control System Events
      return new Promise((resolve) => {
        exec(
          "osascript -e 'tell application \"System Events\" to get name of first process'",
          (error2) => {
            const granted = error2 === null;
            resolve({
              granted,
              canRequest: false,
              status: granted ? "authorized" : "denied",
            });
          },
        );
      });
    }
  }

  /**
   * Request accessibility permission (opens System Settings)
   */
  async requestAccessibilityPermission() {
    if (this.platform !== "darwin") {
      return { granted: true };
    }

    // Accessibility can't be requested programmatically, must open System Settings
    await this.openSystemPrivacyPane("accessibility");

    // Check current status
    const status = await this.checkAccessibilityPermission();
    return { granted: status.granted };
  }

  /**
   * Check screen recording permission status
   */
  async checkScreenRecordingPermission() {
    if (this.platform !== "darwin") {
      return { granted: true, canRequest: false };
    }

    try {
      const status = permissions.getAuthStatus("screen");
      return {
        granted: status === "authorized",
        canRequest: status === "not-determined",
        status: status,
      };
    } catch (error) {
      console.error("[OnboardingManager] Error checking screen recording permission:", error);
      return { granted: false, canRequest: false, error: error.message };
    }
  }

  /**
   * Request screen recording permission
   */
  async requestScreenRecordingPermission() {
    if (this.platform !== "darwin") {
      return { granted: true };
    }

    try {
      // Screen recording can be prompted via askForScreenCaptureAccess
      const status = await permissions.askForScreenCaptureAccess();
      const granted = status === "authorized";

      if (!granted) {
        // Open System Settings if not granted
        await this.openSystemPrivacyPane("screen");
      }

      return { granted };
    } catch (error) {
      console.error("[OnboardingManager] Error requesting screen recording permission:", error);
      await this.openSystemPrivacyPane("screen");
      return { granted: false, error: error.message };
    }
  }

  /**
   * Check input monitoring permission status
   */
  async checkInputMonitoringPermission() {
    if (this.platform !== "darwin") {
      return { granted: true, canRequest: false };
    }

    try {
      const status = permissions.getAuthStatus("input-monitoring");
      return {
        granted: status === "authorized",
        canRequest: status === "not-determined",
        status: status,
      };
    } catch (error) {
      console.error("[OnboardingManager] Error checking input monitoring permission:", error);
      return { granted: false, canRequest: false, error: error.message };
    }
  }

  /**
   * Request input monitoring permission
   * @param {string} accessLevel - 'listen' (receive events) or 'post' (inject events)
   */
  async requestInputMonitoringPermission(accessLevel = "listen") {
    if (this.platform !== "darwin") {
      return { granted: true };
    }

    try {
      // Input monitoring can be prompted via askForInputMonitoringAccess
      const status = await permissions.askForInputMonitoringAccess(accessLevel);
      const granted = status === "authorized";

      if (!granted) {
        // Open System Settings if not granted
        await this.openSystemPrivacyPane("input");
      }

      return { granted, accessLevel };
    } catch (error) {
      console.error("[OnboardingManager] Error requesting input monitoring permission:", error);
      await this.openSystemPrivacyPane("input");
      return { granted: false, error: error.message };
    }
  }

  /**
   * Check all permissions at once (core + advanced)
   */
  async checkAllPermissions() {
    const [mic, accessibility, screenRecording, inputMonitoring] = await Promise.all([
      this.checkMicrophonePermission(),
      this.checkAccessibilityPermission(),
      this.checkScreenRecordingPermission(),
      this.checkInputMonitoringPermission(),
    ]);

    const coreGranted = mic.granted && accessibility.granted;
    const advancedGranted = screenRecording.granted && inputMonitoring.granted;

    return {
      // Core permissions (required for basic functionality)
      microphone: mic.granted,
      accessibility: accessibility.granted,
      coreGranted: coreGranted,

      // Advanced permissions (required for AI vision, keyboard monitoring)
      screenRecording: screenRecording.granted,
      inputMonitoring: inputMonitoring.granted,
      advancedGranted: advancedGranted,

      // All permissions
      allGranted: coreGranted && advancedGranted,

      // Detailed status
      microphoneStatus: mic,
      accessibilityStatus: accessibility,
      screenRecordingStatus: screenRecording,
      inputMonitoringStatus: inputMonitoring,
    };
  }

  /**
   * Request all core permissions (microphone + accessibility)
   */
  async requestCorePermissions() {
    const mic = await this.requestMicrophonePermission();
    const accessibility = await this.requestAccessibilityPermission();

    return {
      microphone: mic.granted,
      accessibility: accessibility.granted,
      coreGranted: mic.granted && accessibility.granted,
    };
  }

  /**
   * Request all advanced permissions (screen recording + input monitoring)
   */
  async requestAdvancedPermissions() {
    const screenRecording = await this.requestScreenRecordingPermission();
    const inputMonitoring = await this.requestInputMonitoringPermission();

    return {
      screenRecording: screenRecording.granted,
      inputMonitoring: inputMonitoring.granted,
      advancedGranted: screenRecording.granted && inputMonitoring.granted,
    };
  }
}

module.exports = OnboardingManager;
