const { contextBridge, ipcRenderer } = require("electron");

// Preload script executing

/**
 * Helper to register an IPC listener and return a cleanup function.
 * Ensures renderer code can easily remove listeners to avoid leaks.
 */
const registerListener = (channel, handlerFactory) => {
  return (callback) => {
    if (typeof callback !== "function") {
      return () => {};
    }

    const listener =
      typeof handlerFactory === "function"
        ? handlerFactory(callback)
        : (event, ...args) => callback(event, ...args);

    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  };
};

// Exposing electronAPI to renderer

// Create electronAPI object first so we can log its keys
const electronAPI = {
  // ========================================
  // TEXT INJECTION APIs (Dictation Paste)
  // ========================================
  // Primary paste method - uses Direct Text Injection for dictation (no clipboard conflict!)
  pasteText: (text, options = {}) => ipcRenderer.invoke("paste-text", text, options),

  // Explicit direct injection (guaranteed no clipboard usage) - for dictation
  injectTextDirectly: (text) => ipcRenderer.invoke("inject-text-directly", text),

  // Explicit clipboard-based paste (when clipboard is needed)
  pasteTextViaClipboard: (text) => ipcRenderer.invoke("paste-text-via-clipboard", text),

  // Configure direct injection settings
  setDirectInjectionEnabled: (enabled) =>
    ipcRenderer.invoke("set-direct-injection-enabled", enabled),

  // Get clipboard manager settings
  getClipboardSettings: () => ipcRenderer.invoke("get-clipboard-settings"),

  // Test direct injection (for debugging)
  testDirectInjection: (testText) => ipcRenderer.invoke("test-direct-injection", testText),
  hideWindow: () => ipcRenderer.invoke("hide-window"),
  showDictationPanel: () => ipcRenderer.invoke("show-dictation-panel"),
  onToggleDictation: registerListener("toggle-dictation", (callback) => () => callback()),
  onStartDictation: registerListener("start-dictation", (callback) => () => callback()),
  onStopDictation: registerListener("stop-dictation", (callback) => () => callback()),

  // Database functions
  saveTranscription: (text) => ipcRenderer.invoke("db-save-transcription", text),
  getTranscriptions: (limit) => ipcRenderer.invoke("db-get-transcriptions", limit),
  clearTranscriptions: () => ipcRenderer.invoke("db-clear-transcriptions"),
  deleteTranscription: (id) => ipcRenderer.invoke("db-delete-transcription", id),
  onTranscriptionAdded: (callback) => {
    const listener = (_event, transcription) => callback?.(transcription);
    ipcRenderer.on("transcription-added", listener);
    return () => ipcRenderer.removeListener("transcription-added", listener);
  },
  onTranscriptionDeleted: (callback) => {
    const listener = (_event, data) => callback?.(data);
    ipcRenderer.on("transcription-deleted", listener);
    return () => ipcRenderer.removeListener("transcription-deleted", listener);
  },
  onTranscriptionsCleared: (callback) => {
    const listener = (_event, data) => callback?.(data);
    ipcRenderer.on("transcriptions-cleared", listener);
    return () => ipcRenderer.removeListener("transcriptions-cleared", listener);
  },

  // Environment variables
  getOpenAIKey: () => ipcRenderer.invoke("get-openai-key"),
  saveOpenAIKey: (key) => ipcRenderer.invoke("save-openai-key", key),
  createProductionEnvFile: (key) => ipcRenderer.invoke("create-production-env-file", key),

  // Settings management
  saveSettings: (settings) => ipcRenderer.invoke("save-settings", settings),

  // Clipboard functions
  readClipboard: () => ipcRenderer.invoke("read-clipboard"),
  writeClipboard: (text) => ipcRenderer.invoke("write-clipboard", text),

  // Centris backend functions
  transcribeCentrisAudio: (audioBuffer) =>
    ipcRenderer.invoke("transcribe-centris-audio", audioBuffer),

  // Window control functions
  windowMinimize: () => ipcRenderer.invoke("window-minimize"),
  windowMaximize: () => ipcRenderer.invoke("window-maximize"),
  windowClose: () => ipcRenderer.invoke("window-close"),
  windowIsMaximized: () => ipcRenderer.invoke("window-is-maximized"),
  getPlatform: () => process.platform,
  isDev: () => process.env.NODE_ENV === "development",
  getAppInfo: () => ({
    platform: process.platform,
    isDev: process.env.NODE_ENV === "development",
    nodeEnv: process.env.NODE_ENV,
  }),

  // Get path to bundled resources (for ONNX models, etc.)
  getResourcePath: (relativePath) => ipcRenderer.invoke("get-resource-path", relativePath),

  // Cleanup function
  cleanupApp: () => ipcRenderer.invoke("cleanup-app"),
  updateHotkey: (hotkey) => ipcRenderer.invoke("update-hotkey", hotkey),
  startWindowDrag: () => ipcRenderer.invoke("start-window-drag"),
  stopWindowDrag: () => ipcRenderer.invoke("stop-window-drag"),
  setMainWindowInteractivity: (interactive) =>
    ipcRenderer.invoke("set-main-window-interactivity", interactive),
  setPillUIInteractivity: (interactive) =>
    ipcRenderer.invoke("set-pill-ui-interactivity", interactive),
  createPillUIWindow: () => ipcRenderer.invoke("create-pill-ui-window"),

  // Onboarding functions
  getOnboardingStatus: () => ipcRenderer.invoke("get-onboarding-status"),
  completeOnboarding: () => ipcRenderer.invoke("complete-onboarding"),
  completePreferences: () => ipcRenderer.invoke("complete-preferences"),
  resetOnboarding: () => ipcRenderer.invoke("reset-onboarding"),
  minimizeAfterOnboarding: () => ipcRenderer.invoke("minimize-after-onboarding"),
  onOnboardingTransition: registerListener("onboarding-complete-transition"),

  // ========================================
  // AUTHENTICATION APIs
  // ========================================
  // Listen for OAuth callback from deep link (sentris://auth/callback)
  onAuthCallback: registerListener("auth-callback", (callback) => (_event, data) => callback(data)),

  // Clear auth session
  clearAuthSession: () => ipcRenderer.invoke("clear-auth-session"),

  // Get stored auth tokens
  getAuthTokens: () => ipcRenderer.invoke("get-auth-tokens"),

  // Save auth tokens (for persistence)
  saveAuthTokens: (tokens) => ipcRenderer.invoke("save-auth-tokens", tokens),

  // Permission functions
  checkMicrophonePermission: () => ipcRenderer.invoke("check-microphone-permission"),
  requestMicrophonePermission: () => ipcRenderer.invoke("request-microphone-permission"),
  checkAccessibilityPermission: () => ipcRenderer.invoke("check-accessibility-permission"),
  requestAccessibilityPermission: () => ipcRenderer.invoke("request-accessibility-permission"),
  openSystemPreferences: (pane) => ipcRenderer.invoke("open-system-preferences", pane),
  getPermissionStatus: () => ipcRenderer.invoke("get-permission-status"),
  forcePermissionCheck: () => ipcRenderer.invoke("force-permission-check"),

  // Permission testing (actual real-world tests)
  testMicrophonePermission: () => ipcRenderer.invoke("test-microphone-permission"),
  testAccessibilityPermission: () => ipcRenderer.invoke("test-accessibility-permission"),
  promptAccessibilityPermission: () => ipcRenderer.invoke("prompt-accessibility-permission"),
  getPermissionInstructions: (permission) =>
    ipcRenderer.invoke("get-permission-instructions", permission),

  // ========================================
  // SCREEN RECORDING PERMISSION APIs
  // ========================================
  checkScreenRecordingPermission: () => ipcRenderer.invoke("check-screen-recording-permission"),
  requestScreenRecordingPermission: () => ipcRenderer.invoke("request-screen-recording-permission"),

  // ========================================
  // INPUT MONITORING PERMISSION APIs
  // ========================================
  checkInputMonitoringPermission: () => ipcRenderer.invoke("check-input-monitoring-permission"),
  requestInputMonitoringPermission: (accessLevel = "listen") =>
    ipcRenderer.invoke("request-input-monitoring-permission", accessLevel),

  // ========================================
  // ALL PERMISSIONS STATUS
  // ========================================
  getAllPermissionsStatus: () => ipcRenderer.invoke("get-all-permissions-status"),

  onPermissionChanged: (callback) => {
    ipcRenderer.on("permission-changed", (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners("permission-changed");
  },

  // Screen recording change listener
  onScreenRecordingChanged: (callback) => {
    ipcRenderer.on("screen-recording-changed", (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners("screen-recording-changed");
  },

  // Input monitoring change listener
  onInputMonitoringChanged: (callback) => {
    ipcRenderer.on("input-monitoring-changed", (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners("input-monitoring-changed");
  },

  // ========================================
  // AUDIO TESTING APIs
  // ========================================
  // These APIs provide actual audio testing functionality to verify
  // microphone recording and playback work correctly

  // Get list of available audio input devices
  getAudioInputDevices: () => ipcRenderer.invoke("get-audio-input-devices"),

  // Test microphone recording (records audio for specified duration)
  // @param durationSeconds - Duration to record (default 2 seconds)
  testMicrophoneRecording: (durationSeconds = 2) =>
    ipcRenderer.invoke("test-microphone-recording", durationSeconds),

  // Test audio playback (plays back the test recording)
  testAudioPlayback: () => ipcRenderer.invoke("test-audio-playback"),

  // Play a system sound to test audio output
  playSystemSound: () => ipcRenderer.invoke("play-system-sound"),

  // Run full audio test (permission + recording + playback)
  runFullAudioTest: () => ipcRenderer.invoke("run-full-audio-test"),

  // Get troubleshooting instructions for permissions
  getPermissionTroubleshooting: () => ipcRenderer.invoke("get-permission-troubleshooting"),

  // Cleanup test files
  cleanupAudioTestFiles: () => ipcRenderer.invoke("cleanup-audio-test-files"),

  // Get app identity information (for permission debugging)
  getAppIdentity: () => ipcRenderer.invoke("get-app-identity"),

  // ========================================
  // NATIVE AUDIO APIs (Low-latency capture)
  // ========================================
  // These APIs use native OS audio capture for Wispr Flow-level performance

  // Check if native audio is available
  nativeAudioAvailable: () => ipcRenderer.invoke("native-audio-available"),

  // Get native audio input devices
  nativeAudioGetDevices: () => ipcRenderer.invoke("native-audio-get-devices"),

  // Get default native audio device
  nativeAudioGetDefaultDevice: () => ipcRenderer.invoke("native-audio-get-default-device"),

  // Test a specific device for audio signal (returns { hasSignal, rms, deviceId })
  nativeAudioTestDevice: (deviceId) => ipcRenderer.invoke("native-audio-test-device", deviceId),

  // Find the first working microphone automatically
  nativeAudioFindWorkingMic: () => ipcRenderer.invoke("native-audio-find-working-mic"),

  // Initialize native audio capture
  nativeAudioInitialize: (config) => ipcRenderer.invoke("native-audio-initialize", config),

  // Start native audio capture
  nativeAudioStart: () => ipcRenderer.invoke("native-audio-start"),

  // Stop native audio capture
  nativeAudioStop: () => ipcRenderer.invoke("native-audio-stop"),

  // Shutdown native audio
  nativeAudioShutdown: () => ipcRenderer.invoke("native-audio-shutdown"),

  // Get native audio stats
  nativeAudioGetStats: () => ipcRenderer.invoke("native-audio-get-stats"),

  // Check if native audio is capturing
  nativeAudioIsCapturing: () => ipcRenderer.invoke("native-audio-is-capturing"),

  // Native audio event listeners
  // NOTE: These use a custom handlerFactory to strip the IPC event and pass only the data
  onNativeAudioLevel: registerListener("native-audio-level", (cb) => (_event, data) => cb(data)),
  onNativeAudioVoiceStart: registerListener(
    "native-audio-voice-start",
    (cb) => (_event, data) => cb(data),
  ),
  onNativeAudioVoiceEnd: registerListener(
    "native-audio-voice-end",
    (cb) => (_event, data) => cb(data),
  ),
  onNativeAudioTranscript: registerListener(
    "native-audio-transcript",
    (cb) => (_event, data) => cb(data),
  ),
  onNativeAudioDictationResult: registerListener(
    "native-audio-dictation-result",
    (cb) => (_event, data) => cb(data),
  ),
  onNativeAudioActionResult: registerListener(
    "native-audio-action-result",
    (cb) => (_event, data) => cb(data),
  ),
  onNativeAudioActionUpdate: registerListener(
    "native-audio-action-update",
    (cb) => (_event, data) => cb(data),
  ),
  onNativeAudioError: registerListener("native-audio-error", (cb) => (_event, data) => cb(data)),
  onNativeAudioStarted: registerListener(
    "native-audio-started",
    (cb) => (_event, data) => cb(data),
  ),
  onNativeAudioStopped: registerListener(
    "native-audio-stopped",
    (cb) => (_event, data) => cb(data),
  ),

  // Update functions
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  downloadUpdate: () => ipcRenderer.invoke("download-update"),
  installUpdate: () => ipcRenderer.invoke("install-update"),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  getUpdateStatus: () => ipcRenderer.invoke("get-update-status"),
  getUpdateInfo: () => ipcRenderer.invoke("get-update-info"),

  // Update event listeners
  onUpdateAvailable: registerListener("update-available"),
  onUpdateNotAvailable: registerListener("update-not-available"),
  onUpdateDownloaded: registerListener("update-downloaded"),
  onUpdateDownloadProgress: registerListener("update-download-progress"),
  onUpdateError: registerListener("update-error"),

  // Audio event listeners
  onNoAudioDetected: registerListener("no-audio-detected"),

  // External link opener
  openExternal: (url) => ipcRenderer.invoke("open-external", url),

  // Screen info for dock positioning and multi-monitor support
  getScreenInfo: () => ipcRenderer.invoke("get-screen-info"),
  getCursorDisplayInfo: () => ipcRenderer.invoke("get-cursor-display-info"),
  onDisplayChange: registerListener("display-change"),

  // Monitor-aware actions: Get monitor info for natural language processing
  // Returns info about all displays so AI can understand commands like:
  // "open files on monitor 1", "go to Gmail on monitor 2"
  getMonitorInfo: () => ipcRenderer.invoke("get-cursor-display-info"),

  // Clear localStorage (for resetting onboarding)
  clearLocalStorage: () => ipcRenderer.invoke("clear-local-storage"),

  // ========================================
  // KEYBOARD MONITORING APIs
  // ========================================
  startKeyboardMonitoring: () => ipcRenderer.invoke("start-keyboard-monitoring"),
  stopKeyboardMonitoring: () => ipcRenderer.invoke("stop-keyboard-monitoring"),
  getKeyboardMonitoringStatus: () => ipcRenderer.invoke("get-keyboard-monitoring-status"),
  onKeyboardEvent: (callback) => {
    ipcRenderer.on("keyboard-event", (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners("keyboard-event");
  },

  // ========================================
  // SCREEN CAPTURE APIs
  // ========================================
  captureScreen: (options) => ipcRenderer.invoke("capture-screen", options),
  startScreenCapture: (options) => ipcRenderer.invoke("start-screen-capture", options),
  stopScreenCapture: () => ipcRenderer.invoke("stop-screen-capture"),
  getScreenCaptureStatus: () => ipcRenderer.invoke("get-screen-capture-status"),
  onScreenCaptureFrame: (callback) => {
    ipcRenderer.on("screen-capture-frame", (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners("screen-capture-frame");
  },

  // ========================================
  // SYSTEM AUDIO CAPTURE APIs
  // ========================================
  startSystemAudioCapture: (options) => ipcRenderer.invoke("start-system-audio-capture", options),
  stopSystemAudioCapture: () => ipcRenderer.invoke("stop-system-audio-capture"),
  getSystemAudioStatus: () => ipcRenderer.invoke("get-system-audio-status"),
  onSystemAudioData: (callback) => {
    ipcRenderer.on("system-audio-data", (event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners("system-audio-data");
  },

  // ========================================
  // FOCUS TRACKING APIs (for dictation)
  // ========================================
  // These APIs track the focused text field so dictated text goes to the correct location

  // Capture the currently focused element (call when dictation starts)
  captureFocus: () => ipcRenderer.invoke("capture-focus"),

  // Restore focus to the previously captured element (call before text injection)
  restoreFocus: () => ipcRenderer.invoke("restore-focus"),

  // Get the currently stored focus info
  getStoredFocus: () => ipcRenderer.invoke("get-stored-focus"),

  // Clear stored focus
  clearFocus: () => ipcRenderer.invoke("clear-focus"),

  // Check if we have valid stored focus
  hasValidFocus: () => ipcRenderer.invoke("has-valid-focus"),

  // Inject text with focus restoration (combines restore focus + inject text)
  // This ensures text goes to the text box that was focused when dictation started
  injectTextWithFocusRestore: (text) => ipcRenderer.invoke("inject-text-with-focus-restore", text),

  // ========================================
  // BACKEND MANAGEMENT APIs
  // ========================================
  // These APIs manage the Centris backend process (check, start, stop)

  // Check if backend is running and healthy (just check, don't start)
  checkBackendHealth: () => ipcRenderer.invoke("check-backend-health"),

  // Check if backend is running (simple check only)
  checkBackendRunning: () => ipcRenderer.invoke("check-backend-running"),

  // Ensure backend is running (check and start if needed)
  ensureBackendRunning: () => ipcRenderer.invoke("ensure-backend-running"),

  // Get backend status
  getBackendStatus: () => ipcRenderer.invoke("get-backend-status"),

  // Start backend manually
  startBackend: () => ipcRenderer.invoke("start-backend"),

  // Stop backend
  stopBackend: () => ipcRenderer.invoke("stop-backend"),

  // ========================================
  // MODE MANAGEMENT APIs
  // ========================================
  // These APIs manage operating mode (action vs dictation) across windows

  // Broadcast mode change to all windows (call after switching mode)
  broadcastModeChange: (mode) => ipcRenderer.invoke("broadcast-mode-change", mode),

  // Listen for mode changes from other windows
  onModeChanged: registerListener("mode-changed", (callback) => (_event, data) => callback(data)),

  // Remove all listeners for a channel (with validation)
  removeAllListeners: (channel) => {
    // Only allow removing listeners for specific safe channels
    const allowedChannels = [
      "toggle-dictation",
      "transcription-added",
      "transcription-deleted",
      "transcriptions-cleared",
      "onboarding-complete-transition",
      "update-available",
      "update-not-available",
      "update-downloaded",
      "update-download-progress",
      "update-error",
      "no-audio-detected",
      "permission-changed",
      "screen-recording-changed",
      "input-monitoring-changed",
      "keyboard-event",
      "screen-capture-frame",
      "system-audio-data",
      "mode-changed",
    ];

    if (allowedChannels.includes(channel)) {
      ipcRenderer.removeAllListeners(channel);
    } else {
      console.warn(`Attempted to remove listeners for disallowed channel: ${channel}`);
    }
  },
};

console.log("[preload.js] ✅ electronAPI exposed successfully!");
console.log("[preload.js] 📍 electronAPI keys:", Object.keys(electronAPI));
console.log("═══════════════════════════════════════════════════════════");

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
