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
export { runAdapterCommand } from "./commands/adapter.js";
export {
  runDesktopSnapshotCommand,
  runDesktopFindCommand,
  runDesktopClickCommand,
  runDesktopTypeCommand,
  runDesktopAppsCommand,
  runDesktopWindowsCommand,
} from "./commands/desktop.js";
export {
  runObserveActionCommand,
  runActActionCommand,
  runVerifyActionCommand,
  runRouteRunActionCommand,
  runRouteRecordStartActionCommand,
  runRouteRecordStopActionCommand,
} from "./commands/action-api.js";
export {
  runWebMemoryIndexCommand,
  runWebMemoryResolveCommand,
  runWebMemoryExecuteCommand,
  runWebMemoryInvalidateCommand,
  runWebMemoryStatsCommand,
} from "./commands/web-memory.js";
export { initManifest, validateManifestFile } from "./commands/manifest.js";
export { recordRoute, runRoute, testRoute } from "./commands/route.js";
export {
  createCliResultEnvelope,
  printCliResultEnvelope,
  type CliResultEnvelope,
  type CliArtifact,
  type SafetyLevel,
} from "./result-envelope.js";
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
  DesktopSnapshotOptions,
  DesktopFindOptions,
  DesktopClickOptions,
  DesktopTypeOptions,
  DesktopAppsOptions,
  DesktopWindowsOptions,
  RouteRunApiOptions,
  RouteRecordStartApiOptions,
  RouteRecordStopApiOptions,
  WebMemoryIndexOptions,
  WebMemoryResolveOptions,
  WebMemoryExecuteOptions,
  WebMemoryInvalidateOptions,
  WebMemoryStatsOptions,
  ManifestInitOptions,
  ManifestValidateOptions,
  RouteRecordOptions,
  RouteRunOptions,
  RouteTestOptions,
  AdapterRunOptions,
} from "./types.js";
