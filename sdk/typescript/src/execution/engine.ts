/**
 * @centris/sdk - Execution Engine
 *
 * Executes capabilities using the planned method with retry and fallback support.
 */

import type {
  ExecutionPlan,
  ExecutionMethod,
  ExecutionOptions,
  ExecutorContext,
  ExecutorResult,
  Executor,
} from "./types.js";
import { APIExecutor } from "./executors/api.js";
import { BrowserExecutor } from "./executors/browser.js";
import { DesktopExecutor } from "./executors/desktop.js";
import { ExecutionRouter, createExecutionRouter } from "./router.js";
import { executorError } from "./types.js";

/**
 * Execution Engine
 *
 * Executes capabilities according to execution plans, handling:
 * - Primary method execution
 * - Automatic fallbacks on failure
 * - Retries with exponential backoff
 * - Confirmation requests for sensitive actions
 */
export class ExecutionEngine {
  private router: ExecutionRouter;
  private executors: Map<ExecutionMethod, Executor>;
  private confirmationHandler?: (plan: ExecutionPlan) => Promise<boolean>;

  constructor(options?: {
    router?: ExecutionRouter;
    confirmationHandler?: (plan: ExecutionPlan) => Promise<boolean>;
  }) {
    this.router = options?.router ?? createExecutionRouter();
    this.confirmationHandler = options?.confirmationHandler;

    // Initialize executors
    this.executors = new Map();
    this.executors.set("api", new APIExecutor());
    this.executors.set("browser", new BrowserExecutor());
    this.executors.set("desktop", new DesktopExecutor());
  }

  /**
   * Execute a capability with automatic routing.
   */
  async execute(params: {
    connectorId: string;
    capabilityId: string;
    params: Record<string, unknown>;
    context: ExecutorContext;
    options?: ExecutionOptions;
  }): Promise<ExecutorResult> {
    // Create execution plan
    const plan = await this.router.planExecution({
      connectorId: params.connectorId,
      capabilityId: params.capabilityId,
      params: params.params,
      context: params.context,
    });

    // Execute according to plan
    return this.executePlan(plan, params.context, params.options);
  }

  /**
   * Execute according to an execution plan.
   */
  async executePlan(
    plan: ExecutionPlan,
    context: ExecutorContext,
    options?: ExecutionOptions,
  ): Promise<ExecutorResult> {
    // Request confirmation if needed
    if (plan.requiresConfirmation) {
      const confirmed = await this.requestConfirmation(plan);
      if (!confirmed) {
        return executorError("CANCELLED", "User declined confirmation", { retryable: false });
      }
    }

    const maxRetries = options?.retries ?? 2;
    const timeout = options?.timeout ?? 30000;
    const methodsToTry = [plan.method, ...plan.fallbackMethods];

    // Try each method
    for (const method of methodsToTry) {
      const executor = this.executors.get(method);
      if (!executor) {
        continue;
      }

      // Check if executor is available
      const available = await executor.isAvailable();
      if (!available) {
        continue;
      }

      // Try with retries
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const result = await this.executeWithTimeout(
            executor,
            plan.connectorId,
            plan.capabilityId,
            plan.params,
            context,
            timeout,
          );

          if (result.ok) {
            return result;
          }

          // Check if error is retryable
          if (!result.error.retryable) {
            break; // Move to fallback
          }

          // Exponential backoff before retry
          if (attempt < maxRetries) {
            await this.delay(Math.pow(2, attempt) * 100);
          }
        } catch (err) {
          // Unexpected error, try fallback
          console.error(`Execution failed (${method}):`, err);
          break;
        }
      }
    }

    // All methods failed
    return executorError(
      "ALL_METHODS_FAILED",
      `All execution methods failed for ${plan.connectorId}.${plan.capabilityId}`,
      { retryable: false },
    );
  }

  /**
   * Execute with timeout.
   */
  private async executeWithTimeout(
    executor: Executor,
    connectorId: string,
    capabilityId: string,
    params: Record<string, unknown>,
    context: ExecutorContext,
    timeout: number,
  ): Promise<ExecutorResult> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        resolve(
          executorError("TIMEOUT", `Execution timed out after ${timeout}ms`, { retryable: true }),
        );
      }, timeout);

      executor
        .execute(connectorId, capabilityId, params, context)
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  /**
   * Request user confirmation for sensitive actions.
   */
  private async requestConfirmation(plan: ExecutionPlan): Promise<boolean> {
    if (this.confirmationHandler) {
      return this.confirmationHandler(plan);
    }
    // Default: auto-confirm (would be overridden in UI)
    return true;
  }

  /**
   * Delay helper for retries.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Register a custom executor.
   */
  registerExecutor(method: ExecutionMethod, executor: Executor): void {
    this.executors.set(method, executor);
  }

  /**
   * Set confirmation handler.
   */
  setConfirmationHandler(handler: (plan: ExecutionPlan) => Promise<boolean>): void {
    this.confirmationHandler = handler;
  }

  /**
   * Get the router instance.
   */
  getRouter(): ExecutionRouter {
    return this.router;
  }
}

/**
 * Create an execution engine instance.
 */
export function createExecutionEngine(options?: {
  router?: ExecutionRouter;
  confirmationHandler?: (plan: ExecutionPlan) => Promise<boolean>;
}): ExecutionEngine {
  return new ExecutionEngine(options);
}
