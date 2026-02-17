/**
 * Configuration Module for Centris Chrome Extension
 *
 * Cloud-first: always connects to the production Railway gateway.
 * Developers can override via chrome.storage.sync `backend_url` setting.
 * No auto-detection — the production URL is reliable and invisible to users.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION OBJECT
// ═══════════════════════════════════════════════════════════════════════════════

const CONFIG = {
  // Native Messaging host name (must match manifest)
  NATIVE_HOST_NAME: "com.centris.host",

  // Whether to prefer Native Messaging over WebSocket
  PREFER_NATIVE_MESSAGING: true,

  // Production gateway URLs (Railway deployment — default for all users)
  PRODUCTION_COMMAND_WS_URL: "wss://centris-gateway.up.railway.app/ws/centris/extension",
  PRODUCTION_VOICE_WS_URL: "wss://centris-gateway.up.railway.app/ws/centris/voice",
  PRODUCTION_HTTP_URL: "https://centris-gateway.up.railway.app",

  // Local dev gateway (for developers only, via storage override)
  LOCAL_COMMAND_WS_URL: "ws://127.0.0.1:18789/ws/centris/extension",
  LOCAL_VOICE_WS_URL: "ws://127.0.0.1:18789/ws/centris/voice",

  // Dev gateway port (gateway:dev runs on 19001)
  LOCAL_DEV_COMMAND_WS_URL: "ws://127.0.0.1:19001/ws/centris/extension",
  LOCAL_DEV_VOICE_WS_URL: "ws://127.0.0.1:19001/ws/centris/voice",

  // Track which backend we're using
  _currentBackend: null,

  // Cache for URL (prevents redundant storage reads)
  _cachedUrl: null,
  _cacheTime: 0,
  _cacheTTL: 10000, // 10 second cache

  /**
   * Get WebSocket URL for browser command channel.
   * Tries local gateway first (for seamless dev), then falls back to production.
   * Users can also set a custom URL via chrome.storage.sync `backend_url`.
   * @returns {Promise<string>}
   */
  getExtensionWebSocketUrl: async function () {
    // Return cached URL if fresh
    const now = Date.now();
    if (CONFIG._cachedUrl && now - CONFIG._cacheTime < CONFIG._cacheTTL) {
      return CONFIG._cachedUrl;
    }

    try {
      // Check for user/developer override in storage
      const result = await new Promise((resolve) => {
        chrome.storage.sync.get(["backend_url"], resolve);
      });

      if (result.backend_url) {
        console.log("[CONFIG] Using custom URL:", result.backend_url);
        CONFIG._currentBackend = "custom";
        CONFIG._cachedUrl = result.backend_url;
        CONFIG._cacheTime = now;
        return result.backend_url;
      }
    } catch {
      // Storage not available (e.g. in tests) — fall through
    }

    // Try local gateway first — check both production port (18789) and dev port (19001)
    for (const [port, wsUrl] of [
      ["18789", CONFIG.LOCAL_COMMAND_WS_URL],
      ["19001", CONFIG.LOCAL_DEV_COMMAND_WS_URL],
    ]) {
      try {
        const localCheck = await Promise.race([
          fetch(`http://127.0.0.1:${port}/health`),
          new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 1500)),
        ]);
        if (localCheck.ok) {
          console.log(`[CONFIG] Local gateway detected on port ${port}`);
          CONFIG._currentBackend = "local";
          CONFIG._cachedUrl = wsUrl;
          CONFIG._cacheTime = now;
          return wsUrl;
        }
      } catch {
        // Not running on this port — try next
      }
    }

    // Default: production gateway (Railway)
    console.log("[CONFIG] Using production gateway (command channel)");
    CONFIG._currentBackend = "production";
    CONFIG._cachedUrl = CONFIG.PRODUCTION_COMMAND_WS_URL;
    CONFIG._cacheTime = now;
    return CONFIG.PRODUCTION_COMMAND_WS_URL;
  },

  /**
   * Get current backend status
   * @returns {{current: string|null, commandUrl: string, voiceUrl: string}}
   */
  getBackendStatus: function () {
    return {
      current: CONFIG._currentBackend,
      commandUrl: CONFIG.PRODUCTION_COMMAND_WS_URL,
      voiceUrl: CONFIG.PRODUCTION_VOICE_WS_URL,
    };
  },

  /**
   * Set a custom backend URL (developer use)
   * @param {string} url - WebSocket URL to use
   */
  setCustomBackendUrl: function (url) {
    chrome.storage.sync.set({ backend_url: url }, () => {
      console.log("[CONFIG] Custom backend URL set:", url);
      CONFIG._cachedUrl = null;
      CONFIG._cacheTime = 0;
    });
  },

  /**
   * Reset to production gateway (clear developer override)
   */
  resetToProduction: function () {
    chrome.storage.sync.remove(["backend_url"], () => {
      console.log("[CONFIG] Reset to production gateway");
      CONFIG._cachedUrl = null;
      CONFIG._cacheTime = 0;
      CONFIG._currentBackend = null;
    });
  },

  /**
   * Clear the URL cache (call after disconnect to force re-read)
   */
  clearCache: function () {
    CONFIG._cachedUrl = null;
    CONFIG._cacheTime = 0;
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

// Make available globally for service worker
if (typeof globalThis !== "undefined") {
  globalThis.CONFIG = CONFIG;
}
