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
import { validateWebMemoryIndexPayload } from "../../sdk/typescript/src/web-memory/ingest.js";
import { isCentrisDesktopConnected, sendDesktopCommand } from "./centris-desktop-bridge.js";
import { isCentrisExtensionConnected, sendExtensionCommand } from "./centris-extension-bridge.js";
import { getWebMemoryStore } from "./web-memory-store.js";

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

type ActionPageFingerprint = {
  fingerprintId?: string;
  urlPattern?: string;
  confidence?: number;
};

type ActionNodeHint = {
  nodeId?: number;
  selector?: string;
  role?: string;
  name?: string;
};

type ActionAnchor = {
  anchorType?: string;
  value?: string;
};

type ActionIndexEntry = {
  actionId: string;
  affordance?: string;
  semanticLabel?: string;
  nodeHints?: ActionNodeHint[];
  anchors?: ActionAnchor[];
  confidence?: number;
};

type ActionRouteMemoryStep = {
  actionId?: string;
  operation?: string;
  params?: Record<string, string>;
};

type ActionRouteMemory = {
  routeId: string;
  steps?: ActionRouteMemoryStep[];
  confidence?: number;
};

type WebMemoryEntry = {
  cacheKey: string;
  url: string;
  normalizedUrl: string;
  domain: string;
  intent?: string;
  playbook?: Record<string, unknown>;
  pageFingerprint?: ActionPageFingerprint;
  actionIndex: ActionIndexEntry[];
  routeMemory?: ActionRouteMemory;
  confidence: number;
  createdAt: string;
  expiresAt: string;
  resolveHits: number;
};

const ACTION_SPEC_VERSION = "2026-02-19";
const sessions = new Map<string, RecordedSession>();
const routes = new Map<string, RecordedRoute>();
let activeRecordingSessionId: string | null = null;

function extractUserId(params: Record<string, unknown>): string | undefined {
  const uid = asString(params.userId);
  if (uid) {
    return uid;
  }
  const session = asObject(params.session);
  const meta = session ? asObject(session.metadata) : undefined;
  return meta ? asString(meta.userId) : undefined;
}
let webMemoryHits = 0;
let webMemoryMisses = 0;
let webMemoryResolveMsTotal = 0;
let webMemoryResolveCount = 0;
let webMemoryExecuteMsTotal = 0;
let webMemoryExecuteCount = 0;

const WEB_MEMORY_DEFAULT_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const MEMORY_ROUTE_CONFIDENCE_THRESHOLD = 0.75;
const MAX_DESKTOP_ELEMENTS_CHARS = 4000;
const ROUTE_FAILURE_CLUSTER_THRESHOLD = 2;
const routeFailureStreakByCluster = new Map<string, number>();

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

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asArrayOfObjects(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: Array<Record<string, unknown>> = [];
  for (const item of value) {
    const rec = asObject(item);
    if (rec) {
      out.push(rec);
    }
  }
  return out;
}

function clampConfidence(value: number | undefined, fallback = 0.5): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
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

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url.trim();
  }
}

function toDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function deriveActionKind(operation: string | undefined): string | undefined {
  const normalized = (operation ?? "").trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === "submit" || normalized === "select") {
    return "click";
  }
  if (
    normalized === "click" ||
    normalized === "type" ||
    normalized === "navigate" ||
    normalized === "press" ||
    normalized === "wait" ||
    normalized === "scroll"
  ) {
    return normalized;
  }
  return undefined;
}

function toActionIndexEntries(value: unknown): ActionIndexEntry[] {
  const entries: ActionIndexEntry[] = [];
  for (const item of asArrayOfObjects(value)) {
    const actionId = asString(item.actionId);
    if (!actionId) {
      continue;
    }
    const nodeHints: ActionNodeHint[] = [];
    for (const hint of asArrayOfObjects(item.nodeHints)) {
      nodeHints.push({
        nodeId: asNumber(hint.nodeId),
        selector: asString(hint.selector),
        role: asString(hint.role),
        name: asString(hint.name),
      });
    }
    const anchors: ActionAnchor[] = [];
    for (const anchor of asArrayOfObjects(item.anchors)) {
      anchors.push({
        anchorType: asString(anchor.anchorType),
        value: asString(anchor.value),
      });
    }
    entries.push({
      actionId,
      affordance: asString(item.affordance),
      semanticLabel: asString(item.semanticLabel),
      nodeHints,
      anchors,
      confidence: asNumber(item.confidence),
    });
  }
  return entries;
}

function toRouteMemory(value: unknown): ActionRouteMemory | undefined {
  const rec = asObject(value);
  if (!rec) {
    return undefined;
  }
  const routeId = asString(rec.routeId);
  if (!routeId) {
    return undefined;
  }
  const steps: ActionRouteMemoryStep[] = [];
  for (const step of asArrayOfObjects(rec.steps)) {
    const rawParams = asObject(step.params);
    const params: Record<string, string> = {};
    if (rawParams) {
      for (const [k, v] of Object.entries(rawParams)) {
        params[k] = String(v);
      }
    }
    steps.push({
      actionId: asString(step.actionId),
      operation: asString(step.operation),
      ...(Object.keys(params).length > 0 ? { params } : {}),
    });
  }
  return {
    routeId,
    steps,
    confidence: asNumber(rec.confidence),
  };
}

function toPageFingerprint(value: unknown): ActionPageFingerprint | undefined {
  const rec = asObject(value);
  if (!rec) {
    return undefined;
  }
  return {
    fingerprintId: asString(rec.fingerprintId),
    urlPattern: asString(rec.urlPattern),
    confidence: asNumber(rec.confidence),
  };
}

function computeRouteConfidence(params: {
  pageFingerprint?: ActionPageFingerprint;
  actionIndex?: ActionIndexEntry[];
  routeMemory?: ActionRouteMemory;
}): number {
  const routeScore = asNumber(params.routeMemory?.confidence);
  if (typeof routeScore === "number") {
    return clampConfidence(routeScore);
  }
  const actionScores = (params.actionIndex ?? [])
    .map((item) => asNumber(item.confidence))
    .filter((item): item is number => typeof item === "number");
  if (actionScores.length > 0) {
    const avg = actionScores.reduce((sum, score) => sum + score, 0) / actionScores.length;
    return clampConfidence(avg);
  }
  return clampConfidence(asNumber(params.pageFingerprint?.confidence), 0.5);
}

function selectorCandidatesFromAnchor(anchor: ActionAnchor): string[] {
  const anchorType = (anchor.anchorType ?? "").trim().toLowerCase();
  const value = (anchor.value ?? "").trim();
  if (!value) {
    return [];
  }
  if (anchorType === "selector") {
    return [value];
  }
  if (anchorType === "test_id") {
    return [
      `[data-testid='${value}']`,
      `[data-test-id='${value}']`,
      `[data-test='${value}']`,
      `[testid='${value}']`,
    ];
  }
  if (anchorType === "business_id") {
    return [
      `[data-centris-action='${value}']`,
      `[data-centris-id='${value}']`,
      `[data-action-id='${value}']`,
      `[data-business-id='${value}']`,
    ];
  }
  return [];
}

function buildActionTargets(
  entry: ActionIndexEntry | undefined,
  explicitTarget: string | undefined,
): Array<{ nodeId?: number; target?: string }> {
  const dedupe = new Set<string>();
  const targets: Array<{ nodeId?: number; target?: string }> = [];

  const addNodeId = (nodeId: number | undefined) => {
    if (typeof nodeId !== "number") {
      return;
    }
    const key = `node:${nodeId}`;
    if (dedupe.has(key)) {
      return;
    }
    dedupe.add(key);
    targets.push({ nodeId });
  };

  const addSelector = (selector: string | undefined) => {
    const normalized = (selector ?? "").trim();
    if (!normalized) {
      return;
    }
    const key = `selector:${normalized}`;
    if (dedupe.has(key)) {
      return;
    }
    dedupe.add(key);
    targets.push({ target: normalized });
  };

  addSelector(explicitTarget);
  for (const hint of entry?.nodeHints ?? []) {
    addNodeId(hint.nodeId);
    addSelector(hint.selector);
  }
  for (const anchor of entry?.anchors ?? []) {
    for (const selector of selectorCandidatesFromAnchor(anchor)) {
      addSelector(selector);
    }
  }
  return targets;
}

type ActionAttempt = {
  kind: "navigate" | "click" | "type" | "press" | "wait" | "scroll";
  nodeId?: number;
  target?: string;
  value?: string;
  amount?: number;
};

function routeMemoryStepToActParams(
  step: ActionRouteMemoryStep,
  actionById: Map<string, ActionIndexEntry>,
): ActionAttempt[] | null {
  const mapped = step.actionId ? actionById.get(step.actionId) : undefined;
  const params = step.params ?? {};
  const operation = deriveActionKind(step.operation ?? mapped?.affordance);
  if (!operation) {
    return null;
  }
  if (operation === "navigate") {
    const value = params.value ?? params.url ?? params.target ?? mapped?.semanticLabel;
    return value ? [{ kind: "navigate", value }] : null;
  }
  if (operation === "type") {
    const value = params.value ?? params.text ?? "";
    const targets = buildActionTargets(mapped, params.target);
    if (targets.length === 0) {
      return [{ kind: "type", value }];
    }
    return targets.map((candidate) => ({
      kind: "type",
      value,
      ...(typeof candidate.nodeId === "number" ? { nodeId: candidate.nodeId } : {}),
      ...(candidate.target ? { target: candidate.target } : {}),
    }));
  }
  if (operation === "press") {
    const value = params.value ?? params.key ?? mapped?.semanticLabel;
    return value ? [{ kind: "press", value }] : null;
  }
  if (operation === "wait") {
    const amount = Number.parseInt(params.amount ?? "250", 10);
    return [{ kind: "wait", amount: Number.isFinite(amount) ? amount : 250 }];
  }
  if (operation === "scroll") {
    return [
      {
        kind: "scroll",
        value: params.value ?? "down",
        amount: Number.parseInt(params.amount ?? "400", 10),
      },
    ];
  }
  const clickTargets = buildActionTargets(mapped, params.target);
  if (clickTargets.length === 0) {
    return null;
  }
  return clickTargets.map((candidate) => ({
    kind: "click",
    ...(typeof candidate.nodeId === "number" ? { nodeId: candidate.nodeId } : {}),
    ...(candidate.target ? { target: candidate.target } : {}),
  }));
}

async function runRouteMemory(params: {
  routeMemory: ActionRouteMemory;
  actionIndex: ActionIndexEntry[];
  url?: string;
  checks?: KernelSuccessCheck[];
}): Promise<{ ok: boolean; executed: number; verify?: Awaited<ReturnType<typeof runVerify>> }> {
  let executed = 0;
  if (params.url) {
    await runAct({ kind: "navigate", value: params.url });
    executed++;
  }

  const actionById = new Map<string, ActionIndexEntry>();
  for (const entry of params.actionIndex) {
    actionById.set(entry.actionId, entry);
  }

  for (const step of params.routeMemory.steps ?? []) {
    const attempts = routeMemoryStepToActParams(step, actionById);
    if (!attempts || attempts.length === 0) {
      continue;
    }
    let succeeded = false;
    let lastError: unknown;
    for (const attempt of attempts) {
      try {
        await runAct(attempt);
        executed++;
        succeeded = true;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!succeeded && lastError) {
      throw lastError;
    }
  }

  const verify =
    params.checks && params.checks.length > 0 ? await runVerify(params.checks) : undefined;
  return { ok: verify ? verify.ok : true, executed, verify };
}

function buildWebMemoryCacheKey(url: string, intent?: string): string {
  const normalizedUrl = normalizeUrl(url);
  const normalizedIntent = (intent ?? "").trim().toLowerCase();
  const digest = crypto
    .createHash("sha1")
    .update(`${normalizedUrl}|${normalizedIntent}`)
    .digest("hex")
    .slice(0, 16);
  return `wm_${digest}`;
}

function buildFailureClusterKey(params: {
  routeId: string;
  url?: string;
  pageFingerprint?: ActionPageFingerprint;
}): string {
  return `${params.routeId}|${toDomain(params.url ?? "")}|${params.pageFingerprint?.fingerprintId ?? ""}`;
}

function markFailureCluster(params: {
  routeId: string;
  url?: string;
  pageFingerprint?: ActionPageFingerprint;
}): number {
  const key = buildFailureClusterKey(params);
  const next = (routeFailureStreakByCluster.get(key) ?? 0) + 1;
  routeFailureStreakByCluster.set(key, next);
  return next;
}

function clearFailureCluster(params: {
  routeId: string;
  url?: string;
  pageFingerprint?: ActionPageFingerprint;
}): void {
  routeFailureStreakByCluster.delete(buildFailureClusterKey(params));
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

function capDesktopElements(rawElements: unknown): {
  elements: Array<Record<string, unknown>>;
  totalCount: number;
} {
  const source = Array.isArray(rawElements) ? (rawElements as Array<Record<string, unknown>>) : [];
  const elements: Array<Record<string, unknown>> = [];
  let charCount = 0;
  for (const element of source) {
    const slim: Record<string, unknown> = {
      id: asNumber(element.id),
      role: asString(element.role),
      name: asString(element.name),
    };
    const value = asString(element.value);
    if (value) {
      slim.value = value.slice(0, 120);
    }
    const serialized = JSON.stringify(slim);
    if (charCount + serialized.length + 1 > MAX_DESKTOP_ELEMENTS_CHARS) {
      break;
    }
    charCount += serialized.length + 1;
    elements.push(slim);
  }
  return { elements, totalCount: source.length };
}

async function runDesktopSnapshot(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = (await sendDesktopCommand("snapshot", {
    appName: asString(params.appName),
    windowTitle: asString(params.windowTitle),
  })) as Record<string, unknown>;
  const capped = capDesktopElements(result.elements);
  return {
    appName: asString(result.appName),
    windowTitle: asString(result.windowTitle),
    elementCount: capped.totalCount,
    elements: capped.elements,
    ...(capped.elements.length < capped.totalCount
      ? { note: `${capped.elements.length}/${capped.totalCount} shown (capped).` }
      : {}),
  };
}

async function runDesktopFind(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = (await sendDesktopCommand("find_elements", {
    appName: asString(params.appName),
    windowTitle: asString(params.windowTitle),
    role: asString(params.role),
    name: asString(params.name),
  })) as Record<string, unknown>;
  const capped = capDesktopElements(result.elements);
  return {
    count: capped.totalCount,
    elements: capped.elements,
    ...(capped.elements.length < capped.totalCount
      ? { note: `${capped.elements.length}/${capped.totalCount} shown (capped).` }
      : {}),
  };
}

async function runDesktopClick(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const elementId = asNumber(params.elementId);
  if (typeof elementId !== "number") {
    throw new Error("elementId is required");
  }
  const result = (await sendDesktopCommand("click_element", { elementId })) as Record<
    string,
    unknown
  >;
  return { ok: true, details: result };
}

async function runDesktopType(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const text = asString(params.text);
  if (!text) {
    throw new Error("text is required");
  }
  const elementId = asNumber(params.elementId);
  const action = typeof elementId === "number" ? "type_into_element" : "insert_text";
  const payload: Record<string, unknown> = { text };
  if (typeof elementId === "number") {
    payload.elementId = elementId;
  }
  const result = (await sendDesktopCommand(action, payload)) as Record<string, unknown>;
  return { ok: true, details: result };
}

async function runDesktopApps(): Promise<Record<string, unknown>> {
  const result = await sendDesktopCommand("list_apps", {});
  return { apps: Array.isArray(result) ? result : [] };
}

async function runDesktopWindows(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await sendDesktopCommand("list_windows", {
    appName: asString(params.appName),
  });
  return { windows: Array.isArray(result) ? result : [] };
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

async function runManifestRoute(routeId: string, url?: string, checks?: KernelSuccessCheck[]) {
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

async function runRouteWithPolicy(params: {
  routeId: string;
  url?: string;
  checks?: KernelSuccessCheck[];
  pageFingerprint?: ActionPageFingerprint;
  actionIndex?: ActionIndexEntry[];
  routeMemory?: ActionRouteMemory;
}): Promise<{
  ok: boolean;
  executed: number;
  verify?: Awaited<ReturnType<typeof runVerify>>;
  source: "memory" | "manifest" | "live";
  confidence: number;
}> {
  const confidence = computeRouteConfidence({
    pageFingerprint: params.pageFingerprint,
    actionIndex: params.actionIndex,
    routeMemory: params.routeMemory,
  });
  const actionIndex = params.actionIndex ?? [];

  if (
    params.routeMemory &&
    params.routeMemory.routeId === params.routeId &&
    confidence >= MEMORY_ROUTE_CONFIDENCE_THRESHOLD
  ) {
    try {
      const memoryResult = await runRouteMemory({
        routeMemory: params.routeMemory,
        actionIndex,
        url: params.url,
        checks: params.checks,
      });
      clearFailureCluster({
        routeId: params.routeId,
        url: params.url,
        pageFingerprint: params.pageFingerprint,
      });
      return { ...memoryResult, source: "memory", confidence };
    } catch {
      // Fallback to manifest/live execution when memory targets drift.
    }
  }

  try {
    const manifestResult = await runManifestRoute(params.routeId, params.url, params.checks);
    if (manifestResult.ok) {
      clearFailureCluster({
        routeId: params.routeId,
        url: params.url,
        pageFingerprint: params.pageFingerprint,
      });
    } else {
      const streak = markFailureCluster({
        routeId: params.routeId,
        url: params.url,
        pageFingerprint: params.pageFingerprint,
      });
      if (
        streak >= ROUTE_FAILURE_CLUSTER_THRESHOLD &&
        manifestResult.verify &&
        !manifestResult.verify.ok
      ) {
        const urlPattern = deriveUrlPattern(params.url);
        if (urlPattern) {
          try {
            updateLearnedRouteOutcome({
              routeId: params.routeId,
              urlPattern,
              outcome: "failure",
              severity: "clustered",
            });
          } catch {
            // clustered demotion is best-effort
          }
        }
      }
    }
    return { ...manifestResult, source: "manifest", confidence };
  } catch {
    if (params.routeMemory && params.routeMemory.routeId === params.routeId) {
      const liveResult = await runRouteMemory({
        routeMemory: params.routeMemory,
        actionIndex,
        url: params.url,
        checks: params.checks,
      });
      clearFailureCluster({
        routeId: params.routeId,
        url: params.url,
        pageFingerprint: params.pageFingerprint,
      });
      return { ...liveResult, source: "live", confidence };
    }
    if (params.url) {
      await runAct({ kind: "navigate", value: params.url });
      const verify =
        params.checks && params.checks.length > 0 ? await runVerify(params.checks) : undefined;
      return {
        ok: verify ? verify.ok : true,
        executed: 1,
        verify,
        source: "live",
        confidence,
      };
    }
    throw new Error(`unknown routeId: ${params.routeId}`);
  }
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

  const isDesktopMethod =
    method === "desktop.snapshot" ||
    method === "desktop.find" ||
    method === "desktop.click" ||
    method === "desktop.type" ||
    method === "desktop.apps" ||
    method === "desktop.windows";
  const isValidationOnlyMethod = method === "web.memory.validate";
  if (isDesktopMethod) {
    if (!isCentrisDesktopConnected()) {
      return actionError(
        method,
        id,
        "DESKTOP_NOT_CONNECTED",
        "Centris desktop bridge is not connected.",
      );
    }
  } else if (!isValidationOnlyMethod && !isCentrisExtensionConnected()) {
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

    if (method === "desktop.snapshot") {
      const result = await runDesktopSnapshot(params);
      return { specVersion, method, id, ok: true, result };
    }

    if (method === "desktop.find") {
      const result = await runDesktopFind(params);
      return { specVersion, method, id, ok: true, result };
    }

    if (method === "desktop.click") {
      const result = await runDesktopClick(params);
      return { specVersion, method, id, ok: true, result };
    }

    if (method === "desktop.type") {
      const result = await runDesktopType(params);
      return { specVersion, method, id, ok: true, result };
    }

    if (method === "desktop.apps") {
      const result = await runDesktopApps();
      return { specVersion, method, id, ok: true, result };
    }

    if (method === "desktop.windows") {
      const result = await runDesktopWindows(params);
      return { specVersion, method, id, ok: true, result };
    }

    if (method === "route.run") {
      const routeId = asString(params.routeId) ?? "";
      if (!routeId) {
        return actionError(method, id, "INVALID_REQUEST", "routeId is required");
      }
      const checks = (Array.isArray(params.checks) ? params.checks : undefined) as
        | KernelSuccessCheck[]
        | undefined;
      const pageFingerprint = toPageFingerprint(params.pageFingerprint);
      const actionIndex = toActionIndexEntries(params.actionIndex);
      const routeMemory = toRouteMemory(params.routeMemory);
      const result = await runRouteWithPolicy({
        routeId,
        url: asString(params.url),
        checks,
        pageFingerprint,
        actionIndex,
        routeMemory,
      });
      return {
        specVersion,
        method,
        id,
        ok: true,
        result: {
          ok: result.ok,
          executed: result.executed,
          verify: result.verify,
          source: result.source,
          pageFingerprint,
          actionIndex,
          routeMemory,
        },
      };
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

    if (method === "web.memory.index") {
      const url = asString(params.url) ?? "";
      if (!url) {
        return actionError(method, id, "INVALID_REQUEST", "url is required");
      }
      const intent = asString(params.intent);
      const pageFingerprint = toPageFingerprint(params.pageFingerprint);
      const actionIndex = toActionIndexEntries(params.actionIndex);
      const routeMemory = toRouteMemory(params.routeMemory);
      const playbook = asObject(params.playbook);
      const ttlMs = Math.max(1, Math.floor(asNumber(params.ttlMs) ?? WEB_MEMORY_DEFAULT_TTL_MS));
      const createdAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + ttlMs).toISOString();
      const cacheKey = buildWebMemoryCacheKey(url, intent);
      const confidence = computeRouteConfidence({ pageFingerprint, actionIndex, routeMemory });
      const entry: WebMemoryEntry = {
        cacheKey,
        url,
        normalizedUrl: normalizeUrl(url),
        domain: toDomain(url),
        intent,
        ...(playbook ? { playbook } : {}),
        ...(pageFingerprint ? { pageFingerprint } : {}),
        actionIndex,
        ...(routeMemory ? { routeMemory } : {}),
        confidence,
        createdAt,
        expiresAt,
        resolveHits: 0,
      };
      const store = getWebMemoryStore(extractUserId(params));
      await store.set(cacheKey, entry);

      return {
        specVersion,
        method,
        id,
        ok: true,
        result: {
          ok: true,
          cacheKey,
          version: "1",
          createdAt,
          expiresAt,
          ...(pageFingerprint ? { pageFingerprint } : {}),
          actionIndex,
          ...(routeMemory ? { routeMemory } : {}),
        },
      };
    }

    if (method === "web.memory.validate") {
      const payload = asObject(params.payload);
      if (!payload) {
        return actionError(method, id, "INVALID_REQUEST", "payload is required");
      }
      const strict = params.strict === true;
      const validation = validateWebMemoryIndexPayload(
        payload as unknown as Parameters<typeof validateWebMemoryIndexPayload>[0],
        {
          strict,
        },
      );
      return {
        specVersion,
        method,
        id,
        ok: true,
        result: {
          ok: validation.ok,
          errors: validation.errors,
          warnings: validation.warnings,
          normalized: validation.normalized,
          stats: validation.stats,
        },
      };
    }

    if (method === "web.memory.resolve") {
      const startedAt = Date.now();
      const url = asString(params.url) ?? "";
      if (!url) {
        return actionError(method, id, "INVALID_REQUEST", "url is required");
      }
      const maxAgeMs = asNumber(params.maxAgeMs);
      const store = getWebMemoryStore(extractUserId(params));
      await store.cleanupExpired();
      const entry = await store.resolve({
        normalizedUrl: normalizeUrl(url),
        normalizedIntent: (asString(params.intent) ?? "").trim().toLowerCase(),
        maxAgeMs: typeof maxAgeMs === "number" ? Math.max(0, maxAgeMs) : undefined,
      });
      const resolveMs = Date.now() - startedAt;
      webMemoryResolveMsTotal += resolveMs;
      webMemoryResolveCount++;
      if (!entry) {
        webMemoryMisses++;
        return {
          specVersion,
          method,
          id,
          ok: true,
          result: {
            hit: false,
            source: "live",
            confidence: 0,
          },
        };
      }

      webMemoryHits++;
      await store.incrementResolveHits(entry.cacheKey);
      return {
        specVersion,
        method,
        id,
        ok: true,
        result: {
          hit: true,
          cacheKey: entry.cacheKey,
          ...(entry.playbook ? { playbook: entry.playbook } : {}),
          generatedAt: entry.createdAt,
          expiresAt: entry.expiresAt,
          source: "cache",
          confidence: entry.confidence,
          ...(entry.pageFingerprint ? { pageFingerprint: entry.pageFingerprint } : {}),
          actionIndex: entry.actionIndex,
          ...(entry.routeMemory ? { routeMemory: entry.routeMemory } : {}),
        },
      };
    }

    if (method === "web.memory.execute") {
      const startedAt = Date.now();
      const url = asString(params.url) ?? "";
      if (!url) {
        return actionError(method, id, "INVALID_REQUEST", "url is required");
      }
      const intent = asString(params.intent);
      const routeId = asString(params.routeId);
      const operation = deriveActionKind(asString(params.operation));
      const store = getWebMemoryStore(extractUserId(params));
      await store.cleanupExpired();
      const entry = await store.resolve({
        normalizedUrl: normalizeUrl(url),
        normalizedIntent: (intent ?? "").trim().toLowerCase(),
      });
      const requestPageFingerprintId = asString(params.pageFingerprintId);
      const requestParams = asObject(params.params) ?? {};

      const entryPageFingerprint = entry ? toPageFingerprint(entry.pageFingerprint) : undefined;
      const entryActionIndex = entry ? toActionIndexEntries(entry.actionIndex) : [];
      const entryRouteMemory = entry ? toRouteMemory(entry.routeMemory) : undefined;

      if (
        entry &&
        entry.confidence >= MEMORY_ROUTE_CONFIDENCE_THRESHOLD &&
        entryRouteMemory &&
        (!routeId || entryRouteMemory.routeId === routeId)
      ) {
        if (
          !requestPageFingerprintId ||
          entryPageFingerprint?.fingerprintId === requestPageFingerprintId
        ) {
          try {
            const memoryResult = await runRouteMemory({
              routeMemory: entryRouteMemory,
              actionIndex: entryActionIndex,
              url,
            });
            const executeMs = Date.now() - startedAt;
            webMemoryExecuteMsTotal += executeMs;
            webMemoryExecuteCount++;
            return {
              specVersion,
              method,
              id,
              ok: true,
              result: {
                ok: memoryResult.ok,
                source: "cache",
                executed: memoryResult.executed,
                confidence: entry.confidence,
                ...(entryPageFingerprint ? { pageFingerprint: entryPageFingerprint } : {}),
                actionIndex: entryActionIndex,
                ...(entryRouteMemory ? { routeMemory: entryRouteMemory } : {}),
                details: {
                  strategy: "memory",
                },
              },
            };
          } catch {
            await store.delete(entry.cacheKey);
            // Drifted memory should degrade to live execution path.
          }
        }
      }

      let liveExecuted = 0;
      let liveOk = true;
      let executeSource: "cache" | "live" = "live";
      if (routeId) {
        const run = await runRouteWithPolicy({
          routeId,
          url,
          pageFingerprint: entryPageFingerprint,
          actionIndex: entryActionIndex,
          routeMemory: entryRouteMemory,
        });
        liveExecuted = run.executed;
        liveOk = run.ok;
        executeSource = run.source === "memory" ? "cache" : "live";
      } else if (operation) {
        await runAct({
          kind: operation,
          target: asString(requestParams.target),
          value: asString(requestParams.value),
          amount: asNumber(requestParams.amount),
          nodeId: asNumber(requestParams.nodeId),
        });
        liveExecuted = 1;
      } else {
        liveOk = false;
      }

      const executeMs = Date.now() - startedAt;
      webMemoryExecuteMsTotal += executeMs;
      webMemoryExecuteCount++;
      return {
        specVersion,
        method,
        id,
        ok: true,
        result: {
          ok: liveOk,
          source: executeSource,
          executed: liveExecuted,
          confidence: entry?.confidence ?? 0,
          ...(entry?.pageFingerprint ? { pageFingerprint: entry.pageFingerprint } : {}),
          actionIndex: entry?.actionIndex ?? [],
          ...(entry?.routeMemory ? { routeMemory: entry.routeMemory } : {}),
          details: {
            strategy: "live",
          },
        },
      };
    }

    if (method === "web.memory.invalidate") {
      const store = getWebMemoryStore(extractUserId(params));
      await store.cleanupExpired();
      const scope = asString(params.scope) ?? "url";
      const url = asString(params.url);
      const playbookId = asString(params.playbookId);
      const invalidated = await store.deleteByScope({
        scope: scope === "all" ? "all" : playbookId ? "playbook" : (scope as "url" | "domain"),
        url,
        playbookId,
      });

      return {
        specVersion,
        method,
        id,
        ok: true,
        result: {
          ok: true,
          invalidated,
        },
      };
    }

    if (method === "web.memory.stats") {
      const store = getWebMemoryStore(extractUserId(params));
      await store.cleanupExpired();
      const entries = await store.list();
      const indexedPages = new Set(entries.map((entry) => entry.normalizedUrl)).size;
      const indexedActions = entries.reduce((sum, entry) => sum + entry.actionIndex.length, 0);
      const indexedRoutes = entries.reduce((sum, entry) => sum + (entry.routeMemory ? 1 : 0), 0);
      const totalLookups = webMemoryHits + webMemoryMisses;

      return {
        specVersion,
        method,
        id,
        ok: true,
        result: {
          entries: entries.length,
          hits: webMemoryHits,
          misses: webMemoryMisses,
          hitRate: totalLookups > 0 ? webMemoryHits / totalLookups : 0,
          avgResolveMs:
            webMemoryResolveCount > 0 ? webMemoryResolveMsTotal / webMemoryResolveCount : 0,
          indexedPages,
          indexedActions,
          indexedRoutes,
          avgExecuteMs:
            webMemoryExecuteCount > 0 ? webMemoryExecuteMsTotal / webMemoryExecuteCount : 0,
        },
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
