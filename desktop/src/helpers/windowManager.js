const { app, screen, BrowserWindow } = require("electron");
const path = require("path");
const HotkeyManager = require("./hotkeyManager");
const DragManager = require("./dragManager");
const MenuManager = require("./menuManager");
const DevServerManager = require("./devServerManager");
// Handle ES module interop - logger might be exported as { default: Logger }
const loggerModule = require("../utils/logger");
const logger = loggerModule.default || loggerModule;
const {
  MAIN_WINDOW_CONFIG,
  ONBOARDING_WINDOW_CONFIG,
  CONTROL_PANEL_CONFIG,
  PILL_UI_WINDOW_CONFIG,
  WindowPositionUtil,
} = require("./windowConfig");

function getConsoleMessageDetails(event, fallbackLevel, fallbackMessage) {
  if (typeof event?.message === "string") {
    return { level: event.level, message: event.message };
  }
  return { level: fallbackLevel, message: fallbackMessage };
}

function toConsolePrefix(level) {
  return level === 0 ? "🔵" : level === 1 ? "🟡" : "🔴";
}

class WindowManager {
  constructor() {
    this.mainWindow = null;
    this.pillUIWindow = null; // Primary pill UI overlay window (for backwards compat)
    this.pillUIWindows = []; // Array of pill windows - one per display for multi-monitor support
    this.controlPanelWindow = null;
    this.tray = null;
    this.hotkeyManager = new HotkeyManager();
    this.dragManager = new DragManager();
    this.isOnboardingMode = false; // Track if we're in onboarding mode
    this.isQuitting = false;
    this.isMainWindowInteractive = false;

    app.on("before-quit", () => {
      this.isQuitting = true;
      // CRITICAL: Close all pill UI windows when app quits
      this.closeAllPillWindows();
    });
  }

  // Close all pill windows
  closeAllPillWindows() {
    // Close primary pill window
    if (this.pillUIWindow && !this.pillUIWindow.isDestroyed()) {
      this.pillUIWindow.close();
    }
    // Close all multi-monitor pill windows
    this.pillUIWindows.forEach((win) => {
      if (win && !win.isDestroyed()) {
        win.close();
      }
    });
    this.pillUIWindows = [];
  }

  async createMainWindow() {
    logger.debug("═══════════════════════════════════════════════════════════");
    logger.debug("🔵 [WindowManager] createMainWindow() CALLED");
    logger.debug("═══════════════════════════════════════════════════════════");

    const display = screen.getPrimaryDisplay();
    const { width, height } = display.workAreaSize;
    const bounds = display.bounds;
    logger.debug(`[WindowManager] 📺 Screen bounds: ${bounds.width}x${bounds.height}`);

    // Check if onboarding is needed - check electron-store
    // Note: React component will check localStorage separately
    const Store = require("electron-store");
    const store = new Store();
    const storeOnboarding = store.get("hasCompletedOnboarding", false);
    const preferencesCompleted = store.get("preferences_completed", false);
    // Default to showing onboarding if not set
    const needsOnboarding = !storeOnboarding;

    logger.debug(
      "[WindowManager] 📋 Onboarding check - needsOnboarding:",
      needsOnboarding,
      "store value:",
      storeOnboarding,
    );
    logger.debug(
      "[WindowManager] 📋 Preferences check - preferencesCompleted:",
      preferencesCompleted,
    );

    if (needsOnboarding) {
      logger.debug("[WindowManager] 🎯 Creating ONBOARDING window...");
      // Create proper Electron window with frame for onboarding
      // Use explicit bounds to ensure it stays within defined box
      const onboardingWidth = 600;
      const onboardingHeight = 750;
      const onboardingMinHeight = 600;
      const onboardingMaxHeight = 900;

      // Ensure window fits within screen bounds
      const maxWidth = Math.min(onboardingWidth, bounds.width - 40);
      const maxHeight = Math.min(onboardingMaxHeight, bounds.height - 40);

      logger.debug("[WindowManager] 🔨 Creating BrowserWindow for onboarding...");
      this.mainWindow = new BrowserWindow({
        width: onboardingWidth,
        height: onboardingHeight,
        minWidth: 500,
        maxWidth: maxWidth,
        minHeight: onboardingMinHeight,
        maxHeight: maxHeight,
        webPreferences: {
          preload: path.join(__dirname, "..", "..", "preload.js"),
          nodeIntegration: false,
          contextIsolation: true,
          enableRemoteModule: false,
          sandbox: true,
          devTools: process.env.NODE_ENV === "development",
          // CRITICAL: These settings ensure URLs load internally, not externally
          webSecurity: true,
          allowRunningInsecureContent: false,
          nodeIntegrationInSubFrames: false,
          // Prevent external navigation interception
          partition: "persist:main", // Use persistent session
        },
        frame: true, // CRITICAL: Show proper window frame with title bar
        titleBarStyle: process.platform === "darwin" ? "default" : "default", // Standard macOS/Windows title bar
        resizable: true, // Allow resizing for scrolling
        minimizable: true,
        maximizable: false, // Prevent maximizing to keep within bounds
        closable: true,
        transparent: false, // CRITICAL: Must be false for proper window frame
        backgroundColor: "#000000", // Solid black background
        show: false, // Don't show until ready
        skipTaskbar: false, // Show in taskbar during onboarding
        alwaysOnTop: false, // Don't force on top - allow pill UI to be visible behind
        center: true, // Center on screen
        modal: false, // CRITICAL: Non-modal so pill UI can be visible behind it
        title: "Centris AI - Setup",
        hasShadow: true, // Show window shadow for proper macOS appearance
        acceptsFirstMouse: false,
        type: "normal", // Normal window type, not panel
        // Ensure window stays within screen bounds
        x: bounds.x + (bounds.width - onboardingWidth) / 2,
        y: bounds.y + (bounds.height - onboardingHeight) / 2,
      });

      // CRITICAL: Explicitly enforce frame settings after creation
      // These must be set to ensure proper window frame appearance
      this.mainWindow.setBackgroundColor("#000000");
      this.mainWindow.setOpacity(1.0);

      // Verify frame is enabled (should be true, but double-check)
      if (!this.mainWindow.isDestroyed()) {
        // Note: Electron doesn't provide a way to check if frame is enabled,
        // but we can verify other settings
        logger.log(
          "[WindowManager] Onboarding window created with frame: true, transparent: false",
        );
      }

      // Context menu is handled globally in main.js via browser-window-created event
      // No need to set it up here to avoid conflicts

      // CRITICAL: Set up navigation handlers IMMEDIATELY after window creation
      // This prevents external apps (like Cursor) from intercepting the URL
      // Must be done BEFORE loadURL is called
      this.mainWindow.webContents.on("will-navigate", (event, navigationUrl) => {
        try {
          const parsedUrl = new URL(navigationUrl);
          // Allow localhost and file:// URLs - these are internal to Electron
          const isLocalUrl =
            parsedUrl.protocol === "file:" ||
            parsedUrl.hostname === "localhost" ||
            parsedUrl.hostname === "127.0.0.1";

          if (!isLocalUrl) {
            logger.warn("Blocked navigation to external URL:", navigationUrl);
            event.preventDefault();
          } else {
            logger.log("Allowing internal navigation to:", navigationUrl);
          }
        } catch (e) {
          // Invalid URL, allow it (might be a relative path)
          logger.log("Allowing navigation (relative/invalid URL):", navigationUrl);
        }
      });

      this.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        try {
          const parsedUrl = new URL(url);
          const isLocalUrl =
            parsedUrl.protocol === "file:" ||
            parsedUrl.hostname === "localhost" ||
            parsedUrl.hostname === "127.0.0.1";

          if (!isLocalUrl) {
            logger.warn("Blocked external window open:", url);
            return { action: "deny" };
          }
          return { action: "allow" };
        } catch (e) {
          return { action: "allow" }; // Allow if URL parsing fails
        }
      });

      // Register other main window events (but navigation is already handled above)
      // We'll skip registerMainWindowEvents for onboarding to avoid duplicate handlers

      // CRITICAL: Show window when ready - this ensures onboarding appears
      // Don't show before ready-to-show event, or it might appear blank
      this.mainWindow.once("ready-to-show", () => {
        logger.debug("[WindowManager] 🎉 ready-to-show event fired!");
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          // Ensure frame settings are still correct before showing
          this.mainWindow.setBackgroundColor("#000000");
          this.mainWindow.setOpacity(1.0);

          // CRITICAL: Show window - this makes onboarding visible
          logger.debug("[WindowManager] 👁️ Showing window...");
          this.mainWindow.show();
          this.mainWindow.focus();
          this.mainWindow.moveTop();

          // Automatically open DevTools console for debugging (ALWAYS, not just in dev)
          logger.debug("[WindowManager] 🔧 Opening DevTools console...");
          try {
            this.mainWindow.webContents.openDevTools();
            logger.debug("[WindowManager] ✅ DevTools opened successfully");
            logger.log("[WindowManager] ✅ DevTools opened successfully");
          } catch (error) {
            logger.error("[WindowManager] ❌ Failed to open DevTools:", error);
            logger.error("[WindowManager] Failed to open DevTools:", error);
          }

          const currentUrl = this.mainWindow.webContents.getURL();
          logger.debug("[WindowManager] ✅ Onboarding window ready and shown");
          console.log(`[WindowManager] 📍 Window URL: ${currentUrl}`);
          console.log(`[WindowManager] 👁️ Window visible: ${this.mainWindow.isVisible()}`);
          logger.log("[WindowManager] ✅ Onboarding window ready and shown with frame");
          logger.log("[WindowManager] Window visible:", this.mainWindow.isVisible());
          logger.log("[WindowManager] Window URL:", currentUrl);
        } else {
          logger.error("[WindowManager] ❌ Window is null or destroyed in ready-to-show handler!");
        }
      });

      // Also handle did-finish-load to ensure window is shown even if ready-to-show doesn't fire
      this.mainWindow.webContents.once("did-finish-load", () => {
        console.log("═══════════════════════════════════════════════════════════");
        console.log("🎉 [WindowManager] Onboarding did-finish-load event FIRED!");
        console.log("═══════════════════════════════════════════════════════════");
        const currentUrl = this.mainWindow.webContents.getURL();
        console.log(`[WindowManager] 📍 Loaded URL: ${currentUrl}`);
        console.log(`[WindowManager] 👁️ Window visible: ${this.mainWindow.isVisible()}`);
        console.log(`[WindowManager] 💀 Window destroyed: ${this.mainWindow.isDestroyed()}`);

        // Backup: Open DevTools if not already open
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          try {
            if (!this.mainWindow.webContents.isDevToolsOpened()) {
              logger.debug("[WindowManager] 🔧 Opening DevTools (backup from did-finish-load)...");
              this.mainWindow.webContents.openDevTools();
            } else {
              logger.debug("[WindowManager] ✅ DevTools already open");
            }
          } catch (error) {
            logger.error("[WindowManager] ❌ Failed to open DevTools in backup:", error);
          }
        }

        if (this.mainWindow && !this.mainWindow.isDestroyed() && !this.mainWindow.isVisible()) {
          logger.debug(
            "[WindowManager] ⚠️ Window finished loading but not visible, showing now...",
          );
          logger.log("[WindowManager] Window finished loading but not visible, showing now...");
          this.mainWindow.show();
          this.mainWindow.focus();
          console.log(
            `[WindowManager] 👁️ Window visible after show(): ${this.mainWindow.isVisible()}`,
          );
        }
        console.log("═══════════════════════════════════════════════════════════");
      });

      // Enforce bounds constraints
      this.mainWindow.on("will-resize", (event, newBounds) => {
        // Ensure window doesn't exceed screen bounds
        if (newBounds.width > maxWidth) {
          event.preventDefault();
          this.mainWindow.setSize(maxWidth, newBounds.height);
        }
        if (newBounds.height > maxHeight) {
          event.preventDefault();
          this.mainWindow.setSize(newBounds.width, maxHeight);
        }
      });

      // Prevent window from moving outside screen bounds
      this.mainWindow.on("will-move", (event, newBounds) => {
        if (newBounds.x < bounds.x) {
          event.preventDefault();
          this.mainWindow.setPosition(bounds.x, newBounds.y);
        }
        if (newBounds.y < bounds.y) {
          event.preventDefault();
          this.mainWindow.setPosition(newBounds.x, bounds.y);
        }
        if (newBounds.x + newBounds.width > bounds.x + bounds.width) {
          event.preventDefault();
          this.mainWindow.setPosition(bounds.x + bounds.width - newBounds.width, newBounds.y);
        }
        if (newBounds.y + newBounds.height > bounds.y + bounds.height) {
          event.preventDefault();
          this.mainWindow.setPosition(newBounds.x, bounds.y + bounds.height - newBounds.height);
        }
      });

      logger.log("[WindowManager] Created onboarding window with frame and bounds constraints");
      logger.log("[WindowManager] Window settings:", {
        frame: true,
        transparent: false,
        backgroundColor: "#000000",
        title: "Centris AI - Setup",
        type: "normal",
        hasShadow: true,
      });

      // CRITICAL: Ensure onboarding window is NOT in overlay mode
      // Explicitly disable any overlay-related settings
      this.mainWindow.setSkipTaskbar(false); // Show in taskbar
      this.mainWindow.setIgnoreMouseEvents(false); // Allow all mouse events
      this.mainWindow.setAlwaysOnTop(false); // Normal window behavior - allows pill UI behind it
      this.mainWindow.setVisibleOnAllWorkspaces(false); // Normal workspace behavior

      // CRITICAL: Make window non-modal so pill UI can be visible behind it (like Wispr Flow)
      // This allows both windows to be visible simultaneously

      // Store flag to prevent any overlay code from running
      this.isOnboardingMode = true;

      // CRITICAL: Load the URL for onboarding window immediately after creation
      // This ensures the window has content to display
      logger.debug("[WindowManager] 🔄 Loading onboarding window URL...");
      logger.log("[WindowManager] Loading onboarding window URL...");
      await this.loadMainWindow();
      logger.debug("[WindowManager] ✅ Onboarding window URL load completed");
    } else {
      logger.debug("[WindowManager] 🎯 NOT in onboarding mode, checking preferences...");
      // Store flag for non-onboarding mode
      this.isOnboardingMode = false;

      // Check if preferences need to be shown
      // preferencesCompleted already declared at top of function

      if (!preferencesCompleted) {
        logger.debug("[WindowManager] 🎯 Creating PREFERENCES window...");
        // Preferences not completed - create preferences window (non-modal)
        // Pill UI will be created separately via IPC when needed
        logger.log("[WindowManager] Preferences not completed, will show preferences window");
        // The preferences window will be created by the React component
        // We'll create a normal window for preferences
        logger.debug("[WindowManager] 🔨 Creating BrowserWindow for preferences...");
        this.mainWindow = new BrowserWindow({
          width: 800,
          height: 900,
          minWidth: 600,
          minHeight: 700,
          webPreferences: {
            preload: path.join(__dirname, "..", "..", "preload.js"),
            nodeIntegration: false,
            contextIsolation: true,
            enableRemoteModule: false,
            sandbox: true,
            devTools: process.env.NODE_ENV === "development",
            webSecurity: true,
            allowRunningInsecureContent: false,
            nodeIntegrationInSubFrames: false,
            partition: "persist:main",
          },
          frame: true,
          titleBarStyle: process.platform === "darwin" ? "default" : "default",
          resizable: true,
          minimizable: true,
          maximizable: false,
          closable: true,
          transparent: false,
          backgroundColor: "#000000",
          show: false,
          skipTaskbar: false,
          alwaysOnTop: false, // CRITICAL: Not always on top so pill UI can be visible
          center: true,
          modal: false, // CRITICAL: Non-modal so pill UI can be visible behind it
          title: "Centris AI", // Main app window (not just preferences)
          hasShadow: true,
          acceptsFirstMouse: false,
          type: "normal",
        });

        this.mainWindow.setBackgroundColor("#000000");
        this.mainWindow.setOpacity(1.0);

        // CRITICAL: When preferences window (main app) closes, also close pill UI (like Wispr Flow)
        this.mainWindow.on("close", (event) => {
          logger.log("[WindowManager] Preferences window (main app) closing - closing pill UI too");
          // Close pill UI when preferences window closes
          if (this.pillUIWindow && !this.pillUIWindow.isDestroyed()) {
            this.pillUIWindow.close();
          }
          // Allow window to close (quit app)
        });

        // Context menu is handled globally in main.js via browser-window-created event
        // No need to set it up here to avoid conflicts

        // CRITICAL: Set up navigation handlers BEFORE loading URL
        // Prevent external apps from intercepting localhost URLs
        this.mainWindow.webContents.on("will-navigate", (event, navigationUrl) => {
          try {
            const parsedUrl = new URL(navigationUrl);
            const isLocalUrl =
              parsedUrl.protocol === "file:" ||
              parsedUrl.hostname === "localhost" ||
              parsedUrl.hostname === "127.0.0.1";

            if (!isLocalUrl) {
              logger.warn("Blocked navigation to external URL:", navigationUrl);
              event.preventDefault();
            } else {
              logger.log("Allowing internal navigation to:", navigationUrl);
            }
          } catch (e) {
            logger.log("Allowing navigation (relative/invalid URL):", navigationUrl);
          }
        });

        this.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
          try {
            const parsedUrl = new URL(url);
            const isLocalUrl =
              parsedUrl.protocol === "file:" ||
              parsedUrl.hostname === "localhost" ||
              parsedUrl.hostname === "127.0.0.1";

            if (!isLocalUrl) {
              logger.warn("Blocked external window open:", url);
              return { action: "deny" };
            }
            return { action: "allow" };
          } catch (e) {
            return { action: "allow" };
          }
        });

        // Set up other main window events
        this.registerMainWindowEvents();

        // Show when ready
        this.mainWindow.once("ready-to-show", () => {
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.show();
            this.mainWindow.focus();
            this.mainWindow.moveTop();

            // Automatically open DevTools console for debugging (ALWAYS)
            logger.debug("[WindowManager] 🔧 Opening DevTools console for preferences window...");
            try {
              this.mainWindow.webContents.openDevTools();
              logger.debug("[WindowManager] ✅ DevTools opened for preferences window");
            } catch (error) {
              logger.error("[WindowManager] ❌ Failed to open DevTools:", error);
            }

            logger.log("[WindowManager] Preferences window (MAIN APP) ready and shown");
          }
        });

        this.mainWindow.webContents.once("did-finish-load", () => {
          console.log("═══════════════════════════════════════════════════════════");
          console.log("🎉 [WindowManager] Preferences did-finish-load event FIRED!");
          console.log("═══════════════════════════════════════════════════════════");
          const currentUrl = this.mainWindow.webContents.getURL();
          console.log(`[WindowManager] 📍 Loaded URL: ${currentUrl}`);
          console.log(`[WindowManager] 👁️ Window visible: ${this.mainWindow.isVisible()}`);
          if (this.mainWindow && !this.mainWindow.isDestroyed() && !this.mainWindow.isVisible()) {
            logger.debug("[WindowManager] ⚠️ Preferences window not visible, showing now...");
            this.mainWindow.show();
            this.mainWindow.focus();
            console.log(
              `[WindowManager] 👁️ Window visible after show(): ${this.mainWindow.isVisible()}`,
            );
          }
          logger.debug("[WindowManager] ✅ Preferences window loaded and ready");
          logger.log("[WindowManager] Preferences window loaded and ready");
          console.log("═══════════════════════════════════════════════════════════");
        });

        // CRITICAL: Load the URL for preferences window
        // This must be called to actually load the React app
        // Use loadMainWindow() helper which handles dev server and caching
        logger.debug("[WindowManager] 🔄 Loading preferences window URL...");
        logger.log("[WindowManager] Loading preferences window URL...");
        // Store flag to skip duplicate load later
        this._preferencesWindowLoaded = true;
        await this.loadMainWindow();
        logger.debug("[WindowManager] ✅ Preferences window URL load completed");
      } else {
        logger.debug(
          "[WindowManager] 🎯 Both onboarding and preferences completed - creating VISIBLE main Dashboard + pill UI...",
        );
        // Both completed - create VISIBLE main window for Dashboard + pill UI windows
        const display = screen.getPrimaryDisplay();
        const { width: screenWidth, height: screenHeight } = display.workAreaSize;
        const dashboardWidth = Math.min(1200, screenWidth - 100);
        const dashboardHeight = Math.min(800, screenHeight - 100);

        logger.debug("[WindowManager] 🔨 Creating Dashboard BrowserWindow...");
        this.mainWindow = new BrowserWindow({
          ...MAIN_WINDOW_CONFIG,
          width: dashboardWidth,
          height: dashboardHeight,
          x: Math.floor((screenWidth - dashboardWidth) / 2),
          y: Math.floor((screenHeight - dashboardHeight) / 2),
          focusable: true,
          show: false, // Will show on ready-to-show
          skipTaskbar: false,
          frame: true,
          titleBarStyle: process.platform === "darwin" ? "default" : "default",
          resizable: true,
          minimizable: true,
          maximizable: true,
          closable: true,
          transparent: false,
          backgroundColor: "#000000",
          title: "Centris AI",
          hasShadow: true,
        });

        // Show window when ready
        this.mainWindow.once("ready-to-show", () => {
          logger.debug("[WindowManager] 🎉 Dashboard ready-to-show event fired");
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.show();
            this.mainWindow.focus();
            logger.debug("[WindowManager] ✅ Dashboard window shown");

            // Open DevTools in development
            if (process.env.NODE_ENV === "development") {
              this.mainWindow.webContents.openDevTools();
            }
          }
        });

        // Also create pill UI overlay windows for multi-monitor support
        logger.debug("[WindowManager] 🎯 Creating pill UI windows...");
        try {
          await this.createPillUIWindow();
          logger.debug("[WindowManager] ✅ Pill UI windows creation completed");
        } catch (error) {
          logger.error("[WindowManager] ❌ Error creating pill UI windows:", error);
          logger.error("[WindowManager] Error creating pill UI windows:", error);
        }
      }
    }

    // CRITICAL: Register events BEFORE loading URL
    // Onboarding window already has all handlers set up above
    // Preferences window already has handlers set up above
    // Only register for other windows (hidden main window after preferences)
    // preferencesCompleted already declared at top of function
    if (!this.isOnboardingMode && preferencesCompleted) {
      // Only register for hidden main window (after preferences completed)
      this.registerMainWindowEvents();
    }

    // CRITICAL: Don't show window before loading - let ready-to-show handle it
    // This ensures onboarding appears properly and prevents external URL interception
    // The ready-to-show event will show the window when content is ready

    // Load the URL - navigation handlers should already be in place, window is shown
    // BUT: Preferences window and onboarding window already load URL above, so skip if already loaded
    if (this._preferencesWindowLoaded) {
      // Preferences window - already loaded URL above, just log
      logger.log("[WindowManager] Preferences window URL already loaded above");
      this._preferencesWindowLoaded = false; // Reset flag
    } else if (this.isOnboardingMode) {
      // Onboarding window - already loaded URL above, just log
      logger.log("[WindowManager] Onboarding window URL already loaded above");
    } else if (preferencesCompleted) {
      // Hidden main window after preferences - load URL now
      await this.loadMainWindow();
    }

    // Only initialize hotkey and drag manager if not in onboarding mode
    // (Onboarding mode will initialize these after conversion)
    if (!needsOnboarding) {
      await this.initializeHotkey();
      this.dragManager.setTargetWindow(this.mainWindow);
    }

    MenuManager.setupMainMenu();

    // Navigation handlers are already set up:
    // - For onboarding: Set up immediately after window creation (above)
    // - For non-onboarding: Set up in registerMainWindowEvents()
    // No need to duplicate them here

    // Store timeout reference for cleanup
    this.failLoadTimeout = null;
    this.mainWindow.webContents.on(
      "did-fail-load",
      async (_event, errorCode, errorDescription, validatedURL) => {
        console.error("═══════════════════════════════════════════════════════════");
        console.error("❌ [WindowManager] did-fail-load event FIRED!");
        console.error("═══════════════════════════════════════════════════════════");
        console.error(`[WindowManager] ❌ Failed to load URL: ${validatedURL}`);
        console.error(`[WindowManager] Error code: ${errorCode}`);
        console.error(`[WindowManager] Error description: ${errorDescription}`);
        logger.error(
          `❌ Failed to load URL: ${validatedURL}, error: ${errorCode} - ${errorDescription}`,
        );

        // Clear any existing timeout
        if (this.failLoadTimeout) {
          clearTimeout(this.failLoadTimeout);
        }

        if (
          process.env.NODE_ENV === "development" &&
          validatedURL &&
          validatedURL.includes("localhost:5174")
        ) {
          // Retry connection to dev server
          logger.log("🔄 Retrying load after failure...");
          this.failLoadTimeout = setTimeout(async () => {
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
              const isReady = await DevServerManager.waitForDevServer();
              if (isReady) {
                logger.log("🔄 Reloading window after dev server is ready...");
                this.mainWindow.reload();
              } else {
                logger.error("❌ Dev server not ready, cannot reload");
              }
            }
            this.failLoadTimeout = null;
          }, 2000);
        } else if (
          validatedURL &&
          (validatedURL.includes("localhost") || validatedURL.includes("127.0.0.1"))
        ) {
          // Retry localhost URLs (might have been blocked by OS dialog)
          logger.log("🔄 Retrying localhost URL load...");
          this.failLoadTimeout = setTimeout(async () => {
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
              try {
                await this.mainWindow.webContents.loadURL(validatedURL);
                logger.log("✅ Successfully loaded URL on retry");
              } catch (error) {
                logger.error("❌ Retry also failed:", error);
              }
            }
            this.failLoadTimeout = null;
          }, 2000);
        }
      },
    );

    // Log console messages from renderer for debugging
    // Electron passes: (event, level, message, line, sourceId)
    // level: 0=info, 1=warning, 2=error
    // OPTIMIZATION: Filter out noisy/repeated messages to reduce log bloat
    this.mainWindow.webContents.on("console-message", (event, level, message) => {
      const details = getConsoleMessageDetails(event, level, message);
      const rendererMessage = details.message;
      if (!rendererMessage) {
        return;
      }

      // Skip noisy repeated messages that don't help debugging
      const skipPatterns = [
        /Setting up on\w+Listener/, // Listener setup messages (repeated on mount)
        /Already initializing/, // Duplicate init warnings
        /Wake word mode:/, // Status updates
        /Initialized with audio context/, // Audio init (happens multiple times)
        /Connected to Unified Audio/, // Audio connection
        /ScriptProcessorNode is deprecated/, // Browser warning
      ];

      if (skipPatterns.some((p) => p.test(rendererMessage))) {
        return; // Skip noisy messages
      }

      const prefix = toConsolePrefix(details.level);
      // Only log to console, not double-logging via logger
      console.log(`[Renderer Main] ${prefix} ${rendererMessage}`);
    });

    // CRITICAL: Log when renderer starts loading
    this.mainWindow.webContents.on("did-start-loading", () => {
      logger.debug("[WindowManager] 🔄 Renderer STARTED loading...");
      logger.log("[WindowManager] Renderer started loading");
    });

    // CRITICAL: Log DOM ready state
    this.mainWindow.webContents.on("dom-ready", () => {
      logger.debug("[WindowManager] ✅ DOM is READY!");
      logger.log("[WindowManager] DOM ready");
    });

    // Log any uncaught exceptions in the renderer
    this.mainWindow.webContents.on("uncaught-exception", (event, error) => {
      console.error("═══════════════════════════════════════════════════════════");
      console.error("❌ [WindowManager] UNCAUGHT EXCEPTION in renderer!");
      console.error("═══════════════════════════════════════════════════════════");
      console.error("Error:", error);
      console.error("Error message:", error?.message);
      console.error("Error stack:", error?.stack);
      console.error("═══════════════════════════════════════════════════════════");
    });

    // Log any preload script errors
    this.mainWindow.webContents.on("preload-error", (event, preloadPath, error) => {
      console.error("═══════════════════════════════════════════════════════════");
      console.error("❌ [WindowManager] PRELOAD SCRIPT ERROR!");
      console.error("═══════════════════════════════════════════════════════════");
      console.error("Preload path:", preloadPath);
      console.error("Error:", error);
      console.error("Error message:", error?.message);
      console.error("Error stack:", error?.stack);
      console.error("═══════════════════════════════════════════════════════════");
    });

    // Log renderer process crashes
    this.mainWindow.webContents.on("render-process-gone", (event, details) => {
      console.error("═══════════════════════════════════════════════════════════");
      console.error("❌ [WindowManager] RENDERER PROCESS CRASHED!");
      console.error("═══════════════════════════════════════════════════════════");
      console.error("Details:", details);
      console.error("═══════════════════════════════════════════════════════════");
    });

    this.mainWindow.webContents.on("did-finish-load", () => {
      console.log("═══════════════════════════════════════════════════════════");
      console.log("🎉 [WindowManager] did-finish-load event FIRED!");
      console.log("═══════════════════════════════════════════════════════════");
      const loadedUrl = this.mainWindow.webContents.getURL();
      console.log(`[WindowManager] 📍 Loaded URL: ${loadedUrl}`);
      console.log(`[WindowManager] 👁️ Window visible: ${this.mainWindow.isVisible()}`);
      console.log(`[WindowManager] 💀 Window destroyed: ${this.mainWindow.isDestroyed()}`);

      // CRITICAL: Check if renderer is actually executing
      this.mainWindow.webContents
        .executeJavaScript(`
          logger.debug('[WindowManager] ✅ JavaScript execution test - renderer is ALIVE!');
          logger.debug('[WindowManager] 📍 Current URL:', window.location.href);
          logger.debug('[WindowManager] 📍 electronAPI available:', !!window.electronAPI);
          logger.debug('[WindowManager] 📍 document.readyState:', document.readyState);
          logger.debug('[WindowManager] 📍 root element exists:', !!document.getElementById('root'));
          return {
            url: window.location.href,
            electronAPI: !!window.electronAPI,
            readyState: document.readyState,
            rootExists: !!document.getElementById('root')
          };
        `)
        .then((result) => {
          logger.debug("[WindowManager] ✅ Renderer JavaScript execution SUCCESS!");
          logger.debug("[WindowManager] 📊 Renderer state:", JSON.stringify(result, null, 2));
        })
        .catch((error) => {
          logger.error("[WindowManager] ❌ Renderer JavaScript execution FAILED!");
          logger.error("[WindowManager] Error:", error);
        });

      logger.log(`[WindowManager] ✅ URL finished loading: ${loadedUrl}`);
      logger.log(`[WindowManager] Window visible: ${this.mainWindow.isVisible()}`);
      logger.log(`[WindowManager] Window destroyed: ${this.mainWindow.isDestroyed()}`);

      // Check if we're in onboarding mode
      const Store = require("electron-store");
      const store = new Store();
      const needsOnboarding = !store.get("hasCompletedOnboarding", false);
      console.log(`[WindowManager] 📋 Needs onboarding: ${needsOnboarding}`);

      // CRITICAL: Ensure window is visible after content loads
      if (!this.mainWindow.isVisible()) {
        console.log("[WindowManager] ⚠️ Window not visible after load, showing now...");
        logger.log("[WindowManager] ⚠️ Window not visible after load, showing now...");
        this.mainWindow.show();
        console.log(
          `[WindowManager] 👁️ Window visible after show(): ${this.mainWindow.isVisible()}`,
        );
      }
      this.mainWindow.focus();

      if (needsOnboarding) {
        // During onboarding: Normal window behavior, no always-on-top
        // Just bring to front without forcing always-on-top
        this.mainWindow.moveTop();
        console.log("✅ Onboarding window loaded and visible with proper frame");
        logger.log("✅ Onboarding window loaded and visible with proper frame");
      } else {
        // After onboarding: Overlay mode with always-on-top
        this.mainWindow.moveTop();
        this.enforceMainWindowOnTop();
        console.log("✅ Main window loaded and visible");
        logger.log("✅ Main window loaded and visible");
      }

      // Open DevTools in development to help debug
      if (process.env.NODE_ENV === "development") {
        console.log("[WindowManager] 🔧 Opening DevTools...");
        this.mainWindow.webContents.openDevTools();
        logger.log("[WindowManager] 🔧 DevTools opened for debugging");
      }
      console.log("═══════════════════════════════════════════════════════════");
    });
  }

  setMainWindowInteractivity(shouldCapture) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }

    // NEVER set ignore mouse events during onboarding - it's a normal window
    if (this.isOnboardingMode) {
      this.mainWindow.setIgnoreMouseEvents(false);
      return;
    }

    // For pill UI: click-through mode when not interacting, allow clicks when interacting
    if (shouldCapture) {
      // Allow mouse events when interacting with UI (pill is clicked)
      this.mainWindow.setIgnoreMouseEvents(false);
    } else {
      // Click-through mode - only UI elements with pointer-events-auto will be clickable
      // This allows the pill to sit above everything without blocking clicks
      this.mainWindow.setIgnoreMouseEvents(true, { forward: true });
    }

    this.isMainWindowInteractive = shouldCapture;
  }

  async loadMainWindow() {
    console.log("═══════════════════════════════════════════════════════════");
    console.log("🔵 [WindowManager] loadMainWindow() CALLED");
    console.log("═══════════════════════════════════════════════════════════");
    logger.log("Loading main window...");

    if (!this.mainWindow) {
      logger.error("[WindowManager] ❌ CRITICAL: mainWindow is NULL!");
      logger.error("CRITICAL: mainWindow is null!");
      return;
    }

    if (this.mainWindow.isDestroyed()) {
      logger.error("[WindowManager] ❌ CRITICAL: mainWindow is DESTROYED!");
      logger.error("CRITICAL: mainWindow is destroyed!");
      return;
    }

    logger.debug("[WindowManager] ✅ mainWindow exists and is not destroyed");

    // Clear Electron cache to prevent stale code
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      logger.debug("[WindowManager] 🧹 Clearing Electron cache...");
      logger.log("Clearing Electron cache...");
      await this.mainWindow.webContents.session.clearCache();
      await this.mainWindow.webContents.session.clearStorageData({
        storages: [
          "cookies",
          "filesystem",
          "indexdb",
          "localstorage",
          "shadercache",
          "websql",
          "serviceworkers",
          "cachestorage",
        ],
      });
      logger.debug("[WindowManager] ✅ Cache cleared");
      logger.log("Cache cleared");
    }

    const appUrl = DevServerManager.getAppUrl(false);
    console.log(`[WindowManager] 📍 App URL: ${appUrl}`);
    logger.log("App URL:", appUrl);

    if (process.env.NODE_ENV === "development") {
      logger.debug("[WindowManager] 🔍 Checking dev server availability...");
      logger.log("Checking dev server availability...");
      const isReady = await DevServerManager.waitForDevServer();
      if (!isReady) {
        logger.error("[WindowManager] ❌ Dev server NOT ready!");
        logger.error("❌ Dev server not ready! Please start it with: npm run dev:renderer");
        logger.error("   Or use the combined command: npm run dev");
        logger.warn("Continuing anyway, but the window may be blank...");
        // Show error dialog to user
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          const { dialog } = require("electron");
          dialog.showErrorBox(
            "Development Server Not Running",
            "The Vite dev server is not running.\n\n" +
              "Please run: npm run dev:renderer\n" +
              "Or use: npm run dev\n\n" +
              "The window will be blank until the server starts.",
          );
        }
      } else {
        logger.debug("[WindowManager] ✅ Dev server is ready");
        logger.log("✅ Dev server is ready");
      }
    }

    console.log(`[WindowManager] 🔄 Loading URL into window: ${appUrl}`);
    console.log(`[WindowManager] 📊 Window state check:`);
    console.log(`  - Window exists: ${!!this.mainWindow}`);
    console.log(`  - Window destroyed: ${this.mainWindow?.isDestroyed()}`);
    console.log(`  - Window visible: ${this.mainWindow?.isVisible()}`);
    logger.log("Loading URL into window:", appUrl);
    logger.log(`[WindowManager] Window exists: ${!!this.mainWindow}`);
    logger.log(`[WindowManager] Window destroyed: ${this.mainWindow?.isDestroyed()}`);

    // CRITICAL: Load URL and retry if it fails (e.g., due to OS dialog interception)
    const loadUrlWithRetry = async (retries = 3) => {
      for (let i = 0; i < retries; i++) {
        try {
          console.log(`[WindowManager] 🔄 Attempt ${i + 1}/${retries}: Loading URL...`);
          logger.log(`[WindowManager] 🔄 Attempting to load URL (attempt ${i + 1}/${retries})...`);
          await this.mainWindow.webContents.loadURL(appUrl, {
            cacheControl: "no-cache",
            extraHeaders:
              "Cache-Control: no-cache, no-store, must-revalidate\nPragma: no-cache\nExpires: 0",
          });
          const actualUrl = this.mainWindow.webContents.getURL();
          console.log(`[WindowManager] ✅ URL loaded successfully!`);
          console.log(`[WindowManager] 📍 Actual URL in window: ${actualUrl}`);
          logger.log(`✅ URL loaded successfully! Actual URL: ${actualUrl}`);
          return;
        } catch (error) {
          console.error(`[WindowManager] ❌ URL load attempt ${i + 1} FAILED:`, error.message);
          console.error(`[WindowManager] Error details:`, error);
          logger.warn(`⚠️ URL load attempt ${i + 1} failed:`, error.message);
          if (i < retries - 1) {
            // Wait a bit before retrying (gives time for OS dialog to be dismissed)
            console.log(`[WindowManager] ⏳ Waiting 1 second before retry...`);
            logger.log(`[WindowManager] ⏳ Waiting 1 second before retry...`);
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
      }
      // Final fallback
      logger.error("[WindowManager] ❌ All URL load attempts failed, using fallback");
      logger.error("❌ All URL load attempts failed, using fallback");
      try {
        logger.debug("[WindowManager] 🔄 Trying fallback loadURL()...");
        this.mainWindow.loadURL(appUrl);
        logger.debug("[WindowManager] ✅ Fallback loadURL() called");
        logger.log(`[WindowManager] Fallback loadURL called`);
      } catch (error) {
        logger.error("[WindowManager] ❌ Fallback also failed:", error);
        logger.error(`[WindowManager] ❌ Fallback also failed:`, error);
      }
    };

    await loadUrlWithRetry();
    logger.debug("[WindowManager] ✅ loadMainWindow() COMPLETED");
    console.log("═══════════════════════════════════════════════════════════");
  }

  async initializeHotkey() {
    const callback = () => {
      // Hotkey should interact with pill UI window, not main window
      const targetWindow = this.pillUIWindow || this.mainWindow;
      if (!targetWindow || targetWindow.isDestroyed()) {
        return;
      }

      // Restore if minimized
      if (targetWindow.isMinimized()) {
        targetWindow.restore();
      }

      // Show window if hidden
      if (!targetWindow.isVisible()) {
        targetWindow.show();
      }

      // Always focus and bring to front
      targetWindow.focus();
      targetWindow.moveTop();
      if (this.pillUIWindow) {
        this.pillUIWindow.setAlwaysOnTop(true, "floating", 1);
      }

      // Send toggle event to pill UI window
      targetWindow.webContents.send("toggle-dictation");
    };

    await this.hotkeyManager.initializeHotkey(this.pillUIWindow || this.mainWindow, callback);
  }

  async updateHotkey(hotkey) {
    const callback = () => {
      if (!this.mainWindow || this.mainWindow.isDestroyed()) {
        return;
      }

      // Restore if minimized
      if (this.mainWindow.isMinimized()) {
        this.mainWindow.restore();
      }

      // Show window if hidden
      if (!this.mainWindow.isVisible()) {
        this.mainWindow.show();
      }

      // Always focus and bring to front
      this.mainWindow.focus();
      this.mainWindow.moveTop();
      this.enforceMainWindowOnTop();

      // Send toggle event
      this.mainWindow.webContents.send("toggle-dictation");
    };

    return await this.hotkeyManager.updateHotkey(hotkey, callback);
  }

  /**
   * Create separate pill UI overlay windows (Glass AI style)
   * MULTI-MONITOR SUPPORT: Creates ONE window PER display for reliable multi-monitor rendering
   * This is more reliable than spanning one window across multiple monitors on macOS
   */
  async createPillUIWindow() {
    console.log("═══════════════════════════════════════════════════════════");
    console.log("🔵 [WindowManager] createPillUIWindow() CALLED");
    console.log("═══════════════════════════════════════════════════════════");

    // If pill UI windows already exist and are valid, just ensure they're visible
    if (this.pillUIWindows.length > 0 || (this.pillUIWindow && !this.pillUIWindow.isDestroyed())) {
      logger.debug("[WindowManager] ℹ️ Pill UI windows already exist, ensuring visibility...");
      logger.log("[WindowManager] Pill UI windows already exist, ensuring they are visible...");

      // Show all existing pill windows
      this.pillUIWindows.forEach((win, index) => {
        if (win && !win.isDestroyed()) {
          if (!win.isVisible()) {
            win.show();
          }
          win.moveTop();
          win.setAlwaysOnTop(true, "floating", 1);
        }
      });

      // Also handle legacy single window
      if (this.pillUIWindow && !this.pillUIWindow.isDestroyed()) {
        if (!this.pillUIWindow.isVisible()) {
          this.pillUIWindow.show();
        }
        this.pillUIWindow.moveTop();
        this.pillUIWindow.setAlwaysOnTop(true, "floating", 1);
      }

      logger.debug("[WindowManager] ✅ Pill UI windows are now visible");
      logger.log("[WindowManager] ✅ Pill UI windows are now visible");
      return;
    }

    // MULTI-MONITOR SUPPORT: Create one window per display
    const allDisplays = screen.getAllDisplays();
    console.log(`[WindowManager] 📺 Found ${allDisplays.length} display(s)`);

    // Close any existing windows first
    this.closeAllPillWindows();

    logger.debug("[WindowManager] 🔨 Creating pill UI overlay windows (one per display)...");
    logger.log("[WindowManager] Creating pill UI overlay windows (one per display)...");

    // Create a pill window for each display
    for (let i = 0; i < allDisplays.length; i++) {
      const display = allDisplays[i];
      const b = display.bounds;
      console.log(
        `[WindowManager] 📺 Creating pill window for Display ${i + 1}: ${b.width}x${b.height} at (${b.x}, ${b.y})`,
      );

      try {
        const pillWindow = new BrowserWindow({
          ...PILL_UI_WINDOW_CONFIG,
          width: b.width,
          height: b.height,
          x: b.x,
          y: b.y,
          focusable: false, // Don't steal focus
          show: false, // Will be shown when loaded
          title: `Centris AI Pill - Display ${i + 1}`,
        });

        pillWindow.setSkipTaskbar(true);
        pillWindow.setBackgroundColor("#00000000");

        // Store reference
        this.pillUIWindows.push(pillWindow);

        // Set first window as the primary pill window (for backwards compat)
        if (i === 0) {
          this.pillUIWindow = pillWindow;
        }

        // Prevent navigation
        pillWindow.webContents.on("will-navigate", (event, navigationUrl) => {
          event.preventDefault();
        });
        pillWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

        // Load pill UI with display index parameter
        const appUrl = DevServerManager.getAppUrl(false);
        const pillUIUrl = `${appUrl}?pill=true&displayIndex=${i}&displayX=${b.x}&displayY=${b.y}&displayWidth=${b.width}&displayHeight=${b.height}`;
        console.log(`[WindowManager] 📍 Pill UI URL for display ${i + 1}: ${pillUIUrl}`);

        // Clear cache and load
        await pillWindow.webContents.session.clearCache();
        await pillWindow.webContents.loadURL(pillUIUrl);

        // Show window when loaded
        pillWindow.webContents.once("did-finish-load", () => {
          console.log(`[WindowManager] ✅ Pill window ${i + 1} loaded`);
          if (pillWindow && !pillWindow.isDestroyed()) {
            pillWindow.show();
            pillWindow.setAlwaysOnTop(true, "floating", 1);
            pillWindow.moveTop();
            pillWindow.setVisibleOnAllWorkspaces(true, {
              visibleOnFullScreen: true,
            });
            // Enable click-through
            pillWindow.setIgnoreMouseEvents(true, { forward: true });
          }
        });

        // Log console messages (filtered for noise reduction)
        pillWindow.webContents.on("console-message", (event, level, message) => {
          const details = getConsoleMessageDetails(event, level, message);
          const rendererMessage = details.message;
          if (!rendererMessage) {
            return;
          }

          // Skip noisy repeated messages
          const skipPatterns = [
            /Setting up on\w+Listener/,
            /Already initializing/,
            /Wake word mode:/,
            /Initialized with audio context/,
            /Connected to Unified Audio/,
            /ScriptProcessorNode is deprecated/,
            /📊 Status change/, // Wake word status updates
          ];

          if (skipPatterns.some((p) => p.test(rendererMessage))) {
            return;
          }

          const prefix = toConsolePrefix(details.level);
          console.log(`[Renderer PillUI-${i + 1}] ${prefix} ${rendererMessage}`);
        });

        console.log(`[WindowManager] ✅ Pill window ${i + 1} created`);
      } catch (error) {
        console.error(`[WindowManager] ❌ Error creating pill window for display ${i + 1}:`, error);
        logger.error(`[WindowManager] Error creating pill window for display ${i + 1}:`, error);
      }
    }

    console.log(`[WindowManager] ✅ Created ${this.pillUIWindows.length} pill windows`);
    logger.log(
      `[WindowManager] Created ${this.pillUIWindows.length} pill windows for multi-monitor support`,
    );

    // Don't need the rest of the old code - each window is self-contained
    return;

    // CRITICAL: Prevent external navigation BEFORE loading URL
    // This prevents Cursor and other apps from intercepting localhost URLs
    this.pillUIWindow.webContents.on("will-navigate", (event, navigationUrl) => {
      logger.warn("Blocked navigation attempt from pill UI:", navigationUrl);
      event.preventDefault();
    });

    // Prevent new windows from opening (pill UI should never open windows)
    this.pillUIWindow.webContents.setWindowOpenHandler(({ url }) => {
      logger.warn("Blocked window open attempt from pill UI:", url);
      return { action: "deny" };
    });

    // Load pill UI with pill=true parameter to distinguish from main app
    const appUrl = DevServerManager.getAppUrl(false);
    const pillUIUrl = `${appUrl}?pill=true`;
    console.log(`[WindowManager] 📍 Pill UI URL: ${pillUIUrl}`);
    logger.log("[WindowManager] Loading pill UI in overlay window:", pillUIUrl);

    logger.debug("[WindowManager] 🧹 Clearing pill UI cache...");
    await this.pillUIWindow.webContents.session.clearCache();
    logger.debug("[WindowManager] ✅ Pill UI cache cleared");

    // Load URL with pill parameter
    // CRITICAL: Load URL with retry mechanism in case OS dialog intercepts
    const loadPillUrlWithRetry = async (retries = 3) => {
      for (let i = 0; i < retries; i++) {
        try {
          console.log(`[WindowManager] 🔄 Pill UI URL load attempt ${i + 1}/${retries}...`);
          await this.pillUIWindow.webContents.loadURL(pillUIUrl, {
            cacheControl: "no-cache",
            extraHeaders:
              "Cache-Control: no-cache, no-store, must-revalidate\nPragma: no-cache\nExpires: 0",
          });
          const actualUrl = this.pillUIWindow.webContents.getURL();
          console.log(`[WindowManager] ✅ Pill UI URL loaded successfully!`);
          console.log(`[WindowManager] 📍 Actual URL: ${actualUrl}`);
          logger.log("✅ Pill UI URL loaded successfully");
          return;
        } catch (error) {
          console.error(
            `[WindowManager] ❌ Pill UI URL load attempt ${i + 1} FAILED:`,
            error.message,
          );
          logger.warn(`⚠️ Pill UI URL load attempt ${i + 1} failed:`, error.message);
          if (i < retries - 1) {
            console.log(`[WindowManager] ⏳ Waiting 1 second before retry...`);
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
      }
      // Final fallback
      logger.error("[WindowManager] ❌ All pill UI URL load attempts failed, using fallback");
      logger.error("❌ All pill UI URL load attempts failed, using fallback");
      try {
        await this.pillUIWindow.loadURL(pillUIUrl);
        logger.debug("[WindowManager] ✅ Fallback pill UI loadURL() called");
      } catch (error) {
        logger.error("[WindowManager] ❌ Fallback also failed:", error);
      }
    };

    // CRITICAL: Show window when ready-to-show fires (even if URL hasn't loaded yet)
    // This ensures the window appears even if there are loading issues
    this.pillUIWindow.once("ready-to-show", () => {
      console.log("═══════════════════════════════════════════════════════════");
      console.log("🎉 [WindowManager] Pill UI ready-to-show event FIRED!");
      console.log("═══════════════════════════════════════════════════════════");
      if (this.pillUIWindow && !this.pillUIWindow.isDestroyed()) {
        logger.debug("[WindowManager] 👁️ Showing pill UI window (ready-to-show)...");
        try {
          this.pillUIWindow.show();
          this.pillUIWindow.setAlwaysOnTop(true, "floating", 1);
          this.pillUIWindow.moveTop();
          this.pillUIWindow.setVisibleOnAllWorkspaces(true, {
            visibleOnFullScreen: true,
          });
          console.log(
            `[WindowManager] 👁️ Pill UI window visible: ${this.pillUIWindow.isVisible()}`,
          );
          logger.log("[WindowManager] ✅ Pill UI window shown (ready-to-show)");
        } catch (error) {
          logger.error("[WindowManager] ❌ Error showing pill UI window:", error);
          logger.error("[WindowManager] ❌ Error showing pill UI window:", error);
        }
      } else {
        logger.error(
          "[WindowManager] ❌ Pill UI window is null or destroyed in ready-to-show handler!",
        );
      }
    });

    // Wait for dev server to be ready before loading URL
    if (process.env.NODE_ENV === "development") {
      logger.debug("[WindowManager] 🔍 Waiting for dev server before loading pill UI...");
      const isReady = await DevServerManager.waitForDevServer();
      if (!isReady) {
        logger.error("[WindowManager] ❌ Dev server NOT ready for pill UI!");
        logger.error("❌ Dev server not ready for pill UI! Window may be blank...");
      } else {
        logger.debug("[WindowManager] ✅ Dev server is ready for pill UI");
        logger.log("✅ Dev server is ready for pill UI");
      }
    }

    await loadPillUrlWithRetry();
    logger.debug("[WindowManager] ✅ Pill UI URL loading completed");

    // CRITICAL: Immediate fallback - show window right after URL load attempt
    // Don't wait for events - just show it immediately
    if (this.pillUIWindow && !this.pillUIWindow.isDestroyed() && !this.pillUIWindow.isVisible()) {
      logger.debug(
        "[WindowManager] ⚡ Immediate fallback: Showing pill UI window right after URL load...",
      );
      try {
        this.pillUIWindow.show();
        this.pillUIWindow.setAlwaysOnTop(true, "floating", 1);
        this.pillUIWindow.moveTop();
        this.pillUIWindow.setVisibleOnAllWorkspaces(true, {
          visibleOnFullScreen: true,
        });
        console.log(
          `[WindowManager] 👁️ Pill UI window visible after immediate show(): ${this.pillUIWindow.isVisible()}`,
        );
        logger.log("[WindowManager] ✅ Pill UI window shown (immediate fallback)");
      } catch (error) {
        logger.error("[WindowManager] ❌ Error in immediate show():", error);
        logger.error("[WindowManager] ❌ Error in immediate show():", error);
      }
    }

    // Log console messages from pill UI for debugging
    // Electron passes: (event, level, message, line, sourceId)
    // level: 0=info, 1=warning, 2=error
    // OPTIMIZATION: Filter out noisy messages and don't double-log
    this.pillUIWindow.webContents.on("console-message", (event, level, message) => {
      const details = getConsoleMessageDetails(event, level, message);
      const rendererMessage = details.message;
      if (!rendererMessage) {
        return;
      }

      // Skip noisy repeated messages
      const skipPatterns = [
        /Setting up on\w+Listener/,
        /Already initializing/,
        /Wake word mode:/,
        /Initialized with audio context/,
        /Connected to Unified Audio/,
        /ScriptProcessorNode is deprecated/,
        /📊 Status change/,
      ];

      if (skipPatterns.some((p) => p.test(rendererMessage))) {
        return;
      }

      const prefix = toConsolePrefix(details.level);
      // Only log to console, not double-logging via logger
      console.log(`[Renderer PillUI] ${prefix} ${rendererMessage}`);
    });

    // CRITICAL: Log when pill UI renderer starts loading
    this.pillUIWindow.webContents.on("did-start-loading", () => {
      logger.debug("[WindowManager] 🔄 Pill UI renderer STARTED loading...");
      logger.log("[WindowManager] Pill UI renderer started loading");
    });

    // CRITICAL: Log DOM ready state for pill UI
    this.pillUIWindow.webContents.on("dom-ready", () => {
      logger.debug("[WindowManager] ✅ Pill UI DOM is READY!");
      logger.log("[WindowManager] Pill UI DOM ready");
    });

    // Log errors from pill UI with retry
    this.pillUIWindow.webContents.on(
      "did-fail-load",
      async (event, errorCode, errorDescription, validatedURL) => {
        console.error("═══════════════════════════════════════════════════════════");
        console.error("❌ [WindowManager] Pill UI did-fail-load event FIRED!");
        console.error("═══════════════════════════════════════════════════════════");
        console.error(`[WindowManager] Error code: ${errorCode}`);
        console.error(`[WindowManager] Error description: ${errorDescription}`);
        console.error(`[WindowManager] Failed URL: ${validatedURL}`);
        logger.error(
          "[WindowManager] ❌ Pill UI failed to load:",
          errorCode,
          errorDescription,
          validatedURL,
        );

        // CRITICAL: Show window even if URL failed to load
        // This ensures the window is visible so user can see what's happening
        if (this.pillUIWindow && !this.pillUIWindow.isDestroyed()) {
          if (!this.pillUIWindow.isVisible()) {
            logger.debug("[WindowManager] 👁️ Showing pill UI window despite load failure...");
            this.pillUIWindow.show();
            this.pillUIWindow.setAlwaysOnTop(true, "floating", 1);
            this.pillUIWindow.moveTop();
          }
        }

        // Retry loading if it's a localhost URL (might have been blocked by OS dialog)
        if (
          validatedURL &&
          (validatedURL.includes("localhost") || validatedURL.includes("127.0.0.1"))
        ) {
          logger.debug("[WindowManager] 🔄 Retrying pill UI URL load in 2 seconds...");
          logger.log("[WindowManager] 🔄 Retrying pill UI URL load in 2 seconds...");
          setTimeout(async () => {
            if (this.pillUIWindow && !this.pillUIWindow.isDestroyed()) {
              try {
                // Wait for dev server if in development
                if (process.env.NODE_ENV === "development") {
                  await DevServerManager.waitForDevServer();
                }
                await this.pillUIWindow.webContents.loadURL(validatedURL);
                logger.debug("[WindowManager] ✅ Pill UI URL loaded successfully on retry");
                logger.log("[WindowManager] ✅ Pill UI URL loaded successfully on retry");
              } catch (error) {
                logger.error("[WindowManager] ❌ Pill UI retry also failed:", error);
                logger.error("[WindowManager] ❌ Pill UI retry also failed:", error);
              }
            }
          }, 2000);
        }
      },
    );

    // Log pill UI renderer process errors
    this.pillUIWindow.webContents.on("uncaught-exception", (event, error) => {
      console.error("═══════════════════════════════════════════════════════════");
      console.error("❌ [WindowManager] Pill UI UNCAUGHT EXCEPTION!");
      console.error("═══════════════════════════════════════════════════════════");
      console.error("Error:", error);
      console.error("Error message:", error?.message);
      console.error("Error stack:", error?.stack);
      console.error("═══════════════════════════════════════════════════════════");
    });

    this.pillUIWindow.webContents.on("preload-error", (event, preloadPath, error) => {
      console.error("═══════════════════════════════════════════════════════════");
      console.error("❌ [WindowManager] Pill UI PRELOAD ERROR!");
      console.error("═══════════════════════════════════════════════════════════");
      console.error("Preload path:", preloadPath);
      console.error("Error:", error);
      console.error("═══════════════════════════════════════════════════════════");
    });

    this.pillUIWindow.webContents.on("render-process-gone", (event, details) => {
      console.error("═══════════════════════════════════════════════════════════");
      console.error("❌ [WindowManager] Pill UI RENDERER PROCESS CRASHED!");
      console.error("═══════════════════════════════════════════════════════════");
      console.error("Details:", details);
      console.error("═══════════════════════════════════════════════════════════");
    });

    // Show pill UI window when ready
    this.pillUIWindow.webContents.once("did-finish-load", () => {
      console.log("═══════════════════════════════════════════════════════════");
      console.log("🎉 [WindowManager] Pill UI did-finish-load event FIRED!");
      console.log("═══════════════════════════════════════════════════════════");
      const loadedUrl = this.pillUIWindow.webContents.getURL();
      console.log(`[WindowManager] 📍 Pill UI loaded URL: ${loadedUrl}`);
      console.log(`[WindowManager] 👁️ Pill UI window visible: ${this.pillUIWindow.isVisible()}`);
      console.log(
        `[WindowManager] 💀 Pill UI window destroyed: ${this.pillUIWindow.isDestroyed()}`,
      );
      logger.log(`[WindowManager] ✅ Pill UI loaded! URL: ${loadedUrl}`);
      logger.log(`[WindowManager] Pill UI window visible: ${this.pillUIWindow.isVisible()}`);
      logger.log(`[WindowManager] Pill UI window destroyed: ${this.pillUIWindow.isDestroyed()}`);

      // Open DevTools in development to help debug
      if (process.env.NODE_ENV === "development") {
        logger.debug("[WindowManager] 🔧 Opening Pill UI DevTools...");
        this.pillUIWindow.webContents.openDevTools();
        logger.log("[WindowManager] 🔧 Pill UI DevTools opened for debugging");
      }

      // CRITICAL: Show window FIRST before setting click-through
      // Window must be visible before we can enable click-through
      // CRITICAL: Show immediately and ensure it's on top of preferences window
      if (this.pillUIWindow && !this.pillUIWindow.isDestroyed()) {
        logger.debug("[WindowManager] 👁️ Showing pill UI window (did-finish-load)...");
        if (!this.pillUIWindow.isVisible()) {
          this.pillUIWindow.show();
        }
        this.pillUIWindow.setAlwaysOnTop(true, "floating", 1); // Must be before moveTop
        this.pillUIWindow.moveTop();
        this.pillUIWindow.setVisibleOnAllWorkspaces(true, {
          visibleOnFullScreen: true,
        });
        console.log(
          `[WindowManager] 👁️ Pill UI window visible after show(): ${this.pillUIWindow.isVisible()}`,
        );

        // Don't focus the pill UI - let preferences window stay focused
        // this.pillUIWindow.focus(); // Commented out - preferences should stay focused

        logger.debug("[WindowManager] ✅ Pill UI window shown and set to always on top");
        logger.log("[WindowManager] ✅ Pill UI window shown and set to always on top");
      }
      console.log("═══════════════════════════════════════════════════════════");

      // CRITICAL: Check if renderer is actually executing JavaScript
      this.pillUIWindow.webContents
        .executeJavaScript(`
        logger.debug('[WindowManager] ✅ Pill UI JavaScript execution test - renderer is ALIVE!');
        logger.debug('[WindowManager] 📍 Current URL:', window.location.href);
        logger.debug('[WindowManager] 📍 electronAPI available:', !!window.electronAPI);
        logger.debug('[WindowManager] 📍 document.readyState:', document.readyState);
        logger.debug('[WindowManager] 📍 root element exists:', !!document.getElementById('root'));
        return {
          url: window.location.href,
          electronAPI: !!window.electronAPI,
          readyState: document.readyState,
          rootExists: !!document.getElementById('root')
        };
      `)
        .then((result) => {
          logger.debug("[WindowManager] ✅ Pill UI renderer JavaScript execution SUCCESS!");
          logger.debug(
            "[WindowManager] 📊 Pill UI renderer state:",
            JSON.stringify(result, null, 2),
          );
        })
        .catch((error) => {
          logger.error("[WindowManager] ❌ Pill UI renderer JavaScript execution FAILED!");
          logger.error("[WindowManager] Error:", error);
        });

      // CRITICAL: Pill UI is ALWAYS click-through - it's purely a visual indicator
      // Interaction happens through hotkey/voice commands, not clicking on the pill
      // Users can always use their computer normally, even when pill is listening/processing
      setTimeout(() => {
        if (this.pillUIWindow && !this.pillUIWindow.isDestroyed()) {
          // Ensure window is visible first
          if (!this.pillUIWindow.isVisible()) {
            this.pillUIWindow.show();
          }

          // ALWAYS enable click-through - pill is visual only
          // Users interact via hotkey/voice, not by clicking the pill
          this.pillUIWindow.setIgnoreMouseEvents(true, { forward: true });
          logger.log(
            "[WindowManager] ✅ Pill UI ALWAYS in CLICK-THROUGH mode (visual indicator only)",
          );
        }
      }, 100); // Very short delay just to ensure window is shown

      // Re-apply after React renders to ensure it sticks
      setTimeout(() => {
        if (this.pillUIWindow && !this.pillUIWindow.isDestroyed()) {
          if (!this.pillUIWindow.isVisible()) {
            this.pillUIWindow.show();
          }
          // Always keep click-through enabled
          this.pillUIWindow.setIgnoreMouseEvents(true, { forward: true });
          logger.log("[WindowManager] ✅ Click-through re-applied (always enabled)");
        }
      }, 1500);

      // Force window to front after a brief delay to ensure it's visible
      // This ensures pill UI appears above preferences window
      setTimeout(() => {
        if (this.pillUIWindow && !this.pillUIWindow.isDestroyed()) {
          if (!this.pillUIWindow.isVisible()) {
            this.pillUIWindow.show();
          }
          this.pillUIWindow.setAlwaysOnTop(true, "floating", 1);
          this.pillUIWindow.moveTop();
          logger.log("[WindowManager] ✅ Pill UI window forced to front (above preferences)");
        }
      }, 300);

      // Additional check after longer delay to ensure it stays visible
      setTimeout(() => {
        if (this.pillUIWindow && !this.pillUIWindow.isDestroyed()) {
          if (!this.pillUIWindow.isVisible()) {
            logger.warn("[WindowManager] ⚠️ Pill UI window not visible, showing again...");
            this.pillUIWindow.show();
          }
          this.pillUIWindow.setAlwaysOnTop(true, "floating", 1);
          this.pillUIWindow.moveTop();
          logger.log("[WindowManager] ✅ Pill UI window visibility verified");
        }
      }, 1500);

      logger.log("[WindowManager] Pill UI overlay ready - Wispr Flow style transparent overlay");
    });

    // CRITICAL: Final safety check - ensure window is shown before function returns
    // This is the last resort - if nothing else worked, force show the window
    setTimeout(() => {
      if (this.pillUIWindow && !this.pillUIWindow.isDestroyed()) {
        const isVisible = this.pillUIWindow.isVisible();
        console.log(`[WindowManager] 🔍 Final safety check: Pill UI window visible: ${isVisible}`);
        if (!isVisible) {
          logger.debug("[WindowManager] 🚨 FINAL SAFETY: Forcing pill UI window to show!");
          logger.warn("[WindowManager] 🚨 FINAL SAFETY: Forcing pill UI window to show!");
          try {
            this.pillUIWindow.show();
            this.pillUIWindow.setAlwaysOnTop(true, "floating", 1);
            this.pillUIWindow.moveTop();
            this.pillUIWindow.setVisibleOnAllWorkspaces(true, {
              visibleOnFullScreen: true,
            });
            console.log(
              `[WindowManager] ✅ FINAL SAFETY: Pill UI window now visible: ${this.pillUIWindow.isVisible()}`,
            );
            logger.log("[WindowManager] ✅ FINAL SAFETY: Pill UI window forced to show");
          } catch (error) {
            logger.error("[WindowManager] ❌ FINAL SAFETY: Error forcing window to show:", error);
            logger.error("[WindowManager] ❌ FINAL SAFETY: Error forcing window to show:", error);
          }
        }
      }
    }, 1000); // 1 second final safety check

    // CRITICAL: Fallback timeout to show window even if events don't fire
    // This ensures the window appears even if there are loading issues
    setTimeout(() => {
      if (this.pillUIWindow && !this.pillUIWindow.isDestroyed()) {
        const isVisible = this.pillUIWindow.isVisible();
        console.log(
          `[WindowManager] ⚠️ Fallback check: Pill UI window exists, visible: ${isVisible}`,
        );
        if (!isVisible) {
          logger.debug("[WindowManager] ⚠️ Fallback: Showing pill UI window after timeout...");
          logger.warn(
            "[WindowManager] ⚠️ Fallback: Showing pill UI window after timeout (events may not have fired)",
          );
          try {
            this.pillUIWindow.show();
            this.pillUIWindow.setAlwaysOnTop(true, "floating", 1);
            this.pillUIWindow.moveTop();
            this.pillUIWindow.setVisibleOnAllWorkspaces(true, {
              visibleOnFullScreen: true,
            });
            console.log(
              `[WindowManager] 👁️ Pill UI window visible after fallback show(): ${this.pillUIWindow.isVisible()}`,
            );
          } catch (error) {
            logger.error("[WindowManager] ❌ Error in fallback show():", error);
            logger.error("[WindowManager] ❌ Error in fallback show():", error);
          }
        } else {
          logger.debug("[WindowManager] ✅ Pill UI window already visible, no action needed");
        }
      } else {
        logger.error("[WindowManager] ❌ Fallback: Pill UI window is null or destroyed!");
        logger.error("[WindowManager] ❌ Fallback: Pill UI window is null or destroyed!");
      }
    }, 3000); // 3 second fallback (reduced from 5s for faster feedback)
  }

  /**
   * Convert window from onboarding mode to overlay mode
   * Closes onboarding window and creates ONLY the pill UI overlay window
   * No main window is shown - only the transparent pill overlay
   */
  async convertToOverlayMode() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }

    const oldWindow = this.mainWindow;

    logger.log("[WindowManager] Converting from onboarding to overlay mode...");

    // Clear onboarding mode flag
    this.isOnboardingMode = false;

    // Close the onboarding window immediately
    setTimeout(() => {
      if (oldWindow && !oldWindow.isDestroyed()) {
        oldWindow.close();
      }
    }, 100);

    // Create hidden main window for IPC (pill UI should already exist)
    const hiddenMainWindow = new BrowserWindow({
      ...MAIN_WINDOW_CONFIG,
      width: 1,
      height: 1,
      x: -2000, // Position off-screen
      y: -2000,
      focusable: false,
      show: false,
      skipTaskbar: true,
    });

    this.mainWindow = hiddenMainWindow;
    this.registerMainWindowEvents();

    // Load app URL (needed for IPC, but window stays hidden)
    const appUrl = DevServerManager.getAppUrl(false);
    logger.log("[WindowManager] Creating hidden main window for IPC...");

    await hiddenMainWindow.webContents.session.clearCache();

    // Load URL but keep window hidden
    // Use webContents.loadURL to prevent OS interception
    try {
      await hiddenMainWindow.webContents.loadURL(appUrl, {
        cacheControl: "no-cache",
        extraHeaders:
          "Cache-Control: no-cache, no-store, must-revalidate\nPragma: no-cache\nExpires: 0",
      });
    } catch (error) {
      logger.error("Error loading hidden window URL, falling back:", error);
      await hiddenMainWindow.loadURL(appUrl);
    }

    // Only create pill UI if it doesn't exist (should already exist from preferences)
    if (!this.pillUIWindow || this.pillUIWindow.isDestroyed()) {
      logger.log("[WindowManager] Pill UI doesn't exist, creating it now...");
      await this.createPillUIWindow();
    } else {
      logger.log("[WindowManager] ✅ Pill UI already exists and visible - perfect!");
      // Ensure pill UI is still visible and on top
      if (!this.pillUIWindow.isVisible()) {
        this.pillUIWindow.show();
      }
      this.pillUIWindow.moveTop();
      this.pillUIWindow.setAlwaysOnTop(true, "floating", 1);
    }

    // Initialize hotkey after pill UI is ready
    hiddenMainWindow.webContents.once("did-finish-load", async () => {
      logger.log("[WindowManager] Hidden main window ready for IPC");

      // Initialize hotkey and drag manager after a brief delay
      setTimeout(async () => {
        if (this.pillUIWindow && !this.pillUIWindow.isDestroyed()) {
          await this.initializeHotkey();
          this.dragManager.setTargetWindow(this.pillUIWindow);
          logger.log("[WindowManager] Overlay mode ready - pill UI visible, main window hidden");
        }
      }, 500);
    });
  }

  async startWindowDrag() {
    return await this.dragManager.startWindowDrag();
  }

  async stopWindowDrag() {
    return await this.dragManager.stopWindowDrag();
  }

  async createControlPanelWindow() {
    if (this.controlPanelWindow && !this.controlPanelWindow.isDestroyed()) {
      if (this.controlPanelWindow.isMinimized()) {
        this.controlPanelWindow.restore();
      }
      if (!this.controlPanelWindow.isVisible()) {
        this.controlPanelWindow.show();
      }
      this.controlPanelWindow.focus();
      return;
    }

    try {
      this.controlPanelWindow = new BrowserWindow(CONTROL_PANEL_CONFIG);
    } catch (error) {
      console.error("Error creating control panel window:", error);
      throw error;
    }

    this.controlPanelWindow.once("ready-to-show", () => {
      if (process.platform === "win32") {
        this.controlPanelWindow.setSkipTaskbar(false);
      }
      this.controlPanelWindow.show();
      this.controlPanelWindow.focus();
    });

    this.controlPanelWindow.on("show", () => {
      if (process.platform === "win32") {
        this.controlPanelWindow.setSkipTaskbar(false);
      }
    });

    this.controlPanelWindow.on("close", (event) => {
      if (!this.isQuitting) {
        event.preventDefault();
        if (process.platform === "darwin") {
          this.controlPanelWindow.minimize();
        } else {
          this.hideControlPanelToTray();
        }
      }
    });

    this.controlPanelWindow.on("closed", () => {
      this.controlPanelWindow = null;
    });

    // Set up menu for control panel to ensure text input works
    MenuManager.setupControlPanelMenu(this.controlPanelWindow);

    logger.log("Loading control panel content...");
    await this.loadControlPanel();
  }

  async loadControlPanel() {
    // Clear cache for control panel too
    if (this.controlPanelWindow && !this.controlPanelWindow.isDestroyed()) {
      await this.controlPanelWindow.webContents.session.clearCache();
    }

    const appUrl = DevServerManager.getAppUrl(true);
    if (process.env.NODE_ENV === "development") {
      const isReady = await DevServerManager.waitForDevServer();
      if (!isReady) {
        console.error("Dev server not ready for control panel, loading anyway...");
      }
    }
    // Force reload to bypass cache
    // Use webContents.loadURL to prevent OS interception
    try {
      this.controlPanelWindow.webContents.loadURL(appUrl, {
        cacheControl: "no-cache",
        extraHeaders:
          "Cache-Control: no-cache, no-store, must-revalidate\nPragma: no-cache\nExpires: 0",
      });
    } catch (error) {
      logger.error("Error loading control panel URL, falling back:", error);
      this.controlPanelWindow.loadURL(appUrl);
    }
  }

  showDictationPanel(options = {}) {
    const { focus = false } = options; // Default to no focus to avoid interrupting user

    // Show ALL pill UI windows (multi-monitor support)
    if (this.pillUIWindows && this.pillUIWindows.length > 0) {
      this.pillUIWindows.forEach((win, index) => {
        if (win && !win.isDestroyed()) {
          // Restore if minimized
          if (win.isMinimized()) {
            win.restore();
          }

          // Show window
          if (!win.isVisible()) {
            win.show();
          }

          // Bring to front (but don't steal focus)
          win.moveTop();
          win.setAlwaysOnTop(true, "floating", 1);
          win.setVisibleOnAllWorkspaces(true, {
            visibleOnFullScreen: true,
          });
        }
      });
      return;
    }

    // Fallback: Show single pill UI window or main window
    const targetWindow = this.pillUIWindow || this.mainWindow;
    if (targetWindow && !targetWindow.isDestroyed()) {
      // Restore if minimized
      if (targetWindow.isMinimized()) {
        targetWindow.restore();
      }

      // Show window
      if (!targetWindow.isVisible()) {
        targetWindow.show();
      }

      // Only focus if explicitly requested
      if (focus) {
        targetWindow.focus();
      }
      targetWindow.moveTop();

      // Ensure pill UI window is on top of everything
      if (this.pillUIWindow) {
        this.pillUIWindow.setAlwaysOnTop(true, "floating", 1);
        this.pillUIWindow.setVisibleOnAllWorkspaces(true, {
          visibleOnFullScreen: true,
        });
      } else if (this.mainWindow) {
        this.enforceMainWindowOnTop();
      }
    }
  }

  hideControlPanelToTray() {
    if (!this.controlPanelWindow || this.controlPanelWindow.isDestroyed()) {
      return;
    }

    if (process.platform === "win32") {
      this.controlPanelWindow.setSkipTaskbar(true);
    }

    this.controlPanelWindow.hide();
  }

  hideDictationPanel() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      if (process.platform === "darwin") {
        this.mainWindow.hide();
      } else {
        this.mainWindow.minimize();
      }
    }
  }

  isDictationPanelVisible() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return false;
    }

    if (this.mainWindow.isMinimized && this.mainWindow.isMinimized()) {
      return false;
    }

    return this.mainWindow.isVisible();
  }

  registerMainWindowEvents() {
    if (!this.mainWindow) {
      return;
    }

    // Helper to check if we're in onboarding mode
    const isOnboardingMode = () => {
      try {
        const Store = require("electron-store");
        const store = new Store();
        return !store.get("hasCompletedOnboarding", false);
      } catch {
        return false;
      }
    };

    // Store event handler references for cleanup
    this.mainWindowEventHandlers = {
      readyToShow: () => {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.show();
          this.mainWindow.focus();
          this.mainWindow.moveTop();
          // Only enforce always-on-top if NOT in onboarding mode
          if (!isOnboardingMode()) {
            this.enforceMainWindowOnTop();
          }
        }
      },
      show: () => {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          // Only enforce always-on-top if NOT in onboarding mode
          if (!isOnboardingMode()) {
            this.enforceMainWindowOnTop();
          }
        }
      },
      focus: () => {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          // Only enforce always-on-top if NOT in onboarding mode
          if (!isOnboardingMode()) {
            this.enforceMainWindowOnTop();
          }
        }
      },
      closed: () => {
        this.cleanupMainWindowEvents();
        this.dragManager.cleanup();
        this.mainWindow = null;
        this.isMainWindowInteractive = false;
      },
    };

    this.mainWindow.once("ready-to-show", this.mainWindowEventHandlers.readyToShow);
    this.mainWindow.on("show", this.mainWindowEventHandlers.show);
    this.mainWindow.on("focus", this.mainWindowEventHandlers.focus);
    this.mainWindow.on("closed", this.mainWindowEventHandlers.closed);
  }

  cleanupMainWindowEvents() {
    // Clear any pending timeouts
    if (this.failLoadTimeout) {
      clearTimeout(this.failLoadTimeout);
      this.failLoadTimeout = null;
    }

    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }

    if (this.mainWindowEventHandlers) {
      this.mainWindow.removeListener("show", this.mainWindowEventHandlers.show);
      this.mainWindow.removeListener("focus", this.mainWindowEventHandlers.focus);
      this.mainWindow.removeListener("closed", this.mainWindowEventHandlers.closed);
      this.mainWindowEventHandlers = null;
    }
  }

  enforceMainWindowOnTop() {
    // NEVER enforce always-on-top during onboarding - it's a normal window
    if (this.isOnboardingMode) {
      return;
    }

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      // For pill UI: use proper always-on-top with workspace visibility
      WindowPositionUtil.setupAlwaysOnTop(this.mainWindow);
    }
  }
}

module.exports = WindowManager;
