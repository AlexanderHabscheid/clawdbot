/**
 * @centris/sdk - TypeBox Schema System
 *
 * Provides type-safe schema definitions using TypeBox.
 * Pattern inspired by Clawdbot's tool schema guardrails.
 */

import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { TypeCompiler, type TypeCheck } from "@sinclair/typebox/compiler";

// =============================================================================
// String Enum Utilities (Clawdbot Pattern)
// =============================================================================

/**
 * Create a string enum schema.
 * Avoids TypeBox Union issues with tool input schemas.
 *
 * @example
 * const StatusSchema = stringEnum(['pending', 'active', 'completed']);
 * type Status = Static<typeof StatusSchema>; // 'pending' | 'active' | 'completed'
 */
export function stringEnum<T extends readonly string[]>(values: T) {
  return Type.Unsafe<T[number]>({
    type: "string",
    enum: values as unknown as string[],
  });
}

/**
 * Create an optional string enum schema.
 */
export function optionalStringEnum<T extends readonly string[]>(values: T) {
  return Type.Optional(stringEnum(values));
}

// =============================================================================
// Common Schema Primitives
// =============================================================================

/** Non-empty string schema */
export const NonEmptyString = Type.String({ minLength: 1 });

/** Positive integer schema (>= 1) */
export const PositiveInteger = Type.Integer({ minimum: 1 });

/** Non-negative integer schema (>= 0) */
export const NonNegativeInteger = Type.Integer({ minimum: 0 });

/** Unix timestamp in milliseconds */
export const Timestamp = Type.Integer({
  minimum: 0,
  description: "Unix timestamp in milliseconds",
});

/** URL string schema */
export const UrlString = Type.String({
  format: "uri",
  description: "Valid URL",
});

/** Email string schema */
export const EmailString = Type.String({
  format: "email",
  description: "Valid email address",
});

/** UUID string schema */
export const UuidString = Type.String({
  format: "uuid",
  description: "UUID v4",
});

// =============================================================================
// Execution Method & Auth Schemes
// =============================================================================

export const ExecutionMethodValues = ["api", "browser", "desktop", "hybrid"] as const;

export const ExecutionMethodSchema = stringEnum(ExecutionMethodValues);
export type ExecutionMethod = Static<typeof ExecutionMethodSchema>;

export const AuthSchemeValues = ["oauth2", "apikey", "bearer", "basic", "none"] as const;

export const AuthSchemeSchema = stringEnum(AuthSchemeValues);
export type AuthScheme = Static<typeof AuthSchemeSchema>;

// =============================================================================
// Standard Response Schemas
// =============================================================================

/** Metadata included in successful responses */
export const ResponseMetadataSchema = Type.Object({
  latencyMs: PositiveInteger,
  executionMethod: ExecutionMethodSchema,
  retryCount: Type.Optional(NonNegativeInteger),
});

export type ResponseMetadata = Static<typeof ResponseMetadataSchema>;

/** Standard success response schema */
export const SuccessResponseSchema = Type.Object({
  success: Type.Literal(true),
  data: Type.Unknown(),
  metadata: Type.Optional(ResponseMetadataSchema),
});

export type SuccessResponse = Static<typeof SuccessResponseSchema>;

/** Error details schema */
export const ErrorDetailsSchema = Type.Object({
  code: NonEmptyString,
  message: NonEmptyString,
  details: Type.Optional(Type.Unknown()),
  retryable: Type.Optional(Type.Boolean()),
});

export type ErrorDetails = Static<typeof ErrorDetailsSchema>;

/** Standard error response schema */
export const ErrorResponseSchema = Type.Object({
  success: Type.Literal(false),
  error: ErrorDetailsSchema,
  metadata: Type.Optional(ResponseMetadataSchema),
});

export type ErrorResponse = Static<typeof ErrorResponseSchema>;

/** Combined response type */
export const ExecutionResultSchema = Type.Union([SuccessResponseSchema, ErrorResponseSchema]);

export type ExecutionResult<T = unknown> =
  | { success: true; data: T; metadata?: ResponseMetadata }
  | { success: false; error: ErrorDetails; metadata?: ResponseMetadata };

// =============================================================================
// Tool Result Schemas (MCP Compatible)
// =============================================================================

/** Text content block */
export const TextContentSchema = Type.Object({
  type: Type.Literal("text"),
  text: Type.String(),
});

/** Image content block */
export const ImageContentSchema = Type.Object({
  type: Type.Literal("image"),
  data: Type.String({ description: "Base64 encoded image data" }),
  mimeType: Type.String(),
});

/** Tool result content */
export const ToolResultContentSchema = Type.Array(
  Type.Union([TextContentSchema, ImageContentSchema]),
);

/** Standard tool result schema */
export const ToolResultSchema = Type.Object({
  content: ToolResultContentSchema,
  details: Type.Optional(Type.Unknown()),
  isError: Type.Optional(Type.Boolean()),
});

export type ToolResult<T = unknown> = {
  content: Array<
    { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
  >;
  details?: T;
  isError?: boolean;
};

// =============================================================================
// Capability Schema
// =============================================================================

/** Capability definition schema */
export const CapabilitySchema = Type.Object({
  id: NonEmptyString,
  name: NonEmptyString,
  description: Type.String(),
  inputSchema: Type.Unknown({ description: "JSON Schema for input" }),
  outputSchema: Type.Optional(Type.Unknown({ description: "JSON Schema for output" })),
  executionMethods: Type.Array(ExecutionMethodSchema),
  examples: Type.Optional(Type.Array(Type.String())),
  tags: Type.Optional(Type.Array(Type.String())),
  requiresAuth: Type.Optional(Type.Boolean({ default: true })),
  requiresConfirmation: Type.Optional(Type.Boolean({ default: false })),
  rateLimit: Type.Optional(PositiveInteger),
  version: Type.Optional(Type.String({ default: "1.0.0" })),
  deprecated: Type.Optional(Type.Boolean({ default: false })),
  deprecatedMessage: Type.Optional(Type.String()),
});

export type Capability = Static<typeof CapabilitySchema>;

// =============================================================================
// Connector Card Schema (A2A Compatible)
// =============================================================================

/** OAuth configuration schema */
export const OAuthConfigSchema = Type.Object({
  authorizationUrl: UrlString,
  tokenUrl: UrlString,
  scopes: Type.Array(Type.String()),
  clientId: Type.Optional(Type.String()),
});

export type OAuthConfig = Static<typeof OAuthConfigSchema>;

/** Connector card schema */
export const ConnectorCardSchema = Type.Object({
  id: NonEmptyString,
  name: NonEmptyString,
  description: Type.String(),
  version: Type.String(),
  provider: Type.String(),
  providerUrl: Type.Optional(UrlString),
  supportEmail: Type.Optional(EmailString),
  capabilities: Type.Array(CapabilitySchema),
  authSchemes: Type.Array(AuthSchemeSchema),
  oauthConfig: Type.Optional(OAuthConfigSchema),
  categories: Type.Optional(Type.Array(Type.String())),
  tags: Type.Optional(Type.Array(Type.String())),
  iconUrl: Type.Optional(UrlString),
  documentationUrl: Type.Optional(UrlString),
});

export type ConnectorCard = Static<typeof ConnectorCardSchema>;

// =============================================================================
// Schema Compilation & Validation
// =============================================================================

/** Cache for compiled schemas */
const compiledSchemaCache = new WeakMap<TSchema, TypeCheck<TSchema>>();

/**
 * Compile a schema for fast validation.
 * Results are cached for performance.
 */
export function compileSchema<T extends TSchema>(schema: T): TypeCheck<T> {
  const cached = compiledSchemaCache.get(schema);
  if (cached) {
    return cached as unknown as TypeCheck<T>;
  }
  const compiled = TypeCompiler.Compile(schema);
  compiledSchemaCache.set(schema, compiled as unknown as TypeCheck<TSchema>);
  return compiled;
}

/**
 * Validation result type
 */
export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/**
 * Validate data against a schema.
 */
export function validate<T extends TSchema>(schema: T, data: unknown): ValidationResult<Static<T>> {
  const compiled = compileSchema(schema);
  if (compiled.Check(data)) {
    return { ok: true, value: data };
  }
  const errors = [...compiled.Errors(data)].map((err) => `${err.path || "/"}: ${err.message}`);
  return { ok: false, errors };
}

/**
 * Validate data and throw if invalid.
 */
export function validateOrThrow<T extends TSchema>(
  schema: T,
  data: unknown,
  context?: string,
): Static<T> {
  const result = validate(schema, data);
  if (!result.ok) {
    const prefix = context ? `${context}: ` : "";
    throw new Error(`${prefix}Validation failed: ${result.errors.join(", ")}`);
  }
  return result.value;
}

// =============================================================================
// Re-exports
// =============================================================================

export { Type, type Static, type TSchema };
