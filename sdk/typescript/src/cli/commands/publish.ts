/**
 * @centris/sdk - CLI Publish Command
 *
 * Publish a connector to the Centris registry.
 */

import { createJiti } from "jiti";
import fs from "node:fs";
import path from "node:path";
import type { CentrisConnectorDefinition } from "../../plugin/types.js";
import type { PublishOptions, CLIContext } from "../types.js";

interface PublishPayload {
  connector: {
    id: string;
    name: string;
    description: string;
    version: string;
  };
  tools: Array<{
    name: string;
    description: string;
    inputSchema: unknown;
  }>;
  package: {
    name: string;
    version: string;
    tarball?: string;
  };
}

async function publishToRegistry(params: {
  registryUrl: string;
  apiKey: string;
  payload: PublishPayload;
}): Promise<{ warnings?: string[] }> {
  const { registryUrl, apiKey, payload } = params;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  // Primary contract shared with the Python SDK CLI.
  const primary = await fetch(`${registryUrl}/api/connectors`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (primary.ok) {
    return (await primary.json()) as { warnings?: string[] };
  }

  // Compatibility fallback for older registry deployments.
  if (primary.status === 404 || primary.status === 405 || primary.status === 501) {
    const fallback = await fetch(`${registryUrl}/api/registry/publish`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        manifest: {
          id: payload.connector.id,
          name: payload.connector.name,
          version: payload.connector.version,
          description: payload.connector.description,
          tools: payload.tools,
        },
        package: payload.package,
      }),
    });
    if (fallback.ok) {
      return (await fallback.json()) as { warnings?: string[] };
    }
    const error = await fallback.text();
    throw new Error(`Registry returned ${fallback.status}: ${error}`);
  }

  const error = await primary.text();
  throw new Error(`Registry returned ${primary.status}: ${error}`);
}

export async function publishConnector(options: PublishOptions, ctx: CLIContext): Promise<void> {
  const { logger } = ctx;
  const connectorPath = path.resolve(ctx.cwd, options.path ?? ".");
  const registryUrl = options.registry ?? "https://registry.centris.ai";
  const apiKey = options.apiKey ?? process.env.CENTRIS_API_KEY;

  logger.info(`Publishing connector from ${connectorPath}`);
  logger.info(`Registry: ${registryUrl}`);

  // Check for API key
  if (!apiKey && !options.dryRun) {
    logger.error("API key required. Set CENTRIS_API_KEY or use --api-key");
    process.exit(1);
  }

  // Load package.json
  const packageJsonPath = path.join(connectorPath, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    logger.error("No package.json found. Is this a connector project?");
    process.exit(1);
  }

  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));

  if (!pkg.centrisConnector?.id) {
    logger.error("Missing centrisConnector.id in package.json");
    process.exit(1);
  }

  // Load the connector to get metadata
  const jiti = createJiti(import.meta.url, { interopDefault: true });

  const mainCandidates = [
    path.join(connectorPath, "dist", "index.js"),
    path.join(connectorPath, "src", "index.ts"),
    path.join(connectorPath, "index.js"),
    path.join(connectorPath, "index.ts"),
  ];

  let mainFile: string | null = null;
  for (const candidate of mainCandidates) {
    if (fs.existsSync(candidate)) {
      mainFile = candidate;
      break;
    }
  }

  if (!mainFile) {
    logger.error("Could not find connector entry point. Run 'npm run build' first.");
    process.exit(1);
  }

  let connector: CentrisConnectorDefinition;
  const tools: Array<{
    name: string;
    description: string;
    inputSchema: unknown;
  }> = [];

  try {
    const mod = jiti(mainFile);
    connector = mod.default ?? mod.connector ?? mod;

    // Register to capture tools
    const mockApi = {
      id: connector.id ?? pkg.centrisConnector.id,
      name: connector.name ?? pkg.name,
      version: connector.version ?? pkg.version,
      description: connector.description ?? pkg.description,
      source: mainFile,
      config: {},
      connectorConfig: {},
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
      registerTool: (tool: Record<string, unknown>) => {
        const name = typeof tool.name === "string" ? tool.name : "";
        const description = typeof tool.description === "string" ? tool.description : "";
        tools.push({
          name,
          description,
          inputSchema: tool.parameters,
        });
      },
      registerGatewayMethod: () => {},
      registerCli: () => {},
      registerService: () => {},
      resolvePath: (input: string) => path.resolve(connectorPath, input),
    };

    const register = connector.register ?? connector.activate;
    if (register) {
      await Promise.resolve(register(mockApi as unknown as Parameters<typeof register>[0]));
    }
  } catch (err) {
    logger.error(`Failed to load connector: ${String(err)}`);
    process.exit(1);
  }

  // Build publish payload
  const payload: PublishPayload = {
    connector: {
      id: connector.id ?? pkg.centrisConnector.id,
      name: connector.name ?? pkg.name,
      description: connector.description ?? pkg.description ?? "",
      version: connector.version ?? pkg.version,
    },
    tools,
    package: {
      name: pkg.name,
      version: pkg.version,
    },
  };

  // Display summary
  logger.info("");
  logger.info("Publish Summary:");
  logger.info(`  ID:          ${payload.connector.id}`);
  logger.info(`  Name:        ${payload.connector.name}`);
  logger.info(`  Version:     ${payload.connector.version}`);
  logger.info(`  Tools:       ${payload.tools.length}`);
  logger.info("");

  for (const tool of payload.tools) {
    logger.info(`  - ${tool.name}: ${tool.description}`);
  }

  logger.info("");

  if (options.dryRun) {
    logger.warn("Dry run - not actually publishing");
    logger.info("\nPayload that would be sent:");
    logger.info(JSON.stringify(payload, null, 2));
    return;
  }

  // Confirm
  if (!options.yes) {
    logger.info("Add --yes to skip this confirmation");
    // In a real CLI, we'd prompt here
    // For now, just proceed
  }

  // Publish to registry
  logger.info("Publishing to registry...");

  try {
    const result = await publishToRegistry({
      registryUrl,
      apiKey: String(apiKey),
      payload,
    });
    logger.success("Published successfully!");
    logger.info(`  URL: ${registryUrl}/connectors/${payload.connector.id}`);

    if (result.warnings?.length) {
      for (const warning of result.warnings) {
        logger.warn(`  Warning: ${warning}`);
      }
    }
  } catch (err) {
    logger.error(`Publish failed: ${String(err)}`);
    process.exit(1);
  }
}
