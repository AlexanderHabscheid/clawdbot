/**
 * @centris/sdk - Config Validation
 *
 * Validates connector configuration against schemas.
 * Supports Zod, TypeBox, and custom validators.
 */

import type { ConnectorConfigSchema, ConnectorConfigUiHint } from "../plugin/types.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Result from config validation.
 */
export interface ConfigValidationResult {
  ok: boolean;
  value?: Record<string, unknown>;
  errors?: string[];
}

// =============================================================================
// Validation Functions
// =============================================================================

/**
 * Validate connector config against its schema.
 * Supports Zod, TypeBox, and custom validators.
 */
export function validateConnectorConfig(params: {
  schema?: ConnectorConfigSchema;
  value?: Record<string, unknown>;
}): ConfigValidationResult {
  const { schema, value } = params;

  // No schema = pass through
  if (!schema) {
    return { ok: true, value };
  }

  // Custom validation (validate function)
  if (typeof schema.validate === "function") {
    const result = schema.validate(value);
    if (result.ok) {
      return {
        ok: true,
        value: (result.value as Record<string, unknown>) ?? value,
      };
    }
    return { ok: false, errors: result.errors };
  }

  // Zod-style validation (safeParse)
  if (typeof schema.safeParse === "function") {
    const result = schema.safeParse(value);
    if (result.success) {
      return { ok: true, value: result.data as Record<string, unknown> };
    }
    const issues = result.error?.issues ?? [];
    const errors = issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
      return `${path}: ${issue.message}`;
    });
    return { ok: false, errors };
  }

  // TypeBox-style validation (parse with throw)
  if (typeof schema.parse === "function") {
    try {
      const parsed = schema.parse(value);
      return { ok: true, value: parsed as Record<string, unknown> };
    } catch (err) {
      return { ok: false, errors: [String(err)] };
    }
  }

  // No validation method found - pass through
  return { ok: true, value };
}

/**
 * Extract UI hints from a config schema.
 */
export function extractConfigUiHints(
  schema?: ConnectorConfigSchema,
): Record<string, ConnectorConfigUiHint> | undefined {
  if (!schema) {
    return undefined;
  }

  if (schema.uiHints && typeof schema.uiHints === "object" && !Array.isArray(schema.uiHints)) {
    return schema.uiHints;
  }

  return undefined;
}

/**
 * Create a simple config schema with validation function.
 */
export function createConfigSchema(params: {
  validate: (value: unknown) => ConfigValidationResult;
  uiHints?: Record<string, ConnectorConfigUiHint>;
}): ConnectorConfigSchema {
  return {
    validate: (value: unknown) => {
      const result = params.validate(value);
      if (result.ok) {
        return { ok: true, value: result.value };
      }
      return { ok: false, errors: result.errors ?? [] };
    },
    uiHints: params.uiHints,
  };
}

/**
 * Create a config schema that accepts any object.
 */
export function anyObjectSchema(
  uiHints?: Record<string, ConnectorConfigUiHint>,
): ConnectorConfigSchema {
  return {
    validate: (value: unknown) => {
      if (value === undefined || value === null) {
        return { ok: true, value: {} };
      }
      if (typeof value !== "object" || Array.isArray(value)) {
        return { ok: false, errors: ["Expected an object"] };
      }
      return { ok: true, value: value as Record<string, unknown> };
    },
    uiHints,
  };
}

/**
 * Merge multiple config schemas (validates against all).
 */
export function mergeConfigSchemas(...schemas: ConnectorConfigSchema[]): ConnectorConfigSchema {
  return {
    validate: (value: unknown) => {
      let currentValue = value;
      for (const schema of schemas) {
        const result = validateConnectorConfig({
          schema,
          value: currentValue as Record<string, unknown>,
        });
        if (!result.ok) {
          return { ok: false, errors: result.errors ?? [] };
        }
        currentValue = result.value;
      }
      return { ok: true, value: currentValue as Record<string, unknown> };
    },
    uiHints: schemas.reduce(
      (acc, schema) => ({ ...acc, ...schema.uiHints }),
      {} as Record<string, ConnectorConfigUiHint>,
    ),
  };
}
