const {
  app,
  globalShortcut,
  BrowserWindow,
  dialog,
  screen,
  shell,
  systemPreferences,
  ipcMain,
  session,
  Menu,
} = require("electron");
const path = require("path");
const Store = require("electron-store");
const OnboardingManager = require("./src/helpers/onboardingManager");
// Handle ES module interop - logger might be exported as { default: Logger }
const loggerModule = require("./src/utils/logger");
const logger = loggerModule.default || loggerModule;

// CRITICAL: Detect --dev flag passed via command line (used by npm run dev:app)
// This enables development features (like DevTools) when running the built .app bundle
// The flag is passed via: open -a "Centris AI.app" --args --dev
if (process.argv.includes("--dev") && process.env.NODE_ENV !== "development") {
  process.env.NODE_ENV = "development";
  logger.debug("[main.js] 🔧 Development mode enabled via --dev flag");
}

// CRITICAL: Fix GPU rendering issues on macOS
// Some systems have SharedImageManager errors that cause blank windows
// Disable GPU acceleration to use software rendering as a fallback
if (process.platform === "darwin") {
  app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");
  app.commandLine.appendSwitch("disable-software-rasterizer");
  // Enable GPU rasterization for better performance where it works
  app.commandLine.appendSwitch("enable-accelerated-2d-canvas");
  // Ignore GPU blocklist to allow hardware acceleration to attempt
  app.commandLine.appendSwitch("ignore-gpu-blocklist");
}

// Ensure macOS menus use the proper casing for the app name
if (process.platform === "darwin" && app.getName() !== "Centris AI") {
  app.setName("Centris AI");
}

// Initialize electron-store for onboarding status
const store = new Store();
const onboardingManager = new OnboardingManager();

// Add global error handling for uncaught exceptions
process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception:", error);
  // Don't exit the process for EPIPE errors as they're harmless
  if (error.code === "EPIPE") {
    return;
  }
  // For other errors, log and continue
  logger.error("Error stack:", error.stack);
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection at:", promise, "reason:", reason);
});

// Import helper modules
const DebugLogger = require("./src/helpers/debugLogger");
const EnvironmentManager = require("./src/helpers/environment");
const WindowManager = require("./src/helpers/windowManager");
const DatabaseManager = require("./src/helpers/database");
const ClipboardManager = require("./src/helpers/clipboard");
const TrayManager = require("./src/helpers/tray");
const IPCHandlers = require("./src/helpers/ipcHandlers");
const UpdateManager = require("./src/updater");
const GlobeKeyManager = require("./src/helpers/globeKeyManager");
const FnSpaceKeyManager = require("./src/helpers/fnSpaceKeyManager");
const PermissionMonitor = require("./src/helpers/permissionMonitor");
const NativeMessagingInstaller = require("./src/helpers/nativeMessagingInstaller");

// Windows-specific hotkey manager
let WindowsHotkeyManager = null;
if (process.platform === "win32") {
  try {
    WindowsHotkeyManager = require("./src/helpers/windowsHotkeyManager");
    logger.log("[main.js] Windows hotkey manager loaded");
  } catch (err) {
    logger.warn("[main.js] Windows hotkey manager not available:", err.message);
  }
}

// Native audio bridge for low-latency audio capture (Wispr Flow-level performance)
let nativeAudioBridge = null;
try {
  const nativeAudioModule = require("./src/helpers/nativeAudioBridge");
  nativeAudioBridge = nativeAudioModule.nativeAudioBridge;
  logger.log(
    "[main.js] Native audio bridge loaded, available:",
    nativeAudioModule.isNativeAudioAvailable(),
  );
} catch (err) {
  logger.warn("[main.js] Native audio bridge not available:", err.message);
  logger.warn("[main.js] Falling back to Web APIs for audio capture");
}

// Set up PATH for production builds to find system Python
function setupProductionPath() {
  if (process.env.NODE_ENV !== "development") {
    if (process.platform === "darwin") {
      const commonPaths = [
        "/usr/local/bin",
        "/opt/homebrew/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
        "/Library/Frameworks/Python.framework/Versions/3.11/bin",
        "/Library/Frameworks/Python.framework/Versions/3.10/bin",
        "/Library/Frameworks/Python.framework/Versions/3.9/bin",
      ];

      const currentPath = process.env.PATH || "";
      const pathsToAdd = commonPaths.filter((p) => !currentPath.includes(p));

      if (pathsToAdd.length > 0) {
        process.env.PATH = `${currentPath}:${pathsToAdd.join(":")}`;
      }
    } else if (process.platform === "win32") {
      // Windows: Add common Python installation paths
      const commonWindowsPaths = [
        "C:\\Python311",
        "C:\\Python310",
        "C:\\Python39",
        "C:\\Program Files\\Python311",
        "C:\\Program Files\\Python310",
        "C:\\Program Files\\Python39",
        process.env.LOCALAPPDATA + "\\Programs\\Python\\Python311",
        process.env.LOCALAPPDATA + "\\Programs\\Python\\Python310",
        process.env.LOCALAPPDATA + "\\Programs\\Python\\Python39",
      ].filter((p) => p); // Remove any undefined paths

      const currentPath = process.env.PATH || "";
      const pathsToAdd = commonWindowsPaths.filter((p) => !currentPath.includes(p));

      if (pathsToAdd.length > 0) {
        process.env.PATH = `${currentPath};${pathsToAdd.join(";")}`;
      }
    }
  }
}

// Set up PATH before initializing managers
setupProductionPath();

// ═══════════════════════════════════════════════════════════════════════════
// DEEP LINK HANDLER FOR OAUTH (sentris://auth/callback)
// Parses the callback URL and emits auth-callback event to all renderer windows
// ═══════════════════════════════════════════════════════════════════════════
const DEEP_LINK_PROTOCOL = "sentris";
let pendingAuthUrl = null; // Store URL if app isn't ready yet

function handleAuthDeepLink(url) {
  try {
    logger.log("[Auth] Processing deep link:", url);

    // Parse the URL: sentris://auth/callback?access_token=xxx&refresh_token=xxx
    // or: sentris://auth/callback?code=xxx&state=xxx
    const urlObj = new URL(url);
    const params = Object.fromEntries(urlObj.searchParams);

    // Extract relevant auth data
    const authData = {
      access_token: params.access_token,
      refresh_token: params.refresh_token,
      code: params.code,
      state: params.state,
      error: params.error,
      error_description: params.error_description,
    };

    // Remove undefined values
    Object.keys(authData).forEach((key) => authData[key] === undefined && delete authData[key]);

    logger.log("[Auth] Parsed auth data:", {
      hasToken: !!authData.access_token,
      hasCode: !!authData.code,
      hasError: !!authData.error,
    });

    // Send to all windows (main window, onboarding window, etc.)
    BrowserWindow.getAllWindows().forEach((win) => {
      if (win && !win.isDestroyed() && win.webContents) {
        win.webContents.send("auth-callback", authData);
        logger.log("[Auth] Sent auth-callback to window:", win.id);
      }
    });

    // Focus the app
    if (app.isReady()) {
      const mainWindow = BrowserWindow.getAllWindows()[0];
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) {
          mainWindow.restore();
        }
        mainWindow.focus();
      }
      app.focus({ steal: true });
    }
  } catch (error) {
    logger.error("[Auth] Error processing deep link:", error);
  }
}

// CRITICAL: Prevent external apps (like Cursor) from intercepting localhost URLs
// This must be done before any windows are created
if (process.platform === "darwin") {
  // Handle open-url event before app is ready (macOS specific)
  // This prevents the OS from showing external app dialogs
  app.on("will-finish-launching", () => {
    app.on("open-url", (event, url) => {
      event.preventDefault();
      logger.log("[App] Prevented external URL handler (early):", url);

      // If it's a sentris:// deep link, store it for processing when app is ready
      if (url && url.startsWith(`${DEEP_LINK_PROTOCOL}://`)) {
        if (app.isReady()) {
          handleAuthDeepLink(url);
        } else {
          pendingAuthUrl = url;
          logger.log("[Auth] Stored pending auth URL for processing after app ready");
        }
      }
    });
  });
}

// Initialize managers
const environmentManager = new EnvironmentManager();
const windowManager = new WindowManager();
const hotkeyManager = windowManager.hotkeyManager;
const databaseManager = new DatabaseManager();
const clipboardManager = new ClipboardManager();
const trayManager = new TrayManager();
const updateManager = new UpdateManager();
const globeKeyManager = new GlobeKeyManager();
const fnSpaceKeyManager = new FnSpaceKeyManager();
const permissionMonitor = new PermissionMonitor();
let globeKeyAlertShown = false;

// Windows hotkey manager instance
let windowsHotkeyManager = null;
if (process.platform === "win32" && WindowsHotkeyManager) {
  windowsHotkeyManager = new WindowsHotkeyManager();
  logger.log("[main.js] Windows hotkey manager initialized");
}

// Connect GlobeKeyManager to HotkeyManager for native Fn key support
if (process.platform === "darwin" && hotkeyManager) {
  hotkeyManager.setGlobeKeyManager(globeKeyManager);
}

if (process.platform === "darwin") {
  globeKeyManager.on("error", (error) => {
    // Suppress all Globe key errors - onboarding will handle permission setup
    // Only log silently in development for debugging
    if (process.env.NODE_ENV === "development") {
      // Silent - no console output to avoid spam
    }
    // No dialogs, no errors - onboarding handles this
  });
}

// Onboarding is now handled entirely by React component in App.jsx
// No native HTML onboarding window needed

// Permission checking and IPC handlers are now handled entirely by IPCHandlers class
// This removes code duplication and ensures consistency

// ============================================
// GLOBAL HOTKEY - GLOBE/FN KEY ONLY
// ============================================
// The Globe/Fn key is handled by GlobeKeyManager (native macOS key listener)
// No need for Cmd+Shift+Space - we only use Globe/Fn key like Wispr Flow
// The globe-down and globe-up events are handled in startApp() below

// Initialize IPC handlers with all managers
const ipcHandlers = new IPCHandlers({
  environmentManager,
  databaseManager,
  clipboardManager,
  windowManager,
});

// Import backend manager for auto-startup
const { backendManager } = require("./src/helpers/backendManager");

// Persistent CentrisBackendService singleton for the desktop bridge connection.
// The bridge must stay connected for the cloud gateway to send desktop commands.
let centrisService = null;
async function getOrCreateCentrisService() {
  if (!centrisService) {
    const mod = await import("./src/services/centrisBackendService.js");
    const CentrisBackendService = mod.default || mod.CentrisBackendService;
    centrisService = new CentrisBackendService();
  }
  return centrisService;
}

// Main application startup
async function startApp() {
  // CRITICAL: Handle permission requests for microphone access FIRST
  // This MUST be set up before any windows are created for getUserMedia to work
  // This is REQUIRED for getUserMedia to work in Electron
  logger.log("[main.js] Setting up session permission handlers...");
  session.defaultSession.setPermissionRequestHandler(
    async (webContents, permission, callback, details) => {
      logger.log(`[main.js] Permission request: ${permission}`, details);

      if (permission === "media") {
        // Check if it's for microphone
        if (details.mediaTypes && details.mediaTypes.includes("audio")) {
          logger.log("[main.js] Microphone permission requested");

          // Check current permission status
          if (process.platform === "darwin") {
            let micStatus = systemPreferences.getMediaAccessStatus("microphone");
            logger.log(`[main.js] Current microphone permission status: ${micStatus}`);

            if (micStatus === "granted") {
              logger.log("[main.js] ✅ Microphone permission already granted, allowing access");
              callback(true); // Allow
              return;
            } else if (micStatus === "denied") {
              logger.log("[main.js] ❌ Microphone permission denied, blocking access");
              callback(false); // Deny
              return;
            } else {
              // not-determined - MUST request permission first before allowing
              logger.log("[main.js] ⚠️ Microphone permission not determined, requesting access...");
              try {
                const granted = await systemPreferences.askForMediaAccess("microphone");
                logger.log(`[main.js] Microphone permission request result: ${granted}`);
                if (granted) {
                  logger.log("[main.js] ✅ Microphone permission granted after request");
                  callback(true);
                } else {
                  logger.log("[main.js] ❌ Microphone permission denied by user");
                  callback(false);
                }
              } catch (error) {
                logger.error("[main.js] Error requesting microphone permission:", error);
                callback(false);
              }
              return;
            }
          } else if (process.platform === "win32") {
            // Windows: Microphone access is handled by the OS
            // The user will be prompted by Windows automatically if needed
            logger.log(
              "[main.js] ✅ Windows: Allowing microphone access (OS will prompt if needed)",
            );
            callback(true);
            return;
          } else {
            // Linux and other platforms - allow by default
            logger.log("[main.js] ✅ Non-macOS: Allowing microphone access by default");
            callback(true);
            return;
          }
        }
      }

      // For other permissions, deny by default for security
      logger.log(`[main.js] Denying permission request: ${permission}`);
      callback(false);
    },
  );

  // Also handle permission check handler (for checking existing permissions)
  session.defaultSession.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin, details) => {
      if (permission === "media") {
        if (details.mediaTypes && details.mediaTypes.includes("audio")) {
          if (process.platform === "darwin") {
            const micStatus = systemPreferences.getMediaAccessStatus("microphone");
            const granted = micStatus === "granted";
            logger.log(
              `[main.js] Permission check (microphone): ${granted ? "✅ Granted" : "❌ Denied"} (status: ${micStatus})`,
            );
            return granted;
          }
          return true; // Non-macOS - allow
        }
      }
      return false; // Deny other permissions
    },
  );

  logger.log("[main.js] ✅ Session permission handlers configured");

  // Connect the desktop bridge to the cloud gateway on startup.
  // This persistent WebSocket lets the gateway send desktop control commands
  // (snapshot, click, type, etc.) to this Electron app for local execution.
  try {
    const svc = await getOrCreateCentrisService();
    const gatewayHealthy = await svc.checkHealth();
    if (gatewayHealthy) {
      logger.log("[main.js] ✅ Cloud gateway reachable, desktop bridge connecting");
    } else {
      logger.log(
        "[main.js] ⚠️ Cloud gateway not reachable, desktop bridge will retry on next health check",
      );
    }
  } catch (err) {
    logger.warn("[main.js] Desktop bridge startup error (non-critical):", err.message);
  }

  // CRITICAL: Check if backend is running on port 5001 (just check, don't auto-start)
  // The backend will be started automatically when needed (when dictation starts)
  logger.log("[main.js] 🔍 Checking if backend is running on port 5001...");
  try {
    const isRunning = await backendManager.checkBackendRunning();
    if (isRunning) {
      logger.log("[main.js] ✅ Backend is running on port 5001");

      // ═══════════════════════════════════════════════════════════════════════
      // KEY OPTIMIZATION: Warm LLM cache immediately on app start
      // This primes DeepSeek prefix cache AND keeps HTTPS connection warm
      // Savings: 2-3 seconds on first voice command
      // ═══════════════════════════════════════════════════════════════════════
      logger.log("[main.js] 🔥 Warming LLM cache (HTTPS connection + prefix cache)...");
      try {
        const http = require("http");
        const warmReq = http.request(
          {
            hostname: "127.0.0.1",
            port: 5001,
            path: "/api/warm-llm",
            method: "POST",
            timeout: 10000,
          },
          (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => {
              logger.log("[main.js] 🔥 LLM cache warmed successfully:", data.substring(0, 100));
            });
          },
        );
        warmReq.on("error", (e) => {
          logger.debug("[main.js] LLM warming failed (non-critical):", e.message);
        });
        warmReq.end();
      } catch (warmError) {
        logger.debug("[main.js] LLM warming setup failed:", warmError.message);
      }
    } else {
      logger.log(
        "[main.js] ℹ️ Backend is not running - will auto-start when needed for native audio",
      );
    }
  } catch (error) {
    logger.warn("[main.js] ⚠️ Error checking backend status:", error.message);
    logger.warn("[main.js] Native audio will use Web API fallback if backend is unavailable");
  }

  // CRITICAL: Clear ALL caches (Vite and Electron) on startup
  logger.log("🧹 Clearing ALL caches (Vite + Electron)...");
  try {
    const fs = require("fs");
    const os = require("os");

    // Clear Electron session cache
    await session.defaultSession.clearCache();
    await session.defaultSession.clearStorageData({
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
    logger.log("✅ Electron session cache cleared");

    // Clear Vite cache directory
    const viteCacheDir = path.join(os.homedir(), ".vite");
    if (fs.existsSync(viteCacheDir)) {
      logger.log("Clearing Vite cache directory...");
      fs.rmSync(viteCacheDir, { recursive: true, force: true });
      logger.log("✅ Vite cache cleared");
    }

    // Clear Electron cache directory
    const electronCacheDir = path.join(os.homedir(), "Library", "Caches", app.getName());
    if (fs.existsSync(electronCacheDir)) {
      logger.log("Clearing Electron cache directory...");
      fs.rmSync(electronCacheDir, { recursive: true, force: true });
      logger.log("✅ Electron cache cleared");
    }

    // Clear node_modules/.vite cache if it exists
    // NOTE: Skip in development mode - Vite actively uses this directory and
    // clearing it while Vite is running causes ENOENT errors. The startup script
    // (clear-caches-startup.js) already clears this BEFORE Vite starts.
    if (process.env.NODE_ENV !== "development") {
      const nodeModulesViteCache = path.join(__dirname, "node_modules", ".vite");
      if (fs.existsSync(nodeModulesViteCache)) {
        logger.log("Clearing node_modules/.vite cache...");
        fs.rmSync(nodeModulesViteCache, { recursive: true, force: true });
        logger.log("✅ node_modules/.vite cache cleared");
      }
    }

    logger.log("✅ All caches cleared successfully");
  } catch (error) {
    logger.error("Error clearing caches:", error);
  }

  // Set up context menu with Inspect option for ALL windows
  // Apply context menu to all windows when they're created
  app.on("browser-window-created", (event, window) => {
    logger.log("[main.js] Setting up context menu for window:", window.id);

    window.webContents.on("context-menu", (event, params) => {
      logger.log("[main.js] Context menu triggered for window:", window.id);

      // Build context menu with reference to the specific window
      const contextMenu = Menu.buildFromTemplate([
        {
          label: "Inspect Element",
          click: () => {
            try {
              logger.log(
                "[main.js] Inspect Element clicked, opening DevTools for window:",
                window.id,
              );
              logger.debug(
                "[main.js] Inspect Element clicked, opening DevTools for window:",
                window.id,
              );
              if (window && !window.isDestroyed()) {
                window.webContents.openDevTools();
                logger.log("[main.js] ✅ DevTools opened successfully via context menu");
                logger.debug("[main.js] ✅ DevTools opened successfully via context menu");
              } else {
                logger.error("[main.js] ❌ Window is destroyed, cannot open DevTools");
                console.error("[main.js] ❌ Window is destroyed, cannot open DevTools");
              }
            } catch (error) {
              logger.error("[main.js] ❌ Error opening DevTools:", error);
              console.error("[main.js] ❌ Error opening DevTools:", error, error.stack);
            }
          },
        },
        { type: "separator" },
        {
          label: "Reload",
          click: () => {
            try {
              if (window && !window.isDestroyed()) {
                window.reload();
                logger.log("[main.js] Window reloaded");
              }
            } catch (error) {
              logger.error("[main.js] Error reloading window:", error);
            }
          },
        },
        {
          label: "Force Reload",
          click: () => {
            try {
              if (window && !window.isDestroyed()) {
                window.webContents.reloadIgnoringCache();
                logger.log("[main.js] Window force reloaded");
              }
            } catch (error) {
              logger.error("[main.js] Error force reloading window:", error);
            }
          },
        },
      ]);

      // CRITICAL: Use popup with window parameter to ensure it works
      contextMenu.popup({ window: window });
    });
  });

  logger.log("[main.js] ✅ Context menu with Inspect option configured for all windows");

  // In development, add a small delay to let Vite start properly
  if (process.env.NODE_ENV === "development") {
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  // Ensure dock is visible on macOS and stays visible
  if (process.platform === "darwin" && app.dock) {
    app.dock.show();
    // Prevent dock from hiding when windows use setVisibleOnAllWorkspaces
    app.setActivationPolicy("regular");
  }

  // Centris backend will be checked when needed

  // Create main window
  console.log("═══════════════════════════════════════════════════════════");
  console.log("🔵 [main.js] startApp() - Creating main window...");
  console.log("═══════════════════════════════════════════════════════════");
  try {
    await windowManager.createMainWindow();
    logger.debug("[main.js] ✅ Main window creation completed");

    // Initialize native audio bridge for low-latency audio capture
    // IMPORTANT: Pass windowManager so bridge can send events to pill windows (where dictation UI lives)
    if (nativeAudioBridge && windowManager.mainWindow) {
      try {
        nativeAudioBridge.initialize(windowManager.mainWindow, windowManager);
        logger.debug("[main.js] ✅ Native audio bridge initialized with windowManager");
      } catch (nativeAudioError) {
        console.warn(
          "[main.js] Failed to initialize native audio bridge:",
          nativeAudioError.message,
        );
      }
    }

    // DEBUGGING: Register global shortcut to open DevTools (Cmd+Shift+D)
    try {
      const ret = globalShortcut.register("CommandOrControl+Shift+D", () => {
        logger.debug("[main.js] 🔧 DevTools shortcut pressed!");
        const windows = BrowserWindow.getAllWindows();
        windows.forEach((win, index) => {
          if (!win.isDestroyed()) {
            console.log(`[main.js] Opening DevTools for window ${index}...`);
            win.webContents.openDevTools({ mode: "detach" });
          }
        });
      });
      logger.debug("[main.js] ✅ DevTools shortcut registered (Cmd+Shift+D):", ret);
    } catch (shortcutError) {
      console.error("[main.js] Failed to register DevTools shortcut:", shortcutError);
    }
  } catch (error) {
    console.error("[main.js] ❌ ERROR creating main window:", error);
    console.error("[main.js] Error stack:", error.stack);
    logger.error("Error creating main window:", error);
  }

  // Control panel removed - using overlay UI only

  // Set up tray (overlay only - no control panel)
  trayManager.setWindows(
    windowManager.mainWindow,
    null, // No control panel window
  );
  trayManager.setWindowManager(windowManager);
  await trayManager.createTray();

  // Set windows for update manager and check for updates
  updateManager.setWindows(
    windowManager.mainWindow,
    null, // No control panel window
  );
  updateManager.checkForUpdatesOnStartup();

  if (process.platform === "darwin") {
    logger.debug("[main.js] 🍎 macOS detected - setting up Globe key handlers");

    // Helper to send events to all pill windows
    const sendToAllPillWindows = (channel) => {
      // Send to all pill windows (multi-monitor support)
      if (windowManager.pillUIWindows && windowManager.pillUIWindows.length > 0) {
        windowManager.pillUIWindows.forEach((win, index) => {
          if (win && !win.isDestroyed()) {
            console.log(`[main.js] Sending ${channel} to pill window ${index + 1}`);
            logger.log(`[main.js] Sending ${channel} to pill window ${index + 1}`);
            win.webContents.send(channel);
          }
        });
      } else if (windowManager.pillUIWindow && !windowManager.pillUIWindow.isDestroyed()) {
        // Fallback to single pill window
        console.log(`[main.js] Sending ${channel} to single pill window`);
        windowManager.pillUIWindow.webContents.send(channel);
      } else if (windowManager.mainWindow && !windowManager.mainWindow.isDestroyed()) {
        // Fallback to main window
        console.log(`[main.js] Sending ${channel} to main window (fallback)`);
        windowManager.mainWindow.webContents.send(channel);
      } else {
        console.warn(`[main.js] ⚠️ No windows available to send ${channel}`);
        logger.warn(`[main.js] No windows available to send ${channel}`);
      }
    };

    // ========================================
    // KEYBOARD INPUT SOURCE PRESERVATION
    // ========================================
    // Store the keyboard input source when globe key is pressed
    // and restore it after release to prevent language switching
    let savedInputSource = null;

    // Helper to get current input source using AppleScript
    const getCurrentInputSource = () => {
      return new Promise((resolve) => {
        const { spawn } = require("child_process");
        const proc = spawn("osascript", [
          "-e",
          'tell application "System Events" to get name of current input source of (first process whose frontmost is true)',
        ]);
        let output = "";
        proc.stdout.on("data", (data) => {
          output += data.toString();
        });
        proc.on("close", () => resolve(output.trim()));
        proc.on("error", () => resolve(null));
        // Timeout to prevent hanging
        setTimeout(() => {
          proc.kill();
          resolve(null);
        }, 500);
      });
    };

    // Helper to restore input source using AppleScript
    const restoreInputSource = async (inputSourceName) => {
      if (!inputSourceName) {
        return;
      }
      return new Promise((resolve) => {
        const { spawn } = require("child_process");
        // Use a more reliable method - directly select the input source by name
        const proc = spawn("osascript", [
          "-e",
          `tell application "System Events"
            set inputSources to input sources
            repeat with src in inputSources
              if name of src is "${inputSourceName}" then
                set current input source to src
                exit repeat
              end if
            end repeat
          end tell`,
        ]);
        proc.on("close", () => resolve());
        proc.on("error", () => resolve());
        setTimeout(() => {
          proc.kill();
          resolve();
        }, 1000);
      });
    };

    // Handle Globe key (Fn alone) - press/release pattern
    // CRITICAL: These handlers work regardless of whether GlobeKeyManager is started
    // GlobeKeyManager must be started separately (via hotkeyManager or manually below)
    logger.debug("[main.js] 🔑 Registering globe-down event handler");
    globeKeyManager.on("globe-down", async () => {
      const currentHotkey = hotkeyManager.getCurrentHotkey?.() || "GLOBE";
      console.log(`[main.js] 🎯 GLOBE DOWN event received, currentHotkey: ${currentHotkey}`);
      logger.log(`[main.js] Globe DOWN event received, currentHotkey: ${currentHotkey}`);

      if (currentHotkey === "GLOBE" || currentHotkey === "FN" || currentHotkey === "Fn") {
        // Save current input source before the system might change it
        savedInputSource = await getCurrentInputSource();
        console.log(`[main.js] 📋 Saved input source: ${savedInputSource}`);

        // CRITICAL: Only ONE window should handle dictation to prevent duplicates
        // Priority: Pill windows (for normal operation) > Main window (for onboarding)
        const hasPillWindows =
          windowManager.pillUIWindows &&
          windowManager.pillUIWindows.length > 0 &&
          windowManager.pillUIWindows.some((win) => win && !win.isDestroyed());

        if (hasPillWindows) {
          // Pill windows exist - they handle dictation exclusively
          logger.debug(
            "[main.js] 🎤 Globe key pressed - sending start-dictation to pill windows only",
          );
          sendToAllPillWindows("start-dictation");
        } else if (windowManager.mainWindow && !windowManager.mainWindow.isDestroyed()) {
          // No pill windows - send to main window (for onboarding)
          logger.debug(
            "[main.js] 🎤 Globe key pressed - sending start-dictation to main window (no pill windows)",
          );
          logger.log("[main.js] Globe key pressed - sending start-dictation to main window");
          windowManager.mainWindow.webContents.send("start-dictation");
        }
      }
    });

    // Handle Globe key release (Fn released)
    logger.debug("[main.js] 🔑 Registering globe-up event handler");
    globeKeyManager.on("globe-up", async () => {
      const currentHotkey = hotkeyManager.getCurrentHotkey?.() || "GLOBE";
      console.log(`[main.js] 🎯 GLOBE UP event received, currentHotkey: ${currentHotkey}`);
      logger.log(`[main.js] Globe UP event received, currentHotkey: ${currentHotkey}`);

      if (currentHotkey === "GLOBE" || currentHotkey === "FN" || currentHotkey === "Fn") {
        // CRITICAL: Only ONE window should handle dictation to prevent duplicates
        // Priority: Pill windows (for normal operation) > Main window (for onboarding)
        const hasPillWindows =
          windowManager.pillUIWindows &&
          windowManager.pillUIWindows.length > 0 &&
          windowManager.pillUIWindows.some((win) => win && !win.isDestroyed());

        if (hasPillWindows) {
          // Pill windows exist - they handle dictation exclusively
          logger.debug(
            "[main.js] 🛑 Globe key released - sending stop-dictation to pill windows only",
          );
          sendToAllPillWindows("stop-dictation");
        } else if (windowManager.mainWindow && !windowManager.mainWindow.isDestroyed()) {
          // No pill windows - send to main window (for onboarding)
          logger.debug(
            "[main.js] 🛑 Globe key released - sending stop-dictation to main window (no pill windows)",
          );
          logger.log("[main.js] Globe key released - sending stop-dictation to main window");
          windowManager.mainWindow.webContents.send("stop-dictation");
        }

        // Restore the input source if it was changed by the globe key
        if (savedInputSource) {
          // Small delay to let the system finish any input source change
          setTimeout(async () => {
            const currentSource = await getCurrentInputSource();
            if (currentSource && currentSource !== savedInputSource) {
              console.log(
                `[main.js] 🔄 Restoring input source from ${currentSource} to ${savedInputSource}`,
              );
              await restoreInputSource(savedInputSource);
            }
            savedInputSource = null;
          }, 100);
        }
      }
    });

    // CRITICAL: Start GlobeKeyManager immediately on macOS
    // The default hotkey is GLOBE, so we need to start listening right away
    // This ensures Globe/Fn key works from app launch
    logger.debug("[main.js] 🚀 Starting GlobeKeyManager for default GLOBE hotkey...");
    logger.log("[main.js] Starting GlobeKeyManager for default GLOBE hotkey...");
    globeKeyManager
      .start()
      .then(() => {
        logger.debug("[main.js] ✅ GlobeKeyManager started successfully");
        logger.log("[main.js] ✅ GlobeKeyManager started successfully");
      })
      .catch((error) => {
        // Don't show error to user - onboarding will handle permissions
        logger.debug("[main.js] ⚠️ GlobeKeyManager start deferred:", error.message);
        logger.log(
          "[main.js] GlobeKeyManager start deferred (accessibility permissions may be needed):",
          error.message,
        );
      });
  }

  // ========================================
  // WINDOWS HOTKEY SETUP
  // ========================================
  if (process.platform === "win32" && windowsHotkeyManager) {
    logger.log("[main.js] 🪟 Windows detected - setting up hotkey manager");

    // Helper to send events to all pill windows (same as macOS)
    const sendToAllPillWindowsWin = (channel) => {
      if (windowManager.pillUIWindows && windowManager.pillUIWindows.length > 0) {
        windowManager.pillUIWindows.forEach((win, index) => {
          if (win && !win.isDestroyed()) {
            logger.log(`[main.js] Sending ${channel} to pill window ${index + 1}`);
            win.webContents.send(channel);
          }
        });
      } else if (windowManager.pillUIWindow && !windowManager.pillUIWindow.isDestroyed()) {
        windowManager.pillUIWindow.webContents.send(channel);
      } else if (windowManager.mainWindow && !windowManager.mainWindow.isDestroyed()) {
        windowManager.mainWindow.webContents.send(channel);
      } else {
        logger.warn(`[main.js] ⚠️ No windows available to send ${channel}`);
      }
    };

    // Handle Windows hotkey down (start dictation)
    windowsHotkeyManager.on("hotkey-down", () => {
      logger.log("[main.js] 🎯 Windows HOTKEY DOWN - starting dictation");

      const hasPillWindows =
        windowManager.pillUIWindows &&
        windowManager.pillUIWindows.length > 0 &&
        windowManager.pillUIWindows.some((win) => win && !win.isDestroyed());

      if (hasPillWindows) {
        sendToAllPillWindowsWin("start-dictation");
      } else if (windowManager.mainWindow && !windowManager.mainWindow.isDestroyed()) {
        windowManager.mainWindow.webContents.send("start-dictation");
      }
    });

    // Handle Windows hotkey up (stop dictation)
    windowsHotkeyManager.on("hotkey-up", () => {
      logger.log("[main.js] 🛑 Windows HOTKEY UP - stopping dictation");

      const hasPillWindows =
        windowManager.pillUIWindows &&
        windowManager.pillUIWindows.length > 0 &&
        windowManager.pillUIWindows.some((win) => win && !win.isDestroyed());

      if (hasPillWindows) {
        sendToAllPillWindowsWin("stop-dictation");
      } else if (windowManager.mainWindow && !windowManager.mainWindow.isDestroyed()) {
        windowManager.mainWindow.webContents.send("stop-dictation");
      }
    });

    windowsHotkeyManager.on("error", (error) => {
      logger.error("[main.js] Windows hotkey error:", error.message);
    });

    // Start the Windows hotkey manager
    windowsHotkeyManager
      .start()
      .then(() => {
        logger.log("[main.js] ✅ Windows hotkey manager started (Ctrl+` to dictate)");
      })
      .catch((error) => {
        logger.error("[main.js] Failed to start Windows hotkey manager:", error.message);
      });
  }
}

// App event handlers
app.whenReady().then(() => {
  // ═══════════════════════════════════════════════════════════════════════════
  // DEEP LINK PROTOCOL REGISTRATION (sentris://)
  // Used for OAuth callback handling from external browser
  // ═══════════════════════════════════════════════════════════════════════════

  // Register as the default handler for sentris:// URLs
  if (process.defaultApp) {
    // Development mode - register with path to electron
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL, process.execPath, [
        path.resolve(process.argv[1]),
      ]);
    }
  } else {
    // Production mode
    app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL);
  }
  logger.log(`[main.js] Registered deep link protocol: ${DEEP_LINK_PROTOCOL}://`);

  // Process any pending auth URL that arrived before app was ready
  if (pendingAuthUrl) {
    logger.log("[Auth] Processing pending auth URL:", pendingAuthUrl);
    handleAuthDeepLink(pendingAuthUrl);
    pendingAuthUrl = null;
  }

  // CRITICAL: Handle URLs opened via the sentris:// protocol
  // This is how OAuth callbacks work on desktop
  if (process.platform === "darwin") {
    // Prevent macOS from showing external app dialogs for URLs
    app.on("open-url", (event, url) => {
      event.preventDefault();
      logger.log("[App] URL handler received:", url);

      // Handle sentris:// deep links (OAuth callbacks)
      if (url && url.startsWith(`${DEEP_LINK_PROTOCOL}://`)) {
        logger.log("[App] Processing auth callback:", url);
        handleAuthDeepLink(url);
        return;
      }

      // If it's a localhost URL, we should handle it internally
      if (url && (url.includes("localhost") || url.includes("127.0.0.1"))) {
        logger.log("[App] Ignoring localhost URL from external handler - we handle it internally");
      }
    });
  }

  // Also handle on Windows/Linux via second-instance
  app.on("second-instance", (event, commandLine) => {
    // Windows/Linux pass URLs via command line
    const url = commandLine.find((arg) => arg.startsWith(`${DEEP_LINK_PROTOCOL}://`));
    if (url) {
      logger.log("[App] Second instance received auth callback:", url);
      handleAuthDeepLink(url);
    }
    // Focus the main window if it exists
    if (windowManager.mainWindow && !windowManager.mainWindow.isDestroyed()) {
      if (windowManager.mainWindow.isMinimized()) {
        windowManager.mainWindow.restore();
      }
      windowManager.mainWindow.focus();
    }
  });

  // Hide dock icon on macOS for a cleaner experience
  // The app will still show in the menu bar and command bar
  if (process.platform === "darwin" && app.dock) {
    // Keep dock visible for now to maintain command bar access
    // We can hide it later if needed: app.dock.hide()
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NATIVE MESSAGING HOST INSTALLATION
  // Automatically install the Chrome Native Messaging host for faster
  // extension ↔ backend communication (~1-2ms vs ~5-10ms with WebSocket)
  // This runs silently in the background - extension auto-detects and uses it
  // ═══════════════════════════════════════════════════════════════════════════
  (async () => {
    try {
      const status = NativeMessagingInstaller.getInstallationStatus();
      logger.log("[main.js] Native Messaging status:", status);

      if (!status.hostInstalled || status.manifestsFound === 0) {
        logger.log("[main.js] Installing Native Messaging host...");
        const result = await NativeMessagingInstaller.installNativeHost();
        logger.log("[main.js] Native Messaging installation:", result.message);
      } else {
        logger.log("[main.js] Native Messaging host already installed");

        // Check if we have a real extension ID and update manifests
        const savedId = NativeMessagingInstaller.getSavedExtensionId();
        if (savedId) {
          logger.log("[main.js] Found saved extension ID, updating manifests...");
          await NativeMessagingInstaller.updateExtensionId(savedId);
        }
      }

      // Start monitoring for extension ID (in case extension hasn't connected yet)
      // This will auto-update manifests when the extension first connects
      NativeMessagingInstaller.startExtensionIdMonitor(30000); // Check every 30 seconds
    } catch (error) {
      // Non-fatal - extension will use WebSocket fallback
      logger.warn("[main.js] Native Messaging installation skipped:", error.message);
      logger.warn("[main.js] Extension will use WebSocket fallback (still works)");
    }
  })();

  // Always start the app - React onboarding component in App.jsx handles first launch check
  // The React component checks localStorage and shows onboarding if needed
  startApp();
  // Globe/Fn key is handled by GlobeKeyManager in startApp() - no separate hotkey registration needed

  // Start permission monitoring
  if (process.platform === "darwin") {
    permissionMonitor.start();

    // Handle permission changes gracefully
    permissionMonitor.on("microphone-changed", ({ granted }) => {
      logger.log(
        `[main.js] Microphone permission changed: ${granted ? "✅ Granted" : "❌ Revoked"}`,
      );

      // Notify all windows of permission change
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send("permission-changed", {
            type: "microphone",
            granted,
          });
        }
      });

      // If microphone revoked, stop any active recording
      if (!granted) {
        BrowserWindow.getAllWindows().forEach((win) => {
          if (!win.isDestroyed()) {
            win.webContents.send("stop-dictation");
          }
        });
      }
    });

    permissionMonitor.on("accessibility-changed", ({ granted }) => {
      logger.log(
        `[main.js] Accessibility permission changed: ${granted ? "✅ Granted" : "❌ Revoked"}`,
      );

      // Notify all windows of permission change
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send("permission-changed", {
            type: "accessibility",
            granted,
          });
        }
      });

      // If accessibility revoked, stop GlobeKeyManager (it requires accessibility)
      if (!granted) {
        if (globeKeyManager) {
          globeKeyManager.stop();
          logger.log(
            "[main.js] Stopped GlobeKeyManager due to accessibility permission revocation",
          );
        }
      } else {
        // If accessibility granted and GLOBE is the current hotkey, restart GlobeKeyManager
        if (hotkeyManager && hotkeyManager.getCurrentHotkey() === "GLOBE") {
          if (globeKeyManager) {
            globeKeyManager.start().catch((error) => {
              logger.error(
                "[main.js] Error restarting GlobeKeyManager after permission grant:",
                error,
              );
            });
          }
        }
      }
    });

    // Handle screen recording permission changes
    permissionMonitor.on("screen-recording-changed", ({ granted }) => {
      logger.log(
        `[main.js] Screen recording permission changed: ${granted ? "✅ Granted" : "❌ Revoked"}`,
      );

      // Notify all windows of permission change
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send("permission-changed", {
            type: "screen-recording",
            granted,
          });
          win.webContents.send("screen-recording-changed", { granted });
        }
      });

      // If screen recording revoked, stop any active screen capture
      if (!granted) {
        try {
          const { getScreenCaptureService } = require("./src/services/screenCaptureService");
          const service = getScreenCaptureService();
          if (service.isCapturing) {
            service.stopCapture();
            logger.log("[main.js] Stopped screen capture due to permission revocation");
          }
        } catch (error) {
          // Service may not be initialized
        }
      }
    });

    // Handle input monitoring permission changes
    permissionMonitor.on("input-monitoring-changed", ({ granted }) => {
      logger.log(
        `[main.js] Input monitoring permission changed: ${granted ? "✅ Granted" : "❌ Revoked"}`,
      );

      // Notify all windows of permission change
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send("permission-changed", {
            type: "input-monitoring",
            granted,
          });
          win.webContents.send("input-monitoring-changed", { granted });
        }
      });

      // If input monitoring revoked, stop keyboard monitoring
      if (!granted) {
        try {
          const { getKeyboardMonitorService } = require("./src/services/keyboardMonitorService");
          const service = getKeyboardMonitorService();
          if (service.isMonitoring) {
            service.stop();
            logger.log("[main.js] Stopped keyboard monitoring due to permission revocation");
          }
        } catch (error) {
          // Service may not be initialized
        }
      }
    });
  }
});

app.on("window-all-closed", () => {
  // Don't quit on macOS when all windows are closed
  // The app should stay in the dock/menu bar
  if (process.platform !== "darwin") {
    app.quit();
  }
  // On macOS, keep the app running even without windows
});

app.on("browser-window-focus", (event, window) => {
  // Only apply always-on-top to the dictation window, not the control panel
  if (windowManager && windowManager.mainWindow && !windowManager.mainWindow.isDestroyed()) {
    // Check if the focused window is the dictation window
    if (window === windowManager.mainWindow) {
      windowManager.enforceMainWindowOnTop();
    }
  }

  // Control panel doesn't need any special handling on focus
  // It should behave like a normal window

  // Re-check permissions when window gains focus (user might have granted permissions)
  if (permissionMonitor && permissionMonitor.isMonitoring) {
    permissionMonitor.forceCheck().catch((error) => {
      logger.error("[main.js] Error re-checking permissions on focus:", error);
    });
  }
});

app.on("activate", () => {
  // On macOS, re-create windows when dock icon is clicked
  if (!windowManager) {
    return;
  }

  try {
    if (BrowserWindow.getAllWindows().length === 0) {
      // No windows exist, create main window
      windowManager.createMainWindow().catch((error) => {
        logger.error("Error creating main window on activate:", error);
      });
    } else {
      // Show main window if it exists, otherwise create it
      if (windowManager.mainWindow && !windowManager.mainWindow.isDestroyed()) {
        windowManager.showDictationPanel({ focus: true });
        windowManager.enforceMainWindowOnTop();
      } else {
        windowManager.createMainWindow().catch((error) => {
          logger.error("Error creating main window on activate:", error);
        });
      }
    }

    // Re-check permissions when app is activated (user might have granted permissions)
    if (permissionMonitor && permissionMonitor.isMonitoring) {
      permissionMonitor.forceCheck().catch((error) => {
        logger.error("[main.js] Error re-checking permissions on activate:", error);
      });
    }
  } catch (error) {
    logger.error("Error handling activate event:", error);
  }
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  globeKeyManager.stop();
  permissionMonitor.stop();
  updateManager.cleanup();

  // Stop Windows hotkey manager if running
  if (windowsHotkeyManager) {
    windowsHotkeyManager.stop();
  }

  // Disconnect desktop bridge
  if (centrisService) {
    centrisService.disconnectDesktopBridge();
  }

  // Stop backend if we started it
  backendManager.stopBackend().catch((error) => {
    logger.warn("[main.js] Error stopping backend on quit:", error);
  });
});
