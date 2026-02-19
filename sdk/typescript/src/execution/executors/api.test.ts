import { afterEach, describe, expect, it, vi } from "vitest";
import { APIExecutor } from "./api.js";

describe("APIExecutor", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns NO_ENDPOINT when endpointUrl is missing", async () => {
    const executor = new APIExecutor();
    const result = await executor.execute("slack", "send", {}, {});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NO_ENDPOINT");
    }
  });

  it("executes endpoint and returns result payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ result: { ok: true, id: "123" } }), {
          status: 200,
        }),
      ),
    );

    const executor = new APIExecutor();
    const result = await executor.execute(
      "slack",
      "send",
      { channel: "#general" },
      {
        endpointUrl: "https://connector.example.com",
        auth: { accessToken: "token_123" },
        userId: "u1",
        sessionId: "s1",
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ ok: true, id: "123" });
    }
  });

  it("maps http failures to executorError with retryable server errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ error: "upstream down" }), {
          status: 503,
        }),
      ),
    );

    const executor = new APIExecutor();
    const result = await executor.execute(
      "slack",
      "send",
      { channel: "#general" },
      {
        endpointUrl: "https://connector.example.com",
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("HTTP_503");
      expect(result.error.retryable).toBe(true);
    }
  });
});
