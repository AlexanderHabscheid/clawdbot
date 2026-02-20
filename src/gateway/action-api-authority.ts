import crypto from "node:crypto";
import type { KernelRouteStep } from "../../sdk/typescript/src/kernel/types.js";
import type {
  ManifestSuccessCheck,
  LoadedManifest,
} from "../../sdk/typescript/src/manifest/index.js";
import {
  persistLearnedRoute,
  updateLearnedRouteOutcome,
} from "../../sdk/typescript/src/kernel/learned-routes.js";
import { loadManifests } from "../../sdk/typescript/src/manifest/loader.js";
import { isCentrisExtensionConnected, sendExtensionCommand } from "./centris-extension-bridge.js";

type KernelSuccessCheck =
  | { type: "url_contains"; value: string }
  | { type: "text_present"; value: string }
  | { type: "element_visible"; value: string }
  | { type: "download"; value?: string }
  | { type: "network_url_contains"; value: string };

type ActionApiEnvelope = {
  specVersion?: string;
  method?: string;
  id?: string;
  params?: Record<string, unknown>;
};

type ActionApiResponse = {
  specVersion: string;
  method: string;
  id?: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string; details?: Record<string, unknown> };
};

type RecordedSession = {
  sessionId: string;
  intent: string;
  startedAt: string;
  url?: string;
  params?: Record<string, string>;
  metadata?: Record<string, unknown>;
  steps: Array<Record<string, unknown>>;
};

type RecordedRoute = {
  routeId: string;
  intent: string;
  updatedAt: string;
  steps: Array<Record<string, unknown>>;
  checks?: KernelSuccessCheck[];
  urlPattern?: string;
};

const ACTION_SPEC_VERSION = "2026-02-19";
const sessions = new Map<string, RecordedSession>();
const routes = new Map<string, RecordedRoute>();
let activeRecordingSessionId: string | null = null;

function actionError(
  method: string,
  id: string | undefined,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): ActionApiResponse {
  return {
    specVersion: ACTION_SPEC_VERSION,
    method,
    id,
    ok: false,
    error: { code, message, details },
  };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toSafeChecks(value: unknown): KernelSuccessCheck[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const checks: KernelSuccessCheck[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const rec = item as Record<string, unknown>;
    const type = asString(rec.type);
    const checkValue = asString(rec.value);
    if (
      (type === "url_contains" ||
        type === "text_present" ||
        type === "element_visible" ||
        type === "network_url_contains") &&
      checkValue
    ) {
      checks.push({ type, value: checkValue });
      continue;
    }
    if (type === "download") {
      checks.push(checkValue ? { type, value: checkValue } : { type });
    }
  }
  return checks.length > 0 ? checks : undefined;
}

function toSafeSteps(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }
  const steps: Array<Record<string, unknown>> = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    steps.push(item as Record<string, unknown>);
  }
  return steps;
}

function toLearnedSteps(value: Array<Record<string, unknown>>): KernelRouteStep[] {
  const steps: KernelRouteStep[] = [];
  for (const step of value) {
    const navigate = asString(step.navigate);
    if (navigate) {
      steps.push({ navigate });
      continue;
    }
    const click = asString(step.click);
    if (click) {
      steps.push({ click });
      continue;
    }
    const typeStep = step.type;
    if (typeStep && typeof typeStep === "object") {
      const target = asString((typeStep as Record<string, unknown>).target);
      const stepValue = asString((typeStep as Record<string, unknown>).value) ?? "";
      if (target) {
        steps.push({ type: { target, value: stepValue } });
        continue;
      }
    }
    const press = asString(step.press);
    if (press) {
      steps.push({ press });
      continue;
    }
    const wait = asNumber(step.wait);
    if (wait != null) {
      steps.push({ wait: Math.max(1, Math.floor(wait)) });
      continue;
    }
    const direction = asString(step.scroll);
    if (direction === "up" || direction === "down") {
      const amount = asNumber(step.amount);
      steps.push({
        scroll: direction,
        ...(amount != null ? { amount: Math.max(1, Math.floor(amount)) } : {}),
      });
    }
  }
  return steps;
}

function deriveUrlPattern(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  try {
    const parsed = new URL(url);
    return `${parsed.origin}/*`;
  } catch {
    return undefined;
  }
}

function deriveAppId(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  try {
    const host = new URL(url).hostname.trim().toLowerCase();
    const normalized = host.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return normalized || undefined;
  } catch {
    return undefined;
  }
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function normalizeUrlForPattern(url: string): string {
  return url
    .replace(/^https?:\/\//, "")
    .replace(/[?#].*$/, "")
    .replace(/\/$/, "");
}

function urlPatternMatches(patterns: string[], url: string): boolean {
  const normalizedUrl = normalizeUrlForPattern(url);
  for (const pattern of patterns) {
    if (globToRegex(pattern).test(normalizedUrl)) {
      return true;
    }
  }
  return false;
}

async function persistRecordedRoute(params: {
  routeId: string;
  session: RecordedSession;
  outcome: "success" | "failed" | "cancelled";
  checks?: KernelSuccessCheck[];
}): Promise<string | undefined> {
  const metadata = params.session.metadata ?? {};
  const url = asString(metadata.url) ?? params.session.url;
  const pattern = asString(metadata.urlPattern) ?? deriveUrlPattern(url);
  const appId = asString(metadata.appId) ?? deriveAppId(url);
  const baseDir = asString(metadata.learnBaseDir);

  if (!pattern) {
    return undefined;
  }

  if (params.outcome === "failed") {
    try {
      updateLearnedRouteOutcome({
        routeId: params.routeId,
        urlPattern: pattern,
        outcome: "failure",
        baseDir,
        appId,
      });
    } catch {
      // persistence updates are best-effort
    }
    return pattern;
  }

  if (params.outcome === "cancelled" || params.session.steps.length === 0) {
    return pattern;
  }
  const learnedSteps = toLearnedSteps(params.session.steps);
  if (learnedSteps.length === 0) {
    return pattern;
  }

  try {
    persistLearnedRoute({
      request: {
        id: params.routeId,
        urlPattern: pattern,
        steps: learnedSteps,
        checks: params.checks,
      },
      baseDir,
      appId,
    });
  } catch {
    // persistence updates are best-effort
  }
  return pattern;
}

function tryResolveFromLoadedManifests(params: {
  loaded: LoadedManifest[];
  routeId: string;
  url?: string;
}): RecordedRoute | null {
  const matches: RecordedRoute[] = [];
  for (const entry of params.loaded) {
    const manifest = entry.manifest;
    if (params.url && !urlPatternMatches(manifest.url_patterns, params.url)) {
      continue;
    }
    for (const [routeKey, route] of Object.entries(manifest.routes)) {
      const action = route.actions?.[params.routeId];
      if (!action) {
        continue;
      }
      matches.push({
        routeId: params.routeId,
        intent: action.description || `${manifest.app}:${routeKey}`,
        updatedAt: action.lastVerifiedAt ?? new Date().toISOString(),
        steps: toSafeSteps(action.steps),
        checks: toSafeChecks(action.successChecks as ManifestSuccessCheck[]),
        urlPattern: manifest.url_patterns[0],
      });
    }
  }

  if (matches.length === 0) {
    return null;
  }
  if (matches.length === 1) {
    return matches[0];
  }
  if (params.url) {
    return matches[0];
  }
  throw new Error(
    `multiple persisted routes found for ${params.routeId}; provide url to disambiguate`,
  );
}

function toRecordedStep(params: Record<string, unknown>): Record<string, unknown> | null {
  const kind = asString(params.kind);
  if (!kind) {
    return null;
  }
  if (kind === "navigate") {
    const value = asString(params.value) ?? asString(params.target);
    return value ? { navigate: value } : null;
  }
  if (kind === "click") {
    const target = asString(params.target);
    return target ? { click: target } : null;
  }
  if (kind === "type") {
    const target = asString(params.target) ?? "";
    const value = asString(params.value) ?? "";
    return { type: { target, value } };
  }
  if (kind === "press") {
    const value = asString(params.value) ?? asString(params.target);
    return value ? { press: value } : null;
  }
  if (kind === "wait") {
    return { wait: Math.max(1, Math.floor(asNumber(params.amount) ?? 250)) };
  }
  if (kind === "scroll") {
    const direction = (asString(params.value) ?? "down").toLowerCase() === "up" ? "up" : "down";
    const amount = asNumber(params.amount);
    return amount != null ? { scroll: direction, amount } : { scroll: direction };
  }
  return null;
}

async function getSnapshot(instruction?: string): Promise<Record<string, unknown>> {
  return (await sendExtensionCommand("get_interactive_snapshot", {
    instruction,
    maxChars: 4000,
  })) as Record<string, unknown>;
}

async function runAct(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const kind = asString(params.kind);
  if (!kind) {
    throw new Error("kind is required");
  }
  const nodeId = asNumber(params.nodeId);

  if (kind === "navigate") {
    const url = asString(params.value) ?? asString(params.target);
    if (!url) {
      throw new Error("navigate requires value or target");
    }
    await sendExtensionCommand("navigate_browser", { url });
    return { ok: true };
  }

  if (kind === "click") {
    const target = asString(params.target);
    if (Number.isFinite(nodeId)) {
      await sendExtensionCommand("click_node", { nodeId });
      return { ok: true };
    }
    if (!target) {
      throw new Error("click requires nodeId or target");
    }
    const parsedTargetNodeId = Number.parseInt(target, 10);
    if (Number.isFinite(parsedTargetNodeId) && `${parsedTargetNodeId}` === target.trim()) {
      await sendExtensionCommand("click_node", { nodeId: parsedTargetNodeId });
    } else {
      await sendExtensionCommand("click_node", { selector: target });
    }
    return { ok: true };
  }

  if (kind === "type") {
    const target = asString(params.target);
    const value = asString(params.value) ?? "";
    if (Number.isFinite(nodeId)) {
      await sendExtensionCommand("type_into_node", { nodeId, text: value });
      return { ok: true };
    }
    if (target) {
      const parsedTargetNodeId = Number.parseInt(target, 10);
      if (Number.isFinite(parsedTargetNodeId) && `${parsedTargetNodeId}` === target.trim()) {
        await sendExtensionCommand("type_into_node", { nodeId: parsedTargetNodeId, text: value });
      } else {
        await sendExtensionCommand("type_text", { selector: target, text: value });
      }
    } else {
      await sendExtensionCommand("global_type", { text: value });
    }
    return { ok: true };
  }

  if (kind === "press") {
    const key = asString(params.value) ?? asString(params.target);
    if (!key) {
      throw new Error("press requires value or target");
    }
    await sendExtensionCommand("press_key", { key });
    return { ok: true };
  }

  if (kind === "wait") {
    const ms = Math.max(1, Math.floor(asNumber(params.amount) ?? 250));
    await new Promise((resolve) => setTimeout(resolve, ms));
    return { ok: true };
  }

  if (kind === "scroll") {
    const direction = (asString(params.value) ?? "down").toLowerCase() === "up" ? "up" : "down";
    const amount = Math.max(1, Math.floor(asNumber(params.amount) ?? 400));
    await sendExtensionCommand("scroll", { direction, amount });
    return { ok: true };
  }

  throw new Error(`unsupported action kind: ${kind}`);
}

async function runVerify(checks: KernelSuccessCheck[]): Promise<{
  ok: boolean;
  passed: KernelSuccessCheck[];
  failed: KernelSuccessCheck[];
}> {
  const snapshot = await getSnapshot();
  const metadata = (snapshot.metadata as Record<string, unknown> | undefined) ?? {};
  const currentUrl = asString(metadata.url) ?? "";
  const nodes = Array.isArray(snapshot.interactiveNodes)
    ? (snapshot.interactiveNodes as Array<Record<string, unknown>>)
    : [];
  const nodeText = nodes
    .map((node) => asString(node.n) ?? asString(node.name) ?? "")
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  const readable = (await sendExtensionCommand("get_readable_content", {})) as Record<
    string,
    unknown
  >;
  const pageContent = (asString(readable.content) ?? asString(readable.text) ?? "").toLowerCase();

  const passed: KernelSuccessCheck[] = [];
  const failed: KernelSuccessCheck[] = [];

  for (const check of checks) {
    let ok = false;
    if (check.type === "url_contains") {
      ok = currentUrl.includes(check.value);
    } else if (check.type === "text_present") {
      const needle = check.value.toLowerCase();
      ok = pageContent.includes(needle) || nodeText.includes(needle);
    } else if (check.type === "element_visible") {
      const needle = check.value.toLowerCase();
      ok = nodes.some((node) => {
        const selector = asString(node.selector)?.toLowerCase();
        const name = (asString(node.n) ?? asString(node.name) ?? "").toLowerCase();
        return selector === needle || name.includes(needle);
      });
    } else if (check.type === "download" || check.type === "network_url_contains") {
      ok = false;
    }

    if (ok) {
      passed.push(check);
    } else {
      failed.push(check);
    }
  }

  return { ok: failed.length === 0, passed, failed };
}

async function runRoute(routeId: string, url?: string, checks?: KernelSuccessCheck[]) {
  let route = routes.get(routeId);
  if (!route) {
    const loaded = loadManifests();
    route = tryResolveFromLoadedManifests({ loaded, routeId, url }) ?? undefined;
    if (route) {
      routes.set(routeId, route);
    }
  }
  if (!route) {
    throw new Error(`unknown routeId: ${routeId}`);
  }

  let executed = 0;
  if (url) {
    await runAct({ kind: "navigate", value: url });
    executed++;
  }

  for (const step of route.steps) {
    if ("navigate" in step) {
      await runAct({ kind: "navigate", value: step.navigate });
      executed++;
      continue;
    }
    if ("click" in step) {
      await runAct({ kind: "click", target: step.click });
      executed++;
      continue;
    }
    if ("type" in step) {
      const typeStep = step.type as { target?: string; value?: string };
      await runAct({
        kind: "type",
        target: typeStep.target,
        value: typeStep.value,
      });
      executed++;
      continue;
    }
    if ("press" in step) {
      await runAct({ kind: "press", value: step.press });
      executed++;
      continue;
    }
    if ("wait" in step) {
      await runAct({ kind: "wait", amount: step.wait });
      executed++;
      continue;
    }
    if ("scroll" in step) {
      const direction = asString(step.scroll) ?? "down";
      await runAct({ kind: "scroll", value: direction, amount: asNumber(step.amount) });
      executed++;
    }
  }

  const verifyChecks = checks && checks.length > 0 ? checks : route.checks;
  const verify =
    verifyChecks && verifyChecks.length > 0 ? await runVerify(verifyChecks) : undefined;
  if (route.urlPattern) {
    try {
      updateLearnedRouteOutcome({
        routeId: route.routeId,
        urlPattern: route.urlPattern,
        outcome: verify ? (verify.ok ? "success" : "failure") : "success",
      });
    } catch {
      // confidence updates are best-effort and should not break route execution
    }
  }
  return { ok: verify ? verify.ok : true, executed, verify };
}

export async function handleActionApiEnvelope(
  envelope: ActionApiEnvelope,
): Promise<ActionApiResponse> {
  const specVersion = asString(envelope.specVersion) ?? ACTION_SPEC_VERSION;
  const method = asString(envelope.method) ?? "";
  const id = asString(envelope.id);
  const params = envelope.params ?? {};

  if (process.env.CENTRIS_ACTION_API_DISABLED === "1") {
    return actionError(method || "unknown", id, "ACTION_API_DISABLED", "Action API is disabled.");
  }

  if (!method) {
    return actionError("unknown", id, "INVALID_REQUEST", "method is required");
  }

  if (!isCentrisExtensionConnected()) {
    return actionError(
      method,
      id,
      "BRIDGE_NOT_CONNECTED",
      "Centris extension bridge is not connected.",
    );
  }

  try {
    if (method === "observe") {
      const snapshot = await getSnapshot(asString(params.instruction));
      const metadata = (snapshot.metadata as Record<string, unknown> | undefined) ?? {};
      const internalNodes = Array.isArray(snapshot._internalNodes)
        ? (snapshot._internalNodes as Array<Record<string, unknown>>)
        : [];
      const internalByNodeId = new Map<number, Record<string, unknown>>();
      for (const node of internalNodes) {
        const id = asNumber(node.nodeId) ?? asNumber(node.id);
        if (typeof id === "number") {
          internalByNodeId.set(id, node);
        }
      }
      const interactive = Array.isArray(snapshot.interactiveNodes)
        ? (snapshot.interactiveNodes as Array<Record<string, unknown>>).map((node) => {
            const nodeId = asNumber(node.id) ?? asNumber(node.nodeId);
            const internal = typeof nodeId === "number" ? internalByNodeId.get(nodeId) : undefined;
            const item: Record<string, unknown> = {
              name:
                asString(node.n) ??
                asString(node.name) ??
                asString(internal?.name) ??
                asString(internal?.textContent) ??
                "",
            };
            const resolvedNodeId = nodeId ?? asNumber(internal?.nodeId);
            const type = asString(node.t) ?? asString(node.type) ?? asString(internal?.type);
            const role = asString(node.r) ?? asString(node.role) ?? asString(internal?.role);
            const selector = asString(internal?.selector) ?? asString(node.selector);
            if (typeof resolvedNodeId === "number") {
              item.nodeId = resolvedNodeId;
            }
            if (type) {
              item.type = type;
            }
            if (role) {
              item.role = role;
            }
            if (selector) {
              item.selector = selector;
            }
            return item;
          })
        : [];
      return {
        specVersion,
        method,
        id,
        ok: true,
        result: {
          url: asString(metadata.url) ?? "",
          title: asString(metadata.title),
          interactive,
        },
      };
    }

    if (method === "act") {
      const result = await runAct(params);
      const recorded = toRecordedStep(params);
      if (recorded && activeRecordingSessionId) {
        const session = sessions.get(activeRecordingSessionId);
        if (session) {
          session.steps.push(recorded);
        }
      }
      return { specVersion, method, id, ok: true, result };
    }

    if (method === "verify") {
      const checks = (Array.isArray(params.checks) ? params.checks : []) as KernelSuccessCheck[];
      const verify = await runVerify(checks);
      return { specVersion, method, id, ok: true, result: verify };
    }

    if (method === "route.run") {
      const routeId = asString(params.routeId) ?? "";
      if (!routeId) {
        return actionError(method, id, "INVALID_REQUEST", "routeId is required");
      }
      const checks = (Array.isArray(params.checks) ? params.checks : undefined) as
        | KernelSuccessCheck[]
        | undefined;
      const result = await runRoute(routeId, asString(params.url), checks);
      return { specVersion, method, id, ok: true, result };
    }

    if (method === "route.record.start") {
      const intent = asString(params.intent) ?? "";
      if (!intent) {
        return actionError(method, id, "INVALID_REQUEST", "intent is required");
      }
      const sessionId = `rec_${crypto.randomUUID()}`;
      const startedAt = new Date().toISOString();
      sessions.set(sessionId, {
        sessionId,
        intent,
        startedAt,
        url: asString(params.url),
        params: (params.params as Record<string, string> | undefined) ?? undefined,
        metadata: (params.metadata as Record<string, unknown> | undefined) ?? undefined,
        steps: [],
      });
      activeRecordingSessionId = sessionId;
      return {
        specVersion,
        method,
        id,
        ok: true,
        result: { ok: true, sessionId, startedAt },
      };
    }

    if (method === "route.record.stop") {
      const sessionId = asString(params.sessionId) ?? "";
      if (!sessionId) {
        return actionError(method, id, "INVALID_REQUEST", "sessionId is required");
      }
      const session = sessions.get(sessionId);
      if (!session) {
        return actionError(method, id, "NOT_FOUND", `session not found: ${sessionId}`);
      }
      sessions.delete(sessionId);
      if (activeRecordingSessionId === sessionId) {
        activeRecordingSessionId = null;
      }
      const routeId =
        asString(session.metadata?.routeId) ??
        `${session.intent.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}_${Date.now()}`;
      const updatedAt = new Date().toISOString();
      const mergedChecks =
        toSafeChecks((params.metadata as Record<string, unknown> | undefined)?.checks) ??
        toSafeChecks(session.metadata?.checks);
      const outcome =
        (asString(params.outcome) as "success" | "failed" | "cancelled" | undefined) ?? "success";
      const urlPattern = await persistRecordedRoute({
        routeId,
        session,
        outcome,
        checks: mergedChecks,
      });
      routes.set(routeId, {
        routeId,
        intent: session.intent,
        updatedAt,
        steps: session.steps,
        checks: mergedChecks,
        urlPattern:
          urlPattern ?? asString(session.metadata?.urlPattern) ?? deriveUrlPattern(session.url),
      });
      return {
        specVersion,
        method,
        id,
        ok: true,
        result: { ok: true, routeId, updatedAt },
      };
    }

    return actionError(method, id, "METHOD_NOT_FOUND", `unsupported method: ${method}`);
  } catch (err) {
    return actionError(
      method,
      id,
      "ACTION_API_FAILED",
      err instanceof Error ? err.message : String(err),
    );
  }
}
