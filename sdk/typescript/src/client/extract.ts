/**
 * @centris/sdk - Structured Extraction API
 *
 * Extract typed, structured data from pages using natural language.
 * Passes outputSchema to the backend via context; parses and validates the result.
 */

import type { TSchema } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import type { Centris } from "./index.js";
import type { CentrisResult } from "./index.js";

/** JSON Schema representation for backend context */
export type JsonSchema = Record<string, unknown>;

/**
 * Convert a TypeBox schema to JSON Schema for backend context.
 */
export function schemaToJsonSchema(schema: TSchema): JsonSchema {
  const raw = JSON.parse(JSON.stringify(schema));
  // Ensure type is present for JSON Schema consumers
  if (!raw.type && raw.properties) {
    raw.type = "object";
  }
  return raw;
}

/**
 * Try to parse result text as JSON, optionally wrapped in markdown code blocks.
 */
function parseJsonFromResult(text: string): unknown {
  const trimmed = text.trim();
  // Strip markdown code block if present
  const codeBlockMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/);
  const toParse = codeBlockMatch?.[1]?.trim() ?? trimmed;
  if (!toParse) {
    return null;
  }
  try {
    return JSON.parse(toParse);
  } catch {
    return null;
  }
}

/**
 * Options for extract().
 */
export interface ExtractOptions {
  /** Run async and return taskId for polling */
  asyncMode?: boolean;
  /** Wait for completion when asyncMode (default: true when outputSchema provided) */
  wait?: boolean;
  /** Additional context for the command */
  context?: Record<string, unknown>;
}

/**
 * Result of extract() when successful.
 */
export interface ExtractResult<T> {
  /** Extracted data, validated against schema */
  data: T;
  /** Raw result text from the backend */
  rawText: string;
  /** Task ID (for async flows) */
  taskId: string;
  /** Status of the task */
  status: CentrisResult["status"];
  /** Actions performed */
  actions: CentrisResult["actions"];
}

/**
 * Extract structured data from the current page/context using natural language.
 *
 * The instruction should describe what to extract (e.g. "Get the first 5 product names and prices").
 * The schema defines the expected output shape. The backend returns structured JSON when
 * outputSchema is provided in context.
 *
 * @example
 * ```ts
 * import { Centris, Type } from '@centris/sdk';
 *
 * const schema = Type.Object({
 *   products: Type.Array(Type.Object({
 *     name: Type.String(),
 *     price: Type.Number(),
 *   })),
 * });
 *
 * const centris = new Centris();
 * const { data } = await centris.extract(
 *   "Get the first 5 products with name and price from this page",
 *   schema
 * );
 * console.log(data.products);
 * ```
 */
export async function extract<T extends TSchema>(
  client: Centris,
  instruction: string,
  schema: T,
  options: ExtractOptions = {},
): Promise<ExtractResult<Static<T>>> {
  const jsonSchema = schemaToJsonSchema(schema);
  const context = {
    ...options.context,
    outputSchema: jsonSchema,
  };

  const result = await client.do(instruction, {
    asyncMode: options.asyncMode ?? false,
    context,
  });

  if (options.asyncMode && (result.status === "queued" || result.status === "running")) {
    const shouldWait = options.wait ?? true;
    if (shouldWait && result.taskId) {
      const final = await client.wait(result.taskId);
      return parseExtractResult(final, schema);
    }
    throw new Error("extract() with asyncMode requires wait: true or polling via client.wait()");
  }

  return parseExtractResult(result, schema);
}

function parseExtractResult<T extends TSchema>(
  result: CentrisResult,
  schema: T,
): ExtractResult<Static<T>> {
  const text = result.text ?? "";
  const parsed = parseJsonFromResult(text);

  if (parsed === null) {
    throw new Error(
      `Extract failed: result was not valid JSON. Raw text: ${text.slice(0, 200)}...`,
    );
  }

  const compiled = TypeCompiler.Compile(schema);
  if (!compiled.Check(parsed)) {
    const errors = [...compiled.Errors(parsed)].map((e) => `${e.path}: ${e.message}`).join("; ");
    throw new Error(`Extract validation failed: ${errors}`);
  }

  return {
    data: parsed as Static<T>,
    rawText: text,
    taskId: result.taskId,
    status: result.status,
    actions: result.actions,
  };
}
