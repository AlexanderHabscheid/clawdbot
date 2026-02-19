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
}

interface ResolvedManifest {
  app: string;
  description?: string;
  url: string;
  route: string;
  landmarks: Record<string, ManifestLandmark>;
  actions: Record<string, ManifestAction>;
}

// ─── State ───────────────────────────────────────────────────────────────────

let store: {
  size: number;
  buildIndex: () => ManifestIndexEntry[];
  resolve: (url: string) => ResolvedManifest | null;
} | null = null;

let formatIndexFn: ((entries: ManifestIndexEntry[]) => string) | null = null;
let formatResolvedJsonFn: ((resolved: ResolvedManifest) => Record<string, unknown>) | null = null;

function sdkBasePath(): string {
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(thisDir, "..", "..", "sdk", "typescript", "src");
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
