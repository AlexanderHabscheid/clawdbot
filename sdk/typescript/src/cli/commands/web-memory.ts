import type {
  ActionWebMemoryExecuteRequest,
  ActionWebMemoryIndexRequest,
  ActionWebMemoryInvalidateRequest,
  ActionWebMemoryResolveRequest,
  ActionWebMemoryStatsRequest,
} from "../../action-api/index.js";
import type {
  CLIContext,
  WebMemoryExecuteOptions,
  WebMemoryIndexOptions,
  WebMemoryInvalidateOptions,
  WebMemoryResolveOptions,
  WebMemoryStatsOptions,
} from "../types.js";
import { Centris } from "../../client/index.js";
import { createCliResultEnvelope, printCliResultEnvelope } from "../result-envelope.js";

function createClient(options: {
  apiKey?: string;
  baseUrl?: string;
  apiVersion?: string;
  timeoutMs?: number;
}): Centris {
  return new Centris({
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    apiVersion: options.apiVersion,
    timeoutMs: options.timeoutMs,
  });
}

function parseJsonObject(raw: string | undefined, field: string): Record<string, unknown> {
  if (!raw || raw.trim().length === 0) {
    return {};
  }
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${field} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

export async function runWebMemoryIndexCommand(
  options: WebMemoryIndexOptions,
  ctx: CLIContext,
): Promise<void> {
  const startedAt = Date.now();
  const client = createClient(options);
  const payload: ActionWebMemoryIndexRequest = {
    url: options.url,
    intent: options.intent,
    ttlMs: options.ttlMs,
    ...(options.playbook ? { playbook: parseJsonObject(options.playbook, "playbook") } : {}),
    ...(options.metadata ? { metadata: parseJsonObject(options.metadata, "metadata") } : {}),
  };
  const result = await client.webMemory.index(payload);

  if (options.json) {
    printCliResultEnvelope(
      createCliResultEnvelope({
        ok: Boolean(result.ok),
        operation: "web.memory.index",
        summary: result.ok
          ? `Indexed web memory for ${options.url}`
          : `Failed to index web memory for ${options.url}`,
        data: result,
        errors: result.ok ? [] : ["web memory index failed"],
        durationMs: Date.now() - startedAt,
        safetyLevel: "write",
        artifacts: result.artifact ? [result.artifact] : [],
      }),
    );
    return;
  }

  if (!result.ok) {
    ctx.logger.error(`Web memory index failed for ${options.url}`);
    process.exit(1);
  }

  ctx.logger.success(`Indexed web memory for ${options.url}`);
  if (result.cacheKey) {
    ctx.logger.info(`Cache key: ${result.cacheKey}`);
  }
}

export async function runWebMemoryResolveCommand(
  options: WebMemoryResolveOptions,
  ctx: CLIContext,
): Promise<void> {
  const startedAt = Date.now();
  const client = createClient(options);
  const payload: ActionWebMemoryResolveRequest = {
    url: options.url,
    intent: options.intent,
    maxAgeMs: options.maxAgeMs,
  };
  const result = await client.webMemory.resolve(payload);

  if (options.json) {
    printCliResultEnvelope(
      createCliResultEnvelope({
        ok: true,
        operation: "web.memory.resolve",
        summary: result.hit
          ? `Resolved cached playbook for ${options.url}`
          : `No cached playbook found for ${options.url}`,
        data: result,
        durationMs: Date.now() - startedAt,
        safetyLevel: "read",
        artifacts: result.artifact ? [result.artifact] : [],
      }),
    );
    return;
  }

  if (!result.hit) {
    ctx.logger.warn(`No cached playbook found for ${options.url}`);
    return;
  }

  ctx.logger.success(`Resolved cached playbook for ${options.url}`);
  if (result.cacheKey) {
    ctx.logger.info(`Cache key: ${result.cacheKey}`);
  }
}

export async function runWebMemoryExecuteCommand(
  options: WebMemoryExecuteOptions,
  ctx: CLIContext,
): Promise<void> {
  const startedAt = Date.now();
  const client = createClient(options);
  const payload: ActionWebMemoryExecuteRequest = {
    url: options.url,
    intent: options.intent,
    operation: options.operation,
    ...(options.params ? { params: parseJsonObject(options.params, "params") } : {}),
  };
  const result = await client.webMemory.execute(payload);

  if (options.json) {
    printCliResultEnvelope(
      createCliResultEnvelope({
        ok: Boolean(result.ok),
        operation: "web.memory.execute",
        summary: result.ok
          ? `Executed web memory plan for ${options.url}`
          : `Web memory execution failed for ${options.url}`,
        data: result,
        errors: result.ok ? [] : ["web memory execute failed"],
        durationMs: Date.now() - startedAt,
        safetyLevel: "external",
        artifacts: result.artifacts,
      }),
    );
    return;
  }

  if (!result.ok) {
    ctx.logger.error(`Web memory execution failed for ${options.url}`);
    process.exit(1);
  }

  ctx.logger.success(`Executed web memory plan for ${options.url}`);
  if (result.source) {
    ctx.logger.info(`Source: ${result.source}`);
  }
}

export async function runWebMemoryInvalidateCommand(
  options: WebMemoryInvalidateOptions,
  ctx: CLIContext,
): Promise<void> {
  if (!options.yes) {
    ctx.logger.error("web-memory invalidate is destructive. Re-run with --yes to confirm.");
    process.exit(1);
  }

  const startedAt = Date.now();
  const client = createClient(options);
  const payload: ActionWebMemoryInvalidateRequest = {
    url: options.url,
    playbookId: options.playbookId,
    scope: options.scope,
    reason: options.reason,
  };
  const result = await client.webMemory.invalidate(payload);

  if (options.json) {
    printCliResultEnvelope(
      createCliResultEnvelope({
        ok: Boolean(result.ok),
        operation: "web.memory.invalidate",
        summary: result.ok
          ? `Invalidated ${result.invalidated} web memory entries`
          : "Web memory invalidate failed",
        data: result,
        errors: result.ok ? [] : ["web memory invalidate failed"],
        durationMs: Date.now() - startedAt,
        safetyLevel: "destructive",
      }),
    );
    return;
  }

  if (!result.ok) {
    ctx.logger.error("Web memory invalidate failed");
    process.exit(1);
  }

  ctx.logger.success(`Invalidated ${result.invalidated} web memory entries`);
}

export async function runWebMemoryStatsCommand(
  options: WebMemoryStatsOptions,
  ctx: CLIContext,
): Promise<void> {
  const startedAt = Date.now();
  const client = createClient(options);
  const payload: ActionWebMemoryStatsRequest = {
    url: options.url,
    window: options.window,
  };
  const result = await client.webMemory.stats(payload);

  if (options.json) {
    printCliResultEnvelope(
      createCliResultEnvelope({
        ok: true,
        operation: "web.memory.stats",
        summary: `Web memory stats (${options.window ?? "24h"})`,
        data: result,
        durationMs: Date.now() - startedAt,
        safetyLevel: "read",
      }),
    );
    return;
  }

  ctx.logger.success("Web memory stats");
  ctx.logger.info(`Entries: ${result.entries}`);
  ctx.logger.info(`Hits: ${result.hits}`);
  ctx.logger.info(`Misses: ${result.misses}`);
}
