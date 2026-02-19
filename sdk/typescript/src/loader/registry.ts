/**
 * @centris/sdk - Connector Registry
 *
 * Manages registered connectors, tools, gateway methods, and services.
 * Pattern inspired by Clawdbot's createPluginRegistry.
 */

import type { CentrisConfig } from "../config/types.js";
import type {
  ConnectorLogger,
  ConnectorToolFactory,
  CentrisTool,
  GatewayRequestHandler,
  ConnectorCliRegistrar,
  ConnectorService,
  ConnectorOrigin,
  ConnectorDiagnostic,
  ConnectorConfigUiHint,
  ConnectorToolContext,
} from "../plugin/types.js";
import { createConnectorApi } from "../plugin/api.js";

// =============================================================================
// Registry Types
// =============================================================================

/**
 * Tool registration entry.
 */
export interface ConnectorToolRegistration {
  connectorId: string;
  factory: ConnectorToolFactory;
  names: string[];
  source: string;
}

/**
 * CLI registration entry.
 */
export interface ConnectorCliRegistration {
  connectorId: string;
  register: ConnectorCliRegistrar;
  commands: string[];
  source: string;
}

/**
 * Service registration entry.
 */
export interface ConnectorServiceRegistration {
  connectorId: string;
  service: ConnectorService;
  source: string;
}

/**
 * Gateway method registration entry.
 */
export interface ConnectorGatewayRegistration {
  connectorId: string;
  method: string;
  handler: GatewayRequestHandler;
  source: string;
}

/**
 * Record for a loaded connector.
 */
export interface ConnectorRecord {
  /** Connector ID */
  id: string;
  /** Display name */
  name: string;
  /** Version string */
  version?: string;
  /** Description */
  description?: string;
  /** Source file path */
  source: string;
  /** Where the connector was discovered */
  origin: ConnectorOrigin;
  /** Workspace directory (if workspace-scoped) */
  workspaceDir?: string;
  /** Whether the connector is enabled */
  enabled: boolean;
  /** Loading status */
  status: "loading" | "loaded" | "disabled" | "error";
  /** Error message if status is 'error' */
  error?: string;
  /** Registered tool names */
  toolNames: string[];
  /** Registered gateway methods */
  gatewayMethods: string[];
  /** Registered CLI commands */
  cliCommands: string[];
  /** Registered service IDs */
  services: string[];
  /** Whether the connector has a config schema */
  configSchema: boolean;
  /** UI hints for config fields */
  configUiHints?: Record<string, ConnectorConfigUiHint>;
}

/**
 * The connector registry.
 */
export interface ConnectorRegistry {
  /** All connector records */
  connectors: ConnectorRecord[];
  /** Tool registrations */
  tools: ConnectorToolRegistration[];
  /** Gateway method handlers */
  gatewayHandlers: Record<string, GatewayRequestHandler>;
  /** Gateway method registrations (with metadata) */
  gatewayRegistrations: ConnectorGatewayRegistration[];
  /** CLI registrations */
  cliRegistrars: ConnectorCliRegistration[];
  /** Service registrations */
  services: ConnectorServiceRegistration[];
  /** Diagnostic messages */
  diagnostics: ConnectorDiagnostic[];
}

// =============================================================================
// Registry Factory
// =============================================================================

/**
 * Parameters for creating a registry.
 */
export interface CreateConnectorRegistryParams {
  logger: ConnectorLogger;
  coreGatewayHandlers?: Record<string, GatewayRequestHandler>;
}

/**
 * Result from creating a registry.
 */
export interface CreateConnectorRegistryResult {
  /** The registry instance */
  registry: ConnectorRegistry;
  /** Factory to create connector APIs */
  createApi: (
    record: ConnectorRecord,
    params: { config: CentrisConfig; connectorConfig?: Record<string, unknown> },
  ) => ReturnType<typeof createConnectorApi>;
  /** Push a diagnostic message */
  pushDiagnostic: (diag: ConnectorDiagnostic) => void;
}

/**
 * Create a connector registry and its associated API factory.
 */
export function createConnectorRegistry(
  params: CreateConnectorRegistryParams,
): CreateConnectorRegistryResult {
  const registry: ConnectorRegistry = {
    connectors: [],
    tools: [],
    gatewayHandlers: {},
    gatewayRegistrations: [],
    cliRegistrars: [],
    services: [],
    diagnostics: [],
  };

  const coreGatewayMethods = new Set(Object.keys(params.coreGatewayHandlers ?? {}));

  // Copy core handlers to registry
  if (params.coreGatewayHandlers) {
    for (const [method, handler] of Object.entries(params.coreGatewayHandlers)) {
      registry.gatewayHandlers[method] = handler;
    }
  }

  const pushDiagnostic = (diag: ConnectorDiagnostic) => {
    registry.diagnostics.push(diag);
  };

  const registerTool = (
    record: ConnectorRecord,
    tool: CentrisTool | ConnectorToolFactory,
    opts?: { name?: string; names?: string[] },
  ) => {
    const names = opts?.names ?? (opts?.name ? [opts.name] : []);
    const factory: ConnectorToolFactory =
      typeof tool === "function" ? tool : (_ctx: ConnectorToolContext) => tool;

    if (typeof tool !== "function") {
      names.push(tool.name);
    }

    const normalized = names.map((name) => name.trim()).filter(Boolean);
    if (normalized.length > 0) {
      record.toolNames.push(...normalized);
    }

    registry.tools.push({
      connectorId: record.id,
      factory,
      names: normalized,
      source: record.source,
    });
  };

  const registerGatewayMethod = (
    record: ConnectorRecord,
    method: string,
    handler: GatewayRequestHandler,
  ) => {
    const trimmed = method.trim();
    if (!trimmed) {
      return;
    }

    if (coreGatewayMethods.has(trimmed) || registry.gatewayHandlers[trimmed]) {
      pushDiagnostic({
        level: "error",
        connectorId: record.id,
        source: record.source,
        message: `Gateway method already registered: ${trimmed}`,
      });
      return;
    }

    registry.gatewayHandlers[trimmed] = handler;
    registry.gatewayRegistrations.push({
      connectorId: record.id,
      method: trimmed,
      handler,
      source: record.source,
    });
    record.gatewayMethods.push(trimmed);
  };

  const registerCli = (
    record: ConnectorRecord,
    registrar: ConnectorCliRegistrar,
    opts?: { commands?: string[] },
  ) => {
    const commands = (opts?.commands ?? []).map((cmd) => cmd.trim()).filter(Boolean);
    record.cliCommands.push(...commands);
    registry.cliRegistrars.push({
      connectorId: record.id,
      register: registrar,
      commands,
      source: record.source,
    });
  };

  const registerService = (record: ConnectorRecord, service: ConnectorService) => {
    const id = service.id.trim();
    if (!id) {
      return;
    }
    record.services.push(id);
    registry.services.push({
      connectorId: record.id,
      service,
      source: record.source,
    });
  };

  const createApi = (
    record: ConnectorRecord,
    apiParams: { config: CentrisConfig; connectorConfig?: Record<string, unknown> },
  ) => {
    return createConnectorApi({
      record,
      config: apiParams.config,
      connectorConfig: apiParams.connectorConfig,
      logger: params.logger,
      onRegisterTool: (tool, opts) => registerTool(record, tool, opts),
      onRegisterGatewayMethod: (method, handler) => registerGatewayMethod(record, method, handler),
      onRegisterCli: (registrar, opts) => registerCli(record, registrar, opts),
      onRegisterService: (service) => registerService(record, service),
    });
  };

  return {
    registry,
    createApi,
    pushDiagnostic,
  };
}

// =============================================================================
// Tool Resolution
// =============================================================================

/**
 * Resolve tools from the registry for a given context.
 */
export function resolveConnectorTools(params: {
  registry: ConnectorRegistry;
  context: ConnectorToolContext;
  existingToolNames?: Set<string>;
  logger?: ConnectorLogger;
}): CentrisTool[] {
  const tools: CentrisTool[] = [];
  const existing = params.existingToolNames ?? new Set<string>();
  const logger = params.logger;

  for (const entry of params.registry.tools) {
    // Only include tools from enabled connectors
    const connector = params.registry.connectors.find((c) => c.id === entry.connectorId);
    if (!connector || connector.status !== "loaded") {
      continue;
    }

    let resolved: CentrisTool | CentrisTool[] | null | undefined = null;
    try {
      resolved = entry.factory(params.context);
    } catch (err) {
      logger?.error?.(`Tool factory failed (${entry.connectorId}): ${String(err)}`);
      params.registry.diagnostics.push({
        level: "error",
        connectorId: entry.connectorId,
        source: entry.source,
        message: `Tool factory failed: ${String(err)}`,
      });
      continue;
    }

    if (!resolved) {
      continue;
    }

    const list = Array.isArray(resolved) ? resolved : [resolved];
    for (const tool of list) {
      if (existing.has(tool.name)) {
        logger?.warn?.(`Tool name conflict (${entry.connectorId}): ${tool.name}`);
        params.registry.diagnostics.push({
          level: "warn",
          connectorId: entry.connectorId,
          source: entry.source,
          message: `Tool name conflict: ${tool.name}`,
        });
        continue;
      }
      existing.add(tool.name);
      tools.push(tool);
    }
  }

  return tools;
}
