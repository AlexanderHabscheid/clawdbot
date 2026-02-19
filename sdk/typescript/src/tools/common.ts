/**
 * @centris/sdk - Tool Utilities
 *
 * Common utilities for building connector tools.
 * Pattern inspired by Clawdbot's tools/common.ts.
 */

import type { ToolResult } from "../schema/typebox.js";

// =============================================================================
// Parameter Reading Utilities
// =============================================================================

/**
 * Options for reading string parameters.
 */
export interface StringParamOptions {
  /** Whether the parameter is required */
  required?: boolean;
  /** Whether to trim whitespace */
  trim?: boolean;
  /** Label for error messages */
  label?: string;
  /** Allow empty strings */
  allowEmpty?: boolean;
}

/**
 * Read a string parameter from params object.
 */
export function readStringParam(
  params: Record<string, unknown>,
  key: string,
  options: StringParamOptions & { required: true },
): string;
export function readStringParam(
  params: Record<string, unknown>,
  key: string,
  options?: StringParamOptions,
): string | undefined;
export function readStringParam(
  params: Record<string, unknown>,
  key: string,
  options: StringParamOptions = {},
): string | undefined {
  const { required = false, trim = true, label = key, allowEmpty = false } = options;

  const raw = params[key];
  if (typeof raw !== "string") {
    if (required) {
      throw new Error(`${label} is required`);
    }
    return undefined;
  }

  const value = trim ? raw.trim() : raw;
  if (!value && !allowEmpty) {
    if (required) {
      throw new Error(`${label} is required`);
    }
    return undefined;
  }

  return value;
}

/**
 * Read a string or number parameter (converts number to string).
 */
export function readStringOrNumberParam(
  params: Record<string, unknown>,
  key: string,
  options: { required?: boolean; label?: string } = {},
): string | undefined {
  const { required = false, label = key } = options;
  const raw = params[key];

  if (typeof raw === "number" && Number.isFinite(raw)) {
    return String(raw);
  }
  if (typeof raw === "string") {
    const value = raw.trim();
    if (value) {
      return value;
    }
  }

  if (required) {
    throw new Error(`${label} is required`);
  }
  return undefined;
}

/**
 * Read a number parameter.
 */
export function readNumberParam(
  params: Record<string, unknown>,
  key: string,
  options: { required?: boolean; label?: string; integer?: boolean } = {},
): number | undefined {
  const { required = false, label = key, integer = false } = options;
  const raw = params[key];
  let value: number | undefined;

  if (typeof raw === "number" && Number.isFinite(raw)) {
    value = raw;
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed) {
      const parsed = Number.parseFloat(trimmed);
      if (Number.isFinite(parsed)) {
        value = parsed;
      }
    }
  }

  if (value === undefined) {
    if (required) {
      throw new Error(`${label} is required`);
    }
    return undefined;
  }

  return integer ? Math.trunc(value) : value;
}

/**
 * Read a boolean parameter.
 */
export function readBooleanParam(
  params: Record<string, unknown>,
  key: string,
  options: { required?: boolean; label?: string; defaultValue?: boolean } = {},
): boolean | undefined {
  const { required = false, label = key, defaultValue } = options;
  const raw = params[key];

  if (typeof raw === "boolean") {
    return raw;
  }
  if (typeof raw === "string") {
    const lower = raw.toLowerCase().trim();
    if (lower === "true" || lower === "1" || lower === "yes") {
      return true;
    }
    if (lower === "false" || lower === "0" || lower === "no") {
      return false;
    }
  }
  if (typeof raw === "number") {
    return raw !== 0;
  }

  if (defaultValue !== undefined) {
    return defaultValue;
  }
  if (required) {
    throw new Error(`${label} is required`);
  }
  return undefined;
}

/**
 * Read a string array parameter.
 */
export function readStringArrayParam(
  params: Record<string, unknown>,
  key: string,
  options: StringParamOptions & { required: true },
): string[];
export function readStringArrayParam(
  params: Record<string, unknown>,
  key: string,
  options?: StringParamOptions,
): string[] | undefined;
export function readStringArrayParam(
  params: Record<string, unknown>,
  key: string,
  options: StringParamOptions = {},
): string[] | undefined {
  const { required = false, label = key } = options;
  const raw = params[key];

  if (Array.isArray(raw)) {
    const values = raw
      .filter((entry) => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (values.length === 0) {
      if (required) {
        throw new Error(`${label} is required`);
      }
      return undefined;
    }
    return values;
  }

  if (typeof raw === "string") {
    const value = raw.trim();
    if (!value) {
      if (required) {
        throw new Error(`${label} is required`);
      }
      return undefined;
    }
    return [value];
  }

  if (required) {
    throw new Error(`${label} is required`);
  }
  return undefined;
}

// =============================================================================
// Tool Result Builders
// =============================================================================

/**
 * Create a JSON text result.
 */
export function jsonResult<T>(payload: T): ToolResult<T> {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
    details: payload,
  };
}

/**
 * Create a plain text result.
 */
export function textResult(text: string, details?: unknown): ToolResult {
  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
    details,
  };
}

/**
 * Create an error result.
 */
export function errorResult(message: string, details?: unknown): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: `Error: ${message}`,
      },
    ],
    details,
    isError: true,
  };
}

/**
 * Create an image result.
 */
export function imageResult(params: {
  data: string;
  mimeType: string;
  caption?: string;
  details?: unknown;
}): ToolResult {
  const content: ToolResult["content"] = [];

  if (params.caption) {
    content.push({
      type: "text",
      text: params.caption,
    });
  }

  content.push({
    type: "image",
    data: params.data,
    mimeType: params.mimeType,
  });

  return {
    content,
    details: params.details,
  };
}

/**
 * Create a success result with a message.
 */
export function successResult(message: string, data?: unknown): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: message,
      },
    ],
    details: { success: true, message, data },
  };
}

// =============================================================================
// Action Gate Pattern
// =============================================================================

/**
 * Action gate type for conditional tool actions.
 */
export type ActionGate<T extends Record<string, boolean | undefined>> = (
  key: keyof T,
  defaultValue?: boolean,
) => boolean;

/**
 * Create an action gate for conditional actions.
 */
export function createActionGate<T extends Record<string, boolean | undefined>>(
  actions: T | undefined,
): ActionGate<T> {
  return (key, defaultValue = true) => {
    const value = actions?.[key];
    if (value === undefined) {
      return defaultValue;
    }
    return value !== false;
  };
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Sleep for a specified duration.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff.
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    initialDelay?: number;
    maxDelay?: number;
    backoffMultiplier?: number;
    shouldRetry?: (error: unknown) => boolean;
  } = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelay = 1000,
    maxDelay = 30000,
    backoffMultiplier = 2,
    shouldRetry = () => true,
  } = options;

  let lastError: unknown;
  let delay = initialDelay;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts || !shouldRetry(error)) {
        throw error;
      }
      await sleep(delay);
      delay = Math.min(delay * backoffMultiplier, maxDelay);
    }
  }

  throw lastError;
}

/**
 * Truncate a string to a maximum length.
 */
export function truncate(str: string, maxLength: number, suffix = "..."): string {
  if (str.length <= maxLength) {
    return str;
  }
  return str.slice(0, maxLength - suffix.length) + suffix;
}

/**
 * Format bytes to human-readable string.
 */
export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) {
    return "0 Bytes";
  }

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];

  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}
