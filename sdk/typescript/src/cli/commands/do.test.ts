import { afterEach, describe, expect, it, vi } from "vitest";
import type { CLIContext } from "../types.js";
import { runDoCommand } from "./do.js";

function createContext(): { ctx: CLIContext; lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    ctx: {
      cwd: process.cwd(),
      verbose: false,
      logger: {
        info: (message: string) => lines.push(`info:${message}`),
        success: (message: string) => lines.push(`success:${message}`),
        warn: (message: string) => lines.push(`warn:${message}`),
        error: (message: string) => lines.push(`error:${message}`),
        debug: () => {},
      },
    },
  };
}

describe("runDoCommand", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("executes command and logs success text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            task_id: "ctask_1",
            status: "completed",
            result: "done",
            actions: [],
          }),
          { status: 200 },
        ),
      ),
    );

    const { ctx, lines } = createContext();
    await runDoCommand(
      {
        command: "Open mail",
        apiKey: "ck_live_test",
        baseUrl: "https://api.example.com",
      },
      ctx,
    );

    expect(lines.some((line) => line.includes("success:done"))).toBe(true);
  });

  it("waits for queued async tasks when wait=true", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              task_id: "ctask_2",
              status: "queued",
              result: "",
              actions: [],
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              status: "completed",
              result: "final",
              actions: [],
            }),
            { status: 200 },
          ),
        ),
    );

    const { ctx, lines } = createContext();
    await runDoCommand(
      {
        command: "Async task",
        apiKey: "ck_live_test",
        baseUrl: "https://api.example.com",
        asyncMode: true,
        wait: true,
        pollIntervalMs: 0,
      },
      ctx,
    );

    expect(lines.some((line) => line.includes("success:final"))).toBe(true);
  });

  it("prints json when requested", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            task_id: "ctask_3",
            status: "completed",
            result: "json-output",
            actions: [],
          }),
          { status: 200 },
        ),
      ),
    );
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { ctx } = createContext();
    await runDoCommand(
      {
        command: "Output json",
        apiKey: "ck_live_test",
        baseUrl: "https://api.example.com",
        json: true,
      },
      ctx,
    );

    expect(logSpy).toHaveBeenCalledOnce();
    expect(String(logSpy.mock.calls[0]?.[0])).toContain("ctask_3");
  });
});
