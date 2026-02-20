import type { AdapterRunOptions, CLIContext } from "../types.js";
import {
  createAdapterRuntime,
  type AdapterSpec,
  type AdapterTransport,
} from "../../execution/index.js";
import { printCliResultEnvelope } from "../result-envelope.js";

function parseJson<T>(raw: string | undefined, fallback: T, label: string): T {
  if (!raw || raw.trim().length === 0) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(`invalid ${label} JSON: ${String(error)}`, { cause: error });
  }
}

function toStringIfPrimitive(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return fallback;
}

function parseSafetyLevel(value: unknown): "read" | "write" | "external" | "destructive" {
  const parsed = toStringIfPrimitive(value, "read");
  if (
    parsed === "read" ||
    parsed === "write" ||
    parsed === "external" ||
    parsed === "destructive"
  ) {
    return parsed;
  }
  return "read";
}

function parseAdapterSpec(raw: string): AdapterSpec {
  const parsed = parseJson<unknown>(raw, {}, "adapter");
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("adapter must be a JSON object");
  }
  const obj = parsed as Record<string, unknown>;
  const transport = toStringIfPrimitive(obj.transport);
  if (!["subprocess", "http", "sdk"].includes(transport)) {
    throw new Error("adapter.transport must be one of subprocess|http|sdk");
  }

  const operationsRaw = Array.isArray(obj.operations) ? obj.operations : [];
  const operations = operationsRaw
    .map((entry) => (typeof entry === "object" && entry !== null ? entry : {}))
    .map((entry) => {
      const rec = entry as Record<string, unknown>;
      return {
        operation: toStringIfPrimitive(rec.operation),
        safetyLevel: parseSafetyLevel(rec.safetyLevel),
      };
    })
    .filter((entry) => entry.operation.length > 0);

  return {
    adapterId: toStringIfPrimitive(obj.adapterId),
    system: toStringIfPrimitive(obj.system),
    transport: transport as AdapterTransport,
    operations,
    defaultTimeoutMs:
      typeof obj.defaultTimeoutMs === "number"
        ? Math.max(1, Math.floor(obj.defaultTimeoutMs))
        : undefined,
    maxTimeoutMs:
      typeof obj.maxTimeoutMs === "number" ? Math.max(1, Math.floor(obj.maxTimeoutMs)) : undefined,
    systemVersion: typeof obj.systemVersion === "string" ? obj.systemVersion : undefined,
  };
}

export async function runAdapterCommand(
  options: AdapterRunOptions,
  ctx: CLIContext,
): Promise<void> {
  const runtime = createAdapterRuntime();
  const spec = parseAdapterSpec(options.adapter);
  const input = parseJson<Record<string, unknown>>(options.input, {}, "input");
  const env = parseJson<Record<string, string> | undefined>(options.env, undefined, "env");
  const headers = parseJson<Record<string, string> | undefined>(
    options.headers,
    undefined,
    "headers",
  );
  const args = parseJson<string[] | undefined>(options.args, undefined, "args");

  const result = await runtime.execute(spec, {
    operation: options.operation,
    input,
    timeoutMs: options.timeoutMs,
    dryRun: options.dryRun,
    allowExternal: options.allowExternal,
    allowDestructive: options.allowDestructive,
    subprocess: options.command
      ? {
          command: options.command,
          args,
          cwd: options.cwd,
          env,
        }
      : undefined,
    http: options.url
      ? {
          url: options.url,
          method: options.method,
          headers,
        }
      : undefined,
    sdk: options.module
      ? {
          modulePath: options.module,
          exportName: options.exportName,
        }
      : undefined,
  });

  if (options.json) {
    printCliResultEnvelope(result);
    return;
  }

  if (!result.ok) {
    ctx.logger.error(result.summary);
    for (const message of result.errors) {
      ctx.logger.error(message);
    }
    process.exit(1);
  }

  ctx.logger.success(result.summary);
}
