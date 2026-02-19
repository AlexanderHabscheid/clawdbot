/**
 * @centris/sdk - MCP Gateway Types
 */

import type {
  ActionApiMethod,
  ActionApiRequestEnvelope,
  ActionApiResponseEnvelope,
} from "../action-api/index.js";
import type { CentrisTool, ConnectorToolContext } from "../plugin/types.js";

/**
 * Options for creating an MCP Gateway.
 */
export interface MCPGatewayOptions {
  /** Gateway name */
  name?: string;
  /** Gateway version */
  version?: string;
  /** Logger instance */
  logger?: GatewayLogger;
  /** Auto-discover connectors from node_modules */
  autoDiscover?: boolean;
  /** Additional connector paths to load */
  connectorPaths?: string[];
  /** Workspace directory for discovery */
  workspaceDir?: string;
}

/**
 * Options for MCP Server.
 */
export interface MCPServerOptions {
  /** Server port */
  port?: number;
  /** Server host */
  host?: string;
  /** Enable CORS */
  cors?: boolean;
  /** Gateway instance to use */
  gateway: CentrisMCPGateway;
  /** Optional action API handler used by /api/v1/action */
  actionApiHandler?: ActionApiHandler;
}

export type ActionApiHandler = <M extends ActionApiMethod>(
  request: ActionApiRequestEnvelope<M>,
) => Promise<ActionApiResponseEnvelope<M>>;

/**
 * Logger interface for gateway.
 */
export interface GatewayLogger {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

/**
 * A connector registered with the gateway.
 */
export interface RegisteredConnector {
  /** Connector ID */
  id: string;
  /** Display name */
  name: string;
  /** Description */
  description?: string;
  /** Version */
  version?: string;
  /** Endpoint URL (for remote connectors) */
  url?: string;
  /** Registered tools */
  tools: CentrisTool[];
  /** Health status */
  healthStatus: "unknown" | "healthy" | "unhealthy";
  /** Last health check time */
  lastHealthCheck?: Date;
  /** Connector metadata */
  metadata?: Record<string, unknown>;
}

/**
 * MCP Tool Call structure.
 */
export interface MCPToolCall {
  /** Tool name */
  name: string;
  /** Tool arguments */
  arguments: Record<string, unknown>;
}

/**
 * MCP Tool Result structure.
 */
export interface MCPToolResult {
  /** Content blocks */
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
    | { type: "resource"; uri: string; mimeType?: string; text?: string }
  >;
  /** Whether the result is an error */
  isError?: boolean;
}

/**
 * MCP Resource structure.
 */
export interface MCPResource {
  /** Resource URI */
  uri: string;
  /** Resource name */
  name: string;
  /** Resource description */
  description?: string;
  /** MIME type */
  mimeType?: string;
}

/**
 * Capability registration from the spec.
 */
export interface CapabilityRegistration {
  connectorId: string;
  capabilityId: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  examples?: string[];
  tags?: string[];
  executionMethods?: string[];
  version?: string;
}

/**
 * Search result for capability search.
 */
export interface CapabilitySearchResult {
  connectorId: string;
  connectorName: string;
  capabilityId: string;
  name: string;
  description: string;
  confidence: number;
  executionMethods?: string[];
}

// Forward declaration for gateway
export interface CentrisMCPGateway {
  name: string;
  version: string;
  connectors: Map<string, RegisteredConnector>;
  registerConnector(connector: RegisteredConnector): void;
  unregisterConnector(connectorId: string): void;
  getConnector(connectorId: string): RegisteredConnector | undefined;
  listConnectors(): RegisteredConnector[];
  listTools(): Array<{ name: string; description: string; inputSchema: unknown }>;
  executeTool(call: MCPToolCall, context?: ConnectorToolContext): Promise<MCPToolResult>;
  searchCapabilities(
    query: string,
    options?: { tags?: string[]; limit?: number },
  ): CapabilitySearchResult[];
  healthCheck(): Promise<Map<string, boolean>>;
  toMCPSchema(): {
    name: string;
    version: string;
    tools: Array<{ name: string; description: string; inputSchema: unknown }>;
  };
}
