/**
 * DOM Interactions Module for Centris Chrome Extension
 *
 * Handles all DOM interaction functions:
 * - Click (strict - directRef or htmlId only, no silent fallbacks)
 * - Type text
 * - Paste text
 * - Hover
 * - Scroll
 * - Focus
 *
 * FEB 2026 REWRITE: Removed cascading fallback strategies (selector,
 * coordinates, textContent) because they silently clicked WRONG elements
 * in list contexts (email rows, search results). When the LLM says
 * "click node 57", we click EXACTLY node 57 or fail with needsSnapshot
 * so the system re-snapshots and retries with correct references.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// CLICK NODE - Strict click: exact element or fail
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Click an element by nodeId - STRICT MODE (no fuzzy fallbacks)
 *
 * Only uses reliable strategies that guarantee clicking the CORRECT element:
 * 0. directRef - window.__centrisNodeMap.get(nodeId) (exact DOM element)
 * 1. htmlId - document.getElementById (unique by spec)
 *
 * If both fail, returns needsSnapshot: true so the backend re-snapshots
 * and retries with fresh DOM references. This is MUCH better than silently
 * clicking the wrong element via selector/coordinates/text matching.
 *
 * @param {number} tabId - Tab ID
 * @param {number} nodeId - Node ID from snapshot
 * @returns {Promise<Object>} - Result object
 */
async function clickNode(tabId, nodeId) {
  // Get nodeIdMappings from global scope
  const nodeIdMappings = globalThis.nodeIdMappings || new Map();

  const tabMapping = nodeIdMappings.get(tabId);
  if (!tabMapping) {
    return {
      success: false,
      error: "No snapshot data for this tab. Call getInteractiveSnapshot first.",
      needsSnapshot: true,
    };
  }

  const nodeInfo = tabMapping.get(nodeId);
  if (!nodeInfo) {
    return {
      success: false,
      error: `Node ID ${nodeId} not found. The page may have changed - call getInteractiveSnapshot to get fresh node IDs.`,
      needsSnapshot: true,
    };
  }

  const elementName = nodeInfo.name || nodeInfo.ariaLabel || `Node ${nodeId}`;
  const displayName = elementName.length > 50 ? elementName.substring(0, 50) + "..." : elementName;

  if (typeof logWithTimestamp === "function") {
    logWithTimestamp("info", `👆 CLICKING: "${displayName}" (nodeId=${nodeId})`, {
      nodeId,
      bounds: nodeInfo.bounds,
    });
  }

  // Ensure visuals are injected
  if (typeof ensureVisualizationsInjected === "function") {
    await ensureVisualizationsInjected(tabId);
  }

  // Execute STRICT click in page context - directRef or htmlId only
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (nodeInfo, displayName) => {
      // Helper: Perform click with visual feedback
      function performClick(element, method) {
        try {
          element.scrollIntoView({ behavior: "instant", block: "center" });

          const rect = element.getBoundingClientRect();
          if (window.centrisHighlightElement) {
            window.centrisHighlightElement(rect.left, rect.top, rect.width, rect.height);
          }
          if (window.centrisShowClick) {
            window.centrisShowClick(rect.left + rect.width / 2, rect.top + rect.height / 2);
          }

          const beforeUrl = window.location.href;
          element.click();
          const afterUrl = window.location.href;

          return {
            success: true,
            method: method,
            clickedText: (element.textContent || "").substring(0, 80).trim(),
            changeDetected: beforeUrl !== afterUrl,
          };
        } catch (e) {
          return { success: false, method: method, error: e.message };
        }
      }

      const errors = [];

      // Strategy 0: DIRECT DOM REFERENCE (most reliable)
      // The snapshot stores a WeakRef-safe Map of nodeId → DOM element.
      // This is the EXACT element identified during the snapshot.
      if (nodeInfo.nodeId != null && window.__centrisNodeMap) {
        const el = window.__centrisNodeMap.get(nodeInfo.nodeId);
        if (el && el.isConnected) {
          const result = performClick(el, "directRef");
          if (result.success) {
            return result;
          }
          errors.push(`directRef failed: ${result.error}`);
        } else {
          errors.push(`directRef: element ${el ? "disconnected" : "not in map"}`);
        }
      } else {
        errors.push("directRef: __centrisNodeMap not available");
      }

      // Strategy 1: htmlId (unique by HTML spec)
      if (nodeInfo.htmlId) {
        const el = document.getElementById(nodeInfo.htmlId);
        if (el) {
          const result = performClick(el, "htmlId");
          if (result.success) {
            return result;
          }
          errors.push(`htmlId failed: ${result.error}`);
        } else {
          errors.push(`htmlId: no element with id="${nodeInfo.htmlId}"`);
        }
      }

      // NO MORE FALLBACKS. Selector, coordinates, and text matching
      // are REMOVED because they silently click wrong elements in lists
      // (email rows, search results, etc.). Better to fail and re-snapshot.

      return {
        success: false,
        error: `Element stale - direct reference lost. Errors: ${errors.join("; ")}. Target was: "${displayName}"`,
        needsSnapshot: true,
        staleElement: true,
      };
    },
    args: [nodeInfo, displayName],
  });

  if (!results || !results[0] || results[0].result === undefined) {
    return { success: false, error: "Script execution failed", needsSnapshot: true };
  }

  return results[0].result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TYPE TEXT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Type text into an element
 *
 * @param {number} tabId - Tab ID
 * @param {string} selector - CSS selector for the input element
 * @param {string} text - Text to type
 * @returns {Promise<Object>} - Result object
 */
async function typeText(tabId, selector, text) {
  if (typeof ensureVisualizationsInjected === "function") {
    await ensureVisualizationsInjected(tabId);
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (selector, text) => {
      let element = document.querySelector(selector);

      if (!element) {
        return { success: false, error: "Element not found" };
      }

      element.scrollIntoView({ behavior: "smooth", block: "center" });
      element.focus();

      // Show typing indicator
      const rect = element.getBoundingClientRect();
      if (window.centrisShowTyping) {
        window.centrisShowTyping(rect.left + rect.width / 2, rect.top, text);
      }

      // Clear existing value and type new text
      if (element.value !== undefined) {
        element.value = "";
      }

      // Simulate typing character by character
      for (const char of text) {
        element.dispatchEvent(new KeyboardEvent("keydown", { key: char, bubbles: true }));
        element.dispatchEvent(new KeyboardEvent("keypress", { key: char, bubbles: true }));

        if (element.value !== undefined) {
          element.value += char;
        }

        element.dispatchEvent(new InputEvent("input", { data: char, bubbles: true }));
        element.dispatchEvent(new KeyboardEvent("keyup", { key: char, bubbles: true }));

        await new Promise((r) => setTimeout(r, 20));
      }

      element.dispatchEvent(new Event("change", { bubbles: true }));

      return {
        success: true,
        typed: text,
        element: element.tagName,
      };
    },
    args: [selector, text],
  });

  return results[0]?.result || { success: false, error: "No result from type operation" };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TYPE INTO NODE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Type text into an element by nodeId
 *
 * @param {number} tabId - Tab ID
 * @param {number} nodeId - Node ID from snapshot
 * @param {string} text - Text to type
 * @returns {Promise<Object>} - Result object
 */
async function typeIntoNode(tabId, nodeId, text) {
  const nodeIdMappings = globalThis.nodeIdMappings || new Map();

  const tabMapping = nodeIdMappings.get(tabId);
  if (!tabMapping) {
    return { success: false, error: "No snapshot data for this tab", needsSnapshot: true };
  }

  const nodeInfo = tabMapping.get(nodeId);
  if (!nodeInfo) {
    return { success: false, error: `Node ID ${nodeId} not found`, needsSnapshot: true };
  }

  if (typeof logWithTimestamp === "function") {
    logWithTimestamp("info", `⌨️ TYPING into node ${nodeId}: "${text.substring(0, 30)}..."`);
  }

  if (typeof ensureVisualizationsInjected === "function") {
    await ensureVisualizationsInjected(tabId);
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (nodeInfo, text) => {
      // Find element using cascading strategies (same order as clickNode)
      let element = null;

      // Strategy 0: Direct DOM reference from snapshot
      if (nodeInfo.nodeId != null && window.__centrisNodeMap) {
        const directEl = window.__centrisNodeMap.get(nodeInfo.nodeId);
        if (directEl && directEl.isConnected) {
          element = directEl;
        }
      }
      if (!element && nodeInfo.htmlId) {
        element = document.getElementById(nodeInfo.htmlId);
      }
      if (!element && nodeInfo.selector) {
        try {
          element = document.querySelector(nodeInfo.selector);
        } catch (e) {}
      }
      if (!element && nodeInfo.bounds) {
        const x = nodeInfo.bounds.x + nodeInfo.bounds.width / 2;
        const y = nodeInfo.bounds.y + nodeInfo.bounds.height / 2;
        element = document.elementFromPoint(x, y);
      }

      if (!element) {
        return { success: false, error: "Element not found", needsSnapshot: true };
      }

      element.scrollIntoView({ behavior: "instant", block: "center" });
      element.focus();

      // Show visual feedback
      const rect = element.getBoundingClientRect();
      if (window.centrisShowTyping) {
        window.centrisShowTyping(rect.left + rect.width / 2, rect.top, text);
      }

      // Contenteditable elements (rich text editors like LinkedIn, Notion, etc.)
      // MUST use execCommand/insertText — setting textContent destroys framework state.
      if (element.isContentEditable) {
        // Clear any placeholder text by selecting all first
        const sel = window.getSelection();
        if (sel) {
          sel.selectAllChildren(element);
          sel.collapseToEnd();
        }

        // insertText via execCommand — the only reliable way for contenteditable
        const inserted = document.execCommand("insertText", false, text);
        if (!inserted) {
          // Fallback: character-by-character keyboard simulation
          for (const char of text) {
            element.dispatchEvent(
              new InputEvent("beforeinput", {
                data: char,
                inputType: "insertText",
                bubbles: true,
                cancelable: true,
              }),
            );
            element.dispatchEvent(
              new InputEvent("input", {
                data: char,
                inputType: "insertText",
                bubbles: true,
              }),
            );
          }
        }
        return { success: true, typed: text, method: "contenteditable" };
      }

      // Standard form inputs (input, textarea, select)
      if (element.value !== undefined) {
        element.value = text;
        element.dispatchEvent(new InputEvent("input", { data: text, bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return { success: true, typed: text, method: "value" };
      }

      return {
        success: false,
        error: "Element is not editable (no value property, not contentEditable)",
      };
    },
    args: [nodeInfo, text],
  });

  return results[0]?.result || { success: false, error: "No result from type operation" };
}

// ═══════════════════════════════════════════════════════════════════════════════
// HOVER ELEMENT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Hover over an element
 *
 * @param {number} tabId - Tab ID
 * @param {string} selector - CSS selector
 * @returns {Promise<Object>} - Result object
 */
async function hoverElement(tabId, selector) {
  if (typeof ensureVisualizationsInjected === "function") {
    await ensureVisualizationsInjected(tabId);
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (selector) => {
      const element = document.querySelector(selector);
      if (!element) {
        return { success: false, error: "Element not found" };
      }

      element.scrollIntoView({ behavior: "instant", block: "center" });

      const rect = element.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const eventOptions = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: centerX,
        clientY: centerY,
      };

      element.dispatchEvent(new MouseEvent("mouseenter", eventOptions));
      element.dispatchEvent(new MouseEvent("mouseover", eventOptions));
      element.dispatchEvent(new MouseEvent("mousemove", eventOptions));

      return {
        success: true,
        hovered: true,
        position: { x: centerX, y: centerY },
      };
    },
    args: [selector],
  });

  return results[0]?.result || { success: false, error: "No result from hover operation" };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCROLL ELEMENT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Scroll to an element or by amount
 *
 * @param {number} tabId - Tab ID
 * @param {Object} options - { selector, direction, amount }
 * @returns {Promise<Object>} - Result object
 */
async function scrollElement(tabId, options = {}) {
  const { selector, direction = "down", amount = 300 } = options;

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (selector, direction, amount) => {
      if (selector) {
        const element = document.querySelector(selector);
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "center" });
          return { success: true, scrolledTo: selector };
        }
        return { success: false, error: "Element not found" };
      }

      const scrollAmount = direction === "up" ? -amount : amount;
      window.scrollBy({ top: scrollAmount, behavior: "smooth" });

      return {
        success: true,
        scrolled: scrollAmount,
        newPosition: { x: window.scrollX, y: window.scrollY },
      };
    },
    args: [selector, direction, amount],
  });

  return results[0]?.result || { success: false, error: "No result from scroll operation" };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PASTE TEXT - Copy to clipboard and paste with Cmd+V/Ctrl+V
// BEST FOR CANVAS EDITORS: Google Docs, Notion, Figma, etc.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Paste text via clipboard - Best for canvas editors
 * Uses clipboard API + paste event simulation
 *
 * @param {number} tabId - Tab ID
 * @param {string} text - Text to paste
 * @returns {Promise<Object>} - Result object
 */
async function pasteText(tabId, text) {
  if (typeof logWithTimestamp === "function") {
    logWithTimestamp("info", `📋 Pasting text: "${text.substring(0, 50)}..." via clipboard`);
  }

  if (typeof ensureVisualizationsInjected === "function") {
    await ensureVisualizationsInjected(tabId);
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (text) => {
      // Step 1: Copy text to clipboard
      try {
        await navigator.clipboard.writeText(text);
      } catch (clipboardError) {
        // Clipboard API might fail - try fallback
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        textArea.style.top = "-9999px";
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
      }

      // Visual feedback
      if (window.centrisShowActionToast) {
        const displayText = text.length > 25 ? text.substring(0, 25) + "..." : text;
        window.centrisShowActionToast(`Pasting: "${displayText}"`, "📋");
      }

      // Step 2: Simulate paste (Cmd+V / Ctrl+V)
      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const modifier = isMac ? "metaKey" : "ctrlKey";

      const target = document.activeElement || document.body;

      // keydown with modifier
      target.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "v",
          code: "KeyV",
          keyCode: 86,
          [modifier]: true,
          bubbles: true,
          cancelable: true,
        }),
      );

      // Create and dispatch a ClipboardEvent for paste
      try {
        const dt = new DataTransfer();
        dt.setData("text/plain", text);
        const pasteEvent = new ClipboardEvent("paste", {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
        });
        target.dispatchEvent(pasteEvent);
      } catch (e) {
        // ClipboardEvent might not work in all contexts
      }

      // keyup
      target.dispatchEvent(
        new KeyboardEvent("keyup", {
          key: "v",
          code: "KeyV",
          keyCode: 86,
          [modifier]: true,
          bubbles: true,
          cancelable: true,
        }),
      );

      await new Promise((r) => setTimeout(r, 100));

      try {
        document.execCommand("paste");
      } catch (e) {}

      return { success: true, method: "clipboard-paste" };
    },
    args: [text],
  });

  return results[0]?.result || { success: false, error: "Paste operation failed" };
}

// ═══════════════════════════════════════════════════════════════════════════════
// GLOBAL TYPE - Type by dispatching keyboard events to document
// For complex editors where type_text fails (Google Docs, Notion, etc.)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Type text by dispatching keyboard events globally
 * For canvas-based editors that listen for keyboard events on document
 *
 * @param {number} tabId - Tab ID
 * @param {string} text - Text to type
 * @returns {Promise<Object>} - Result object
 */
async function globalType(tabId, text) {
  if (typeof logWithTimestamp === "function") {
    logWithTimestamp("info", `⌨️ Global typing: "${text.substring(0, 50)}..." to document`);
  }

  if (typeof ensureVisualizationsInjected === "function") {
    await ensureVisualizationsInjected(tabId);
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (text) => {
      if (window.centrisShowActionToast) {
        const displayText = text.length > 25 ? text.substring(0, 25) + "..." : text;
        window.centrisShowActionToast(`Typing: "${displayText}"`, "⌨️");
      }

      const target = document.activeElement || document.body;

      return new Promise((resolve) => {
        let charIndex = 0;

        function typeNextChar() {
          if (charIndex >= text.length) {
            resolve({ success: true, typed: text.length, method: "global-keyboard" });
            return;
          }

          const char = text[charIndex];
          const keyCode = char.charCodeAt(0);

          let key = char;
          let code = "Key" + char.toUpperCase();
          if (char === " ") {
            key = " ";
            code = "Space";
          } else if (char === "\n") {
            key = "Enter";
            code = "Enter";
          } else if (char === "\t") {
            key = "Tab";
            code = "Tab";
          }

          [target, document].forEach((t) => {
            t.dispatchEvent(
              new KeyboardEvent("keydown", {
                key,
                code,
                keyCode,
                which: keyCode,
                bubbles: true,
                cancelable: true,
              }),
            );

            t.dispatchEvent(
              new KeyboardEvent("keypress", {
                key,
                code,
                keyCode,
                charCode: keyCode,
                which: keyCode,
                bubbles: true,
                cancelable: true,
              }),
            );

            t.dispatchEvent(
              new InputEvent("input", {
                data: char,
                inputType: "insertText",
                bubbles: true,
                cancelable: true,
              }),
            );

            t.dispatchEvent(
              new InputEvent("beforeinput", {
                data: char,
                inputType: "insertText",
                bubbles: true,
                cancelable: true,
              }),
            );

            t.dispatchEvent(
              new KeyboardEvent("keyup", {
                key,
                code,
                keyCode,
                which: keyCode,
                bubbles: true,
                cancelable: true,
              }),
            );
          });

          if (target.isContentEditable || target !== document.body) {
            try {
              document.execCommand("insertText", false, char);
            } catch (e) {}
          }

          charIndex++;
          const delay = text.length > 50 ? 1 : 5;
          setTimeout(typeNextChar, delay);
        }

        typeNextChar();
      });
    },
    args: [text],
  });

  return results[0]?.result || { success: false, error: "Global type operation failed" };
}

// ═══════════════════════════════════════════════════════════════════════════════
// HOVER NODE - Hover by nodeId (strict, same resolution as clickNode)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Hover over an element by nodeId — reveals dropdowns, menus, tooltips.
 * Uses the same strict resolution strategy as clickNode (directRef → htmlId).
 *
 * @param {number} tabId - Tab ID
 * @param {number} nodeId - Node ID from snapshot
 * @returns {Promise<Object>} - Result object
 */
async function hoverNode(tabId, nodeId) {
  const nodeIdMappings = globalThis.nodeIdMappings || new Map();

  const tabMapping = nodeIdMappings.get(tabId);
  if (!tabMapping) {
    return {
      success: false,
      error: "No snapshot data for this tab. Call getInteractiveSnapshot first.",
      needsSnapshot: true,
    };
  }

  const nodeInfo = tabMapping.get(nodeId);
  if (!nodeInfo) {
    return {
      success: false,
      error: `Node ID ${nodeId} not found. The page may have changed - call getInteractiveSnapshot to get fresh node IDs.`,
      needsSnapshot: true,
    };
  }

  if (typeof logWithTimestamp === "function") {
    const name = (nodeInfo.name || nodeInfo.ariaLabel || `Node ${nodeId}`).substring(0, 50);
    logWithTimestamp("info", `🖱️ HOVERING: "${name}" (nodeId=${nodeId})`);
  }

  if (typeof ensureVisualizationsInjected === "function") {
    await ensureVisualizationsInjected(tabId);
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (nodeInfo) => {
      let element = null;

      // Strategy 0: Direct DOM reference
      if (nodeInfo.nodeId != null && window.__centrisNodeMap) {
        const el = window.__centrisNodeMap.get(nodeInfo.nodeId);
        if (el && el.isConnected) {
          element = el;
        }
      }

      // Strategy 1: htmlId fallback
      if (!element && nodeInfo.htmlId) {
        element = document.getElementById(nodeInfo.htmlId);
      }

      if (!element) {
        return {
          success: false,
          error: "Element stale - direct reference lost.",
          needsSnapshot: true,
          staleElement: true,
        };
      }

      element.scrollIntoView({ behavior: "instant", block: "center" });

      const rect = element.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      if (window.centrisHighlightElement) {
        window.centrisHighlightElement(rect.left, rect.top, rect.width, rect.height);
      }

      const eventOptions = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: centerX,
        clientY: centerY,
      };

      element.dispatchEvent(new MouseEvent("mouseenter", eventOptions));
      element.dispatchEvent(new MouseEvent("mouseover", eventOptions));
      element.dispatchEvent(new MouseEvent("mousemove", eventOptions));

      return {
        success: true,
        hovered: true,
        position: { x: centerX, y: centerY },
      };
    },
    args: [nodeInfo],
  });

  if (!results || !results[0] || results[0].result === undefined) {
    return { success: false, error: "Script execution failed", needsSnapshot: true };
  }

  return results[0].result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SELECT OPTION - Select a value from a <select> element by nodeId
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Select an option from a <select> element by nodeId.
 * Matches by value first, then by option text content (case-insensitive).
 *
 * @param {number} tabId - Tab ID
 * @param {number} nodeId - Node ID from snapshot
 * @param {string} value - Option value or visible text to match
 * @returns {Promise<Object>} - Result object
 */
async function selectOption(tabId, nodeId, value) {
  const nodeIdMappings = globalThis.nodeIdMappings || new Map();

  const tabMapping = nodeIdMappings.get(tabId);
  if (!tabMapping) {
    return { success: false, error: "No snapshot data for this tab", needsSnapshot: true };
  }

  const nodeInfo = tabMapping.get(nodeId);
  if (!nodeInfo) {
    return { success: false, error: `Node ID ${nodeId} not found`, needsSnapshot: true };
  }

  if (typeof logWithTimestamp === "function") {
    logWithTimestamp("info", `📋 SELECT: nodeId=${nodeId} value="${value}"`);
  }

  if (typeof ensureVisualizationsInjected === "function") {
    await ensureVisualizationsInjected(tabId);
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (nodeInfo, value) => {
      let element = null;

      if (nodeInfo.nodeId != null && window.__centrisNodeMap) {
        const el = window.__centrisNodeMap.get(nodeInfo.nodeId);
        if (el && el.isConnected) {
          element = el;
        }
      }
      if (!element && nodeInfo.htmlId) {
        element = document.getElementById(nodeInfo.htmlId);
      }

      if (!element) {
        return { success: false, error: "Element not found", needsSnapshot: true };
      }

      if (element.tagName !== "SELECT") {
        return {
          success: false,
          error: `Element is <${element.tagName.toLowerCase()}>, not <select>`,
        };
      }

      const options = Array.from(element.options);

      // Try exact value match first
      let match = options.find((o) => o.value === value);
      // Then case-insensitive text match
      if (!match) {
        const lower = value.toLowerCase();
        match = options.find((o) => o.textContent.trim().toLowerCase() === lower);
      }
      // Partial text match as last resort
      if (!match) {
        const lower = value.toLowerCase();
        match = options.find((o) => o.textContent.trim().toLowerCase().includes(lower));
      }

      if (!match) {
        const available = options.map((o) => `"${o.textContent.trim()}" (${o.value})`).join(", ");
        return {
          success: false,
          error: `No option matching "${value}". Available: ${available.substring(0, 200)}`,
        };
      }

      element.value = match.value;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));

      return {
        success: true,
        selectedValue: match.value,
        selectedText: match.textContent.trim(),
      };
    },
    args: [nodeInfo, value],
  });

  return results[0]?.result || { success: false, error: "Select operation failed" };
}

// ═══════════════════════════════════════════════════════════════════════════════
// FILL NODE - Clear and replace field content by nodeId
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Clear an element's content and fill with new text.
 * For standard inputs: sets element.value directly.
 * For contenteditable: selectAll + delete + insertText.
 *
 * @param {number} tabId - Tab ID
 * @param {number} nodeId - Node ID from snapshot
 * @param {string} text - Text to fill
 * @returns {Promise<Object>} - Result object
 */
async function fillNode(tabId, nodeId, text) {
  const nodeIdMappings = globalThis.nodeIdMappings || new Map();

  const tabMapping = nodeIdMappings.get(tabId);
  if (!tabMapping) {
    return { success: false, error: "No snapshot data for this tab", needsSnapshot: true };
  }

  const nodeInfo = tabMapping.get(nodeId);
  if (!nodeInfo) {
    return { success: false, error: `Node ID ${nodeId} not found`, needsSnapshot: true };
  }

  if (typeof logWithTimestamp === "function") {
    logWithTimestamp("info", `✏️ FILL: nodeId=${nodeId} text="${text.substring(0, 30)}..."`);
  }

  if (typeof ensureVisualizationsInjected === "function") {
    await ensureVisualizationsInjected(tabId);
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (nodeInfo, text) => {
      let element = null;

      if (nodeInfo.nodeId != null && window.__centrisNodeMap) {
        const el = window.__centrisNodeMap.get(nodeInfo.nodeId);
        if (el && el.isConnected) {
          element = el;
        }
      }
      if (!element && nodeInfo.htmlId) {
        element = document.getElementById(nodeInfo.htmlId);
      }

      if (!element) {
        return { success: false, error: "Element not found", needsSnapshot: true };
      }

      element.scrollIntoView({ behavior: "instant", block: "center" });
      element.focus();

      // Contenteditable: select all, delete, then insert
      if (element.isContentEditable) {
        const sel = window.getSelection();
        if (sel) {
          sel.selectAllChildren(element);
          sel.deleteFromDocument();
        }
        document.execCommand("insertText", false, text);
        return { success: true, filled: text, method: "contenteditable" };
      }

      // Standard form inputs
      if (element.value !== undefined) {
        element.value = text;
        element.dispatchEvent(new InputEvent("input", { data: text, bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return { success: true, filled: text, method: "value" };
      }

      return {
        success: false,
        error: "Element is not editable (no value property, not contentEditable)",
      };
    },
    args: [nodeInfo, text],
  });

  return results[0]?.result || { success: false, error: "Fill operation failed" };
}

// ═══════════════════════════════════════════════════════════════════════════════
// GENERATE PDF - Print page to PDF via chrome.debugger
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a PDF of the current page using Chrome DevTools Protocol.
 *
 * @param {number} tabId - Tab ID
 * @returns {Promise<Object>} - Result with base64 PDF data
 */
async function generatePdf(tabId) {
  if (typeof logWithTimestamp === "function") {
    logWithTimestamp("info", `📄 Generating PDF for tab ${tabId}`);
  }

  const target = { tabId };
  try {
    await chrome.debugger.attach(target, "1.3");
  } catch (e) {
    if (!e.message.includes("Already attached")) {
      return { success: false, error: `Debugger attach failed: ${e.message}` };
    }
  }

  try {
    const result = await chrome.debugger.sendCommand(target, "Page.printToPDF", {
      printBackground: true,
      preferCSSPageSize: true,
    });

    return {
      success: true,
      data: result.data,
      format: "pdf",
    };
  } catch (e) {
    return { success: false, error: `PDF generation failed: ${e.message}` };
  } finally {
    try {
      await chrome.debugger.detach(target);
    } catch (_) {}
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// UPLOAD FILE - Set files on <input type="file"> via chrome.debugger
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Upload a file to an <input type="file"> element via DevTools Protocol.
 *
 * @param {number} tabId - Tab ID
 * @param {number} nodeId - Node ID from snapshot
 * @param {string} filePath - Local filesystem path to the file
 * @returns {Promise<Object>} - Result object
 */
async function uploadFile(tabId, nodeId, filePath) {
  const nodeIdMappings = globalThis.nodeIdMappings || new Map();
  const tabMapping = nodeIdMappings.get(tabId);
  if (!tabMapping) {
    return { success: false, error: "No snapshot data for this tab", needsSnapshot: true };
  }

  const nodeInfo = tabMapping.get(nodeId);
  if (!nodeInfo) {
    return { success: false, error: `Node ID ${nodeId} not found`, needsSnapshot: true };
  }

  if (typeof logWithTimestamp === "function") {
    logWithTimestamp("info", `📎 UPLOAD: nodeId=${nodeId} file="${filePath}"`);
  }

  const target = { tabId };
  try {
    await chrome.debugger.attach(target, "1.3");
  } catch (e) {
    if (!e.message.includes("Already attached")) {
      return { success: false, error: `Debugger attach failed: ${e.message}` };
    }
  }

  try {
    await chrome.debugger.sendCommand(target, "DOM.enable", {});

    // Resolve the DOM node. Try direct selector if htmlId is available,
    // otherwise use the element's position from the snapshot.
    let backendNodeId;

    if (nodeInfo.htmlId) {
      const doc = await chrome.debugger.sendCommand(target, "DOM.getDocument", {});
      const result = await chrome.debugger.sendCommand(target, "DOM.querySelector", {
        nodeId: doc.root.nodeId,
        selector: `#${CSS.escape(nodeInfo.htmlId)}`,
      });
      if (result.nodeId) {
        const desc = await chrome.debugger.sendCommand(target, "DOM.describeNode", {
          nodeId: result.nodeId,
        });
        backendNodeId = desc.node.backendNodeId;
      }
    }

    if (!backendNodeId) {
      // Fallback: use coordinates to find the element
      if (nodeInfo.bounds) {
        const x = nodeInfo.bounds.x + nodeInfo.bounds.width / 2;
        const y = nodeInfo.bounds.y + nodeInfo.bounds.height / 2;
        const nodeAtPoint = await chrome.debugger.sendCommand(target, "DOM.getNodeForLocation", {
          x: Math.round(x),
          y: Math.round(y),
        });
        backendNodeId = nodeAtPoint.backendNodeId;
      }
    }

    if (!backendNodeId) {
      return {
        success: false,
        error: "Could not resolve element for file upload",
        needsSnapshot: true,
      };
    }

    await chrome.debugger.sendCommand(target, "DOM.setFileInputFiles", {
      files: [filePath],
      backendNodeId,
    });

    return { success: true, uploaded: filePath };
  } catch (e) {
    return { success: false, error: `File upload failed: ${e.message}` };
  } finally {
    try {
      await chrome.debugger.sendCommand(target, "DOM.disable", {});
      await chrome.debugger.detach(target);
    } catch (_) {}
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLICK BY STABLE HASH - More reliable than nodeId
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Click element by stable hash - survives DOM changes better than nodeId
 *
 * @param {number} tabId - Tab ID
 * @param {string} stableHash - Stable hash from snapshot
 * @param {number} nodeIdFallback - Fallback nodeId if hash lookup fails
 * @returns {Promise<Object>} - Result object
 */
async function clickNodeByHash(tabId, stableHash, nodeIdFallback) {
  const nodeIdMappings = globalThis.nodeIdMappings || new Map();
  const tabMapping = nodeIdMappings.get(tabId);

  if (!tabMapping) {
    return {
      success: false,
      error: "No snapshot data for this tab. Call getInteractiveSnapshot first.",
      needsSnapshot: true,
    };
  }

  // Find element by stableHash
  let nodeId = null;

  for (const [id, info] of tabMapping.entries()) {
    if (info.stableHash === stableHash) {
      nodeId = id;
      break;
    }
  }

  if (nodeId !== null) {
    if (typeof logWithTimestamp === "function") {
      logWithTimestamp("info", `✅ Found element by stableHash: ${stableHash} → nodeId ${nodeId}`);
    }
    return clickNode(tabId, nodeId);
  }

  // Hash lookup failed - try fallback
  if (nodeIdFallback !== null && nodeIdFallback !== undefined) {
    if (typeof logWithTimestamp === "function") {
      logWithTimestamp(
        "info",
        `⚠️ stableHash ${stableHash} not found, trying nodeId fallback: ${nodeIdFallback}`,
      );
    }
    return clickNode(tabId, nodeIdFallback);
  }

  return {
    success: false,
    error: `Element with stableHash "${stableHash}" not found. Page may have changed - call getInteractiveSnapshot.`,
    needsSnapshot: true,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLICK BY COORDINATES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Click at specific coordinates
 *
 * @param {number} tabId - Tab ID
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @returns {Promise<Object>} - Result object
 */
async function clickByCoordinates(tabId, x, y) {
  if (typeof logWithTimestamp === "function") {
    logWithTimestamp("info", `👆 Clicking at coordinates: (${x}, ${y})`);
  }

  if (typeof ensureVisualizationsInjected === "function") {
    await ensureVisualizationsInjected(tabId);
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (x, y) => {
      const element = document.elementFromPoint(x, y);
      if (!element) {
        return { success: false, error: "No element found at coordinates" };
      }

      // Visual feedback
      if (window.centrisShowClick) {
        window.centrisShowClick(x, y);
      }

      const beforeUrl = window.location.href;

      const eventOptions = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: x,
        clientY: y,
      };

      element.dispatchEvent(new MouseEvent("mousedown", eventOptions));
      element.dispatchEvent(new MouseEvent("mouseup", eventOptions));
      element.dispatchEvent(new MouseEvent("click", eventOptions));

      if (element.click) {
        element.click();
      }

      const afterUrl = window.location.href;

      return {
        success: true,
        element: element.tagName,
        coordinates: { x, y },
        changeDetected: beforeUrl !== afterUrl,
      };
    },
    args: [x, y],
  });

  return results[0]?.result || { success: false, error: "Coordinate click failed" };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRESS KEY - Single key press (Enter, Tab, Escape, etc.)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Press a single key
 *
 * @param {number} tabId - Tab ID
 * @param {string} key - Key to press (Enter, Tab, Escape, etc.)
 * @param {Object} modifiers - { ctrl, alt, shift, meta }
 * @returns {Promise<Object>} - Result object
 */
async function pressKey(tabId, key, modifiers = {}) {
  if (typeof logWithTimestamp === "function") {
    logWithTimestamp("info", `⌨️ Pressing key: ${key}`, modifiers);
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (key, modifiers) => {
      const { ctrl = false, alt = false, shift = false, meta = false } = modifiers;

      const keyMap = {
        enter: { key: "Enter", code: "Enter", keyCode: 13 },
        tab: { key: "Tab", code: "Tab", keyCode: 9 },
        escape: { key: "Escape", code: "Escape", keyCode: 27 },
        backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
        delete: { key: "Delete", code: "Delete", keyCode: 46 },
        arrowup: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
        arrowdown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
        arrowleft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
        arrowright: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
        space: { key: " ", code: "Space", keyCode: 32 },
        home: { key: "Home", code: "Home", keyCode: 36 },
        end: { key: "End", code: "End", keyCode: 35 },
        pageup: { key: "PageUp", code: "PageUp", keyCode: 33 },
        pagedown: { key: "PageDown", code: "PageDown", keyCode: 34 },
      };

      const keyLower = key.toLowerCase();
      const keyInfo = keyMap[keyLower] || {
        key: key,
        code: `Key${key.toUpperCase()}`,
        keyCode: key.charCodeAt(0),
      };

      const target = document.activeElement || document.body;

      const eventOptions = {
        key: keyInfo.key,
        code: keyInfo.code,
        keyCode: keyInfo.keyCode,
        which: keyInfo.keyCode,
        ctrlKey: ctrl,
        altKey: alt,
        shiftKey: shift,
        metaKey: meta,
        bubbles: true,
        cancelable: true,
      };

      target.dispatchEvent(new KeyboardEvent("keydown", eventOptions));
      target.dispatchEvent(new KeyboardEvent("keypress", eventOptions));
      target.dispatchEvent(new KeyboardEvent("keyup", eventOptions));

      return { success: true, key: key, modifiers: { ctrl, alt, shift, meta } };
    },
    args: [key, modifiers],
  });

  return results[0]?.result || { success: false, error: "Key press failed" };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

if (typeof globalThis !== "undefined") {
  globalThis.clickNode = clickNode;
  globalThis.typeText = typeText;
  globalThis.typeIntoNode = typeIntoNode;
  globalThis.hoverElement = hoverElement;
  globalThis.hoverNode = hoverNode;
  globalThis.scrollElement = scrollElement;
  globalThis.selectOption = selectOption;
  globalThis.fillNode = fillNode;
  globalThis.generatePdf = generatePdf;
  globalThis.uploadFile = uploadFile;

  // Additional interaction methods
  globalThis.pasteText = pasteText;
  globalThis.globalType = globalType;
  globalThis.clickNodeByHash = clickNodeByHash;
  globalThis.clickByCoordinates = clickByCoordinates;
  globalThis.pressKey = pressKey;
}
