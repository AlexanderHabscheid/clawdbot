const path = require("path");

// Main app window configuration - Normal Electron window (NOT transparent, NOT overlay)
const MAIN_WINDOW_CONFIG = {
  width: 1200,
  height: 800,
  minWidth: 800,
  minHeight: 600,
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
  },
  frame: true, // Normal window frame
  alwaysOnTop: false, // Normal window behavior
  resizable: true, // Resizable
  transparent: false, // Solid background
  show: false,
  skipTaskbar: false, // Show in taskbar
  focusable: true,
  visibleOnAllWorkspaces: false, // Normal workspace behavior
  fullScreenable: true,
  hasShadow: true, // Normal shadow
  acceptsFirstMouse: false,
  type: "normal", // Normal window type
  backgroundColor: "#000000", // Black background
  center: true, // Center on screen
  title: "Centris AI",
};

// Pill UI window configuration - Separate transparent overlay window (Glass AI style)
const PILL_UI_WINDOW_CONFIG = {
  width: 1920, // Full screen width (will be adjusted to actual screen size)
  height: 1080, // Full screen height (will be adjusted to actual screen size)
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
    // CRITICAL: Prevent external navigation - this helps prevent OS from showing dialogs
    navigateOnDragDrop: false,
  },
  frame: false, // No frame for overlay
  alwaysOnTop: true,
  resizable: false, // Fixed full screen
  transparent: true, // Fully transparent background
  show: false,
  skipTaskbar: true, // Hide from taskbar
  focusable: true,
  visibleOnAllWorkspaces: true, // Visible across workspaces
  fullScreenable: false,
  hasShadow: false, // No shadow
  acceptsFirstMouse: false,
  type: process.platform === "darwin" ? "panel" : "normal",
  backgroundColor: "#00000000", // Fully transparent
};

// Onboarding window configuration - Proper Electron window with frame
const ONBOARDING_WINDOW_CONFIG = {
  width: 600,
  height: 750, // Increased height to accommodate scrolling
  minHeight: 600,
  maxHeight: 900,
  webPreferences: {
    preload: path.join(__dirname, "..", "..", "preload.js"),
    nodeIntegration: false,
    contextIsolation: true,
    enableRemoteModule: false,
    sandbox: true,
    devTools: process.env.NODE_ENV === "development",
    // Electron-specific: Prevent opening external links in browser
    webSecurity: true,
    allowRunningInsecureContent: false,
    nodeIntegrationInSubFrames: false,
  },
  frame: true, // Show proper window frame
  titleBarStyle: "default", // Standard macOS title bar
  resizable: true, // Allow resizing for better UX
  minimizable: true,
  maximizable: false,
  closable: true,
  transparent: false,
  backgroundColor: "#000000",
  show: false,
  skipTaskbar: false, // Show in taskbar
  alwaysOnTop: false,
  center: true, // Center on screen
  modal: false,
  type: "normal",
};

// Control panel window configuration
const CONTROL_PANEL_CONFIG = {
  width: 1200,
  height: 800,
  webPreferences: {
    preload: path.join(__dirname, "..", "..", "preload.js"),
    nodeIntegration: false,
    contextIsolation: true,
    enableRemoteModule: false,
    sandbox: true, // Enable sandbox for security
    webSecurity: true, // Enable web security
    spellcheck: false,
  },
  title: "Centris Control Panel",
  resizable: true,
  show: false,
  titleBarStyle: "hiddenInset",
  trafficLightPosition: { x: 20, y: 20 },
  frame: false,
  transparent: false,
  backgroundColor: "#ffffff",
  minimizable: true,
  maximizable: true,
  closable: true,
  fullscreenable: true,
  skipTaskbar: false, // Ensure control panel stays in taskbar
  alwaysOnTop: false, // Control panel should not be always on top
  visibleOnAllWorkspaces: false, // Control panel should stay in its workspace
  type: "normal", // Ensure it's a normal window, not a panel
};

// Window positioning utilities
class WindowPositionUtil {
  static getMainWindowPosition(display) {
    const { width, height } = MAIN_WINDOW_CONFIG;
    const MARGIN = 20;
    const x = Math.max(0, display.bounds.x + display.workArea.width - width - MARGIN);
    const workArea = display.workArea || display.bounds;
    const y = Math.max(0, workArea.y + workArea.height - height - MARGIN);
    return { x, y, width, height };
  }

  static setupAlwaysOnTop(window) {
    if (process.platform === "darwin") {
      // macOS: Use panel level for proper floating behavior
      // This ensures the window stays on top across spaces and fullscreen apps
      window.setAlwaysOnTop(true, "floating", 1);
      window.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true, // Keep Dock/Command-Tab behaviour
      });
      window.setFullScreenable(false);

      // Ensure window level is maintained
      if (window.isVisible()) {
        window.setAlwaysOnTop(true, "floating", 1);
      }
    } else if (process.platform === "win32") {
      // Windows-specific always-on-top
      window.setAlwaysOnTop(true, "screen-saver");
      // Don't skip taskbar on Windows to maintain visibility
    } else {
      // Linux and other platforms
      window.setAlwaysOnTop(true, "screen-saver");
    }

    // Bring window to front if visible
    if (window.isVisible()) {
      window.moveTop();
    }
  }

  static setupControlPanel(window) {
    // Control panel should behave like a normal application window
    // This is only called once during window creation
    // No need to repeatedly set these values
  }
}

module.exports = {
  MAIN_WINDOW_CONFIG,
  ONBOARDING_WINDOW_CONFIG,
  CONTROL_PANEL_CONFIG,
  PILL_UI_WINDOW_CONFIG,
  WindowPositionUtil,
};
