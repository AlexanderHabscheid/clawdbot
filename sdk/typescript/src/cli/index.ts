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
export { runDoCommand } from "./commands/do.js";
export {
  runObserveActionCommand,
  runActActionCommand,
  runVerifyActionCommand,
  runRouteRunActionCommand,
  runRouteRecordStartActionCommand,
  runRouteRecordStopActionCommand,
} from "./commands/action-api.js";
export { initManifest, validateManifestFile } from "./commands/manifest.js";
export { recordRoute, runRoute, testRoute } from "./commands/route.js";
export type {
  CLIOptions,
  InitOptions,
  TestOptions,
  ServeOptions,
  PublishOptions,
  DoOptions,
  ObserveOptions,
  ActOptions,
  VerifyOptions,
  RouteRunApiOptions,
  RouteRecordStartApiOptions,
  RouteRecordStopApiOptions,
  ManifestInitOptions,
  ManifestValidateOptions,
  RouteRecordOptions,
  RouteRunOptions,
  RouteTestOptions,
} from "./types.js";
