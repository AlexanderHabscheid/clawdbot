import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthenticationError, Centris, DEFAULT_API_VERSION, do as runDo } from "./index.js";

describe("Centris client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("executes do() with expected headers and parses result", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          task_id: "ctask_123",
          status: "completed",
          result: "done",
          actions: [{ type: "click" }],
        }),
        {
          status: 200,
          headers: {
            "X-API-Version": "2026-01-30",
          },
        },
      ),
    );

    const client = new Centris({
      apiKey: "ck_live_test",
      baseUrl: "https://api.example.com",
      fetchImpl,
    });

    const result = await client.do("Open Gmail");
    expect(result.taskId).toBe("ctask_123");
    expect(result.text).toBe("done");
    expect(result.apiVersion).toBe("2026-01-30");

    const requestInit = fetchImpl.mock.calls[0]?.[1];
    const headers = (requestInit?.headers ?? {}) as Record<string, string>;
    expect(headers["X-Centris-Key"]).toBe("ck_live_test");
    expect(headers["Accept-Version"]).toBe(DEFAULT_API_VERSION);
  });

  it("polls wait() until task completes", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "running" }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "completed",
            result: "all done",
            actions: [],
          }),
          { status: 200 },
        ),
      );

    const client = new Centris({
      apiKey: "ck_live_test",
      baseUrl: "https://api.example.com",
      fetchImpl,
    });

    const result = await client.wait("ctask_abc", {
      pollIntervalMs: 0,
      timeoutMs: 500,
    });
    expect(result.status).toBe("completed");
    expect(result.text).toBe("all done");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws AuthenticationError on 401", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "bad key",
          task_id: "ctask_bad",
        }),
        { status: 401 },
      ),
    );

    const client = new Centris({
      apiKey: "ck_bad",
      baseUrl: "https://api.example.com",
      fetchImpl,
    });

    await expect(client.do("Ping")).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("fires deprecation callback with successor endpoint", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          task_id: "ctask_123",
          status: "completed",
          result: "ok",
          actions: [],
        }),
        {
          status: 200,
          headers: {
            Deprecation: "true",
            Sunset: "2026-06-01",
            Link: '</api/v2/do>; rel="successor-version"',
          },
        },
      ),
    );

    const callback = vi.fn();
    const client = new Centris({
      apiKey: "ck_live_test",
      baseUrl: "https://api.example.com",
      fetchImpl,
    }).onDeprecation(callback);

    await client.do("Ping");
    expect(callback).toHaveBeenCalledWith("/api/v1/do", "2026-06-01", "/api/v2/do");
  });

  it("supports one-off do() helper", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          task_id: "ctask_helper",
          status: "completed",
          result: "helper",
          actions: [],
        }),
        { status: 200 },
      ),
    );

    const result = await runDo("Open app", {
      apiKey: "ck_live_test",
      baseUrl: "https://api.example.com",
      fetchImpl,
    });
    expect(result.taskId).toBe("ctask_helper");
  });

  it("dispatches action API envelopes for observe/act/verify/route", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            specVersion: "2026-02-19",
            method: "observe",
            ok: true,
            result: { url: "https://example.com", interactive: [] },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            specVersion: "2026-02-19",
            method: "act",
            ok: true,
            result: { ok: true },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            specVersion: "2026-02-19",
            method: "verify",
            ok: true,
            result: { ok: true, passed: [], failed: [] },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            specVersion: "2026-02-19",
            method: "route.run",
            ok: true,
            result: { ok: true, executed: 2 },
          }),
          { status: 200 },
        ),
      );

    const client = new Centris({
      apiKey: "ck_live_test",
      baseUrl: "https://api.example.com",
      fetchImpl,
    });

    await client.observe({ url: "https://example.com" });
    await client.act({ kind: "click", target: "#submit" });
    await client.verify({ checks: [] });
    await client.routeRun({ routeId: "download_invoice" });

    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(fetchImpl.mock.calls[0]?.[0]).toContain("/api/v1/action");
    expect(fetchImpl.mock.calls[1]?.[0]).toContain("/api/v1/action");
  });
});
