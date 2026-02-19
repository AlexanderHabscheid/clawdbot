import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { persistLearnedRoute, updateLearnedRouteOutcome } from "./learned-routes.js";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs.length = 0;
});

describe("persistLearnedRoute", () => {
  it("creates a learned manifest and writes the learned action", () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "centris-learned-"));
    tmpDirs.push(baseDir);

    const res = persistLearnedRoute({
      baseDir,
      request: {
        id: "login",
        urlPattern: "https://example.com/*",
        steps: [{ click: "[data-testid='login']" }],
        checks: [{ type: "url_contains", value: "/dashboard" }],
      },
      now: new Date("2026-02-19T00:00:00.000Z"),
    });

    expect(res.ok).toBe(true);
    expect(res.app).toBe("example-com");
    const raw = fs.readFileSync(path.join(baseDir, "example-com", "centris.json"), "utf-8");
    const parsed = JSON.parse(raw) as {
      url_patterns: string[];
      routes: Record<
        string,
        {
          actions?: Record<
            string,
            { confidence?: number; lastVerifiedAt?: string; fallbackChains?: string[][] }
          >;
        }
      >;
    };
    expect(parsed.url_patterns).toContain("https://example.com/*");
    expect(parsed.routes["/*"]?.actions?.login?.confidence).toBe(0.675);
    expect(parsed.routes["/*"]?.actions?.login?.lastVerifiedAt).toBe("2026-02-19T00:00:00.000Z");
    expect(parsed.routes["/*"]?.actions?.login?.fallbackChains).toBeUndefined();
  });

  it("upserts an existing route action while preserving prior actions", () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "centris-learned-"));
    tmpDirs.push(baseDir);

    persistLearnedRoute({
      baseDir,
      request: {
        id: "search",
        urlPattern: "https://example.com/app/*",
        steps: [{ click: "[data-testid='search']" }],
      },
      now: new Date("2026-02-19T00:00:00.000Z"),
    });

    persistLearnedRoute({
      baseDir,
      request: {
        id: "compose",
        urlPattern: "https://example.com/app/*",
        steps: [{ click: "[data-testid='compose']" }],
        fallbackChains: [["[data-testid='compose']", "[aria-label='Compose']"]],
      },
      now: new Date("2026-02-19T00:01:00.000Z"),
    });

    const raw = fs.readFileSync(path.join(baseDir, "example-com", "centris.json"), "utf-8");
    const parsed = JSON.parse(raw) as {
      routes: Record<string, { actions?: Record<string, { fallbackChains?: string[][] }> }>;
    };
    expect(parsed.routes["/app/*"]?.actions?.search).toBeTruthy();
    expect(parsed.routes["/app/*"]?.actions?.compose).toBeTruthy();
    expect(parsed.routes["/app/*"]?.actions?.compose?.fallbackChains?.[0]?.[0]).toBe(
      "[data-testid='compose']",
    );
  });

  it("decays confidence over time and prunes stale low-confidence actions", () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "centris-learned-"));
    tmpDirs.push(baseDir);

    persistLearnedRoute({
      baseDir,
      request: {
        id: "flaky",
        urlPattern: "https://example.com/*",
        steps: [{ click: "[data-testid='flaky']" }],
      },
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    for (let i = 0; i < 8; i++) {
      updateLearnedRouteOutcome({
        baseDir,
        routeId: "flaky",
        urlPattern: "https://example.com/*",
        outcome: "failure",
        now: new Date(`2026-01-0${Math.min(i + 2, 9)}T00:00:00.000Z`),
      });
    }

    persistLearnedRoute({
      baseDir,
      request: {
        id: "healthy",
        urlPattern: "https://example.com/*",
        steps: [{ click: "[data-testid='healthy']" }],
      },
      now: new Date("2026-03-01T00:00:00.000Z"),
    });

    const raw = fs.readFileSync(path.join(baseDir, "example-com", "centris.json"), "utf-8");
    const parsed = JSON.parse(raw) as {
      routes: Record<string, { actions?: Record<string, { confidence?: number }> }>;
    };

    expect(parsed.routes["/*"]?.actions?.healthy).toBeTruthy();
    expect(parsed.routes["/*"]?.actions?.flaky).toBeFalsy();
  });
});
