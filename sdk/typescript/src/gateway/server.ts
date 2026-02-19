/**
 * @centris/sdk - MCP Server
 *
 * HTTP server that exposes the MCP Gateway as REST/JSON-RPC endpoints.
 * Compatible with Claude Desktop, Cursor, and other MCP clients.
 */

import http from "node:http";
import type { ConnectorToolContext } from "../plugin/types.js";
import type { MCPServerOptions, CentrisMCPGateway } from "./types.js";

/**
 * MCP Server that wraps the gateway.
 */
export class MCPServer {
  private readonly gateway: CentrisMCPGateway;
  private readonly port: number;
  private readonly host: string;
  private readonly cors: boolean;
  private server: http.Server | null = null;

  constructor(options: MCPServerOptions) {
    this.gateway = options.gateway;
    this.port = options.port ?? 3000;
    this.host = options.host ?? "localhost";
    this.cors = options.cors ?? true;
  }

  /**
   * Start the MCP server.
   */
  async start(): Promise<void> {
    this.server = http.createServer(this.handleRequest.bind(this));

    return new Promise((resolve) => {
      this.server!.listen(this.port, this.host, () => {
        console.log(`MCP Server running at http://${this.host}:${this.port}`);
        console.log(`  Tools:      http://${this.host}:${this.port}/mcp/tools`);
        console.log(`  Execute:    http://${this.host}:${this.port}/mcp/execute`);
        console.log(`  JSON-RPC:   http://${this.host}:${this.port}/rpc`);
        resolve();
      });
    });
  }

  /**
   * Stop the MCP server.
   */
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Handle incoming HTTP requests.
   */
  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

    // CORS headers
    if (this.cors) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // Route requests
      if (url.pathname === "/" || url.pathname === "/health") {
        await this.handleHealth(req, res);
      } else if (url.pathname === "/mcp/tools" || url.pathname === "/tools") {
        await this.handleListTools(req, res);
      } else if (url.pathname === "/mcp/execute" || url.pathname === "/execute") {
        await this.handleExecute(req, res);
      } else if (url.pathname === "/mcp/schema" || url.pathname === "/schema") {
        await this.handleSchema(req, res);
      } else if (url.pathname === "/mcp/connectors" || url.pathname === "/connectors") {
        await this.handleListConnectors(req, res);
      } else if (url.pathname === "/mcp/search" || url.pathname === "/search") {
        await this.handleSearch(req, res, url);
      } else if (url.pathname === "/rpc") {
        await this.handleJsonRpc(req, res);
      } else if (url.pathname === "/.well-known/agent.json") {
        await this.handleAgentCard(req, res);
      } else {
        this.sendError(res, 404, "Not found");
      }
    } catch (err) {
      console.error("Request error:", err);
      this.sendError(res, 500, String(err));
    }
  }

  /**
   * Health check endpoint.
   */
  private async handleHealth(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const health = await this.gateway.healthCheck();
    const allHealthy = Array.from(health.values()).every((v) => v);

    this.sendJson(res, {
      status: allHealthy ? "healthy" : "degraded",
      gateway: {
        name: this.gateway.name,
        version: this.gateway.version,
      },
      connectors: Object.fromEntries(health),
    });
  }

  /**
   * List available tools.
   */
  private async handleListTools(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const tools = this.gateway.listTools();
    this.sendJson(res, { tools });
  }

  /**
   * Execute a tool.
   */
  private async handleExecute(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.method !== "POST") {
      this.sendError(res, 405, "Method not allowed");
      return;
    }

    const body = await this.readBody(req);
    const { tool, name, arguments: args, params } = JSON.parse(body);

    const toolName = tool ?? name;
    const toolArgs = args ?? params ?? {};

    if (!toolName) {
      this.sendError(res, 400, "Missing tool name");
      return;
    }

    const context: ConnectorToolContext = {
      config: {},
      sessionKey: req.headers["x-session-key"] as string,
      userId: req.headers["x-user-id"] as string,
    };

    const result = await this.gateway.executeTool({ name: toolName, arguments: toolArgs }, context);

    this.sendJson(res, {
      success: !result.isError,
      result,
    });
  }

  /**
   * Get full MCP schema.
   */
  private async handleSchema(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    this.sendJson(res, this.gateway.toMCPSchema());
  }

  /**
   * List connectors.
   */
  private async handleListConnectors(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const connectors = this.gateway.listConnectors().map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      version: c.version,
      tools: c.tools.length,
      healthStatus: c.healthStatus,
    }));

    this.sendJson(res, { connectors });
  }

  /**
   * Search capabilities.
   */
  private async handleSearch(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL,
  ): Promise<void> {
    const query = url.searchParams.get("q") ?? url.searchParams.get("query") ?? "";
    const limit = parseInt(url.searchParams.get("limit") ?? "10", 10);

    if (!query) {
      this.sendError(res, 400, "Missing query parameter");
      return;
    }

    const results = this.gateway.searchCapabilities(query, { limit });
    this.sendJson(res, { results });
  }

  /**
   * JSON-RPC endpoint (MCP compatible).
   */
  private async handleJsonRpc(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.method !== "POST") {
      this.sendError(res, 405, "Method not allowed");
      return;
    }

    const body = await this.readBody(req);
    const rpc = JSON.parse(body);

    // Handle JSON-RPC 2.0 request
    const { id, method, params } = rpc;

    try {
      let result: unknown;

      switch (method) {
        case "tools/list":
          result = { tools: this.gateway.listTools() };
          break;

        case "tools/call": {
          const { name, arguments: args } = params;
          const context: ConnectorToolContext = { config: {} };
          result = await this.gateway.executeTool({ name, arguments: args }, context);
          break;
        }

        case "resources/list":
          result = { resources: [] }; // No resources by default
          break;

        case "prompts/list":
          result = { prompts: [] }; // No prompts by default
          break;

        case "initialize":
          result = {
            protocolVersion: "2024-11-05",
            serverInfo: {
              name: this.gateway.name,
              version: this.gateway.version,
            },
            capabilities: {
              tools: {},
            },
          };
          break;

        default:
          throw new Error(`Unknown method: ${method}`);
      }

      this.sendJson(res, {
        jsonrpc: "2.0",
        id,
        result,
      });
    } catch (err) {
      this.sendJson(res, {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32603,
          message: String(err),
        },
      });
    }
  }

  /**
   * A2A Agent Card endpoint.
   */
  private async handleAgentCard(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const tools = this.gateway.listTools();

    this.sendJson(res, {
      name: this.gateway.name,
      description: `Centris MCP Gateway with ${tools.length} tools`,
      url: `http://${this.host}:${this.port}`,
      version: this.gateway.version,
      capabilities: {
        streaming: false,
        pushNotifications: false,
        stateTransitionHistory: false,
      },
      authentication: {
        schemes: [],
      },
      defaultInputModes: ["text"],
      defaultOutputModes: ["text"],
      skills: tools.map((t) => ({
        id: t.name,
        name: t.name,
        description: t.description,
      })),
    });
  }

  /**
   * Read request body.
   */
  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => resolve(body));
      req.on("error", reject);
    });
  }

  /**
   * Send JSON response.
   */
  private sendJson(res: http.ServerResponse, data: unknown): void {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data, null, 2));
  }

  /**
   * Send error response.
   */
  private sendError(res: http.ServerResponse, status: number, message: string): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: message }));
  }
}

/**
 * Create an MCP Server instance.
 */
export function createMCPServer(options: MCPServerOptions): MCPServer {
  return new MCPServer(options);
}
