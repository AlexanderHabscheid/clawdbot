/**
 * @centris/sdk - Execution Types
 */

/**
 * Execution methods available for capabilities.
 */
export type ExecutionMethod = "api" | "browser" | "desktop";

/**
 * Execution plan for a capability.
 */
export interface ExecutionPlan {
  /** Primary execution method */
  method: ExecutionMethod;
  /** Connector ID */
  connectorId: string;
  /** Capability/tool ID */
  capabilityId: string;
  /** Execution parameters */
  params: Record<string, unknown>;
  /** Fallback methods if primary fails */
  fallbackMethods: ExecutionMethod[];
  /** Estimated latency in ms */
  estimatedLatencyMs: number;
  /** Whether confirmation is required */
  requiresConfirmation: boolean;
}

/**
 * Options for execution.
 */
export interface ExecutionOptions {
  /** User preferences */
  preferences?: {
    preferredMethod?: ExecutionMethod;
    allowBrowserAutomation?: boolean;
    allowDesktopAutomation?: boolean;
  };
  /** Authentication context */
  auth?: {
    accessToken?: string;
    refreshToken?: string;
    apiKey?: string;
  };
  /** Timeout in ms */
  timeout?: number;
  /** Enable retries */
  retries?: number;
}

/**
 * Context passed to executors.
 */
export interface ExecutorContext {
  /** User ID */
  userId?: string;
  /** Session ID */
  sessionId?: string;
  /** Authentication tokens */
  auth?: {
    accessToken?: string;
    refreshToken?: string;
    apiKey?: string;
  };
  /** Connector endpoint URL (for remote connectors) */
  endpointUrl?: string;
  /** UI mappings for browser/desktop automation */
  uiMappings?: UIMapping[];
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * UI element mapping for browser/desktop automation.
 *
 * Supports both CSS selectors (for pre-mapped connectors) and nodeIds
 * (for runtime snapshot-based targeting via the Centris extension).
 */
export interface UIMapping {
  /** CSS selector or accessibility identifier */
  selector: string;
  /** Numeric node ID from extension snapshot (preferred when available) */
  nodeId?: number;
  /** Semantic role (e.g., "send_button") */
  semanticRole: string;
  /** Action type (e.g., "click", "type", "navigate", "press_key") */
  action: string;
  /** Additional context (capability IDs, key names for press_key, etc.) */
  context?: string[];
}

/**
 * Error information for failed execution.
 */
export interface ExecutorError {
  /** Error code for categorization */
  code: string;
  /** Human-readable error message */
  message: string;
  /** Additional error details */
  details?: unknown;
  /** Whether the error is retryable */
  retryable?: boolean;
}

/**
 * Execution metadata.
 */
export interface ExecutorMetadata {
  /** Method used for execution */
  executionMethod: ExecutionMethod;
  /** Total latency in milliseconds */
  latencyMs: number;
  /** Number of retries attempted */
  retryCount?: number;
}

/**
 * Result from an executor - uses discriminated union for type safety.
 *
 * Pattern inspired by clawdbot's error handling:
 * - Success: { ok: true, data: T }
 * - Failure: { ok: false, error: ExecutorError }
 *
 * This ensures TypeScript can narrow the type correctly:
 * ```typescript
 * if (result.ok) {
 *   // result.data is available, result.error is undefined
 * } else {
 *   // result.error is available, result.data is undefined
 * }
 * ```
 */
export type ExecutorResult<T = unknown> =
  | { ok: true; data: T; metadata?: ExecutorMetadata }
  | { ok: false; error: ExecutorError; metadata?: ExecutorMetadata };

/**
 * Helper to create a successful result.
 */
export function executorSuccess<T>(data: T, metadata?: ExecutorMetadata): ExecutorResult<T> {
  return { ok: true, data, metadata };
}

/**
 * Helper to create an error result.
 */
export function executorError(
  code: string,
  message: string,
  options?: { details?: unknown; retryable?: boolean; metadata?: ExecutorMetadata },
): ExecutorResult<never> {
  return {
    ok: false,
    error: {
      code,
      message,
      details: options?.details,
      retryable: options?.retryable ?? false,
    },
    metadata: options?.metadata,
  };
}

/**
 * @deprecated Use ExecutorResult<T> with ok/error pattern instead.
 * Legacy interface for backwards compatibility.
 */
export interface LegacyExecutorResult {
  /** Whether execution succeeded */
  success: boolean;
  /** Result data */
  data?: unknown;
  /** Error information */
  error?: ExecutorError;
  /** Execution metadata */
  metadata?: ExecutorMetadata;
}

/**
 * Base executor interface.
 */
export interface Executor {
  /** Executor type */
  type: ExecutionMethod;
  /** Execute a capability */
  execute(
    connectorId: string,
    capabilityId: string,
    params: Record<string, unknown>,
    context: ExecutorContext,
  ): Promise<ExecutorResult>;
  /** Check if executor is available */
  isAvailable(): Promise<boolean>;
}
