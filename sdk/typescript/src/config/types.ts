/**
 * @centris/sdk - Configuration Types
 *
 * Type definitions for Centris configuration.
 */

// =============================================================================
// Connector Config
// =============================================================================

/**
 * Per-connector configuration entry.
 */
export interface ConnectorConfigEntry {
  /** Enable/disable this connector */
  enabled?: boolean;
  /** Connector-specific configuration */
  config?: Record<string, unknown>;
}

/**
 * Connectors configuration block.
 */
export interface ConnectorsConfig {
  /** Global enable/disable for all connectors */
  enabled?: boolean;
  /** Allowlist - if set, only these connectors are loaded */
  allow?: string[];
  /** Denylist - these connectors are never loaded */
  deny?: string[];
  /** Additional paths to search for connectors */
  load?: {
    paths?: string[];
  };
  /** Per-connector configuration */
  entries?: Record<string, ConnectorConfigEntry>;
}

/**
 * Gateway configuration.
 */
export interface GatewayConfig {
  /** Port to listen on */
  port?: number;
  /** Host to bind to */
  host?: string;
  /** Enable CORS */
  cors?: boolean;
  /** Authentication mode */
  auth?: "none" | "token" | "oauth";
}

/**
 * Logging configuration.
 */
export interface LoggingConfig {
  /** Log level */
  level?: "debug" | "info" | "warn" | "error";
  /** Output format */
  format?: "json" | "pretty";
  /** Log file path */
  file?: string;
}

/**
 * Full Centris configuration.
 */
export interface CentrisConfig {
  /** Connectors configuration */
  connectors?: ConnectorsConfig;
  /** Gateway configuration */
  gateway?: GatewayConfig;
  /** Logging configuration */
  logging?: LoggingConfig;
  /** Workspace directory */
  workspaceDir?: string;
  /** State directory for persistent data */
  stateDir?: string;
  /** Additional custom configuration */
  [key: string]: unknown;
}

// =============================================================================
// Normalized Config (Internal)
// =============================================================================

/**
 * Normalized connectors config for internal use.
 */
export interface NormalizedConnectorsConfig {
  enabled: boolean;
  allow: string[];
  deny: string[];
  loadPaths: string[];
  entries: Record<string, { enabled?: boolean; config?: Record<string, unknown> }>;
}

/**
 * Normalize a list value to string array.
 */
export function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean);
}

/**
 * Normalize connector entries from config.
 */
export function normalizeConnectorEntries(entries: unknown): NormalizedConnectorsConfig["entries"] {
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
    return {};
  }
  const normalized: NormalizedConnectorsConfig["entries"] = {};
  for (const [key, value] of Object.entries(entries)) {
    if (!key.trim()) {
      continue;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      normalized[key] = {};
      continue;
    }
    const entry = value as Record<string, unknown>;
    normalized[key] = {
      enabled: typeof entry.enabled === "boolean" ? entry.enabled : undefined,
      config:
        entry.config && typeof entry.config === "object" && !Array.isArray(entry.config)
          ? (entry.config as Record<string, unknown>)
          : undefined,
    };
  }
  return normalized;
}

/**
 * Normalize the connectors config section.
 */
export function normalizeConnectorsConfig(config?: ConnectorsConfig): NormalizedConnectorsConfig {
  return {
    enabled: config?.enabled !== false,
    allow: normalizeStringList(config?.allow),
    deny: normalizeStringList(config?.deny),
    loadPaths: normalizeStringList(config?.load?.paths),
    entries: normalizeConnectorEntries(config?.entries),
  };
}
