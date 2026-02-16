/**
 * PermissionMonitor - Main Process Permission Monitoring
 *
 * Monitors ALL system permissions during app runtime:
 * - Microphone: Voice dictation
 * - Accessibility: UI control, text insertion, hotkey detection
 * - Screen Recording: Screen capture for AI vision/OCR
 * - Input Monitoring: Global keyboard event monitoring
 *
 * Detects when permissions are revoked and handles graceful degradation.
 *
 * This runs in the Electron main process, not the renderer.
 */

const { systemPreferences } = require("electron");
const { spawn } = require("child_process");
const EventEmitter = require("events");

// node-mac-permissions is macOS-only - gracefully handle when not available
let permissions = null;
if (process.platform === "darwin") {
  try {
    permissions = require("node-mac-permissions");
  } catch (error) {
    console.warn("[PermissionMonitor] node-mac-permissions not available:", error.message);
  }
}

class PermissionMonitor extends EventEmitter {
  constructor() {
    super();
    this.isMonitoring = false;
    this.checkInterval = null;
    this.lastMicStatus = null;
    this.lastAccessibilityStatus = null;
    this.lastScreenRecordingStatus = null;
    this.lastInputMonitoringStatus = null;
    this.checkIntervalMs = 5000; // Check every 5 seconds
    this.platform = process.platform;
  }

  /**
   * Start monitoring permissions
   */
  start() {
    if (this.isMonitoring) {
      console.log("[PermissionMonitor] Already monitoring");
      return;
    }

    if (this.platform !== "darwin") {
      console.log("[PermissionMonitor] Not macOS, skipping permission monitoring");
      return;
    }

    console.log("[PermissionMonitor] Starting permission monitoring...");
    this.isMonitoring = true;

    // Initial check
    this.checkPermissions();

    // Periodic checks
    this.checkInterval = setInterval(() => {
      this.checkPermissions();
    }, this.checkIntervalMs);
  }

  /**
   * Stop monitoring permissions
   */
  stop() {
    if (!this.isMonitoring) {
      return;
    }

    console.log("[PermissionMonitor] Stopping permission monitoring...");
    this.isMonitoring = false;

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Check current permission status for ALL permissions
   */
  async checkPermissions() {
    if (this.platform !== "darwin") {
      return;
    }

    try {
      const [micStatus, accessibilityStatus, screenRecordingStatus, inputMonitoringStatus] =
        await Promise.all([
          this.checkMicrophonePermission(),
          this.checkAccessibilityPermission(),
          this.checkScreenRecordingPermission(),
          this.checkInputMonitoringPermission(),
        ]);

      const micGranted = micStatus.granted;
      const accessibilityGranted = accessibilityStatus.granted === true;
      const screenRecordingGranted = screenRecordingStatus.granted;
      const inputMonitoringGranted = inputMonitoringStatus.granted;

      // Detect changes
      const micChanged = this.lastMicStatus !== null && this.lastMicStatus !== micGranted;
      const accessibilityChanged =
        this.lastAccessibilityStatus !== null &&
        this.lastAccessibilityStatus !== accessibilityGranted;
      const screenRecordingChanged =
        this.lastScreenRecordingStatus !== null &&
        this.lastScreenRecordingStatus !== screenRecordingGranted;
      const inputMonitoringChanged =
        this.lastInputMonitoringStatus !== null &&
        this.lastInputMonitoringStatus !== inputMonitoringGranted;

      // Update last known status
      this.lastMicStatus = micGranted;
      this.lastAccessibilityStatus = accessibilityGranted;
      this.lastScreenRecordingStatus = screenRecordingGranted;
      this.lastInputMonitoringStatus = inputMonitoringGranted;

      // Emit events for changes
      if (micChanged) {
        this.emit("microphone-changed", {
          granted: micGranted,
          status: micStatus,
        });
      }

      if (accessibilityChanged) {
        this.emit("accessibility-changed", {
          granted: accessibilityGranted,
          status: accessibilityStatus,
        });
      }

      if (screenRecordingChanged) {
        this.emit("screen-recording-changed", {
          granted: screenRecordingGranted,
          status: screenRecordingStatus,
        });
      }

      if (inputMonitoringChanged) {
        this.emit("input-monitoring-changed", {
          granted: inputMonitoringGranted,
          status: inputMonitoringStatus,
        });
      }

      // All core permissions (mic + accessibility) plus optional advanced permissions
      const coreGranted = micGranted && accessibilityGranted;
      const advancedGranted = screenRecordingGranted && inputMonitoringGranted;

      // Emit overall status
      this.emit("permission-status", {
        microphone: micGranted,
        accessibility: accessibilityGranted,
        screenRecording: screenRecordingGranted,
        inputMonitoring: inputMonitoringGranted,
        coreGranted: coreGranted,
        advancedGranted: advancedGranted,
        allGranted: coreGranted && advancedGranted,
        microphoneStatus: micStatus,
        accessibilityStatus: accessibilityStatus,
        screenRecordingStatus: screenRecordingStatus,
        inputMonitoringStatus: inputMonitoringStatus,
      });

      // Log changes
      if (micChanged || accessibilityChanged || screenRecordingChanged || inputMonitoringChanged) {
        console.log("[PermissionMonitor] Permission status changed:", {
          microphone: micGranted ? "✅" : "❌",
          accessibility: accessibilityGranted ? "✅" : "❌",
          screenRecording: screenRecordingGranted ? "✅" : "❌",
          inputMonitoring: inputMonitoringGranted ? "✅" : "❌",
          micChanged,
          accessibilityChanged,
          screenRecordingChanged,
          inputMonitoringChanged,
        });
      }
    } catch (error) {
      console.error("[PermissionMonitor] Error checking permissions:", error);
    }
  }

  /**
   * Check microphone permission
   */
  async checkMicrophonePermission() {
    if (this.platform !== "darwin") {
      return { granted: true, canRequest: false };
    }

    try {
      // Use Electron's systemPreferences API (more reliable)
      const status = systemPreferences.getMediaAccessStatus("microphone");
      return {
        granted: status === "granted",
        canRequest: status === "not-determined",
        status: status,
      };
    } catch (error) {
      console.error("[PermissionMonitor] Error checking microphone permission:", error);
      return { granted: false, canRequest: false, error: error.message };
    }
  }

  /**
   * Check accessibility permission
   * Uses node-mac-permissions for TCC database check (most reliable)
   * Falls back to osascript test if needed
   */
  async checkAccessibilityPermission() {
    if (this.platform !== "darwin") {
      // Windows/Linux don't need explicit accessibility permissions
      return { granted: true, canRequest: false, status: "not-required" };
    }

    try {
      // Primary method: Use node-mac-permissions for TCC database check
      // This is more reliable than osascript in dev mode
      if (!permissions) {
        throw new Error("node-mac-permissions not available");
      }
      const status = permissions.getAuthStatus("accessibility");
      const granted = status === "authorized";

      return {
        granted,
        canRequest: false, // Accessibility can never be requested programmatically
        status: granted ? "authorized" : "denied",
        tccStatus: status,
        checkMethod: "node-mac-permissions",
        error: granted ? null : "Accessibility permission not granted in TCC database",
      };
    } catch (error) {
      console.error(
        "[PermissionMonitor] node-mac-permissions check failed, using osascript fallback:",
        error.message,
      );

      // Fallback: Use osascript test (less reliable in dev mode)
      return new Promise((resolve) => {
        const testProcess = spawn("osascript", [
          "-e",
          'tell application "System Events" to get name of first process',
        ]);

        let testError = "";
        let testOutput = "";

        testProcess.stdout.on("data", (data) => {
          testOutput += data.toString();
        });

        testProcess.stderr.on("data", (data) => {
          testError += data.toString();
        });

        testProcess.on("close", (code) => {
          const granted = code === 0 && !testError.includes("not allowed");
          const isDev = process.env.NODE_ENV === "development";

          resolve({
            granted,
            canRequest: false,
            status: granted ? "authorized" : "denied",
            checkMethod: "osascript-fallback",
            possibleFalsePositive: isDev && granted, // osascript may inherit Terminal permissions
            error: granted ? null : testError || "Accessibility permission not granted",
          });
        });

        testProcess.on("error", (error) => {
          resolve({
            granted: false,
            canRequest: false,
            status: "error",
            checkMethod: "osascript-error",
            error: error.message,
          });
        });
      });
    }
  }

  /**
   * Check screen recording permission
   * Uses node-mac-permissions for TCC database check
   */
  async checkScreenRecordingPermission() {
    if (this.platform !== "darwin") {
      // Windows/Linux don't need explicit screen recording permissions
      return { granted: true, canRequest: false, status: "not-required" };
    }

    try {
      if (!permissions) {
        throw new Error("node-mac-permissions not available");
      }
      // Use node-mac-permissions to check screen recording status
      const status = permissions.getAuthStatus("screen");
      const granted = status === "authorized";

      return {
        granted,
        canRequest: status === "not-determined",
        status: granted ? "authorized" : "denied",
        tccStatus: status,
        checkMethod: "node-mac-permissions",
        // Screen recording also enables system audio capture
        enablesSystemAudio: granted,
      };
    } catch (error) {
      console.error("[PermissionMonitor] Error checking screen recording permission:", error);
      return { granted: false, canRequest: false, error: error.message };
    }
  }

  /**
   * Check input monitoring permission (for global keyboard monitoring)
   * Uses node-mac-permissions for TCC database check
   */
  async checkInputMonitoringPermission() {
    if (this.platform !== "darwin") {
      // Windows/Linux don't need explicit input monitoring permissions
      return { granted: true, canRequest: false, status: "not-required" };
    }

    try {
      if (!permissions) {
        throw new Error("node-mac-permissions not available");
      }
      // Use node-mac-permissions to check input monitoring status
      const status = permissions.getAuthStatus("input-monitoring");
      const granted = status === "authorized";

      return {
        granted,
        canRequest: status === "not-determined",
        status: granted ? "authorized" : "denied",
        tccStatus: status,
        checkMethod: "node-mac-permissions",
        // Input monitoring levels
        canListen: granted, // Can receive keyboard events
        canPost: granted, // Can inject keyboard events (same permission on macOS 10.15+)
      };
    } catch (error) {
      console.error("[PermissionMonitor] Error checking input monitoring permission:", error);
      return { granted: false, canRequest: false, error: error.message };
    }
  }

  /**
   * Get current permission status (synchronous, uses last known values)
   */
  getStatus() {
    const coreGranted = this.lastMicStatus === true && this.lastAccessibilityStatus === true;
    const advancedGranted =
      this.lastScreenRecordingStatus === true && this.lastInputMonitoringStatus === true;

    return {
      microphone: this.lastMicStatus,
      accessibility: this.lastAccessibilityStatus,
      screenRecording: this.lastScreenRecordingStatus,
      inputMonitoring: this.lastInputMonitoringStatus,
      coreGranted: coreGranted,
      advancedGranted: advancedGranted,
      allGranted: coreGranted && advancedGranted,
    };
  }

  /**
   * Force a permission check (useful after user grants permission)
   */
  async forceCheck() {
    this.lastMicStatus = null;
    this.lastAccessibilityStatus = null;
    this.lastScreenRecordingStatus = null;
    this.lastInputMonitoringStatus = null;
    await this.checkPermissions();
    return this.getStatus();
  }
}

module.exports = PermissionMonitor;
