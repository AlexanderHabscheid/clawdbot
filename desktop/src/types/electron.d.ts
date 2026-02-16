/**
 * TypeScript definitions for Electron API exposed via preload script
 */

// Extend React CSS properties to include Electron-specific properties
import "react";

declare module "react" {
  interface CSSProperties {
    WebkitAppRegion?: "drag" | "no-drag";
  }
}

interface ElectronAPI {
  // Window control
  pasteText: (text: string) => Promise<boolean>;
  hideWindow: () => Promise<void>;
  showDictationPanel: () => Promise<void>;
  onToggleDictation: (callback: () => void) => (() => void) | undefined;
  onStartDictation: (callback: () => void) => (() => void) | undefined;
  onStopDictation: (callback: () => void) => (() => void) | undefined;

  // Database
  saveTranscription: (text: string) => Promise<{ success: boolean; id?: number }>;
  getTranscriptions: (
    limit?: number,
  ) => Promise<Array<{ id: number; text: string; timestamp: string }>>;
  clearTranscriptions: () => Promise<{ success: boolean; cleared?: number }>;
  deleteTranscription: (id: number) => Promise<{ success: boolean; id?: number }>;
  onTranscriptionAdded: (callback: (transcription: any) => void) => () => void;
  onTranscriptionDeleted: (callback: (data: { id: number }) => void) => () => void;
  onTranscriptionsCleared: (callback: (data: { cleared: number }) => void) => () => void;

  // Environment
  getOpenAIKey: () => Promise<string | null>;
  saveOpenAIKey: (key: string) => Promise<void>;
  createProductionEnvFile: (key: string) => Promise<void>;

  // Settings
  saveSettings: (settings: Record<string, any>) => Promise<{ success: boolean }>;

  // Clipboard
  readClipboard: () => Promise<string>;
  writeClipboard: (text: string) => Promise<void>;

  // Backend
  transcribeCentrisAudio: (
    audioBuffer: ArrayBuffer,
  ) => Promise<{ success: boolean; text?: string; error?: string }>;

  // Window control
  windowMinimize: () => Promise<void>;
  windowMaximize: () => Promise<void>;
  windowClose: () => Promise<void>;
  windowIsMaximized: () => Promise<boolean>;
  getPlatform: () => string;

  // App lifecycle
  cleanupApp: () => Promise<{ success: boolean }>;
  updateHotkey: (hotkey: string) => Promise<{ success: boolean; message?: string }>;
  startWindowDrag: () => Promise<void>;
  stopWindowDrag: () => Promise<void>;
  setMainWindowInteractivity: (interactive: boolean) => Promise<{ success: boolean }>;
  setPillUIInteractivity: (interactive: boolean) => Promise<{ success: boolean }>;
  createPillUIWindow: () => Promise<{ success: boolean; error?: string; message?: string }>;

  // Onboarding
  getOnboardingStatus: () => Promise<boolean>;
  completeOnboarding: () => Promise<{ success: boolean }>;
  completePreferences: () => Promise<{ success: boolean }>;
  resetOnboarding: () => Promise<{ success: boolean }>;
  minimizeAfterOnboarding: () => Promise<{ success: boolean; warning?: string; error?: string }>;
  onOnboardingTransition: (callback: () => void) => (() => void) | undefined;

  // Permissions
  checkMicrophonePermission: () => Promise<{
    granted: boolean;
    status?: string;
    canRequest?: boolean;
  }>;
  requestMicrophonePermission: () => Promise<{ granted: boolean }>;
  checkAccessibilityPermission: () => Promise<{
    granted: boolean;
    status?: string;
    canRequest?: boolean;
  }>;
  requestAccessibilityPermission: () => Promise<{ granted: boolean }>;
  openSystemPreferences: (
    pane: "microphone" | "accessibility" | "screen",
  ) => Promise<{ success: boolean }>;
  getPermissionStatus: () => Promise<{
    microphone: boolean;
    accessibility: boolean;
    allGranted: boolean;
    microphoneStatus?: any;
    accessibilityStatus?: any;
  }>;
  forcePermissionCheck: () => Promise<{
    microphone: boolean;
    accessibility: boolean;
    allGranted: boolean;
    microphoneStatus?: any;
    accessibilityStatus?: any;
  }>;
  onPermissionChanged: (
    callback: (data: { type: "microphone" | "accessibility"; granted: boolean }) => void,
  ) => () => void;

  // Updates
  checkForUpdates: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  getAppVersion: () => Promise<string>;
  getUpdateStatus: () => Promise<string>;
  getUpdateInfo: () => Promise<any>;
  onUpdateAvailable: (callback: (info: any) => void) => (() => void) | undefined;
  onUpdateNotAvailable: (callback: () => void) => (() => void) | undefined;
  onUpdateDownloaded: (callback: () => void) => (() => void) | undefined;
  onUpdateDownloadProgress: (callback: (progress: any) => void) => (() => void) | undefined;
  onUpdateError: (callback: (error: any) => void) => (() => void) | undefined;

  // Audio
  onNoAudioDetected: (callback: () => void) => (() => void) | undefined;

  // External
  openExternal: (url: string) => Promise<{ success: boolean }>;

  // Screen info
  getScreenInfo: () => Promise<{
    bounds: { x: number; y: number; width: number; height: number };
    workArea: { x: number; y: number; width: number; height: number };
    dockHeight: number;
  }>;

  // Storage
  clearLocalStorage: () => Promise<{ success: boolean }>;
  removeAllListeners: (channel: string) => void;

  // ========================================
  // FOCUS TRACKING APIs (for dictation)
  // ========================================
  // These APIs track the focused text field so dictated text goes to the correct location

  // Capture the currently focused element (call when dictation starts)
  captureFocus: () => Promise<{
    success: boolean;
    focusInfo?: {
      platform: string;
      appName?: string;
      bundleId?: string;
      windowName?: string;
      elementRole?: string;
      elementDescription?: string;
      capturedAt: number;
    };
    error?: string;
  }>;

  // Restore focus to the previously captured element (call before text injection)
  restoreFocus: () => Promise<{ success: boolean; restored: boolean; error?: string }>;

  // Get the currently stored focus info
  getStoredFocus: () => Promise<{
    success: boolean;
    focusInfo?: {
      platform: string;
      appName?: string;
      bundleId?: string;
      windowName?: string;
      elementRole?: string;
      elementDescription?: string;
      capturedAt: number;
    };
    error?: string;
  }>;

  // Clear stored focus
  clearFocus: () => Promise<{ success: boolean; error?: string }>;

  // Check if we have valid stored focus
  hasValidFocus: () => Promise<{ success: boolean; hasValidFocus: boolean; error?: string }>;

  // Inject text with focus restoration (combines restore focus + inject text)
  injectTextWithFocusRestore: (text: string) => Promise<void>;

  // Direct text injection (no clipboard usage)
  injectTextDirectly: (text: string) => Promise<void>;

  // Mode broadcasting
  broadcastModeChange: (mode: string) => Promise<void>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
