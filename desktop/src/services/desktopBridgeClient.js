/**
 * Desktop Bridge Client
 *
 * WebSocket client that connects the Electron app to the cloud gateway's
 * /ws/centris/desktop endpoint. When the gateway's agent needs to control
 * the user's desktop (via centris_computer tool), commands arrive here,
 * get executed against the native accessibility module, and results are
 * sent back.
 *
 * Protocol (mirrors the Chrome extension bridge):
 *   Gateway → Desktop:  { type: "snapshot", id: "dcmd-1", data: { appName: "Slack" } }
 *   Desktop → Gateway:  { type: "response", id: "dcmd-1", success: true, data: { ... } }
 */

const path = require("path");

const logger = {
  log: (...args) => console.log("[DesktopBridge]", ...args),
  error: (...args) => console.error("[DesktopBridge]", ...args),
  warn: (...args) => console.warn("[DesktopBridge]", ...args),
  debug: (...args) => console.debug("[DesktopBridge]", ...args),
};

// ─── Native module loading ──────────────────────────────────────────────────

let nativeControl = null;

function loadNativeControl() {
  if (nativeControl) return nativeControl;
  try {
    nativeControl = require(path.resolve(__dirname, "../../native-control/lib/index.js"));
    return nativeControl;
  } catch (err) {
    logger.error("Failed to load native control module:", err.message);
    return null;
  }
}

// ─── Bridge client ──────────────────────────────────────────────────────────

class DesktopBridgeClient {
  constructor({ wsURL, token }) {
    this.wsURL = wsURL;
    this.token = token;
    this.ws = null;
    this.reconnectTimer = null;
    this.reconnectAttempt = 0;
    this.maxReconnectDelay = 30000;
    this.destroyed = false;
    this.nativeInitialized = false;
  }

  async connect() {
    if (this.destroyed) return;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    const mod = loadNativeControl();
    if (!mod) {
      logger.error("Cannot start bridge — native module unavailable");
      this.scheduleReconnect();
      return;
    }

    if (!this.nativeInitialized) {
      try {
        await mod.initialize({ cacheElements: true, cacheTimeoutMs: 1000 });
        this.nativeInitialized = true;
        logger.log("Native control initialized");
      } catch (err) {
        logger.error("Native control init failed:", err.message);
        this.scheduleReconnect();
        return;
      }
    }

    let url = `${this.wsURL}/ws/centris/desktop`;
    if (this.token) {
      url += `?token=${encodeURIComponent(this.token)}`;
    }

    logger.log(`Connecting to gateway: ${this.wsURL}/ws/centris/desktop`);

    try {
      this.ws = new WebSocket(url);
    } catch (err) {
      logger.error("WebSocket creation failed:", err.message);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      logger.log("Connected to gateway desktop bridge");
      this.reconnectAttempt = 0;

      // Send handshake
      this.ws.send(
        JSON.stringify({
          type: "desktop_ready",
          version: "1.0.0",
          platform: process.platform,
          capabilities: [
            "snapshot",
            "click_element",
            "type_into_element",
            "press_key",
            "find_elements",
            "list_apps",
            "launch_app",
            "activate_app",
            "list_windows",
            "focus_window",
            "move_window",
            "resize_window",
            "mouse_click",
            "mouse_move",
            "type_text",
            "key_combo",
            "scroll",
            "get_displays",
            "insert_text",
          ],
        }),
      );
    };

    this.ws.onmessage = (event) => {
      this.handleMessage(event.data);
    };

    this.ws.onclose = () => {
      logger.log("Disconnected from gateway");
      this.ws = null;
      if (!this.destroyed) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = (err) => {
      logger.error("WebSocket error:", err.message || err);
    };
  }

  handleMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : raw.toString());
    } catch {
      logger.error("Failed to parse message");
      return;
    }

    if (msg.type === "handshake_ack") {
      logger.log("Handshake acknowledged by gateway");
      return;
    }

    if (msg.type === "ping") {
      this.send({ type: "pong", timestamp: Date.now() });
      return;
    }
    if (msg.type === "pong") {
      return;
    }

    // Command from gateway — execute locally and respond
    if (msg.id && msg.type && msg.type !== "response") {
      this.executeCommand(msg).catch((err) => {
        logger.error(`Command ${msg.type} failed:`, err.message);
      });
    }
  }

  async executeCommand(msg) {
    const { type: action, id, data: params = {} } = msg;
    const mod = loadNativeControl();

    if (!mod) {
      this.send({
        type: "response",
        id,
        success: false,
        error: "Native control module not available",
      });
      return;
    }

    try {
      const result = await this.dispatchAction(mod, action, params);
      this.send({ type: "response", id, success: true, data: result });
    } catch (err) {
      this.send({
        type: "response",
        id,
        success: false,
        error: err.message || String(err),
      });
    }
  }

  /**
   * Dispatch a single action to the native control module.
   * Returns the raw result — the gateway side handles token-capping.
   */
  async dispatchAction(mod, action, params) {
    switch (action) {
      case "snapshot": {
        const options = {};
        if (typeof params.appName === "string") options.appName = params.appName;
        if (typeof params.windowTitle === "string") options.windowTitle = params.windowTitle;
        return await mod.getInteractiveSnapshot(options);
      }

      case "click_element": {
        if (typeof params.elementId !== "number") throw new Error("elementId required");
        return {
          success: await mod.clickElement(params.elementId, {}),
          elementId: params.elementId,
        };
      }

      case "type_into_element": {
        if (typeof params.elementId !== "number") throw new Error("elementId required");
        if (typeof params.text !== "string") throw new Error("text required");
        return {
          success: await mod.typeIntoElement(params.elementId, params.text, {}),
          elementId: params.elementId,
        };
      }

      case "press_key": {
        if (typeof params.key !== "string") throw new Error("key required");
        return { success: await mod.keyPress(params.key), key: params.key };
      }

      case "find_elements": {
        const criteria = {};
        if (typeof params.appName === "string") criteria.appName = params.appName;
        if (typeof params.role === "string") criteria.role = params.role;
        if (typeof params.name === "string") criteria.name = params.name;
        return { elements: await mod.findElements(criteria) };
      }

      case "list_apps": {
        const apps = await mod.getRunningApps();
        return {
          count: apps.length,
          apps: apps.map((app) => ({
            name: app.name,
            pid: app.pid,
            bundleId: app.bundleId,
            active: app.active,
          })),
        };
      }

      case "launch_app": {
        const bundleId = params.bundleId || params.appName;
        if (!bundleId) throw new Error("bundleId or appName required");
        return {
          success: await mod.launchApp(bundleId),
          bundleId,
        };
      }

      case "activate_app": {
        if (typeof params.appName !== "string") throw new Error("appName required");
        return {
          success: await mod.activateApp(params.appName),
          appName: params.appName,
        };
      }

      case "list_windows": {
        const appName = typeof params.appName === "string" ? params.appName : "";
        const windows = await mod.getWindows(appName);
        return {
          count: windows.length,
          windows: windows.map((w) => ({
            id: w.id,
            title: w.title,
            appName: w.appName,
            bounds: w.bounds,
            focused: w.focused,
          })),
        };
      }

      case "focus_window": {
        if (typeof params.windowId !== "number") throw new Error("windowId required");
        return {
          success: await mod.focusWindow(params.windowId),
          windowId: params.windowId,
        };
      }

      case "move_window": {
        if (typeof params.windowId !== "number") throw new Error("windowId required");
        if (typeof params.x !== "number" || typeof params.y !== "number")
          throw new Error("x and y required");
        return {
          success: await mod.moveWindow(params.windowId, params.x, params.y),
          windowId: params.windowId,
          x: params.x,
          y: params.y,
        };
      }

      case "resize_window": {
        if (typeof params.windowId !== "number") throw new Error("windowId required");
        if (typeof params.width !== "number" || typeof params.height !== "number")
          throw new Error("width and height required");
        return {
          success: await mod.resizeWindow(params.windowId, params.width, params.height),
          windowId: params.windowId,
          width: params.width,
          height: params.height,
        };
      }

      case "mouse_click": {
        const x = params.mouseX ?? params.x;
        const y = params.mouseY ?? params.y;
        if (typeof x !== "number" || typeof y !== "number")
          throw new Error("mouseX and mouseY required");
        return { success: await mod.click(x, y, {}), x, y };
      }

      case "mouse_move": {
        const x = params.mouseX ?? params.x;
        const y = params.mouseY ?? params.y;
        if (typeof x !== "number" || typeof y !== "number")
          throw new Error("mouseX and mouseY required");
        return { success: await mod.moveMouse(x, y), x, y };
      }

      case "type_text": {
        if (typeof params.text !== "string") throw new Error("text required");
        return { success: await mod.type(params.text) };
      }

      case "key_combo": {
        if (typeof params.key !== "string") throw new Error("key required");
        return { success: await mod.keyPress(params.key), key: params.key };
      }

      case "scroll": {
        const deltaX = typeof params.deltaX === "number" ? params.deltaX : 0;
        const deltaY = typeof params.deltaY === "number" ? params.deltaY : -3;
        return {
          success: await mod.scroll({ deltaX, deltaY }),
          deltaX,
          deltaY,
        };
      }

      case "get_displays": {
        return { displays: await mod.getDisplays() };
      }

      case "insert_text": {
        if (typeof params.text !== "string") throw new Error("text required");
        return { success: await mod.insertTextAtCursor(params.text) };
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  scheduleReconnect() {
    if (this.destroyed || this.reconnectTimer) return;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempt), this.maxReconnectDelay);
    this.reconnectAttempt++;
    logger.log(`Reconnecting in ${Math.round(delay / 1000)}s...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  get connected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  destroy() {
    this.destroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close(1000, "client shutdown");
      } catch {
        // ignore
      }
      this.ws = null;
    }
  }
}

module.exports = { DesktopBridgeClient };
