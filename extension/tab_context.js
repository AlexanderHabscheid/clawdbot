/**
 * Tab Context Manager for Centris AI Chrome Extension
 *
 * Manages context synchronization across browser tabs:
 * - Captures context from each tab (URL, title, page type, etc.)
 * - Tracks tab switches and content changes
 * - Syncs context to backend for LLM awareness
 * - Persists context to chrome.storage for session restoration
 *
 * Usage:
 *   // Initialize on extension load
 *   await tabContextManager.init();
 *
 *   // Get unified context for all tabs
 *   const context = await tabContextManager.getUnifiedContext();
 *
 *   // Capture context for specific tab
 *   await tabContextManager.captureTabContext(tabId);
 */

class TabContextManager {
  constructor() {
    // Tab contexts: Map<tabId, TabContext>
    this.tabContexts = new Map();

    // Configuration
    this.config = {
      SYNC_INTERVAL_MS: 5000, // How often to sync to backend
      MAX_CONTEXT_AGE_MS: 24 * 60 * 60 * 1000, // 24 hours
      MAX_STORED_TABS: 50, // Max tabs to store
      STORAGE_KEY: "centris_tab_contexts",
      CAPTURE_DEBOUNCE_MS: 500, // Debounce rapid updates
    };

    // Sync interval reference
    this.syncInterval = null;

    // Debounce timers
    this.captureDebounce = {};

    // Listeners for context updates
    this.listeners = new Set();

    // Session ID (generated on init)
    this.sessionId = null;

    console.log("[TabContextManager] Created");
  }

  /**
   * Initialize tab context tracking
   */
  async init() {
    // Generate session ID
    this.sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Load existing contexts from storage
    await this.loadFromStorage();

    // Set up tab event listeners
    this._setupTabListeners();

    // Capture initial context for all tabs
    await this._captureAllTabs();

    // Start sync interval
    this.startSyncInterval();

    console.log("[TabContextManager] Initialized with session:", this.sessionId);
    return this.sessionId;
  }

  /**
   * Set up Chrome tab event listeners
   */
  _setupTabListeners() {
    // Tab activated (user switched tabs)
    chrome.tabs.onActivated.addListener(async (activeInfo) => {
      await this._onTabActivated(activeInfo);
    });

    // Tab updated (URL change, loading complete)
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
      await this._onTabUpdated(tabId, changeInfo, tab);
    });

    // Tab removed (closed)
    chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
      await this._onTabRemoved(tabId, removeInfo);
    });

    // Window focus changed
    chrome.windows.onFocusChanged.addListener(async (windowId) => {
      if (windowId !== chrome.windows.WINDOW_ID_NONE) {
        await this._onWindowFocused(windowId);
      }
    });

    console.log("[TabContextManager] Tab listeners set up");
  }

  /**
   * Capture context for a specific tab
   * @param {number} tabId - Chrome tab ID
   * @returns {Object|null} Tab context or null on error
   */
  async captureTabContext(tabId) {
    try {
      // Get tab info
      const tab = await chrome.tabs.get(tabId);

      // Skip chrome:// and extension pages
      if (
        !tab.url ||
        tab.url.startsWith("chrome://") ||
        tab.url.startsWith("chrome-extension://")
      ) {
        return null;
      }

      // Try to get page context via content script
      let pageContext = {};
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            return {
              url: window.location.href,
              title: document.title,
              domain: window.location.hostname,
              path: window.location.pathname,
              readyState: document.readyState,

              // Form detection
              hasInputs:
                document.querySelectorAll('input:not([type="hidden"]), textarea').length > 0,
              hasButtons:
                document.querySelectorAll('button, [role="button"], input[type="submit"]').length >
                0,
              hasSelects: document.querySelectorAll("select").length > 0,

              // Page type heuristics
              isEmail: /mail|inbox|compose|gmail|outlook/i.test(
                window.location.href + " " + document.title,
              ),
              isSearch: /search|google\.com\/search|bing\.com\/search/i.test(window.location.href),
              isDocument: /docs|document|editor|notion|confluence/i.test(window.location.href),
              isSocial: /twitter|facebook|linkedin|instagram|reddit/i.test(window.location.href),
              isVideo: /youtube|vimeo|netflix|hulu/i.test(window.location.href),
              isShopping: /amazon|ebay|shop|cart|checkout/i.test(window.location.href),

              // Scroll position
              scrollY: window.scrollY,
              scrollX: window.scrollX,
              pageHeight: document.documentElement.scrollHeight,
              pageWidth: document.documentElement.scrollWidth,
              viewportHeight: window.innerHeight,
              viewportWidth: window.innerWidth,

              // Content hints
              headingCount: document.querySelectorAll("h1, h2, h3").length,
              linkCount: document.querySelectorAll("a[href]").length,
              imageCount: document.querySelectorAll("img").length,
              formCount: document.querySelectorAll("form").length,

              // First heading for context
              firstHeading:
                document.querySelector("h1")?.textContent?.trim()?.substring(0, 100) || "",

              // Meta description
              metaDescription:
                document.querySelector('meta[name="description"]')?.content?.substring(0, 200) ||
                "",
            };
          },
        });

        if (results && results[0] && results[0].result) {
          pageContext = results[0].result;
        }
      } catch (e) {
        // Content script might not be able to run on some pages
        console.debug("[TabContextManager] Could not get page context for tab", tabId, e.message);
      }

      // Build complete context
      const context = {
        tabId: tabId,
        windowId: tab.windowId,
        url: tab.url || "",
        title: tab.title || "",
        active: tab.active || false,
        pinned: tab.pinned || false,
        status: tab.status || "unknown",
        pageContext: pageContext,
        pageType: this._classifyPage(tab, pageContext),
        capturedAt: Date.now(),
        interactionCount: this.tabContexts.get(tabId)?.interactionCount || 0,
      };

      // Store context
      this.tabContexts.set(tabId, context);

      // Persist to storage (debounced)
      this._debounceSave();

      // Notify listeners
      this._notifyListeners("context_updated", { tabId, context });

      return context;
    } catch (error) {
      console.error("[TabContextManager] Error capturing context for tab", tabId, error);
      return null;
    }
  }

  /**
   * Capture context for all open tabs
   */
  async _captureAllTabs() {
    try {
      const tabs = await chrome.tabs.query({});

      for (const tab of tabs) {
        await this.captureTabContext(tab.id);
      }

      console.log("[TabContextManager] Captured context for", tabs.length, "tabs");
    } catch (error) {
      console.error("[TabContextManager] Error capturing all tabs:", error);
    }
  }

  /**
   * Classify page type based on tab info and page context
   * @param {Object} tab - Chrome tab object
   * @param {Object} pageContext - Page context from content script
   * @returns {string} Page type
   */
  _classifyPage(tab, pageContext) {
    // Use page context detection first
    if (pageContext.isEmail) {
      return "email";
    }
    if (pageContext.isSearch) {
      return "search";
    }
    if (pageContext.isDocument) {
      return "document";
    }
    if (pageContext.isSocial) {
      return "social";
    }
    if (pageContext.isVideo) {
      return "video";
    }
    if (pageContext.isShopping) {
      return "shopping";
    }

    // Fallback to URL/title analysis
    const url = (tab.url || "").toLowerCase();
    const title = (tab.title || "").toLowerCase();

    if (url.includes("mail") || url.includes("inbox") || title.includes("inbox")) {
      return "email";
    }
    if (url.includes("search") || url.includes("google.com/search")) {
      return "search";
    }
    if (url.includes("docs") || url.includes("document")) {
      return "document";
    }
    if (pageContext.hasInputs && pageContext.hasButtons) {
      return "form";
    }
    if (pageContext.formCount > 0) {
      return "form";
    }

    return "general";
  }

  /**
   * Get unified context from all tabs
   * @returns {Object} Unified context
   */
  async getUnifiedContext() {
    const contexts = Array.from(this.tabContexts.values());
    const activeTab = contexts.find((c) => c.active);

    // Get unique domains
    const domains = new Set();
    contexts.forEach((c) => {
      if (c.pageContext?.domain) {
        domains.add(c.pageContext.domain);
      }
    });

    // Classify tabs by type
    const tabsByType = {};
    contexts.forEach((c) => {
      const type = c.pageType || "general";
      if (!tabsByType[type]) {
        tabsByType[type] = [];
      }
      tabsByType[type].push({
        tabId: c.tabId,
        title: c.title?.substring(0, 50),
        domain: c.pageContext?.domain,
      });
    });

    return {
      sessionId: this.sessionId,
      activeTab: activeTab
        ? {
            tabId: activeTab.tabId,
            url: activeTab.url,
            title: activeTab.title,
            pageType: activeTab.pageType,
            domain: activeTab.pageContext?.domain,
            hasInputs: activeTab.pageContext?.hasInputs || false,
            hasButtons: activeTab.pageContext?.hasButtons || false,
            firstHeading: activeTab.pageContext?.firstHeading || "",
          }
        : null,
      openTabs: contexts.map((c) => ({
        tabId: c.tabId,
        url: c.url,
        title: c.title?.substring(0, 100),
        domain: c.pageContext?.domain,
        pageType: c.pageType,
        active: c.active,
      })),
      domains: Array.from(domains),
      tabsByType: tabsByType,
      tabCount: contexts.length,
      capturedAt: Date.now(),
    };
  }

  /**
   * Get context for the active tab
   * @returns {Object|null} Active tab context
   */
  async getActiveTabContext() {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab) {
        return this.tabContexts.get(activeTab.id) || (await this.captureTabContext(activeTab.id));
      }
      return null;
    } catch (error) {
      console.error("[TabContextManager] Error getting active tab context:", error);
      return null;
    }
  }

  /**
   * Record user interaction with a tab
   * @param {number} tabId - Tab ID
   * @param {string} interactionType - Type of interaction
   */
  recordInteraction(tabId, interactionType = "click") {
    const context = this.tabContexts.get(tabId);
    if (context) {
      context.interactionCount = (context.interactionCount || 0) + 1;
      context.lastInteraction = {
        type: interactionType,
        timestamp: Date.now(),
      };
      this.tabContexts.set(tabId, context);
    }
  }

  // =========================================================================
  // Event Handlers
  // =========================================================================

  async _onTabActivated(activeInfo) {
    const { tabId, windowId } = activeInfo;

    // Mark previous active tab as inactive
    for (const [id, context] of this.tabContexts) {
      if (context.active && id !== tabId) {
        context.active = false;
      }
    }

    // Capture and mark new active tab
    const context = await this.captureTabContext(tabId);
    if (context) {
      context.active = true;
      this.tabContexts.set(tabId, context);
    }

    // Sync to backend
    await this.syncToBackend();
  }

  async _onTabUpdated(tabId, changeInfo, tab) {
    // Only process when page loading completes or URL changes
    if (changeInfo.status === "complete" || changeInfo.url) {
      // Debounce rapid updates
      if (this.captureDebounce[tabId]) {
        clearTimeout(this.captureDebounce[tabId]);
      }

      this.captureDebounce[tabId] = setTimeout(async () => {
        await this.captureTabContext(tabId);
        delete this.captureDebounce[tabId];
      }, this.config.CAPTURE_DEBOUNCE_MS);
    }
  }

  async _onTabRemoved(tabId, removeInfo) {
    // Remove from contexts
    this.tabContexts.delete(tabId);

    // Persist change
    await this.saveToStorage();

    // Notify listeners
    this._notifyListeners("tab_removed", { tabId });
  }

  async _onWindowFocused(windowId) {
    // Get active tab in focused window
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, windowId });
      if (activeTab) {
        await this.captureTabContext(activeTab.id);
      }
    } catch (error) {
      console.error("[TabContextManager] Error on window focus:", error);
    }
  }

  // =========================================================================
  // Backend Sync
  // =========================================================================

  /**
   * Send context update to backend
   */
  async syncToBackend() {
    try {
      const unifiedContext = await this.getUnifiedContext();

      // Check if WebSocket is connected (global from background.js)
      if (
        typeof wsConnection !== "undefined" &&
        wsConnection &&
        wsConnection.readyState === WebSocket.OPEN
      ) {
        wsConnection.send(
          JSON.stringify({
            type: "context_update",
            sessionId: this.sessionId,
            context: unifiedContext,
            timestamp: Date.now(),
          }),
        );
        console.debug("[TabContextManager] Synced context to backend");
      }

      // Also check native messaging
      if (typeof nativePort !== "undefined" && nativePort) {
        nativePort.postMessage({
          type: "context_update",
          sessionId: this.sessionId,
          context: unifiedContext,
          timestamp: Date.now(),
        });
      }
    } catch (error) {
      console.error("[TabContextManager] Sync failed:", error);
    }
  }

  startSyncInterval() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    this.syncInterval = setInterval(() => {
      this.syncToBackend();
    }, this.config.SYNC_INTERVAL_MS);
  }

  stopSyncInterval() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  // =========================================================================
  // Storage Operations
  // =========================================================================

  async saveToStorage() {
    try {
      const data = {};
      const now = Date.now();
      let count = 0;

      // Convert Map to object, filtering old entries
      for (const [tabId, context] of this.tabContexts) {
        // Skip old entries
        if (now - context.capturedAt > this.config.MAX_CONTEXT_AGE_MS) {
          continue;
        }

        // Limit total stored
        if (count >= this.config.MAX_STORED_TABS) {
          break;
        }

        data[tabId] = context;
        count++;
      }

      await chrome.storage.local.set({
        [this.config.STORAGE_KEY]: data,
        centris_session_id: this.sessionId,
      });

      console.debug("[TabContextManager] Saved", count, "tab contexts to storage");
    } catch (error) {
      console.error("[TabContextManager] Save to storage failed:", error);
    }
  }

  async loadFromStorage() {
    try {
      const result = await chrome.storage.local.get([
        this.config.STORAGE_KEY,
        "centris_session_id",
      ]);

      if (result[this.config.STORAGE_KEY]) {
        const data = result[this.config.STORAGE_KEY];
        const now = Date.now();

        for (const [tabId, context] of Object.entries(data)) {
          // Only load non-expired contexts
          if (now - context.capturedAt < this.config.MAX_CONTEXT_AGE_MS) {
            this.tabContexts.set(parseInt(tabId), context);
          }
        }

        console.log(
          "[TabContextManager] Loaded",
          this.tabContexts.size,
          "tab contexts from storage",
        );
      }

      // Restore session ID if same session
      if (result["centris_session_id"]) {
        this.sessionId = result["centris_session_id"];
      }
    } catch (error) {
      console.error("[TabContextManager] Load from storage failed:", error);
    }
  }

  _debounceSave() {
    if (this._saveTimeout) {
      clearTimeout(this._saveTimeout);
    }
    this._saveTimeout = setTimeout(() => {
      this.saveToStorage();
    }, 1000);
  }

  // =========================================================================
  // Listeners
  // =========================================================================

  /**
   * Add a listener for context updates
   * @param {Function} callback - Callback function(eventType, data)
   * @returns {Function} Unsubscribe function
   */
  addListener(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  _notifyListeners(eventType, data) {
    for (const listener of this.listeners) {
      try {
        listener(eventType, data);
      } catch (error) {
        console.error("[TabContextManager] Listener error:", error);
      }
    }
  }

  // =========================================================================
  // Cleanup
  // =========================================================================

  /**
   * Clear all context (e.g., on logout)
   */
  async clear() {
    this.tabContexts.clear();
    this.stopSyncInterval();

    await chrome.storage.local.remove([this.config.STORAGE_KEY, "centris_session_id"]);

    console.log("[TabContextManager] Cleared all context");
  }

  /**
   * Get stats for debugging
   */
  getStats() {
    return {
      sessionId: this.sessionId,
      tabCount: this.tabContexts.size,
      syncIntervalActive: this.syncInterval !== null,
      listenerCount: this.listeners.size,
    };
  }
}

// Export singleton instance
const tabContextManager = new TabContextManager();

// Make available globally for background.js
if (typeof globalThis !== "undefined") {
  globalThis.tabContextManager = tabContextManager;
}
