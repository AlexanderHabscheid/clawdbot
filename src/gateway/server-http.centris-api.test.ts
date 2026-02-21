import type { IncomingMessage, ServerResponse } from "node:http";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ResolvedGatewayAuth } from "./auth.js";

const { readJsonBodyMock, agentCommandMock } = vi.hoisted(() => ({
  readJsonBodyMock: vi.fn(),
  agentCommandMock: vi.fn(),
}));

vi.mock("./hooks.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./hooks.js")>();
  return {
    ...actual,
    readJsonBody: readJsonBodyMock,
  };
});

vi.mock("../commands/agent.js", () => ({
  agentCommand: (...args: unknown[]) => agentCommandMock(...args),
}));

import { createGatewayHttpServer } from "./server-http.js";

function stringFromJson(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function createRequest(params: {
  path: string;
  method?: string;
  headers?: Record<string, string>;
}): IncomingMessage {
  return {
    method: params.method ?? "GET",
    url: params.path,
    headers: {
      host: "localhost:18789",
      ...params.headers,
    },
    socket: { remoteAddress: "127.0.0.1" },
  } as IncomingMessage;
}

function createResponse(): {
  res: ServerResponse;
  setHeader: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  getBody: () => string;
} {
  const setHeader = vi.fn();
  let body = "";
  const end = vi.fn((chunk?: unknown) => {
    if (typeof chunk === "string") {
      body = chunk;
      return;
    }
    if (chunk == null) {
      body = "";
      return;
    }
    body = JSON.stringify(chunk);
  });
  const res = {
    headersSent: false,
    statusCode: 200,
    setHeader,
    end,
  } as unknown as ServerResponse;
  return {
    res,
    setHeader,
    end,
    getBody: () => body,
  };
}

async function dispatchRequest(
  server: ReturnType<typeof createGatewayHttpServer>,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  server.emit("request", req, res);
  await new Promise((resolve) => setImmediate(resolve));
}

function createServer() {
  const resolvedAuth: ResolvedGatewayAuth = {
    mode: "token",
    token: "test-token",
    password: undefined,
    allowTailscale: false,
  };
  return createGatewayHttpServer({
    canvasHost: null,
    clients: new Set(),
    controlUiEnabled: false,
    controlUiBasePath: "/__control__",
    openAiChatCompletionsEnabled: false,
    openResponsesEnabled: false,
    handleHooksRequest: async () => false,
    resolvedAuth,
  });
}

describe("gateway centris compatibility HTTP endpoints", () => {
  beforeEach(() => {
    readJsonBodyMock.mockReset();
    agentCommandMock.mockReset();
  });

  test("POST /api/v1/do executes sync command and returns completed result", async () => {
    readJsonBodyMock.mockResolvedValueOnce({
      ok: true,
      value: { command: "Open Gmail", async: false, context: { user: "alice" } },
    });
    agentCommandMock.mockResolvedValueOnce({
      payloads: [{ text: "Opened Gmail." }],
      meta: { agentMeta: { usage: { input: 11, output: 7, total: 18 } } },
    });

    const server = createServer();
    const response = createResponse();

    await dispatchRequest(
      server,
      createRequest({ path: "/api/v1/do", method: "POST" }),
      response.res,
    );

    expect(response.res.statusCode).toBe(200);
    const json = JSON.parse(response.getBody()) as Record<string, unknown>;
    expect(json.status).toBe("completed");
    expect(typeof json.task_id).toBe("string");
    expect(json.result).toBe("Opened Gmail.");
    expect(Array.isArray(json.actions)).toBe(true);
    expect((json.usage as Record<string, unknown>).total).toBe(18);
    expect(response.setHeader).toHaveBeenCalledWith("X-API-Version", "2026-01-30");
    expect(agentCommandMock).toHaveBeenCalledTimes(1);
  });

  test("POST /api/v1/do async queues task and GET /api/v1/task/:id returns completion", async () => {
    readJsonBodyMock.mockResolvedValueOnce({
      ok: true,
      value: { command: "Check calendar", async: true },
    });
    agentCommandMock.mockResolvedValueOnce({
      payloads: [{ text: "Checked calendar." }],
      meta: { agentMeta: { usage: { input: 5, output: 3, total: 8 } } },
    });

    const server = createServer();
    const queuedResponse = createResponse();
    await dispatchRequest(
      server,
      createRequest({ path: "/api/v1/do", method: "POST" }),
      queuedResponse.res,
    );

    const queuedJson = JSON.parse(queuedResponse.getBody()) as Record<string, unknown>;
    expect(queuedJson.status).toBe("queued");
    const taskId = stringFromJson(queuedJson.task_id);
    expect(taskId).not.toBe("");

    let finalStatus = "";
    let finalBody: Record<string, unknown> = {};
    for (let i = 0; i < 8; i++) {
      const taskResponse = createResponse();
      await dispatchRequest(
        server,
        createRequest({ path: `/api/v1/task/${taskId}`, method: "GET" }),
        taskResponse.res,
      );
      finalBody = JSON.parse(taskResponse.getBody()) as Record<string, unknown>;
      finalStatus = stringFromJson(finalBody.status);
      if (finalStatus === "completed") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(finalStatus).toBe("completed");
    expect(finalBody.result).toBe("Checked calendar.");
    expect(agentCommandMock).toHaveBeenCalledTimes(1);
  });

  test("GET /api/v1/usage returns usage payload shape expected by SDK clients", async () => {
    const server = createServer();
    const response = createResponse();
    await dispatchRequest(
      server,
      createRequest({ path: "/api/v1/usage", method: "GET" }),
      response.res,
    );
    expect(response.res.statusCode).toBe(200);
    const json = JSON.parse(response.getBody()) as Record<string, unknown>;
    expect(typeof json.tier).toBe("string");
    expect(typeof json.tasks_remaining).toBe("number");
    expect(typeof json.monthly_limit).toBe("number");
  });

  test("POST /api/v1/do passes outputSchema from context to agentCommand", async () => {
    const schema = {
      type: "object",
      properties: {
        products: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" }, price: { type: "number" } },
          },
        },
      },
    };
    readJsonBodyMock.mockResolvedValueOnce({
      ok: true,
      value: {
        command: "Get first 3 products with name and price",
        async: false,
        context: { outputSchema: schema },
      },
    });
    agentCommandMock.mockResolvedValueOnce({
      payloads: [{ text: '{"products":[{"name":"Widget","price":9.99}]}' }],
      meta: { agentMeta: { usage: { input: 50, output: 30, total: 80 } } },
    });

    const server = createServer();
    const response = createResponse();

    await dispatchRequest(
      server,
      createRequest({ path: "/api/v1/do", method: "POST" }),
      response.res,
    );

    expect(response.res.statusCode).toBe(200);
    const json = JSON.parse(response.getBody()) as Record<string, unknown>;
    expect(json.status).toBe("completed");
    expect(agentCommandMock).toHaveBeenCalledTimes(1);
    const call = agentCommandMock.mock.calls[0];
    expect(call[0]).toMatchObject({
      message: "Get first 3 products with name and price",
      outputSchema: schema,
    });
  });

  test("POST /api/v1/do rejects unsupported Accept-Version", async () => {
    const server = createServer();
    const response = createResponse();
    await dispatchRequest(
      server,
      createRequest({
        path: "/api/v1/do",
        method: "POST",
        headers: { "accept-version": "2025-01-01" },
      }),
      response.res,
    );

    expect(response.res.statusCode).toBe(400);
    const json = JSON.parse(response.getBody()) as Record<string, unknown>;
    expect(json.code).toBe("VERSION_NOT_SUPPORTED");
  });
});
