/**
 * @centris/sdk - Plugin API Factory
 *
 * Creates the connector API that gets passed to connector's register() function.
 * Pattern inspired by Clawdbot's createPluginRegistry.
 */

import path from "node:path";
import type { CentrisConfig } from "../config/types.js";
import type { ConnectorRecord } from "../loader/registry.js";
import type {
  CentrisConnectorApi,
  ConnectorLogger,
  ConnectorToolFactory,
  CentrisTool,
  GatewayRequestHandler,
  ConnectorCliRegistrar,
  ConnectorService,
} from "./types.js";

/**
 * Parameters for creating a connector API.
 */
export interface CreateConnectorApiParams {
  /** Connector record from registry */
  record: ConnectorRecord;
  /** Full Centris config */
  config: CentrisConfig;
  /** Connector-specific config */
  connectorConfig?: Record<string, unknown>;
  /** Logger instance */
  logger: ConnectorLogger;
  /** Callback when tool is registered */
  onRegisterTool: (
    tool: CentrisTool | ConnectorToolFactory,
    opts?: { name?: string; names?: string[] },
  ) => void;
  /** Callback when gateway method is registered */
  onRegisterGatewayMethod: (method: string, handler: GatewayRequestHandler) => void;
  /** Callback when CLI commands are registered */
  onRegisterCli: (registrar: ConnectorCliRegistrar, opts?: { commands?: string[] }) => void;
  /** Callback when service is registered */
  onRegisterService: (service: ConnectorService) => void;
}

/**
 * Normalize a logger to ensure all methods exist.
 */
function normalizeLogger(logger: ConnectorLogger): ConnectorLogger {
  return {
    debug: logger.debug,
    info: logger.info,
    warn: logger.warn,
    error: logger.error,
  };
}

/**
 * Resolve a path relative to the connector's source directory.
 */
function createPathResolver(source: string): (input: string) => string {
  const baseDir = path.dirname(source);
  return (input: string) => {
    if (path.isAbsolute(input)) {
      return input;
    }
    return path.resolve(baseDir, input);
  };
}

/**
 * Create the connector API for a loaded connector.
 * This is what gets passed to the connector's register() function.
 */
export function createConnectorApi(params: CreateConnectorApiParams): CentrisConnectorApi {
  const { record, config, connectorConfig, logger } = params;
  const normalizedLogger = normalizeLogger(logger);
  const resolvePath = createPathResolver(record.source);

  return {
    // Identity
    id: record.id,
    name: record.name,
    version: record.version,
    description: record.description,
    source: record.source,

    // Config
    config,
    connectorConfig,

    // Logging
    logger: normalizedLogger,

    // Registration methods
    registerTool(tool, opts) {
      const toolName = opts?.name || (typeof tool === "function" ? "factory" : tool.name);
      normalizedLogger.debug?.(`Registering tool: ${toolName}`);
      params.onRegisterTool(tool, opts);
    },

    registerGatewayMethod(method, handler) {
      normalizedLogger.debug?.(`Registering gateway method: ${method}`);
      params.onRegisterGatewayMethod(method, handler);
    },

    registerCli(registrar, opts) {
      const commands = opts?.commands?.join(", ") || "unknown";
      normalizedLogger.debug?.(`Registering CLI commands: ${commands}`);
      params.onRegisterCli(registrar, opts);
    },

    registerService(service) {
      normalizedLogger.debug?.(`Registering service: ${service.id}`);
      params.onRegisterService(service);
    },

    // Utilities
    resolvePath,
  };
}
