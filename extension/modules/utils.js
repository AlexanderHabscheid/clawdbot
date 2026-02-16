/**
 * Shared Utility Functions for Centris Chrome Extension
 *
 * Provides common helpers used across all modules:
 * - Tab validation
 * - Result object creation
 * - Higher-order function wrappers
 */

// ═══════════════════════════════════════════════════════════════════════════════
// TAB VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get the currently active tab
 *
 * FEB 2026 FIX: Service workers don't have a "currentWindow" - we need to use
 * lastFocusedWindow or query all windows to find the right tab.
 *
 * @param {Object} options - Options for tab selection
 * @param {boolean} options.allowNewTab - If true, allows chrome://newtab as a valid target (for navigation)
 * @returns {Promise<{success: boolean, id?: number, tab?: chrome.tabs.Tab, error?: string, isNewTab?: boolean}>}
 */
async function getActiveTab(options = {}) {
  const { allowNewTab = false } = options;

  try {
    // FEB 2026 FIX: Accept tabs that are still loading (url='') - race condition fix
    // New tabs have empty URL initially, fill in after navigation starts
    const isNewTabUrl = (url) =>
      url &&
      (url.startsWith("chrome://newtab") ||
        url.startsWith("chrome://new-tab-page") ||
        url.startsWith("about:blank") ||
        url.startsWith("about:newtab") ||
        url === "");

    const isRestrictedUrl = (url) =>
      url &&
      ((url.startsWith("chrome://") && !isNewTabUrl(url)) || // Allow newtab pages
        url.startsWith("chrome-extension://") ||
        url.startsWith("edge://") ||
        (url.startsWith("about:") && !isNewTabUrl(url)) ||
        url.startsWith("devtools://"));

    // Valid tab: has id, and either has a real URL, or is loading (status='loading')
    const isValidTab = (t) =>
      t &&
      t.id &&
      ((t.url && !isRestrictedUrl(t.url)) || // Has valid URL
        t.status === "loading" || // Loading (URL may be empty)
        t.pendingUrl); // Has pending URL (navigating)

    // FEB 2026 FIX: For navigation commands, also accept newtab pages
    const isValidTabForNavigation = (t) =>
      t &&
      t.id &&
      (isValidTab(t) || (allowNewTab && t.url && isNewTabUrl(t.url))); // Accept newtab if allowed

    const checkFn = allowNewTab ? isValidTabForNavigation : isValidTab;

    // Strategy 1: Use lastFocusedWindow (works from service workers)
    let tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    let tab = tabs.find(checkFn);

    if (tab) {
      return {
        success: true,
        id: tab.id,
        tab: tab,
        url: tab.url || tab.pendingUrl || "",
        isNewTab: isNewTabUrl(tab.url),
      };
    }

    // Strategy 2: Try currentWindow (works from popups)
    tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = tabs.find(checkFn);

    if (tab) {
      return {
        success: true,
        id: tab.id,
        tab: tab,
        url: tab.url || tab.pendingUrl || "",
        isNewTab: isNewTabUrl(tab.url),
      };
    }

    // Strategy 3: Find ANY valid active tab across all windows
    tabs = await chrome.tabs.query({ active: true });
    tab = tabs.find(checkFn);

    if (tab) {
      return {
        success: true,
        id: tab.id,
        tab: tab,
        url: tab.url || tab.pendingUrl || "",
        isNewTab: isNewTabUrl(tab.url),
      };
    }

    // Strategy 4: Find the most recently accessed non-restricted tab
    const allTabs = await chrome.tabs.query({});
    // Sort by lastAccessed (most recent first)
    allTabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    tab = allTabs.find(checkFn);

    if (tab) {
      return {
        success: true,
        id: tab.id,
        tab: tab,
        url: tab.url || tab.pendingUrl || "",
        isNewTab: isNewTabUrl(tab.url),
      };
    }

    // No valid tab found at all
    return { success: false, error: "No valid (non-restricted) tab found. Open a website first." };
  } catch (error) {
    return { success: false, error: `Failed to get active tab: ${error.message}` };
  }
}

/**
 * Validate and resolve tab ID - if not provided, gets active tab
 * Eliminates the repeated tab validation boilerplate throughout the codebase
 *
 * @param {number|null|undefined} tabId - Optional tab ID
 * @param {Object} options - Options for tab validation
 * @param {boolean} options.allowNewTab - If true, allows chrome://newtab as a valid target
 * @returns {Promise<{success: boolean, tabId?: number, error?: string, isNewTab?: boolean}>}
 */
async function validateTab(tabId, options = {}) {
  if (tabId && typeof tabId === "number") {
    try {
      // Verify the tab still exists
      const tab = await chrome.tabs.get(tabId);
      if (tab) {
        const isNewTabUrl =
          tab.url &&
          (tab.url.startsWith("chrome://newtab") ||
            tab.url.startsWith("chrome://new-tab-page") ||
            tab.url.startsWith("about:blank") ||
            tab.url === "");
        return { success: true, tabId: tabId, isNewTab: isNewTabUrl };
      }
    } catch (e) {
      // Tab doesn't exist, fall through to get active
    }
  }

  // No valid tabId provided, get active tab
  const activeTab = await getActiveTab(options);
  if (!activeTab.success || !activeTab.id) {
    return { success: false, error: activeTab.error || "No active tab found" };
  }

  return { success: true, tabId: activeTab.id, isNewTab: activeTab.isNewTab };
}

/**
 * Higher-order function that wraps a function with automatic tab validation
 *
 * @param {Function} fn - Function that takes (tabId, ...args) as parameters
 * @returns {Function} - Wrapped function with automatic tab validation
 *
 * @example
 * const clickWithValidation = withTabValidation(async (tabId, selector) => {
 *   // tabId is guaranteed to be valid here
 *   return await chrome.scripting.executeScript({ target: { tabId }, ... });
 * });
 */
function withTabValidation(fn) {
  return async function (tabId, ...args) {
    const validation = await validateTab(tabId);
    if (!validation.success) {
      return createResult(false, { error: validation.error });
    }
    return fn(validation.tabId, ...args);
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// RESULT OBJECT CREATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a consistent result object
 * Eliminates the repeated { success: true/false, ... } pattern
 *
 * @param {boolean} success - Whether the operation succeeded
 * @param {Object} data - Additional data to include in the result
 * @returns {Object} - Consistent result object
 *
 * @example
 * return createResult(true, { element: 'button', clicked: true });
 * // Returns: { success: true, element: 'button', clicked: true }
 *
 * return createResult(false, { error: 'Element not found' });
 * // Returns: { success: false, error: 'Element not found' }
 */
function createResult(success, data = {}) {
  return { success, ...data };
}

/**
 * Create a success result
 * @param {Object} data - Data to include
 * @returns {Object} - Success result object
 */
function successResult(data = {}) {
  return createResult(true, data);
}

/**
 * Create an error result
 * @param {string} error - Error message
 * @param {Object} extra - Additional data
 * @returns {Object} - Error result object
 */
function errorResult(error, extra = {}) {
  return createResult(false, { error, ...extra });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SAFE EXECUTION WRAPPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Safely execute a function and catch any errors
 * Returns a consistent result object
 *
 * @param {Function} fn - Async function to execute
 * @param {string} context - Context for error messages
 * @returns {Promise<Object>} - Result object
 */
async function safeExecute(fn, context = "operation") {
  try {
    const result = await fn();
    // If result is already a result object, return it
    if (result && typeof result === "object" && "success" in result) {
      return result;
    }
    // Otherwise wrap it
    return successResult({ result });
  } catch (error) {
    return errorResult(`${context} failed: ${error.message}`, {
      stack: error.stack,
      context,
    });
  }
}

/**
 * Execute a Chrome scripting call with error handling
 *
 * @param {number} tabId - Tab ID
 * @param {Function} func - Function to execute in the page context
 * @param {Array} args - Arguments to pass to the function
 * @param {Object} options - Additional options (world, etc.)
 * @returns {Promise<Object>} - Result object with the script result
 */
async function executeScript(tabId, func, args = [], options = {}) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func,
      args,
      world: options.world || "ISOLATED",
      ...options,
    });

    if (!results || !results[0]) {
      return errorResult("Script execution returned no results");
    }

    const scriptResult = results[0].result;

    // If the script returned a result object, use it
    if (scriptResult && typeof scriptResult === "object" && "success" in scriptResult) {
      return scriptResult;
    }

    return successResult({ result: scriptResult });
  } catch (error) {
    // Handle common Chrome scripting errors
    if (error.message.includes("Cannot access")) {
      return errorResult("Cannot access this page (restricted URL)", { restricted: true });
    }
    if (error.message.includes("No tab with id")) {
      return errorResult("Tab no longer exists", { tabClosed: true });
    }
    if (error.message.includes("Frame with id")) {
      return errorResult("Frame no longer exists", { frameClosed: true });
    }

    return errorResult(`Script execution failed: ${error.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIMING UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Sleep for a specified duration
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute with timeout
 * @param {Promise} promise - Promise to execute
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} operation - Operation name for error message
 * @returns {Promise<any>} - Result or timeout error
 */
async function withTimeout(promise, timeoutMs, operation = "Operation") {
  let timeoutId;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${operation} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId);
    return result;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STRING UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Compute a simple hash of a string (for deduplication, not cryptographic)
 * @param {string} str - String to hash
 * @returns {string} - Hash as hex string
 */
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16);
}

/**
 * Truncate a string to a maximum length
 * @param {string} str - String to truncate
 * @param {number} maxLength - Maximum length
 * @param {string} suffix - Suffix to add if truncated (default: '...')
 * @returns {string} - Truncated string
 */
function truncate(str, maxLength, suffix = "...") {
  if (!str || str.length <= maxLength) {
    return str || "";
  }
  return str.substring(0, maxLength - suffix.length) + suffix;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS (for importScripts compatibility)
// ═══════════════════════════════════════════════════════════════════════════════

// Make functions available globally for service worker
if (typeof globalThis !== "undefined") {
  globalThis.utils = {
    getActiveTab,
    validateTab,
    withTabValidation,
    createResult,
    successResult,
    errorResult,
    safeExecute,
    executeScript,
    sleep,
    withTimeout,
    simpleHash,
    truncate,
  };

  // Also export individual functions for direct access
  globalThis.getActiveTab = getActiveTab;
  globalThis.validateTab = validateTab;
  globalThis.withTabValidation = withTabValidation;
  globalThis.createResult = createResult;
  globalThis.successResult = successResult;
  globalThis.errorResult = errorResult;
  globalThis.safeExecute = safeExecute;
  globalThis.executeScript = executeScript;
  globalThis.sleep = sleep;
  globalThis.withTimeout = withTimeout;
  globalThis.simpleHash = simpleHash;
  globalThis.truncate = truncate;
}
