/**
 * Visual Feedback System for Centris Chrome Extension
 *
 * BrowserOS-style visual feedback that shows the user what actions
 * are happening in real-time. Includes:
 * - Animated cursor movements
 * - Click ripple effects
 * - Element highlighting
 * - Typing indicators
 * - Action toasts
 * - Node highlighting (for debugging/visualization)
 *
 * NOTE: On strict CSP sites (Gmail, Google Docs), injection may fail.
 * In those cases, desktop notifications are used as fallback.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// CSS STYLES (Injected into pages)
// ═══════════════════════════════════════════════════════════════════════════════

const VISUAL_STYLES = `
/* BrowserOS-style animated cursor */
@keyframes centris-ripple {
  0% { transform: translate(-50%, -50%) scale(0.3); opacity: 0.8; }
  100% { transform: translate(-50%, -50%) scale(2.5); opacity: 0; }
}

@keyframes centris-cursor-move {
  0% { transform: translate(var(--from-x), var(--from-y)); }
  100% { transform: translate(var(--to-x), var(--to-y)); }
}

@keyframes centris-highlight-glow {
  0% { box-shadow: 0 0 0 3px rgba(252, 102, 26, 0.9), 0 0 30px rgba(252, 102, 26, 0.5); }
  50% { box-shadow: 0 0 0 4px rgba(252, 102, 26, 0.7), 0 0 40px rgba(252, 102, 26, 0.3); }
  100% { box-shadow: 0 0 0 3px rgba(252, 102, 26, 0), 0 0 20px rgba(252, 102, 26, 0); }
}

@keyframes centris-typing-cursor {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

@keyframes centris-toast-in {
  0% { opacity: 0; transform: translateX(-50%) translateY(20px); }
  100% { opacity: 1; transform: translateX(-50%) translateY(0); }
}

@keyframes centris-toast-out {
  0% { opacity: 1; transform: translateX(-50%) translateY(0); }
  100% { opacity: 0; transform: translateX(-50%) translateY(-10px); }
}

.centris-cursor-indicator {
  position: fixed;
  pointer-events: none;
  z-index: 2147483647;
  transition: transform 280ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.centris-cursor {
  width: 0;
  height: 0;
  border-style: solid;
  border-width: 0 10px 20px 10px;
  border-color: transparent transparent #FC661A transparent;
  filter: drop-shadow(0 2px 6px rgba(0,0,0,0.4)) drop-shadow(0 0 10px rgba(252,102,26,0.6));
  transform-origin: 5px 0;
}

.centris-ripple {
  position: absolute;
  width: 50px;
  height: 50px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(252,102,26,0.7) 0%, rgba(252,102,26,0) 70%);
  left: 5px;
  top: 20px;
  animation: centris-ripple 500ms ease-out forwards;
}

.centris-element-highlight {
  position: fixed;
  pointer-events: none;
  z-index: 2147483646;
  border-radius: 6px;
  background: rgba(252, 102, 26, 0.12);
  animation: centris-highlight-glow 2s ease-out forwards;
}

.centris-typing-indicator {
  position: fixed;
  pointer-events: none;
  z-index: 2147483647;
  background: linear-gradient(135deg, #FC661A 0%, #e55a17 100%);
  color: white;
  padding: 6px 14px;
  border-radius: 6px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 13px;
  font-weight: 500;
  box-shadow: 0 4px 16px rgba(0,0,0,0.25);
  display: flex;
  align-items: center;
  gap: 8px;
}

.centris-typing-indicator::after {
  content: '|';
  animation: centris-typing-cursor 0.7s infinite;
  font-weight: 300;
}

.centris-action-toast {
  position: fixed;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.9);
  color: white;
  padding: 14px 28px;
  border-radius: 10px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  font-weight: 500;
  z-index: 2147483647;
  pointer-events: none;
  box-shadow: 0 6px 24px rgba(0,0,0,0.35);
  display: flex;
  align-items: center;
  gap: 12px;
  animation: centris-toast-in 0.35s ease-out forwards;
}

/* BrowserOS-style node highlighting */
.centris-node-highlight {
  position: fixed;
  pointer-events: none;
  z-index: 2147483645;
  border: 2px solid #FC661A;
  border-radius: 4px;
  background: rgba(252, 102, 26, 0.08);
}

.centris-node-label {
  position: absolute;
  top: -22px;
  left: 0;
  background: #FC661A;
  color: white;
  padding: 2px 8px;
  border-radius: 4px 4px 0 0;
  font-size: 11px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
  font-weight: 600;
  white-space: nowrap;
}
`;

// ═══════════════════════════════════════════════════════════════════════════════
// VISUALIZATION INJECTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Inject visualization functions into a tab's MAIN world
 * NOTE: On strict CSP sites like Gmail, this may fail silently
 *
 * @param {number} tabId - Tab ID to inject into
 * @returns {Promise<boolean>} - Whether injection was successful
 */
async function ensureVisualizationsInjected(tabId) {
  try {
    // Check if already injected
    const checkResults = await chrome.scripting
      .executeScript({
        target: { tabId },
        world: "MAIN",
        func: () => {
          return !!window.__centrisVisualsInjected;
        },
      })
      .catch((err) => {
        if (typeof logWithTimestamp === "function") {
          logWithTimestamp(
            "warn",
            `⚠️ Cannot check visualization status (CSP restriction likely): ${err.message}`,
          );
        }
        return [{ result: false }];
      });

    if (checkResults[0]?.result) {
      return true; // Already injected
    }

    // Inject the visualization system
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (styles) => {
        // Mark as injected
        window.__centrisVisualsInjected = true;

        // Inject styles
        if (!document.querySelector("#centris-visual-styles-main")) {
          const style = document.createElement("style");
          style.id = "centris-visual-styles-main";
          style.textContent = styles;
          document.head.appendChild(style);
        }

        // Define visualization functions
        window.centrisShowClick = function (x, y, startX = null, startY = null) {
          document.querySelectorAll(".centris-cursor-indicator").forEach((e) => e.remove());

          const container = document.createElement("div");
          container.className = "centris-cursor-indicator";

          const fromX = startX !== null ? startX : window.innerWidth / 2;
          const fromY = startY !== null ? startY : window.innerHeight / 2;

          container.style.left = "0";
          container.style.top = "0";
          container.style.transform = `translate(${fromX}px, ${fromY}px)`;

          const cursor = document.createElement("div");
          cursor.className = "centris-cursor";
          container.appendChild(cursor);

          document.body.appendChild(container);

          requestAnimationFrame(() => {
            container.style.transform = `translate(${x}px, ${y}px)`;
          });

          setTimeout(() => {
            const ripple = document.createElement("div");
            ripple.className = "centris-ripple";
            container.appendChild(ripple);

            setTimeout(() => {
              container.style.transition = "opacity 350ms ease-out";
              container.style.opacity = "0";
              setTimeout(() => container.remove(), 400);
            }, 400);
          }, 280);
        };

        window.centrisHighlightElement = function (x, y, width, height) {
          document.querySelectorAll(".centris-element-highlight").forEach((e) => e.remove());

          const highlight = document.createElement("div");
          highlight.className = "centris-element-highlight";
          highlight.style.left = `${x}px`;
          highlight.style.top = `${y}px`;
          highlight.style.width = `${width}px`;
          highlight.style.height = `${height}px`;

          document.body.appendChild(highlight);
          setTimeout(() => highlight.remove(), 2000);
        };

        window.centrisShowTyping = function (x, y, text) {
          document.querySelectorAll(".centris-typing-indicator").forEach((e) => e.remove());

          const indicator = document.createElement("div");
          indicator.className = "centris-typing-indicator";
          indicator.style.left = `${x + 15}px`;
          indicator.style.top = `${y - 35}px`;

          const displayText = text.length > 35 ? text.substring(0, 35) + "..." : text;
          indicator.innerHTML = `<span>✏️</span><span>Typing: "${displayText}"</span>`;

          document.body.appendChild(indicator);

          const typingDuration = Math.min(text.length * 40, 2500);
          setTimeout(() => {
            indicator.style.transition = "opacity 350ms";
            indicator.style.opacity = "0";
            setTimeout(() => indicator.remove(), 350);
          }, typingDuration);
        };

        window.centrisShowActionToast = function (message, icon = "⚡") {
          document.querySelectorAll(".centris-action-toast").forEach((e) => e.remove());

          const toast = document.createElement("div");
          toast.className = "centris-action-toast";
          toast.innerHTML = `<span style="font-size: 18px">${icon}</span><span>${message}</span>`;

          document.body.appendChild(toast);

          setTimeout(() => {
            toast.style.animation = "centris-toast-out 0.35s ease-in forwards";
            setTimeout(() => toast.remove(), 350);
          }, 2500);
        };

        window.centrisShowNodeHighlights = function (nodes, showLabels = true, persistent = true) {
          document.querySelectorAll(".centris-node-highlight").forEach((e) => e.remove());

          const colors = {
            typeable: { border: "#10B981", bg: "rgba(16, 185, 129, 0.12)" },
            clickable: { border: "#3B82F6", bg: "rgba(59, 130, 246, 0.12)" },
            selectable: { border: "#8B5CF6", bg: "rgba(139, 92, 246, 0.12)" },
            other: { border: "#FC661A", bg: "rgba(252, 102, 26, 0.12)" },
          };

          nodes.forEach((node) => {
            if (!node.bounds) {
              return;
            }

            const color = colors[node.type] || colors.other;

            const highlight = document.createElement("div");
            highlight.className = "centris-node-highlight";
            highlight.style.cssText = `
              position: fixed;
              pointer-events: none;
              z-index: 2147483645;
              border: 2px solid ${color.border};
              border-radius: 4px;
              background: ${color.bg};
              left: ${node.bounds.x}px;
              top: ${node.bounds.y}px;
              width: ${node.bounds.width}px;
              height: ${node.bounds.height}px;
              box-shadow: 0 0 0 1px rgba(0,0,0,0.1), 0 2px 8px rgba(0,0,0,0.1);
              transition: all 0.15s ease;
            `;

            if (showLabels) {
              const label = document.createElement("div");
              label.className = "centris-node-label";
              label.style.cssText = `
                position: absolute;
                top: -24px;
                left: -2px;
                background: ${color.border};
                color: white;
                padding: 3px 8px;
                border-radius: 4px 4px 0 0;
                font-size: 10px;
                font-family: -apple-system, BlinkMacSystemFont, 'SF Mono', Monaco, monospace;
                font-weight: 600;
                white-space: nowrap;
              `;

              const typeIcon =
                node.type === "typeable"
                  ? "✏️"
                  : node.type === "clickable"
                    ? "👆"
                    : node.type === "selectable"
                      ? "📋"
                      : "◉";
              const shortName = node.name
                ? node.name.length > 20
                  ? node.name.substring(0, 20) + "..."
                  : node.name
                : "";
              label.textContent = `${typeIcon} #${node.nodeId} ${shortName}`;
              highlight.appendChild(label);
            }

            document.body.appendChild(highlight);
          });

          if (!persistent) {
            setTimeout(() => {
              document.querySelectorAll(".centris-node-highlight").forEach((e) => e.remove());
            }, 5000);
          }
        };

        window.centrisClearVisuals = function () {
          document.querySelectorAll(".centris-cursor-indicator").forEach((e) => e.remove());
          document.querySelectorAll(".centris-element-highlight").forEach((e) => e.remove());
          document.querySelectorAll(".centris-typing-indicator").forEach((e) => e.remove());
          document.querySelectorAll(".centris-action-toast").forEach((e) => e.remove());
          document.querySelectorAll(".centris-node-highlight").forEach((e) => e.remove());
        };

        return true;
      },
      args: [VISUAL_STYLES],
    });

    if (typeof logWithTimestamp === "function") {
      logWithTimestamp("info", "🎨 Visualization system injected into tab", { tabId });
    }
    return true;
  } catch (e) {
    // CSP or other restrictions prevented injection
    if (typeof logWithTimestamp === "function") {
      logWithTimestamp("warn", `⚠️ Visualization injection blocked (CSP): ${e.message}`, {
        tabId,
        note: "Will use desktop notifications instead",
      });
    }
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// VISUAL FEEDBACK FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Show click indicator at coordinates
 * @param {number} tabId - Tab ID
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {number} startX - Starting X (optional)
 * @param {number} startY - Starting Y (optional)
 */
async function showClickIndicator(tabId, x, y, startX = null, startY = null) {
  await ensureVisualizationsInjected(tabId);

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (x, y, startX, startY) => {
        if (window.centrisShowClick) {
          window.centrisShowClick(x, y, startX, startY);
        }
      },
      args: [x, y, startX, startY],
    });
  } catch (e) {
    // Ignore errors on CSP-restricted pages
  }
}

/**
 * Highlight an element at given bounds
 * @param {number} tabId - Tab ID
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {number} width - Element width
 * @param {number} height - Element height
 */
async function highlightElement(tabId, x, y, width, height) {
  await ensureVisualizationsInjected(tabId);

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (x, y, width, height) => {
        if (window.centrisHighlightElement) {
          window.centrisHighlightElement(x, y, width, height);
        }
      },
      args: [x, y, width, height],
    });
  } catch (e) {
    // Ignore errors
  }
}

/**
 * Show typing indicator
 * @param {number} tabId - Tab ID
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {string} text - Text being typed
 */
async function showTypingIndicator(tabId, x, y, text) {
  await ensureVisualizationsInjected(tabId);

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (x, y, text) => {
        if (window.centrisShowTyping) {
          window.centrisShowTyping(x, y, text);
        }
      },
      args: [x, y, text],
    });
  } catch (e) {
    // Ignore errors
  }
}

/**
 * Show action toast at bottom of screen
 * @param {number} tabId - Tab ID
 * @param {string} message - Message to display
 * @param {string} icon - Emoji icon (optional)
 */
async function showActionToast(tabId, message, icon = "⚡") {
  await ensureVisualizationsInjected(tabId);

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (message, icon) => {
        if (window.centrisShowActionToast) {
          window.centrisShowActionToast(message, icon);
        }
      },
      args: [message, icon],
    });
  } catch (e) {
    // Ignore errors
  }
}

/**
 * Show highlights for interactive nodes (for debugging/visualization)
 * @param {number} tabId - Tab ID
 * @param {Array} nodes - Array of node objects with bounds
 * @param {boolean} showLabels - Whether to show labels
 * @param {boolean} persistent - Whether highlights stay until cleared
 */
async function showNodeHighlights(tabId, nodes, showLabels = true, persistent = true) {
  await ensureVisualizationsInjected(tabId);

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (nodes, showLabels, persistent) => {
        if (window.centrisShowNodeHighlights) {
          window.centrisShowNodeHighlights(nodes, showLabels, persistent);
        }
      },
      args: [nodes, showLabels, persistent],
    });
  } catch (e) {
    // Ignore errors
  }
}

/**
 * Clear all visual elements from a tab
 * @param {number} tabId - Tab ID
 */
async function clearVisuals(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        if (window.centrisClearVisuals) {
          window.centrisClearVisuals();
        }
      },
    });
  } catch (e) {
    // Ignore errors
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CDP OVERLAY SYSTEM - Works on ALL sites including Gmail (bypasses CSP)
// Uses Chrome DevTools Protocol via chrome.debugger API
// This is how Chrome DevTools itself draws element highlights!
// ═══════════════════════════════════════════════════════════════════════════════

// Track which tabs have debugger attached
const debuggerAttachedTabs = new Map(); // tabId -> boolean

/**
 * Attach debugger to a tab (required for CDP overlay)
 * Note: This will show a "debugging this tab" banner which shows the user
 * the tab is being controlled by AI
 *
 * @param {number} tabId - Tab ID
 * @returns {Promise<boolean>} - Whether attachment was successful
 */
async function attachDebugger(tabId) {
  if (debuggerAttachedTabs.get(tabId)) {
    return true; // Already attached
  }

  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    debuggerAttachedTabs.set(tabId, true);

    if (typeof logWithTimestamp === "function") {
      logWithTimestamp(
        "info",
        `🔧 CDP: Attached debugger to tab ${tabId} (AI control indicator shown)`,
      );
    }

    // Enable the Overlay domain for drawing
    await chrome.debugger.sendCommand({ tabId }, "Overlay.enable");

    return true;
  } catch (e) {
    if (typeof logWithTimestamp === "function") {
      logWithTimestamp("warn", `⚠️ CDP: Could not attach debugger to tab ${tabId}: ${e.message}`);
    }
    return false;
  }
}

/**
 * Detach debugger from a tab
 * @param {number} tabId - Tab ID
 */
async function detachDebugger(tabId) {
  if (!debuggerAttachedTabs.get(tabId)) {
    return;
  }

  try {
    await chrome.debugger.detach({ tabId });
    debuggerAttachedTabs.delete(tabId);
    if (typeof logWithTimestamp === "function") {
      logWithTimestamp("info", `🔧 CDP: Detached debugger from tab ${tabId}`);
    }
  } catch (e) {
    // Ignore - might already be detached
    debuggerAttachedTabs.delete(tabId);
  }
}

/**
 * Highlight a rectangle using CDP Overlay.highlightRect
 * This works on ALL sites including Gmail!
 *
 * @param {number} tabId - Tab ID
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {number} width - Width
 * @param {number} height - Height
 * @param {number} durationMs - Duration in milliseconds
 * @returns {Promise<boolean>}
 */
async function cdpHighlightRect(tabId, x, y, width, height, durationMs = 2000) {
  try {
    const attached = await attachDebugger(tabId);
    if (!attached) {
      if (typeof logWithTimestamp === "function") {
        logWithTimestamp("warn", "CDP highlight skipped - debugger not attached");
      }
      return false;
    }

    // Draw a highlighted rectangle using CDP
    await chrome.debugger.sendCommand({ tabId }, "Overlay.highlightRect", {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
      color: { r: 252, g: 102, b: 26, a: 0.3 }, // Orange fill with transparency
      outlineColor: { r: 252, g: 102, b: 26, a: 1 }, // Solid orange outline
    });

    if (typeof logWithTimestamp === "function") {
      logWithTimestamp("info", `🎯 CDP: Highlighted rect at (${x}, ${y}) ${width}x${height}`);
    }

    // Hide highlight after duration
    setTimeout(async () => {
      try {
        await chrome.debugger.sendCommand({ tabId }, "Overlay.hideHighlight");
      } catch (e) {
        // Ignore - tab might have closed
      }
    }, durationMs);

    return true;
  } catch (e) {
    if (typeof logWithTimestamp === "function") {
      logWithTimestamp("warn", `⚠️ CDP highlight failed: ${e.message}`);
    }
    return false;
  }
}

/**
 * Show a visual cursor click indicator using CDP
 * Draws a cursor + ripple effect at the click location
 *
 * @param {number} tabId - Tab ID
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {number} durationMs - Duration in milliseconds
 * @returns {Promise<boolean>}
 */
async function cdpShowClickIndicator(tabId, x, y, durationMs = 1500) {
  try {
    const attached = await attachDebugger(tabId);
    if (!attached) {
      return false;
    }

    // Use Overlay.highlightRect to show a click indicator
    // Draw a small square at the click point
    const size = 30;
    await chrome.debugger.sendCommand({ tabId }, "Overlay.highlightRect", {
      x: Math.round(x - size / 2),
      y: Math.round(y - size / 2),
      width: size,
      height: size,
      color: { r: 252, g: 102, b: 26, a: 0.6 }, // Orange with transparency
      outlineColor: { r: 252, g: 102, b: 26, a: 1 }, // Solid orange
    });

    if (typeof logWithTimestamp === "function") {
      logWithTimestamp("info", `👆 CDP: Click indicator at (${x}, ${y})`);
    }

    // Hide after duration
    setTimeout(async () => {
      try {
        await chrome.debugger.sendCommand({ tabId }, "Overlay.hideHighlight");
      } catch (e) {
        // Ignore
      }
    }, durationMs);

    return true;
  } catch (e) {
    if (typeof logWithTimestamp === "function") {
      logWithTimestamp("warn", `⚠️ CDP click indicator failed: ${e.message}`);
    }
    return false;
  }
}

/**
 * Highlight element using best available method
 * First tries script injection, falls back to CDP overlay for strict CSP sites
 *
 * @param {number} tabId - Tab ID
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {number} width - Element width
 * @param {number} height - Element height
 * @param {boolean} useCdpFallback - Whether to use CDP if injection fails
 */
async function highlightElementWithFallback(tabId, x, y, width, height, useCdpFallback = true) {
  // Try standard injection first
  const injected = await ensureVisualizationsInjected(tabId);

  if (injected) {
    await highlightElement(tabId, x, y, width, height);
    return true;
  }

  // Fall back to CDP for CSP-restricted pages
  if (useCdpFallback) {
    return await cdpHighlightRect(tabId, x, y, width, height);
  }

  return false;
}

// Clean up debugger when tab closes
if (typeof chrome !== "undefined" && chrome.tabs) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    debuggerAttachedTabs.delete(tabId);
  });
}

// Handle debugger detach events
if (typeof chrome !== "undefined" && chrome.debugger) {
  chrome.debugger.onDetach.addListener((source, reason) => {
    if (source.tabId) {
      debuggerAttachedTabs.delete(source.tabId);
      if (typeof logWithTimestamp === "function") {
        logWithTimestamp("info", `🔧 CDP: Debugger detached from tab ${source.tabId}: ${reason}`);
      }
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

// Make available globally for service worker
if (typeof globalThis !== "undefined") {
  // Standard visualization functions
  globalThis.ensureVisualizationsInjected = ensureVisualizationsInjected;
  globalThis.showClickIndicator = showClickIndicator;
  globalThis.highlightElement = highlightElement;
  globalThis.showTypingIndicator = showTypingIndicator;
  globalThis.showActionToast = showActionToast;
  globalThis.showNodeHighlights = showNodeHighlights;
  globalThis.clearVisuals = clearVisuals;
  globalThis.VISUAL_STYLES = VISUAL_STYLES;

  // CDP Overlay functions (for CSP-restricted sites)
  globalThis.attachDebugger = attachDebugger;
  globalThis.detachDebugger = detachDebugger;
  globalThis.cdpHighlightRect = cdpHighlightRect;
  globalThis.cdpShowClickIndicator = cdpShowClickIndicator;
  globalThis.highlightElementWithFallback = highlightElementWithFallback;
  globalThis.debuggerAttachedTabs = debuggerAttachedTabs;
}
