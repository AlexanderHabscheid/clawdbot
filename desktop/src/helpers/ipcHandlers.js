const { ipcMain, app, shell, BrowserWindow, screen, systemPreferences } = require("electron");
const AppUtils = require("../utils");
const debugLogger = require("./debugLogger");
// Handle ES module interop - logger might be exported as { default: Logger }
const loggerModule = require("../utils/logger");
const logger = loggerModule.default || loggerModule;
const path = require("path");
// CentrisBackendService is loaded dynamically where needed (ES module)
const AudioTestService = require(path.join(__dirname, "../services/audioTestService"));
const { backendManager } = require("./backendManager");

const ACTION_API_SPEC_VERSION = "2026-02-19";
const ACTION_API_TIMEOUT_MS = 30000;
const LOCAL_GATEWAY_FALLBACK_URL = "http://127.0.0.1:18789";

class IPCHandlers {
  constructor(managers) {
    this.environmentManager = managers.environmentManager;
    this.databaseManager = managers.databaseManager;
    this.clipboardManager = managers.clipboardManager;
    this.windowManager = managers.windowManager;
    this.setupHandlers();
  }

  setupHandlers() {
    // Window control handlers (for control panel window)
    ipcMain.handle("window-minimize", () => {
      if (
        this.windowManager.controlPanelWindow &&
        !this.windowManager.controlPanelWindow.isDestroyed()
      ) {
        this.windowManager.controlPanelWindow.minimize();
      }
    });

    ipcMain.handle("window-maximize", () => {
      if (
        this.windowManager.controlPanelWindow &&
        !this.windowManager.controlPanelWindow.isDestroyed()
      ) {
        if (this.windowManager.controlPanelWindow.isMaximized()) {
          this.windowManager.controlPanelWindow.unmaximize();
        } else {
          this.windowManager.controlPanelWindow.maximize();
        }
      }
    });

    ipcMain.handle("window-close", () => {
      if (
        this.windowManager.controlPanelWindow &&
        !this.windowManager.controlPanelWindow.isDestroyed()
      ) {
        // On macOS, minimize instead of close
        if (process.platform === "darwin") {
          this.windowManager.controlPanelWindow.minimize();
        } else {
          this.windowManager.controlPanelWindow.close();
        }
      }
    });

    ipcMain.handle("window-is-maximized", () => {
      if (
        this.windowManager.controlPanelWindow &&
        !this.windowManager.controlPanelWindow.isDestroyed()
      ) {
        return this.windowManager.controlPanelWindow.isMaximized();
      }
      return false;
    });

    ipcMain.handle("hide-window", () => {
      if (process.platform === "darwin") {
        this.windowManager.hideDictationPanel();
        if (app.dock) {
          app.dock.show();
        }
      } else {
        this.windowManager.hideDictationPanel();
      }
    });

    ipcMain.handle("show-dictation-panel", () => {
      this.windowManager.showDictationPanel();
    });

    ipcMain.handle("set-main-window-interactivity", (event, shouldCapture) => {
      this.windowManager.setMainWindowInteractivity(Boolean(shouldCapture));
      return { success: true };
    });

    // Handle pill UI window interactivity (for click-through control)
    // CRITICAL: Must handle ALL pill windows for multi-monitor support
    ipcMain.handle("set-pill-ui-interactivity", (event, shouldCapture) => {
      let handledCount = 0;

      // Handle all pill windows in the array (multi-monitor support)
      if (this.windowManager.pillUIWindows && this.windowManager.pillUIWindows.length > 0) {
        this.windowManager.pillUIWindows.forEach((win, index) => {
          if (win && !win.isDestroyed()) {
            if (shouldCapture) {
              // Disable click-through when interacting with pill
              win.setIgnoreMouseEvents(false);
            } else {
              // Enable click-through when not interacting
              win.setIgnoreMouseEvents(true, { forward: true });
            }
            handledCount++;
          }
        });
      }

      // Also handle legacy single window for backwards compatibility
      if (this.windowManager.pillUIWindow && !this.windowManager.pillUIWindow.isDestroyed()) {
        // Only handle if not already in the array
        const isInArray = this.windowManager.pillUIWindows?.includes(
          this.windowManager.pillUIWindow,
        );
        if (!isInArray) {
          if (shouldCapture) {
            this.windowManager.pillUIWindow.setIgnoreMouseEvents(false);
          } else {
            this.windowManager.pillUIWindow.setIgnoreMouseEvents(true, { forward: true });
          }
          handledCount++;
        }
      }

      if (handledCount > 0) {
        return { success: true, windowsHandled: handledCount };
      }
      return { success: false, error: "No pill UI windows available" };
    });

    // Create pill UI window (for showing alongside preferences)
    ipcMain.handle("create-pill-ui-window", async (event) => {
      try {
        logger.log("[IPC] create-pill-ui-window called");

        // Check if pill UI window already exists
        if (this.windowManager.pillUIWindow && !this.windowManager.pillUIWindow.isDestroyed()) {
          logger.log("[IPC] Pill UI window already exists, ensuring visibility...");
          // Ensure it's visible
          if (!this.windowManager.pillUIWindow.isVisible()) {
            this.windowManager.pillUIWindow.show();
          }
          this.windowManager.pillUIWindow.moveTop();
          this.windowManager.pillUIWindow.setAlwaysOnTop(true, "floating", 1);
          return { success: true, message: "Pill UI window already exists and is now visible" };
        }

        // Create new pill UI window
        logger.log("[IPC] Creating new pill UI window...");
        await this.windowManager.createPillUIWindow();

        // Wait a moment to ensure window is created
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Verify window was created
        if (this.windowManager.pillUIWindow && !this.windowManager.pillUIWindow.isDestroyed()) {
          logger.log("[IPC] ✅ Pill UI window created successfully");
          return { success: true, message: "Pill UI window created" };
        } else {
          logger.error("[IPC] ❌ Pill UI window was not created");
          return { success: false, error: "Pill UI window was not created" };
        }
      } catch (error) {
        logger.error("[IPC] Error creating pill UI window:", error);
        return { success: false, error: error.message };
      }
    });

    // Environment handlers
    ipcMain.handle("get-openai-key", async (event) => {
      return this.environmentManager.getOpenAIKey();
    });

    ipcMain.handle("save-openai-key", async (event, key) => {
      return this.environmentManager.saveOpenAIKey(key);
    });

    ipcMain.handle("create-production-env-file", async (event, apiKey) => {
      return this.environmentManager.createProductionEnvFile(apiKey);
    });

    ipcMain.handle("save-settings", async (event, settings) => {
      try {
        // Save settings to environment and localStorage
        if (settings.apiKey) {
          await this.environmentManager.saveOpenAIKey(settings.apiKey);
        }
        return { success: true };
      } catch (error) {
        logger.error("Failed to save settings:", error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("db-save-transcription", async (event, text) => {
      const result = this.databaseManager.saveTranscription(text);
      if (result?.success && result?.transcription) {
        setImmediate(() => {
          this.broadcastToWindows("transcription-added", result.transcription);
        });
      }
      return result;
    });

    ipcMain.handle("db-get-transcriptions", async (event, limit = 50) => {
      return this.databaseManager.getTranscriptions(limit);
    });

    ipcMain.handle("db-clear-transcriptions", async (event) => {
      const result = this.databaseManager.clearTranscriptions();
      if (result?.success) {
        setImmediate(() => {
          this.broadcastToWindows("transcriptions-cleared", {
            cleared: result.cleared,
          });
        });
      }
      return result;
    });

    ipcMain.handle("db-delete-transcription", async (event, id) => {
      const result = this.databaseManager.deleteTranscription(id);
      if (result?.success) {
        setImmediate(() => {
          this.broadcastToWindows("transcription-deleted", { id });
        });
      }
      return result;
    });

    // Clipboard handlers
    // Primary paste handler - uses direct text injection for dictation (no clipboard conflict!)
    ipcMain.handle("paste-text", async (event, text, options = {}) => {
      // Default to dictation source which uses direct injection
      const pasteOptions = { source: "dictation", ...options };
      return this.clipboardManager.pasteText(text, pasteOptions);
    });

    // Explicit direct injection paste (guaranteed no clipboard usage)
    ipcMain.handle("inject-text-directly", async (event, text) => {
      return this.clipboardManager.injectTextDirectly(text);
    });

    // Explicit clipboard-based paste (for when clipboard is needed)
    ipcMain.handle("paste-text-via-clipboard", async (event, text) => {
      return this.clipboardManager.pasteTextViaClipboard(text);
    });

    ipcMain.handle("read-clipboard", async (event) => {
      return this.clipboardManager.readClipboard();
    });

    ipcMain.handle("write-clipboard", async (event, text) => {
      return this.clipboardManager.writeClipboard(text);
    });

    // Configure clipboard manager settings
    ipcMain.handle("set-direct-injection-enabled", async (event, enabled) => {
      this.clipboardManager.setDirectInjectionEnabled(enabled);
      return { success: true, enabled };
    });

    ipcMain.handle("get-clipboard-settings", async (event) => {
      return this.clipboardManager.getSettings();
    });

    // Test direct injection (for debugging)
    ipcMain.handle("test-direct-injection", async (event, testText) => {
      return this.clipboardManager.testDirectInjection(testText);
    });

    // Whisper handlers removed - using Centris backend instead

    // Centris backend transcription handler
    ipcMain.handle("transcribe-centris-audio", async (event, audioData) => {
      try {
        // Validate and convert audio data to Buffer
        // Accept Buffer, Uint8Array, ArrayBuffer, or array of bytes
        let audioBuffer;
        if (!audioData) {
          return {
            success: false,
            error: "No audio data provided",
          };
        }

        if (Buffer.isBuffer(audioData)) {
          audioBuffer = audioData;
        } else if (audioData instanceof Uint8Array || ArrayBuffer.isView(audioData)) {
          audioBuffer = Buffer.from(audioData);
        } else if (audioData instanceof ArrayBuffer) {
          audioBuffer = Buffer.from(audioData);
        } else if (Array.isArray(audioData)) {
          audioBuffer = Buffer.from(audioData);
        } else {
          return {
            success: false,
            error: "Invalid audio data format. Expected Buffer, Uint8Array, or ArrayBuffer.",
          };
        }

        // Validate size (max 10MB)
        const MAX_AUDIO_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
        if (audioBuffer.length > MAX_AUDIO_SIZE_BYTES) {
          return {
            success: false,
            error: `Audio file too large. Maximum size is ${MAX_AUDIO_SIZE_BYTES / (1024 * 1024)}MB.`,
          };
        }

        // Dynamic import for ES module compatibility
        const { default: CentrisBackendService } =
          await import("../services/centrisBackendService.js");
        const centrisService = new CentrisBackendService();

        // Check backend health first
        const isHealthy = await centrisService.checkHealth();
        if (!isHealthy) {
          return {
            success: false,
            error:
              "Centris backend is not available. Make sure the backend is running on http://127.0.0.1:5001",
          };
        }

        // Convert Buffer to Blob for transcription
        const audioBlob = new Blob([audioBuffer], { type: "audio/wav" });
        const result = await centrisService.transcribeAudio(audioBlob);

        debugLogger.log("Centris transcription result", {
          success: result.success,
          hasText: !!result.text,
          error: result.error,
        });

        return result;
      } catch (error) {
        debugLogger.error("Centris transcription error", error);
        return {
          success: false,
          error: error.message || "Transcription failed",
        };
      }
    });

    // Whisper-related handlers removed - using Centris backend instead

    // Utility handlers
    ipcMain.handle("cleanup-app", async (event) => {
      try {
        AppUtils.cleanup(this.windowManager.mainWindow);
        return { success: true, message: "Cleanup completed successfully" };
      } catch (error) {
        throw error;
      }
    });

    ipcMain.handle("update-hotkey", async (event, hotkey) => {
      // Validate hotkey format
      if (!hotkey || typeof hotkey !== "string") {
        return {
          success: false,
          error: "Invalid hotkey format",
        };
      }

      // Prevent using single letter keys that could conflict
      if (hotkey.length === 1 && /^[a-zA-Z]$/.test(hotkey)) {
        return {
          success: false,
          error:
            "Single letter keys are not allowed. Please use a modifier key combination or function key.",
        };
      }

      return await this.windowManager.updateHotkey(hotkey);
    });

    // Onboarding handlers
    ipcMain.handle("get-onboarding-status", async (event) => {
      // Use localStorage via renderer instead of database
      // Send message to renderer to check localStorage
      if (this.windowManager.mainWindow && !this.windowManager.mainWindow.isDestroyed()) {
        try {
          const completed = await this.windowManager.mainWindow.webContents.executeJavaScript(
            `localStorage.getItem('onboarding_completed') === 'true'`,
          );
          return completed || false;
        } catch (error) {
          logger.error("Error getting onboarding status:", error);
          return false; // Default to showing onboarding
        }
      }
      return false; // Default to showing onboarding
    });

    ipcMain.handle("complete-onboarding", async (event) => {
      // Update both localStorage (for React) and electron-store (for main process)
      try {
        // Update localStorage in renderer
        if (this.windowManager.mainWindow && !this.windowManager.mainWindow.isDestroyed()) {
          await this.windowManager.mainWindow.webContents.executeJavaScript(
            `localStorage.setItem('onboarding_completed', 'true')`,
          );
        }

        // Also update electron-store for consistency
        const Store = require("electron-store");
        const store = new Store();
        store.set("hasCompletedOnboarding", true);

        return { success: true };
      } catch (error) {
        logger.error("Error completing onboarding:", error);
        return { success: false, error: error.message };
      }
    });

    // Complete preferences (save preferences_completed flag)
    ipcMain.handle("complete-preferences", async (event) => {
      try {
        // Update localStorage in renderer
        if (this.windowManager.mainWindow && !this.windowManager.mainWindow.isDestroyed()) {
          await this.windowManager.mainWindow.webContents.executeJavaScript(
            `localStorage.setItem('preferences_completed', 'true')`,
          );
        }

        // Also update electron-store for consistency
        const Store = require("electron-store");
        const store = new Store();
        store.set("preferences_completed", true);

        return { success: true };
      } catch (error) {
        logger.error("Error completing preferences:", error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("reset-onboarding", async (event) => {
      // Clear both localStorage and electron-store
      try {
        // 1. Clear localStorage in renderer
        if (this.windowManager.mainWindow && !this.windowManager.mainWindow.isDestroyed()) {
          await this.windowManager.mainWindow.webContents.executeJavaScript(`
            localStorage.removeItem('onboarding_completed');
            localStorage.removeItem('dictationKey');
          `);
          logger.log("[IPC] Cleared onboarding from localStorage");
        }

        // 2. Clear electron-store
        const Store = require("electron-store");
        const store = new Store();
        store.delete("hasCompletedOnboarding");
        logger.log("[IPC] Cleared onboarding from electron-store");

        return { success: true };
      } catch (error) {
        logger.error("[IPC] Error resetting onboarding:", error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("clear-local-storage", async (event) => {
      // Clear all localStorage (for complete reset)
      if (this.windowManager.mainWindow && !this.windowManager.mainWindow.isDestroyed()) {
        try {
          await this.windowManager.mainWindow.webContents.executeJavaScript(`
            localStorage.clear();
          `);
          logger.log("[IPC] Cleared all localStorage");
          return { success: true };
        } catch (error) {
          logger.error("[IPC] Error clearing localStorage:", error);
          return { success: false, error: error.message };
        }
      }
      return { success: false, error: "Window not available" };
    });

    ipcMain.handle("minimize-after-onboarding", async (event) => {
      if (!this.windowManager.mainWindow || this.windowManager.mainWindow.isDestroyed()) {
        return { success: false, error: "Main window not available" };
      }

      try {
        // Convert from onboarding window to overlay mode
        await this.windowManager.convertToOverlayMode();

        // Wait for new window to load with timeout
        const WINDOW_CONVERSION_TIMEOUT_MS = 5000;
        const WINDOW_CONVERSION_CHECK_INTERVAL_MS = 300;
        const WINDOW_CONVERSION_MAX_CHECKS = 10;

        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            cleanup();
            resolve({ success: true, warning: "Window conversion timeout - proceeding anyway" });
          }, WINDOW_CONVERSION_TIMEOUT_MS);

          const cleanup = () => {
            clearTimeout(timeout);
            if (checkInterval) {
              clearInterval(checkInterval);
            }
          };

          let checkInterval = null;
          let checkCount = 0;
          const maxChecks = WINDOW_CONVERSION_MAX_CHECKS;
          const checkIntervalMs = WINDOW_CONVERSION_CHECK_INTERVAL_MS;

          const checkForReady = async () => {
            checkCount++;

            if (!this.windowManager.mainWindow || this.windowManager.mainWindow.isDestroyed()) {
              cleanup();
              resolve({ success: false, error: "Window destroyed" });
              return;
            }

            try {
              // Simple check - just verify onboarding is completed and window is loaded
              const isReady = await this.windowManager.mainWindow.webContents.executeJavaScript(`
                localStorage.getItem('onboarding_completed') === 'true' && 
                document.readyState === 'complete'
              `);

              if (isReady || checkCount >= maxChecks) {
                cleanup();

                if (this.windowManager.mainWindow && !this.windowManager.mainWindow.isDestroyed()) {
                  // Configure window for overlay mode
                  this.windowManager.setMainWindowInteractivity(false);
                  resolve({ success: true });
                } else {
                  resolve({ success: false, error: "Window destroyed" });
                }
              }
            } catch (error) {
              if (checkCount >= maxChecks) {
                cleanup();
                // Proceed anyway - window should be ready
                if (this.windowManager.mainWindow && !this.windowManager.mainWindow.isDestroyed()) {
                  this.windowManager.setMainWindowInteractivity(false);
                  resolve({ success: true, warning: "Check failed but proceeding" });
                } else {
                  resolve({ success: false, error: error.message });
                }
              }
            }
          };

          // Start checking after window loads
          this.windowManager.mainWindow.webContents.once("did-finish-load", () => {
            checkInterval = setInterval(checkForReady, checkIntervalMs);
            checkForReady(); // Check immediately
          });
        });
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // Permission checking handlers
    // NOTE: These checks must ACTUALLY TEST permissions, not just query status
    // Logging is minimal to avoid spam - these get called frequently
    ipcMain.handle("check-microphone-permission", async (event) => {
      if (process.platform !== "darwin") {
        return { granted: true, canRequest: false };
      }

      const { systemPreferences, app } = require("electron");
      const appName = app.getName();
      const isDev = process.env.NODE_ENV === "development";

      try {
        const status = systemPreferences.getMediaAccessStatus("microphone");
        const statusGranted = status === "granted";

        return {
          granted: statusGranted,
          canRequest: status === "not-determined",
          status: status,
          appName: appName,
          isDev: isDev,
          needsRealTest: isDev,
        };
      } catch (error) {
        logger.error("Error checking microphone permission:", error);
        return { granted: false, canRequest: false, error: error.message };
      }
    });

    ipcMain.handle("request-microphone-permission", async (event) => {
      if (process.platform !== "darwin") {
        return { granted: true };
      }

      const { systemPreferences } = require("electron");
      try {
        const granted = await systemPreferences.askForMediaAccess("microphone");
        return { granted };
      } catch (error) {
        logger.error("Error requesting microphone permission:", error);
        return { granted: false, error: error.message };
      }
    });

    ipcMain.handle("check-accessibility-permission", async (event) => {
      if (process.platform !== "darwin") {
        return { granted: true, canRequest: false };
      }

      const { app } = require("electron");
      const appName = app.getName();
      const isDev = process.env.NODE_ENV === "development";

      try {
        // Use node-mac-permissions for accurate TCC database check
        const permissions = require("node-mac-permissions");
        const status = permissions.getAuthStatus("accessibility");
        const granted = status === "authorized";

        return {
          granted,
          canRequest: false,
          status: granted ? "granted" : "denied",
          error: granted ? null : "Accessibility permission not granted",
          appName: appName,
          isDev: isDev,
          checkMethod: "node-mac-permissions",
        };
      } catch (error) {
        // Fallback to osascript test
        const { spawn } = require("child_process");
        return new Promise((resolve) => {
          const testProcess = spawn("osascript", [
            "-e",
            'tell application "System Events" to get name of first process',
          ]);

          let testError = "";

          testProcess.stderr.on("data", (data) => {
            testError += data.toString();
          });

          testProcess.on("close", (code) => {
            const granted = code === 0 && !testError.includes("not allowed");

            resolve({
              granted,
              canRequest: !granted,
              status: granted ? "granted" : "denied",
              error: granted ? null : testError || "Accessibility permission not granted",
              appName: appName,
              isDev: isDev,
              checkMethod: "osascript-fallback",
              possibleFalsePositive: isDev && granted,
            });
          });

          testProcess.on("error", (err) => {
            resolve({
              granted: false,
              canRequest: false,
              status: "error",
              error: err.message,
              checkMethod: "osascript-error",
            });
          });
        });
      }
    });

    ipcMain.handle("request-accessibility-permission", async (event) => {
      if (process.platform !== "darwin") {
        return { granted: true };
      }

      // Accessibility can't be requested programmatically, must open System Settings
      const OnboardingManager = require("./onboardingManager");
      const onboardingManager = new OnboardingManager();

      // Open System Settings to accessibility pane
      await onboardingManager.openSystemPrivacyPane("accessibility");

      // Check current status after opening
      const status = await onboardingManager.checkAccessibilityPermission();
      return { granted: status.granted };
    });

    // ========================================
    // SCREEN RECORDING PERMISSION HANDLERS
    // ========================================

    ipcMain.handle("check-screen-recording-permission", async (event) => {
      if (process.platform !== "darwin") {
        return { granted: true, canRequest: false };
      }

      try {
        const permissions = require("node-mac-permissions");
        const status = permissions.getAuthStatus("screen");
        const granted = status === "authorized";

        logger.log(`[IPC] 🖥️ Screen recording permission check: ${status}`);

        return {
          granted,
          canRequest: status === "not-determined",
          status: granted ? "authorized" : "denied",
          tccStatus: status,
        };
      } catch (error) {
        logger.error("[IPC] Error checking screen recording permission:", error);
        return { granted: false, canRequest: false, error: error.message };
      }
    });

    ipcMain.handle("request-screen-recording-permission", async (event) => {
      if (process.platform !== "darwin") {
        return { granted: true };
      }

      const OnboardingManager = require("./onboardingManager");
      const onboardingManager = new OnboardingManager();

      return await onboardingManager.requestScreenRecordingPermission();
    });

    // ========================================
    // INPUT MONITORING PERMISSION HANDLERS
    // ========================================

    ipcMain.handle("check-input-monitoring-permission", async (event) => {
      if (process.platform !== "darwin") {
        return { granted: true, canRequest: false };
      }

      try {
        const permissions = require("node-mac-permissions");
        const status = permissions.getAuthStatus("input-monitoring");
        const granted = status === "authorized";

        logger.log(`[IPC] ⌨️ Input monitoring permission check: ${status}`);

        return {
          granted,
          canRequest: status === "not-determined",
          status: granted ? "authorized" : "denied",
          tccStatus: status,
        };
      } catch (error) {
        logger.error("[IPC] Error checking input monitoring permission:", error);
        return { granted: false, canRequest: false, error: error.message };
      }
    });

    ipcMain.handle("request-input-monitoring-permission", async (event, accessLevel = "listen") => {
      if (process.platform !== "darwin") {
        return { granted: true };
      }

      const OnboardingManager = require("./onboardingManager");
      const onboardingManager = new OnboardingManager();

      return await onboardingManager.requestInputMonitoringPermission(accessLevel);
    });

    // ========================================
    // ALL PERMISSIONS STATUS
    // ========================================

    ipcMain.handle("get-all-permissions-status", async (event) => {
      const OnboardingManager = require("./onboardingManager");
      const onboardingManager = new OnboardingManager();

      return await onboardingManager.checkAllPermissions();
    });

    // Get current permission status from PermissionService
    ipcMain.handle("get-permission-status", async (event) => {
      const PermissionService = require("../services/permissionService");
      const permissionService = new PermissionService();
      return await permissionService.getStatus();
    });

    // Force a permission check (useful after user grants permission)
    ipcMain.handle("force-permission-check", async (event) => {
      const PermissionService = require("../services/permissionService");
      const permissionService = new PermissionService();
      return await permissionService.getStatus();
    });

    // Test microphone by actually using it
    ipcMain.handle("test-microphone-permission", async (event) => {
      const PermissionService = require("../services/permissionService");
      const permissionService = new PermissionService();
      return await permissionService.testMicrophone();
    });

    // Test accessibility by actually using it
    ipcMain.handle("test-accessibility-permission", async (event) => {
      const PermissionService = require("../services/permissionService");
      const permissionService = new PermissionService();
      return await permissionService.testAccessibility();
    });

    // Prompt for accessibility permission (triggers dialog if possible)
    ipcMain.handle("prompt-accessibility-permission", async (event) => {
      const PermissionService = require("../services/permissionService");
      const permissionService = new PermissionService();
      return await permissionService.promptAccessibilityPermission();
    });

    // Get user-friendly permission instructions
    ipcMain.handle("get-permission-instructions", async (event, permission) => {
      const PermissionService = require("../services/permissionService");
      const permissionService = new PermissionService();
      return permissionService.getInstructions(permission);
    });

    // ========================================
    // AUDIO TESTING HANDLERS
    // ========================================
    // These handlers provide actual audio testing functionality
    // to verify microphone recording and playback work correctly

    // Get list of audio input devices
    ipcMain.handle("get-audio-input-devices", async (event) => {
      const audioTestService = new AudioTestService();
      return await audioTestService.getAudioInputDevices();
    });

    // Test microphone recording (actual recording test)
    ipcMain.handle("test-microphone-recording", async (event, durationSeconds = 2) => {
      logger.log(`[IPC] 🎤 Testing microphone recording for ${durationSeconds}s...`);
      const audioTestService = new AudioTestService();
      const result = await audioTestService.testMicrophoneRecording(durationSeconds);
      logger.log(`[IPC] 🎤 Recording test result:`, result.success ? "✅ Success" : "❌ Failed");
      return result;
    });

    // Test audio playback (plays back the test recording)
    ipcMain.handle("test-audio-playback", async (event) => {
      logger.log(`[IPC] 🔊 Testing audio playback...`);
      const audioTestService = new AudioTestService();
      const result = await audioTestService.testAudioPlayback();
      logger.log(`[IPC] 🔊 Playback test result:`, result.success ? "✅ Success" : "❌ Failed");
      return result;
    });

    // Play a system sound to test audio output
    ipcMain.handle("play-system-sound", async (event) => {
      const audioTestService = new AudioTestService();
      return await audioTestService.playSystemSound();
    });

    // Run full audio test (permission + recording + playback)
    ipcMain.handle("run-full-audio-test", async (event) => {
      logger.log(`[IPC] 🧪 Running full audio test...`);
      const audioTestService = new AudioTestService();
      const result = await audioTestService.runFullAudioTest();
      logger.log(`[IPC] 🧪 Full audio test complete:`, result.summary);
      return result;
    });

    // Get troubleshooting instructions for permissions
    ipcMain.handle("get-permission-troubleshooting", async (event) => {
      const audioTestService = new AudioTestService();
      return audioTestService.getTroubleshootingInstructions();
    });

    // Cleanup test files
    ipcMain.handle("cleanup-audio-test-files", async (event) => {
      const audioTestService = new AudioTestService();
      audioTestService.cleanupTestFiles();
      return { success: true };
    });

    // Get app identity information (for permission debugging)
    ipcMain.handle("get-app-identity", async (event) => {
      const isDev = process.env.NODE_ENV === "development";
      const appName = app.getName();
      const appPath = app.getAppPath();
      const bundleId = app.isPackaged ? "com.centris.app" : "development";

      // Get process info
      const processInfo = {
        pid: process.pid,
        ppid: process.ppid,
        platform: process.platform,
        arch: process.arch,
        execPath: process.execPath,
      };

      return {
        appName,
        appPath,
        bundleId,
        isDev,
        isPackaged: app.isPackaged,
        processInfo,
        permissionNote: isDev
          ? 'In development mode, permissions are associated with the parent process (Terminal, Cursor, etc.). Build and install the app for proper "Centris AI" permissions.'
          : 'Permissions are associated with "Centris AI".',
      };
    });

    ipcMain.handle("open-system-preferences", async (event, pane) => {
      if (process.platform !== "darwin") {
        return { success: false, error: "Only available on macOS" };
      }

      const { exec } = require("child_process");
      const { shell } = require("electron");

      const urls = {
        microphone: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
        accessibility:
          "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
        screen: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
        "screen-recording":
          "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
        input: "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent",
        "input-monitoring":
          "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent",
      };

      const url = urls[pane] || urls.accessibility;

      logger.log(`[IPC] Opening System Settings for: ${pane} (${url})`);

      return new Promise((resolve) => {
        // Try 'open' command first (most reliable)
        exec(`open "${url}"`, (error) => {
          if (!error) {
            logger.log(`[IPC] Successfully opened System Settings using 'open' command`);
            resolve({ success: true });
            return;
          }

          // Fallback to shell.openExternal
          shell
            .openExternal(url)
            .then(() => {
              logger.log(`[IPC] Successfully opened System Settings using shell.openExternal`);
              resolve({ success: true });
            })
            .catch((err) => {
              logger.error(`[IPC] Failed to open System Settings:`, err);
              resolve({ success: false, error: err.message });
            });
        });
      });
    });

    ipcMain.handle("start-window-drag", async (event) => {
      return await this.windowManager.startWindowDrag();
    });

    ipcMain.handle("stop-window-drag", async (event) => {
      return await this.windowManager.stopWindowDrag();
    });

    // External link handler
    ipcMain.handle("open-external", async (event, url) => {
      try {
        await shell.openExternal(url);
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // Get screen info for dock positioning
    ipcMain.handle("get-screen-info", async (event) => {
      try {
        const display = screen.getPrimaryDisplay();
        const bounds = display.bounds;
        const workArea = display.workArea;

        // Calculate dock height (difference between full screen and work area)
        // For macOS dock at bottom: dock height = bounds.height - workArea.height - workArea.y
        const dockHeight = bounds.height - workArea.height - workArea.y;

        return {
          bounds: {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
          },
          workArea: {
            x: workArea.x,
            y: workArea.y,
            width: workArea.width,
            height: workArea.height,
          },
          dockHeight: Math.max(dockHeight, 68), // Minimum 68px for macOS dock
        };
      } catch (error) {
        logger.error("Error getting screen info:", error);
        return {
          bounds: { x: 0, y: 0, width: 1920, height: 1080 },
          workArea: { x: 0, y: 0, width: 1920, height: 1000 },
          dockHeight: 68,
        };
      }
    });

    // Get cursor display info for multi-monitor support
    ipcMain.handle("get-cursor-display-info", async (event) => {
      try {
        const cursorPoint = screen.getCursorScreenPoint();
        const cursorDisplay = screen.getDisplayNearestPoint(cursorPoint);
        const allDisplays = screen.getAllDisplays();
        const primaryDisplay = screen.getPrimaryDisplay();

        return {
          cursorPosition: cursorPoint,
          currentDisplay: {
            id: cursorDisplay.id,
            index: allDisplays.findIndex((d) => d.id === cursorDisplay.id),
            bounds: cursorDisplay.bounds,
            workArea: cursorDisplay.workArea,
            scaleFactor: cursorDisplay.scaleFactor,
            isPrimary: cursorDisplay.id === primaryDisplay.id,
          },
          allDisplays: allDisplays.map((d, index) => ({
            id: d.id,
            index: index,
            number: index + 1, // Human-readable: Monitor 1, Monitor 2, etc.
            bounds: d.bounds,
            workArea: d.workArea,
            scaleFactor: d.scaleFactor,
            isPrimary: d.id === primaryDisplay.id,
            // Add center point for easier coordinate calculations
            center: {
              x: d.bounds.x + d.bounds.width / 2,
              y: d.bounds.y + d.bounds.height / 2,
            },
          })),
          displayCount: allDisplays.length,
        };
      } catch (error) {
        logger.error("Error getting cursor display info:", error);
        const display = screen.getPrimaryDisplay();
        return {
          cursorPosition: { x: display.bounds.width / 2, y: display.bounds.height / 2 },
          currentDisplay: {
            id: display.id,
            index: 0,
            bounds: display.bounds,
            workArea: display.workArea,
            scaleFactor: display.scaleFactor,
            isPrimary: true,
          },
          allDisplays: [
            {
              id: display.id,
              index: 0,
              number: 1,
              bounds: display.bounds,
              workArea: display.workArea,
              scaleFactor: display.scaleFactor,
              isPrimary: true,
              center: {
                x: display.bounds.x + display.bounds.width / 2,
                y: display.bounds.y + display.bounds.height / 2,
              },
            },
          ],
          displayCount: 1,
        };
      }
    });

    // ========================================
    // KEYBOARD MONITORING HANDLERS
    // ========================================

    ipcMain.handle("start-keyboard-monitoring", async (event, options) => {
      try {
        const { getKeyboardMonitorService } = require("../services/keyboardMonitorService");
        const service = getKeyboardMonitorService();
        return await service.start(options);
      } catch (error) {
        logger.error("[IPC] Error starting keyboard monitoring:", error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("stop-keyboard-monitoring", async (event) => {
      try {
        const { getKeyboardMonitorService } = require("../services/keyboardMonitorService");
        const service = getKeyboardMonitorService();
        return service.stop();
      } catch (error) {
        logger.error("[IPC] Error stopping keyboard monitoring:", error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("get-keyboard-monitoring-status", async (event) => {
      try {
        const { getKeyboardMonitorService } = require("../services/keyboardMonitorService");
        const service = getKeyboardMonitorService();
        return service.getStatus();
      } catch (error) {
        logger.error("[IPC] Error getting keyboard monitoring status:", error);
        return { isMonitoring: false, error: error.message };
      }
    });

    // ========================================
    // SCREEN CAPTURE HANDLERS
    // ========================================

    ipcMain.handle("capture-screen", async (event, options) => {
      try {
        const { getScreenCaptureService } = require("../services/screenCaptureService");
        const service = getScreenCaptureService();
        return await service.captureScreen(options);
      } catch (error) {
        logger.error("[IPC] Error capturing screen:", error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("start-screen-capture", async (event, options) => {
      try {
        const { getScreenCaptureService } = require("../services/screenCaptureService");
        const service = getScreenCaptureService();
        return await service.startCapture(options);
      } catch (error) {
        logger.error("[IPC] Error starting screen capture:", error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("stop-screen-capture", async (event) => {
      try {
        const { getScreenCaptureService } = require("../services/screenCaptureService");
        const service = getScreenCaptureService();
        return service.stopCapture();
      } catch (error) {
        logger.error("[IPC] Error stopping screen capture:", error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("get-screen-capture-status", async (event) => {
      try {
        const { getScreenCaptureService } = require("../services/screenCaptureService");
        const service = getScreenCaptureService();
        return service.getStatus();
      } catch (error) {
        logger.error("[IPC] Error getting screen capture status:", error);
        return { isCapturing: false, error: error.message };
      }
    });

    // ========================================
    // SYSTEM AUDIO CAPTURE HANDLERS
    // ========================================

    ipcMain.handle("start-system-audio-capture", async (event, options) => {
      try {
        const { getSystemAudioService } = require("../services/systemAudioService");
        const service = getSystemAudioService();
        return await service.startCapture(options);
      } catch (error) {
        logger.error("[IPC] Error starting system audio capture:", error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("stop-system-audio-capture", async (event) => {
      try {
        const { getSystemAudioService } = require("../services/systemAudioService");
        const service = getSystemAudioService();
        return await service.stopCapture();
      } catch (error) {
        logger.error("[IPC] Error stopping system audio capture:", error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("get-system-audio-status", async (event) => {
      try {
        const { getSystemAudioService } = require("../services/systemAudioService");
        const service = getSystemAudioService();
        return service.getStatus();
      } catch (error) {
        logger.error("[IPC] Error getting system audio status:", error);
        return { isCapturing: false, error: error.message };
      }
    });

    // Model management, reasoning, and llama.cpp handlers removed - using Centris backend instead

    // ========================================
    // FOCUS TRACKING HANDLERS
    // ========================================
    // These handlers enable tracking and restoring the focused text field
    // so dictated text goes to the correct text box

    // Capture the currently focused element (call when dictation starts)
    ipcMain.handle("capture-focus", async (event) => {
      try {
        const { getFocusTrackerService } = require("../services/focusTrackerService");
        const service = getFocusTrackerService();
        const focusInfo = await service.captureFocus();
        return { success: true, focusInfo };
      } catch (error) {
        logger.error("[IPC] Error capturing focus:", error);
        return { success: false, error: error.message };
      }
    });

    // Restore focus to the previously captured element (call before text injection)
    ipcMain.handle("restore-focus", async (event) => {
      try {
        const { getFocusTrackerService } = require("../services/focusTrackerService");
        const service = getFocusTrackerService();
        const restored = await service.restoreFocus();
        return { success: true, restored };
      } catch (error) {
        logger.error("[IPC] Error restoring focus:", error);
        return { success: false, error: error.message };
      }
    });

    // Get the currently stored focus info
    ipcMain.handle("get-stored-focus", async (event) => {
      try {
        const { getFocusTrackerService } = require("../services/focusTrackerService");
        const service = getFocusTrackerService();
        return { success: true, focusInfo: service.getStoredFocus() };
      } catch (error) {
        logger.error("[IPC] Error getting stored focus:", error);
        return { success: false, error: error.message };
      }
    });

    // Clear stored focus
    ipcMain.handle("clear-focus", async (event) => {
      try {
        const { getFocusTrackerService } = require("../services/focusTrackerService");
        const service = getFocusTrackerService();
        service.clearFocus();
        return { success: true };
      } catch (error) {
        logger.error("[IPC] Error clearing focus:", error);
        return { success: false, error: error.message };
      }
    });

    // Check if we have valid stored focus
    ipcMain.handle("has-valid-focus", async (event) => {
      try {
        const { getFocusTrackerService } = require("../services/focusTrackerService");
        const service = getFocusTrackerService();
        return { success: true, hasValidFocus: service.hasValidFocus() };
      } catch (error) {
        logger.error("[IPC] Error checking focus:", error);
        return { success: false, error: error.message };
      }
    });

    // Inject text with focus restoration (combines restore focus + inject text)
    ipcMain.handle("inject-text-with-focus-restore", async (event, text) => {
      try {
        const { getFocusTrackerService } = require("../services/focusTrackerService");
        const focusService = getFocusTrackerService();

        // Restore focus first
        if (focusService.hasValidFocus()) {
          await focusService.restoreFocus();
          // Small delay to ensure focus is restored
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        // Now inject text
        return await this.clipboardManager.injectTextDirectly(text);
      } catch (error) {
        logger.error("[IPC] Error injecting text with focus restore:", error);
        return { success: false, error: error.message };
      }
    });

    // ========================================
    // BACKEND MANAGEMENT HANDLERS
    // ========================================
    // These handlers manage the Centris backend process (check, start, stop)

    // Check if backend is running and healthy (just check, don't start)
    ipcMain.handle("check-backend-health", async () => {
      try {
        const isHealthy = await backendManager.checkBackendHealth();
        return { success: true, healthy: isHealthy };
      } catch (error) {
        logger.error("[IPC] Error checking backend health:", error);
        return { success: false, healthy: false, error: error.message };
      }
    });

    // Check if backend is running (simple check only, no auto-start)
    ipcMain.handle("check-backend-running", async () => {
      try {
        const isRunning = await backendManager.checkBackendRunning();
        return { success: true, running: isRunning };
      } catch (error) {
        logger.error("[IPC] Error checking if backend is running:", error);
        return { success: false, running: false, error: error.message };
      }
    });

    // Ensure backend is running (check and start if needed)
    ipcMain.handle("ensure-backend-running", async () => {
      try {
        const isRunning = await backendManager.ensureBackendRunning();
        return { success: true, running: isRunning };
      } catch (error) {
        logger.error("[IPC] Error ensuring backend running:", error);
        return { success: false, running: false, error: error.message };
      }
    });

    // Get backend status
    ipcMain.handle("get-backend-status", async () => {
      try {
        const status = await backendManager.getStatus();
        return { success: true, ...status };
      } catch (error) {
        logger.error("[IPC] Error getting backend status:", error);
        return { success: false, error: error.message };
      }
    });

    // Start backend manually
    ipcMain.handle("start-backend", async () => {
      try {
        const started = await backendManager.startBackend();
        return { success: started };
      } catch (error) {
        logger.error("[IPC] Error starting backend:", error);
        return { success: false, error: error.message };
      }
    });

    // Stop backend
    ipcMain.handle("stop-backend", async () => {
      try {
        await backendManager.stopBackend();
        return { success: true };
      } catch (error) {
        logger.error("[IPC] Error stopping backend:", error);
        return { success: false, error: error.message };
      }
    });

    // ========================================
    // ACTION AUTHORITY HANDLERS (/api/v1/action)
    // ========================================
    // Desktop UI, extension, and CLI should all target the same action endpoint.

    ipcMain.handle("action-api-call", async (event, method, params = {}) => {
      return this.callGatewayActionApi(method, params);
    });

    ipcMain.handle("action-observe", async (event, params = {}) => {
      return this.callGatewayActionApi("observe", params);
    });

    ipcMain.handle("action-act", async (event, params = {}) => {
      return this.callGatewayActionApi("act", params);
    });

    ipcMain.handle("action-verify", async (event, params = {}) => {
      return this.callGatewayActionApi("verify", params);
    });

    ipcMain.handle("action-route-run", async (event, params = {}) => {
      return this.callGatewayActionApi("route.run", params);
    });

    ipcMain.handle("action-route-record-start", async (event, params = {}) => {
      return this.callGatewayActionApi("route.record.start", params);
    });

    ipcMain.handle("action-route-record-stop", async (event, params = {}) => {
      return this.callGatewayActionApi("route.record.stop", params);
    });

    // ========================================
    // MODE MANAGEMENT HANDLERS
    // ========================================
    // These handlers manage operating mode (action vs dictation) across all windows

    // Broadcast mode change to all windows
    ipcMain.handle("broadcast-mode-change", async (event, mode) => {
      try {
        if (mode !== "action" && mode !== "dictation") {
          return { success: false, error: 'Invalid mode. Must be "action" or "dictation".' };
        }

        logger.log(`[IPC] 📣 Broadcasting mode change to all windows: ${mode}`);
        this.broadcastToWindows("mode-changed", { mode });

        return { success: true, mode };
      } catch (error) {
        logger.error("[IPC] Error broadcasting mode change:", error);
        return { success: false, error: error.message };
      }
    });

    // ========================================
    // AUTHENTICATION HANDLERS
    // ========================================
    // These handlers manage auth token storage and retrieval

    // Get stored auth tokens from electron-store
    ipcMain.handle("get-auth-tokens", async () => {
      try {
        const Store = require("electron-store");
        const store = new Store();
        const tokens = store.get("auth_tokens");
        return { success: true, tokens };
      } catch (error) {
        logger.error("[IPC] Error getting auth tokens:", error);
        return { success: false, error: error.message };
      }
    });

    // Save auth tokens to electron-store (secure storage)
    ipcMain.handle("save-auth-tokens", async (event, tokens) => {
      try {
        const Store = require("electron-store");
        const store = new Store();
        store.set("auth_tokens", tokens);
        logger.log("[IPC] ✅ Auth tokens saved to secure storage");
        return { success: true };
      } catch (error) {
        logger.error("[IPC] Error saving auth tokens:", error);
        return { success: false, error: error.message };
      }
    });

    // Clear auth session (sign out)
    ipcMain.handle("clear-auth-session", async () => {
      try {
        const Store = require("electron-store");
        const store = new Store();
        store.delete("auth_tokens");
        logger.log("[IPC] ✅ Auth session cleared");
        return { success: true };
      } catch (error) {
        logger.error("[IPC] Error clearing auth session:", error);
        return { success: false, error: error.message };
      }
    });

    // ========================================
    // RESOURCE PATH HANDLERS
    // ========================================
    // Get path to bundled resources (for ONNX models, etc.)
    ipcMain.handle("get-resource-path", async (event, relativePath) => {
      try {
        const fs = require("fs");

        // In development, use the local resources folder
        // In production, use the extraResources folder
        let basePath;
        if (app.isPackaged) {
          // Production: extraResources are placed in Resources folder on macOS
          basePath = process.resourcesPath;
        } else {
          // Development: use the desktop/resources folder
          basePath = path.join(__dirname, "..", "..", "resources");
        }

        const fullPath = path.join(basePath, relativePath);

        // Check if file exists
        if (fs.existsSync(fullPath)) {
          logger.log(`[IPC] Resource path resolved: ${relativePath} -> ${fullPath}`);
          return fullPath;
        } else {
          // Try alternate path for development (models might be in src/models)
          const altPath = path.join(__dirname, "..", relativePath);
          if (fs.existsSync(altPath)) {
            logger.log(`[IPC] Resource path resolved (alt): ${relativePath} -> ${altPath}`);
            return altPath;
          }

          logger.warn(`[IPC] Resource not found: ${relativePath}`);
          return null;
        }
      } catch (error) {
        logger.error("[IPC] Error getting resource path:", error);
        return null;
      }
    });
  }

  getActionApiBaseUrl() {
    const fromEnv =
      process.env.CENTRIS_GATEWAY_URL ||
      process.env.OPENCLAW_GATEWAY_URL ||
      process.env.VITE_CENTRIS_GATEWAY_URL ||
      "";
    const preferred = fromEnv || backendManager.backendUrl || LOCAL_GATEWAY_FALLBACK_URL;
    return preferred.replace(/\/$/, "");
  }

  getGatewayToken() {
    if (process.env.OPENCLAW_GATEWAY_TOKEN) {
      return process.env.OPENCLAW_GATEWAY_TOKEN;
    }
    if (process.env.CENTRIS_GATEWAY_TOKEN) {
      return process.env.CENTRIS_GATEWAY_TOKEN;
    }
    try {
      const Store = require("electron-store");
      const store = new Store();
      const storedTokens = store.get("auth_tokens");
      if (storedTokens && typeof storedTokens === "object") {
        if (
          typeof storedTokens.gateway_token === "string" &&
          storedTokens.gateway_token.length > 0
        ) {
          return storedTokens.gateway_token;
        }
        if (typeof storedTokens.access_token === "string" && storedTokens.access_token.length > 0) {
          return storedTokens.access_token;
        }
      }
    } catch (error) {
      logger.warn("[IPC] Unable to read gateway token from auth storage:", error?.message);
    }
    return null;
  }

  async callGatewayActionApi(method, params = {}) {
    if (!method || typeof method !== "string") {
      return {
        specVersion: ACTION_API_SPEC_VERSION,
        method: "unknown",
        ok: false,
        error: {
          code: "INVALID_REQUEST",
          message: "method must be a non-empty string",
        },
      };
    }

    const gatewayBaseUrl = this.getActionApiBaseUrl();
    const headers = {
      "Content-Type": "application/json",
    };
    const token = this.getGatewayToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ACTION_API_TIMEOUT_MS);
    try {
      const response = await fetch(`${gatewayBaseUrl}/api/v1/action`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          specVersion: ACTION_API_SPEC_VERSION,
          method,
          id: `desktop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          params: params && typeof params === "object" ? params : {},
        }),
        signal: controller.signal,
      });

      const rawText = await response.text();
      let payload;
      try {
        payload = rawText ? JSON.parse(rawText) : null;
      } catch {
        payload = null;
      }

      if (!response.ok) {
        const message =
          payload?.error?.message ||
          payload?.message ||
          `Gateway action request failed (${response.status})`;
        return {
          specVersion: ACTION_API_SPEC_VERSION,
          method,
          ok: false,
          error: {
            code: payload?.error?.code || "HTTP_ERROR",
            message,
            details: {
              status: response.status,
            },
          },
        };
      }

      if (payload && typeof payload === "object") {
        return payload;
      }

      return {
        specVersion: ACTION_API_SPEC_VERSION,
        method,
        ok: false,
        error: {
          code: "INVALID_RESPONSE",
          message: "Gateway returned an invalid action response payload",
        },
      };
    } catch (error) {
      const isAbort = error?.name === "AbortError";
      return {
        specVersion: ACTION_API_SPEC_VERSION,
        method,
        ok: false,
        error: {
          code: isAbort ? "TIMEOUT" : "REQUEST_FAILED",
          message: isAbort
            ? "Action request timed out"
            : error?.message || "Failed to call gateway action API",
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  broadcastToWindows(channel, payload) {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, payload);
      }
    });
  }
}

module.exports = IPCHandlers;
