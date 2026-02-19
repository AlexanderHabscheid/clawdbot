/**
 * @centris/sdk - MCP Gateway Module
 *
 * Embeddable MCP Gateway that aggregates connectors and exposes
 * them as a unified MCP-compatible interface.
 */

export { CentrisMCPGateway, createMCPGateway } from "./gateway.js";
export { MCPServer, createMCPServer } from "./server.js";
export type {
  MCPGatewayOptions,
  MCPServerOptions,
  ActionApiHandler,
  RegisteredConnector,
  MCPToolCall,
  MCPToolResult,
  MCPResource,
} from "./types.js";
