/**
 * @centris/sdk - CLI Test Command
 *
 * Test connector capabilities locally.
 */

import { createJiti } from "jiti";
import fs from "node:fs";
import path from "node:path";
import type {
  CentrisConnectorDefinition,
  CentrisTool,
  ConnectorToolContext,
} from "../../plugin/types.js";
import type { TestOptions, CLIContext } from "../types.js";

interface TestResult {
  capability: string;
  success: boolean;
  duration: number;
  result?: unknown;
  error?: string;
}

export async function testConnector(options: TestOptions, ctx: CLIContext): Promise<void> {
  const { logger } = ctx;
  const connectorPath = path.resolve(ctx.cwd, options.path ?? ".");

  logger.info(`Testing connector at ${connectorPath}`);

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

  logger.debug?.(`Loading connector from ${mainFile}`);

  let connector: CentrisConnectorDefinition;
  try {
    const mod = jiti(mainFile);
    connector = mod.default ?? mod.connector ?? mod;
  } catch (err) {
    logger.error(`Failed to load connector: ${String(err)}`);
    process.exit(1);
  }

  // Create a mock registry to capture registered tools
  const tools: CentrisTool[] = [];
  const mockLogger = {
    debug: ctx.verbose ? (msg: string) => logger.debug(msg) : undefined,
    info: (msg: string) => logger.info(msg),
    warn: (msg: string) => logger.warn(msg),
    error: (msg: string) => logger.error(msg),
  };

  const mockApi = {
    id: connector.id ?? "test-connector",
    name: connector.name ?? "Test Connector",
    version: connector.version,
    description: connector.description,
    source: mainFile,
    config: {},
    connectorConfig: {},
    logger: mockLogger,
    registerTool: (tool: CentrisTool) => {
      tools.push(tool);
    },
    registerGatewayMethod: () => {},
    registerCli: () => {},
    registerService: () => {},
    resolvePath: (input: string) => path.resolve(connectorPath, input),
  };

  // Register the connector
  const register = connector.register ?? connector.activate;
  if (!register) {
    logger.error("Connector missing register function");
    process.exit(1);
  }

  try {
    await Promise.resolve(register(mockApi as unknown as Parameters<typeof register>[0]));
  } catch (err) {
    logger.error(`Failed to register connector: ${String(err)}`);
    process.exit(1);
  }

  logger.info(`Loaded ${tools.length} tool(s)`);

  // Parse test params
  let testParams: Record<string, unknown> = {};
  if (options.params) {
    try {
      testParams = JSON.parse(options.params);
    } catch {
      logger.error("Invalid JSON in --params");
      process.exit(1);
    }
  }

  // Create test context
  const testContext: ConnectorToolContext = {
    config: {},
    workspaceDir: connectorPath,
    connectorDir: connectorPath,
    connectorId: connector.id ?? "test",
    sessionKey: "test-session",
    userId: "test-user",
  };

  // Run tests
  const results: TestResult[] = [];

  for (const tool of tools) {
    // Skip if specific capability requested and this isn't it
    if (options.capability && !tool.name.endsWith(options.capability)) {
      continue;
    }

    logger.info(`\nTesting: ${tool.name}`);
    logger.info(`Description: ${tool.description}`);

    const startTime = Date.now();
    let result: TestResult;

    try {
      const output = await tool.execute(`test-${Date.now()}`, testParams, testContext);
      const duration = Date.now() - startTime;

      result = {
        capability: tool.name,
        success: !output.isError,
        duration,
        result: output,
      };

      if (output.isError) {
        logger.error(`  ✗ Failed (${duration}ms)`);
        const errorContent = output.content.find((c) => c.type === "text");
        if (errorContent && errorContent.type === "text") {
          logger.error(`    ${errorContent.text}`);
        }
      } else {
        logger.success(`  ✓ Passed (${duration}ms)`);
        for (const content of output.content) {
          if (content.type === "text") {
            logger.info(`    ${content.text}`);
          } else if (content.type === "image") {
            logger.info(`    [Image: ${content.mimeType}]`);
          }
        }
      }
    } catch (err) {
      const duration = Date.now() - startTime;
      result = {
        capability: tool.name,
        success: false,
        duration,
        error: String(err),
      };
      logger.error(`  ✗ Error (${duration}ms): ${String(err)}`);
    }

    results.push(result);
  }

  // Summary
  logger.info("\n---");
  const passed = results.filter((r) => r.success).length;
  const failed = results.length - passed;

  if (failed === 0) {
    logger.success(`All ${passed} test(s) passed!`);
  } else {
    logger.error(`${failed} test(s) failed, ${passed} passed`);
    process.exit(1);
  }
}
