/**
 * @centris/sdk - CLI Module
 *
 * Command-line tools for connector development.
 * Provides init, validate, test, serve, and publish commands.
 */

export { createCLI, runCLI } from "./program.js";
export { initConnector } from "./commands/init.js";
export { validateConnector } from "./commands/validate.js";
export { testConnector } from "./commands/test.js";
export { serveConnector } from "./commands/serve.js";
export { publishConnector } from "./commands/publish.js";
export type {
  CLIOptions,
  InitOptions,
  TestOptions,
  ServeOptions,
  PublishOptions,
} from "./types.js";
