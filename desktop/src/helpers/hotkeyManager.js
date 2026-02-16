const { globalShortcut } = require("electron");
// Handle ES module interop - logger might be exported as { default: Logger }
const loggerModule = require("../utils/logger");
const logger = loggerModule.default || loggerModule;

class HotkeyManager {
  constructor(globeKeyManager = null) {
    // Default hotkey is Fn/Globe key alone on macOS (like Wispr Flow)
    // On Windows, use Ctrl+` (backtick) - handled by WindowsHotkeyManager in main.js
    // On Linux, use backtick
    this.currentHotkey =
      process.platform === "darwin" ? "GLOBE" : process.platform === "win32" ? "WINDOWS" : "`";
    this.isInitialized = false;
    this.globeKeyManager = globeKeyManager; // Reference to GlobeKeyManager for native Fn key support
  }

  setGlobeKeyManager(globeKeyManager) {
    this.globeKeyManager = globeKeyManager;
  }

  setupShortcuts(hotkey = "`", callback) {
    if (!callback) {
      // For GLOBE/Fn keys, callback is optional since events are handled in main.js
      if (hotkey !== "GLOBE" && hotkey !== "FN" && hotkey !== "Fn") {
        throw new Error("Callback function is required for hotkey setup");
      }
    }

    // Stop GlobeKeyManager if switching away from GLOBE
    if (
      this.currentHotkey === "GLOBE" &&
      hotkey !== "GLOBE" &&
      hotkey !== "FN" &&
      hotkey !== "Fn"
    ) {
      if (this.globeKeyManager) {
        this.globeKeyManager.stop();
        logger.log("[HotkeyManager] Stopped GlobeKeyManager (switching to different hotkey)");
      }
    }

    // Unregister previous globalShortcut if switching away from it
    if (
      this.currentHotkey &&
      this.currentHotkey !== "GLOBE" &&
      this.currentHotkey !== "FN" &&
      this.currentHotkey !== "Fn"
    ) {
      globalShortcut.unregister(this.currentHotkey);
    }

    try {
      // Support Globe/Fn key alone (like Wispr Flow) - macOS only
      if (hotkey === "GLOBE" || hotkey === "FN" || hotkey === "Fn") {
        if (process.platform !== "darwin") {
          return {
            success: false,
            error: "The Globe/Fn key is only available on macOS.",
          };
        }

        // Start GlobeKeyManager for native Fn key detection
        if (this.globeKeyManager) {
          logger.log("[HotkeyManager] Starting GlobeKeyManager for native Fn key support...");
          this.globeKeyManager
            .start()
            .then(() => {
              logger.log("[HotkeyManager] ✅ GlobeKeyManager started successfully");
            })
            .catch((error) => {
              // Log but don't fail - globe key will start when accessibility permission is granted
              logger.log("[HotkeyManager] GlobeKeyManager start deferred:", error.message);
            });
        } else {
          logger.warn("[HotkeyManager] GlobeKeyManager not available - GLOBE hotkey may not work");
        }

        this.currentHotkey = hotkey;
        logger.log(`[HotkeyManager] Hotkey set to: ${hotkey}`);
        return { success: true, hotkey };
      }

      // Support Windows hotkey (Ctrl+`) - handled by WindowsHotkeyManager in main.js
      if (hotkey === "WINDOWS" || hotkey === "WIN") {
        if (process.platform !== "win32") {
          return {
            success: false,
            error: "The Windows hotkey mode is only available on Windows.",
          };
        }

        // WindowsHotkeyManager is initialized in main.js
        this.currentHotkey = hotkey;
        logger.log(`[HotkeyManager] Hotkey set to: ${hotkey} (Ctrl+\` on Windows)`);
        return { success: true, hotkey };
      }

      // Register the new hotkey with globalShortcut
      const success = globalShortcut.register(hotkey, callback);

      if (success) {
        this.currentHotkey = hotkey;
        return { success: true, hotkey };
      } else {
        console.error(`Failed to register hotkey: ${hotkey}`);
        return {
          success: false,
          error: `Failed to register hotkey: ${hotkey}`,
        };
      }
    } catch (error) {
      logger.error("Error setting up shortcuts:", error);
      return { success: false, error: error.message };
    }
  }

  async initializeHotkey(mainWindow, callback) {
    if (!mainWindow || !callback) {
      throw new Error("mainWindow and callback are required");
    }

    // Store mainWindow reference for use in callbacks
    this.mainWindow = mainWindow;

    // Set up default hotkey - Fn/Globe key alone on macOS, Windows hotkey on Windows, backtick on others
    const defaultHotkey =
      process.platform === "darwin" ? "GLOBE" : process.platform === "win32" ? "WINDOWS" : "`";
    this.setupShortcuts(defaultHotkey, callback);

    // Listen for window to be ready, then get saved hotkey
    mainWindow.webContents.once("did-finish-load", () => {
      setTimeout(() => {
        this.loadSavedHotkey(mainWindow, callback);
      }, 1000);
    });

    this.isInitialized = true;
  }

  async loadSavedHotkey(mainWindow, callback) {
    try {
      const defaultHotkey =
        process.platform === "darwin" ? "GLOBE" : process.platform === "win32" ? "WINDOWS" : "`";
      const savedHotkey = await mainWindow.webContents.executeJavaScript(`
        localStorage.getItem("dictationKey") || "${defaultHotkey}"
      `);

      // Ensure we never use "A" as a hotkey - change to default if found
      const hotkeyToUse =
        savedHotkey && savedHotkey !== "`" && savedHotkey !== "A" ? savedHotkey : defaultHotkey;

      if (hotkeyToUse && hotkeyToUse !== this.currentHotkey) {
        const result = this.setupShortcuts(hotkeyToUse, callback);
        if (result.success) {
          // Hotkey initialized from localStorage
        }
      }
    } catch (err) {
      logger.error("Failed to get saved hotkey:", err);
    }
  }

  async updateHotkey(hotkey, callback) {
    if (!callback) {
      throw new Error("Callback function is required for hotkey update");
    }

    // Prevent using "A" as hotkey - change to backtick if attempted
    if (hotkey === "A" || hotkey === "a") {
      logger.warn("Hotkey 'A' is not allowed. Using backtick instead.");
      hotkey = "`";
    }

    try {
      const result = this.setupShortcuts(hotkey, callback);
      if (result.success) {
        return { success: true, message: `Hotkey updated to: ${hotkey}` };
      } else {
        return { success: false, message: result.error };
      }
    } catch (error) {
      logger.error("Failed to update hotkey:", error);
      return {
        success: false,
        message: `Failed to update hotkey: ${error.message}`,
      };
    }
  }

  getCurrentHotkey() {
    return this.currentHotkey;
  }

  unregisterAll() {
    globalShortcut.unregisterAll();
    // Stop GlobeKeyManager if it's running
    if (this.globeKeyManager && this.currentHotkey === "GLOBE") {
      this.globeKeyManager.stop();
    }
    // Note: WindowsHotkeyManager is handled in main.js
  }

  isHotkeyRegistered(hotkey) {
    return globalShortcut.isRegistered(hotkey);
  }
}

module.exports = HotkeyManager;
