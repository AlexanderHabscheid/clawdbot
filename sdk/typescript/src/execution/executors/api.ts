/**
 * @centris/sdk - API Executor
 *
 * Executes capabilities via direct API calls.
 */

import type { Executor, ExecutorContext, ExecutorResult } from "../types.js";
import { executorSuccess, executorError } from "../types.js";

/**
 * API Executor
 *
 * Executes capabilities by making HTTP requests to connector endpoints.
 */
export class APIExecutor implements Executor {
  readonly type = "api" as const;

  /**
   * Execute a capability via API.
   */
  async execute(
    connectorId: string,
    capabilityId: string,
    params: Record<string, unknown>,
    context: ExecutorContext,
  ): Promise<ExecutorResult> {
    const startTime = Date.now();

    try {
      // Get endpoint URL from context
      const endpointUrl = context.endpointUrl;
      if (!endpointUrl) {
        return executorError(
          "NO_ENDPOINT",
          `No endpoint URL provided for connector ${connectorId}`,
          {
            retryable: false,
            metadata: { executionMethod: "api", latencyMs: Date.now() - startTime },
          },
        );
      }

      // Build request headers
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (context.auth?.accessToken) {
        headers["Authorization"] = `Bearer ${context.auth.accessToken}`;
      } else if (context.auth?.apiKey) {
        headers["X-API-Key"] = context.auth.apiKey;
      }

      if (context.userId) {
        headers["X-User-Id"] = context.userId;
      }
      if (context.sessionId) {
        headers["X-Session-Id"] = context.sessionId;
      }

      // Make the request
      const response = await fetch(`${endpointUrl}/execute`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          capability: capabilityId,
          params,
          context: {
            userId: context.userId,
            sessionId: context.sessionId,
            metadata: context.metadata,
          },
        }),
      });

      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        return executorError(`HTTP_${response.status}`, errorText || response.statusText, {
          retryable: response.status >= 500,
          metadata: { executionMethod: "api", latencyMs },
        });
      }

      const result = (await response.json()) as Record<string, unknown>;

      return executorSuccess(result.data ?? result.result ?? result, {
        executionMethod: "api",
        latencyMs,
      });
    } catch (err) {
      const latencyMs = Date.now() - startTime;

      return executorError("API_ERROR", String(err), {
        retryable: true,
        metadata: { executionMethod: "api", latencyMs },
      });
    }
  }

  /**
   * API executor is always available.
   */
  async isAvailable(): Promise<boolean> {
    return true;
  }
}
