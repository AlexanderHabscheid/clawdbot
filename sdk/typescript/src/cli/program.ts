/**
 * @centris/sdk - CLI Program
 *
 * Main CLI entry point using Commander.js pattern.
 */

import { Command } from "commander";
import type { CLIContext, CLILogger } from "./types.js";
import {
  runActActionCommand,
  runObserveActionCommand,
  runRouteRecordStartActionCommand,
  runRouteRecordStopActionCommand,
  runRouteRunActionCommand,
  runVerifyActionCommand,
} from "./commands/action-api.js";
import { runAdapterCommand } from "./commands/adapter.js";
import { runDoCommand } from "./commands/do.js";
import { initConnector } from "./commands/init.js";
import {
  doctorManifest,
  initManifest,
  publishManifest,
  validateManifestFile,
} from "./commands/manifest.js";
import { publishConnector } from "./commands/publish.js";
import { recordRoute, runRoute, testRoute } from "./commands/route.js";
import { serveConnector } from "./commands/serve.js";
import { testConnector } from "./commands/test.js";
import { validateConnector } from "./commands/validate.js";
import {
  runWebMemoryExecuteCommand,
  runWebMemoryIndexCommand,
  runWebMemoryInvalidateCommand,
  runWebMemoryResolveCommand,
  runWebMemoryStatsCommand,
} from "./commands/web-memory.js";

/**
 * Create a CLI logger with colored output.
 */
function createLogger(verbose: boolean): CLILogger {
  return {
    info: (msg) => console.log(`\x1b[36mℹ\x1b[0m ${msg}`),
    success: (msg) => console.log(`\x1b[32m✓\x1b[0m ${msg}`),
    warn: (msg) => console.warn(`\x1b[33m⚠\x1b[0m ${msg}`),
    error: (msg) => console.error(`\x1b[31m✗\x1b[0m ${msg}`),
    debug: verbose ? (msg) => console.log(`\x1b[90m⋯ ${msg}\x1b[0m`) : () => {},
  };
}

/**
 * Create the Centris CLI program.
 */
export function createCLI(): Command {
  const program = new Command();

  program
    .name("centris")
    .description("Centris SDK - Build connectors for the Centris AI platform")
    .version("1.0.0")
    .option("-v, --verbose", "Enable verbose output")
    .option("-C, --cwd <path>", "Set working directory");

  // centris connector init <id>
  program
    .command("init <id>")
    .alias("create")
    .description("Initialize a new connector project")
    .option("-n, --name <name>", "Connector display name")
    .option("-d, --description <desc>", "Connector description")
    .option("-l, --language <lang>", "Language: typescript or python", "typescript")
    .option("-t, --template <template>", "Template: basic, oauth, browser, desktop", "basic")
    .option("-y, --yes", "Skip prompts, use defaults")
    .action(async (id, options, cmd) => {
      const globalOpts = cmd.parent?.opts() ?? {};
      const ctx = createContext(globalOpts);
      await initConnector({ ...options, id }, ctx);
    });

  // centris connector validate [path]
  program
    .command("validate [path]")
    .description("Validate a connector's schema and configuration")
    .option("-s, --strict", "Enable strict validation")
    .action(async (path, options, cmd) => {
      const globalOpts = cmd.parent?.opts() ?? {};
      const ctx = createContext(globalOpts);
      await validateConnector({ ...options, path: path ?? "." }, ctx);
    });

  // centris connector test [path]
  program
    .command("test [path]")
    .description("Test a connector's capabilities")
    .option("-c, --capability <id>", "Test specific capability")
    .option("-p, --params <json>", "Test parameters as JSON")
    .option("-a, --all", "Run all tests")
    .option("-w, --watch", "Watch mode")
    .action(async (path, options, cmd) => {
      const globalOpts = cmd.parent?.opts() ?? {};
      const ctx = createContext(globalOpts);
      await testConnector({ ...options, path: path ?? "." }, ctx);
    });

  // centris connector serve [path]
  program
    .command("serve [path]")
    .alias("dev")
    .description("Start a local development server for the connector")
    .option("-p, --port <port>", "Port to serve on", "8000")
    .option("-h, --host <host>", "Host to bind to", "localhost")
    .option("-w, --watch", "Enable hot reload")
    .option("-o, --open", "Open browser")
    .action(async (path, options, cmd) => {
      const globalOpts = cmd.parent?.opts() ?? {};
      const ctx = createContext(globalOpts);
      await serveConnector(
        {
          ...options,
          path: path ?? ".",
          port: Number.parseInt(options.port, 10),
        },
        ctx,
      );
    });

  // centris connector publish [path]
  program
    .command("publish [path]")
    .description("Publish a connector to the Centris registry")
    .option("-r, --registry <url>", "Registry URL", "https://registry.centris.ai")
    .option("-k, --api-key <key>", "API key for authentication")
    .option("--dry-run", "Dry run (don't actually publish)")
    .option("-y, --yes", "Skip confirmation")
    .action(async (path, options, cmd) => {
      const globalOpts = cmd.parent?.opts() ?? {};
      const ctx = createContext(globalOpts);
      await publishConnector({ ...options, path: path ?? "." }, ctx);
    });

  // centris do <command...>
  program
    .command("do <command...>")
    .description("Execute a natural-language command via Centris API")
    .option("-k, --api-key <key>", "API key for authentication")
    .option("-u, --base-url <url>", "API base URL override")
    .option("--api-version <version>", "API version override (YYYY-MM-DD)")
    .option("--async", "Return immediately with task ID")
    .option("--wait", "Poll until async task completes")
    .option("--json", "Output raw JSON")
    .option("--timeout-ms <ms>", "Request timeout in milliseconds")
    .option("--poll-interval-ms <ms>", "Polling interval for --wait")
    .option("--context <json>", "Optional context JSON")
    .action(async (commandParts, options, cmd) => {
      const globalOpts = cmd.parent?.opts() ?? {};
      const ctx = createContext(globalOpts);
      let context: Record<string, unknown> | undefined;
      if (typeof options.context === "string" && options.context.trim().length > 0) {
        try {
          const parsed = JSON.parse(options.context) as unknown;
          if (typeof parsed === "object" && parsed !== null) {
            context = parsed as Record<string, unknown>;
          } else {
            throw new Error("context must be a JSON object");
          }
        } catch (error) {
          ctx.logger.error(`Invalid --context JSON: ${String(error)}`);
          process.exit(1);
        }
      }
      await runDoCommand(
        {
          command: Array.isArray(commandParts) ? commandParts.join(" ") : String(commandParts),
          apiKey: options.apiKey,
          baseUrl: options.baseUrl,
          apiVersion: options.apiVersion,
          asyncMode: options.async ?? false,
          wait: options.wait ?? false,
          json: options.json ?? false,
          timeoutMs:
            typeof options.timeoutMs === "string"
              ? Number.parseInt(options.timeoutMs, 10)
              : undefined,
          pollIntervalMs:
            typeof options.pollIntervalMs === "string"
              ? Number.parseInt(options.pollIntervalMs, 10)
              : undefined,
          context,
        },
        ctx,
      );
    });

  program
    .command("observe")
    .description("Observe runtime context via Action API")
    .option("--url <url>", "Optional URL hint")
    .option("--instruction <text>", "Optional instruction hint")
    .option("-k, --api-key <key>", "API key for authentication")
    .option("-u, --base-url <url>", "API base URL override")
    .option("--api-version <version>", "API version override (YYYY-MM-DD)")
    .option("--timeout-ms <ms>", "Request timeout in milliseconds")
    .option("--json", "Output raw JSON")
    .action(async (options, cmd) => {
      const globalOpts = cmd.parent?.opts() ?? {};
      const ctx = createContext(globalOpts);
      await runObserveActionCommand(
        {
          ...options,
          timeoutMs:
            typeof options.timeoutMs === "string"
              ? Number.parseInt(options.timeoutMs, 10)
              : undefined,
        },
        ctx,
      );
    });

  program
    .command("act")
    .description("Execute a runtime action via Action API")
    .requiredOption("--kind <kind>", "Action kind: navigate|click|type|press|wait|scroll")
    .option("--node-id <id>", "Preferred nodeId target from observe() for click/type actions")
    .option("--target <target>", "Action target")
    .option("--value <value>", "Action value")
    .option("--amount <amount>", "Numeric amount for wait/scroll")
    .option("-k, --api-key <key>", "API key for authentication")
    .option("-u, --base-url <url>", "API base URL override")
    .option("--api-version <version>", "API version override (YYYY-MM-DD)")
    .option("--timeout-ms <ms>", "Request timeout in milliseconds")
    .option("--json", "Output raw JSON")
    .action(async (options, cmd) => {
      const globalOpts = cmd.parent?.opts() ?? {};
      const ctx = createContext(globalOpts);
      await runActActionCommand(
        {
          ...options,
          nodeId:
            typeof options.nodeId === "string" ? Number.parseInt(options.nodeId, 10) : undefined,
          amount:
            typeof options.amount === "string" ? Number.parseInt(options.amount, 10) : undefined,
          timeoutMs:
            typeof options.timeoutMs === "string"
              ? Number.parseInt(options.timeoutMs, 10)
              : undefined,
        },
        ctx,
      );
    });

  program
    .command("verify")
    .description("Run success checks via Action API")
    .requiredOption("--checks <json>", "Success checks JSON array")
    .option("-k, --api-key <key>", "API key for authentication")
    .option("-u, --base-url <url>", "API base URL override")
    .option("--api-version <version>", "API version override (YYYY-MM-DD)")
    .option("--timeout-ms <ms>", "Request timeout in milliseconds")
    .option("--json", "Output raw JSON")
    .action(async (options, cmd) => {
      const globalOpts = cmd.parent?.opts() ?? {};
      const ctx = createContext(globalOpts);
      await runVerifyActionCommand(
        {
          ...options,
          timeoutMs:
            typeof options.timeoutMs === "string"
              ? Number.parseInt(options.timeoutMs, 10)
              : undefined,
        },
        ctx,
      );
    });

  // centris manifest <subcommand>
  const manifest = program
    .command("manifest")
    .description("Manage site layout manifests for browser automation");

  // centris manifest init <app>
  manifest
    .command("init <app>")
    .description("Create a starter centris.json manifest")
    .option("-o, --out <path>", "Output file path (default: connectors/<app>/centris.json)")
    .option(
      "-u, --url-pattern <pattern>",
      "URL pattern to include (repeatable, e.g. --url-pattern app.example.com/*)",
      (value: string, previous: string[]) => [...previous, value],
      [],
    )
    .option("-d, --description <text>", "Manifest description")
    .option("-f, --force", "Overwrite existing file")
    .action(async (app, options, cmd) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const ctx = createContext(globalOpts);
      await initManifest(
        {
          ...options,
          app,
          urlPatterns:
            Array.isArray(options.urlPattern) && options.urlPattern.length > 0
              ? (options.urlPattern as string[])
              : undefined,
        },
        ctx,
      );
    });

  // centris manifest validate [file]
  manifest
    .command("validate [file]")
    .description("Validate a centris site manifest")
    .option("-s, --strict", "Require at least one route with landmarks/actions")
    .action(async (file, options, cmd) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const ctx = createContext(globalOpts);
      await validateManifestFile({ ...options, file: file ?? "centris.json" }, ctx);
    });

  // centris manifest doctor [file]
  manifest
    .command("doctor [file]")
    .description("Run readiness diagnostics for external manifest publishing")
    .option("-s, --strict", "Fail when warnings are present")
    .option("--json", "Output raw JSON report")
    .action(async (file, options, cmd) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const ctx = createContext(globalOpts);
      await doctorManifest({ ...options, file: file ?? "centris.json" }, ctx);
    });

  // centris manifest publish [file]
  manifest
    .command("publish [file]")
    .description("Publish manifest artifacts for external ecosystem distribution")
    .option("--well-known-out <path>", "Output path for .well-known manifest")
    .option("--connector-out-dir <path>", "Optional connector package output directory")
    .option("-f, --force", "Overwrite output files")
    .option("--dry-run", "Print publish plan without writing files")
    .option("--json", "Output raw JSON report")
    .action(async (file, options, cmd) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const ctx = createContext(globalOpts);
      await publishManifest({ ...options, file: file ?? "centris.json" }, ctx);
    });

  // centris route <subcommand>
  const route = program.command("route").description("Record, run, and test deterministic routes");

  route
    .command("record")
    .description("Record/update a route action in a manifest")
    .requiredOption("--app <app>", "App id (manifest app)")
    .requiredOption("--action <name>", "Action name")
    .requiredOption("--description <text>", "Action description")
    .requiredOption("--url-pattern <pattern>", "Top-level URL pattern (e.g. app.example.com/*)")
    .requiredOption("--route-pattern <pattern>", "Route key (e.g. /settings/billing)")
    .requiredOption("--steps <json>", "Route steps JSON array")
    .option("--params <json>", "Optional JSON array of param names")
    .option("--checks <json>", "Optional success checks JSON array")
    .option("--fallback-chains <json>", "Optional selector fallback chains JSON array")
    .option("--confidence <num>", "Confidence between 0 and 1")
    .option("--out <path>", "Manifest path")
    .action(async (options, cmd) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const ctx = createContext(globalOpts);
      await recordRoute(
        {
          ...options,
          confidence:
            typeof options.confidence === "string"
              ? Number.parseFloat(options.confidence)
              : undefined,
        },
        ctx,
      );
    });

  route
    .command("run")
    .description("Resolve and run a route action")
    .requiredOption("--action <name>", "Action name")
    .requiredOption("--url <url>", "Target URL")
    .option("--params <json>", "Route parameter values JSON object")
    .option("--manifest <path>", "Manifest path (default: ./centris.json)")
    .option("-k, --api-key <key>", "API key for runtime execution")
    .option("-u, --base-url <url>", "API base URL override")
    .option("--api-version <version>", "API version override (YYYY-MM-DD)")
    .option("--timeout-ms <ms>", "Runtime request timeout in milliseconds")
    .option("--playwright", "Execute using Playwright harness")
    .option("--headful", "Run browser in headed mode (when using Playwright)")
    .option("--slow-mo <ms>", "Playwright slowMo")
    .action(async (options, cmd) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const ctx = createContext(globalOpts);
      await runRoute(
        {
          ...options,
          slowMo:
            typeof options.slowMo === "string" ? Number.parseInt(options.slowMo, 10) : undefined,
          timeoutMs:
            typeof options.timeoutMs === "string"
              ? Number.parseInt(options.timeoutMs, 10)
              : undefined,
        },
        ctx,
      );
    });

  route
    .command("test")
    .description("Run route execution + verification checks")
    .requiredOption("--action <name>", "Action name")
    .requiredOption("--url <url>", "Target URL")
    .option("--params <json>", "Route parameter values JSON object")
    .option("--manifest <path>", "Manifest path (default: ./centris.json)")
    .option("--playwright", "Execute using Playwright harness")
    .option("--headful", "Run browser in headed mode")
    .option("--slow-mo <ms>", "Playwright slowMo")
    .action(async (options, cmd) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const ctx = createContext(globalOpts);
      await testRoute(
        {
          ...options,
          slowMo:
            typeof options.slowMo === "string" ? Number.parseInt(options.slowMo, 10) : undefined,
        },
        ctx,
      );
    });

  route
    .command("run-runtime")
    .description("Run a runtime route via Action API")
    .requiredOption("--route-id <id>", "Route id")
    .option("--url <url>", "Optional URL hint")
    .option("--params <json>", "Route params JSON object")
    .option("--checks <json>", "Success checks JSON array")
    .option("--artifacts <json>", "Input artifacts JSON array")
    .option("-k, --api-key <key>", "API key for authentication")
    .option("-u, --base-url <url>", "API base URL override")
    .option("--api-version <version>", "API version override (YYYY-MM-DD)")
    .option("--timeout-ms <ms>", "Request timeout in milliseconds")
    .option("--json", "Output raw JSON")
    .action(async (options, cmd) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const ctx = createContext(globalOpts);
      await runRouteRunActionCommand(
        {
          ...options,
          timeoutMs:
            typeof options.timeoutMs === "string"
              ? Number.parseInt(options.timeoutMs, 10)
              : undefined,
        },
        ctx,
      );
    });

  route
    .command("record-start")
    .description("Start runtime route recording via Action API")
    .requiredOption("--intent <intent>", "Recording intent label")
    .option("--url <url>", "Optional URL hint")
    .option("--params <json>", "Intent params JSON object")
    .option("--metadata <json>", "Recording metadata JSON object")
    .option("-k, --api-key <key>", "API key for authentication")
    .option("-u, --base-url <url>", "API base URL override")
    .option("--api-version <version>", "API version override (YYYY-MM-DD)")
    .option("--timeout-ms <ms>", "Request timeout in milliseconds")
    .option("--json", "Output raw JSON")
    .action(async (options, cmd) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const ctx = createContext(globalOpts);
      await runRouteRecordStartActionCommand(
        {
          ...options,
          timeoutMs:
            typeof options.timeoutMs === "string"
              ? Number.parseInt(options.timeoutMs, 10)
              : undefined,
        },
        ctx,
      );
    });

  route
    .command("record-stop")
    .description("Stop runtime route recording via Action API")
    .requiredOption("--session-id <id>", "Recording session id")
    .option("--outcome <outcome>", "Recording outcome: success|failed|cancelled")
    .option("--metadata <json>", "Recording metadata JSON object")
    .option("-k, --api-key <key>", "API key for authentication")
    .option("-u, --base-url <url>", "API base URL override")
    .option("--api-version <version>", "API version override (YYYY-MM-DD)")
    .option("--timeout-ms <ms>", "Request timeout in milliseconds")
    .option("--json", "Output raw JSON")
    .action(async (options, cmd) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const ctx = createContext(globalOpts);
      await runRouteRecordStopActionCommand(
        {
          ...options,
          timeoutMs:
            typeof options.timeoutMs === "string"
              ? Number.parseInt(options.timeoutMs, 10)
              : undefined,
        },
        ctx,
      );
    });

  const webMemory = program
    .command("web-memory")
    .description("Manage cached web playbooks for deterministic browser execution");

  webMemory
    .command("index")
    .description("Index or update a cached web playbook")
    .requiredOption("--url <url>", "Target URL")
    .option("--intent <intent>", "Intent label for this playbook")
    .option("--playbook <json>", "Playbook JSON object")
    .option("--snapshot-file <path>", "Snapshot JSON file to derive fingerprint/action index")
    .option("--fingerprint-id <id>", "Optional fingerprint id when deriving from snapshot")
    .option("--ttl-ms <ms>", "Cache TTL in milliseconds")
    .option("--metadata <json>", "Metadata JSON object")
    .option("-k, --api-key <key>", "API key for authentication")
    .option("-u, --base-url <url>", "API base URL override")
    .option("--api-version <version>", "API version override (YYYY-MM-DD)")
    .option("--timeout-ms <ms>", "Request timeout in milliseconds")
    .option("--json", "Output raw JSON")
    .action(async (options, cmd) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const ctx = createContext(globalOpts);
      await runWebMemoryIndexCommand(
        {
          ...options,
          ttlMs: typeof options.ttlMs === "string" ? Number.parseInt(options.ttlMs, 10) : undefined,
          timeoutMs:
            typeof options.timeoutMs === "string"
              ? Number.parseInt(options.timeoutMs, 10)
              : undefined,
        },
        ctx,
      );
    });

  webMemory
    .command("resolve")
    .description("Resolve cached web memory for a URL and intent")
    .requiredOption("--url <url>", "Target URL")
    .option("--intent <intent>", "Intent label")
    .option("--max-age-ms <ms>", "Maximum acceptable cache age in milliseconds")
    .option("-k, --api-key <key>", "API key for authentication")
    .option("-u, --base-url <url>", "API base URL override")
    .option("--api-version <version>", "API version override (YYYY-MM-DD)")
    .option("--timeout-ms <ms>", "Request timeout in milliseconds")
    .option("--json", "Output raw JSON")
    .action(async (options, cmd) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const ctx = createContext(globalOpts);
      await runWebMemoryResolveCommand(
        {
          ...options,
          maxAgeMs:
            typeof options.maxAgeMs === "string"
              ? Number.parseInt(options.maxAgeMs, 10)
              : undefined,
          timeoutMs:
            typeof options.timeoutMs === "string"
              ? Number.parseInt(options.timeoutMs, 10)
              : undefined,
        },
        ctx,
      );
    });

  webMemory
    .command("execute")
    .description("Execute using cached web memory playbooks")
    .requiredOption("--url <url>", "Target URL")
    .option("--intent <intent>", "Intent label")
    .option("--operation <name>", "Operation name in the playbook")
    .option("--params <json>", "Operation params JSON object")
    .option("-k, --api-key <key>", "API key for authentication")
    .option("-u, --base-url <url>", "API base URL override")
    .option("--api-version <version>", "API version override (YYYY-MM-DD)")
    .option("--timeout-ms <ms>", "Request timeout in milliseconds")
    .option("--json", "Output raw JSON")
    .action(async (options, cmd) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const ctx = createContext(globalOpts);
      await runWebMemoryExecuteCommand(
        {
          ...options,
          timeoutMs:
            typeof options.timeoutMs === "string"
              ? Number.parseInt(options.timeoutMs, 10)
              : undefined,
        },
        ctx,
      );
    });

  webMemory
    .command("invalidate")
    .description("Invalidate cached web memory entries (destructive)")
    .option("--url <url>", "Target URL")
    .option("--playbook-id <id>", "Specific playbook ID")
    .option("--scope <scope>", "Scope: url|domain|all")
    .option("--reason <text>", "Reason for invalidation")
    .option("--yes", "Confirm destructive invalidation")
    .option("-k, --api-key <key>", "API key for authentication")
    .option("-u, --base-url <url>", "API base URL override")
    .option("--api-version <version>", "API version override (YYYY-MM-DD)")
    .option("--timeout-ms <ms>", "Request timeout in milliseconds")
    .option("--json", "Output raw JSON")
    .action(async (options, cmd) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const ctx = createContext(globalOpts);
      await runWebMemoryInvalidateCommand(
        {
          ...options,
          timeoutMs:
            typeof options.timeoutMs === "string"
              ? Number.parseInt(options.timeoutMs, 10)
              : undefined,
        },
        ctx,
      );
    });

  webMemory
    .command("stats")
    .description("Show web memory cache stats")
    .option("--url <url>", "Scope stats to a URL")
    .option("--window <window>", "Window: 1h|24h|7d|30d")
    .option("-k, --api-key <key>", "API key for authentication")
    .option("-u, --base-url <url>", "API base URL override")
    .option("--api-version <version>", "API version override (YYYY-MM-DD)")
    .option("--timeout-ms <ms>", "Request timeout in milliseconds")
    .option("--json", "Output raw JSON")
    .action(async (options, cmd) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const ctx = createContext(globalOpts);
      await runWebMemoryStatsCommand(
        {
          ...options,
          timeoutMs:
            typeof options.timeoutMs === "string"
              ? Number.parseInt(options.timeoutMs, 10)
              : undefined,
        },
        ctx,
      );
    });

  const adapter = program
    .command("adapter")
    .description("Run external-system adapter operations with safety enforcement");

  adapter
    .command("run")
    .description("Execute one adapter operation")
    .requiredOption("--adapter <json>", "Adapter spec JSON")
    .requiredOption("--operation <name>", "Adapter operation name")
    .option("--input <json>", "Operation input JSON object")
    .option("--timeout-ms <ms>", "Operation timeout in milliseconds")
    .option("--dry-run", "Validate and return without executing")
    .option("--allow-external", "Allow operations mapped to safety=external")
    .option("--allow-destructive", "Allow operations mapped to safety=destructive")
    .option("--command <cmd>", "Subprocess command (for subprocess transport)")
    .option("--args <json>", "Subprocess args JSON array")
    .option("--cwd <path>", "Subprocess working directory")
    .option("--env <json>", "Subprocess env overrides JSON object")
    .option("--url <url>", "HTTP endpoint (for http transport)")
    .option("--method <method>", "HTTP method: POST|PUT|PATCH")
    .option("--headers <json>", "HTTP headers JSON object")
    .option("--module <path>", "Module path (for sdk transport)")
    .option("--export-name <name>", "Exported function name (for sdk transport)")
    .option("--json", "Output structured JSON envelope")
    .action(async (options, cmd) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const ctx = createContext(globalOpts);
      await runAdapterCommand(
        {
          ...options,
          timeoutMs:
            typeof options.timeoutMs === "string"
              ? Number.parseInt(options.timeoutMs, 10)
              : undefined,
        },
        ctx,
      );
    });

  return program;
}

/**
 * Create CLI context from global options.
 */
function createContext(opts: { verbose?: boolean; cwd?: string }): CLIContext {
  return {
    cwd: opts.cwd ?? process.cwd(),
    verbose: opts.verbose ?? false,
    logger: createLogger(opts.verbose ?? false),
  };
}

/**
 * Run the CLI with process arguments.
 */
export async function runCLI(args: string[] = process.argv): Promise<void> {
  const program = createCLI();
  await program.parseAsync(args);
}
