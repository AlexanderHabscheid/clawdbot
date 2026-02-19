/**
 * @centris/sdk - CLI Serve Command
 *
 * Start a local development server for the connector.
 * Provides MCP-compatible endpoints for testing with Claude, Cursor, etc.
 */

import { createJiti } from "jiti";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type {
  CentrisConnectorDefinition,
  CentrisTool,
  ConnectorToolContext,
} from "../../plugin/types.js";
import type { ServeOptions, CLIContext } from "../types.js";

interface ConnectorServer {
  tools: CentrisTool[];
  connector: CentrisConnectorDefinition;
  context: ConnectorToolContext;
}

/**
 * Create HTTP request handler for the connector server.
 */
function createRequestHandler(server: ConnectorServer, logger: CLIContext["logger"]) {
  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Route requests
    try {
      if (url.pathname === "/" || url.pathname === "/health") {
        // Health check
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            connector: {
              id: server.connector.id,
              name: server.connector.name,
              version: server.connector.version,
            },
            tools: server.tools.length,
          }),
        );
        return;
      }

      if (url.pathname === "/mcp/tools" || url.pathname === "/tools") {
        // List tools (MCP compatible)
        const tools = server.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.parameters,
        }));

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ tools }));
        return;
      }

      if (url.pathname === "/mcp/schema" || url.pathname === "/schema") {
        // Full MCP schema
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            name: server.connector.id ?? "connector",
            version: server.connector.version ?? "1.0.0",
            description: server.connector.description ?? "",
            tools: server.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.parameters,
            })),
          }),
        );
        return;
      }

      if (url.pathname === "/.well-known/agent.json") {
        // A2A Agent Card
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            name: server.connector.name ?? server.connector.id,
            description: server.connector.description ?? "",
            url: `http://${req.headers.host}`,
            version: server.connector.version ?? "1.0.0",
            capabilities: {
              streaming: false,
              pushNotifications: false,
            },
            authentication: { schemes: [] },
            defaultInputModes: ["text"],
            defaultOutputModes: ["text"],
            skills: server.tools.map((tool) => ({
              id: tool.name,
              name: tool.label ?? tool.name,
              description: tool.description,
            })),
          }),
        );
        return;
      }

      if (url.pathname === "/execute" && req.method === "POST") {
        // Execute a tool
        const body = await readBody(req);
        const { tool: toolName, params } = JSON.parse(body);

        const tool = server.tools.find((t) => t.name === toolName);
        if (!tool) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Tool not found: ${toolName}` }));
          return;
        }

        logger.info(`Executing: ${toolName}`);
        const startTime = Date.now();

        try {
          const result = await tool.execute(`exec-${Date.now()}`, params ?? {}, server.context);
          const duration = Date.now() - startTime;
          logger.success(`Completed in ${duration}ms`);

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: !result.isError,
              result,
              metadata: { latencyMs: duration },
            }),
          );
        } catch (err) {
          const duration = Date.now() - startTime;
          logger.error(`Failed in ${duration}ms: ${String(err)}`);

          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: false,
              error: String(err),
              metadata: { latencyMs: duration },
            }),
          );
        }
        return;
      }

      // Interactive UI
      if (url.pathname === "/ui" || url.pathname === "/playground") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(generatePlaygroundHTML(server));
        return;
      }

      // 404
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    } catch (err) {
      logger.error(`Request error: ${String(err)}`);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
  };
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function generatePlaygroundHTML(server: ConnectorServer): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${server.connector.name ?? "Connector"} Playground</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
    .container { max-width: 800px; margin: 0 auto; }
    h1 { color: #333; }
    .tool { background: white; border-radius: 8px; padding: 16px; margin: 12px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .tool h3 { margin: 0 0 8px; color: #0066cc; }
    .tool p { margin: 0 0 12px; color: #666; }
    textarea { width: 100%; height: 100px; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-family: monospace; }
    button { background: #0066cc; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; margin-top: 8px; }
    button:hover { background: #0052a3; }
    .result { background: #f8f8f8; padding: 12px; border-radius: 4px; margin-top: 12px; white-space: pre-wrap; font-family: monospace; font-size: 13px; }
    .error { background: #fee; color: #c00; }
    .success { background: #efe; color: #060; }
  </style>
</head>
<body>
  <div class="container">
    <h1>${server.connector.name ?? "Connector"} Playground</h1>
    <p>Version: ${server.connector.version ?? "1.0.0"}</p>
    <p>${server.connector.description ?? ""}</p>
    
    <h2>Tools</h2>
    ${server.tools
      .map(
        (tool) => `
      <div class="tool">
        <h3>${tool.name}</h3>
        <p>${tool.description}</p>
        <textarea id="params-${tool.name}" placeholder='{"param": "value"}'>{}</textarea>
        <button onclick="executeTool('${tool.name}')">Execute</button>
        <div id="result-${tool.name}" class="result" style="display:none;"></div>
      </div>
    `,
      )
      .join("")}
  </div>
  
  <script>
    async function executeTool(name) {
      const paramsEl = document.getElementById('params-' + name);
      const resultEl = document.getElementById('result-' + name);
      
      try {
        const params = JSON.parse(paramsEl.value || '{}');
        resultEl.style.display = 'block';
        resultEl.className = 'result';
        resultEl.textContent = 'Executing...';
        
        const res = await fetch('/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tool: name, params }),
        });
        
        const data = await res.json();
        resultEl.className = 'result ' + (data.success ? 'success' : 'error');
        resultEl.textContent = JSON.stringify(data, null, 2);
      } catch (err) {
        resultEl.style.display = 'block';
        resultEl.className = 'result error';
        resultEl.textContent = 'Error: ' + err.message;
      }
    }
  </script>
</body>
</html>`;
}

export async function serveConnector(options: ServeOptions, ctx: CLIContext): Promise<void> {
  const { logger } = ctx;
  const connectorPath = path.resolve(ctx.cwd, options.path ?? ".");
  const port = options.port ?? 8000;
  const host = options.host ?? "localhost";

  logger.info(`Loading connector from ${connectorPath}`);

  // Load the connector
  const jiti = createJiti(import.meta.url, { interopDefault: true });

  const mainCandidates = [
    path.join(connectorPath, "src", "index.ts"),
    path.join(connectorPath, "src", "connector.ts"),
    path.join(connectorPath, "dist", "index.js"),
    path.join(connectorPath, "index.ts"),
    path.join(connectorPath, "index.js"),
  ];

  let mainFile: string | null = null;
  for (const candidate of mainCandidates) {
    if (fs.existsSync(candidate)) {
      mainFile = candidate;
      break;
    }
  }

  if (!mainFile) {
    logger.error("Could not find connector entry point");
    process.exit(1);
  }

  let connector: CentrisConnectorDefinition;
  try {
    const mod = jiti(mainFile);
    connector = mod.default ?? mod.connector ?? mod;
  } catch (err) {
    logger.error(`Failed to load connector: ${String(err)}`);
    process.exit(1);
  }

  // Create mock API to capture tools
  const tools: CentrisTool[] = [];
  const mockApi = {
    id: connector.id ?? "dev-connector",
    name: connector.name ?? "Development Connector",
    version: connector.version,
    description: connector.description,
    source: mainFile,
    config: {},
    connectorConfig: {},
    logger: {
      debug: ctx.verbose ? (msg: string) => logger.debug(msg) : undefined,
      info: (msg: string) => logger.info(`[connector] ${msg}`),
      warn: (msg: string) => logger.warn(`[connector] ${msg}`),
      error: (msg: string) => logger.error(`[connector] ${msg}`),
    },
    registerTool: (tool: CentrisTool) => tools.push(tool),
    registerGatewayMethod: () => {},
    registerCli: () => {},
    registerService: () => {},
    resolvePath: (input: string) => path.resolve(connectorPath, input),
  };

  // Register
  const register = connector.register ?? connector.activate;
  if (register) {
    await Promise.resolve(register(mockApi as unknown as Parameters<typeof register>[0]));
  }

  logger.success(`Registered ${tools.length} tool(s)`);

  // Create server
  const serverState: ConnectorServer = {
    tools,
    connector,
    context: {
      config: {},
      workspaceDir: connectorPath,
      connectorDir: connectorPath,
      connectorId: connector.id ?? "dev",
      sessionKey: "dev-session",
      userId: "dev-user",
    },
  };

  const server = http.createServer(createRequestHandler(serverState, logger));

  server.listen(port, host, () => {
    logger.success(`\nConnector server running!`);
    logger.info("");
    logger.info(`  Local:       http://${host}:${port}`);
    logger.info(`  Playground:  http://${host}:${port}/ui`);
    logger.info(`  MCP Tools:   http://${host}:${port}/mcp/tools`);
    logger.info(`  MCP Schema:  http://${host}:${port}/mcp/schema`);
    logger.info(`  Agent Card:  http://${host}:${port}/.well-known/agent.json`);
    logger.info("");
    logger.info("Press Ctrl+C to stop");
  });

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    logger.info("\nShutting down...");
    server.close(() => {
      process.exit(0);
    });
  });
}
