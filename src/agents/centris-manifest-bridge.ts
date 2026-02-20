/**
 * Centris Manifest Bridge
 *
 * Bridges the SDK manifest system into the overlay's agent loop.
 * Loads manifests at startup, builds an index for the system prompt,
 * and resolves URLs to matching manifests for browser tool injection.
 *
 * Uses opaque dynamic imports to keep SDK files out of the root tsconfig's rootDir.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { logDebug, logInfo, logError } from "../logger.js";

// ─── Types mirrored from SDK (avoids static import) ─────────────────────────

interface ManifestIndexEntry {
  app: string;
  description?: string;
  url_patterns: string[];
  actions: string[];
}

interface ManifestLandmark {
  role: string;
  selectors: string[];
  stability?: string;
  description?: string;
}

interface ManifestAction {
  description: string;
  params?: string[];
  steps: Array<Record<string, unknown>>;
  successChecks?: Array<{ type: string; value?: string }>;
  confidence?: number;
  lastVerifiedAt?: string;
  fallbackChains?: string[][];
}

interface ResolvedManifest {
  app: string;
  description?: string;
  url: string;
  route: string;
  landmarks: Record<string, ManifestLandmark>;
  actions: Record<string, ManifestAction>;
}

interface IngestManifest {
  app: string;
  url_patterns: string[];
  routes: Record<
    string,
    {
      landmarks?: Record<
        string,
        { role: string; selectors: string[]; stability?: string; description?: string }
      >;
      actions?: Record<string, ManifestAction>;
    }
  >;
}

// ─── State ───────────────────────────────────────────────────────────────────

let store: {
  size: number;
  buildIndex: () => ManifestIndexEntry[];
  resolve: (url: string) => ResolvedManifest | null;
  add?: (entry: { manifest: unknown; source: string }) => void;
} | null = null;

let formatIndexFn: ((entries: ManifestIndexEntry[]) => string) | null = null;
let formatResolvedJsonFn: ((resolved: ResolvedManifest) => Record<string, unknown>) | null = null;

function sdkBasePath(): string {
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(thisDir, "..", "..", "sdk", "typescript", "src");
}

function parseWellKnownAllowlist(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .filter((entry) => !entry.includes("://") && !entry.includes("/"));
}

function parsePatternHost(pattern: string): string | null {
  const trimmed = pattern.trim();
  if (!trimmed) {
    return null;
  }
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    return url.hostname.replace(/^\*\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function hostFamilyMatch(host: string, candidate: string): boolean {
  return candidate === host || candidate.endsWith(`.${host}`) || host.endsWith(`.${candidate}`);
}

function clampConfidence(value: number): number {
  return Math.max(0.05, Math.min(0.95, value));
}

export function sanitizeRemoteManifestForHost(
  input: IngestManifest,
  host: string,
): IngestManifest | null {
  const normalizedHost = host.trim().toLowerCase();
  const cleanedHost = normalizedHost.replace(/^\*\./, "");
  if (!cleanedHost) {
    return null;
  }

  const hosts = input.url_patterns
    .map(parsePatternHost)
    .filter((entry): entry is string => Boolean(entry));
  if (hosts.length === 0) {
    return null;
  }
  if (!hosts.every((entry) => hostFamilyMatch(cleanedHost, entry))) {
    return null;
  }

  let actionCount = 0;
  let routeCount = 0;
  const sanitizedRoutes: IngestManifest["routes"] = {};
  for (const [routeKey, route] of Object.entries(input.routes ?? {})) {
    routeCount += 1;
    if (routeCount > 120) {
      break;
    }
    const sanitizedRoute: IngestManifest["routes"][string] = {};
    if (route.landmarks) {
      const landmarks: NonNullable<typeof sanitizedRoute.landmarks> = {};
      for (const [landmarkName, landmark] of Object.entries(route.landmarks)) {
        landmarks[landmarkName] = {
          role: landmark.role,
          selectors: landmark.selectors.slice(0, 8),
          stability: landmark.stability,
          description: landmark.description,
        };
      }
      if (Object.keys(landmarks).length > 0) {
        sanitizedRoute.landmarks = landmarks;
      }
    }
    if (route.actions) {
      const actions: NonNullable<typeof sanitizedRoute.actions> = {};
      for (const [actionName, action] of Object.entries(route.actions)) {
        actionCount += 1;
        if (actionCount > 400) {
          break;
        }
        actions[actionName] = {
          ...action,
          confidence:
            typeof action.confidence === "number" ? clampConfidence(action.confidence) : 0.6,
        };
      }
      if (Object.keys(actions).length > 0) {
        sanitizedRoute.actions = actions;
      }
    }
    sanitizedRoutes[routeKey] = sanitizedRoute;
  }

  return {
    ...input,
    url_patterns: input.url_patterns,
    routes: sanitizedRoutes,
  };
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Initialize the manifest store. Call once at gateway/agent startup.
 * Loads all discoverable manifests and builds the URL index.
 */
export async function initManifestStore(options?: {
  workspaceDir?: string;
  extraPaths?: string[];
}): Promise<void> {
  try {
    const base = sdkBasePath();
    const loaderPath = path.join(base, "manifest", "loader.js");
    const resolverPath = path.join(base, "manifest", "resolver.js");
    const formatterPath = path.join(base, "manifest", "formatter.js");

    const [loaderMod, resolverMod, formatterMod] = await Promise.all([
      import(/* @vite-ignore */ loaderPath),
      import(/* @vite-ignore */ resolverPath),
      import(/* @vite-ignore */ formatterPath),
    ]);

    formatIndexFn = formatterMod.formatManifestIndex;
    formatResolvedJsonFn = formatterMod.formatResolvedManifestJson;

    const loaded = loaderMod.loadManifests({
      workspaceDir: options?.workspaceDir,
      extraPaths: options?.extraPaths,
      logger: {
        debug: (msg: string) => logDebug(`[manifests] ${msg}`),
        info: (msg: string) => logInfo(`[manifests] ${msg}`),
        warn: (msg: string) => logDebug(`[manifests] ${msg}`),
        error: (msg: string) => logError(`[manifests] ${msg}`),
      },
    });

    const ManifestStore = resolverMod.ManifestStore;
    store = new ManifestStore(loaded);

    // Optional first-party discovery: fetch .well-known manifests from an explicit allowlist.
    const allowlist = parseWellKnownAllowlist(process.env.CENTRIS_MANIFEST_ALLOWLIST);
    if (store && allowlist.length > 0 && typeof store.add === "function") {
      for (const host of allowlist) {
        const url = `https://${host}/.well-known/centris.json`;
        try {
          const res = await fetchWithTimeout(url, 2500);
          if (!res.ok) {
            logDebug(`[manifest-bridge] skipped ${url} (${res.status})`);
            continue;
          }
          const parsed = (await res.json()) as unknown;
          const validated = loaderMod.validateManifest(parsed);
          if (!validated) {
            logDebug(`[manifest-bridge] invalid remote manifest: ${url}`);
            continue;
          }
          const sanitized = sanitizeRemoteManifestForHost(validated as IngestManifest, host);
          if (!sanitized) {
            logDebug(`[manifest-bridge] rejected remote manifest (policy): ${url}`);
            continue;
          }
          store.add({ manifest: sanitized, source: `well-known:${host}` });
          logInfo(`[manifest-bridge] loaded remote manifest: ${host}`);
        } catch (err) {
          logDebug(`[manifest-bridge] failed loading ${url}: ${String(err)}`);
        }
      }
    }

    if (store && store.size > 0) {
      logInfo(`[manifest-bridge] ${store.size} manifest(s) loaded and indexed`);
    }
  } catch (err) {
    logDebug(`[manifest-bridge] SDK manifest not available: ${String(err)}`);
  }
}

/**
 * Get the formatted manifest index for system prompt injection.
 * Returns empty string if no manifests are loaded.
 */
export function getManifestIndexPrompt(): string {
  if (!store || store.size === 0 || !formatIndexFn) {
    return "";
  }
  return formatIndexFn(store.buildIndex());
}

/**
 * Resolve a URL to a matching manifest.
 * Returns null if no manifest matches the URL.
 */
export function resolveManifestForUrl(url: string): ResolvedManifest | null {
  if (!store) {
    return null;
  }
  return store.resolve(url);
}

/**
 * Format a resolved manifest as JSON for tool result injection.
 */
export function formatManifestForToolResultJson(
  resolved: ResolvedManifest,
): Record<string, unknown> {
  if (!formatResolvedJsonFn) {
    return {};
  }
  return formatResolvedJsonFn(resolved);
}

/**
 * Check if any manifests are loaded.
 */
export function hasManifests(): boolean {
  return store !== null && store.size > 0;
}
