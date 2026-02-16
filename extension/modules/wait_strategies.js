/**
 * Wait Strategies Module for Centris Chrome Extension
 *
 * Provides various wait conditions for page loading and element states:
 * - Wait for DOM stable
 * - Wait for text to appear
 * - Wait for text to disappear
 * - Wait for navigation
 * - Wait for condition (custom)
 */

// ═══════════════════════════════════════════════════════════════════════════════
// WAIT FOR PAGE LOAD (Native, no JS needed)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Wait for page to finish loading using chrome.tabs.onUpdated
 * This works even on CSP-restricted pages
 *
 * @param {number} tabId - Tab ID
 * @param {number} timeoutMs - Maximum wait time (default 10s)
 * @returns {Promise<Object>} - Result object
 */
async function waitForPageLoad(tabId, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let resolved = false;

    const updateHandler = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId !== tabId || resolved) {
        return;
      }

      if (changeInfo.status === "complete") {
        resolved = true;
        chrome.tabs.onUpdated.removeListener(updateHandler);
        resolve({
          success: true,
          status: "complete",
          url: tab.url,
          loadTime: Date.now() - startTime,
        });
      }
    };

    chrome.tabs.onUpdated.addListener(updateHandler);

    // Timeout
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        chrome.tabs.onUpdated.removeListener(updateHandler);
        resolve({ success: false, error: "Page load timed out" });
      }
    }, timeoutMs);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// WAIT FOR DOM STABLE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Wait for DOM to become stable (no mutations for a period)
 *
 * @param {number} tabId - Tab ID
 * @param {number} stableMs - How long without changes to consider stable (default 500ms)
 * @param {number} timeoutMs - Maximum wait time (default 5s)
 * @returns {Promise<Object>} - Result object
 */
async function waitForDomStable(tabId, stableMs = 500, timeoutMs = 5000) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (stableMs, timeoutMs) => {
      return new Promise((resolve) => {
        let lastMutation = Date.now();
        let checkInterval;

        const observer = new MutationObserver(() => {
          lastMutation = Date.now();
        });

        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true,
        });

        const startTime = Date.now();

        checkInterval = setInterval(() => {
          const elapsed = Date.now() - startTime;
          const timeSinceMutation = Date.now() - lastMutation;

          if (timeSinceMutation >= stableMs) {
            clearInterval(checkInterval);
            observer.disconnect();
            resolve({
              success: true,
              stable: true,
              waitTime: elapsed,
            });
          } else if (elapsed >= timeoutMs) {
            clearInterval(checkInterval);
            observer.disconnect();
            resolve({
              success: true,
              stable: false,
              timedOut: true,
              waitTime: elapsed,
            });
          }
        }, 100);
      });
    },
    args: [stableMs, timeoutMs],
  });

  return results[0]?.result || { success: false, error: "Failed to wait for DOM stable" };
}

// ═══════════════════════════════════════════════════════════════════════════════
// WAIT FOR TEXT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Wait for specific text to appear on the page
 *
 * @param {number} tabId - Tab ID
 * @param {string} text - Text to wait for
 * @param {number} timeoutMs - Maximum wait time (default 10s)
 * @returns {Promise<Object>} - Result object
 */
async function waitForText(tabId, text, timeoutMs = 10000) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (text, timeoutMs) => {
      return new Promise((resolve) => {
        const startTime = Date.now();
        const normalizedText = text.toLowerCase().trim();

        const checkText = () => {
          const bodyText = (document.body?.textContent || "").toLowerCase();

          if (bodyText.includes(normalizedText)) {
            resolve({
              success: true,
              found: true,
              text: text,
              waitTime: Date.now() - startTime,
            });
            return true;
          }
          return false;
        };

        // Check immediately
        if (checkText()) {
          return;
        }

        // Use MutationObserver for efficiency
        const observer = new MutationObserver(() => {
          if (checkText()) {
            observer.disconnect();
          }
        });

        observer.observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true,
        });

        // Timeout
        setTimeout(() => {
          observer.disconnect();
          if (!checkText()) {
            resolve({
              success: false,
              found: false,
              text: text,
              error: `Text "${text}" not found within ${timeoutMs}ms`,
            });
          }
        }, timeoutMs);
      });
    },
    args: [text, timeoutMs],
  });

  return results[0]?.result || { success: false, error: "Failed to wait for text" };
}

// ═══════════════════════════════════════════════════════════════════════════════
// WAIT FOR TEXT GONE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Wait for specific text to disappear from the page
 *
 * @param {number} tabId - Tab ID
 * @param {string} text - Text to wait for removal
 * @param {number} timeoutMs - Maximum wait time (default 10s)
 * @returns {Promise<Object>} - Result object
 */
async function waitForTextGone(tabId, text, timeoutMs = 10000) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (text, timeoutMs) => {
      return new Promise((resolve) => {
        const startTime = Date.now();
        const normalizedText = text.toLowerCase().trim();

        const checkGone = () => {
          const bodyText = (document.body?.textContent || "").toLowerCase();
          return !bodyText.includes(normalizedText);
        };

        // Check immediately
        if (checkGone()) {
          resolve({ success: true, gone: true, text: text, waitTime: 0 });
          return;
        }

        const observer = new MutationObserver(() => {
          if (checkGone()) {
            observer.disconnect();
            resolve({
              success: true,
              gone: true,
              text: text,
              waitTime: Date.now() - startTime,
            });
          }
        });

        observer.observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true,
        });

        setTimeout(() => {
          observer.disconnect();
          resolve({
            success: false,
            gone: false,
            text: text,
            error: `Text "${text}" still present after ${timeoutMs}ms`,
          });
        }, timeoutMs);
      });
    },
    args: [text, timeoutMs],
  });

  return results[0]?.result || { success: false, error: "Failed to wait for text gone" };
}

// ═══════════════════════════════════════════════════════════════════════════════
// WAIT FOR ELEMENT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Wait for an element to appear on the page
 *
 * @param {number} tabId - Tab ID
 * @param {string} selector - CSS selector
 * @param {number} timeoutMs - Maximum wait time (default 10s)
 * @returns {Promise<Object>} - Result object
 */
async function waitForElement(tabId, selector, timeoutMs = 10000) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (selector, timeoutMs) => {
      return new Promise((resolve) => {
        const startTime = Date.now();

        const checkElement = () => {
          const el = document.querySelector(selector);
          if (el) {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          }
          return false;
        };

        if (checkElement()) {
          resolve({ success: true, found: true, selector: selector, waitTime: 0 });
          return;
        }

        const observer = new MutationObserver(() => {
          if (checkElement()) {
            observer.disconnect();
            resolve({
              success: true,
              found: true,
              selector: selector,
              waitTime: Date.now() - startTime,
            });
          }
        });

        observer.observe(document.body, {
          childList: true,
          subtree: true,
        });

        setTimeout(() => {
          observer.disconnect();
          resolve({
            success: false,
            found: false,
            selector: selector,
            error: `Element "${selector}" not found within ${timeoutMs}ms`,
          });
        }, timeoutMs);
      });
    },
    args: [selector, timeoutMs],
  });

  return results[0]?.result || { success: false, error: "Failed to wait for element" };
}

// ═══════════════════════════════════════════════════════════════════════════════
// WAIT FOR NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Wait for a navigation event (URL change)
 *
 * @param {number} tabId - Tab ID
 * @param {number} timeoutMs - Maximum wait time (default 10s)
 * @returns {Promise<Object>} - Result object
 */
async function waitForNavigation(tabId, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let resolved = false;
    let initialUrl = null;

    // Get initial URL
    chrome.tabs.get(tabId, (tab) => {
      initialUrl = tab?.url;
    });

    const updateHandler = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId !== tabId || resolved) {
        return;
      }

      if (changeInfo.url && changeInfo.url !== initialUrl) {
        resolved = true;
        chrome.tabs.onUpdated.removeListener(updateHandler);
        resolve({
          success: true,
          navigated: true,
          from: initialUrl,
          to: changeInfo.url,
          waitTime: Date.now() - startTime,
        });
      }
    };

    chrome.tabs.onUpdated.addListener(updateHandler);

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        chrome.tabs.onUpdated.removeListener(updateHandler);
        resolve({
          success: false,
          navigated: false,
          error: `No navigation detected within ${timeoutMs}ms`,
        });
      }
    }, timeoutMs);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// WAIT FOR CONDITION - Generic condition-based waiting
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Wait for a specific condition (element appears, URL changes, etc.)
 *
 * @param {number} tabId - Tab to wait on
 * @param {string} condition - 'element_exists' | 'element_visible' | 'url_contains' | 'url_changed' | 'text_present'
 * @param {string} value - CSS selector or value to match
 * @param {number} timeoutMs - Maximum wait time (default 5000ms)
 * @returns {Promise<{success: boolean, found: boolean, waitedMs: number}>}
 */
async function waitForCondition(tabId, condition, value, timeoutMs = 5000) {
  if (typeof logWithTimestamp === "function") {
    logWithTimestamp("info", `⏱️ waitForCondition: Waiting for '${condition}' on tab ${tabId}`);
  }

  // Validate tab
  if (!tabId && typeof getActiveTab === "function") {
    try {
      const activeTab = await getActiveTab();
      if (activeTab.success && activeTab.id) {
        tabId = activeTab.id;
      }
    } catch (e) {}
  }

  if (!tabId) {
    return { success: false, error: "No tab ID provided" };
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (condition, value, timeoutMs) => {
        return new Promise((resolve) => {
          const startTime = Date.now();

          const checkCondition = () => {
            const elapsed = Date.now() - startTime;
            let found = false;

            switch (condition) {
              case "element_exists":
                found = !!document.querySelector(value);
                break;
              case "element_visible":
                const el = document.querySelector(value);
                if (el) {
                  const rect = el.getBoundingClientRect();
                  found = rect.width > 0 && rect.height > 0;
                }
                break;
              case "element_gone":
                found = !document.querySelector(value);
                break;
              case "url_contains":
                found = window.location.href.includes(value);
                break;
              case "url_changed":
                found = window.location.href !== value;
                break;
              case "text_present":
                found = (document.body?.textContent || "")
                  .toLowerCase()
                  .includes(value.toLowerCase());
                break;
              case "text_gone":
                found = !(document.body?.textContent || "")
                  .toLowerCase()
                  .includes(value.toLowerCase());
                break;
            }

            if (found) {
              resolve({ found: true, waitedMs: elapsed, condition: condition });
              return true;
            }

            if (elapsed >= timeoutMs) {
              resolve({ found: false, waitedMs: elapsed, timeout: true, condition: condition });
              return true;
            }

            return false;
          };

          if (checkCondition()) {
            return;
          }

          const interval = setInterval(() => {
            if (checkCondition()) {
              clearInterval(interval);
            }
          }, 50);
        });
      },
      args: [condition, value, timeoutMs],
    });

    const result = results[0]?.result;
    if (result) {
      if (typeof logWithTimestamp === "function") {
        logWithTimestamp(
          "info",
          `⏱️ waitForCondition: ${result.found ? "Found" : "Timeout"} after ${result.waitedMs}ms`,
        );
      }
      return { success: true, ...result };
    }

    return { success: false, error: "No result from script" };
  } catch (e) {
    if (typeof logWithTimestamp === "function") {
      logWithTimestamp("warn", `⏱️ waitForCondition error: ${e.message}`);
    }
    return { success: false, error: e.message };
  }
}

/**
 * Simple sleep function
 *
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

if (typeof globalThis !== "undefined") {
  globalThis.waitForPageLoad = waitForPageLoad;
  globalThis.waitForDomStable = waitForDomStable;
  globalThis.waitForText = waitForText;
  globalThis.waitForTextGone = waitForTextGone;
  globalThis.waitForElement = waitForElement;
  globalThis.waitForNavigation = waitForNavigation;
  globalThis.waitForCondition = waitForCondition;
  globalThis.sleep = sleep;
}
