/**
 * @centris/sdk - MCP Gateway Implementation
 *
 * Central gateway that aggregates connectors and provides unified MCP interface.
 */

import type { CentrisTool, ConnectorToolContext } from "../plugin/types.js";
import type {
  MCPGatewayOptions,
  RegisteredConnector,
  MCPToolCall,
  MCPToolResult,
  CapabilitySearchResult,
  GatewayLogger,
  CentrisMCPGateway as ICentrisMCPGateway,
} from "./types.js";
import { loadCentrisConnectors } from "../loader/loader.js";
import { resolveConnectorTools } from "../loader/registry.js";

/**
 * Generate a unique tool call ID.
 * Uses timestamp + random suffix for uniqueness even in rapid calls.
 */
let toolCallCounter = 0;
function generateToolCallId(): string {
  const timestamp = Date.now().toString(36);
  const counter = (toolCallCounter++).toString(36).padStart(4, "0");
  const random = Math.random().toString(36).substring(2, 6);
  return `tc_${timestamp}_${counter}_${random}`;
}

/**
 * Default logger for gateway.
 */
function createDefaultLogger(): GatewayLogger {
  return {
    debug: (msg) => console.debug(`[centris:gateway] ${msg}`),
    info: (msg) => console.info(`[centris:gateway] ${msg}`),
    warn: (msg) => console.warn(`[centris:gateway] ${msg}`),
    error: (msg) => console.error(`[centris:gateway] ${msg}`),
  };
}

/**
 * Centris MCP Gateway
 *
 * Aggregates connectors and exposes them as a unified MCP interface.
 * Can be used standalone or embedded in other applications.
 */
export class CentrisMCPGateway implements ICentrisMCPGateway {
  public readonly name: string;
  public readonly version: string;
  public readonly connectors: Map<string, RegisteredConnector>;

  private readonly logger: GatewayLogger;
  private readonly options: MCPGatewayOptions;
  private toolIndex: Map<string, { connector: RegisteredConnector; tool: CentrisTool }>;

  constructor(options: MCPGatewayOptions = {}) {
    this.name = options.name ?? "centris-gateway";
    this.version = options.version ?? "1.0.0";
    this.options = options;
    this.logger = options.logger ?? createDefaultLogger();
    this.connectors = new Map();
    this.toolIndex = new Map();
  }

  /**
   * Initialize the gateway, optionally discovering connectors.
   */
  async initialize(): Promise<void> {
    if (this.options.autoDiscover !== false) {
      await this.discoverConnectors();
    }

    // Load from explicit paths
    if (this.options.connectorPaths?.length) {
      for (const connectorPath of this.options.connectorPaths) {
        await this.loadConnectorFromPath(connectorPath);
      }
    }

    this.logger.info(`Gateway initialized with ${this.connectors.size} connector(s)`);
  }

  /**
   * Auto-discover and load connectors from node_modules.
   */
  async discoverConnectors(): Promise<void> {
    this.logger.debug?.("Discovering connectors...");

    const registry = loadCentrisConnectors({
      workspaceDir: this.options.workspaceDir,
      logger: this.logger,
    });

    // Convert registry connectors to RegisteredConnectors
    const context: ConnectorToolContext = {
      config: {},
    };

    const tools = resolveConnectorTools({
      registry,
      context,
      logger: this.logger,
    });

    // Group tools by connector
    const connectorTools = new Map<string, CentrisTool[]>();
    for (const entry of registry.tools) {
      if (!connectorTools.has(entry.connectorId)) {
        connectorTools.set(entry.connectorId, []);
      }
    }

    for (const tool of tools) {
      // Find which connector this tool belongs to by name matching only
      // (comparing function references is unreliable due to closures)
      const entry = registry.tools.find((t) => t.names.includes(tool.name));
      if (entry) {
        const list = connectorTools.get(entry.connectorId) ?? [];
        list.push(tool);
        connectorTools.set(entry.connectorId, list);
      }
    }

    // Register discovered connectors
    for (const record of registry.connectors) {
      if (record.status !== "loaded") {
        continue;
      }

      const registeredConnector: RegisteredConnector = {
        id: record.id,
        name: record.name,
        description: record.description,
        version: record.version,
        tools: connectorTools.get(record.id) ?? [],
        healthStatus: "healthy",
        lastHealthCheck: new Date(),
      };

      this.registerConnector(registeredConnector);
    }
  }

  /**
   * Load a connector from a specific path.
   */
  async loadConnectorFromPath(connectorPath: string): Promise<void> {
    this.logger.debug?.(`Loading connector from ${connectorPath}`);

    // Use the loader with specific path
    const registry = loadCentrisConnectors({
      extraPaths: [connectorPath],
      logger: this.logger,
    });

    const context: ConnectorToolContext = { config: {} };
    const tools = resolveConnectorTools({ registry, context, logger: this.logger });

    for (const record of registry.connectors) {
      if (record.status !== "loaded") {
        continue;
      }

      const connectorTools = tools.filter((t) => {
        const entry = registry.tools.find((e) => e.names.includes(t.name));
        return entry?.connectorId === record.id;
      });

      const registeredConnector: RegisteredConnector = {
        id: record.id,
        name: record.name,
        description: record.description,
        version: record.version,
        tools: connectorTools,
        healthStatus: "healthy",
        lastHealthCheck: new Date(),
      };

      this.registerConnector(registeredConnector);
    }
  }

  /**
   * Register a connector with the gateway.
   */
  registerConnector(connector: RegisteredConnector): void {
    this.logger.info(`Registering connector: ${connector.name} (${connector.id})`);

    // Remove existing if present
    if (this.connectors.has(connector.id)) {
      this.unregisterConnector(connector.id);
    }

    this.connectors.set(connector.id, connector);

    // Index tools
    for (const tool of connector.tools) {
      this.toolIndex.set(tool.name, { connector, tool });
    }

    this.logger.debug?.(`Registered ${connector.tools.length} tool(s) from ${connector.id}`);
  }

  /**
   * Unregister a connector from the gateway.
   */
  unregisterConnector(connectorId: string): void {
    const connector = this.connectors.get(connectorId);
    if (!connector) {
      return;
    }

    // Remove tools from index
    for (const tool of connector.tools) {
      this.toolIndex.delete(tool.name);
    }

    this.connectors.delete(connectorId);
    this.logger.info(`Unregistered connector: ${connectorId}`);
  }

  /**
   * Get a connector by ID.
   */
  getConnector(connectorId: string): RegisteredConnector | undefined {
    return this.connectors.get(connectorId);
  }

  /**
   * List all registered connectors.
   */
  listConnectors(): RegisteredConnector[] {
    return Array.from(this.connectors.values());
  }

  /**
   * List all available tools across all connectors.
   */
  listTools(): Array<{ name: string; description: string; inputSchema: unknown }> {
    const tools: Array<{ name: string; description: string; inputSchema: unknown }> = [];

    for (const connector of this.connectors.values()) {
      for (const tool of connector.tools) {
        tools.push({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.parameters,
        });
      }
    }

    return tools;
  }

  /**
   * Execute a tool by name.
   */
  async executeTool(call: MCPToolCall, context?: ConnectorToolContext): Promise<MCPToolResult> {
    const entry = this.toolIndex.get(call.name);

    if (!entry) {
      return {
        content: [{ type: "text", text: `Tool not found: ${call.name}` }],
        isError: true,
      };
    }

    const { connector, tool } = entry;
    this.logger.debug?.(`Executing tool: ${call.name} (connector: ${connector.id})`);

    const startTime = Date.now();
    const toolCallId = generateToolCallId();
    try {
      const result = await tool.execute(toolCallId, call.arguments, context ?? { config: {} });

      const latencyMs = Date.now() - startTime;
      this.logger.debug?.(`Tool ${call.name} completed in ${latencyMs}ms`);

      return result;
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      this.logger.error(`Tool ${call.name} failed in ${latencyMs}ms: ${String(err)}`);

      return {
        content: [{ type: "text", text: `Tool execution failed: ${String(err)}` }],
        isError: true,
      };
    }
  }

  /**
   * Search for capabilities matching a query.
   */
  searchCapabilities(
    query: string,
    options?: { tags?: string[]; limit?: number },
  ): CapabilitySearchResult[] {
    const results: CapabilitySearchResult[] = [];
    const queryLower = query.toLowerCase();
    const limit = options?.limit ?? 10;

    for (const connector of this.connectors.values()) {
      for (const tool of connector.tools) {
        // Simple keyword matching (would use embeddings in production)
        const descLower = tool.description.toLowerCase();
        const nameLower = tool.name.toLowerCase();

        let score = 0;
        if (nameLower.includes(queryLower)) {
          score += 0.5;
        }
        if (descLower.includes(queryLower)) {
          score += 0.3;
        }

        // Check individual words
        for (const word of queryLower.split(/\s+/)) {
          if (descLower.includes(word)) {
            score += 0.1;
          }
        }

        if (score > 0) {
          results.push({
            connectorId: connector.id,
            connectorName: connector.name,
            capabilityId: tool.name,
            name: tool.label ?? tool.name,
            description: tool.description,
            confidence: Math.min(score, 1),
          });
        }
      }
    }

    // Sort by confidence and limit
    return results.toSorted((a, b) => b.confidence - a.confidence).slice(0, limit);
  }

  /**
   * Export as MCP-compatible schema.
   */
  toMCPSchema(): {
    name: string;
    version: string;
    tools: Array<{ name: string; description: string; inputSchema: unknown }>;
  } {
    return {
      name: this.name,
      version: this.version,
      tools: this.listTools(),
    };
  }

  /**
   * Health check for all connectors.
   */
  async healthCheck(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    for (const [id, connector] of this.connectors) {
      // For local connectors, just check if they have tools
      const healthy = connector.tools.length > 0;
      results.set(id, healthy);

      connector.healthStatus = healthy ? "healthy" : "unhealthy";
      connector.lastHealthCheck = new Date();
    }

    return results;
  }
}

/**
 * Create an MCP Gateway instance.
 */
export function createMCPGateway(options?: MCPGatewayOptions): CentrisMCPGateway {
  return new CentrisMCPGateway(options);
}
