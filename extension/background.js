/**
 * Centris Chrome Extension - Background Service Worker
 *
 * This is the main orchestrator that:
 * 1. Loads all modules via importScripts
 * 2. Initializes communication with backend
 * 3. Routes incoming messages to appropriate handlers
 *
 * Architecture:
 * - Modules are loaded globally via importScripts (service worker pattern)
 * - Each module exports functions to globalThis
 * - This file wires everything together and handles the message router
 */

// FEB 2026 VERSION MARKER - If you don't see this log, you're running cached old code!
console.log("🔥 BACKGROUND.JS v6 - Zero-wait navigate 🔥");

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE LOADING
// ═══════════════════════════════════════════════════════════════════════════════

// Initialize shared globals BEFORE loading modules
// This prevents "not defined" errors when modules reference each other
globalThis.nodeIdMappings = globalThis.nodeIdMappings || new Map();
globalThis.visionStreamingActive = globalThis.visionStreamingActive || false;
globalThis.cachedSnapshots = globalThis.cachedSnapshots || new Map();

// Load all modules in dependency order
try {
  importScripts(
    // Core utilities (no dependencies)
    "modules/utils.js",
    "modules/config.js",
    "modules/logging.js",
    "modules/errors.js",

    // Communication (depends on config, logging)
    "modules/native_messaging.js",
    "modules/websocket.js",
    "modules/connection_manager.js",

    // Element management (depends on utils)
    "modules/element_cache.js",

    // DOM interaction (depends on element_cache, logging)
    "modules/visuals.js",
    "modules/interactions.js",
    "modules/wait_strategies.js",
    "modules/dialogs.js",

    // High-level features (depends on element_cache, interactions)
    "modules/snapshot.js",
    "modules/element_finder.js",
    "modules/reading_mode.js",

    // Existing extracted modules
    "tab_context.js",
    "cross_tab_sync.js",
    "request_manager.js",
  );

  console.log("[Centris] All modules loaded successfully");
} catch (e) {
  console.error("[Centris] Failed to load modules:", e);
}

// ═══════════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════════

// Initialize on service worker start
async function initialize() {
  logWithTimestamp("info", "🚀 Centris Extension starting...");

  // Initialize communication with backend
  await initializeCommunication();

  // Set up message callback
  setMessageCallback(handleDesktopAppMessage);

  // Start local backend monitor with debounce to prevent spam
  // (connection_manager.js already handles keep-alive and reconnection)
  if (typeof startLocalBackendMonitor === "function") {
    let lastReconnectTime = 0;
    startLocalBackendMonitor(() => {
      const now = Date.now();
      if (now - lastReconnectTime < 5000) {
        logWithTimestamp("debug", "🔄 Skipping reconnect (debounced)");
        return;
      }
      lastReconnectTime = now;
      logWithTimestamp("info", "🔄 Local backend available - forcing reconnection");
      forceReconnect();
    });
  }

  // Initialize tab context manager if available
  if (typeof tabContextManager !== "undefined" && tabContextManager.init) {
    tabContextManager.init();
  }

  // Initialize cross-tab sync if available
  if (typeof crossTabSync !== "undefined" && crossTabSync.init) {
    crossTabSync.init();
  }

  logWithTimestamp("info", "✅ Centris Extension initialized");
}

// Run initialization
initialize().catch((e) => {
  console.error("[Centris] Initialization failed:", e);
});

// Keep-alive mechanism to prevent service worker from going dormant
// MV3 service workers can be suspended after 30s of inactivity
setInterval(() => {
  chrome.runtime.getPlatformInfo(() => {
    // This keeps the service worker alive
  });

  // FEB 2026 FIX: Use isWebSocketBusy() to prevent connection spam
  // Only reconnect if truly disconnected (not CONNECTING, not OPEN)
  if (typeof isWebSocketBusy === "function" && typeof connectWebSocket === "function") {
    if (!isWebSocketBusy()) {
      // Only log when actually reconnecting (state changed)
      logWithTimestamp("info", "🔄 Keep-alive: WebSocket idle, initiating connection");
      connectWebSocket();
    }
    // Don't log when connected - too noisy
  }
}, 25000); // Every 25 seconds (before the 30s dormancy threshold)

// Also try to connect immediately when service worker starts
// This handles the case where backend restarted while we were dormant
setTimeout(() => {
  // FEB 2026 FIX: Use isWebSocketBusy() to prevent duplicate connections
  if (typeof isWebSocketBusy === "function" && typeof connectWebSocket === "function") {
    if (!isWebSocketBusy()) {
      logWithTimestamp("info", "🔌 Initial connection check - connecting to backend");
      connectWebSocket();
    }
  }
}, 1000);

// ═══════════════════════════════════════════════════════════════════════════════
// MESSAGE HANDLER - Routes commands from backend to appropriate modules
// ═══════════════════════════════════════════════════════════════════════════════

async function handleDesktopAppMessage(message) {
  const { type, id, data } = message;

  // Protocol messages from the gateway — not commands, don't process
  if (type === "handshake_ack" || type === "pong") {
    return;
  }

  const startTime = Date.now();

  // For navigate commands, ensure URL is found (check standard + backup locations)
  let effectiveData = data;
  if (type === "navigate" || type === "navigate_browser") {
    const foundUrl =
      data?.url || message.url || message.navigate_url || data?.data?.url || message.args?.url;
    if (foundUrl) {
      effectiveData = { ...data, url: foundUrl };
    }
  }

  console.log(`[Centris] 📥 ${type} (id: ${id})`);

  let result;

  try {
    switch (type) {
      // ═══════════════════════════════════════════════════════════════════════
      // NAVIGATION & TAB MANAGEMENT
      // ═══════════════════════════════════════════════════════════════════════
      case "navigate":
      case "navigate_browser":
        result = await handleNavigate(effectiveData);
        break;

      case "get_tabs":
      case "list_tabs":
        result = await handleGetTabs();
        break;

      case "switch_tab":
        result = await handleSwitchTab(data);
        break;

      case "close_tab":
        result = await handleCloseTab(data);
        break;

      case "new_tab":
        result = await handleNewTab(data);
        break;

      // ═══════════════════════════════════════════════════════════════════════
      // SNAPSHOT & ELEMENT FINDING
      // ═══════════════════════════════════════════════════════════════════════
      case "get_interactive_snapshot":
      case "snapshot":
        result = await handleSnapshot(data);
        break;

      case "take_screenshot":
      case "screenshot":
        result = await handleScreenshot(data);
        break;

      // ═══════════════════════════════════════════════════════════════════════
      // CLICK OPERATIONS
      // ═══════════════════════════════════════════════════════════════════════
      case "click":
      case "click_node":
        result = await handleClick(data);
        break;

      case "smart_click":
        result = await handleSmartClick(data);
        break;

      case "click_by_coordinates":
        result = await handleClickByCoordinates(data);
        break;

      case "click_node_by_hash":
        result = await handleClickNodeByHash(data);
        break;

      case "click_element":
        result = await handleClickElement(data);
        break;

      // ═══════════════════════════════════════════════════════════════════════
      // TYPE OPERATIONS
      // ═══════════════════════════════════════════════════════════════════════
      case "type":
      case "type_text":
      case "type_into_node":
        result = await handleType(data);
        break;

      case "global_type":
        result = await handleGlobalType(data);
        break;

      // ═══════════════════════════════════════════════════════════════════════
      // WAIT OPERATIONS
      // ═══════════════════════════════════════════════════════════════════════
      case "wait_for_dom_stable":
        result = await handleWaitForDomStable(data);
        break;

      case "wait_for_text":
        result = await handleWaitForText(data);
        break;

      case "wait_for_text_gone":
        result = await handleWaitForTextGone(data);
        break;

      case "wait_for_element":
        result = await handleWaitForElement(data);
        break;

      case "wait_for_navigation":
        result = await handleWaitForNavigation(data);
        break;

      // ═══════════════════════════════════════════════════════════════════════
      // OTHER INTERACTIONS
      // ═══════════════════════════════════════════════════════════════════════
      case "hover":
        result = await handleHover(data);
        break;

      case "scroll":
        result = await handleScroll(data);
        break;

      // ═══════════════════════════════════════════════════════════════════════
      // READING MODE
      // ═══════════════════════════════════════════════════════════════════════
      case "get_readable_content":
      case "read_page":
        result = await handleReadPage(data);
        break;

      case "get_selected_text":
        result = await handleGetSelectedText(data);
        break;

      case "get_page_info":
        result = await handleGetPageInfo(data);
        break;

      // ═══════════════════════════════════════════════════════════════════════
      // DIALOGS
      // ═══════════════════════════════════════════════════════════════════════
      case "handle_dialog":
        result = await handleDialogCommand(data);
        break;

      case "arm_dialog":
        result = await handleArmDialog(data);
        break;

      case "disarm_dialog":
        result = await handleDisarmDialog(data);
        break;

      // ═══════════════════════════════════════════════════════════════════════
      // KEYBOARD OPERATIONS
      // ═══════════════════════════════════════════════════════════════════════
      case "press_key":
        result = await handlePressKey(data);
        break;

      case "paste":
      case "paste_text":
        result = await handlePaste(data);
        break;

      // ═══════════════════════════════════════════════════════════════════════
      // SMART OPERATIONS (LLM-free)
      // ═══════════════════════════════════════════════════════════════════════
      case "find_element":
      case "find_by_text":
        result = await handleFindElement(data);
        break;

      case "smart_type":
        result = await handleSmartType(data);
        break;

      // ═══════════════════════════════════════════════════════════════════════
      // VISUALIZATION
      // ═══════════════════════════════════════════════════════════════════════
      case "show_highlights":
        result = await handleShowHighlights(data);
        break;

      case "clear_visuals":
        result = await handleClearVisuals(data);
        break;

      // ═══════════════════════════════════════════════════════════════════════
      // STATUS
      // ═══════════════════════════════════════════════════════════════════════
      case "ping":
        result = { success: true, pong: true, timestamp: Date.now() };
        break;

      case "ack":
      case "handshake_ack":
        // These are acknowledgments from backend, not commands
        // Just acknowledge receipt silently
        result = { success: true, acknowledged: true };
        break;

      case "get_status":
        result = { success: true, status: getConnectionStatus() };
        break;

      case "wait_for_condition":
        result = await handleWaitForCondition(data);
        break;

      case "wait_for_url":
        result = await handleWaitForUrl(data);
        break;

      case "wait_for_network_idle":
        result = await handleWaitForNetworkIdle(data);
        break;

      // ═══════════════════════════════════════════════════════════════════════
      // HOVER OPERATIONS
      // ═══════════════════════════════════════════════════════════════════════
      case "hover_node":
        result = await handleHoverNode(data);
        break;

      case "hover_element":
        result = await handleHover(data);
        break;

      // ═══════════════════════════════════════════════════════════════════════
      // SCREENSHOTS
      // ═══════════════════════════════════════════════════════════════════════
      case "take_full_page_screenshot":
        result = await handleFullPageScreenshot(data);
        break;

      case "take_element_screenshot":
        result = await handleElementScreenshot(data);
        break;

      // ═══════════════════════════════════════════════════════════════════════
      // CHECK DIALOG
      // ═══════════════════════════════════════════════════════════════════════
      case "check_dialog_triggered":
        result = await handleCheckDialogTriggered(data);
        break;

      // ═══════════════════════════════════════════════════════════════════════
      // LLM-FREE ELEMENT OPERATIONS
      // ═══════════════════════════════════════════════════════════════════════
      case "click_element_by_text":
        result = await handleClickElementByText(data);
        break;

      case "input_text_by_pattern":
        result = await handleInputTextByPattern(data);
        break;

      case "get_node_info":
        result = await handleGetNodeInfo(data);
        break;

      // ═══════════════════════════════════════════════════════════════════════
      // TAB OPERATIONS
      // ═══════════════════════════════════════════════════════════════════════
      case "navigate_and_wait":
        result = await handleNavigateAndWait(data);
        break;

      case "get_active_tab":
        result = await handleGetActiveTab();
        break;

      case "get_all_tabs":
        result = await handleGetTabs();
        break;

      case "get_all_windows":
        result = await handleGetAllWindows();
        break;

      case "monitor_tab_changes":
        result = await handleMonitorTabChanges(data);
        break;

      // ═══════════════════════════════════════════════════════════════════════
      // COMBINED WAIT + SNAPSHOT (single round-trip)
      // ═══════════════════════════════════════════════════════════════════════
      case "wait_stable_and_snapshot":
        result = await handleWaitStableAndSnapshot(data);
        break;

      // ═══════════════════════════════════════════════════════════════════════
      // BATCH OPERATIONS
      // ═══════════════════════════════════════════════════════════════════════
      case "batch":
        result = await handleBatchCommands(data);
        break;

      // ═══════════════════════════════════════════════════════════════════════
      // READING MODE INDICATORS
      // ═══════════════════════════════════════════════════════════════════════
      case "show_reading_indicator":
        result = await handleShowReadingIndicator(data);
        break;

      case "hide_reading_indicator":
        result = await handleHideReadingIndicator(data);
        break;

      case "update_reading_progress":
        result = await handleUpdateReadingProgress(data);
        break;

      // ═══════════════════════════════════════════════════════════════════════
      // CONTEXT & MEMORY
      // ═══════════════════════════════════════════════════════════════════════
      case "get_tab_context":
        result = await handleGetTabContext(data);
        break;

      case "get_active_tab_context":
        result = await handleGetActiveTabContext(data);
        break;

      case "store_memory":
        result = await handleStoreMemory(data);
        break;

      case "get_memories":
        result = await handleGetMemories(data);
        break;

      // ═══════════════════════════════════════════════════════════════════════
      // EXECUTE JAVASCRIPT
      // ═══════════════════════════════════════════════════════════════════════
      case "execute_javascript":
        result = await handleExecuteJavaScript(data);
        break;

      case "get_page_content":
        // FEB 2026 FIX: handleGetPageContent was never defined, causing ReferenceError.
        // Route to handleReadPage which calls our rewritten getReadableContent()
        // (innerText-first strategy that works on SPAs like Gmail).
        result = await handleReadPage(data);
        break;

      case "get_accessibility_tree":
        result = await handleGetAccessibilityTree(data);
        break;

      case "get_interactive_elements":
        result = await handleGetInteractiveElements(data);
        break;

      // ═══════════════════════════════════════════════════════════════════════
      // INPUT OPERATIONS
      // ═══════════════════════════════════════════════════════════════════════
      case "input_text_node":
        result = await handleInputTextNode(data);
        break;

      case "type_into_focused":
        result = await handleTypeIntoFocused(data);
        break;

      case "simulate_keyboard":
        result = await handleSimulateKeyboard(data);
        break;

      case "find_best_input":
        result = await handleFindBestInput(data);
        break;

      // ═══════════════════════════════════════════════════════════════════════
      // UNKNOWN COMMAND
      // ═══════════════════════════════════════════════════════════════════════
      default:
        result = { success: false, error: `Unknown command type: ${type}` };
    }
  } catch (error) {
    result = withAIFriendlyError(
      {
        success: false,
        error: error.message,
        stack: error.stack,
      },
      type,
    );
  }

  // Add timing info
  const duration = Date.now() - startTime;
  result.duration_ms = duration;

  // Send response back to backend
  if (id) {
    console.log(
      `[Centris] 📤 SENDING RESPONSE: ${type} (id: ${id}, success: ${result.success}, duration: ${duration}ms)`,
    );
    logWithTimestamp("info", `📤 SENDING RESPONSE: ${type}`, {
      id,
      success: result.success,
      duration,
    });
    sendToBackend({
      type: "response",
      id: id,
      success: result.success,
      data: result,
    });
  } else {
    console.warn(`[Centris] ⚠️ No ID for command ${type} - response not sent`);
  }

  logWithTimestamp("info", `✅ Command ${type} completed in ${duration}ms`, {
    success: result.success,
  });

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMMAND HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

async function handleNavigate(data) {
  // Extract URL from data (check standard + nested locations)
  const url = data?.url || (typeof data === "string" ? data : null) || data?.data?.url;
  const tabId = data?.tabId || data?.data?.tabId;

  if (!url) {
    return { success: false, error: "URL is required for navigation" };
  }
  const isBlankUrl = (u) =>
    !u ||
    u.startsWith("chrome://newtab") ||
    u.startsWith("chrome://new-tab-page") ||
    u.startsWith("about:blank") ||
    u.startsWith("about:newtab") ||
    u === "";

  let resultTabId = null;

  try {
    // 1. Use explicit tabId if provided
    if (tabId && typeof tabId === "number") {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab) {
          await chrome.tabs.update(tabId, { url });
          resultTabId = tabId;
        }
      } catch (_) {
        /* tab gone */
      }
    }

    // 2. Navigate in a blank tab if one is active
    if (!resultTabId) {
      try {
        let tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (!tabs.length) {
          tabs = await chrome.tabs.query({ active: true });
        }
        for (const tab of tabs) {
          if (isBlankUrl(tab.url)) {
            await chrome.tabs.update(tab.id, { url });
            resultTabId = tab.id;
            break;
          }
        }
      } catch (_) {}
    }

    // 2.5. Reuse existing tab at same origin (prevents duplicate tabs on retry)
    if (!resultTabId) {
      try {
        const targetOrigin = new URL(url).origin;
        for (const tab of await chrome.tabs.query({})) {
          try {
            if (tab.url && new URL(tab.url).origin === targetOrigin) {
              if (tab.url === url || tab.url.startsWith(url)) {
                await chrome.tabs.update(tab.id, { active: true });
              } else {
                await chrome.tabs.update(tab.id, { url, active: true });
              }
              resultTabId = tab.id;
              break;
            }
          } catch (_) {}
        }
      } catch (_) {}
    }

    // 3. Create new tab in existing window
    if (!resultTabId) {
      try {
        const windows = await chrome.windows.getAll({ populate: false, windowTypes: ["normal"] });
        if (windows.length > 0) {
          const win = windows.find((w) => w.focused) || windows[0];
          const newTab = await chrome.tabs.create({ url, active: true, windowId: win.id });
          resultTabId = newTab.id;
        }
      } catch (_) {}
    }

    // 4. Create new window (last resort)
    if (!resultTabId) {
      try {
        const newWindow = await chrome.windows.create({ url, focused: true });
        if (newWindow?.tabs?.length) {
          resultTabId = newWindow.tabs[0].id;
        }
      } catch (_) {}
    }

    if (!resultTabId) {
      return { success: false, error: "Could not create tab or find window" };
    }
  } catch (e) {
    return { success: false, error: `Chrome API failed: ${e.message}` };
  }

  // Wait just long enough for Chrome to start navigation (URL changes from chrome://newtab/).
  // Without this, chrome.tabs.get() returns the old blank URL and the backend's
  // post-navigate snapshot fails on the protected chrome:// page.
  // Max 500ms in 50ms steps -- fast enough to not blow the 3s backend timeout.
  let finalTab;
  const pollStart = Date.now();
  while (Date.now() - pollStart < 500) {
    try {
      finalTab = await chrome.tabs.get(resultTabId);
    } catch (e) {
      return { success: false, error: `Navigation failed: tab ${resultTabId} not found` };
    }
    if (!isBlankUrl(finalTab.url)) {
      break;
    } // URL changed -- good to go
    await new Promise((r) => setTimeout(r, 50));
  }
  // If still blank after 500ms, use the requested URL so the backend doesn't see chrome://newtab/
  const reportedUrl = isBlankUrl(finalTab?.url) ? url : finalTab.url;

  return {
    success: true,
    requestedUrl: url,
    url: reportedUrl,
    navigated: url,
    tabId: resultTabId,
    loadTime: Date.now() - pollStart,
  };
}

async function handleGetTabs() {
  const tabs = await chrome.tabs.query({});
  return {
    success: true,
    tabs: tabs.map((t) => ({
      id: t.id,
      url: t.url,
      title: t.title,
      active: t.active,
    })),
  };
}

async function handleSwitchTab(data) {
  const { tabId } = data || {};
  if (!tabId) {
    return { success: false, error: "tabId is required" };
  }

  await chrome.tabs.update(tabId, { active: true });
  return { success: true, activated: tabId };
}

async function handleCloseTab(data) {
  const { tabId } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  await chrome.tabs.remove(validation.tabId);
  return { success: true, closed: validation.tabId };
}

async function handleNewTab(data) {
  const { url } = data || {};
  const tab = await chrome.tabs.create({ url: url || "about:blank" });
  return { success: true, tabId: tab.id, url: tab.url };
}

async function handleSnapshot(data) {
  const { tabId, options, instruction, maxChars } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  // Merge top-level fields into options (the gateway sends instruction/maxChars
  // at the data root, not inside an options object)
  const mergedOptions = {
    ...options,
    instruction: instruction || options?.instruction || "",
    maxChars: maxChars || options?.maxChars || 4000, // 4K default (~1K tokens)
  };

  return await getInteractiveSnapshot(validation.tabId, mergedOptions);
}

async function handleScreenshot(data) {
  const { tabId } = data || {};
  return await takeScreenshot(tabId);
}

async function handleClick(data) {
  const { tabId, nodeId, selector } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  if (nodeId) {
    return await clickNode(validation.tabId, nodeId);
  } else if (selector) {
    return await handleClickElement({ tabId: validation.tabId, selector });
  }

  return { success: false, error: "nodeId or selector is required" };
}

async function handleSmartClick(data) {
  const { tabId, text, role, ariaLabel } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  return await smartClick(validation.tabId, { text, role, ariaLabel });
}

async function handleClickByCoordinates(data) {
  const { tabId, x, y } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  if (x === undefined || y === undefined) {
    return { success: false, error: "x and y coordinates are required" };
  }

  return await clickByCoordinates(validation.tabId, x, y);
}

async function handleClickNodeByHash(data) {
  const { tabId, stableHash, nodeId } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  if (!stableHash) {
    return { success: false, error: "stableHash is required" };
  }

  // Use the clickNodeByHash function from interactions.js
  // It first tries hash lookup, then falls back to nodeId if provided
  return await clickNodeByHash(validation.tabId, stableHash, nodeId);
}

async function handleClickElement(data) {
  const { tabId, selector } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  if (!selector) {
    return { success: false, error: "selector is required" };
  }

  // Click element by CSS selector
  if (typeof ensureVisualizationsInjected === "function") {
    await ensureVisualizationsInjected(validation.tabId);
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId: validation.tabId },
    world: "MAIN",
    func: (selector) => {
      try {
        const el = document.querySelector(selector);
        if (!el) {
          return { success: false, error: `No element found for selector: ${selector}` };
        }

        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
          return { success: false, error: "Element has no visible size" };
        }

        // Visual feedback
        if (window.centrisHighlightElement) {
          window.centrisHighlightElement(rect.left, rect.top, rect.width, rect.height);
        }
        if (window.centrisShowClick) {
          window.centrisShowClick(rect.left + rect.width / 2, rect.top + rect.height / 2);
        }

        el.scrollIntoView({ behavior: "instant", block: "center" });
        el.click();

        return { success: true, clicked: true, method: "selector" };
      } catch (e) {
        return { success: false, error: e.message };
      }
    },
    args: [selector],
  });

  return results[0]?.result || { success: false, error: "Click by selector failed" };
}

async function handleType(data) {
  const { tabId, nodeId, text, selector } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  if (!text) {
    return { success: false, error: "text is required" };
  }

  if (nodeId) {
    return await typeIntoNode(validation.tabId, nodeId, text);
  } else if (selector) {
    return await typeText(validation.tabId, selector, text);
  }

  return { success: false, error: "nodeId or selector is required" };
}

async function handleGlobalType(data) {
  const { tabId, text } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  if (!text) {
    return { success: false, error: "text is required" };
  }

  // Type into currently focused element
  const results = await chrome.scripting.executeScript({
    target: { tabId: validation.tabId },
    func: (text) => {
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) {
        if (el.value !== undefined) {
          el.value = text;
        } else {
          el.textContent = text;
        }
        el.dispatchEvent(new InputEvent("input", { data: text, bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { success: true, typed: text };
      }
      return { success: false, error: "No focused input element" };
    },
    args: [text],
  });

  return results[0]?.result || { success: false, error: "Global type failed" };
}

async function handleWaitForDomStable(data) {
  const { tabId, stableMs, timeoutMs } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  return await waitForDomStable(validation.tabId, stableMs || 500, timeoutMs || 5000);
}

async function handleWaitForText(data) {
  const { tabId, text, timeoutMs } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  if (!text) {
    return { success: false, error: "text is required" };
  }

  return await waitForText(validation.tabId, text, timeoutMs || 10000);
}

async function handleWaitForTextGone(data) {
  const { tabId, text, timeoutMs } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  if (!text) {
    return { success: false, error: "text is required" };
  }

  return await waitForTextGone(validation.tabId, text, timeoutMs || 10000);
}

async function handleWaitForElement(data) {
  const { tabId, selector, timeoutMs } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  if (!selector) {
    return { success: false, error: "selector is required" };
  }

  return await waitForElement(validation.tabId, selector, timeoutMs || 10000);
}

async function handleWaitForNavigation(data) {
  const { tabId, timeoutMs } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  return await waitForNavigation(validation.tabId, timeoutMs || 10000);
}

async function handleHover(data) {
  const { tabId, selector } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  if (!selector) {
    return { success: false, error: "selector is required" };
  }

  return await hoverElement(validation.tabId, selector);
}

async function handleScroll(data) {
  const { tabId, direction, amount, selector } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  return await scrollElement(validation.tabId, { direction, amount, selector });
}

async function handleReadPage(data) {
  const { tabId, maxLength } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  return await getReadableContent(validation.tabId, { maxLength });
}

async function handleGetSelectedText(data) {
  const { tabId } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  return await getSelectedText(validation.tabId);
}

async function handleGetPageInfo(data) {
  const { tabId } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  return await getPageInfo(validation.tabId);
}

async function handleDialogCommand(data) {
  const { tabId, accept, promptText } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  return await handleDialog(validation.tabId, accept !== false, promptText || "");
}

async function handleArmDialog(data) {
  const { tabId, accept, promptText, timeoutMs } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  return await armDialog(validation.tabId, accept !== false, promptText || "", timeoutMs || 30000);
}

async function handleDisarmDialog(data) {
  const { tabId } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  return await disarmDialog(validation.tabId);
}

async function handlePressKey(data) {
  const { tabId, key, modifiers } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  if (!key) {
    return { success: false, error: "key is required" };
  }

  return await pressKey(validation.tabId, key, modifiers || {});
}

async function handlePaste(data) {
  const { tabId, text } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  if (!text) {
    return { success: false, error: "text is required" };
  }

  return await pasteText(validation.tabId, text);
}

async function handleFindElement(data) {
  const { tabId, text, options } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  if (!text) {
    return { success: false, error: "text pattern is required" };
  }

  return await findElementByText(validation.tabId, text, options || {});
}

async function handleSmartType(data) {
  const { tabId, text, description, options } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  if (!text) {
    return { success: false, error: "text is required" };
  }

  return await smartType(validation.tabId, text, description || "", options || {});
}

async function handleShowHighlights(data) {
  const { tabId, nodes, showLabels, persistent } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  return await showNodeHighlights(
    validation.tabId,
    nodes || [],
    showLabels !== false,
    persistent !== false,
  );
}

async function handleClearVisuals(data) {
  const { tabId } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  return await clearVisuals(validation.tabId);
}

async function handleWaitForCondition(data) {
  const { tabId, condition, value, timeoutMs } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  if (!condition) {
    return { success: false, error: "condition is required" };
  }
  if (!value) {
    return { success: false, error: "value is required" };
  }

  return await waitForCondition(validation.tabId, condition, value, timeoutMs || 5000);
}

async function handleWaitForUrl(data) {
  const { tabId, urlPattern, timeoutMs } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  if (!urlPattern) {
    return { success: false, error: "urlPattern is required" };
  }

  return await waitForCondition(validation.tabId, "url_contains", urlPattern, timeoutMs || 15000);
}

async function handleWaitForNetworkIdle(data) {
  const { tabId, idleMs, timeoutMs } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  // Network idle is implemented as DOM stable for now
  return await waitForDomStable(validation.tabId, idleMs || 500, timeoutMs || 15000);
}

async function handleHoverNode(data) {
  const { tabId, nodeId } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  if (!nodeId) {
    return { success: false, error: "nodeId is required" };
  }

  return await hoverNode(validation.tabId, nodeId);
}

async function handleFullPageScreenshot(data) {
  const { tabId } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  return await takeFullPageScreenshot(validation.tabId);
}

async function handleElementScreenshot(data) {
  const { tabId, selector } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  if (!selector) {
    return { success: false, error: "selector is required" };
  }

  return await takeElementScreenshot(validation.tabId, selector);
}

async function handleCheckDialogTriggered(data) {
  const { tabId } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  return await checkDialogTriggered(validation.tabId);
}

async function handleClickElementByText(data) {
  const { tabId, textPattern, options } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  if (!textPattern) {
    return { success: false, error: "textPattern is required" };
  }

  return await clickElementByText(validation.tabId, textPattern, options || {});
}

async function handleInputTextByPattern(data) {
  const { tabId, textPattern, text, options } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  if (!textPattern) {
    return { success: false, error: "textPattern is required" };
  }
  if (!text) {
    return { success: false, error: "text is required" };
  }

  return await inputTextByPattern(validation.tabId, textPattern, text, options || {});
}

async function handleGetNodeInfo(data) {
  const { tabId, nodeId } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  if (!nodeId) {
    return { success: false, error: "nodeId is required" };
  }

  return await getNodeInfo(validation.tabId, nodeId);
}

async function handleNavigateAndWait(data) {
  const { url, tabId, timeout } = data || {};
  if (!url) {
    return { success: false, error: "URL is required" };
  }

  const validation = await validateTab(tabId);
  const targetTabId = validation.success ? validation.tabId : null;

  if (targetTabId) {
    await chrome.tabs.update(targetTabId, { url });
    const loadResult = await waitForPageLoad(targetTabId, timeout || 10000);
    return { success: true, tabId: targetTabId, ...loadResult };
  } else {
    const newTab = await chrome.tabs.create({ url });
    const loadResult = await waitForPageLoad(newTab.id, timeout || 10000);
    return { success: true, tabId: newTab.id, ...loadResult };
  }
}

async function handleGetActiveTab() {
  try {
    // FEB 2026 FIX: Use lastFocusedWindow instead of currentWindow for service workers
    // Service workers don't have a "current window" concept, so currentWindow can fail
    let [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab) {
      return { success: true, id: tab.id, url: tab.url, title: tab.title };
    }

    // Fallback: try currentWindow (for compatibility)
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      return { success: true, id: tab.id, url: tab.url, title: tab.title };
    }

    // Last resort: get ANY active tab
    const allTabs = await chrome.tabs.query({ active: true });
    if (allTabs.length > 0) {
      const activeTab = allTabs[0];
      return { success: true, id: activeTab.id, url: activeTab.url, title: activeTab.title };
    }

    return { success: false, error: "No active tab found" };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function handleGetAllWindows() {
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    return {
      success: true,
      windows: windows.map((w) => ({
        id: w.id,
        focused: w.focused,
        tabs: w.tabs.map((t) => ({ id: t.id, url: t.url, title: t.title, active: t.active })),
      })),
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function handleMonitorTabChanges(data) {
  const { tabId } = data || {};
  return { success: true, monitoring: true, tabId };
}

async function handleWaitStableAndSnapshot(data) {
  const { tabId, stableMs, timeoutMs, instruction, maxChars, includeContent } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) return validation;

  // MutationObserver-based wait instead of hardcoded sleep
  await waitForDomStable(validation.tabId, stableMs || 200, timeoutMs || 3000);

  const mergedOptions = {
    instruction: instruction || "",
    maxChars: maxChars || 4000,
  };
  const snapshot = await getInteractiveSnapshot(validation.tabId, mergedOptions);

  if (includeContent) {
    try {
      const readable = await getReadableContent(validation.tabId, {});
      const content = readable?.content || readable?.text;
      if (typeof content === "string") {
        snapshot.pageContent =
          content.length > 3000 ? content.slice(0, 3000) + "\n...[truncated]" : content;
      }
    } catch {
      /* readable content is non-fatal */
    }
  }

  return snapshot;
}

async function handleBatchCommands(data) {
  const { commands, stopOnFailure } = data || {};
  if (!commands || !Array.isArray(commands)) {
    return { success: false, error: "commands array is required" };
  }

  const results = [];
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    // Strip id to suppress per-command responses; batch returns all results at once
    const result = await handleDesktopAppMessage({ type: cmd.type, data: cmd.data || {} });
    results.push(result);
    if (result.success === false && stopOnFailure !== false) {
      return { success: false, results, failedAt: i, error: result.error };
    }
  }

  return { success: true, results, count: results.length };
}

async function handleShowReadingIndicator(data) {
  const { tabId, title, progress } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  // TODO: Implement reading indicator
  return { success: true, shown: true };
}

async function handleHideReadingIndicator(data) {
  const { tabId } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  return { success: true, hidden: true };
}

async function handleUpdateReadingProgress(data) {
  const { tabId, progress } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  return { success: true, progress };
}

async function handleGetTabContext(data) {
  const { tabId } = data || {};
  if (typeof tabContextManager !== "undefined") {
    return await tabContextManager.getUnifiedContext();
  }
  return { success: false, error: "TabContextManager not initialized" };
}

async function handleGetActiveTabContext(data) {
  if (typeof tabContextManager !== "undefined") {
    return await tabContextManager.getActiveTabContext();
  }
  return { success: false, error: "TabContextManager not initialized" };
}

async function handleStoreMemory(data) {
  const { entry } = data || {};
  if (typeof crossTabSync !== "undefined") {
    const memoryId = await crossTabSync.storeMemory(entry);
    return { success: true, memoryId };
  }
  return { success: false, error: "CrossTabSync not initialized" };
}

async function handleGetMemories(data) {
  const { limit, type } = data || {};
  if (typeof crossTabSync !== "undefined") {
    const memories = await crossTabSync.getRecentMemories(limit || 10, type || null);
    return { success: true, memories };
  }
  return { success: false, error: "CrossTabSync not initialized" };
}

async function handleExecuteJavaScript(data) {
  const { tabId, code } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  if (!code) {
    return { success: false, error: "code is required" };
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: validation.tabId },
      func: (code) => {
        try {
          return eval(code);
        } catch (e) {
          return { error: e.message };
        }
      },
      args: [code],
    });
    return { success: true, result: results[0]?.result };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function handleGetPageContent(data) {
  const { tabId } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  return await getReadableContent(validation.tabId);
}

async function handleGetAccessibilityTree(data) {
  const { tabId } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  return await getAccessibilityTree(validation.tabId);
}

async function handleGetInteractiveElements(data) {
  const { tabId } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  return await getInteractiveElements(validation.tabId);
}

async function handleInputTextNode(data) {
  const { tabId, nodeId, text } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  if (!nodeId) {
    return { success: false, error: "nodeId is required" };
  }
  if (!text) {
    return { success: false, error: "text is required" };
  }

  return await inputTextNode(validation.tabId, nodeId, text);
}

async function handleTypeIntoFocused(data) {
  const { tabId, text } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  if (!text) {
    return { success: false, error: "text is required" };
  }

  return await typeIntoFocused(validation.tabId, text);
}

async function handleSimulateKeyboard(data) {
  const { tabId, text, options } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  if (!text) {
    return { success: false, error: "text is required" };
  }

  return await simulateKeyboard(validation.tabId, text, options || {});
}

async function handleFindBestInput(data) {
  const { tabId, purpose } = data || {};
  const validation = await validateTab(tabId);
  if (!validation.success) {
    return validation;
  }

  return await findBestInput(validation.tabId, purpose || "search");
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHROME EXTENSION MESSAGE LISTENER
// For messages from content scripts and popup
// ═══════════════════════════════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type } = message;

  // Handle async responses
  (async () => {
    let response;

    switch (type) {
      case "get_status":
      case "check_status": // popup.js uses check_status
        response = { success: true, status: getConnectionStatus(), connected: isConnected() };
        break;

      case "ping":
        response = { success: true, pong: true };
        break;

      case "reconnect":
        // Clear stale overrides, ensure auth token is set, then reconnect fresh
        try {
          await new Promise((resolve) => {
            chrome.storage.sync.remove(["backend_url"], resolve);
          });
          await new Promise((resolve) => {
            chrome.storage.sync.get(["extension_token"], (result) => {
              if (
                !result.extension_token &&
                typeof CONFIG !== "undefined" &&
                CONFIG.DEFAULT_EXTENSION_TOKEN
              ) {
                chrome.storage.sync.set(
                  { extension_token: CONFIG.DEFAULT_EXTENSION_TOKEN },
                  resolve,
                );
              } else {
                resolve();
              }
            });
          });
        } catch (e) {
          // Storage errors non-fatal — proceed with reconnect
        }
        if (typeof CONFIG !== "undefined" && CONFIG.clearCache) {
          CONFIG.clearCache();
        }
        forceReconnect();
        response = { success: true, message: "Reconnection initiated" };
        break;

      case "get_elements":
        if (sender.tab?.id) {
          response = await getInteractiveSnapshot(sender.tab.id);
        } else {
          response = { success: false, error: "No tab context" };
        }
        break;

      case "popup_get_snapshot":
        // Handle popup requesting snapshot for a specific tab
        // FEB 2026 FIX: Use UNLIMITED snapshot for popup so user sees ALL elements
        // This is for debugging - shows exactly what's available on the page
        if (message.tabId) {
          response = await getInteractiveSnapshotUnlimited(message.tabId);
        } else {
          response = { success: false, error: "No tabId provided" };
        }
        break;

      case "centris_dom_changed": {
        const tabId = sender.tab?.id || message.tabId;
        const url = message.url || sender.tab?.url;
        sendToBackend({
          type: "dom_changed",
          id: message.id || `dom_${Date.now()}`,
          tabId,
          url,
          addedNodes: message.addedNodes,
          removedNodes: message.removedNodes,
          timestamp: message.timestamp || Date.now(),
        });
        response = { success: true };
        break;
      }

      case "centris_spa_navigation": {
        const tabId = sender.tab?.id || message.tabId;
        const url = message.url || sender.tab?.url;
        sendToBackend({
          type: "spa_navigation",
          id: message.id || `spa_${Date.now()}`,
          tabId,
          url,
          navigationMethod: message.navigationMethod,
          timestamp: message.timestamp || Date.now(),
        });
        response = { success: true };
        break;
      }

      default:
        // Forward to main message handler if it looks like a command
        if (message.data || message.id) {
          response = await handleDesktopAppMessage(message);
        } else {
          response = { success: false, error: `Unknown message type: ${type}` };
        }
    }

    sendResponse(response);
  })();

  return true; // Keep channel open for async response
});

// ═══════════════════════════════════════════════════════════════════════════════
// LIFECYCLE EVENTS
// ═══════════════════════════════════════════════════════════════════════════════

// Clean up when extension is installed/updated
chrome.runtime.onInstalled.addListener((details) => {
  logWithTimestamp("info", `Extension ${details.reason}`, {
    previousVersion: details.previousVersion,
  });
});

// Handle service worker wake-up
self.addEventListener("activate", () => {
  logWithTimestamp("info", "Service worker activated");
});

console.log("[Centris] Background script loaded");
