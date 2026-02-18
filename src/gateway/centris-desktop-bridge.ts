/**
 * Centris Desktop Bridge
 *
 * Manages the WebSocket connection between the cloud gateway and the
 * Centris Electron desktop app. The desktop app connects to /ws/centris/desktop
 * and receives native desktop control commands (snapshot, click_element,
 * launch_app, type_into_element, etc.).
 *
 * The agent's computer tool calls sendDesktopCommand() here, which forwards
 * the command to the Electron app and waits for the response.
 *
 * Protocol (mirrors the extension bridge):
 *   Gateway → Desktop:  { type: "snapshot", id: "cmd-1", data: { appName: "Slack" } }
 *   Desktop → Gateway:  { type: "response", id: "cmd-1", success: true, data: { ... } }
 */

import type { IncomingMessage } from "node:http";
import type { WebSocket } from "ws";
import { logDebug, logError, logInfo, logWarn } from "../logger.js";

type PendingCommand = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

/** Single connected desktop app. Only one can be connected at a time. */
let desktopWs: WebSocket | null = null;

/** Pending commands waiting for desktop responses. */
const pending = new Map<string, PendingCommand>();

/** Incrementing command ID. */
let nextId = 1;

/** Default timeout for a command round-trip (30s). */
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;

/** Server-side ping interval to keep the WebSocket alive. */
let pingInterval: NodeJS.Timeout | null = null;
const PING_INTERVAL_MS = 15_000;

/** Callbacks waiting for the desktop app to reconnect. */
const reconnectWaiters: Array<() => void> = [];

/** Last pong timestamp from the desktop app (0 = never). */
let lastPongAt = 0;

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/** Returns true if a desktop app is currently connected. */
export function isCentrisDesktopConnected(): boolean {
  return desktopWs !== null && desktopWs.readyState === desktopWs.OPEN;
}

/**
 * Wait for the desktop app to connect (or return immediately if already connected).
 * Returns true if connected within the timeout, false otherwise.
 */
export function waitForDesktop(timeoutMs = 10_000): Promise<boolean> {
  if (isCentrisDesktopConnected()) {
    return Promise.resolve(true);
  }
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      const idx = reconnectWaiters.indexOf(cb);
      if (idx >= 0) {
        reconnectWaiters.splice(idx, 1);
      }
      resolve(false);
    }, timeoutMs);
    const cb = () => {
      clearTimeout(timer);
      resolve(true);
    };
    reconnectWaiters.push(cb);
  });
}

/**
 * Send a command to the connected Electron desktop app and wait for the response.
 *
 * @param type    The command type (e.g. "snapshot", "click_element", "launch_app")
 * @param data    Command-specific payload
 * @param timeoutMs  How long to wait for a response (default 30s)
 * @returns       The response data from the desktop app
 */
export async function sendDesktopCommand(
  type: string,
  data: Record<string, unknown> = {},
  timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
): Promise<unknown> {
  if (!desktopWs || desktopWs.readyState !== desktopWs.OPEN) {
    logInfo(`[centris-desktop-bridge] desktop not connected, waiting up to 10s for reconnect...`);
    const reconnected = await waitForDesktop(10_000);
    if (!reconnected) {
      throw new Error(
        "Centris desktop app is not connected. Make sure the Electron app is running and connected to the gateway.",
      );
    }
    logInfo(`[centris-desktop-bridge] desktop reconnected, proceeding with command: ${type}`);
  }
  const ws = desktopWs!;

  const id = `dcmd-${nextId++}`;
  const message = { type, id, data };

  ws.send(JSON.stringify(message));
  logDebug(`[centris-desktop-bridge] sent command: ${type} (${id})`);

  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Desktop command timed out after ${timeoutMs}ms: ${type}`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
  });
}

/** Returns bridge health info for status endpoints. */
export function getCentrisDesktopStatus(): {
  connected: boolean;
  lastPongAgoMs: number;
  pendingCommands: number;
} {
  return {
    connected: isCentrisDesktopConnected(),
    lastPongAgoMs: lastPongAt > 0 ? Date.now() - lastPongAt : -1,
    pendingCommands: pending.size,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// WebSocket handler (called from server-http.ts upgrade handler)
// ─────────────────────────────────────────────────────────────────────────────

/** Check if a WebSocket upgrade path is for the Centris desktop bridge. */
export function isCentrisDesktopPath(pathname: string): boolean {
  return pathname === "/ws/centris/desktop";
}

/** Handle a new desktop app WebSocket connection. */
export function handleCentrisDesktopConnection(ws: WebSocket, _req: IncomingMessage): void {
  if (desktopWs && desktopWs.readyState === desktopWs.OPEN) {
    logWarn("[centris-desktop-bridge] replacing existing desktop connection");
    try {
      desktopWs.close(1000, "replaced by new connection");
    } catch {
      // ignore
    }
    rejectAllPending("desktop reconnected");
  }

  desktopWs = ws;
  logInfo("[centris-desktop-bridge] desktop app connected");

  // Notify anyone waiting for reconnection
  for (const cb of reconnectWaiters.splice(0)) {
    cb();
  }

  ws.send(JSON.stringify({ type: "handshake_ack" }));

  // Start server-side ping to keep the WebSocket alive
  if (pingInterval) {
    clearInterval(pingInterval);
  }
  lastPongAt = Date.now();
  pingInterval = setInterval(() => {
    if (desktopWs && desktopWs.readyState === desktopWs.OPEN) {
      const pongAge = Date.now() - lastPongAt;
      if (pongAge > PING_INTERVAL_MS * 3) {
        logWarn(
          `[centris-desktop-bridge] desktop pong stale (${Math.round(pongAge / 1000)}s), closing`,
        );
        try {
          desktopWs.close(1000, "pong timeout");
        } catch {
          /* ignore */
        }
        return;
      }
      try {
        desktopWs.send(JSON.stringify({ type: "ping", timestamp: Date.now() }));
      } catch {
        // ignore — will be caught by close/error handlers
      }
    }
  }, PING_INTERVAL_MS);

  ws.on("message", (raw) => {
    try {
      const rawStr =
        typeof raw === "string"
          ? raw
          : Buffer.isBuffer(raw)
            ? raw.toString("utf-8")
            : Buffer.from(raw as ArrayBuffer).toString("utf-8");
      const msg = JSON.parse(rawStr) as Record<string, unknown>;

      // Handle desktop_ready handshake
      if (msg.type === "desktop_ready") {
        logInfo(
          `[centris-desktop-bridge] desktop handshake received (v=${String(msg.version)}, caps=${JSON.stringify(msg.capabilities)})`,
        );
        ws.send(JSON.stringify({ type: "handshake_ack" }));
        return;
      }

      // Handle ping/pong keep-alive
      if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
        return;
      }
      if (msg.type === "pong") {
        lastPongAt = Date.now();
        return;
      }

      // Handle command responses — match by id
      if (msg.type === "response" && typeof msg.id === "string") {
        const entry = pending.get(msg.id);
        if (!entry) {
          logDebug(`[centris-desktop-bridge] response for unknown id: ${msg.id}`);
          return;
        }
        pending.delete(msg.id);
        clearTimeout(entry.timer);

        if (msg.success === false) {
          const errMsg =
            typeof msg.error === "string"
              ? msg.error
              : typeof msg.data === "string"
                ? msg.data
                : "desktop command failed";
          entry.reject(new Error(errMsg));
        } else {
          entry.resolve(msg.data ?? msg);
        }
        return;
      }

      logDebug(`[centris-desktop-bridge] unhandled message type: ${String(msg.type)}`);
    } catch (err) {
      logError(
        `[centris-desktop-bridge] message parse error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });

  ws.on("close", () => {
    logInfo("[centris-desktop-bridge] desktop app disconnected");
    desktopWs = null;
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
    rejectAllPending("desktop disconnected");
  });

  ws.on("error", (err) => {
    logError(`[centris-desktop-bridge] websocket error: ${err.message}`);
  });
}

function rejectAllPending(reason: string): void {
  for (const [_id, entry] of pending) {
    clearTimeout(entry.timer);
    entry.reject(new Error(reason));
  }
  pending.clear();
}
