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
import type { CentrisManifest, ManifestAction, ManifestLandmark, ManifestRoute } from "./types.js";

export interface ManifestLoaderOptions {
  workspaceDir?: string;
  extraPaths?: string[];
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
    discoverInDirectory(dir, results, seen, log);
  }

  log.info?.(`[manifest-loader] loaded ${results.length} manifest(s)`);
  return results;
}

function discoverInDirectory(
  dir: string,
  results: LoadedManifest[],
  seen: Set<string>,
  log: ManifestLoaderOptions["logger"],
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
        loadManifestFile(path.join(dir, entry.name), results, seen, log);
      }
      continue;
    }

    const manifestPath = path.join(dir, entry.name, "centris.json");
    loadManifestFile(manifestPath, results, seen, log);
  }
}

function loadManifestFile(
  filePath: string,
  results: LoadedManifest[],
  seen: Set<string>,
  log: ManifestLoaderOptions["logger"],
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

    results.push({ manifest, source: resolved });
    log?.debug?.(`[manifest-loader] loaded: ${manifest.app} from ${resolved}`);
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

        actions[ak] = {
          description: ao.description,
          params: Array.isArray(ao.params)
            ? ao.params.filter((p: unknown) => typeof p === "string")
            : undefined,
          steps: ao.steps as ManifestAction["steps"],
        };
      }
      if (Object.keys(actions).length > 0) {
        route.actions = actions;
      }
    }

    routes[routeKey] = route;
  }

  return {
    centris: obj.centris,
    app: obj.app,
    description: typeof obj.description === "string" ? obj.description : undefined,
    url_patterns: obj.url_patterns as string[],
    routes,
  };
}
