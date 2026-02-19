/**
 * @centris/sdk - CLI Do Command
 *
 * Execute a natural-language command via Centris API client.
 */

import type { CLIContext, DoOptions } from "../types.js";
import { Centris } from "../../client/index.js";

export async function runDoCommand(options: DoOptions, ctx: CLIContext): Promise<void> {
  const command = options.command.trim();
  if (!command) {
    ctx.logger.error("Command text is required");
    process.exit(1);
  }

  const client = new Centris({
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    apiVersion: options.apiVersion,
    timeoutMs: options.timeoutMs,
  });

  const result = await client.do(command, {
    asyncMode: options.asyncMode,
    context: options.context,
  });

  let finalResult = result;
  if (
    options.wait &&
    result.taskId &&
    (result.status === "queued" || result.status === "running")
  ) {
    finalResult = await client.wait(result.taskId, {
      pollIntervalMs: options.pollIntervalMs,
      timeoutMs: options.timeoutMs,
    });
  }

  if (options.json) {
    console.log(JSON.stringify(finalResult, null, 2));
    return;
  }

  if (finalResult.status === "completed") {
    ctx.logger.success(finalResult.text || "Command completed");
    return;
  }

  ctx.logger.error(finalResult.error ?? `Command failed with status: ${finalResult.status}`);
  process.exit(1);
}
