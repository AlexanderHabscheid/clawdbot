import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CentrisManifest, ManifestAction, ManifestRoute } from "../manifest/types.js";
import type { KernelLearnRequest } from "./types.js";
import { validateManifest } from "../manifest/loader.js";

export interface PersistLearnedRouteOptions {
  request: KernelLearnRequest;
  baseDir?: string;
  appId?: string;
  now?: Date;
}

export interface PersistLearnedRouteResult {
  ok: true;
  app: string;
  routePattern: string;
  manifestPath: string;
  routeId: string;
}

export interface UpdateLearnedRouteOutcomeOptions {
  routeId: string;
  urlPattern: string;
  outcome: "success" | "failure";
  severity?: "normal" | "clustered";
  baseDir?: string;
  appId?: string;
  now?: Date;
}

const CONFIDENCE_HALF_LIFE_DAYS = 14;
const PRUNE_STALE_DAYS = 45;
const PRUNE_MIN_CONFIDENCE = 0.15;
const MAX_ACTIONS_PER_ROUTE = 200;
const DEFAULT_EXISTING_CONFIDENCE = 0.5;

export function persistLearnedRoute(
  options: PersistLearnedRouteOptions,
): PersistLearnedRouteResult {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const app = normalizeAppId(options.appId ?? deriveAppId(options.request.urlPattern));
  const hostLabel = deriveHostLabel(options.request.urlPattern);
  const routePattern = deriveRoutePattern(options.request.urlPattern);
  const manifestPath = path.join(options.baseDir ?? defaultConnectorsDir(), app, "centris.json");

  const manifest = loadManifest(manifestPath) ?? {
    centris: "2.0",
    app,
    description: hostLabel
      ? `Auto-learned routes for ${hostLabel}`
      : `Auto-learned routes for ${app}`,
    url_patterns: [],
    routes: {},
  };

  if (!manifest.url_patterns.includes(options.request.urlPattern)) {
    manifest.url_patterns.push(options.request.urlPattern);
  }

  const route: ManifestRoute = manifest.routes[routePattern] ?? {};
  route.actions = route.actions ?? {};
  const existingAction = route.actions[options.request.id];
  const existingConfidence = decayConfidence(
    existingAction?.confidence,
    existingAction?.lastVerifiedAt,
    now,
  );
  const nextConfidence = scoreAfterOutcome(existingConfidence, "success");

  route.actions[options.request.id] = {
    description: `Auto-learned action ${options.request.id}`,
    steps: options.request.steps,
    successChecks: options.request.checks,
    fallbackChains:
      options.request.fallbackChains && options.request.fallbackChains.length > 0
        ? options.request.fallbackChains
        : existingAction?.fallbackChains,
    confidence: toConfidence(nextConfidence),
    lastVerifiedAt: nowIso,
  };

  manifest.routes[routePattern] = route;
  manifest.centris = "2.0";
  pruneAndDecayManifest(manifest, now);

  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");

  return {
    ok: true,
    app,
    routePattern,
    manifestPath,
    routeId: options.request.id,
  };
}

export function updateLearnedRouteOutcome(
  options: UpdateLearnedRouteOutcomeOptions,
): PersistLearnedRouteResult | null {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const app = normalizeAppId(options.appId ?? deriveAppId(options.urlPattern));
  const routePattern = deriveRoutePattern(options.urlPattern);
  const manifestPath = path.join(options.baseDir ?? defaultConnectorsDir(), app, "centris.json");
  const manifest = loadManifest(manifestPath);
  if (!manifest) {
    return null;
  }

  const route = manifest.routes[routePattern];
  const action = route?.actions?.[options.routeId];
  if (!route?.actions || !action) {
    return null;
  }

  const decayed = decayConfidence(action.confidence, action.lastVerifiedAt, now);
  route.actions[options.routeId] = {
    ...action,
    confidence: toConfidence(scoreAfterOutcome(decayed, options.outcome, options.severity)),
    lastVerifiedAt: nowIso,
  };

  pruneAndDecayManifest(manifest, now);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");

  return {
    ok: true,
    app,
    routePattern,
    manifestPath,
    routeId: options.routeId,
  };
}

function defaultConnectorsDir(): string {
  return path.join(os.homedir(), ".centris", "connectors");
}

function loadManifest(manifestPath: string): CentrisManifest | null {
  if (!fs.existsSync(manifestPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(manifestPath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return validateManifest(parsed);
  } catch {
    return null;
  }
}

function deriveHostLabel(urlPattern: string): string {
  const hostMatch = urlPattern.match(/^https?:\/\/([^/]+)/i);
  const hostRaw = hostMatch?.[1]?.trim() ?? "";
  if (!hostRaw) {
    return "";
  }
  return hostRaw.replace(/^\*\./, "").replace(/\*/g, "wildcard").toLowerCase();
}

function deriveAppId(urlPattern: string): string {
  const host = deriveHostLabel(urlPattern);
  if (host) {
    return host;
  }
  return "learned-site";
}

function normalizeAppId(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "learned-site";
}

function deriveRoutePattern(urlPattern: string): string {
  const withoutOrigin = urlPattern.replace(/^https?:\/\/[^/]+/i, "");
  if (!withoutOrigin) {
    return "/";
  }
  const clean = withoutOrigin.split("#", 1)[0]?.split("?", 1)[0] ?? "/";
  if (!clean) {
    return "/";
  }
  return clean.startsWith("/") ? clean : `/${clean}`;
}

function decayConfidence(
  confidence: number | undefined,
  lastVerifiedAt: string | undefined,
  now: Date,
): number {
  const base = Number.isFinite(confidence)
    ? clamp(confidence as number)
    : DEFAULT_EXISTING_CONFIDENCE;
  if (!lastVerifiedAt) {
    return base;
  }
  const verifiedMs = Date.parse(lastVerifiedAt);
  if (!Number.isFinite(verifiedMs)) {
    return base;
  }
  const ageMs = Math.max(0, now.getTime() - verifiedMs);
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const factor = 2 ** (-ageDays / CONFIDENCE_HALF_LIFE_DAYS);
  return clamp(base * factor);
}

function scoreAfterOutcome(
  current: number,
  outcome: "success" | "failure",
  severity: "normal" | "clustered" = "normal",
): number {
  if (outcome === "success") {
    return clamp(current + (1 - current) * 0.35);
  }
  return clamp(current * (severity === "clustered" ? 0.45 : 0.65));
}

function toConfidence(value: number): number {
  return Number(value.toFixed(3));
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function pruneAndDecayManifest(manifest: CentrisManifest, now: Date): void {
  for (const route of Object.values(manifest.routes)) {
    if (!route.actions) {
      continue;
    }

    for (const [actionId, action] of Object.entries(route.actions)) {
      const decayed = decayConfidence(action.confidence, action.lastVerifiedAt, now);
      const staleDays = resolveStaleDays(action.lastVerifiedAt, now);

      if (staleDays >= PRUNE_STALE_DAYS && decayed < PRUNE_MIN_CONFIDENCE) {
        delete route.actions[actionId];
        continue;
      }

      route.actions[actionId] = {
        ...action,
        confidence: toConfidence(decayed),
      };
    }

    const entries = Object.entries(route.actions);
    if (entries.length > MAX_ACTIONS_PER_ROUTE) {
      const sorted = [...entries].toSorted(
        (a: [string, ManifestAction], b: [string, ManifestAction]) =>
          compareActionPriority(a[1], b[1]),
      );
      route.actions = Object.fromEntries(sorted.slice(0, MAX_ACTIONS_PER_ROUTE));
    }
  }
}

function resolveStaleDays(lastVerifiedAt: string | undefined, now: Date): number {
  if (!lastVerifiedAt) {
    return Number.POSITIVE_INFINITY;
  }
  const ts = Date.parse(lastVerifiedAt);
  if (!Number.isFinite(ts)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, (now.getTime() - ts) / (1000 * 60 * 60 * 24));
}

function compareActionPriority(a: ManifestAction, b: ManifestAction): number {
  const confA = Number.isFinite(a.confidence)
    ? (a.confidence as number)
    : DEFAULT_EXISTING_CONFIDENCE;
  const confB = Number.isFinite(b.confidence)
    ? (b.confidence as number)
    : DEFAULT_EXISTING_CONFIDENCE;
  if (confA !== confB) {
    return confB - confA;
  }
  const tsA = Date.parse(a.lastVerifiedAt ?? "");
  const tsB = Date.parse(b.lastVerifiedAt ?? "");
  const safeA = Number.isFinite(tsA) ? tsA : 0;
  const safeB = Number.isFinite(tsB) ? tsB : 0;
  return safeB - safeA;
}
