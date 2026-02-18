// Application Constants

// Timing Constants
export const DEBOUNCE_MS = 300;
export const AUTO_COLLAPSE_DELAY_MS = 2000;
export const PERMISSION_CHECK_INTERVAL_MS = 1500;
export const PERMISSION_AUTO_ADVANCE_DELAY_MS = 1500;
export const WINDOW_CONVERSION_TIMEOUT_MS = 5000;
export const WINDOW_CONVERSION_CHECK_INTERVAL_MS = 300;
export const WINDOW_CONVERSION_MAX_CHECKS = 10;
export const DEV_SERVER_RETRY_DELAY_MS = 2000;

// Audio Constants
export const MIN_DURATION_SECONDS = 0.15;
export const MAX_AUDIO_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
export const AUDIO_SAMPLE_RATE = 16000;
export const AUDIO_CHANNELS = 1;

// Note: This file uses ES6 exports, but some Node.js files need CommonJS
// For Node.js files, use: const { CONSTANT_NAME } = require('./utils/constants');
// For ES modules, use: import { CONSTANT_NAME } from './utils/constants';

// UI Constants
// macOS dock is typically ~68-74px, we position pill BOTTOM EDGE 20px above dock
export const DEFAULT_DOCK_HEIGHT = 68;
export const PILL_UI_BOTTOM_MARGIN = 20; // Buffer above dock (user requested +20px)
// Pill expands from 6px (idle) to 36px (active), so we need to account for half the max height
export const PILL_EXPANDED_HEIGHT = 36;
export const PILL_IDLE_HEIGHT = 6;

// Gateway Constants — Centris Gateway (cloud-first, Railway deployment)
export const PRODUCTION_GATEWAY_URL = "https://centris-ai-production.up.railway.app";
export const PRODUCTION_GATEWAY_WS_URL = "wss://centris-ai-production.up.railway.app";
export const LOCAL_GATEWAY_PORT = 18789;

// Packaged builds hit production; dev builds can override via env
export const GATEWAY_URL = import.meta.env?.VITE_CENTRIS_GATEWAY_URL || PRODUCTION_GATEWAY_URL;
export const GATEWAY_WS_URL =
  import.meta.env?.VITE_CENTRIS_GATEWAY_WS_URL || PRODUCTION_GATEWAY_WS_URL;

export const GATEWAY_TIMEOUT_MS = 30000;
export const GATEWAY_HEALTH_CHECK_TIMEOUT_MS = 3000;
export const GATEWAY_RETRY_ATTEMPTS = 1;

// Legacy aliases for compatibility
export const DEFAULT_BACKEND_URL = GATEWAY_URL;
export const BACKEND_TIMEOUT_MS = GATEWAY_TIMEOUT_MS;
export const BACKEND_HEALTH_CHECK_TIMEOUT_MS = GATEWAY_HEALTH_CHECK_TIMEOUT_MS;
export const BACKEND_RETRY_ATTEMPTS = GATEWAY_RETRY_ATTEMPTS;

// Auth Constants
export const AUTH_DEEP_LINK_PROTOCOL = "sentris"; // sentris://auth/callback
export const OAUTH_REDIRECT_URI = `${AUTH_DEEP_LINK_PROTOCOL}://auth/callback`;

// Window Constants
export const ONBOARDING_WINDOW_WIDTH = 600;
export const ONBOARDING_WINDOW_HEIGHT = 750;
export const ONBOARDING_WINDOW_MIN_HEIGHT = 600;
export const ONBOARDING_WINDOW_MAX_HEIGHT = 900;
export const CONTROL_PANEL_WIDTH = 1200;
export const CONTROL_PANEL_HEIGHT = 800;

// Hotkey Constants
export const DEFAULT_MACOS_HOTKEY = "GLOBE";
export const DEFAULT_OTHER_HOTKEY = "`";
export const FORBIDDEN_HOTKEYS = ["A", "a"];

// Storage Keys
export const STORAGE_KEYS = {
  ONBOARDING_COMPLETED: "onboarding_completed",
  DICTATION_KEY: "dictationKey",
  CENTRIS_MODE: "centrisMode",
  PREFERRED_LANGUAGE: "preferredLanguage",
  OPENAI_API_KEY: "openaiApiKey",
  USE_LOCAL_WHISPER: "useLocalWhisper",
  ALLOW_OPENAI_FALLBACK: "allowOpenAIFallback",
  DICTATION_CLEANUP_ENABLED: "dictationCleanupEnabled",
};

// IPC Channel Names (for removeAllListeners validation)
export const ALLOWED_IPC_CHANNELS = [
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
];
