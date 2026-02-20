#!/usr/bin/env bun
import { randomUUID } from "node:crypto";
import { createArgReader } from "./gateway-ws-client.ts";

type SmokeSummary = {
  url: string;
  intent: string;
  baseUrl: string;
  index: { ok: boolean; cacheKey?: string };
  resolve: { hit: boolean; cacheKey?: string };
  execute: { ok: boolean; source?: string };
  stats: { entries: number; hits: number; misses: number };
  invalidate: { ok: boolean; invalidated: number };
};

function assertOrThrow(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function getDefaultUrl(): string {
  return `https://example.com/smoke/${Date.now()}`;
}

async function main() {
  const { get: getArg } = createArgReader();
  const baseUrl = getArg("--base-url") ?? process.env.CENTRIS_API_URL ?? "http://localhost:7777";
  const apiKey = getArg("--api-key") ?? process.env.CENTRIS_API_KEY;
  const bearerToken = getArg("--bearer-token") ?? process.env.OPENCLAW_GATEWAY_TOKEN;
  const apiVersion = getArg("--api-version") ?? process.env.CENTRIS_API_VERSION ?? "2026-02-19";
  const url = getArg("--url") ?? getDefaultUrl();
  const intent = getArg("--intent") ?? `smoke-${randomUUID().slice(0, 8)}`;
  const strictArtifact = (getArg("--strict-artifact") ?? "").toLowerCase() === "true";
  const requestIdPrefix = `wm-smoke-${Date.now()}`;

  if (!apiKey && !bearerToken) {
    throw new Error(
      "Missing auth. Provide --api-key or --bearer-token, or set CENTRIS_API_KEY/OPENCLAW_GATEWAY_TOKEN.",
    );
  }

  async function callActionApi<TParams extends Record<string, unknown>, TResult>(
    method: string,
    params: TParams,
  ): Promise<TResult> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept-Version": apiVersion,
    };
    if (apiKey) {
      headers["X-Centris-Key"] = apiKey;
    }
    if (bearerToken) {
      headers.Authorization = `Bearer ${bearerToken}`;
    }
    const response = await fetch(`${baseUrl}/api/v1/action`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        specVersion: apiVersion,
        id: `${requestIdPrefix}-${method}`,
        method,
        params,
      }),
    });
    const payload = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}: ${JSON.stringify(payload.error ?? payload, null, 0)}`,
      );
    }
    if (!payload.ok || typeof payload.result !== "object" || payload.result === null) {
      throw new Error(`Action API error: ${JSON.stringify(payload.error ?? payload, null, 0)}`);
    }
    return payload.result as TResult;
  }

  const summary: SmokeSummary = {
    url,
    intent,
    baseUrl,
    index: { ok: false },
    resolve: { hit: false },
    execute: { ok: false },
    stats: { entries: 0, hits: 0, misses: 0 },
    invalidate: { ok: false, invalidated: 0 },
  };

  try {
    const indexResult = await callActionApi<
      {
        url: string;
        intent: string;
        playbook: Record<string, unknown>;
        ttlMs: number;
        metadata: Record<string, unknown>;
      },
      {
        ok: boolean;
        cacheKey?: string;
        artifact?: { artifactType?: string };
      }
    >("web.memory.index", {
      url,
      intent,
      playbook: {
        app: "web-memory-smoke",
        version: "v1",
        actions: [{ operation: "noop", description: "smoke step" }],
      },
      ttlMs: 5 * 60 * 1000,
      metadata: {
        source: "scripts/dev/web-memory-smoke.ts",
      },
    });
    assertOrThrow(indexResult.ok, "index step failed");
    summary.index = { ok: indexResult.ok, cacheKey: indexResult.cacheKey };
    if (strictArtifact) {
      assertOrThrow(
        indexResult.artifact?.artifactType === "web.playbook.ref",
        "index artifact_type must be web.playbook.ref",
      );
    }

    const resolveResult = await callActionApi<
      { url: string; intent: string; maxAgeMs: number },
      {
        hit: boolean;
        cacheKey?: string;
        artifact?: { artifactType?: string };
      }
    >("web.memory.resolve", {
      url,
      intent,
      maxAgeMs: 5 * 60 * 1000,
    });
    assertOrThrow(resolveResult.hit, "resolve step expected hit=true");
    summary.resolve = { hit: resolveResult.hit, cacheKey: resolveResult.cacheKey };
    if (strictArtifact) {
      assertOrThrow(
        resolveResult.artifact?.artifactType === "web.playbook.ref",
        "resolve artifact_type must be web.playbook.ref",
      );
    }

    const executeResult = await callActionApi<
      { url: string; intent: string; operation: string; params: { smoke: boolean } },
      { ok: boolean; source?: string }
    >("web.memory.execute", {
      url,
      intent,
      operation: "noop",
      params: { smoke: true },
    });
    assertOrThrow(executeResult.ok, "execute step failed");
    summary.execute = { ok: executeResult.ok, source: executeResult.source };

    const statsResult = await callActionApi<
      { url: string; window: "24h" },
      { entries: number; hits: number; misses: number }
    >("web.memory.stats", {
      url,
      window: "24h",
    });
    summary.stats = {
      entries: statsResult.entries,
      hits: statsResult.hits,
      misses: statsResult.misses,
    };
    assertOrThrow(Number.isFinite(statsResult.entries), "stats.entries must be numeric");
    assertOrThrow(Number.isFinite(statsResult.hits), "stats.hits must be numeric");
    assertOrThrow(Number.isFinite(statsResult.misses), "stats.misses must be numeric");
  } finally {
    try {
      const invalidateResult = await callActionApi<
        { url: string; scope: "url"; reason: string },
        { ok: boolean; invalidated: number }
      >("web.memory.invalidate", {
        url,
        scope: "url",
        reason: "web-memory smoke cleanup",
      });
      summary.invalidate = {
        ok: invalidateResult.ok,
        invalidated: invalidateResult.invalidated,
      };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`[warn] cleanup invalidate failed: ${String(error)}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(
    `[web-memory-smoke] failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
