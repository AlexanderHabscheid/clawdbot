import type { TlsOptions } from "node:tls";
import type { WebSocket, WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";
import {
  createServer as createHttpServer,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { CanvasHostHandler } from "../canvas-host/server.js";
import type { createSubsystemLogger } from "../logging/subsystem.js";
import type { AuthRateLimiter } from "./auth-rate-limit.js";
import type { GatewayWsClient } from "./server/ws-types.js";
import { resolveAgentAvatar } from "../agents/identity-avatar.js";
import {
  A2UI_PATH,
  CANVAS_HOST_PATH,
  CANVAS_WS_PATH,
  handleA2uiHttpRequest,
} from "../canvas-host/a2ui.js";
import { createDefaultDeps } from "../cli/deps.js";
import { agentCommand } from "../commands/agent.js";
import { loadConfig } from "../config/config.js";
import { defaultRuntime } from "../runtime.js";
import { safeEqualSecret } from "../security/secret-equal.js";
import { handleSlackHttpRequest } from "../slack/http/index.js";
import { handleActionApiEnvelope } from "./action-api-authority.js";
import {
  authorizeGatewayConnect,
  isLocalDirectRequest,
  type GatewayAuthResult,
  type ResolvedGatewayAuth,
} from "./auth.js";
import {
  isCentrisDesktopPath,
  handleCentrisDesktopConnection,
  getCentrisDesktopStatus,
} from "./centris-desktop-bridge.js";
import {
  isCentrisExtensionPath,
  handleCentrisExtensionConnection,
  getCentrisExtensionStatus,
  validateExtensionToken,
} from "./centris-extension-bridge.js";
import { isCentrisVoicePath, handleCentrisVoiceConnection } from "./centris-voice.js";
import {
  handleControlUiAvatarRequest,
  handleControlUiHttpRequest,
  type ControlUiRootState,
} from "./control-ui.js";
import { applyHookMappings } from "./hooks-mapping.js";
import {
  extractHookToken,
  getHookAgentPolicyError,
  getHookChannelError,
  type HookMessageChannel,
  type HooksConfigResolved,
  isHookAgentAllowed,
  normalizeAgentPayload,
  normalizeHookHeaders,
  normalizeWakePayload,
  readJsonBody,
  resolveHookSessionKey,
  resolveHookTargetAgentId,
  resolveHookChannel,
  resolveHookDeliver,
} from "./hooks.js";
import { sendGatewayAuthFailure } from "./http-common.js";
import {
  getBearerToken,
  getHeader,
  resolveAgentIdForRequest,
  resolveSessionKey,
} from "./http-utils.js";
import { isPrivateOrLoopbackAddress, resolveGatewayClientIp } from "./net.js";
import { handleOpenAiHttpRequest } from "./openai-http.js";
import { handleOpenResponsesHttpRequest } from "./openresponses-http.js";
import { handleToolsInvokeHttpRequest } from "./tools-invoke-http.js";

type SubsystemLogger = ReturnType<typeof createSubsystemLogger>;
type HookAuthFailure = { count: number; windowStartedAtMs: number };

const HOOK_AUTH_FAILURE_LIMIT = 20;
const HOOK_AUTH_FAILURE_WINDOW_MS = 60_000;
const HOOK_AUTH_FAILURE_TRACK_MAX = 2048;

let centrisDesktopMode: "action" | "dictation" = "action";
const CENTRIS_HTTP_API_VERSION = "2026-01-30";
const CENTRIS_HTTP_MIN_VERSION = "2026-01-30";
const CENTRIS_TASK_TTL_MS = 60 * 60 * 1000;

type CentrisTaskStatus = "queued" | "running" | "completed" | "failed";
type CentrisTaskRecord = {
  id: string;
  status: CentrisTaskStatus;
  createdAtMs: number;
  updatedAtMs: number;
  result?: string;
  actions?: Array<Record<string, unknown>>;
  usage?: Record<string, unknown>;
  error?: string;
  code?: string;
};

const centrisTasks = new Map<string, CentrisTaskRecord>();

type HookDispatchers = {
  dispatchWakeHook: (value: { text: string; mode: "now" | "next-heartbeat" }) => void;
  dispatchAgentHook: (value: {
    message: string;
    name: string;
    agentId?: string;
    wakeMode: "now" | "next-heartbeat";
    sessionKey: string;
    deliver: boolean;
    channel: HookMessageChannel;
    to?: string;
    model?: string;
    thinking?: string;
    timeoutSeconds?: number;
    allowUnsafeExternalContent?: boolean;
  }) => string;
};

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function sendCentrisJson(res: ServerResponse, status: number, body: unknown, warn?: string) {
  res.setHeader("X-API-Version", CENTRIS_HTTP_API_VERSION);
  if (warn) {
    res.setHeader("X-API-Version-Warning", warn);
  }
  sendJson(res, status, body);
}

function parseRequestedApiVersion(
  req: IncomingMessage,
): { ok: true } | { ok: false; value: string } {
  const requested = getHeader(req, "accept-version")?.trim();
  if (!requested || requested === CENTRIS_HTTP_API_VERSION) {
    return { ok: true };
  }
  return { ok: false, value: requested };
}

function pruneCentrisTasks(now = Date.now()): void {
  for (const [taskId, task] of centrisTasks) {
    if (now - task.updatedAtMs > CENTRIS_TASK_TTL_MS) {
      centrisTasks.delete(taskId);
    }
  }
}

function extractAgentText(payloads: Array<{ text?: string }> | undefined): string {
  if (!Array.isArray(payloads) || payloads.length === 0) {
    return "";
  }
  return payloads
    .map((p) => (typeof p.text === "string" ? p.text : ""))
    .filter(Boolean)
    .join("\n\n");
}

function extractAgentUsage(meta: unknown): Record<string, unknown> {
  if (!meta || typeof meta !== "object") {
    return { remaining: null };
  }
  const agentMeta = (meta as { agentMeta?: unknown }).agentMeta;
  if (!agentMeta || typeof agentMeta !== "object") {
    return { remaining: null };
  }
  const usage = (agentMeta as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") {
    return { remaining: null };
  }
  const record = usage as Record<string, unknown>;
  return {
    input: typeof record.input === "number" ? record.input : 0,
    output: typeof record.output === "number" ? record.output : 0,
    cacheRead: typeof record.cacheRead === "number" ? record.cacheRead : 0,
    cacheWrite: typeof record.cacheWrite === "number" ? record.cacheWrite : 0,
    total: typeof record.total === "number" ? record.total : 0,
    remaining: null,
  };
}

function extractContextUser(context: unknown): string | undefined {
  if (!context || typeof context !== "object") {
    return undefined;
  }
  const direct = (context as { user?: unknown }).user;
  if (typeof direct === "string" && direct.trim().length > 0) {
    return direct.trim();
  }
  const nested = (context as { user?: { id?: unknown } }).user?.id;
  if (typeof nested === "string" && nested.trim().length > 0) {
    return nested.trim();
  }
  return undefined;
}

function recordTaskStatus(task: CentrisTaskRecord, status: CentrisTaskStatus): void {
  task.status = status;
  task.updatedAtMs = Date.now();
}

async function runCentrisDoTask(params: {
  req: IncomingMessage;
  command: string;
  context: unknown;
  task: CentrisTaskRecord;
}) {
  recordTaskStatus(params.task, "running");

  const agentId = resolveAgentIdForRequest({
    req: params.req,
    model: undefined,
  });
  const sessionKey = resolveSessionKey({
    req: params.req,
    agentId,
    user: extractContextUser(params.context),
    prefix: "centris",
  });

  const runId = `ctask_${params.task.id}`;
  const contextObj =
    params.context && typeof params.context === "object" && !Array.isArray(params.context)
      ? (params.context as Record<string, unknown>)
      : undefined;
  const outputSchema = contextObj?.outputSchema;
  const outputSchemaValid =
    outputSchema &&
    typeof outputSchema === "object" &&
    !Array.isArray(outputSchema) &&
    Object.keys(outputSchema).length > 0;

  const result = await agentCommand(
    {
      message: params.command,
      sessionKey,
      runId,
      deliver: false,
      messageChannel: "webchat",
      bestEffortDeliver: false,
      outputSchema: outputSchemaValid ? (outputSchema as Record<string, unknown>) : undefined,
    },
    defaultRuntime,
    createDefaultDeps(),
  );

  const payloads = (result as { payloads?: Array<{ text?: string }> } | null)?.payloads;
  const meta = (result as { meta?: unknown } | null)?.meta;
  params.task.result = extractAgentText(payloads) || "Command completed.";
  params.task.actions = Array.isArray(payloads)
    ? payloads.map((p) => ({ type: "assistant_text", text: p.text ?? "" }))
    : [];
  params.task.usage = extractAgentUsage(meta);
  recordTaskStatus(params.task, "completed");
}

async function authorizeCentrisApiRequest(params: {
  req: IncomingMessage;
  trustedProxies: string[];
  auth: ResolvedGatewayAuth;
  rateLimiter?: AuthRateLimiter;
}): Promise<GatewayAuthResult> {
  if (isLocalDirectRequest(params.req, params.trustedProxies)) {
    return { ok: true };
  }

  const bearer = getBearerToken(params.req);
  const keyHeader = getHeader(params.req, "x-centris-key");
  const token = bearer ?? keyHeader;
  return authorizeGatewayConnect({
    auth: params.auth,
    connectAuth: token ? { token, password: token } : null,
    req: params.req,
    trustedProxies: params.trustedProxies,
    rateLimiter: params.rateLimiter,
  });
}

function isCanvasPath(pathname: string): boolean {
  return (
    pathname === A2UI_PATH ||
    pathname.startsWith(`${A2UI_PATH}/`) ||
    pathname === CANVAS_HOST_PATH ||
    pathname.startsWith(`${CANVAS_HOST_PATH}/`) ||
    pathname === CANVAS_WS_PATH
  );
}

function hasAuthorizedWsClientForIp(clients: Set<GatewayWsClient>, clientIp: string): boolean {
  for (const client of clients) {
    if (client.clientIp && client.clientIp === clientIp) {
      return true;
    }
  }
  return false;
}

async function authorizeCanvasRequest(params: {
  req: IncomingMessage;
  auth: ResolvedGatewayAuth;
  trustedProxies: string[];
  clients: Set<GatewayWsClient>;
  rateLimiter?: AuthRateLimiter;
}): Promise<GatewayAuthResult> {
  const { req, auth, trustedProxies, clients, rateLimiter } = params;
  if (isLocalDirectRequest(req, trustedProxies)) {
    return { ok: true };
  }

  let lastAuthFailure: GatewayAuthResult | null = null;
  const token = getBearerToken(req);
  if (token) {
    const authResult = await authorizeGatewayConnect({
      auth: { ...auth, allowTailscale: false },
      connectAuth: { token, password: token },
      req,
      trustedProxies,
      rateLimiter,
    });
    if (authResult.ok) {
      return authResult;
    }
    lastAuthFailure = authResult;
  }

  const clientIp = resolveGatewayClientIp({
    remoteAddr: req.socket?.remoteAddress ?? "",
    forwardedFor: getHeader(req, "x-forwarded-for"),
    realIp: getHeader(req, "x-real-ip"),
    trustedProxies,
  });
  if (!clientIp) {
    return lastAuthFailure ?? { ok: false, reason: "unauthorized" };
  }

  // IP-based fallback is only safe for machine-scoped addresses.
  // Only allow IP-based fallback for private/loopback addresses to prevent
  // cross-session access in shared-IP environments (corporate NAT, cloud).
  if (!isPrivateOrLoopbackAddress(clientIp)) {
    return lastAuthFailure ?? { ok: false, reason: "unauthorized" };
  }
  if (hasAuthorizedWsClientForIp(clients, clientIp)) {
    return { ok: true };
  }
  return lastAuthFailure ?? { ok: false, reason: "unauthorized" };
}

function writeUpgradeAuthFailure(
  socket: { write: (chunk: string) => void },
  auth: GatewayAuthResult,
) {
  if (auth.rateLimited) {
    const retryAfterSeconds =
      auth.retryAfterMs && auth.retryAfterMs > 0 ? Math.ceil(auth.retryAfterMs / 1000) : undefined;
    socket.write(
      [
        "HTTP/1.1 429 Too Many Requests",
        retryAfterSeconds ? `Retry-After: ${retryAfterSeconds}` : undefined,
        "Content-Type: application/json; charset=utf-8",
        "Connection: close",
        "",
        JSON.stringify({
          error: {
            message: "Too many failed authentication attempts. Please try again later.",
            type: "rate_limited",
          },
        }),
      ]
        .filter(Boolean)
        .join("\r\n"),
    );
    return;
  }
  socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
}

export type HooksRequestHandler = (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;

export function createHooksRequestHandler(
  opts: {
    getHooksConfig: () => HooksConfigResolved | null;
    bindHost: string;
    port: number;
    logHooks: SubsystemLogger;
  } & HookDispatchers,
): HooksRequestHandler {
  const { getHooksConfig, bindHost, port, logHooks, dispatchAgentHook, dispatchWakeHook } = opts;
  const hookAuthFailures = new Map<string, HookAuthFailure>();

  const resolveHookClientKey = (req: IncomingMessage): string => {
    return req.socket?.remoteAddress?.trim() || "unknown";
  };

  const recordHookAuthFailure = (
    clientKey: string,
    nowMs: number,
  ): { throttled: boolean; retryAfterSeconds?: number } => {
    if (!hookAuthFailures.has(clientKey) && hookAuthFailures.size >= HOOK_AUTH_FAILURE_TRACK_MAX) {
      // Prune expired entries instead of clearing all state.
      for (const [key, entry] of hookAuthFailures) {
        if (nowMs - entry.windowStartedAtMs >= HOOK_AUTH_FAILURE_WINDOW_MS) {
          hookAuthFailures.delete(key);
        }
      }
      // If still at capacity after pruning, drop the oldest half.
      if (hookAuthFailures.size >= HOOK_AUTH_FAILURE_TRACK_MAX) {
        let toRemove = Math.floor(hookAuthFailures.size / 2);
        for (const key of hookAuthFailures.keys()) {
          if (toRemove <= 0) {
            break;
          }
          hookAuthFailures.delete(key);
          toRemove--;
        }
      }
    }
    const current = hookAuthFailures.get(clientKey);
    const expired = !current || nowMs - current.windowStartedAtMs >= HOOK_AUTH_FAILURE_WINDOW_MS;
    const next: HookAuthFailure = expired
      ? { count: 1, windowStartedAtMs: nowMs }
      : { count: current.count + 1, windowStartedAtMs: current.windowStartedAtMs };
    // Delete-before-set refreshes Map insertion order so recently-active
    // clients are not evicted before dormant ones during oldest-half eviction.
    if (hookAuthFailures.has(clientKey)) {
      hookAuthFailures.delete(clientKey);
    }
    hookAuthFailures.set(clientKey, next);
    if (next.count <= HOOK_AUTH_FAILURE_LIMIT) {
      return { throttled: false };
    }
    const retryAfterMs = Math.max(1, next.windowStartedAtMs + HOOK_AUTH_FAILURE_WINDOW_MS - nowMs);
    return {
      throttled: true,
      retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
    };
  };

  const clearHookAuthFailure = (clientKey: string) => {
    hookAuthFailures.delete(clientKey);
  };

  return async (req, res) => {
    const hooksConfig = getHooksConfig();
    if (!hooksConfig) {
      return false;
    }
    const url = new URL(req.url ?? "/", `http://${bindHost}:${port}`);
    const basePath = hooksConfig.basePath;
    if (url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) {
      return false;
    }

    if (url.searchParams.has("token")) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(
        "Hook token must be provided via Authorization: Bearer <token> or X-OpenClaw-Token header (query parameters are not allowed).",
      );
      return true;
    }

    const token = extractHookToken(req);
    const clientKey = resolveHookClientKey(req);
    if (!safeEqualSecret(token, hooksConfig.token)) {
      const throttle = recordHookAuthFailure(clientKey, Date.now());
      if (throttle.throttled) {
        const retryAfter = throttle.retryAfterSeconds ?? 1;
        res.statusCode = 429;
        res.setHeader("Retry-After", String(retryAfter));
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Too Many Requests");
        logHooks.warn(`hook auth throttled for ${clientKey}; retry-after=${retryAfter}s`);
        return true;
      }
      res.statusCode = 401;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Unauthorized");
      return true;
    }
    clearHookAuthFailure(clientKey);

    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Allow", "POST");
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Method Not Allowed");
      return true;
    }

    const subPath = url.pathname.slice(basePath.length).replace(/^\/+/, "");
    if (!subPath) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Not Found");
      return true;
    }

    const body = await readJsonBody(req, hooksConfig.maxBodyBytes);
    if (!body.ok) {
      const status =
        body.error === "payload too large"
          ? 413
          : body.error === "request body timeout"
            ? 408
            : 400;
      sendJson(res, status, { ok: false, error: body.error });
      return true;
    }

    const payload = typeof body.value === "object" && body.value !== null ? body.value : {};
    const headers = normalizeHookHeaders(req);

    if (subPath === "wake") {
      const normalized = normalizeWakePayload(payload as Record<string, unknown>);
      if (!normalized.ok) {
        sendJson(res, 400, { ok: false, error: normalized.error });
        return true;
      }
      dispatchWakeHook(normalized.value);
      sendJson(res, 200, { ok: true, mode: normalized.value.mode });
      return true;
    }

    if (subPath === "agent") {
      const normalized = normalizeAgentPayload(payload as Record<string, unknown>);
      if (!normalized.ok) {
        sendJson(res, 400, { ok: false, error: normalized.error });
        return true;
      }
      if (!isHookAgentAllowed(hooksConfig, normalized.value.agentId)) {
        sendJson(res, 400, { ok: false, error: getHookAgentPolicyError() });
        return true;
      }
      const sessionKey = resolveHookSessionKey({
        hooksConfig,
        source: "request",
        sessionKey: normalized.value.sessionKey,
      });
      if (!sessionKey.ok) {
        sendJson(res, 400, { ok: false, error: sessionKey.error });
        return true;
      }
      const runId = dispatchAgentHook({
        ...normalized.value,
        sessionKey: sessionKey.value,
        agentId: resolveHookTargetAgentId(hooksConfig, normalized.value.agentId),
      });
      sendJson(res, 202, { ok: true, runId });
      return true;
    }

    if (hooksConfig.mappings.length > 0) {
      try {
        const mapped = await applyHookMappings(hooksConfig.mappings, {
          payload: payload as Record<string, unknown>,
          headers,
          url,
          path: subPath,
        });
        if (mapped) {
          if (!mapped.ok) {
            sendJson(res, 400, { ok: false, error: mapped.error });
            return true;
          }
          if (mapped.action === null) {
            res.statusCode = 204;
            res.end();
            return true;
          }
          if (mapped.action.kind === "wake") {
            dispatchWakeHook({
              text: mapped.action.text,
              mode: mapped.action.mode,
            });
            sendJson(res, 200, { ok: true, mode: mapped.action.mode });
            return true;
          }
          const channel = resolveHookChannel(mapped.action.channel);
          if (!channel) {
            sendJson(res, 400, { ok: false, error: getHookChannelError() });
            return true;
          }
          if (!isHookAgentAllowed(hooksConfig, mapped.action.agentId)) {
            sendJson(res, 400, { ok: false, error: getHookAgentPolicyError() });
            return true;
          }
          const sessionKey = resolveHookSessionKey({
            hooksConfig,
            source: "mapping",
            sessionKey: mapped.action.sessionKey,
          });
          if (!sessionKey.ok) {
            sendJson(res, 400, { ok: false, error: sessionKey.error });
            return true;
          }
          const runId = dispatchAgentHook({
            message: mapped.action.message,
            name: mapped.action.name ?? "Hook",
            agentId: resolveHookTargetAgentId(hooksConfig, mapped.action.agentId),
            wakeMode: mapped.action.wakeMode,
            sessionKey: sessionKey.value,
            deliver: resolveHookDeliver(mapped.action.deliver),
            channel,
            to: mapped.action.to,
            model: mapped.action.model,
            thinking: mapped.action.thinking,
            timeoutSeconds: mapped.action.timeoutSeconds,
            allowUnsafeExternalContent: mapped.action.allowUnsafeExternalContent,
          });
          sendJson(res, 202, { ok: true, runId });
          return true;
        }
      } catch (err) {
        logHooks.warn(`hook mapping failed: ${String(err)}`);
        sendJson(res, 500, { ok: false, error: "hook mapping failed" });
        return true;
      }
    }

    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Not Found");
    return true;
  };
}

export function createGatewayHttpServer(opts: {
  canvasHost: CanvasHostHandler | null;
  clients: Set<GatewayWsClient>;
  controlUiEnabled: boolean;
  controlUiBasePath: string;
  controlUiRoot?: ControlUiRootState;
  openAiChatCompletionsEnabled: boolean;
  openResponsesEnabled: boolean;
  openResponsesConfig?: import("../config/types.gateway.js").GatewayHttpResponsesConfig;
  handleHooksRequest: HooksRequestHandler;
  handlePluginRequest?: HooksRequestHandler;
  resolvedAuth: ResolvedGatewayAuth;
  /** Optional rate limiter for auth brute-force protection. */
  rateLimiter?: AuthRateLimiter;
  tlsOptions?: TlsOptions;
}): HttpServer {
  const {
    canvasHost,
    clients,
    controlUiEnabled,
    controlUiBasePath,
    controlUiRoot,
    openAiChatCompletionsEnabled,
    openResponsesEnabled,
    openResponsesConfig,
    handleHooksRequest,
    handlePluginRequest,
    resolvedAuth,
    rateLimiter,
  } = opts;
  const httpServer: HttpServer = opts.tlsOptions
    ? createHttpsServer(opts.tlsOptions, (req, res) => {
        void handleRequest(req, res);
      })
    : createHttpServer((req, res) => {
        void handleRequest(req, res);
      });

  function setCorsHeaders(req: IncomingMessage, res: ServerResponse) {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-Cache-Key, X-User-Id, X-Session-Id",
      );
      res.setHeader("Access-Control-Max-Age", "86400");
    }
  }

  async function handleRequest(req: IncomingMessage, res: ServerResponse) {
    // Don't interfere with WebSocket upgrades; ws handles the 'upgrade' event.
    if (String(req.headers.upgrade ?? "").toLowerCase() === "websocket") {
      return;
    }

    setCorsHeaders(req, res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      const configSnapshot = loadConfig();
      const trustedProxies = configSnapshot.gateway?.trustedProxies ?? [];
      const requestPath = new URL(req.url ?? "/", "http://localhost").pathname;

      // Health check — supports both /health and /api/health
      if ((requestPath === "/health" || requestPath === "/api/health") && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, gateway: "centris" }));
        return;
      }

      if (requestPath === "/api/version" && req.method === "GET") {
        sendCentrisJson(res, 200, {
          current_version: CENTRIS_HTTP_API_VERSION,
          minimum_supported_version: CENTRIS_HTTP_MIN_VERSION,
          service: "centris-gateway",
        });
        return;
      }

      // Desktop mode status — returns current operating mode
      if (requestPath === "/api/mode/status" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ current_mode: centrisDesktopMode }));
        return;
      }

      // Desktop mode switch — sets operating mode (action / dictation)
      if (requestPath === "/api/mode/switch" && req.method === "POST") {
        const body = await readJsonBody(req, 16 * 1024).catch(() => ({ ok: false as const }));
        const value =
          body.ok && typeof body.value === "object" && body.value !== null
            ? (body.value as Record<string, unknown>)
            : null;
        const mode = value?.mode;
        if (mode === "action" || mode === "dictation") {
          centrisDesktopMode = mode;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, current_mode: centrisDesktopMode }));
        } else {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "mode must be 'action' or 'dictation'" }));
        }
        return;
      }

      // Centris extension bridge status — loopback or token-gated
      if (requestPath === "/api/centris/status" && req.method === "GET") {
        const clientIp = resolveGatewayClientIp({
          remoteAddr: req.socket?.remoteAddress ?? "",
          forwardedFor: getHeader(req, "x-forwarded-for"),
          realIp: getHeader(req, "x-real-ip"),
          trustedProxies,
        });
        const isLocal = isPrivateOrLoopbackAddress(clientIp);
        if (
          !isLocal &&
          !validateExtensionToken(req.url, {
            clientIp,
            allowLocalWithoutToken: true,
          })
        ) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "forbidden" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(getCentrisExtensionStatus()));
        return;
      }

      // Centris desktop bridge status — loopback or token-gated
      if (requestPath === "/api/centris/desktop-status" && req.method === "GET") {
        const clientIp = resolveGatewayClientIp({
          remoteAddr: req.socket?.remoteAddress ?? "",
          forwardedFor: getHeader(req, "x-forwarded-for"),
          realIp: getHeader(req, "x-real-ip"),
          trustedProxies,
        });
        const isLocal = isPrivateOrLoopbackAddress(clientIp);
        if (
          !isLocal &&
          !validateExtensionToken(req.url, {
            clientIp,
            allowLocalWithoutToken: true,
          })
        ) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "forbidden" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(getCentrisDesktopStatus()));
        return;
      }

      if (requestPath === "/api/v1/action" && req.method === "POST") {
        const isLocal = isLocalDirectRequest(req, trustedProxies);
        if (!isLocal) {
          const token = getBearerToken(req);
          const authResult = await authorizeGatewayConnect({
            auth: resolvedAuth,
            connectAuth: token ? { token, password: token } : null,
            req,
            trustedProxies,
            rateLimiter,
          });
          if (!authResult.ok) {
            sendGatewayAuthFailure(res, authResult);
            return;
          }
        }

        const body = await readJsonBody(req, 256 * 1024);
        if (!body.ok || typeof body.value !== "object" || body.value === null) {
          sendJson(res, 400, {
            specVersion: "2026-02-19",
            method: "unknown",
            ok: false,
            error: { code: "INVALID_REQUEST", message: "invalid JSON body" },
          });
          return;
        }
        const payload = body.value as Record<string, unknown>;
        const response = await handleActionApiEnvelope({
          specVersion: typeof payload.specVersion === "string" ? payload.specVersion : undefined,
          method: typeof payload.method === "string" ? payload.method : undefined,
          id: typeof payload.id === "string" ? payload.id : undefined,
          params:
            payload.params && typeof payload.params === "object" && !Array.isArray(payload.params)
              ? (payload.params as Record<string, unknown>)
              : undefined,
        });
        sendJson(res, response.ok ? 200 : 400, response);
        return;
      }

      if (requestPath === "/api/v1/do" && req.method === "POST") {
        const version = parseRequestedApiVersion(req);
        if (!version.ok) {
          sendCentrisJson(res, 400, {
            status: "failed",
            code: "VERSION_NOT_SUPPORTED",
            error: `Unsupported API version: ${version.value}`,
          });
          return;
        }

        const authResult = await authorizeCentrisApiRequest({
          req,
          trustedProxies,
          auth: resolvedAuth,
          rateLimiter,
        });
        if (!authResult.ok) {
          sendGatewayAuthFailure(res, authResult);
          return;
        }

        const body = await readJsonBody(req, 256 * 1024);
        if (!body.ok || typeof body.value !== "object" || body.value === null) {
          sendCentrisJson(res, 400, {
            status: "failed",
            code: "INVALID_REQUEST",
            error: "invalid JSON body",
          });
          return;
        }

        const payload = body.value as Record<string, unknown>;
        const command = typeof payload.command === "string" ? payload.command.trim() : "";
        if (!command) {
          sendCentrisJson(res, 400, {
            status: "failed",
            code: "INVALID_REQUEST",
            error: "command is required",
          });
          return;
        }

        pruneCentrisTasks();
        const taskId = `ctask_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
        const task: CentrisTaskRecord = {
          id: taskId,
          status: "queued",
          createdAtMs: Date.now(),
          updatedAtMs: Date.now(),
        };
        centrisTasks.set(taskId, task);

        const asyncMode = payload.async === true;
        const context = payload.context;

        if (asyncMode) {
          queueMicrotask(() => {
            void runCentrisDoTask({ req, command, context, task }).catch((err) => {
              task.error = err instanceof Error ? err.message : String(err);
              task.code = "TASK_FAILED";
              recordTaskStatus(task, "failed");
            });
          });

          sendCentrisJson(res, 200, {
            task_id: taskId,
            status: "queued",
            result: "",
            actions: [],
          });
          return;
        }

        try {
          await runCentrisDoTask({ req, command, context, task });
          sendCentrisJson(res, 200, {
            task_id: taskId,
            status: "completed",
            result: task.result ?? "",
            actions: task.actions ?? [],
            usage: task.usage ?? { remaining: null },
          });
        } catch (err) {
          task.error = err instanceof Error ? err.message : String(err);
          task.code = "TASK_FAILED";
          recordTaskStatus(task, "failed");
          sendCentrisJson(res, 500, {
            task_id: taskId,
            status: "failed",
            error: task.error,
            code: task.code,
          });
        }
        return;
      }

      if (requestPath.startsWith("/api/v1/task/") && req.method === "GET") {
        const authResult = await authorizeCentrisApiRequest({
          req,
          trustedProxies,
          auth: resolvedAuth,
          rateLimiter,
        });
        if (!authResult.ok) {
          sendGatewayAuthFailure(res, authResult);
          return;
        }

        pruneCentrisTasks();
        const taskId = requestPath.slice("/api/v1/task/".length).trim();
        const task = taskId ? centrisTasks.get(taskId) : undefined;
        if (!task) {
          sendCentrisJson(res, 200, {
            task_id: taskId,
            status: "failed",
            error: "Task not found",
            code: "TASK_NOT_FOUND",
          });
          return;
        }

        sendCentrisJson(res, 200, {
          task_id: task.id,
          status: task.status,
          result: task.result ?? "",
          actions: task.actions ?? [],
          usage: task.usage,
          error: task.error,
          code: task.code,
        });
        return;
      }

      if (requestPath === "/api/v1/usage" && req.method === "GET") {
        const authResult = await authorizeCentrisApiRequest({
          req,
          trustedProxies,
          auth: resolvedAuth,
          rateLimiter,
        });
        if (!authResult.ok) {
          sendGatewayAuthFailure(res, authResult);
          return;
        }

        sendCentrisJson(res, 200, {
          tier: "local",
          tasks_remaining: 999999,
          monthly_limit: 999999,
          daily_bonus: 0,
          tasks_used_today: 0,
          period_ends: null,
        });
        return;
      }

      if (await handleHooksRequest(req, res)) {
        return;
      }
      if (
        await handleToolsInvokeHttpRequest(req, res, {
          auth: resolvedAuth,
          trustedProxies,
          rateLimiter,
        })
      ) {
        return;
      }
      if (await handleSlackHttpRequest(req, res)) {
        return;
      }
      if (handlePluginRequest) {
        // Channel HTTP endpoints are gateway-auth protected by default.
        // Non-channel plugin routes remain plugin-owned and must enforce
        // their own auth when exposing sensitive functionality.
        if (requestPath.startsWith("/api/channels/")) {
          const token = getBearerToken(req);
          const authResult = await authorizeGatewayConnect({
            auth: resolvedAuth,
            connectAuth: token ? { token, password: token } : null,
            req,
            trustedProxies,
            rateLimiter,
          });
          if (!authResult.ok) {
            sendGatewayAuthFailure(res, authResult);
            return;
          }
        }
        if (await handlePluginRequest(req, res)) {
          return;
        }
      }
      if (openResponsesEnabled) {
        if (
          await handleOpenResponsesHttpRequest(req, res, {
            auth: resolvedAuth,
            config: openResponsesConfig,
            trustedProxies,
            rateLimiter,
          })
        ) {
          return;
        }
      }
      if (openAiChatCompletionsEnabled) {
        if (
          await handleOpenAiHttpRequest(req, res, {
            auth: resolvedAuth,
            trustedProxies,
            rateLimiter,
          })
        ) {
          return;
        }
      }
      if (canvasHost) {
        if (isCanvasPath(requestPath)) {
          const ok = await authorizeCanvasRequest({
            req,
            auth: resolvedAuth,
            trustedProxies,
            clients,
            rateLimiter,
          });
          if (!ok.ok) {
            sendGatewayAuthFailure(res, ok);
            return;
          }
        }
        if (await handleA2uiHttpRequest(req, res)) {
          return;
        }
        if (await canvasHost.handleHttpRequest(req, res)) {
          return;
        }
      }
      if (controlUiEnabled) {
        if (
          handleControlUiAvatarRequest(req, res, {
            basePath: controlUiBasePath,
            resolveAvatar: (agentId) => resolveAgentAvatar(configSnapshot, agentId),
          })
        ) {
          return;
        }
        if (
          handleControlUiHttpRequest(req, res, {
            basePath: controlUiBasePath,
            config: configSnapshot,
            root: controlUiRoot,
          })
        ) {
          return;
        }
      }

      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Not Found");
    } catch {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Internal Server Error");
    }
  }

  return httpServer;
}

export function attachGatewayUpgradeHandler(opts: {
  httpServer: HttpServer;
  wss: WebSocketServer;
  canvasHost: CanvasHostHandler | null;
  clients: Set<GatewayWsClient>;
  resolvedAuth: ResolvedGatewayAuth;
  /** Optional rate limiter for auth brute-force protection. */
  rateLimiter?: AuthRateLimiter;
}) {
  const { httpServer, wss, canvasHost, clients, resolvedAuth, rateLimiter } = opts;
  httpServer.on("upgrade", (req, socket, head) => {
    void (async () => {
      const pathname = new URL(req.url ?? "/", "http://localhost").pathname;

      // Centris Chrome extension WebSocket — token-gated when CENTRIS_EXTENSION_TOKEN is set
      if (isCentrisExtensionPath(pathname)) {
        if (
          !validateExtensionToken(req.url, {
            clientIp: req.socket?.remoteAddress ?? "",
            allowLocalWithoutToken: true,
          })
        ) {
          socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
          handleCentrisExtensionConnection(ws, req);
        });
        return;
      }

      // Centris desktop app WebSocket — token-gated (same as extension bridge)
      if (isCentrisDesktopPath(pathname)) {
        if (
          !validateExtensionToken(req.url, {
            clientIp: req.socket?.remoteAddress ?? "",
            allowLocalWithoutToken: true,
          })
        ) {
          socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
          handleCentrisDesktopConnection(ws, req);
        });
        return;
      }

      // Centris voice WebSocket — token-gated (same as extension bridge)
      if (isCentrisVoicePath(pathname)) {
        if (
          !validateExtensionToken(req.url, {
            clientIp: req.socket?.remoteAddress ?? "",
            allowLocalWithoutToken: true,
          })
        ) {
          socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
          void handleCentrisVoiceConnection(ws, req);
        });
        return;
      }

      if (canvasHost) {
        if (pathname === CANVAS_WS_PATH) {
          const configSnapshot = loadConfig();
          const trustedProxies = configSnapshot.gateway?.trustedProxies ?? [];
          const ok = await authorizeCanvasRequest({
            req,
            auth: resolvedAuth,
            trustedProxies,
            clients,
            rateLimiter,
          });
          if (!ok.ok) {
            writeUpgradeAuthFailure(socket, ok);
            socket.destroy();
            return;
          }
        }
        if (canvasHost.handleUpgrade(req, socket, head)) {
          return;
        }
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    })().catch(() => {
      socket.destroy();
    });
  });
}
