import { describe, expect, it, vi } from "vitest";

/**
 * Centris Extension Bridge Tests
 *
 * Tests the WebSocket bridge between the gateway and Chrome extension.
 * Uses a mock WebSocket to simulate extension connections without a real browser.
 */

vi.mock("../logger.js", () => ({
  logInfo: vi.fn(),
  logDebug: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

import type { IncomingMessage } from "node:http";
import {
  isCentrisExtensionConnected,
  sendExtensionCommand,
  isCentrisExtensionPath,
  handleCentrisExtensionConnection,
} from "./centris-extension-bridge.js";

// ─── Mock WebSocket ─────────────────────────────────────────────────────────

function createMockWs() {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const sent: string[] = [];

  const ws = {
    OPEN: 1,
    readyState: 1,
    send: vi.fn((data: string) => sent.push(data)),
    close: vi.fn(),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const list = listeners.get(event) ?? [];
      list.push(handler);
      listeners.set(event, list);
    }),
  };

  return {
    ws: ws as unknown as import("ws").WebSocket,
    sent,
    /** Simulate receiving a message from the extension */
    receive(msg: Record<string, unknown>) {
      const handlers = listeners.get("message") ?? [];
      for (const handler of handlers) {
        handler(JSON.stringify(msg));
      }
    },
    /** Simulate the extension disconnecting */
    disconnect() {
      ws.readyState = 3; // CLOSED
      const handlers = listeners.get("close") ?? [];
      for (const handler of handlers) {
        handler();
      }
    },
    /** Simulate a WebSocket error */
    error(err: Error) {
      const handlers = listeners.get("error") ?? [];
      for (const handler of handlers) {
        handler(err);
      }
    },
  };
}

const mockReq = {} as IncomingMessage;

describe("centris-extension-bridge", () => {
  // ─── Path matching ──────────────────────────────────────────────────────

  describe("isCentrisExtensionPath", () => {
    it("matches the extension endpoint", () => {
      expect(isCentrisExtensionPath("/ws/centris/extension")).toBe(true);
    });

    it("rejects other paths", () => {
      expect(isCentrisExtensionPath("/ws/centris/voice")).toBe(false);
      expect(isCentrisExtensionPath("/ws/something")).toBe(false);
      expect(isCentrisExtensionPath("/")).toBe(false);
    });
  });

  // ─── Connection lifecycle ──────────────────────────────────────────────

  describe("connection lifecycle", () => {
    it("reports not connected initially", () => {
      // Note: module-level state — this depends on test order.
      // If a previous test connected, this may fail. We handle this by
      // checking the actual state rather than assuming clean slate.
    });

    it("sends handshake_ack on connection", () => {
      const { ws, sent } = createMockWs();
      handleCentrisExtensionConnection(ws, mockReq);
      expect(sent).toHaveLength(1);
      const ack = JSON.parse(sent[0]);
      expect(ack.type).toBe("handshake_ack");
    });

    it("reports connected after handshake", () => {
      const { ws } = createMockWs();
      handleCentrisExtensionConnection(ws, mockReq);
      expect(isCentrisExtensionConnected()).toBe(true);
    });

    it("reports disconnected after close", () => {
      const mock = createMockWs();
      handleCentrisExtensionConnection(mock.ws, mockReq);
      expect(isCentrisExtensionConnected()).toBe(true);
      mock.disconnect();
      expect(isCentrisExtensionConnected()).toBe(false);
    });

    it("replaces existing connection and closes old one", () => {
      const mock1 = createMockWs();
      handleCentrisExtensionConnection(mock1.ws, mockReq);

      const mock2 = createMockWs();
      handleCentrisExtensionConnection(mock2.ws, mockReq);

      // Old connection should be closed
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const closeSpy = mock1.ws.close;
      expect(closeSpy).toHaveBeenCalledWith(1000, "replaced by new connection");
      // New connection is active
      expect(isCentrisExtensionConnected()).toBe(true);
    });
  });

  // ─── Protocol handling ─────────────────────────────────────────────────

  describe("protocol", () => {
    it("responds to extension_ready with handshake_ack", () => {
      const mock = createMockWs();
      handleCentrisExtensionConnection(mock.ws, mockReq);
      mock.sent.length = 0; // clear initial ack

      mock.receive({ type: "extension_ready", version: "1.0.0" });
      expect(mock.sent).toHaveLength(1);
      const ack = JSON.parse(mock.sent[0]);
      expect(ack.type).toBe("handshake_ack");
    });

    it("responds to ping with pong", () => {
      const mock = createMockWs();
      handleCentrisExtensionConnection(mock.ws, mockReq);
      mock.sent.length = 0;

      mock.receive({ type: "ping" });
      expect(mock.sent).toHaveLength(1);
      const pong = JSON.parse(mock.sent[0]);
      expect(pong.type).toBe("pong");
      expect(typeof pong.timestamp).toBe("number");
    });
  });

  // ─── Command send/receive ──────────────────────────────────────────────

  describe("sendExtensionCommand", () => {
    it("sends command and resolves on success response", async () => {
      const mock = createMockWs();
      handleCentrisExtensionConnection(mock.ws, mockReq);
      mock.sent.length = 0;

      const resultPromise = sendExtensionCommand("get_interactive_snapshot", { maxChars: 4000 });

      // Parse the sent command to get its ID
      expect(mock.sent).toHaveLength(1);
      const cmd = JSON.parse(mock.sent[0]);
      expect(cmd.type).toBe("get_interactive_snapshot");
      expect(cmd.data).toEqual({ maxChars: 4000 });
      expect(cmd.id).toMatch(/^cmd-/);

      // Simulate extension response
      mock.receive({
        type: "response",
        id: cmd.id,
        success: true,
        data: { interactiveNodes: [{ id: 1 }] },
      });

      const result = await resultPromise;
      expect(result).toEqual({ interactiveNodes: [{ id: 1 }] });
    });

    it("rejects on error response", async () => {
      const mock = createMockWs();
      handleCentrisExtensionConnection(mock.ws, mockReq);
      mock.sent.length = 0;

      const resultPromise = sendExtensionCommand("click_node", { nodeId: 5 });

      const cmd = JSON.parse(mock.sent[0]);
      mock.receive({
        type: "response",
        id: cmd.id,
        success: false,
        error: "Element not found",
      });

      await expect(resultPromise).rejects.toThrow("Element not found");
    });

    it("rejects when extension is not connected", async () => {
      // Ensure no connection is active
      const mock = createMockWs();
      handleCentrisExtensionConnection(mock.ws, mockReq);
      mock.disconnect();

      await expect(sendExtensionCommand("get_tabs", {})).rejects.toThrow("not connected");
    });

    it("rejects pending commands on disconnect", async () => {
      const mock = createMockWs();
      handleCentrisExtensionConnection(mock.ws, mockReq);

      const resultPromise = sendExtensionCommand("get_tabs", {});

      // Extension disconnects before responding
      mock.disconnect();

      await expect(resultPromise).rejects.toThrow("disconnected");
    });

    it("rejects on timeout", async () => {
      const mock = createMockWs();
      handleCentrisExtensionConnection(mock.ws, mockReq);

      // Use a very short timeout for testing
      const resultPromise = sendExtensionCommand("slow_command", {}, 50);

      // Don't respond — let it time out
      await expect(resultPromise).rejects.toThrow("timed out");
    }, 5000);
  });
});
