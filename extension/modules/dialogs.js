/**
 * Dialog Handling Module for Centris Chrome Extension
 *
 * CLAWDBOT PATTERN: Handles native browser dialogs
 * The handler must be armed BEFORE the action that triggers the dialog
 *
 * Handles:
 * - alert()
 * - confirm()
 * - prompt()
 * - beforeunload
 */

// ═══════════════════════════════════════════════════════════════════════════════
// DIALOG STATE
// ═══════════════════════════════════════════════════════════════════════════════

// Track armed dialog handlers per tab
const armedDialogHandlers = new Map(); // tabId -> { accept, promptText, armId, timeoutId }

// Track pending dialogs per tab (for legacy support)
const pendingDialogs = new Map();

// ═══════════════════════════════════════════════════════════════════════════════
// ARM DIALOG - CLAWDBOT PATTERN
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Arm a dialog handler BEFORE an action that might trigger a dialog
 * CLAWDBOT PATTERN: Handler must be armed before the triggering action
 *
 * @param {number} tabId - Tab ID
 * @param {boolean} accept - Whether to accept (true) or dismiss (false) the dialog
 * @param {string} promptText - Text to enter in prompt dialogs (optional)
 * @param {number} timeoutMs - How long to keep handler armed (default 30s)
 * @returns {Promise<{success: boolean, armId: string}>}
 */
async function armDialog(tabId, accept = true, promptText = "", timeoutMs = 30000) {
  if (typeof logWithTimestamp === "function") {
    logWithTimestamp(
      "info",
      `🔔 armDialog: Arming dialog handler for tab ${tabId} (accept=${accept})`,
    );
  }

  // Validate tab
  if (!tabId) {
    try {
      if (typeof getActiveTab === "function") {
        const activeTab = await getActiveTab();
        if (!activeTab.success || !activeTab.id) {
          return { success: false, error: "No active tab found" };
        }
        tabId = activeTab.id;
      } else {
        return { success: false, error: "No tab ID provided" };
      }
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // Generate unique arm ID
  const armId = `arm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Clear any existing armed handler for this tab
  const existing = armedDialogHandlers.get(tabId);
  if (existing && existing.timeoutId) {
    clearTimeout(existing.timeoutId);
  }

  // Set up the armed handler
  const timeoutId = setTimeout(() => {
    const handler = armedDialogHandlers.get(tabId);
    if (handler && handler.armId === armId) {
      armedDialogHandlers.delete(tabId);
      if (typeof logWithTimestamp === "function") {
        logWithTimestamp("debug", `🔔 armDialog: Handler ${armId} expired for tab ${tabId}`);
      }
    }
  }, timeoutMs);

  armedDialogHandlers.set(tabId, {
    accept,
    promptText,
    armId,
    timeoutId,
    timestamp: Date.now(),
  });

  // Inject dialog interception script into the page
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (accept, promptText, armId) => {
        // Store the armed handler info in the page
        window.__centrisDialogHandler = {
          accept,
          promptText,
          armId,
          triggered: false,
        };

        // Override native dialog methods
        const originalAlert = window.alert;
        const originalConfirm = window.confirm;
        const originalPrompt = window.prompt;

        window.alert = function (message) {
          const handler = window.__centrisDialogHandler;
          if (handler && !handler.triggered) {
            handler.triggered = true;
            handler.lastDialog = { type: "alert", message };
            // Alert is auto-dismissed, just log it
            console.log("[Centris] Alert intercepted:", message);
            return undefined;
          }
          return originalAlert.apply(this, arguments);
        };

        window.confirm = function (message) {
          const handler = window.__centrisDialogHandler;
          if (handler && !handler.triggered) {
            handler.triggered = true;
            handler.lastDialog = { type: "confirm", message };
            console.log("[Centris] Confirm intercepted:", message, "-> returning", handler.accept);
            return handler.accept;
          }
          return originalConfirm.apply(this, arguments);
        };

        window.prompt = function (message, defaultValue) {
          const handler = window.__centrisDialogHandler;
          if (handler && !handler.triggered) {
            handler.triggered = true;
            handler.lastDialog = { type: "prompt", message, defaultValue };
            if (handler.accept) {
              const value = handler.promptText || defaultValue || "";
              console.log("[Centris] Prompt intercepted:", message, "-> returning", value);
              return value;
            } else {
              console.log(
                "[Centris] Prompt intercepted:",
                message,
                "-> returning null (dismissed)",
              );
              return null;
            }
          }
          return originalPrompt.apply(this, arguments);
        };

        // Store originals for cleanup
        window.__centrisOriginalDialogs = {
          alert: originalAlert,
          confirm: originalConfirm,
          prompt: originalPrompt,
        };

        return { success: true, armed: true };
      },
      args: [accept, promptText, armId],
    });

    if (typeof logWithTimestamp === "function") {
      logWithTimestamp("info", `🔔 armDialog: Handler ${armId} armed for tab ${tabId}`);
    }
    return { success: true, armId, armed: true };
  } catch (e) {
    if (typeof logWithTimestamp === "function") {
      logWithTimestamp("warn", `🔔 armDialog error: ${e.message}`);
    }
    return { success: false, error: e.message };
  }
}

/**
 * Disarm the dialog handler and restore original dialog methods
 *
 * @param {number} tabId - Tab ID
 * @returns {Promise<{success: boolean, lastDialog: Object|null}>}
 */
async function disarmDialog(tabId) {
  if (typeof logWithTimestamp === "function") {
    logWithTimestamp("info", `🔔 disarmDialog: Disarming dialog handler for tab ${tabId}`);
  }

  // Validate tab
  if (!tabId) {
    try {
      if (typeof getActiveTab === "function") {
        const activeTab = await getActiveTab();
        if (!activeTab.success || !activeTab.id) {
          return { success: false, error: "No active tab found" };
        }
        tabId = activeTab.id;
      } else {
        return { success: false, error: "No tab ID provided" };
      }
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // Clear the armed handler
  const existing = armedDialogHandlers.get(tabId);
  if (existing && existing.timeoutId) {
    clearTimeout(existing.timeoutId);
  }
  armedDialogHandlers.delete(tabId);

  // Restore original dialogs in the page
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const originals = window.__centrisOriginalDialogs;
        const handler = window.__centrisDialogHandler;
        let lastDialog = null;

        if (handler) {
          lastDialog = handler.lastDialog || null;
        }

        if (originals) {
          window.alert = originals.alert;
          window.confirm = originals.confirm;
          window.prompt = originals.prompt;
        }

        delete window.__centrisDialogHandler;
        delete window.__centrisOriginalDialogs;

        return { success: true, lastDialog };
      },
    });

    const result = results[0]?.result;
    if (result && result.lastDialog && typeof logWithTimestamp === "function") {
      logWithTimestamp("info", `🔔 disarmDialog: Last dialog was ${result.lastDialog.type}`);
    }
    return result || { success: true, lastDialog: null };
  } catch (e) {
    if (typeof logWithTimestamp === "function") {
      logWithTimestamp("warn", `🔔 disarmDialog error: ${e.message}`);
    }
    return { success: false, error: e.message };
  }
}

/**
 * Check if a dialog was triggered since arming
 *
 * @param {number} tabId - Tab ID
 * @returns {Promise<{success: boolean, triggered: boolean, dialog: Object|null}>}
 */
async function checkDialogTriggered(tabId) {
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
      func: () => {
        const handler = window.__centrisDialogHandler;
        if (handler) {
          return {
            success: true,
            triggered: handler.triggered || false,
            dialog: handler.lastDialog || null,
          };
        }
        return { success: true, triggered: false, dialog: null, noHandler: true };
      },
    });

    return results[0]?.result || { success: false, error: "No result" };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LEGACY DIALOG HANDLING (backwards compatibility)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Handle a dialog (accept or dismiss)
 *
 * @param {number} tabId - Tab ID
 * @param {boolean} accept - Whether to accept the dialog
 * @param {string} promptText - Text to enter for prompt dialogs (optional)
 * @returns {Promise<Object>} - Result object
 */
async function handleDialog(tabId, accept = true, promptText = "") {
  // Use the new arm/disarm pattern for better reliability
  const armResult = await armDialog(tabId, accept, promptText);
  if (!armResult.success) {
    return armResult;
  }

  return {
    success: true,
    ready: true,
    armId: armResult.armId,
    note: "Dialog handlers installed for next dialog",
  };
}

/**
 * Wait for a dialog to appear
 *
 * @param {number} tabId - Tab ID
 * @param {number} timeoutMs - Maximum wait time (default 5s)
 * @returns {Promise<Object>} - Result with dialog info
 */
async function waitForDialog(tabId, timeoutMs = 5000) {
  const result = await checkDialogTriggered(tabId);

  if (result.triggered && result.dialog) {
    return { success: true, dialog: result.dialog };
  }

  return {
    success: true,
    dialog: null,
    message: "No dialog currently pending",
  };
}

/**
 * Dismiss any open dialog
 *
 * @param {number} tabId - Tab ID
 * @returns {Promise<Object>} - Result object
 */
async function dismissDialog(tabId) {
  return handleDialog(tabId, false);
}

/**
 * Accept any open dialog
 *
 * @param {number} tabId - Tab ID
 * @param {string} promptText - Text for prompt dialogs
 * @returns {Promise<Object>} - Result object
 */
async function acceptDialog(tabId, promptText = "") {
  return handleDialog(tabId, true, promptText);
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

if (typeof globalThis !== "undefined") {
  // CLAWDBOT pattern functions
  globalThis.armDialog = armDialog;
  globalThis.disarmDialog = disarmDialog;
  globalThis.checkDialogTriggered = checkDialogTriggered;

  // Legacy functions
  globalThis.handleDialog = handleDialog;
  globalThis.waitForDialog = waitForDialog;
  globalThis.dismissDialog = dismissDialog;
  globalThis.acceptDialog = acceptDialog;

  // State access
  globalThis.armedDialogHandlers = armedDialogHandlers;
}
