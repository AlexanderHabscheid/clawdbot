/**
 * @centris/sdk - Connector Discovery
 *
 * Auto-discover connectors from npm packages, workspace, and config paths.
 * Pattern inspired by Clawdbot's discoverClawdbotPlugins.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ConnectorOrigin, ConnectorDiagnostic } from "../plugin/types.js";

// =============================================================================
// Constants
// =============================================================================

const EXTENSION_EXTS = new Set([".ts", ".js", ".mts", ".cts", ".mjs", ".cjs"]);

/** Default config directory */
const CONFIG_DIR = path.join(os.homedir(), ".centris");

/** NPM package prefix for auto-discovery */
const NPM_CONNECTOR_PREFIX = "@centris/connector-";

// =============================================================================
// Types
// =============================================================================

/**
 * A discovered connector candidate.
 */
export interface ConnectorCandidate {
  /** Suggested ID for this connector */
  idHint: string;
  /** Source file path */
  source: string;
  /** Where the connector was discovered */
  origin: ConnectorOrigin;
  /** Workspace directory (if workspace-scoped) */
  workspaceDir?: string;
  /** Package name from package.json */
  packageName?: string;
  /** Package version from package.json */
  packageVersion?: string;
  /** Package description from package.json */
  packageDescription?: string;
}

/**
 * Result from connector discovery.
 */
export interface ConnectorDiscoveryResult {
  candidates: ConnectorCandidate[];
  diagnostics: ConnectorDiagnostic[];
}

/**
 * Package manifest structure.
 */
interface PackageManifest {
  name?: string;
  version?: string;
  description?: string;
  main?: string;
  exports?: unknown;
  keywords?: string[];
  centrisConnector?: {
    id?: string;
    categories?: string[];
    icon?: string;
    connectors?: string[];
  };
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Check if a file is a valid connector extension file.
 */
function isConnectorFile(filePath: string): boolean {
  const ext = path.extname(filePath);
  if (!EXTENSION_EXTS.has(ext)) {
    return false;
  }
  return !filePath.endsWith(".d.ts") && !filePath.endsWith(".test.ts");
}

/**
 * Read and parse package.json from a directory.
 */
function readPackageManifest(dir: string): PackageManifest | null {
  const manifestPath = path.join(dir, "package.json");
  if (!fs.existsSync(manifestPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(manifestPath, "utf-8");
    return JSON.parse(raw) as PackageManifest;
  } catch {
    return null;
  }
}

/**
 * Resolve connector paths from a package manifest.
 */
function resolvePackageConnectors(manifest: PackageManifest): string[] {
  const raw = manifest.centrisConnector?.connectors;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean);
}

/**
 * Derive an ID hint from a file path and package name.
 */
function deriveIdHint(params: {
  filePath: string;
  packageName?: string;
  hasMultipleConnectors: boolean;
}): string {
  const base = path.basename(params.filePath, path.extname(params.filePath));
  const rawPackageName = params.packageName?.trim();
  if (!rawPackageName) {
    return base;
  }

  // Remove scope and connector- prefix
  let unscoped = rawPackageName.includes("/")
    ? (rawPackageName.split("/").pop() ?? rawPackageName)
    : rawPackageName;

  if (unscoped.startsWith("connector-")) {
    unscoped = unscoped.slice("connector-".length);
  }

  if (!params.hasMultipleConnectors) {
    return unscoped;
  }
  return `${unscoped}/${base}`;
}

/**
 * Resolve a path with ~ expansion.
 */
function resolveUserPath(inputPath: string): string {
  if (inputPath.startsWith("~")) {
    return path.join(os.homedir(), inputPath.slice(1));
  }
  return path.resolve(inputPath);
}

// =============================================================================
// Discovery Functions
// =============================================================================

/**
 * Add a candidate to the list if not already seen.
 */
function addCandidate(params: {
  candidates: ConnectorCandidate[];
  seen: Set<string>;
  idHint: string;
  source: string;
  origin: ConnectorOrigin;
  workspaceDir?: string;
  manifest?: PackageManifest | null;
}) {
  const resolved = path.resolve(params.source);
  if (params.seen.has(resolved)) {
    return;
  }
  params.seen.add(resolved);

  const manifest = params.manifest ?? null;
  params.candidates.push({
    idHint: params.idHint,
    source: resolved,
    origin: params.origin,
    workspaceDir: params.workspaceDir,
    packageName: manifest?.name?.trim() || undefined,
    packageVersion: manifest?.version?.trim() || undefined,
    packageDescription: manifest?.description?.trim() || undefined,
  });
}

/**
 * Discover connectors in a directory.
 */
function discoverInDirectory(params: {
  dir: string;
  origin: ConnectorOrigin;
  workspaceDir?: string;
  candidates: ConnectorCandidate[];
  diagnostics: ConnectorDiagnostic[];
  seen: Set<string>;
}) {
  if (!fs.existsSync(params.dir)) {
    return;
  }

  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(params.dir, { withFileTypes: true });
  } catch (err) {
    params.diagnostics.push({
      level: "warn",
      message: `Failed to read connectors dir: ${params.dir} (${String(err)})`,
      source: params.dir,
    });
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(params.dir, entry.name);

    // Direct file
    if (entry.isFile()) {
      if (!isConnectorFile(fullPath)) {
        continue;
      }
      addCandidate({
        candidates: params.candidates,
        seen: params.seen,
        idHint: path.basename(entry.name, path.extname(entry.name)),
        source: fullPath,
        origin: params.origin,
        workspaceDir: params.workspaceDir,
      });
      continue;
    }

    if (!entry.isDirectory()) {
      continue;
    }

    // Check for package.json with centrisConnector field
    const manifest = readPackageManifest(fullPath);
    const connectorPaths = manifest ? resolvePackageConnectors(manifest) : [];

    if (connectorPaths.length > 0) {
      for (const connectorPath of connectorPaths) {
        const resolved = path.resolve(fullPath, connectorPath);
        addCandidate({
          candidates: params.candidates,
          seen: params.seen,
          idHint: deriveIdHint({
            filePath: resolved,
            packageName: manifest?.name,
            hasMultipleConnectors: connectorPaths.length > 1,
          }),
          source: resolved,
          origin: params.origin,
          workspaceDir: params.workspaceDir,
          manifest,
        });
      }
      continue;
    }

    // Check for index file
    const indexCandidates = ["index.ts", "index.js", "index.mjs", "connector.ts", "connector.js"];
    const indexFile = indexCandidates
      .map((candidate) => path.join(fullPath, candidate))
      .find((candidate) => fs.existsSync(candidate));

    if (indexFile && isConnectorFile(indexFile)) {
      addCandidate({
        candidates: params.candidates,
        seen: params.seen,
        idHint: manifest?.centrisConnector?.id || entry.name,
        source: indexFile,
        origin: params.origin,
        workspaceDir: params.workspaceDir,
        manifest,
      });
    }
  }
}

/**
 * Discover connectors from npm packages.
 */
function discoverNpmConnectors(params: {
  candidates: ConnectorCandidate[];
  diagnostics: ConnectorDiagnostic[];
  seen: Set<string>;
  nodeModulesPath?: string;
}) {
  const nodeModulesPath = params.nodeModulesPath ?? path.resolve("node_modules");
  if (!fs.existsSync(nodeModulesPath)) {
    return;
  }

  // Check @centris scope for connector-* packages
  const scopePath = path.join(nodeModulesPath, "@centris");
  if (!fs.existsSync(scopePath)) {
    return;
  }

  let scopedPackages: string[] = [];
  try {
    scopedPackages = fs.readdirSync(scopePath);
  } catch {
    return;
  }

  for (const pkg of scopedPackages) {
    if (!pkg.startsWith("connector-")) {
      continue;
    }

    const pkgPath = path.join(scopePath, pkg);
    const manifest = readPackageManifest(pkgPath);
    if (!manifest) {
      continue;
    }

    // Check for centrisConnector marker or keyword
    const isConnector =
      manifest.centrisConnector || manifest.keywords?.includes("centris-connector");

    if (!isConnector) {
      continue;
    }

    // Resolve main entry point
    const mainFile = manifest.main || "index.js";
    const sourcePath = path.join(pkgPath, mainFile);

    if (fs.existsSync(sourcePath)) {
      addCandidate({
        candidates: params.candidates,
        seen: params.seen,
        idHint: manifest.centrisConnector?.id || pkg.replace("connector-", ""),
        source: sourcePath,
        origin: "npm",
        manifest,
      });
    }
  }
}

/**
 * Discover connectors from a specific path.
 */
function discoverFromPath(params: {
  rawPath: string;
  origin: ConnectorOrigin;
  workspaceDir?: string;
  candidates: ConnectorCandidate[];
  diagnostics: ConnectorDiagnostic[];
  seen: Set<string>;
}) {
  const resolved = resolveUserPath(params.rawPath);
  if (!fs.existsSync(resolved)) {
    params.diagnostics.push({
      level: "warn",
      message: `Connector path not found: ${resolved}`,
      source: resolved,
    });
    return;
  }

  const stat = fs.statSync(resolved);

  // Direct file
  if (stat.isFile()) {
    if (!isConnectorFile(resolved)) {
      params.diagnostics.push({
        level: "warn",
        message: `Connector path is not a supported file: ${resolved}`,
        source: resolved,
      });
      return;
    }
    addCandidate({
      candidates: params.candidates,
      seen: params.seen,
      idHint: path.basename(resolved, path.extname(resolved)),
      source: resolved,
      origin: params.origin,
      workspaceDir: params.workspaceDir,
    });
    return;
  }

  // Directory
  if (stat.isDirectory()) {
    const manifest = readPackageManifest(resolved);
    const connectorPaths = manifest ? resolvePackageConnectors(manifest) : [];

    if (connectorPaths.length > 0) {
      for (const connectorPath of connectorPaths) {
        const source = path.resolve(resolved, connectorPath);
        addCandidate({
          candidates: params.candidates,
          seen: params.seen,
          idHint: deriveIdHint({
            filePath: source,
            packageName: manifest?.name,
            hasMultipleConnectors: connectorPaths.length > 1,
          }),
          source,
          origin: params.origin,
          workspaceDir: params.workspaceDir,
          manifest,
        });
      }
      return;
    }

    // Check for index file
    const indexCandidates = ["index.ts", "index.js", "index.mjs", "connector.ts", "connector.js"];
    const indexFile = indexCandidates
      .map((candidate) => path.join(resolved, candidate))
      .find((candidate) => fs.existsSync(candidate));

    if (indexFile && isConnectorFile(indexFile)) {
      addCandidate({
        candidates: params.candidates,
        seen: params.seen,
        idHint: path.basename(resolved),
        source: indexFile,
        origin: params.origin,
        workspaceDir: params.workspaceDir,
        manifest,
      });
      return;
    }

    // Scan directory for connectors
    discoverInDirectory({
      dir: resolved,
      origin: params.origin,
      workspaceDir: params.workspaceDir,
      candidates: params.candidates,
      diagnostics: params.diagnostics,
      seen: params.seen,
    });
  }
}

// =============================================================================
// Main Discovery Function
// =============================================================================

/**
 * Discover Centris connectors from multiple sources.
 *
 * Discovery order:
 * 1. Global connectors (~/.centris/connectors/)
 * 2. NPM packages (@centris/connector-*)
 * 3. Workspace connectors (.centris/connectors/)
 * 4. Extra paths from config
 */
export function discoverCentrisConnectors(params: {
  workspaceDir?: string;
  extraPaths?: string[];
  npmDiscovery?: boolean;
}): ConnectorDiscoveryResult {
  const candidates: ConnectorCandidate[] = [];
  const diagnostics: ConnectorDiagnostic[] = [];
  const seen = new Set<string>();

  // 1. Global connectors (~/.centris/connectors/ and ~/.openclaw/connectors/)
  const globalDir = path.join(CONFIG_DIR, "connectors");
  discoverInDirectory({
    dir: globalDir,
    origin: "global",
    candidates,
    diagnostics,
    seen,
  });
  // Also check OpenClaw config dir for overlay installations
  const openclawGlobalDir = path.join(os.homedir(), ".openclaw", "connectors");
  if (openclawGlobalDir !== globalDir) {
    discoverInDirectory({
      dir: openclawGlobalDir,
      origin: "global",
      candidates,
      diagnostics,
      seen,
    });
  }

  // 2. NPM packages (enabled by default)
  if (params.npmDiscovery !== false) {
    discoverNpmConnectors({
      candidates,
      diagnostics,
      seen,
    });
  }

  // 3. Workspace connectors
  const workspaceDir = params.workspaceDir?.trim();
  if (workspaceDir) {
    const workspaceRoot = resolveUserPath(workspaceDir);
    const workspaceConnectors = path.join(workspaceRoot, ".centris", "connectors");
    discoverInDirectory({
      dir: workspaceConnectors,
      origin: "workspace",
      workspaceDir: workspaceRoot,
      candidates,
      diagnostics,
      seen,
    });

    // Also check root connectors/ directory
    const rootConnectors = path.join(workspaceRoot, "connectors");
    discoverInDirectory({
      dir: rootConnectors,
      origin: "workspace",
      workspaceDir: workspaceRoot,
      candidates,
      diagnostics,
      seen,
    });
  }

  // 4. Extra paths from config
  const extra = params.extraPaths ?? [];
  for (const extraPath of extra) {
    if (typeof extraPath !== "string") {
      continue;
    }
    const trimmed = extraPath.trim();
    if (!trimmed) {
      continue;
    }
    discoverFromPath({
      rawPath: trimmed,
      origin: "config",
      workspaceDir: workspaceDir?.trim() || undefined,
      candidates,
      diagnostics,
      seen,
    });
  }

  return { candidates, diagnostics };
}

// =============================================================================
// Exports
// =============================================================================

export { CONFIG_DIR, NPM_CONNECTOR_PREFIX, resolveUserPath };
