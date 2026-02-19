/**
 * Centris Extension Bridge
 *
 * Manages the WebSocket connection between the cloud gateway and the
 * Centris Chrome extension. The extension connects to /ws/centris/extension
 * and receives browser commands (snapshot, click, type, navigate, etc.).
 *
 * The agent's browser tool calls sendCommand() here, which forwards the
 * command to the extension and waits for the response.
 *
 * Protocol (same as what background.js already speaks):
 *   Gateway → Extension:  { type: "get_interactive_snapshot", id: "cmd-1", data: { ... } }
 *   Extension → Gateway:  { type: "response", id: "cmd-1", success: true, data: { ... } }
 */

import type { IncomingMessage } from "node:http";
import type { WebSocket } from "ws";
import { logDebug, logError, logInfo, logWarn } from "../logger.js";
import { isPrivateOrLoopbackAddress } from "./net.js";

type PendingCommand = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

/** Single connected extension. Only one extension can be connected at a time. */
let extensionWs: WebSocket | null = null;

/** Pending commands waiting for extension responses. */
const pending = new Map<string, PendingCommand>();

/** Incrementing command ID. */
let nextId = 1;

/** Default timeout for a command round-trip (30s). */
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;

/** Server-side ping interval to keep the WebSocket alive. */
let pingInterval: NodeJS.Timeout | null = null;
const PING_INTERVAL_MS = 15_000; // 15s — safe margin under MV3's 30s and proxy idle timeouts

/** Callbacks waiting for the extension to reconnect. */
const reconnectWaiters: Array<() => void> = [];

/** Last pong timestamp from the extension (0 = never). */
let lastPongAt = 0;

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/** Returns true if an extension is currently connected. */
export function isCentrisExtensionConnected(): boolean {
  return extensionWs !== null && extensionWs.readyState === extensionWs.OPEN;
}

/**
 * Wait for the extension to connect (or return immediately if already connected).
 * Returns true if connected within the timeout, false otherwise.
 */
export function waitForExtension(timeoutMs = 10_000): Promise<boolean> {
  if (isCentrisExtensionConnected()) {
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
 * Send a command to the connected Chrome extension and wait for the response.
 *
 * @param type    The command type (e.g. "get_interactive_snapshot", "click_node")
 * @param data    Command-specific payload
 * @param timeoutMs  How long to wait for a response (default 30s)
 * @returns       The response data from the extension
 */
export async function sendExtensionCommand(
  type: string,
  data: Record<string, unknown> = {},
  timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
): Promise<unknown> {
  // If extension is temporarily disconnected (MV3 suspension), wait up to 10s for reconnect
  if (!extensionWs || extensionWs.readyState !== extensionWs.OPEN) {
    logInfo(`[centris-ext-bridge] extension not connected, waiting up to 10s for reconnect...`);
    const reconnected = await waitForExtension(10_000);
    if (!reconnected) {
      throw new Error(
        "Centris Chrome extension is not connected. Make sure the extension is installed and connected to the gateway.",
      );
    }
    logInfo(`[centris-ext-bridge] extension reconnected, proceeding with command: ${type}`);
  }
  const ws = extensionWs!;

  const id = `cmd-${nextId++}`;
  const message = { type, id, data };

  ws.send(JSON.stringify(message));
  logDebug(`[centris-ext-bridge] sent command: ${type} (${id})`);

  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Extension command timed out after ${timeoutMs}ms: ${type}`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
  });
}

/** Returns bridge health info for status endpoints. */
export function getCentrisExtensionStatus(): {
  connected: boolean;
  lastPongAgoMs: number;
  pendingCommands: number;
} {
  return {
    connected: isCentrisExtensionConnected(),
    lastPongAgoMs: lastPongAt > 0 ? Date.now() - lastPongAt : -1,
    pendingCommands: pending.size,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// WebSocket handler (called from server-http.ts upgrade handler)
// ─────────────────────────────────────────────────────────────────────────────

/** Check if a WebSocket upgrade path is for the Centris extension bridge. */
export function isCentrisExtensionPath(pathname: string): boolean {
  return pathname === "/ws/centris/extension";
}

/**
 * Validate the extension connection token from the URL query string.
 * If CENTRIS_EXTENSION_TOKEN is set, the `?token=` param must match.
 * If not set, all connections are accepted (local dev / unconfigured).
 */
export function validateExtensionToken(
  url: string | undefined,
  opts?: { clientIp?: string; allowLocalWithoutToken?: boolean },
): boolean {
  const requiredToken = process.env.CENTRIS_EXTENSION_TOKEN?.trim();
  if (!requiredToken) {
    // Fail closed by default. If explicitly allowed, only trust private/loopback clients.
    return opts?.allowLocalWithoutToken === true && isPrivateOrLoopbackAddress(opts.clientIp);
  }
  try {
    const parsed = new URL(url ?? "/", "http://localhost");
    const provided = parsed.searchParams.get("token")?.trim();
    if (!provided) {
      return false;
    }
    // Constant-time comparison to prevent timing attacks
    if (provided.length !== requiredToken.length) {
      return false;
    }
    let mismatch = 0;
    for (let i = 0; i < requiredToken.length; i++) {
      mismatch |= provided.charCodeAt(i) ^ requiredToken.charCodeAt(i);
    }
    return mismatch === 0;
  } catch {
    return false;
  }
}

/** Handle a new extension WebSocket connection. */
export function handleCentrisExtensionConnection(ws: WebSocket, _req: IncomingMessage): void {
  if (extensionWs && extensionWs.readyState === extensionWs.OPEN) {
    // Only one extension at a time — close the old connection
    logWarn("[centris-ext-bridge] replacing existing extension connection");
    try {
      extensionWs.close(1000, "replaced by new connection");
    } catch {
      // ignore
    }
    rejectAllPending("extension reconnected");
  }

  extensionWs = ws;
  logInfo("[centris-ext-bridge] extension connected");

  // Notify anyone waiting for reconnection
  for (const cb of reconnectWaiters.splice(0)) {
    cb();
  }

  // Send handshake acknowledgment so the extension knows we're ready
  ws.send(JSON.stringify({ type: "handshake_ack" }));

  // Start server-side ping to keep the WebSocket (and MV3 service worker) alive
  if (pingInterval) {
    clearInterval(pingInterval);
  }
  lastPongAt = Date.now(); // assume alive on connect
  pingInterval = setInterval(() => {
    if (extensionWs && extensionWs.readyState === extensionWs.OPEN) {
      // Detect stale connections: no pong in 3 ping cycles means the extension is gone
      const pongAge = Date.now() - lastPongAt;
      if (pongAge > PING_INTERVAL_MS * 3) {
        logWarn(
          `[centris-ext-bridge] extension pong stale (${Math.round(pongAge / 1000)}s), closing`,
        );
        try {
          extensionWs.close(1000, "pong timeout");
        } catch {
          /* ignore */
        }
        return;
      }
      try {
        extensionWs.send(JSON.stringify({ type: "ping", timestamp: Date.now() }));
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

      // Handle extension_ready handshake
      if (msg.type === "extension_ready") {
        logInfo(`[centris-ext-bridge] extension handshake received (v=${String(msg.version)})`);
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
          logDebug(`[centris-ext-bridge] response for unknown id: ${msg.id}`);
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
                : "extension command failed";
          entry.reject(new Error(errMsg));
        } else {
          entry.resolve(msg.data ?? msg);
        }
        return;
      }

      // Log unknown messages
      logDebug(`[centris-ext-bridge] unhandled message type: ${String(msg.type)}`);
    } catch (err) {
      logError(
        `[centris-ext-bridge] message parse error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });

  ws.on("close", () => {
    logInfo("[centris-ext-bridge] extension disconnected");
    extensionWs = null;
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
    rejectAllPending("extension disconnected");
  });

  ws.on("error", (err) => {
    logError(`[centris-ext-bridge] websocket error: ${err.message}`);
  });
}

function rejectAllPending(reason: string): void {
  for (const [_id, entry] of pending) {
    clearTimeout(entry.timer);
    entry.reject(new Error(reason));
  }
  pending.clear();
}
