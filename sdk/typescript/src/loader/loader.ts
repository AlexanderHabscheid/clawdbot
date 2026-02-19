/**
 * @centris/sdk - Connector Loader
 *
 * Loads connectors from discovery sources into a registry.
 * Pattern inspired by Clawdbot's loadClawdbotPlugins.
 */

import { createJiti } from "jiti";
import type { CentrisConfig, NormalizedConnectorsConfig } from "../config/types.js";
import type {
  ConnectorLogger,
  CentrisConnectorDefinition,
  CentrisConnectorModule,
  ConnectorConfigSchema,
  ConnectorConfigUiHint,
  GatewayRequestHandler,
} from "../plugin/types.js";
import { normalizeConnectorsConfig } from "../config/types.js";
import { validateConnectorConfig } from "../validation/config.js";
import { discoverCentrisConnectors, type ConnectorCandidate } from "./discovery.js";
import {
  createConnectorRegistry,
  type ConnectorRecord,
  type ConnectorRegistry,
} from "./registry.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Options for loading connectors.
 */
export interface ConnectorLoadOptions {
  /** Centris configuration */
  config?: CentrisConfig;
  /** Workspace directory */
  workspaceDir?: string;
  /** Additional paths to search */
  extraPaths?: string[];
  /** Logger instance */
  logger?: ConnectorLogger;
  /** Core gateway handlers (to prevent conflicts) */
  coreGatewayHandlers?: Record<string, GatewayRequestHandler>;
  /** Enable caching (default: true) */
  cache?: boolean;
  /** Enable NPM discovery (default: true) */
  npmDiscovery?: boolean;
}

/**
 * Result from loading connectors.
 */
export type ConnectorLoadResult = ConnectorRegistry;

// =============================================================================
// Registry Cache
// =============================================================================

const registryCache = new Map<string, ConnectorRegistry>();

/**
 * Build a cache key from options.
 */
function buildCacheKey(params: {
  workspaceDir?: string;
  connectors: NormalizedConnectorsConfig;
}): string {
  const workspaceKey = params.workspaceDir || "";
  return `${workspaceKey}::${JSON.stringify(params.connectors)}`;
}

/**
 * Invalidate the registry cache.
 */
export function invalidateConnectorCache(cacheKey?: string): void {
  if (cacheKey) {
    registryCache.delete(cacheKey);
  } else {
    registryCache.clear();
  }
}

// =============================================================================
// Default Logger
// =============================================================================

function createDefaultLogger(): ConnectorLogger {
  return {
    debug: (msg) => console.debug(`[centris:connectors] ${msg}`),
    info: (msg) => console.info(`[centris:connectors] ${msg}`),
    warn: (msg) => console.warn(`[centris:connectors] ${msg}`),
    error: (msg) => console.error(`[centris:connectors] ${msg}`),
  };
}

// =============================================================================
// Enable State Resolution
// =============================================================================

/**
 * Resolve whether a connector should be enabled.
 */
function resolveEnableState(
  id: string,
  config: NormalizedConnectorsConfig,
): { enabled: boolean; reason?: string } {
  if (!config.enabled) {
    return { enabled: false, reason: "Connectors disabled globally" };
  }
  if (config.deny.includes(id)) {
    return { enabled: false, reason: "Blocked by denylist" };
  }
  if (config.allow.length > 0 && !config.allow.includes(id)) {
    return { enabled: false, reason: "Not in allowlist" };
  }
  const entry = config.entries[id];
  if (entry?.enabled === false) {
    return { enabled: false, reason: "Disabled in config" };
  }
  return { enabled: true };
}

// =============================================================================
// Module Export Resolution
// =============================================================================

/**
 * Resolve connector module export to definition and register function.
 */
function resolveConnectorModuleExport(moduleExport: unknown): {
  definition?: CentrisConnectorDefinition;
  register?: CentrisConnectorDefinition["register"];
} {
  // Handle default export
  const resolved =
    moduleExport &&
    typeof moduleExport === "object" &&
    "default" in (moduleExport as Record<string, unknown>)
      ? (moduleExport as { default: unknown }).default
      : moduleExport;

  // Function export
  if (typeof resolved === "function") {
    return {
      register: resolved as CentrisConnectorDefinition["register"],
    };
  }

  // Object export
  if (resolved && typeof resolved === "object") {
    const def = resolved as CentrisConnectorDefinition;
    const register = def.register ?? def.activate;
    return { definition: def, register };
  }

  return {};
}

/**
 * Extract UI hints from config schema.
 */
function extractConfigUiHints(
  schema?: ConnectorConfigSchema,
): Record<string, ConnectorConfigUiHint> | undefined {
  if (!schema) {
    return undefined;
  }
  if (schema.uiHints && typeof schema.uiHints === "object" && !Array.isArray(schema.uiHints)) {
    return schema.uiHints;
  }
  return undefined;
}

// =============================================================================
// Record Creation
// =============================================================================

/**
 * Create a connector record from a candidate.
 */
function createConnectorRecord(params: {
  candidate: ConnectorCandidate;
  enabled: boolean;
}): ConnectorRecord {
  return {
    id: params.candidate.idHint,
    name: params.candidate.packageName ?? params.candidate.idHint,
    description: params.candidate.packageDescription,
    version: params.candidate.packageVersion,
    source: params.candidate.source,
    origin: params.candidate.origin,
    workspaceDir: params.candidate.workspaceDir,
    enabled: params.enabled,
    status: params.enabled ? "loading" : "disabled",
    toolNames: [],
    gatewayMethods: [],
    cliCommands: [],
    services: [],
    configSchema: false,
    configUiHints: undefined,
  };
}

// =============================================================================
// Main Loader Function
// =============================================================================

/**
 * Load all Centris connectors from discovery sources.
 */
export function loadCentrisConnectors(options: ConnectorLoadOptions = {}): ConnectorRegistry {
  const cfg = options.config ?? {};
  const logger = options.logger ?? createDefaultLogger();
  const normalized = normalizeConnectorsConfig(cfg.connectors);
  const cacheEnabled = options.cache !== false;

  // Build cache key
  const cacheKey = buildCacheKey({
    workspaceDir: options.workspaceDir,
    connectors: normalized,
  });

  // Check cache
  if (cacheEnabled) {
    const cached = registryCache.get(cacheKey);
    if (cached) {
      logger.debug?.("Using cached connector registry");
      return cached;
    }
  }

  // Create registry
  const { registry, createApi } = createConnectorRegistry({
    logger,
    coreGatewayHandlers: options.coreGatewayHandlers,
  });

  // Discover connectors
  const discovery = discoverCentrisConnectors({
    workspaceDir: options.workspaceDir,
    extraPaths: [...normalized.loadPaths, ...(options.extraPaths ?? [])],
    npmDiscovery: options.npmDiscovery,
  });
  registry.diagnostics.push(...discovery.diagnostics);

  // Create jiti for dynamic loading (handles TS/ESM/CJS)
  const jiti = createJiti(import.meta.url, {
    interopDefault: true,
  });

  // Load each candidate
  for (const candidate of discovery.candidates) {
    const enableState = resolveEnableState(candidate.idHint, normalized);
    const entry = normalized.entries[candidate.idHint];
    const record = createConnectorRecord({
      candidate,
      enabled: enableState.enabled,
    });

    // Skip disabled connectors
    if (!enableState.enabled) {
      record.status = "disabled";
      record.error = enableState.reason;
      registry.connectors.push(record);
      continue;
    }

    // Load the module
    let mod: CentrisConnectorModule | null = null;
    try {
      mod = jiti(candidate.source) as CentrisConnectorModule;
    } catch (err) {
      record.status = "error";
      record.error = String(err);
      registry.connectors.push(record);
      registry.diagnostics.push({
        level: "error",
        connectorId: record.id,
        source: record.source,
        message: `Failed to load connector: ${String(err)}`,
      });
      continue;
    }

    // Resolve module export
    const resolved = resolveConnectorModuleExport(mod);
    const definition = resolved.definition;
    const register = resolved.register;

    // Warn on ID mismatch
    if (definition?.id && definition.id !== record.id) {
      registry.diagnostics.push({
        level: "warn",
        connectorId: record.id,
        source: record.source,
        message: `Connector ID mismatch (config uses "${record.id}", export uses "${definition.id}")`,
      });
    }

    // Update record from definition
    record.name = definition?.name ?? record.name;
    record.description = definition?.description ?? record.description;
    record.version = definition?.version ?? record.version;
    record.configSchema = Boolean(definition?.configSchema);
    record.configUiHints = extractConfigUiHints(definition?.configSchema);

    // Validate config
    const validatedConfig = validateConnectorConfig({
      schema: definition?.configSchema,
      value: entry?.config,
    });

    if (!validatedConfig.ok) {
      record.status = "error";
      record.error = `Invalid config: ${validatedConfig.errors?.join(", ")}`;
      registry.connectors.push(record);
      registry.diagnostics.push({
        level: "error",
        connectorId: record.id,
        source: record.source,
        message: record.error,
      });
      continue;
    }

    // Check for register function
    if (typeof register !== "function") {
      record.status = "error";
      record.error = "Connector export missing register/activate function";
      registry.connectors.push(record);
      registry.diagnostics.push({
        level: "error",
        connectorId: record.id,
        source: record.source,
        message: record.error,
      });
      continue;
    }

    // Create API and call register
    const api = createApi(record, {
      config: cfg,
      connectorConfig: validatedConfig.value,
    });

    try {
      const result = register(api);
      if (result && typeof result.then === "function") {
        registry.diagnostics.push({
          level: "warn",
          connectorId: record.id,
          source: record.source,
          message: "Connector register() returned a promise; async registration not yet supported",
        });
      }
      record.status = "loaded";
      registry.connectors.push(record);
    } catch (err) {
      record.status = "error";
      record.error = String(err);
      registry.connectors.push(record);
      registry.diagnostics.push({
        level: "error",
        connectorId: record.id,
        source: record.source,
        message: `Connector failed during register: ${String(err)}`,
      });
    }
  }

  // Log summary
  const loaded = registry.connectors.filter((c) => c.status === "loaded").length;
  const total = registry.connectors.length;
  logger.info(`Loaded ${loaded}/${total} connectors`);

  // Cache the registry
  if (cacheEnabled) {
    registryCache.set(cacheKey, registry);
  }

  return registry;
}
