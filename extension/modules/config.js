/**
 * Configuration Module for Centris Chrome Extension
 *
 * Connection priority:
 *   1) User override (chrome.storage.sync `backend_url`)
 *   2) Local gateway auto-detect (ports 18789, 19001) — for developers
 *   3) Production gateway (Railway) — for end users
 *
 * End users just install the extension and it connects to production.
 * Developers running a local gateway get auto-detected seamlessly.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION OBJECT
// ═══════════════════════════════════════════════════════════════════════════════

const CONFIG = {
  // Native Messaging host name (must match manifest)
  NATIVE_HOST_NAME: "com.centris.host",

  // Whether to prefer Native Messaging over WebSocket
  PREFER_NATIVE_MESSAGING: true,

  // Production gateway (custom domain preferred, Railway fallback)
  PRODUCTION_HOST: "gateway.sentris.io",
  PRODUCTION_HOSTS: ["gateway.sentris.io", "centris-ai-production.up.railway.app"],
  PRODUCTION_HTTP_URL: "https://gateway.sentris.io",

  // Default token for production gateway auth (used when no user override is stored)
  DEFAULT_EXTENSION_TOKEN: "770d3dd81270f86cdb2ec3ead5251c2a1dc8c2c1bf890481fe746622769ebbfd",

  // Local gateway ports to auto-detect (dev)
  LOCAL_PORTS: [18789, 19001],

  // WebSocket paths (shared between local and production URLs)
  WS_PATH: "/ws/centris/extension",
  VOICE_WS_PATH: "/ws/centris/voice",

  // Track which backend we're using
  _currentBackend: null,

  // Cache for URL (prevents redundant storage reads + health checks)
  _cachedUrl: null,
  _cacheTime: 0,
  _cacheTTL: 10000, // 10 second cache

  /**
   * Get WebSocket URL for browser command channel.
   * Priority: 1) storage override  2) local gateway  3) production (Railway)
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

    // Try local gateway first (for developers running gateway locally)
    for (const port of CONFIG.LOCAL_PORTS) {
      try {
        const localCheck = await Promise.race([
          fetch(`http://127.0.0.1:${port}/health`),
          new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 1500)),
        ]);
        if (localCheck.ok) {
          const wsUrl = `ws://127.0.0.1:${port}${CONFIG.WS_PATH}`;
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

    // Fall back to production gateway — probe custom domain first, then Railway
    let token = CONFIG.DEFAULT_EXTENSION_TOKEN;
    try {
      const tokenResult = await new Promise((resolve) => {
        chrome.storage.sync.get(["extension_token"], resolve);
      });
      if (tokenResult.extension_token) {
        token = tokenResult.extension_token;
      }
    } catch {
      // Storage not available — default token still applies
    }

    for (const host of CONFIG.PRODUCTION_HOSTS) {
      try {
        const check = await Promise.race([
          fetch(`https://${host}/health`),
          new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000)),
        ]);
        if (check.ok) {
          let wsUrl = `wss://${host}${CONFIG.WS_PATH}`;
          if (token) wsUrl += `?token=${encodeURIComponent(token)}`;
          console.log(`[CONFIG] Production gateway: ${host}`);
          CONFIG._currentBackend = "production";
          CONFIG._cachedUrl = wsUrl;
          CONFIG._cacheTime = now;
          return wsUrl;
        }
      } catch {
        // Host not reachable — try next
      }
    }

    // All production hosts unreachable — return first as best-effort
    const fallbackHost = CONFIG.PRODUCTION_HOSTS[0];
    let wsUrl = `wss://${fallbackHost}${CONFIG.WS_PATH}`;
    if (token) wsUrl += `?token=${encodeURIComponent(token)}`;
    console.warn("[CONFIG] No production host reachable — using fallback:", fallbackHost);
    CONFIG._currentBackend = "production";
    CONFIG._cachedUrl = wsUrl;
    CONFIG._cacheTime = now;
    return wsUrl;
  },

  /**
   * Get current backend status
   * @returns {{current: string|null, commandUrl: string|null, voiceUrl: string|null}}
   */
  getBackendStatus: function () {
    const commandUrl = CONFIG._cachedUrl || `wss://${CONFIG.PRODUCTION_HOSTS[0]}${CONFIG.WS_PATH}`;
    return {
      current: CONFIG._currentBackend || "production",
      commandUrl,
      voiceUrl: commandUrl.replace(CONFIG.WS_PATH, CONFIG.VOICE_WS_PATH),
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
   * Set the extension auth token (stored in sync storage, survives reinstalls)
   * @param {string} token - Token from Centris dashboard or onboarding
   */
  setExtensionToken: function (token) {
    chrome.storage.sync.set({ extension_token: token }, () => {
      console.log("[CONFIG] Extension token set");
      CONFIG.clearCache();
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
