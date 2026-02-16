/**
 * AI-Friendly Error Handling for Centris Chrome Extension
 *
 * CLAWDBOT PATTERN: Transforms raw errors into actionable messages
 * that help the LLM understand what went wrong and how to recover.
 *
 * Instead of cryptic error messages, this provides:
 * - Clear explanation of what failed
 * - Suggested actions to fix it
 * - Preserved original error for debugging
 */

// ═══════════════════════════════════════════════════════════════════════════════
// AI-FRIENDLY ERROR TRANSFORMATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Transform errors into AI-friendly messages with suggested actions
 * CLAWDBOT PATTERN: Helps LLM understand what went wrong and how to fix it
 *
 * @param {Error|string} error - The error to transform
 * @param {string} context - Optional context about what operation failed
 * @returns {string} AI-friendly error message with suggestions
 */
function toAIFriendlyError(error, context = "") {
  const msg = error?.message || String(error);
  const lowerMsg = msg.toLowerCase();

  // Multiple elements matched (ambiguous selector)
  if (
    lowerMsg.includes("multiple elements") ||
    lowerMsg.includes("matched") ||
    lowerMsg.includes("ambiguous") ||
    lowerMsg.includes("not unique")
  ) {
    return `${msg}. Try running get_interactive_snapshot to see current elements and get updated IDs, then specify a more unique element.`;
  }

  // Element not found
  if (
    lowerMsg.includes("not found") ||
    lowerMsg.includes("no element") ||
    lowerMsg.includes("does not exist") ||
    lowerMsg.includes("null")
  ) {
    return `Element not found. The page may have changed. Run get_interactive_snapshot to see current page elements and get fresh element IDs.`;
  }

  // Element not visible/hidden
  if (
    lowerMsg.includes("not visible") ||
    lowerMsg.includes("hidden") ||
    lowerMsg.includes("display: none") ||
    lowerMsg.includes("visibility")
  ) {
    return `Element is not visible. It may be hidden, off-screen, or covered by another element. Try scrolling the page, closing any overlays/modals, or running get_interactive_snapshot to find visible alternatives.`;
  }

  // Element not interactable (covered/disabled)
  if (
    lowerMsg.includes("not interactable") ||
    lowerMsg.includes("intercepted") ||
    lowerMsg.includes("covered") ||
    lowerMsg.includes("pointer-events")
  ) {
    return `Element is not interactable - it may be covered by another element or disabled. Try closing any popups/overlays, scrolling the element into view, or running get_interactive_snapshot to find alternative elements.`;
  }

  // Timeout errors
  if (lowerMsg.includes("timeout") || lowerMsg.includes("timed out")) {
    return `Operation timed out. The page may still be loading or the element hasn't appeared yet. Try using wait_for_text or wait_for_dom_stable, then retry the operation.`;
  }

  // Tab/page errors
  if (lowerMsg.includes("tab") || lowerMsg.includes("no active")) {
    return `${msg}. Use navigate_browser to open a page first, or ensure the browser tab is still open.`;
  }

  // Restricted page errors
  if (
    lowerMsg.includes("restricted") ||
    lowerMsg.includes("chrome://") ||
    lowerMsg.includes("cannot access") ||
    lowerMsg.includes("extension page")
  ) {
    return `Cannot interact with this page type - browser internal pages are protected. Use navigate_browser to go to a regular website (https://) first.`;
  }

  // Script injection errors
  if (
    lowerMsg.includes("script") ||
    lowerMsg.includes("inject") ||
    lowerMsg.includes("csp") ||
    lowerMsg.includes("content security")
  ) {
    return `Cannot execute scripts on this page due to security restrictions. Try using alternative methods like click_by_coordinates.`;
  }

  // Stale element (DOM changed)
  if (
    lowerMsg.includes("stale") ||
    lowerMsg.includes("detached") ||
    lowerMsg.includes("removed") ||
    lowerMsg.includes("dom changed")
  ) {
    return `Element is stale - the page DOM has changed since the last snapshot. Run get_interactive_snapshot to get fresh element IDs.`;
  }

  // Network errors
  if (
    lowerMsg.includes("network") ||
    lowerMsg.includes("fetch") ||
    lowerMsg.includes("connection") ||
    lowerMsg.includes("offline")
  ) {
    return `Network error occurred. Check internet connection and try again. If navigating, verify the URL is correct.`;
  }

  // Default: return original with generic suggestion
  if (context) {
    return `${context}: ${msg}. Try running get_interactive_snapshot to see current page state.`;
  }
  return `${msg}. Try running get_interactive_snapshot to see current page state and retry.`;
}

/**
 * Wrap a function result with AI-friendly error handling
 * Use this to wrap results before returning to the LLM
 *
 * @param {Object} result - The result object (should have success property)
 * @param {string} context - Optional context for error messages
 * @returns {Object} Result with AI-friendly error message if failed
 */
function withAIFriendlyError(result, context = "") {
  if (result && result.success === false && result.error) {
    return {
      ...result,
      error: toAIFriendlyError(result.error, context),
      originalError: result.error, // Keep original for debugging
    };
  }
  return result;
}

/**
 * Create an AI-friendly error result object
 *
 * @param {string} error - Error message
 * @param {string} context - Context for the error
 * @param {Object} extra - Additional data to include
 * @returns {Object} - Error result with AI-friendly message
 */
function createAIErrorResult(error, context = "", extra = {}) {
  return {
    success: false,
    error: toAIFriendlyError(error, context),
    originalError: error,
    ...extra,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ERROR CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Classify an error into a category for better handling
 * @param {Error|string} error - The error to classify
 * @returns {string} - Error category
 */
function classifyError(error) {
  const msg = (error?.message || String(error)).toLowerCase();

  if (msg.includes("not found") || msg.includes("no element")) {
    return "element_not_found";
  }
  if (msg.includes("not visible") || msg.includes("hidden")) {
    return "element_hidden";
  }
  if (msg.includes("not interactable") || msg.includes("covered")) {
    return "element_blocked";
  }
  if (msg.includes("timeout") || msg.includes("timed out")) {
    return "timeout";
  }
  if (msg.includes("stale") || msg.includes("detached")) {
    return "stale_element";
  }
  if (msg.includes("tab") || msg.includes("no active")) {
    return "tab_error";
  }
  if (msg.includes("restricted") || msg.includes("chrome://")) {
    return "restricted_page";
  }
  if (msg.includes("network") || msg.includes("connection")) {
    return "network_error";
  }
  if (msg.includes("multiple") || msg.includes("ambiguous")) {
    return "ambiguous_selector";
  }

  return "unknown";
}

/**
 * Check if an error is recoverable (can be retried)
 * @param {Error|string} error - The error to check
 * @returns {boolean} - Whether the error might be recoverable
 */
function isRecoverableError(error) {
  const category = classifyError(error);

  // These errors might succeed if retried after taking corrective action
  const recoverableCategories = [
    "element_not_found", // Page may still be loading
    "element_hidden", // May become visible
    "element_blocked", // Overlay may close
    "timeout", // May complete on retry
    "stale_element", // Get fresh snapshot
    "network_error", // Network may recover
  ];

  return recoverableCategories.includes(category);
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

// Make available globally for service worker
if (typeof globalThis !== "undefined") {
  globalThis.toAIFriendlyError = toAIFriendlyError;
  globalThis.withAIFriendlyError = withAIFriendlyError;
  globalThis.createAIErrorResult = createAIErrorResult;
  globalThis.classifyError = classifyError;
  globalThis.isRecoverableError = isRecoverableError;
}
