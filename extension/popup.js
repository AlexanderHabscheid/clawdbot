// Centris AI Extension Popup

document.addEventListener("DOMContentLoaded", () => {
  const dot = document.getElementById("dot");
  const reconnectBtn = document.getElementById("reconnect");
  const showElementsBtn = document.getElementById("showElements");
  const elementsPanel = document.getElementById("elementsPanel");
  const elementsList = document.getElementById("elementsList");
  const elementCount = document.getElementById("elementCount");
  const closeElementsBtn = document.getElementById("closeElements");
  const sdkButtons = document.getElementById("sdkButtons");
  const copyJsonBtn = document.getElementById("copyJson");
  const exportSdkBtn = document.getElementById("exportSdk");

  // Store current elements for export
  let currentElements = [];
  let currentPageUrl = "";

  // Initialize galaxy background
  initGalaxy();

  function updateStatus(connected) {
    if (connected) {
      dot.classList.add("connected");
    } else {
      dot.classList.remove("connected");
    }
    reconnectBtn.disabled = false;
  }

  function checkStatus() {
    chrome.runtime.sendMessage({ type: "check_status" }, (response) => {
      if (chrome.runtime.lastError) {
        updateStatus(false);
      } else {
        updateStatus(response?.connected || false);
      }
    });
  }

  checkStatus();

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "extension_ready") {
      updateStatus(true);
    }
  });

  reconnectBtn.addEventListener("click", () => {
    reconnectBtn.disabled = true;
    dot.classList.remove("connected");

    chrome.runtime.sendMessage({ type: "reconnect" }, () => {
      let attempts = 0;
      const check = () => {
        chrome.runtime.sendMessage({ type: "check_status" }, (response) => {
          if (response?.connected) {
            updateStatus(true);
          } else if (attempts++ < 6) {
            setTimeout(check, 500);
          } else {
            updateStatus(false);
          }
        });
      };
      setTimeout(check, 500);
    });
  });

  // Show Elements on Page functionality
  let overlayActive = false;

  // Ensure content script is injected
  async function ensureContentScript(tabId) {
    try {
      // Try to ping the content script
      await chrome.tabs.sendMessage(tabId, { type: "ping" });
      return true;
    } catch (e) {
      // Content script not loaded, inject it
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ["content.js"],
        });
        // Wait a bit for it to initialize
        await new Promise((r) => setTimeout(r, 100));
        return true;
      } catch (injectErr) {
        console.error("Failed to inject content script:", injectErr);
        return false;
      }
    }
  }

  showElementsBtn.addEventListener("click", async () => {
    showElementsBtn.disabled = true;
    showElementsBtn.textContent = overlayActive ? "Hiding..." : "Loading...";

    try {
      // Get current tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab?.id) {
        showElementsBtn.textContent = "No tab found";
        showElementsBtn.disabled = false;
        return;
      }

      // Check if it's a chrome:// or extension page (can't inject)
      if (tab.url?.startsWith("chrome://") || tab.url?.startsWith("chrome-extension://")) {
        showElementsBtn.textContent = "Not on this page";
        showElementsBtn.disabled = false;
        return;
      }

      // Ensure content script is loaded
      const scriptReady = await ensureContentScript(tab.id);
      if (!scriptReady) {
        showElementsBtn.textContent = "Cannot inject here";
        showElementsBtn.disabled = false;
        return;
      }

      if (overlayActive) {
        // Hide overlay
        chrome.tabs.sendMessage(tab.id, { type: "centris_hide_elements_overlay" }, () => {
          overlayActive = false;
          showElementsBtn.textContent = "Show Elements on Page";
          showElementsBtn.disabled = false;
        });
        return;
      }

      // Request interactive snapshot from background
      chrome.runtime.sendMessage(
        {
          type: "popup_get_snapshot",
          tabId: tab.id,
        },
        (response) => {
          if (chrome.runtime.lastError) {
            showElementsBtn.textContent = "Error - Try Again";
            showElementsBtn.disabled = false;
            console.error("Snapshot error:", chrome.runtime.lastError);
            return;
          }

          if (!response || !response.success) {
            showElementsBtn.textContent = "Failed - Try Again";
            showElementsBtn.disabled = false;
            console.error("Snapshot failed:", response?.error);
            return;
          }

          // FEB 2026 FIX: Use _internalNodes (full data with bounds) like the agent does
          // This ensures popup shows EXACTLY what the agent sees
          // Fall back to interactiveNodes for backwards compatibility
          const elements =
            response._internalNodes || response.interactiveNodes || response.elements || [];
          console.log(
            `[Centris Popup] Got ${elements.length} elements (source: ${response._internalNodes ? "_internalNodes" : "interactiveNodes"})`,
          );

          // Send elements to content script to show overlay on page
          chrome.tabs.sendMessage(
            tab.id,
            {
              type: "centris_show_elements_overlay",
              elements: elements,
            },
            (overlayResponse) => {
              if (chrome.runtime.lastError) {
                // Try injecting inline as fallback
                injectOverlayDirectly(tab.id, elements);
                return;
              }

              overlayActive = true;
              showElementsBtn.textContent = `Hide Elements (${elements.length})`;
              showElementsBtn.disabled = false;

              // Store elements for export
              currentElements = elements;
              currentPageUrl = tab.url || "";

              // Show SDK export buttons
              sdkButtons.style.display = "flex";

              // Also update the panel view
              elementCount.textContent = `${elements.length} elements on page`;
              displayElements(elements);
            },
          );
        },
      );
    } catch (err) {
      showElementsBtn.textContent = "Error - Try Again";
      showElementsBtn.disabled = false;
      console.error("Show elements error:", err);
    }
  });

  // Fallback: inject overlay code directly
  async function injectOverlayDirectly(tabId, elements) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: showElementsOverlayInPage,
        args: [elements],
      });
      overlayActive = true;
      showElementsBtn.textContent = `Hide Elements (${elements.length})`;
      showElementsBtn.disabled = false;
    } catch (err) {
      console.error("Direct inject failed:", err);
      showElementsBtn.textContent = "Inject Failed";
      showElementsBtn.disabled = false;
    }
  }

  // Function to be injected directly into page
  // NOTE: This contains duplicated CSS styles that also exist in modules/visuals.js and content.js
  // This duplication is INTENTIONAL because:
  // 1. This function is injected directly into pages as a fallback
  // 2. It must be self-contained since injected functions can't reference external modules
  // 3. Content scripts can't import from service worker modules
  // If modifying styles, update in all three locations:
  // - modules/visuals.js (VISUAL_STYLES constant)
  // - content.js (centrisShowElementsOverlay function)
  // - popup.js (this function)
  function showElementsOverlayInPage(elements) {
    // Remove existing
    document.getElementById("centris-elements-overlay")?.remove();
    document.getElementById("centris-element-overlay-styles")?.remove();

    // Add styles
    const style = document.createElement("style");
    style.id = "centris-element-overlay-styles";
    style.textContent = `
      .centris-elements-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 999990; }
      .centris-element-box { position: absolute; border: 2px solid; border-radius: 3px; pointer-events: none; box-sizing: border-box; }
      .centris-element-box.type-clickable { border-color: rgba(34, 197, 94, 0.8); background: rgba(34, 197, 94, 0.1); }
      .centris-element-box.type-typeable { border-color: rgba(59, 130, 246, 0.8); background: rgba(59, 130, 246, 0.1); }
      .centris-element-box.type-selectable { border-color: rgba(168, 85, 247, 0.8); background: rgba(168, 85, 247, 0.1); }
      .centris-element-box.type-other { border-color: rgba(156, 163, 175, 0.8); background: rgba(156, 163, 175, 0.1); }
      .centris-element-label { position: absolute; top: -18px; left: -2px; background: rgba(0, 0, 0, 0.85); color: white; font-family: monospace; font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 3px 3px 0 0; white-space: nowrap; max-width: 250px; overflow: hidden; text-overflow: ellipsis; }
      .centris-element-label.type-clickable { background: rgba(34, 197, 94, 0.9); }
      .centris-element-label.type-typeable { background: rgba(59, 130, 246, 0.9); }
      .centris-element-label.type-selectable { background: rgba(168, 85, 247, 0.9); }
      .centris-element-id { position: absolute; bottom: -16px; right: -2px; background: rgba(0, 0, 0, 0.9); color: #FC661A; font-family: monospace; font-size: 9px; font-weight: bold; padding: 1px 4px; border-radius: 0 0 3px 3px; }
      .centris-elements-legend { position: fixed; top: 10px; right: 10px; background: rgba(0, 0, 0, 0.9); color: white; padding: 12px 16px; border-radius: 8px; font-family: system-ui; font-size: 12px; z-index: 999999; pointer-events: auto; box-shadow: 0 4px 20px rgba(0,0,0,0.4); min-width: 180px; }
      .centris-elements-legend h3 { margin: 0 0 10px 0; font-size: 14px; font-weight: 600; }
      .centris-elements-legend .legend-item { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
      .centris-elements-legend .legend-color { width: 14px; height: 14px; border-radius: 3px; border: 2px solid; }
      .centris-elements-legend .legend-color.clickable { border-color: #22c55e; background: rgba(34, 197, 94, 0.3); }
      .centris-elements-legend .legend-color.typeable { border-color: #3b82f6; background: rgba(59, 130, 246, 0.3); }
      .centris-elements-legend .legend-color.selectable { border-color: #a855f7; background: rgba(168, 85, 247, 0.3); }
      .centris-elements-legend .close-btn { position: absolute; top: 8px; right: 8px; background: transparent; border: none; color: rgba(255,255,255,0.6); font-size: 18px; cursor: pointer; padding: 2px 6px; }
      .centris-elements-legend .close-btn:hover { color: white; }
      .centris-elements-legend .stats { margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.2); font-size: 11px; color: rgba(255,255,255,0.7); }
    `;
    document.head.appendChild(style);

    const typeExpand = { cl: "clickable", ty: "typeable", se: "selectable", ot: "other" };
    const container = document.createElement("div");
    container.className = "centris-elements-overlay";
    container.id = "centris-elements-overlay";

    let stats = { clickable: 0, typeable: 0, selectable: 0, other: 0 };

    elements.forEach((el, idx) => {
      const bounds = el.b || el.bounds || {};
      const x = bounds.x || 0;
      const y = bounds.y || 0;
      const width = bounds.w || bounds.width || 0;
      const height = bounds.h || bounds.height || 0;

      if (width < 5 || height < 5) {
        return;
      }

      const nodeId = el.id || el.nodeId || "?";
      const name = el.n || el.name || el.ariaLabel || "";
      const rawType = el.t || el.type || "other";
      const type = typeExpand[rawType] || rawType;
      const role = el.r || el.role || "";

      if (stats[type] !== undefined) {
        stats[type]++;
      } else {
        stats.other++;
      }

      const box = document.createElement("div");
      box.className = `centris-element-box type-${type}`;
      box.style.cssText = `left:${x}px;top:${y}px;width:${width}px;height:${height}px;`;

      const label = document.createElement("div");
      label.className = `centris-element-label type-${type}`;
      const displayName = name.length > 35 ? name.substring(0, 35) + "..." : name;
      label.textContent = `#${idx + 1}: ${displayName || role || type}`;
      box.appendChild(label);

      const idBadge = document.createElement("div");
      idBadge.className = "centris-element-id";
      idBadge.textContent = `id:${nodeId}`;
      box.appendChild(idBadge);

      container.appendChild(box);
    });

    const legend = document.createElement("div");
    legend.className = "centris-elements-legend";
    legend.innerHTML = `
      <button class="close-btn" onclick="document.getElementById('centris-elements-overlay')?.remove();document.getElementById('centris-element-overlay-styles')?.remove();">×</button>
      <h3>🔍 AI Element View</h3>
      <div class="legend-item"><div class="legend-color clickable"></div><span>Clickable (${stats.clickable})</span></div>
      <div class="legend-item"><div class="legend-color typeable"></div><span>Typeable (${stats.typeable})</span></div>
      <div class="legend-item"><div class="legend-color selectable"></div><span>Selectable (${stats.selectable})</span></div>
      <div class="stats">Total: ${elements.length} elements</div>
    `;
    container.appendChild(legend);
    document.body.appendChild(container);
  }

  // Also show in panel when clicking "View List"
  closeElementsBtn.addEventListener("click", () => {
    elementsPanel.classList.remove("visible");
  });

  // ==========================================================================
  // SDK Export Functions
  // ==========================================================================

  function showToast(message, isError = false) {
    const toast = document.createElement("div");
    toast.className = `toast${isError ? " error" : ""}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
  }

  // Copy raw JSON to clipboard
  copyJsonBtn.addEventListener("click", async () => {
    if (!currentElements.length) {
      showToast("No elements to copy", true);
      return;
    }

    const typeExpand = { cl: "clickable", ty: "typeable", se: "selectable", ot: "other" };

    // Format elements for connector development
    const formatted = currentElements.map((el, idx) => {
      const nodeId = el.id || el.nodeId || idx;
      const name = el.n || el.name || el.ariaLabel || "";
      const rawType = el.t || el.type || "other";
      const type = typeExpand[rawType] || rawType;
      const bounds = el.b || el.bounds || {};

      return {
        index: idx + 1,
        id: nodeId,
        name: name,
        type: type,
        bounds: {
          x: Math.round(bounds.x || 0),
          y: Math.round(bounds.y || 0),
          width: Math.round(bounds.w || bounds.width || 0),
          height: Math.round(bounds.h || bounds.height || 0),
        },
      };
    });

    const output = {
      _meta: {
        url: currentPageUrl,
        elementCount: formatted.length,
        exportedAt: new Date().toISOString(),
        exportedBy: "Centris Chrome Extension",
      },
      elements: formatted,
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(output, null, 2));
      showToast(`Copied ${formatted.length} elements as JSON`);
    } catch (err) {
      showToast("Failed to copy", true);
    }
  });

  // Export as SDK connector scaffold
  exportSdkBtn.addEventListener("click", async () => {
    if (!currentElements.length) {
      showToast("No elements to export", true);
      return;
    }

    const typeExpand = { cl: "clickable", ty: "typeable", se: "selectable", ot: "other" };

    // Extract domain for connector ID
    let domain = "my-connector";
    try {
      const url = new URL(currentPageUrl);
      domain = url.hostname.replace(/^www\./, "").split(".")[0];
    } catch (e) {}

    // Group elements by type
    const navigation = [];
    const typeableFields = [];
    const clickableButtons = [];
    const selectableFields = [];

    currentElements.forEach((el, idx) => {
      const nodeId = el.id || el.nodeId || idx;
      const name =
        (el.n || el.name || el.ariaLabel || "")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "_")
          .replace(/_+/g, "_")
          .replace(/^_|_$/g, "") || `element_${nodeId}`;
      const rawType = el.t || el.type || "other";
      const type = typeExpand[rawType] || rawType;
      const displayName = el.n || el.name || el.ariaLabel || `Element ${idx + 1}`;

      const entry = {
        name: name,
        id: nodeId,
        type: type,
        label: displayName,
      };

      if (type === "typeable") {
        typeableFields.push(entry);
      } else if (type === "selectable") {
        selectableFields.push(entry);
      } else if (type === "clickable") {
        // Heuristic: navigation items usually have short names and are at top
        const bounds = el.b || el.bounds || {};
        if ((bounds.y || 0) < 500 && displayName.length < 30) {
          navigation.push(entry);
        } else {
          clickableButtons.push(entry);
        }
      }
    });

    // Generate SDK-ready export
    const sdkExport = {
      _meta: {
        format: "centris-sdk-connector",
        version: "1.0",
        url: currentPageUrl,
        domain: domain,
        exportedAt: new Date().toISOString(),
        usage: "Run: centris init my-connector --from-elements elements.json",
      },
      connector: {
        id: domain,
        name: domain.charAt(0).toUpperCase() + domain.slice(1),
        type: "browser",
        urlPatterns: [new URL(currentPageUrl).hostname.replace(/^www\./, "")],
      },
      elementMapping: {
        navigation: navigation.reduce((acc, el) => {
          acc[el.name] = { id: el.id, label: el.label };
          return acc;
        }, {}),
        typeableFields: typeableFields.reduce((acc, el) => {
          acc[el.name] = { id: el.id, label: el.label };
          return acc;
        }, {}),
        clickableButtons: clickableButtons.reduce((acc, el) => {
          acc[el.name] = { id: el.id, label: el.label };
          return acc;
        }, {}),
        selectableFields: selectableFields.reduce((acc, el) => {
          acc[el.name] = { id: el.id, label: el.label };
          return acc;
        }, {}),
      },
      stats: {
        total: currentElements.length,
        typeable: typeableFields.length,
        clickable: navigation.length + clickableButtons.length,
        selectable: selectableFields.length,
      },
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(sdkExport, null, 2));
      showToast(`SDK export copied (${currentElements.length} elements)`);
    } catch (err) {
      showToast("Failed to copy", true);
    }
  });

  // Toggle panel visibility with a separate button
  document.getElementById("elementsPanel").querySelector(".elements-header h2").style.cursor =
    "pointer";

  function displayElements(elements) {
    if (!elements || elements.length === 0) {
      elementsList.innerHTML = '<div class="loading">No interactive elements found</div>';
      elementCount.textContent = "0 elements";
      return;
    }

    elementCount.textContent = `${elements.length} elements`;

    // Type abbreviation expansion
    const typeExpand = {
      cl: "clickable",
      ty: "typeable",
      se: "selectable",
      ot: "other",
    };

    const html = elements
      .map((el, idx) => {
        // Handle both abbreviated and full formats
        const nodeId = el.id || el.nodeId || "?";
        const name = el.n || el.name || el.ariaLabel || "";
        const type = typeExpand[el.t] || el.type || el.t || "unknown";
        const role = el.r || el.role || "";
        const bounds = el.b || el.bounds || {};
        const stableHash = el.h || el.stableHash || "";

        // Format bounds
        const boundsStr =
          bounds.w || bounds.width
            ? `${Math.round(bounds.w || bounds.width)}×${Math.round(bounds.h || bounds.height)} @ (${Math.round(bounds.x || 0)}, ${Math.round(bounds.y || 0)})`
            : "no bounds";

        // Truncate long names
        const displayName = name.length > 60 ? name.substring(0, 60) + "..." : name;

        return `
        <div class="element-item">
          <div class="element-label">#${idx + 1}: ${displayName || "(no label)"}</div>
          <div class="element-meta">
            <span class="type-${type}">${type}</span>
            ${role ? `<span>role: ${role}</span>` : ""}
            <span>id: ${nodeId}</span>
          </div>
          <div class="element-bounds">${boundsStr}${stableHash ? ` | hash: ${stableHash.substring(0, 8)}...` : ""}</div>
        </div>
      `;
      })
      .join("");

    elementsList.innerHTML = html;
    elementsPanel.classList.add("visible");
  }
});

// Animated Galaxy Background - matching Sentris landing page style
function initGalaxy() {
  const canvas = document.getElementById("galaxy");
  const ctx = canvas.getContext("2d");

  let width = (canvas.width = 300);
  let height = (canvas.height = 360);

  const stars = [];
  const starCount = 150;

  class Star {
    constructor() {
      this.reset();
    }

    reset() {
      this.x = Math.random() * width;
      this.y = Math.random() * height;
      this.z = Math.random() * 1000 + 200;
      this.baseOpacity = Math.random() * 0.5 + 0.3;
      this.twinkleSpeed = Math.random() * 0.02 + 0.01;
      this.twinkleOffset = Math.random() * Math.PI * 2;
      this.speed = Math.random() * 0.15 + 0.05;
    }

    update(time) {
      this.z -= this.speed;
      if (this.z <= 0) {
        this.reset();
        this.z = 1000;
      }
      this.currentOpacity =
        this.baseOpacity * (0.7 + 0.3 * Math.sin(time * this.twinkleSpeed + this.twinkleOffset));
    }

    draw() {
      const cx = width / 2;
      const cy = height / 2;
      const k = 64 / this.z;
      const px = (this.x - cx) * k + cx;
      const py = (this.y - cy) * k + cy;

      if (px < 0 || px > width || py < 0 || py > height) {
        this.reset();
        return;
      }

      const size = Math.max(0.3, (1 - this.z / 1000) * 1.8);
      const opacity = Math.max(0.1, this.currentOpacity * (1 - this.z / 1200));

      const gradient = ctx.createRadialGradient(px, py, 0, px, py, size * 3);
      gradient.addColorStop(0, `rgba(255, 255, 255, ${opacity})`);
      gradient.addColorStop(0.5, `rgba(255, 255, 255, ${opacity * 0.3})`);
      gradient.addColorStop(1, "rgba(255, 255, 255, 0)");

      ctx.beginPath();
      ctx.arc(px, py, size * 3, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(px, py, size * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(1, opacity * 1.5)})`;
      ctx.fill();
    }
  }

  for (let i = 0; i < starCount; i++) {
    stars.push(new Star());
  }

  let time = 0;

  function animate() {
    time += 16;

    ctx.fillStyle = "rgba(0, 0, 0, 0.12)";
    ctx.fillRect(0, 0, width, height);

    stars.forEach((star) => {
      star.update(time);
      star.draw();
    });

    requestAnimationFrame(animate);
  }

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);

  animate();
}
