import Module from "node:module";
import { createRequire } from "node:module";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

type IpcHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

const requireFromHere = createRequire(import.meta.url);
const IPC_HANDLERS_PATH = path.resolve(process.cwd(), "desktop/src/helpers/ipcHandlers.js");

function loadIpcHandlersWithMocks() {
  const handlers = new Map<string, IpcHandler>();
  const ipcMain = {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      handlers.set(channel, handler);
    }),
  };

  const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
  (Module as unknown as { _load: typeof Module._load })._load = function patched(
    request: string,
    parent: NodeModule | null,
    isMain: boolean,
  ) {
    if (request === "electron") {
      return {
        ipcMain,
        app: { dock: { show: () => {} } },
        shell: {},
        BrowserWindow: { getAllWindows: () => [] },
        screen: {},
        systemPreferences: {},
      };
    }
    if (request === "../utils") {
      return { cleanup: () => {} };
    }
    if (request === "./debugLogger") {
      return { log: () => {}, error: () => {}, logReasoning: () => {} };
    }
    if (request === "../utils/logger") {
      return { default: { log: () => {}, warn: () => {}, error: () => {} } };
    }
    if (request === "../services/audioTestService") {
      return class MockAudioTestService {};
    }
    if (request === "./backendManager") {
      return {
        backendManager: {
          backendUrl: "http://127.0.0.1:18789",
          checkBackendHealth: async () => true,
          checkBackendRunning: async () => true,
          ensureBackendRunning: async () => true,
          getStatus: async () => ({
            running: true,
            healthy: true,
            portInUse: true,
            starting: false,
          }),
          startBackend: async () => true,
          stopBackend: async () => {},
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    delete requireFromHere.cache[requireFromHere.resolve(IPC_HANDLERS_PATH)];
    const loaded = requireFromHere(IPC_HANDLERS_PATH);
    const IPCHandlers = loaded?.default || loaded;
    return { IPCHandlers, handlers, ipcMain };
  } finally {
    (Module as unknown as { _load: typeof Module._load })._load = originalLoad;
  }
}

describe("desktop ipc action api integration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.OPENCLAW_GATEWAY_TOKEN;
    delete process.env.CENTRIS_GATEWAY_TOKEN;
    delete process.env.CENTRIS_GATEWAY_URL;
  });

  it("registers action authority ipc channels", () => {
    const { IPCHandlers, handlers } = loadIpcHandlersWithMocks();
    new IPCHandlers({
      environmentManager: {},
      databaseManager: {},
      clipboardManager: {},
      windowManager: {},
    });

    expect(handlers.has("action-api-call")).toBe(true);
    expect(handlers.has("action-observe")).toBe(true);
    expect(handlers.has("action-act")).toBe(true);
    expect(handlers.has("action-verify")).toBe(true);
    expect(handlers.has("action-route-run")).toBe(true);
    expect(handlers.has("action-route-record-start")).toBe(true);
    expect(handlers.has("action-route-record-stop")).toBe(true);
  });

  it("forwards observe calls to /api/v1/action with auth header", async () => {
    const { IPCHandlers, handlers } = loadIpcHandlersWithMocks();
    process.env.OPENCLAW_GATEWAY_TOKEN = "test-token";
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () =>
        JSON.stringify({
          specVersion: "2026-02-19",
          method: "observe",
          ok: true,
          result: { connected: true },
        }),
    }));
    // @ts-expect-error test-only global mock
    global.fetch = fetchMock;

    new IPCHandlers({
      environmentManager: {},
      databaseManager: {},
      clipboardManager: {},
      windowManager: {},
    });

    const handler = handlers.get("action-observe");
    expect(handler).toBeTruthy();
    const response = (await handler?.({}, { instruction: "health probe" })) as {
      ok: boolean;
      method: string;
    };

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:18789/api/v1/action");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
    expect(typeof init.body).toBe("string");
    const payload = JSON.parse(init.body as string);
    expect(payload.method).toBe("observe");
    expect(payload.params.instruction).toBe("health probe");
    expect(response.ok).toBe(true);
    expect(response.method).toBe("observe");
  });

  it("returns structured error when gateway responds with non-2xx", async () => {
    const { IPCHandlers, handlers } = loadIpcHandlersWithMocks();
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 503,
      text: async () => JSON.stringify({ error: { code: "DOWN", message: "gateway unavailable" } }),
    }));
    // @ts-expect-error test-only global mock
    global.fetch = fetchMock;

    new IPCHandlers({
      environmentManager: {},
      databaseManager: {},
      clipboardManager: {},
      windowManager: {},
    });

    const handler = handlers.get("action-route-run");
    const response = (await handler?.({}, { routeId: "invoice.download" })) as {
      ok: boolean;
      error?: { code: string; message: string };
    };

    expect(response.ok).toBe(false);
    expect(response.error?.code).toBe("DOWN");
    expect(response.error?.message).toContain("gateway unavailable");
  });

  it("transcribe-centris-audio fallback calls OpenAI transcription and returns text", async () => {
    const { IPCHandlers, handlers } = loadIpcHandlersWithMocks();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ text: "open settings and enable dark mode" }),
    }));
    // @ts-expect-error test-only global mock
    global.fetch = fetchMock;

    new IPCHandlers({
      environmentManager: {
        getOpenAIKey: async () => "sk-test-fallback",
      },
      databaseManager: {},
      clipboardManager: {},
      windowManager: {},
    });

    const handler = handlers.get("transcribe-centris-audio");
    expect(handler).toBeTruthy();
    const audio = new Uint8Array([1, 2, 3, 4, 5]);
    const response = (await handler?.({}, audio)) as {
      success: boolean;
      text?: string;
      source?: string;
    };

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test-fallback");
    expect(response.success).toBe(true);
    expect(response.text).toBe("open settings and enable dark mode");
    expect(response.source).toBe("openai-fallback");
  });
});
