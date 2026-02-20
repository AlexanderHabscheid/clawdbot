import { spawn } from "node:child_process";
import type { SafetyLevel } from "../cli/result-envelope.js";
import {
  createCliResultEnvelope,
  type CliArtifact,
  type CliResultEnvelope,
} from "../cli/result-envelope.js";

export type AdapterTransport = "subprocess" | "http" | "sdk";

export interface AdapterOperation {
  operation: string;
  safetyLevel: SafetyLevel;
}

export interface AdapterSpec {
  adapterId: string;
  system: string;
  transport: AdapterTransport;
  operations: AdapterOperation[];
  defaultTimeoutMs?: number;
  maxTimeoutMs?: number;
  systemVersion?: string;
}

export interface AdapterExecutionOptions {
  operation: string;
  input: Record<string, unknown>;
  timeoutMs?: number;
  dryRun?: boolean;
  allowExternal?: boolean;
  allowDestructive?: boolean;
  subprocess?: {
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
  };
  http?: {
    url: string;
    method?: "POST" | "PUT" | "PATCH";
    headers?: Record<string, string>;
  };
  sdk?: {
    modulePath: string;
    exportName?: string;
  };
}

function enforceSafety(params: {
  level: SafetyLevel;
  dryRun: boolean;
  allowExternal: boolean;
  allowDestructive: boolean;
}): string | null {
  if (params.level === "external" && !params.allowExternal && !params.dryRun) {
    return "external operations require allowExternal=true or dryRun=true";
  }
  if (params.level === "destructive" && !params.allowDestructive && !params.dryRun) {
    return "destructive operations require allowDestructive=true or dryRun=true";
  }
  return null;
}

function resolveOperation(spec: AdapterSpec, operation: string): AdapterOperation | null {
  return spec.operations.find((candidate) => candidate.operation === operation) ?? null;
}

async function runSubprocess(params: {
  command: string;
  args: string[];
  input: Record<string, unknown>;
  timeoutMs: number;
  cwd?: string;
  env?: Record<string, string>;
}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(params.command, params.args, {
      cwd: params.cwd,
      env: params.env ? { ...process.env, ...params.env } : process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`adapter subprocess timed out after ${params.timeoutMs}ms`));
    }, params.timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `adapter subprocess exited with code ${code}`));
        return;
      }

      const trimmed = stdout.trim();
      if (!trimmed) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(trimmed) as unknown);
      } catch {
        resolve({ stdout: trimmed });
      }
    });

    child.stdin.write(`${JSON.stringify(params.input)}\n`);
    child.stdin.end();
  });
}

async function runHttp(params: {
  url: string;
  method: "POST" | "PUT" | "PATCH";
  headers?: Record<string, string>;
  input: Record<string, unknown>;
  timeoutMs: number;
}): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs);
  try {
    const response = await fetch(params.url, {
      method: params.method,
      headers: {
        "content-type": "application/json",
        ...params.headers,
      },
      body: JSON.stringify(params.input),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`adapter http call failed (${response.status}): ${text.slice(0, 300)}`);
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { body: text };
    }
  } finally {
    clearTimeout(timer);
  }
}

async function runSdk(params: {
  modulePath: string;
  exportName: string;
  input: Record<string, unknown>;
}): Promise<unknown> {
  const mod = (await import(params.modulePath)) as Record<string, unknown>;
  const maybeHandler = mod[params.exportName];
  if (typeof maybeHandler !== "function") {
    throw new Error(`sdk adapter handler not found: ${params.exportName}`);
  }
  const result = await Promise.resolve(
    (maybeHandler as (input: Record<string, unknown>) => unknown)(params.input),
  );
  return result;
}

export class AdapterRuntime {
  async execute(spec: AdapterSpec, options: AdapterExecutionOptions): Promise<CliResultEnvelope> {
    const startedAt = Date.now();
    const op = resolveOperation(spec, options.operation);
    if (!op) {
      return createCliResultEnvelope({
        ok: false,
        operation: options.operation,
        summary: `Unknown adapter operation: ${options.operation}`,
        data: {},
        errors: [`operation not declared by adapter ${spec.adapterId}`],
        durationMs: Date.now() - startedAt,
        connectorId: spec.adapterId,
        system: spec.system,
        systemVersion: spec.systemVersion,
      });
    }

    const timeoutMs = Math.min(
      options.timeoutMs ?? spec.defaultTimeoutMs ?? 30_000,
      spec.maxTimeoutMs ?? 120_000,
    );
    const dryRun = options.dryRun === true;
    const safetyError = enforceSafety({
      level: op.safetyLevel,
      dryRun,
      allowExternal: options.allowExternal === true,
      allowDestructive: options.allowDestructive === true,
    });
    if (safetyError) {
      return createCliResultEnvelope({
        ok: false,
        operation: options.operation,
        summary: "Adapter safety policy blocked execution",
        data: {},
        errors: [safetyError],
        durationMs: Date.now() - startedAt,
        connectorId: spec.adapterId,
        system: spec.system,
        systemVersion: spec.systemVersion,
        safetyLevel: op.safetyLevel,
      });
    }

    if (dryRun) {
      return createCliResultEnvelope({
        ok: true,
        operation: options.operation,
        summary: "Dry run: adapter execution skipped",
        data: { input: options.input, transport: spec.transport },
        durationMs: Date.now() - startedAt,
        connectorId: spec.adapterId,
        system: spec.system,
        systemVersion: spec.systemVersion,
        safetyLevel: op.safetyLevel,
      });
    }

    try {
      let data: unknown;
      if (spec.transport === "subprocess") {
        if (!options.subprocess?.command) {
          throw new Error("subprocess transport requires command");
        }
        data = await runSubprocess({
          command: options.subprocess.command,
          args: options.subprocess.args ?? [],
          cwd: options.subprocess.cwd,
          env: options.subprocess.env,
          input: options.input,
          timeoutMs,
        });
      } else if (spec.transport === "http") {
        if (!options.http?.url) {
          throw new Error("http transport requires url");
        }
        data = await runHttp({
          url: options.http.url,
          method: options.http.method ?? "POST",
          headers: options.http.headers,
          input: options.input,
          timeoutMs,
        });
      } else {
        if (!options.sdk?.modulePath) {
          throw new Error("sdk transport requires modulePath");
        }
        data = await runSdk({
          modulePath: options.sdk.modulePath,
          exportName: options.sdk.exportName ?? "execute",
          input: options.input,
        });
      }

      const record =
        typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
      const artifacts = Array.isArray(record.artifacts)
        ? (record.artifacts as CliArtifact[])
        : undefined;
      return createCliResultEnvelope({
        ok: true,
        operation: options.operation,
        summary: "Adapter operation completed",
        data,
        artifacts,
        durationMs: Date.now() - startedAt,
        connectorId: spec.adapterId,
        system: spec.system,
        systemVersion: spec.systemVersion,
        safetyLevel: op.safetyLevel,
      });
    } catch (error) {
      return createCliResultEnvelope({
        ok: false,
        operation: options.operation,
        summary: "Adapter operation failed",
        data: {},
        errors: [String(error)],
        durationMs: Date.now() - startedAt,
        connectorId: spec.adapterId,
        system: spec.system,
        systemVersion: spec.systemVersion,
        safetyLevel: op.safetyLevel,
      });
    }
  }
}

export function createAdapterRuntime(): AdapterRuntime {
  return new AdapterRuntime();
}
