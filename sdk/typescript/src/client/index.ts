/**
 * @centris/sdk - TypeScript API client
 *
 * Programmatic client for invoking Centris commands via HTTP API.
 */

export const DEFAULT_API_VERSION = "2026-01-30";
const DEFAULT_BASE_URL = "https://api.centris.ai";
const LOCAL_BASE_URL = "http://localhost:7777";

export interface CentrisResult {
  taskId: string;
  status: "completed" | "failed" | "queued" | "running" | (string & {});
  text: string;
  actions: Array<Record<string, unknown>>;
  error?: string;
  usage?: Record<string, unknown>;
  apiVersion?: string;
  apiVersionWarning?: string;
  deprecationInfo?: {
    deprecated: true;
    sunset?: string;
    link?: string;
    alternative?: string;
  };
}

export interface CentrisUsage {
  tier: string;
  tasksRemaining: number;
  monthlyLimit: number;
  dailyBonus: number;
  tasksUsedToday: number;
  periodEnds?: string;
}

export class CentrisError extends Error {
  readonly code?: string;
  readonly taskId?: string;
  readonly status?: number;

  constructor(message: string, options?: { code?: string; taskId?: string; status?: number }) {
    super(message);
    this.name = "CentrisError";
    this.code = options?.code;
    this.taskId = options?.taskId;
    this.status = options?.status;
  }
}

export class AuthenticationError extends CentrisError {
  constructor(message: string, options?: { code?: string; taskId?: string; status?: number }) {
    super(message, options);
    this.name = "AuthenticationError";
  }
}

export class RateLimitError extends CentrisError {
  constructor(message: string, options?: { code?: string; taskId?: string; status?: number }) {
    super(message, options);
    this.name = "RateLimitError";
  }
}

export type DeprecationCallback = (endpoint: string, sunset?: string, alternative?: string) => void;

export interface CentrisClientOptions {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  local?: boolean;
  apiVersion?: string;
  fetchImpl?: typeof fetch;
}

export type {
  ActionApiMethod,
  ActionArtifact,
  ActionApiRequestEnvelope,
  ActionApiResponseEnvelope,
  ActionRouteRunRequest,
  ActionRouteRunResult,
  ActionRouteRecordStartRequest,
  ActionRouteRecordStartResult,
  ActionRouteRecordStopRequest,
  ActionRouteRecordStopResult,
  ActionWebMemoryIndexRequest,
  ActionWebMemoryIndexResult,
  ActionWebMemoryValidateRequest,
  ActionWebMemoryValidateResult,
  ActionWebMemoryResolveRequest,
  ActionWebMemoryResolveResult,
  ActionWebMemoryExecuteRequest,
  ActionWebMemoryExecuteResult,
  ActionWebMemoryInvalidateRequest,
  ActionWebMemoryInvalidateResult,
  ActionWebMemoryStatsRequest,
  ActionWebMemoryStatsResult,
} from "../action-api/index.js";

import type {
  ActionDesktopAppsResult,
  ActionDesktopClickRequest,
  ActionDesktopClickResult,
  ActionDesktopFindRequest,
  ActionDesktopFindResult,
  ActionDesktopSnapshotRequest,
  ActionDesktopSnapshotResult,
  ActionDesktopTypeRequest,
  ActionDesktopTypeResult,
  ActionDesktopWindowsRequest,
  ActionDesktopWindowsResult,
  ActionApiMethod,
  ActionApiRequestEnvelope,
  ActionApiResponseEnvelope,
  ActionRouteRecordStartRequest,
  ActionRouteRecordStartResult,
  ActionRouteRecordStopRequest,
  ActionRouteRecordStopResult,
  ActionRouteRunRequest,
  ActionRouteRunResult,
  ActionWebMemoryIndexRequest,
  ActionWebMemoryIndexResult,
  ActionWebMemoryValidateRequest,
  ActionWebMemoryValidateResult,
  ActionWebMemoryResolveRequest,
  ActionWebMemoryResolveResult,
  ActionWebMemoryExecuteRequest,
  ActionWebMemoryExecuteResult,
  ActionWebMemoryInvalidateRequest,
  ActionWebMemoryInvalidateResult,
  ActionWebMemoryStatsRequest,
  ActionWebMemoryStatsResult,
} from "../action-api/index.js";
import type {
  KernelActRequest,
  KernelActResult,
  KernelObserveRequest,
  KernelObserveResult,
  KernelVerifyRequest,
  KernelVerifyResult,
} from "../kernel/index.js";
import { ACTION_API_SPEC_VERSION } from "../action-api/index.js";

interface ParsedVersionHeaders {
  apiVersion?: string;
  apiVersionWarning?: string;
  deprecationInfo?: {
    deprecated: true;
    sunset?: string;
    link?: string;
    alternative?: string;
  };
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" ? value : fallback;
}

function parseAlternativeFromLink(linkHeader: string | null): string | undefined {
  if (!linkHeader || !linkHeader.includes('rel="successor-version"')) {
    return undefined;
  }

  for (const segment of linkHeader.split(",")) {
    if (!segment.includes('rel="successor-version"')) {
      continue;
    }
    const candidate = segment.split(";")[0]?.trim();
    if (!candidate) {
      continue;
    }
    return candidate.replace(/^</, "").replace(/>$/, "");
  }
  return undefined;
}

export class Centris {
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly local: boolean;
  private readonly apiVersion: string;
  private readonly fetchImpl: typeof fetch;
  private readonly fixedBaseUrl?: string;
  private resolvedBaseUrl?: string;
  private readonly deprecationCallbacks: DeprecationCallback[] = [];
  readonly webMemory = {
    index: (request: ActionWebMemoryIndexRequest) => this.webMemoryIndex(request),
    resolve: (request: ActionWebMemoryResolveRequest) => this.webMemoryResolve(request),
    execute: (request: ActionWebMemoryExecuteRequest) => this.webMemoryExecute(request),
    invalidate: (request: ActionWebMemoryInvalidateRequest) => this.webMemoryInvalidate(request),
    stats: (request: ActionWebMemoryStatsRequest = {}) => this.webMemoryStats(request),
  };

  constructor(options: CentrisClientOptions = {}) {
    const envApiKey = process.env.CENTRIS_API_KEY;
    this.apiKey = options.apiKey ?? envApiKey ?? "ck_test_local";
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.local = options.local ?? process.env.CENTRIS_LOCAL?.toLowerCase() === "true";
    this.apiVersion = options.apiVersion ?? process.env.CENTRIS_API_VERSION ?? DEFAULT_API_VERSION;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.fixedBaseUrl = options.baseUrl?.replace(/\/$/, "") ?? undefined;
  }

  onDeprecation(callback: DeprecationCallback): this {
    this.deprecationCallbacks.push(callback);
    return this;
  }

  async getVersionInfo(): Promise<Record<string, unknown>> {
    if (this.local) {
      return {
        currentVersion: this.apiVersion,
        localMode: true,
      };
    }

    const response = await this.request("/api/version", { method: "GET" });
    return response.body;
  }

  async do(
    command: string,
    options?: {
      asyncMode?: boolean;
      context?: Record<string, unknown>;
    },
  ): Promise<CentrisResult> {
    const response = await this.request("/api/v1/do", {
      method: "POST",
      body: JSON.stringify({
        command,
        async: options?.asyncMode ?? false,
        context: options?.context ?? {},
      }),
    });

    const data = response.body;
    const status = asString(data.status, "completed");
    const taskId = asString(data.task_id);

    if (response.status === 400 && asString(data.code) === "VERSION_NOT_SUPPORTED") {
      throw new CentrisError(asString(data.error, "API version not supported"), {
        code: "VERSION_NOT_SUPPORTED",
        taskId,
        status: response.status,
      });
    }
    if (response.status === 401) {
      throw new AuthenticationError(asString(data.error, "Authentication failed"), {
        code: "AUTH_FAILED",
        taskId,
        status: response.status,
      });
    }
    if (response.status === 429) {
      throw new RateLimitError(asString(data.error, "Rate limit exceeded"), {
        code: "RATE_LIMIT_EXCEEDED",
        taskId,
        status: response.status,
      });
    }
    if (!response.ok || status === "failed") {
      throw new CentrisError(asString(data.error, "Command failed"), {
        code: asString(data.code) || undefined,
        taskId,
        status: response.status,
      });
    }

    return {
      taskId,
      status,
      text: asString(data.result),
      actions: (Array.isArray(data.actions) ? data.actions : []) as Array<Record<string, unknown>>,
      usage: asObject(data.usage),
      apiVersion: response.version.apiVersion,
      apiVersionWarning: response.version.apiVersionWarning,
      deprecationInfo: response.version.deprecationInfo,
    };
  }

  async wait(
    taskId: string,
    options?: {
      pollIntervalMs?: number;
      timeoutMs?: number;
    },
  ): Promise<CentrisResult> {
    const pollIntervalMs = options?.pollIntervalMs ?? 2000;
    const timeoutMs = options?.timeoutMs ?? this.timeoutMs;
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const response = await this.request(`/api/v1/task/${encodeURIComponent(taskId)}`, {
        method: "GET",
      });
      const data = response.body;
      const status = asString(data.status);

      if (status === "completed") {
        return {
          taskId,
          status: "completed",
          text: asString(data.result),
          actions: (Array.isArray(data.actions) ? data.actions : []) as Array<
            Record<string, unknown>
          >,
          apiVersion: response.version.apiVersion,
          apiVersionWarning: response.version.apiVersionWarning,
          deprecationInfo: response.version.deprecationInfo,
        };
      }

      if (status === "failed") {
        throw new CentrisError(asString(data.error, "Task failed"), {
          code: asString(data.code) || undefined,
          taskId,
          status: response.status,
        });
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new CentrisError(`Task ${taskId} timed out after ${timeoutMs}ms`, {
      code: "TIMEOUT",
      taskId,
    });
  }

  async usage(): Promise<CentrisUsage> {
    const response = await this.request("/api/v1/usage", { method: "GET" });
    if (response.status === 401) {
      throw new AuthenticationError("Invalid API key", {
        code: "AUTH_FAILED",
        status: response.status,
      });
    }

    const data = response.body;
    return {
      tier: asString(data.tier, "free"),
      tasksRemaining: asNumber(data.tasks_remaining, 0),
      monthlyLimit: asNumber(data.monthly_limit, 0),
      dailyBonus: asNumber(data.daily_bonus, 0),
      tasksUsedToday: asNumber(data.tasks_used_today, 0),
      periodEnds: asString(data.period_ends) || undefined,
    };
  }

  async observe(request: KernelObserveRequest): Promise<KernelObserveResult> {
    return this.callActionApi("observe", request);
  }

  async act(request: KernelActRequest): Promise<KernelActResult> {
    return this.callActionApi("act", request);
  }

  async verify(request: KernelVerifyRequest): Promise<KernelVerifyResult> {
    return this.callActionApi("verify", request);
  }

  async desktopSnapshot(
    request: ActionDesktopSnapshotRequest = {},
  ): Promise<ActionDesktopSnapshotResult> {
    return this.callActionApi("desktop.snapshot", request);
  }

  async desktopFind(request: ActionDesktopFindRequest = {}): Promise<ActionDesktopFindResult> {
    return this.callActionApi("desktop.find", request);
  }

  async desktopClick(request: ActionDesktopClickRequest): Promise<ActionDesktopClickResult> {
    return this.callActionApi("desktop.click", request);
  }

  async desktopType(request: ActionDesktopTypeRequest): Promise<ActionDesktopTypeResult> {
    return this.callActionApi("desktop.type", request);
  }

  async desktopApps(): Promise<ActionDesktopAppsResult> {
    return this.callActionApi("desktop.apps", {});
  }

  async desktopWindows(
    request: ActionDesktopWindowsRequest = {},
  ): Promise<ActionDesktopWindowsResult> {
    return this.callActionApi("desktop.windows", request);
  }

  async routeRun(request: ActionRouteRunRequest): Promise<ActionRouteRunResult> {
    return this.callActionApi("route.run", request);
  }

  async routeRecordStart(
    request: ActionRouteRecordStartRequest,
  ): Promise<ActionRouteRecordStartResult> {
    return this.callActionApi("route.record.start", request);
  }

  async routeRecordStop(
    request: ActionRouteRecordStopRequest,
  ): Promise<ActionRouteRecordStopResult> {
    return this.callActionApi("route.record.stop", request);
  }

  async webMemoryIndex(request: ActionWebMemoryIndexRequest): Promise<ActionWebMemoryIndexResult> {
    return this.callActionApi("web.memory.index", request);
  }

  async webMemoryValidate(
    request: ActionWebMemoryValidateRequest,
  ): Promise<ActionWebMemoryValidateResult> {
    return this.callActionApi("web.memory.validate", request);
  }

  async webMemoryResolve(
    request: ActionWebMemoryResolveRequest,
  ): Promise<ActionWebMemoryResolveResult> {
    return this.callActionApi("web.memory.resolve", request);
  }

  async webMemoryExecute(
    request: ActionWebMemoryExecuteRequest,
  ): Promise<ActionWebMemoryExecuteResult> {
    return this.callActionApi("web.memory.execute", request);
  }

  async webMemoryInvalidate(
    request: ActionWebMemoryInvalidateRequest,
  ): Promise<ActionWebMemoryInvalidateResult> {
    return this.callActionApi("web.memory.invalidate", request);
  }

  async webMemoryStats(
    request: ActionWebMemoryStatsRequest = {},
  ): Promise<ActionWebMemoryStatsResult> {
    return this.callActionApi("web.memory.stats", request);
  }

  async dispatchActionApi<M extends ActionApiMethod>(
    request: ActionApiRequestEnvelope<M>,
  ): Promise<ActionApiResponseEnvelope<M>> {
    const result = await this.request("/api/v1/action", {
      method: "POST",
      body: JSON.stringify(request),
    });

    if (!result.ok) {
      throw new CentrisError("Action API dispatch failed", {
        code: "ACTION_API_FAILED",
        status: result.status,
      });
    }

    return result.body as unknown as ActionApiResponseEnvelope<M>;
  }

  private async callActionApi<M extends ActionApiMethod>(
    method: M,
    params: ActionApiRequestEnvelope<M>["params"],
  ): Promise<NonNullable<ActionApiResponseEnvelope<M>["result"]>> {
    const response = await this.dispatchActionApi({
      specVersion: ACTION_API_SPEC_VERSION,
      method,
      params,
    });

    if (!response.ok || response.result === undefined) {
      const errorMessage =
        typeof response.error?.message === "string"
          ? response.error.message
          : `Action API method failed: ${method}`;
      throw new CentrisError(errorMessage, {
        code: response.error?.code ?? "ACTION_API_FAILED",
      });
    }

    return response.result as NonNullable<ActionApiResponseEnvelope<M>["result"]>;
  }

  private async request(
    path: string,
    init: RequestInit,
  ): Promise<{
    ok: boolean;
    status: number;
    body: Record<string, unknown>;
    version: ParsedVersionHeaders;
  }> {
    const baseUrl = await this.resolveBaseUrl();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Centris-Key": this.apiKey,
      "Accept-Version": this.apiVersion,
    };
    if (init.headers && typeof init.headers === "object" && !Array.isArray(init.headers)) {
      Object.assign(headers, init.headers as Record<string, string>);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });

      const rawBody = await response.text();
      let parsedBody: unknown = {};
      if (rawBody.trim().length > 0) {
        try {
          parsedBody = JSON.parse(rawBody);
        } catch {
          parsedBody = { error: rawBody };
        }
      }

      const version = this.parseVersionHeaders(response, path);
      return {
        ok: response.ok,
        status: response.status,
        body: asObject(parsedBody),
        version,
      };
    } catch (error) {
      throw new CentrisError(`Request failed for ${path}: ${String(error)}`, {
        code: "REQUEST_FAILED",
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async resolveBaseUrl(): Promise<string> {
    if (this.resolvedBaseUrl) {
      return this.resolvedBaseUrl;
    }

    if (this.local) {
      this.resolvedBaseUrl = LOCAL_BASE_URL;
      return this.resolvedBaseUrl;
    }

    if (this.fixedBaseUrl) {
      this.resolvedBaseUrl = this.fixedBaseUrl;
      return this.resolvedBaseUrl;
    }

    const envBaseUrl = process.env.CENTRIS_API_URL?.replace(/\/$/, "");
    if (envBaseUrl) {
      this.resolvedBaseUrl = envBaseUrl;
      return this.resolvedBaseUrl;
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1000);
      const response = await this.fetchImpl(`${LOCAL_BASE_URL}/health`, {
        method: "GET",
        signal: controller.signal,
      });
      clearTimeout(timer);

      this.resolvedBaseUrl = response.ok ? LOCAL_BASE_URL : DEFAULT_BASE_URL;
      return this.resolvedBaseUrl;
    } catch {
      this.resolvedBaseUrl = DEFAULT_BASE_URL;
      return this.resolvedBaseUrl;
    }
  }

  private parseVersionHeaders(response: Response, endpoint: string): ParsedVersionHeaders {
    const apiVersion = response.headers.get("X-API-Version") ?? undefined;
    const apiVersionWarning = response.headers.get("X-API-Version-Warning") ?? undefined;

    if (response.headers.get("Deprecation") !== "true") {
      return { apiVersion, apiVersionWarning };
    }

    const link = response.headers.get("Link") ?? undefined;
    const sunset = response.headers.get("Sunset") ?? undefined;
    const alternative = parseAlternativeFromLink(link ?? null);

    for (const callback of this.deprecationCallbacks) {
      try {
        callback(endpoint, sunset, alternative);
      } catch {
        // Callback errors are intentionally isolated from request flow.
      }
    }

    return {
      apiVersion,
      apiVersionWarning,
      deprecationInfo: {
        deprecated: true,
        sunset,
        link,
        alternative,
      },
    };
  }
}

async function executeDo(
  command: string,
  options?: Omit<CentrisClientOptions, "fetchImpl"> & {
    asyncMode?: boolean;
    context?: Record<string, unknown>;
    fetchImpl?: typeof fetch;
  },
): Promise<CentrisResult> {
  const client = new Centris(options);
  return client.do(command, {
    asyncMode: options?.asyncMode,
    context: options?.context,
  });
}

export { executeDo as do };
