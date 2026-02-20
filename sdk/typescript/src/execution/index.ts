/**
 * @centris/sdk - Execution Engine Module
 *
 * Routes capability execution to the optimal method (API, Browser, Desktop).
 */

export { ExecutionEngine, createExecutionEngine } from "./engine.js";
export { ExecutionRouter, createExecutionRouter } from "./router.js";
export { APIExecutor } from "./executors/api.js";
export { BrowserExecutor } from "./executors/browser.js";
export { DesktopExecutor } from "./executors/desktop.js";
export { AdapterRuntime, createAdapterRuntime } from "./adapter-runtime.js";
export type {
  ExecutionPlan,
  ExecutionMethod,
  ExecutionOptions,
  ExecutorContext,
  ExecutorResult,
  ExecutorError,
  ExecutorMetadata,
  UIMapping,
} from "./types.js";

// Helper functions for creating results (inspired by clawdbot patterns)
export { executorSuccess, executorError } from "./types.js";
