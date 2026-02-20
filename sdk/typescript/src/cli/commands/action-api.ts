import type {
  ActionRouteRecordStartRequest,
  ActionRouteRecordStopRequest,
  ActionRouteRunRequest,
} from "../../action-api/index.js";
import type { KernelSuccessCheck } from "../../kernel/index.js";
import type {
  ActOptions,
  CLIContext,
  ObserveOptions,
  RouteRecordStartApiOptions,
  RouteRecordStopApiOptions,
  RouteRunApiOptions,
  VerifyOptions,
} from "../types.js";
import { Centris } from "../../client/index.js";

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

function parseJsonObject(raw: string | undefined, field: string): Record<string, string> {
  if (!raw || raw.trim().length === 0) {
    return {};
  }

  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${field} must be a JSON object`);
  }

  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    out[k] = String(v);
  }
  return out;
}

function parseJsonArray<T>(raw: string | undefined, field: string): T[] {
  if (!raw || raw.trim().length === 0) {
    return [];
  }
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`${field} must be a JSON array`);
  }
  return parsed as T[];
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

export async function runObserveActionCommand(
  options: ObserveOptions,
  ctx: CLIContext,
): Promise<void> {
  const client = createClient(options);
  const result = await client.observe({
    url: options.url,
    instruction: options.instruction,
  });

  if (options.json) {
    printJson(result);
    return;
  }

  ctx.logger.success(`Observed: ${result.url}`);
  if (result.title) {
    ctx.logger.info(`Title: ${result.title}`);
  }
  ctx.logger.info(`Interactive elements: ${result.interactive?.length ?? 0}`);
}

export async function runActActionCommand(options: ActOptions, ctx: CLIContext): Promise<void> {
  const client = createClient(options);
  const result = await client.act({
    kind: options.kind,
    nodeId: options.nodeId,
    target: options.target,
    value: options.value,
    amount: options.amount,
  });

  if (options.json) {
    printJson(result);
    return;
  }

  if (!result.ok) {
    ctx.logger.error("Action failed");
    process.exit(1);
  }

  ctx.logger.success(`Action executed: ${options.kind}`);
}

export async function runVerifyActionCommand(
  options: VerifyOptions,
  ctx: CLIContext,
): Promise<void> {
  const client = createClient(options);
  const checks = parseJsonArray<KernelSuccessCheck>(options.checks, "checks");
  const result = await client.verify({ checks });

  if (options.json) {
    printJson(result);
    return;
  }

  if (!result.ok) {
    ctx.logger.error(`Verify failed (${result.failed.length} checks)`);
    process.exit(1);
  }

  ctx.logger.success(`Verify passed (${result.passed.length} checks)`);
}

export async function runRouteRunActionCommand(
  options: RouteRunApiOptions,
  ctx: CLIContext,
): Promise<void> {
  const client = createClient(options);
  const params = parseJsonObject(options.params, "params");
  const checks = parseJsonArray<KernelSuccessCheck>(options.checks, "checks");

  const payload: ActionRouteRunRequest = {
    routeId: options.routeId,
    url: options.url,
    ...(Object.keys(params).length > 0 ? { params } : {}),
    ...(checks.length > 0 ? { checks } : {}),
  };

  const result = await client.routeRun(payload);

  if (options.json) {
    printJson(result);
    return;
  }

  if (!result.ok) {
    ctx.logger.error(`Route run failed: ${options.routeId}`);
    process.exit(1);
  }

  ctx.logger.success(`Route run succeeded: ${options.routeId}`);
  ctx.logger.info(`Executed steps: ${result.executed}`);
  if (typeof result.verify?.ok === "boolean") {
    ctx.logger.info(`Verify: ${result.verify.ok ? "passed" : "failed"}`);
  }
}

export async function runRouteRecordStartActionCommand(
  options: RouteRecordStartApiOptions,
  ctx: CLIContext,
): Promise<void> {
  const client = createClient(options);
  const params = parseJsonObject(options.params, "params");
  const metadata = parseJsonObject(options.metadata, "metadata") as Record<string, unknown>;

  const payload: ActionRouteRecordStartRequest = {
    intent: options.intent,
    url: options.url,
    ...(Object.keys(params).length > 0 ? { params } : {}),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  };

  const result = await client.routeRecordStart(payload);

  if (options.json) {
    printJson(result);
    return;
  }

  if (!result.ok) {
    ctx.logger.error(`Route record start failed for intent: ${options.intent}`);
    process.exit(1);
  }

  ctx.logger.success(`Route recording started: ${result.sessionId}`);
}

export async function runRouteRecordStopActionCommand(
  options: RouteRecordStopApiOptions,
  ctx: CLIContext,
): Promise<void> {
  const client = createClient(options);
  const metadata = parseJsonObject(options.metadata, "metadata") as Record<string, unknown>;

  const payload: ActionRouteRecordStopRequest = {
    sessionId: options.sessionId,
    outcome: options.outcome,
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  };

  const result = await client.routeRecordStop(payload);

  if (options.json) {
    printJson(result);
    return;
  }

  if (!result.ok) {
    ctx.logger.error(`Route record stop failed for session: ${options.sessionId}`);
    process.exit(1);
  }

  ctx.logger.success(`Route recording stopped: ${options.sessionId}`);
  if (result.routeId) {
    ctx.logger.info(`Route id: ${result.routeId}`);
  }
}
