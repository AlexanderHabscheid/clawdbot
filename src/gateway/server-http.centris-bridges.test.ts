import { createServer as createNetServer } from "node:net";
import { describe, expect, test } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import type { ResolvedGatewayAuth } from "./auth.js";
import type { GatewayWsClient } from "./server/ws-types.js";
import { rawDataToString } from "../infra/ws.js";
import { attachGatewayUpgradeHandler, createGatewayHttpServer } from "./server-http.js";

async function listen(server: ReturnType<typeof createGatewayHttpServer>): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => {
      server.off("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    port,
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    },
  };
}

async function canBindLoopback(): Promise<boolean> {
  const probe = createNetServer();
  try {
    await new Promise<void>((resolve, reject) => {
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", () => resolve());
    });
    return true;
  } catch {
    return false;
  } finally {
    probe.close();
  }
}

function waitForWsOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ws open timeout")), 10_000);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function waitForCommand(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("command timeout")), 10_000);
    const handler = (raw: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(rawDataToString(raw)) as Record<string, unknown>;
        // Ignore protocol keepalive/handshake noise; return only action commands.
        if (msg.type === "handshake_ack" || msg.type === "ping" || msg.type === "pong") {
          return;
        }
        clearTimeout(timer);
        ws.off("message", handler);
        resolve(msg);
      } catch (err) {
        clearTimeout(timer);
        ws.off("message", handler);
        reject(err);
      }
    };
    ws.on("message", handler);
    ws.once("error", (err) => {
      clearTimeout(timer);
      ws.off("message", handler);
      reject(err);
    });
  });
}

function createHarness() {
  const resolvedAuth: ResolvedGatewayAuth = {
    mode: "token",
    token: "test-token",
    password: undefined,
    allowTailscale: false,
  };
  const clients = new Set<GatewayWsClient>();
  const httpServer = createGatewayHttpServer({
    canvasHost: null,
    clients,
    controlUiEnabled: false,
    controlUiBasePath: "/__control__",
    openAiChatCompletionsEnabled: false,
    openResponsesEnabled: false,
    handleHooksRequest: async () => false,
    resolvedAuth,
  });
  const wss = new WebSocketServer({ noServer: true });
  attachGatewayUpgradeHandler({
    httpServer,
    wss,
    canvasHost: null,
    clients,
    resolvedAuth,
  });
  return { httpServer, wss };
}

function resolveBridgeTokenForTest(): string {
  return (
    process.env.CENTRIS_EXTENSION_TOKEN?.trim() ||
    process.env.OPENCLAW_GATEWAY_TOKEN?.trim() ||
    process.env.CENTRIS_GATEWAY_TOKEN?.trim() ||
    ""
  );
}

describe("gateway centris bridges e2e", () => {
  test("observe routes through extension bridge over real ws", async () => {
    if (!(await canBindLoopback())) {
      return;
    }
    const { httpServer, wss } = createHarness();
    const listener = await listen(httpServer);
    const bridgeToken = resolveBridgeTokenForTest();
    const extWs = new WebSocket(
      `ws://127.0.0.1:${listener.port}/ws/centris/extension${
        bridgeToken ? `?token=${encodeURIComponent(bridgeToken)}` : ""
      }`,
    );

    try {
      await waitForWsOpen(extWs);
      extWs.send(
        JSON.stringify({
          type: "extension_ready",
          version: "test",
          capabilities: ["snapshot"],
        }),
      );

      const apiCall = fetch(`http://127.0.0.1:${listener.port}/api/v1/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          specVersion: "2026-02-19",
          method: "observe",
          id: "obs-1",
          params: { instruction: "find search bar" },
        }),
      });

      const cmd = await waitForCommand(extWs);
      expect(cmd.type).toBe("get_interactive_snapshot");
      expect(typeof cmd.id).toBe("string");

      extWs.send(
        JSON.stringify({
          type: "response",
          id: cmd.id,
          success: true,
          data: {
            url: "https://example.com",
            title: "Example",
            interactiveNodes: [{ id: 1, t: "input", n: "Search", r: "textbox" }],
          },
        }),
      );

      const res = await apiCall;
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        method: string;
        result: { interactive: Array<Record<string, unknown>> };
      };
      expect(body.ok).toBe(true);
      expect(body.method).toBe("observe");
      expect(Array.isArray(body.result.interactive)).toBe(true);
      expect(body.result.interactive.length).toBeGreaterThan(0);
    } finally {
      extWs.terminate();
      await listener.close();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    }
  });

  test("desktop.apps routes through desktop bridge over real ws", async () => {
    if (!(await canBindLoopback())) {
      return;
    }
    const { httpServer, wss } = createHarness();
    const listener = await listen(httpServer);
    const bridgeToken = resolveBridgeTokenForTest();
    const desktopWs = new WebSocket(
      `ws://127.0.0.1:${listener.port}/ws/centris/desktop${
        bridgeToken ? `?token=${encodeURIComponent(bridgeToken)}` : ""
      }`,
    );

    try {
      await waitForWsOpen(desktopWs);
      desktopWs.send(
        JSON.stringify({
          type: "desktop_ready",
          version: "test",
          capabilities: ["list_apps"],
        }),
      );

      const apiCall = fetch(`http://127.0.0.1:${listener.port}/api/v1/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          specVersion: "2026-02-19",
          method: "desktop.apps",
          id: "desk-1",
          params: {},
        }),
      });

      const cmd = await waitForCommand(desktopWs);
      expect(cmd.type).toBe("list_apps");
      expect(typeof cmd.id).toBe("string");

      desktopWs.send(
        JSON.stringify({
          type: "response",
          id: cmd.id,
          success: true,
          data: [{ name: "Finder", pid: 123, bundleId: "com.apple.finder", active: true }],
        }),
      );

      const res = await apiCall;
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        method: string;
        result: { apps: Array<Record<string, unknown>> };
      };
      expect(body.ok).toBe(true);
      expect(body.method).toBe("desktop.apps");
      expect(body.result.apps.length).toBe(1);
      expect(body.result.apps[0]?.name).toBe("Finder");
    } finally {
      desktopWs.terminate();
      await listener.close();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    }
  });
});
