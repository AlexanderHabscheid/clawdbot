/**
 * @centris/sdk - CLI Do Command
 *
 * Execute a natural-language command via Centris API client.
 */

import type { CLIContext, DoOptions } from "../types.js";
import { Centris } from "../../client/index.js";
import { createCliResultEnvelope, printCliResultEnvelope } from "../result-envelope.js";

export async function runDoCommand(options: DoOptions, ctx: CLIContext): Promise<void> {
  const startedAt = Date.now();
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

  try {
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
      const warnings =
        typeof finalResult.apiVersionWarning === "string" &&
        finalResult.apiVersionWarning.length > 0
          ? [finalResult.apiVersionWarning]
          : [];
      const envelope = createCliResultEnvelope({
        ok: finalResult.status === "completed",
        operation: "command.do",
        summary:
          finalResult.status === "completed"
            ? finalResult.text || "Command completed"
            : `Command ended with status: ${finalResult.status}`,
        data: finalResult,
        warnings,
        errors: finalResult.error ? [finalResult.error] : [],
        durationMs: Date.now() - startedAt,
      });
      printCliResultEnvelope(envelope);
      if (!envelope.ok) {
        process.exit(1);
      }
      return;
    }

    if (finalResult.status === "completed") {
      ctx.logger.success(finalResult.text || "Command completed");
      return;
    }

    ctx.logger.error(finalResult.error ?? `Command failed with status: ${finalResult.status}`);
    process.exit(1);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.json) {
      printCliResultEnvelope(
        createCliResultEnvelope({
          ok: false,
          operation: "command.do",
          summary: "Command execution failed",
          data: {},
          errors: [message],
          durationMs: Date.now() - startedAt,
        }),
      );
    } else {
      ctx.logger.error(message);
    }
    process.exit(1);
  }
}
