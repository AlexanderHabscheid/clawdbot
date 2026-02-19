/**
 * @centris/sdk - Execution Router
 *
 * Routes capability execution to the optimal method based on
 * availability, reliability, and user preferences.
 */

import type { ExecutionPlan, ExecutionMethod, ExecutionOptions, ExecutorContext } from "./types.js";

/**
 * Capability metadata for routing decisions.
 */
interface CapabilityMetadata {
  executionMethods: ExecutionMethod[];
  requiresConfirmation?: boolean;
  latencyEstimates?: Partial<Record<ExecutionMethod, number>>;
}

/**
 * Execution Router
 *
 * Selects the best execution method for a capability based on:
 * - Available methods for the capability
 * - User preferences
 * - Authentication availability
 * - Historical success rates
 */
export class ExecutionRouter {
  private preferences: ExecutionOptions["preferences"];
  private capabilityCache: Map<string, CapabilityMetadata> = new Map();

  constructor(options?: { preferences?: ExecutionOptions["preferences"] }) {
    this.preferences = options?.preferences;
  }

  /**
   * Create an execution plan for a capability.
   */
  async planExecution(params: {
    connectorId: string;
    capabilityId: string;
    params: Record<string, unknown>;
    context: ExecutorContext;
    metadata?: CapabilityMetadata;
  }): Promise<ExecutionPlan> {
    const { connectorId, capabilityId, context } = params;
    const metadata = params.metadata ?? this.getCapabilityMetadata(connectorId, capabilityId);

    const availableMethods =
      metadata.executionMethods.length > 0
        ? metadata.executionMethods
        : (["api"] as ExecutionMethod[]);

    // Select best method
    const bestMethod = this.selectBestMethod(availableMethods, context);
    const fallbacks = availableMethods.filter((m) => m !== bestMethod);

    return {
      method: bestMethod,
      connectorId,
      capabilityId,
      params: params.params,
      fallbackMethods: fallbacks,
      estimatedLatencyMs: this.estimateLatency(bestMethod, metadata),
      requiresConfirmation: metadata.requiresConfirmation ?? false,
    };
  }

  /**
   * Select the best execution method.
   */
  private selectBestMethod(
    available: ExecutionMethod[],
    context: ExecutorContext,
  ): ExecutionMethod {
    // Priority: API > Desktop > Browser
    const priorities: Record<ExecutionMethod, number> = {
      api: 3,
      desktop: 2,
      browser: 1,
    };

    // Check user preference
    const preferred = this.preferences?.preferredMethod;
    if (preferred && available.includes(preferred)) {
      // Check if preference is allowed
      if (preferred === "browser" && this.preferences?.allowBrowserAutomation === false) {
        // Skip browser if not allowed
      } else if (preferred === "desktop" && this.preferences?.allowDesktopAutomation === false) {
        // Skip desktop if not allowed
      } else {
        return preferred;
      }
    }

    // Check if API auth is available
    if (available.includes("api") && context.auth?.accessToken) {
      return "api";
    }

    // Filter by what's allowed
    let allowed = available;
    if (this.preferences?.allowBrowserAutomation === false) {
      allowed = allowed.filter((m) => m !== "browser");
    }
    if (this.preferences?.allowDesktopAutomation === false) {
      allowed = allowed.filter((m) => m !== "desktop");
    }

    // If nothing left, fall back to any available
    if (allowed.length === 0) {
      allowed = available;
    }

    // Sort by priority and return best
    return allowed.toSorted((a, b) => (priorities[b] ?? 0) - (priorities[a] ?? 0))[0] ?? "api";
  }

  /**
   * Estimate execution latency.
   */
  private estimateLatency(method: ExecutionMethod, metadata: CapabilityMetadata): number {
    // Check capability-specific estimates
    if (metadata.latencyEstimates?.[method]) {
      return metadata.latencyEstimates[method];
    }

    // Default estimates
    const defaults: Record<ExecutionMethod, number> = {
      api: 200,
      desktop: 500,
      browser: 2000,
    };

    return defaults[method] ?? 1000;
  }

  /**
   * Get capability metadata (would normally come from registry).
   */
  private getCapabilityMetadata(connectorId: string, capabilityId: string): CapabilityMetadata {
    const key = `${connectorId}.${capabilityId}`;
    const cached = this.capabilityCache.get(key);
    if (cached) {
      return cached;
    }

    // Default metadata
    return {
      executionMethods: ["api"],
      requiresConfirmation: false,
    };
  }

  /**
   * Register capability metadata for better routing decisions.
   */
  registerCapability(
    connectorId: string,
    capabilityId: string,
    metadata: CapabilityMetadata,
  ): void {
    const key = `${connectorId}.${capabilityId}`;
    this.capabilityCache.set(key, metadata);
  }

  /**
   * Update user preferences.
   */
  setPreferences(preferences: ExecutionOptions["preferences"]): void {
    this.preferences = preferences;
  }
}

/**
 * Create an execution router instance.
 */
export function createExecutionRouter(options?: {
  preferences?: ExecutionOptions["preferences"];
}): ExecutionRouter {
  return new ExecutionRouter(options);
}
