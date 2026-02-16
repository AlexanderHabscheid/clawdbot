/**
 * Windows Hotkey Manager for Centris
 *
 * Provides push-to-talk hotkey support on Windows using Electron's globalShortcut
 * and low-level keyboard hooks for more advanced key combinations.
 *
 * Default hotkey: Ctrl+` (backtick) - easy to press, similar to Globe key on macOS
 * Alternative: Ctrl+Shift+Space
 */

const { globalShortcut, app } = require("electron");
const EventEmitter = require("events");
const loggerModule = require("../utils/logger");
const logger = loggerModule.default || loggerModule;

// Available hotkey options for Windows
const WINDOWS_HOTKEYS = {
  CTRL_BACKTICK: "Control+`",
  CTRL_SHIFT_SPACE: "Control+Shift+Space",
  CTRL_SHIFT_D: "Control+Shift+D",
  F13: "F13", // For keyboards with extra function keys
  SCROLL_LOCK: "ScrollLock", // Rarely used key
};

class WindowsHotkeyManager extends EventEmitter {
  constructor() {
    super();
    this.isSupported = process.platform === "win32";
    this.currentHotkey = WINDOWS_HOTKEYS.CTRL_BACKTICK;
    this.isKeyDown = false;
    this.isStarted = false;
    this.keyDownHandler = null;
    this.keyUpHandler = null;
  }

  /**
   * Get available hotkey options
   */
  static getAvailableHotkeys() {
    return Object.entries(WINDOWS_HOTKEYS).map(([key, value]) => ({
      id: key,
      accelerator: value,
      label: value.replace("Control", "Ctrl"),
    }));
  }

  /**
   * Set the hotkey to use
   */
  setHotkey(hotkeyId) {
    const accelerator = WINDOWS_HOTKEYS[hotkeyId];
    if (!accelerator) {
      logger.warn(`[WindowsHotkeyManager] Unknown hotkey ID: ${hotkeyId}`);
      return false;
    }

    const wasStarted = this.isStarted;
    if (wasStarted) {
      this.stop();
    }

    this.currentHotkey = accelerator;
    logger.log(`[WindowsHotkeyManager] Hotkey set to: ${accelerator}`);

    if (wasStarted) {
      this.start();
    }

    return true;
  }

  /**
   * Start listening for the hotkey
   */
  async start() {
    if (!this.isSupported) {
      logger.debug("[WindowsHotkeyManager] Not on Windows, skipping");
      return;
    }

    if (this.isStarted) {
      logger.debug("[WindowsHotkeyManager] Already started");
      return;
    }

    logger.log(`[WindowsHotkeyManager] Starting with hotkey: ${this.currentHotkey}`);

    try {
      // For push-to-talk, we need both keydown and keyup events
      // Electron's globalShortcut only fires once, so we use a workaround:
      // Register the shortcut and use a timer to detect release

      const registered = globalShortcut.register(this.currentHotkey, () => {
        this.handleKeyEvent();
      });

      if (!registered) {
        logger.error(`[WindowsHotkeyManager] Failed to register hotkey: ${this.currentHotkey}`);
        this.emit("error", new Error(`Failed to register hotkey: ${this.currentHotkey}`));
        return;
      }

      this.isStarted = true;
      logger.log(`[WindowsHotkeyManager] ✅ Hotkey registered: ${this.currentHotkey}`);
      logger.log("[WindowsHotkeyManager] Press and hold to dictate, release to stop");
    } catch (error) {
      logger.error("[WindowsHotkeyManager] Failed to start:", error);
      this.emit("error", error);
    }
  }

  /**
   * Handle key event (toggle mode since globalShortcut doesn't support keyup)
   */
  handleKeyEvent() {
    if (!this.isKeyDown) {
      // Key pressed - start dictation
      this.isKeyDown = true;
      logger.log("[WindowsHotkeyManager] 🎯 HOTKEY DOWN - starting dictation");
      this.emit("hotkey-down");

      // Start monitoring for key release
      this.startReleaseMonitor();
    }
  }

  /**
   * Monitor for key release using a polling approach
   * This is a workaround since Electron globalShortcut doesn't provide keyup
   */
  startReleaseMonitor() {
    // For toggle mode: pressing the hotkey again stops dictation
    // We'll also implement a timeout as safety

    // Clear any existing monitor
    if (this.releaseCheckInterval) {
      clearInterval(this.releaseCheckInterval);
    }

    // Use native keyboard state checking via PowerShell
    // This checks if the Ctrl key is still held down
    const { spawn } = require("child_process");

    this.releaseCheckInterval = setInterval(() => {
      // Check if Ctrl is still pressed using PowerShell
      const checkProcess = spawn(
        "powershell",
        [
          "-Command",
          "[System.Windows.Forms.Control]::ModifierKeys -band [System.Windows.Forms.Keys]::Control",
        ],
        { windowsHide: true },
      );

      let output = "";
      checkProcess.stdout.on("data", (data) => {
        output += data.toString();
      });

      checkProcess.on("close", () => {
        // If Ctrl is no longer pressed, emit keyup
        if (!output.includes("Control")) {
          this.handleKeyRelease();
        }
      });

      checkProcess.on("error", () => {
        // On error, just continue - don't break the monitoring
      });
    }, 100); // Check every 100ms

    // Safety timeout - auto-release after 60 seconds
    this.safetyTimeout = setTimeout(() => {
      if (this.isKeyDown) {
        logger.warn("[WindowsHotkeyManager] Safety timeout - auto-releasing");
        this.handleKeyRelease();
      }
    }, 60000);
  }

  /**
   * Handle key release
   */
  handleKeyRelease() {
    if (this.isKeyDown) {
      this.isKeyDown = false;

      // Clean up monitors
      if (this.releaseCheckInterval) {
        clearInterval(this.releaseCheckInterval);
        this.releaseCheckInterval = null;
      }
      if (this.safetyTimeout) {
        clearTimeout(this.safetyTimeout);
        this.safetyTimeout = null;
      }

      logger.log("[WindowsHotkeyManager] 🛑 HOTKEY UP - stopping dictation");
      this.emit("hotkey-up");
    }
  }

  /**
   * Stop listening for hotkeys
   */
  stop() {
    if (!this.isStarted) {
      return;
    }

    logger.log("[WindowsHotkeyManager] Stopping...");

    try {
      globalShortcut.unregister(this.currentHotkey);
    } catch (error) {
      logger.debug("[WindowsHotkeyManager] Error unregistering:", error.message);
    }

    // Clean up monitors
    if (this.releaseCheckInterval) {
      clearInterval(this.releaseCheckInterval);
      this.releaseCheckInterval = null;
    }
    if (this.safetyTimeout) {
      clearTimeout(this.safetyTimeout);
      this.safetyTimeout = null;
    }

    this.isStarted = false;
    this.isKeyDown = false;
    logger.log("[WindowsHotkeyManager] ✅ Stopped");
  }

  /**
   * Force stop dictation (manual release)
   */
  forceRelease() {
    this.handleKeyRelease();
  }
}

// Alternative: Simple toggle-based hotkey manager (more reliable)
class WindowsToggleHotkeyManager extends EventEmitter {
  constructor() {
    super();
    this.isSupported = process.platform === "win32";
    this.currentHotkey = WINDOWS_HOTKEYS.CTRL_BACKTICK;
    this.isRecording = false;
    this.isStarted = false;
  }

  static getAvailableHotkeys() {
    return Object.entries(WINDOWS_HOTKEYS).map(([key, value]) => ({
      id: key,
      accelerator: value,
      label: value.replace("Control", "Ctrl"),
    }));
  }

  setHotkey(hotkeyId) {
    const accelerator = WINDOWS_HOTKEYS[hotkeyId];
    if (!accelerator) {
      return false;
    }

    const wasStarted = this.isStarted;
    if (wasStarted) {
      this.stop();
    }
    this.currentHotkey = accelerator;
    if (wasStarted) {
      this.start();
    }
    return true;
  }

  async start() {
    if (!this.isSupported || this.isStarted) {
      return;
    }

    logger.log(`[WindowsToggleHotkeyManager] Starting with hotkey: ${this.currentHotkey}`);

    try {
      const registered = globalShortcut.register(this.currentHotkey, () => {
        this.toggle();
      });

      if (!registered) {
        logger.error(`[WindowsToggleHotkeyManager] Failed to register: ${this.currentHotkey}`);
        this.emit("error", new Error(`Failed to register hotkey`));
        return;
      }

      this.isStarted = true;
      logger.log(`[WindowsToggleHotkeyManager] ✅ Registered: ${this.currentHotkey}`);
      logger.log("[WindowsToggleHotkeyManager] Press to start/stop dictation (toggle mode)");
    } catch (error) {
      logger.error("[WindowsToggleHotkeyManager] Failed to start:", error);
      this.emit("error", error);
    }
  }

  toggle() {
    if (!this.isRecording) {
      this.isRecording = true;
      logger.log("[WindowsToggleHotkeyManager] 🎯 START dictation");
      this.emit("hotkey-down");
    } else {
      this.isRecording = false;
      logger.log("[WindowsToggleHotkeyManager] 🛑 STOP dictation");
      this.emit("hotkey-up");
    }
  }

  stop() {
    if (!this.isStarted) {
      return;
    }

    try {
      globalShortcut.unregister(this.currentHotkey);
    } catch (error) {
      logger.debug("[WindowsToggleHotkeyManager] Unregister error:", error.message);
    }

    this.isStarted = false;
    this.isRecording = false;
    logger.log("[WindowsToggleHotkeyManager] ✅ Stopped");
  }

  forceRelease() {
    if (this.isRecording) {
      this.toggle();
    }
  }
}

// Export both managers - toggle mode is more reliable for Windows
module.exports = WindowsToggleHotkeyManager;
module.exports.WindowsHotkeyManager = WindowsHotkeyManager;
module.exports.WindowsToggleHotkeyManager = WindowsToggleHotkeyManager;
module.exports.WINDOWS_HOTKEYS = WINDOWS_HOTKEYS;
