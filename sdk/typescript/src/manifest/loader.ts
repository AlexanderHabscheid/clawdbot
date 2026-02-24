/**
 * Centris Manifest Loader
 *
 * Discovers and loads centris.json manifest files from:
 * 1. connectors/{app}/centris.json (workspace)
 * 2. ~/.centris/connectors/{app}/centris.json (global)
 * 3. ~/.openclaw/connectors/{app}/centris.json (overlay compat)
 * 4. Additional paths passed via options
 *
 * Validates basic structure but is lenient  - partial manifests still
 * provide value (e.g. landmarks without actions).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  CentrisManifest,
  ManifestAction,
  ManifestLandmark,
  ManifestRoute,
  ManifestSuccessCheck,
} from "./types.js";
import {
  detectManifestSourceKind,
  evaluateManifestTrust,
  sourcePriority,
  validateManifestPolicy,
  type ManifestSourceKind,
  type ManifestTrustPolicy,
  type ManifestValidationOptions,
} from "./policy.js";

export interface ManifestLoaderOptions {
  workspaceDir?: string;
  extraPaths?: string[];
  trustPolicy?: ManifestTrustPolicy;
  validation?: ManifestValidationOptions;
  allowUntrusted?: boolean;
  preferredSourceKinds?: ManifestSourceKind[];
  pinnedVersions?: Record<string, string>;
  logger?: {
    debug?: (msg: string) => void;
    info?: (msg: string) => void;
    warn?: (msg: string) => void;
    error?: (msg: string) => void;
  };
}

export interface LoadedManifest {
  manifest: CentrisManifest;
  source: string;
  sourceKind: ManifestSourceKind;
  trusted: boolean;
  trustReason?: string;
  diagnostics: string[];
}

/**
 * Load all discoverable centris.json manifests.
 * Returns validated manifests with their source paths.
 */
export function loadManifests(options?: ManifestLoaderOptions): LoadedManifest[] {
  const log = options?.logger ?? {};
  const results: LoadedManifest[] = [];
  const seen = new Set<string>();

  const searchDirs: string[] = [];

  // Workspace connectors
  if (options?.workspaceDir) {
    searchDirs.push(path.join(options.workspaceDir, "connectors"));
  }

  // Global Centris connectors
  searchDirs.push(path.join(os.homedir(), ".centris", "connectors"));

  // Global OpenClaw connectors (overlay compat)
  searchDirs.push(path.join(os.homedir(), ".openclaw", "connectors"));

  // Extra paths
  if (options?.extraPaths) {
    searchDirs.push(...options.extraPaths);
  }

  for (const dir of searchDirs) {
    discoverInDirectory(dir, results, seen, log, options);
  }

  const sorted = applyPrecedenceAndPins(results, options);
  log.info?.(`[manifest-loader] loaded ${sorted.length} manifest(s)`);
  return sorted;
}

function discoverInDirectory(
  dir: string,
  results: LoadedManifest[],
  seen: Set<string>,
  log: ManifestLoaderOptions["logger"],
  options?: ManifestLoaderOptions,
): void {
  if (!fs.existsSync(dir)) {
    return;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      // Check if this is a centris.json directly in the dir
      if (entry.name === "centris.json") {
        loadManifestFile(path.join(dir, entry.name), results, seen, log, options);
      }
      continue;
    }

    const manifestPath = path.join(dir, entry.name, "centris.json");
    loadManifestFile(manifestPath, results, seen, log, options);
  }
}

function loadManifestFile(
  filePath: string,
  results: LoadedManifest[],
  seen: Set<string>,
  log: ManifestLoaderOptions["logger"],
  options?: ManifestLoaderOptions,
): void {
  const resolved = path.resolve(filePath);
  if (seen.has(resolved)) {
    return;
  }
  seen.add(resolved);

  if (!fs.existsSync(resolved)) {
    return;
  }

  try {
    const raw = fs.readFileSync(resolved, "utf-8");
    const parsed = JSON.parse(raw) as unknown;

    const manifest = validateManifest(parsed);
    if (!manifest) {
      log?.warn?.(`[manifest-loader] invalid manifest: ${resolved}`);
      return;
    }

    const sourceKind = detectManifestSourceKind({
      path: resolved,
      workspaceDir: options?.workspaceDir ? path.resolve(options.workspaceDir) : undefined,
    });
    const trust = evaluateManifestTrust({
      manifest,
      sourceKind,
      policy: options?.trustPolicy,
    });
    const policy = validateManifestPolicy(manifest, options?.validation);
    const diagnostics = policy.issues.map((issue) => `${issue.level}: ${issue.message}`);

    if (!policy.ok) {
      log?.warn?.(`[manifest-loader] policy validation failed: ${resolved}`);
      return;
    }
    if (!trust.trusted && options?.allowUntrusted !== true) {
      log?.warn?.(`[manifest-loader] rejected untrusted manifest ${resolved}: ${trust.reason}`);
      return;
    }

    results.push({
      manifest: policy.normalized,
      source: resolved,
      sourceKind,
      trusted: trust.trusted,
      trustReason: trust.reason,
      diagnostics,
    });
    log?.debug?.(
      `[manifest-loader] loaded: ${manifest.app} from ${resolved} [${sourceKind}] trusted=${String(trust.trusted)}`,
    );
  } catch (err) {
    log?.warn?.(`[manifest-loader] failed to load ${resolved}: ${String(err)}`);
  }
}

/**
 * Validate a parsed JSON object as a CentrisManifest.
 * Lenient: allows partial manifests (landmarks without actions, etc.)
 */
export function validateManifest(data: unknown): CentrisManifest | null {
  if (!data || typeof data !== "object") {
    return null;
  }
  const obj = data as Record<string, unknown>;

  if (typeof obj.centris !== "string") {
    return null;
  }
  if (typeof obj.app !== "string") {
    return null;
  }
  if (!Array.isArray(obj.url_patterns) || obj.url_patterns.length === 0) {
    return null;
  }
  if (!obj.routes || typeof obj.routes !== "object") {
    return null;
  }

  // Validate url_patterns are strings
  for (const p of obj.url_patterns) {
    if (typeof p !== "string") {
      return null;
    }
  }

  // Validate routes
  const routes: Record<string, ManifestRoute> = {};
  for (const [routeKey, routeVal] of Object.entries(obj.routes as Record<string, unknown>)) {
    if (!routeVal || typeof routeVal !== "object") {
      continue;
    }
    const rv = routeVal as Record<string, unknown>;

    const route: ManifestRoute = {};

    // Validate landmarks
    if (rv.landmarks && typeof rv.landmarks === "object") {
      const landmarks: Record<string, ManifestLandmark> = {};
      for (const [lk, lv] of Object.entries(rv.landmarks as Record<string, unknown>)) {
        if (!lv || typeof lv !== "object") {
          continue;
        }
        const lo = lv as Record<string, unknown>;
        if (typeof lo.role !== "string") {
          continue;
        }
        if (!Array.isArray(lo.selectors) || lo.selectors.length === 0) {
          continue;
        }

        landmarks[lk] = {
          role: lo.role,
          selectors: lo.selectors.filter((s: unknown) => typeof s === "string"),
          stability:
            typeof lo.stability === "string"
              ? (lo.stability as ManifestLandmark["stability"])
              : undefined,
          description: typeof lo.description === "string" ? lo.description : undefined,
        };
      }
      if (Object.keys(landmarks).length > 0) {
        route.landmarks = landmarks;
      }
    }

    // Validate actions
    if (rv.actions && typeof rv.actions === "object") {
      const actions: Record<string, ManifestAction> = {};
      for (const [ak, av] of Object.entries(rv.actions as Record<string, unknown>)) {
        if (!av || typeof av !== "object") {
          continue;
        }
        const ao = av as Record<string, unknown>;
        if (typeof ao.description !== "string") {
          continue;
        }
        if (!Array.isArray(ao.steps) || ao.steps.length === 0) {
          continue;
        }

        const successChecks = normalizeSuccessChecks(ao.successChecks ?? ao.verify);
        const confidence =
          typeof ao.confidence === "number" && Number.isFinite(ao.confidence)
            ? Math.max(0, Math.min(1, ao.confidence))
            : undefined;
        const lastVerifiedAt =
          typeof ao.lastVerifiedAt === "string" ? ao.lastVerifiedAt : undefined;
        const fallbackChains = normalizeFallbackChains(ao.fallbackChains);

        actions[ak] = {
          description: ao.description,
          params: Array.isArray(ao.params)
            ? ao.params.filter((p: unknown) => typeof p === "string")
            : undefined,
          steps: ao.steps as ManifestAction["steps"],
          successChecks,
          safetyLevel:
            ao.safetyLevel === "read" ||
            ao.safetyLevel === "write" ||
            ao.safetyLevel === "destructive"
              ? ao.safetyLevel
              : undefined,
          confidence,
          lastVerifiedAt,
          fallbackChains,
        };
      }
      if (Object.keys(actions).length > 0) {
        route.actions = actions;
      }
    }

    routes[routeKey] = route;
  }

  return {
    centris: normalizeManifestVersion(obj.centris),
    app: obj.app,
    description: typeof obj.description === "string" ? obj.description : undefined,
    version: typeof obj.version === "string" ? obj.version : undefined,
    trust:
      obj.trust && typeof obj.trust === "object"
        ? {
            publisher:
              typeof (obj.trust as Record<string, unknown>).publisher === "string"
                ? ((obj.trust as Record<string, unknown>).publisher as string)
                : undefined,
            keyId:
              typeof (obj.trust as Record<string, unknown>).keyId === "string"
                ? ((obj.trust as Record<string, unknown>).keyId as string)
                : undefined,
            signature:
              typeof (obj.trust as Record<string, unknown>).signature === "string"
                ? ((obj.trust as Record<string, unknown>).signature as string)
                : undefined,
            signatureAlgorithm:
              (obj.trust as Record<string, unknown>).signatureAlgorithm === "sha256" ||
              (obj.trust as Record<string, unknown>).signatureAlgorithm === "ed25519"
                ? ((obj.trust as Record<string, unknown>).signatureAlgorithm as
                    | "sha256"
                    | "ed25519")
                : undefined,
            signedAt:
              typeof (obj.trust as Record<string, unknown>).signedAt === "string"
                ? ((obj.trust as Record<string, unknown>).signedAt as string)
                : undefined,
          }
        : undefined,
    url_patterns: obj.url_patterns as string[],
    routes,
  };
}

function applyPrecedenceAndPins(
  loaded: LoadedManifest[],
  options?: ManifestLoaderOptions,
): LoadedManifest[] {
  const preferredKinds = options?.preferredSourceKinds;
  const preferredWeight = new Map<ManifestSourceKind, number>();
  if (preferredKinds && preferredKinds.length > 0) {
    preferredKinds.forEach((kind, index) => {
      preferredWeight.set(kind, preferredKinds.length - index + 1000);
    });
  }

  const pinnedVersions = options?.pinnedVersions ?? {};
  const dedupedByApp = new Map<string, LoadedManifest[]>();
  for (const item of loaded) {
    const list = dedupedByApp.get(item.manifest.app) ?? [];
    list.push(item);
    dedupedByApp.set(item.manifest.app, list);
  }

  const selected: LoadedManifest[] = [];
  for (const entries of dedupedByApp.values()) {
    const pinned = pinnedVersions[entries[0]?.manifest.app ?? ""];
    const pinnedCandidates = pinned
      ? entries.filter((entry) => entry.manifest.version === pinned)
      : entries;
    const pool = pinnedCandidates.length > 0 ? pinnedCandidates : entries;
    pool.sort((a, b) => {
      const pwA = preferredWeight.get(a.sourceKind) ?? 0;
      const pwB = preferredWeight.get(b.sourceKind) ?? 0;
      if (pwA !== pwB) {
        return pwB - pwA;
      }
      const src = sourcePriority(b.sourceKind) - sourcePriority(a.sourceKind);
      if (src !== 0) {
        return src;
      }
      const trusted = Number(b.trusted) - Number(a.trusted);
      if (trusted !== 0) {
        return trusted;
      }
      return b.source.localeCompare(a.source);
    });
    selected.push(pool[0]!);
  }

  selected.sort((a, b) => a.manifest.app.localeCompare(b.manifest.app));
  return selected;
}

function normalizeManifestVersion(input: string): string {
  if (input === "1.0" || input === "2.0") {
    return input;
  }
  return "2.0";
}

function normalizeSuccessChecks(input: unknown): ManifestSuccessCheck[] | undefined {
  if (!Array.isArray(input)) {
    return undefined;
  }
  const checks: ManifestSuccessCheck[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const rec = item as Record<string, unknown>;
    const type = typeof rec.type === "string" ? rec.type : "";
    const value = typeof rec.value === "string" ? rec.value : undefined;
    if (
      (type === "url_contains" ||
        type === "text_present" ||
        type === "element_visible" ||
        type === "network_url_contains") &&
      value
    ) {
      checks.push({ type, value });
      continue;
    }
    if (type === "download") {
      checks.push(value ? { type, value } : { type });
    }
  }
  return checks.length > 0 ? checks : undefined;
}

function normalizeFallbackChains(input: unknown): string[][] | undefined {
  if (!Array.isArray(input)) {
    return undefined;
  }
  const chains: string[][] = [];
  for (const chain of input) {
    if (!Array.isArray(chain)) {
      continue;
    }
    const normalized = chain.filter((entry): entry is string => typeof entry === "string");
    if (normalized.length > 0) {
      chains.push(normalized);
    }
  }
  return chains.length > 0 ? chains : undefined;
}
