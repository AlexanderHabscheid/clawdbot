/**
 * @centris/sdk - executeTask() High-Level API
 *
 * Run a natural-language task with optional structured output.
 * Cleaner surface than do() for programmatic use.
 */

import type { TSchema } from "@sinclair/typebox";
import type { Centris } from "./index.js";
import type { CentrisResult } from "./index.js";
import { extract } from "./extract.js";

/**
 * Options for executeTask().
 */
export interface ExecuteTaskOptions {
  /** Return immediately with taskId; poll via client.wait() */
  asyncMode?: boolean;
  /** When asyncMode, wait for completion (default: true) */
  wait?: boolean;
  /** Output schema for structured extraction (uses extract internally) */
  outputSchema?: TSchema;
  /** Additional context */
  context?: Record<string, unknown>;
}

/**
 * Result of executeTask().
 */
export interface ExecuteTaskResult<T = string> {
  /** Task output: text or structured data when outputSchema provided */
  output: T;
  /** Task ID */
  taskId: string;
  /** Task status */
  status: CentrisResult["status"];
  /** Actions performed */
  actions: CentrisResult["actions"];
  /** Usage metadata if available */
  usage?: Record<string, unknown>;
}

/**
 * Execute a natural-language task. High-level API over do().
 *
 * When outputSchema is provided, uses extract() internally to return typed data.
 * Otherwise returns the raw text result.
 *
 * @example
 * ```ts
 * const centris = new Centris();
 *
 * // Simple task
 * const r = await centris.executeTask("Open Gmail and read the first email subject");
 * console.log(r.output);
 *
 * // With structured output
 * const r2 = await centris.executeTask(
 *   "Search flights from NYC to LA, return top 3 options",
 *   { outputSchema: FlightSchema }
 * );
 * console.log(r2.output.flights);
 * ```
 */
export async function executeTask(
  client: Centris,
  task: string,
  options: ExecuteTaskOptions = {},
): Promise<ExecuteTaskResult<unknown>> {
  if (options.outputSchema) {
    const extractResult = await extract(client, task, options.outputSchema, {
      asyncMode: options.asyncMode,
      wait: options.wait ?? true,
      context: options.context,
    });
    return {
      output: extractResult.data,
      taskId: extractResult.taskId,
      status: extractResult.status,
      actions: extractResult.actions,
    };
  }

  const result = await client.do(task, {
    asyncMode: options.asyncMode ?? false,
    context: options.context ?? {},
  });

  let finalResult = result;
  if (
    options.wait !== false &&
    result.taskId &&
    (result.status === "queued" || result.status === "running")
  ) {
    finalResult = await client.wait(result.taskId);
  }

  return {
    output: finalResult.text,
    taskId: finalResult.taskId,
    status: finalResult.status,
    actions: finalResult.actions,
    usage: finalResult.usage,
  };
}
