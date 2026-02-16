const { autoUpdater } = require("electron-updater");
const { ipcMain } = require("electron");
// Handle ES module interop - logger might be exported as { default: Logger }
const loggerModule = require("./utils/logger");
const logger = loggerModule.default || loggerModule;

class UpdateManager {
  constructor() {
    this.mainWindow = null;
    this.controlPanelWindow = null;
    this.updateAvailable = false;
    this.updateDownloaded = false;
    this.lastUpdateInfo = null;
    this.isInstalling = false;
    this.isDownloading = false;
    this.installTimeout = null;
    this.ipcHandlers = [];
    this.eventListeners = [];

    this.setupAutoUpdater();
    this.setupIPCHandlers();
  }

  setWindows(mainWindow, controlPanelWindow) {
    this.mainWindow = mainWindow;
    this.controlPanelWindow = controlPanelWindow;
  }

  setupAutoUpdater() {
    // Only configure auto-updater in production
    if (process.env.NODE_ENV === "development") {
      // Auto-updater disabled in development mode
      return;
    }

    // Configure auto-updater for GitHub releases
    // IMPORTANT: Update these values to match your GitHub repository
    autoUpdater.setFeedURL({
      provider: "github",
      owner: process.env.GH_OWNER || "YOUR_GITHUB_USERNAME",
      repo: process.env.GH_REPO || "centris-ai",
      private: false,
    });

    // Disable auto-download - let user control when to download
    autoUpdater.autoDownload = false;

    // Enable auto-install on quit - if user ignores update and quits normally,
    // the update will install automatically (best UX)
    // User can also manually trigger install with "Install & Restart" button
    autoUpdater.autoInstallOnAppQuit = true;

    // Enable logging in production for debugging (logs are user-accessible)
    // Note: electron-updater expects console-like object, so we pass logger
    autoUpdater.logger = {
      info: (...args) => logger.info(...args),
      warn: (...args) => logger.warn(...args),
      error: (...args) => logger.error(...args),
      debug: (...args) => logger.debug(...args),
    };

    // Set up event handlers
    this.setupEventHandlers();
  }

  setupEventHandlers() {
    const handlers = {
      "checking-for-update": () => {
        this.notifyRenderers("checking-for-update");
      },
      "update-available": (info) => {
        this.updateAvailable = true;
        if (info) {
          this.lastUpdateInfo = {
            version: info.version,
            releaseDate: info.releaseDate,
            releaseNotes: info.releaseNotes,
            files: info.files,
          };
        }
        this.notifyRenderers("update-available", info);
      },
      "update-not-available": (info) => {
        this.updateAvailable = false;
        this.updateDownloaded = false;
        this.isDownloading = false;
        this.lastUpdateInfo = null;
        this.notifyRenderers("update-not-available", info);
      },
      error: (err) => {
        logger.error("❌ Auto-updater error:", err);
        this.isDownloading = false;
        this.notifyRenderers("update-error", err);
      },
      "download-progress": (progressObj) => {
        logger.log(
          `📥 Download progress: ${progressObj.percent.toFixed(2)}% (${(progressObj.transferred / 1024 / 1024).toFixed(2)}MB / ${(progressObj.total / 1024 / 1024).toFixed(2)}MB)`,
        );
        this.notifyRenderers("update-download-progress", progressObj);
      },
      "update-downloaded": (info) => {
        logger.log("✅ Update downloaded successfully:", info?.version);
        this.updateDownloaded = true;
        this.isDownloading = false;
        if (info) {
          this.lastUpdateInfo = {
            version: info.version,
            releaseDate: info.releaseDate,
            releaseNotes: info.releaseNotes,
            files: info.files,
          };
        }
        this.notifyRenderers("update-downloaded", info);
      },
    };

    // Register and track event listeners for cleanup
    Object.entries(handlers).forEach(([event, handler]) => {
      autoUpdater.on(event, handler);
      this.eventListeners.push({ event, handler });
    });
  }

  notifyRenderers(channel, data) {
    if (this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.webContents) {
      this.mainWindow.webContents.send(channel, data);
    }
    if (
      this.controlPanelWindow &&
      !this.controlPanelWindow.isDestroyed() &&
      this.controlPanelWindow.webContents
    ) {
      this.controlPanelWindow.webContents.send(channel, data);
    }
  }

  setupIPCHandlers() {
    const handlers = [
      {
        channel: "check-for-updates",
        handler: async () => {
          try {
            if (process.env.NODE_ENV === "development") {
              return {
                updateAvailable: false,
                message: "Update checks are disabled in development mode",
              };
            }

            logger.log("🔍 Checking for updates...");
            const result = await autoUpdater.checkForUpdates();

            if (result && result.updateInfo) {
              logger.log("📋 Update available:", result.updateInfo.version);
              logger.log(
                "📦 Download size:",
                result.updateInfo.files
                  ?.map((f) => `${(f.size / 1024 / 1024).toFixed(2)}MB`)
                  .join(", "),
              );
              return {
                updateAvailable: true,
                version: result.updateInfo.version,
                releaseDate: result.updateInfo.releaseDate,
                files: result.updateInfo.files,
                releaseNotes: result.updateInfo.releaseNotes,
              };
            } else {
              logger.log("✅ Already on latest version");
              return {
                updateAvailable: false,
                message: "You are running the latest version",
              };
            }
          } catch (error) {
            logger.error("❌ Update check error:", error);
            throw error;
          }
        },
      },
      {
        channel: "download-update",
        handler: async () => {
          try {
            if (process.env.NODE_ENV === "development") {
              return {
                success: false,
                message: "Update downloads are disabled in development mode",
              };
            }

            if (this.isDownloading) {
              return {
                success: false,
                message: "Download already in progress",
              };
            }

            if (this.updateDownloaded) {
              return {
                success: false,
                message: "Update already downloaded. Ready to install.",
              };
            }

            this.isDownloading = true;
            logger.log("📥 Starting update download...");
            await autoUpdater.downloadUpdate();
            logger.log("📥 Download initiated successfully");

            return { success: true, message: "Update download started" };
          } catch (error) {
            this.isDownloading = false;
            logger.error("❌ Update download error:", error);
            throw error;
          }
        },
      },
      {
        channel: "install-update",
        handler: async () => {
          try {
            if (process.env.NODE_ENV === "development") {
              return {
                success: false,
                message: "Update installation is disabled in development mode",
              };
            }

            if (!this.updateDownloaded) {
              return {
                success: false,
                message: "No update available to install",
              };
            }

            if (this.isInstalling) {
              return {
                success: false,
                message: "Update installation already in progress",
              };
            }

            this.isInstalling = true;
            logger.log("🔄 Installing update and restarting...");

            this.installTimeout = setTimeout(() => {
              logger.log("🔄 Calling quitAndInstall(false, true)...");
              logger.log("📊 Platform:", process.platform);
              logger.log("📊 Update downloaded:", this.updateDownloaded);

              // CRITICAL: Emit before-quit BEFORE quitAndInstall closes windows
              // This sets isQuitting=true in windowManager, allowing windows to close
              const { app } = require("electron");
              app.emit("before-quit");

              // Now quitAndInstall will:
              // 1. Close all windows (now allowed because isQuitting = true)
              // 2. Emit 'before-quit' event again (harmless)
              // 3. Call app.quit()
              // 4. Install update and restart (if isForceRunAfter = true)
              autoUpdater.quitAndInstall(false, true);

              logger.log("✅ quitAndInstall() called - app should be quitting...");
            }, 100);

            return { success: true, message: "Update installation started" };
          } catch (error) {
            this.isInstalling = false;
            if (this.installTimeout) {
              clearTimeout(this.installTimeout);
              this.installTimeout = null;
            }
            logger.error("❌ Update installation error:", error);
            throw error;
          }
        },
      },
      {
        channel: "get-app-version",
        handler: async () => {
          try {
            const { app } = require("electron");
            return { version: app.getVersion() };
          } catch (error) {
            logger.error("❌ Error getting app version:", error);
            throw error;
          }
        },
      },
      {
        channel: "get-update-status",
        handler: async () => {
          try {
            return {
              updateAvailable: this.updateAvailable,
              updateDownloaded: this.updateDownloaded,
              isDevelopment: process.env.NODE_ENV === "development",
            };
          } catch (error) {
            logger.error("❌ Error getting update status:", error);
            throw error;
          }
        },
      },
      {
        channel: "get-update-info",
        handler: async () => {
          try {
            return this.lastUpdateInfo;
          } catch (error) {
            logger.error("❌ Error getting update info:", error);
            throw error;
          }
        },
      },
    ];

    // Register all handlers and track for cleanup
    handlers.forEach(({ channel, handler }) => {
      ipcMain.handle(channel, handler);
      this.ipcHandlers.push({ channel, handler });
    });
  }

  // Method to check for updates on startup
  checkForUpdatesOnStartup() {
    if (process.env.NODE_ENV !== "development") {
      // Wait a bit for the app to fully initialize
      setTimeout(() => {
        logger.log("🔄 Checking for updates on startup...");
        autoUpdater.checkForUpdates().catch((err) => {
          logger.error("Startup update check failed:", err);
        });
      }, 3000); // Reduced from 5s to 3s for better UX
    }
  }

  // Cleanup method to be called on app quit
  cleanup() {
    // Clear timeout
    if (this.installTimeout) {
      clearTimeout(this.installTimeout);
      this.installTimeout = null;
    }

    // Remove event listeners
    this.eventListeners.forEach(({ event, handler }) => {
      autoUpdater.removeListener(event, handler);
    });
    this.eventListeners = [];

    // Remove IPC handlers
    this.ipcHandlers.forEach(({ channel }) => {
      ipcMain.removeHandler(channel);
    });
    this.ipcHandlers = [];
  }
}

module.exports = UpdateManager;
