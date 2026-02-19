/**
 * @centris/sdk - CLI Program
 *
 * Main CLI entry point using Commander.js pattern.
 */

import { Command } from "commander";
import type { CLIContext, CLILogger } from "./types.js";
import { initConnector } from "./commands/init.js";
import { initManifest, validateManifestFile } from "./commands/manifest.js";
import { publishConnector } from "./commands/publish.js";
import { serveConnector } from "./commands/serve.js";
import { testConnector } from "./commands/test.js";
import { validateConnector } from "./commands/validate.js";

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
