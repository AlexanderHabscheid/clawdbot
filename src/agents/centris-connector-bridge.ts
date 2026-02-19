/**
 * Centris Connector Bridge
 *
 * Bridges SDK connector tools into the overlay's agent tool system.
 * Loads connectors from ~/.centris/connectors/, npm packages, and the
 * local connectors/ directory, then adapts CentrisTool → AnyAgentTool.
 *
 * Uses opaque dynamic imports to keep SDK files out of the root tsconfig's rootDir.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AnyAgentTool } from "./tools/common.js";
import { logDebug, logInfo, logWarn, logError } from "../logger.js";

/** Minimal shape matching the SDK's CentrisTool */
interface SdkTool {
  name: string;
  label?: string;
  description: string;
  parameters: unknown;
  execute: (
    toolCallId: string,
    params: unknown,
    context?: unknown,
  ) => Promise<{
    content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    details?: unknown;
  }>;
}

interface SdkDiag {
  level: string;
  message: string;
  connectorId?: string;
}

interface SdkRegistry {
  tools: Array<{ factory: (ctx: unknown) => SdkTool | SdkTool[] | null; connectorId: string }>;
  connectors: Array<{ id: string; status: string }>;
  diagnostics: SdkDiag[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedLoadFn: ((opts: any) => SdkRegistry) | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedResolveFn: ((params: any) => SdkTool[]) | null = null;
let loadAttempted = false;

function sdkBasePath(): string {
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(thisDir, "..", "..", "sdk", "typescript", "src");
}

async function ensureSdk(): Promise<boolean> {
  if (loadAttempted) {
    return cachedLoadFn !== null;
  }
  loadAttempted = true;

  try {
    // Build paths as variables so tsc doesn't follow the import chain
    const base = sdkBasePath();
    const loaderPath = path.join(base, "loader", "loader.js");
    const registryPath = path.join(base, "loader", "registry.js");

    const loaderMod = await import(/* @vite-ignore */ loaderPath);
    const registryMod = await import(/* @vite-ignore */ registryPath);
    cachedLoadFn = loaderMod.loadCentrisConnectors;
    cachedResolveFn = registryMod.resolveConnectorTools;
    return true;
  } catch (err) {
    logDebug(`[centris-connector-bridge] SDK not available: ${String(err)}`);
    return false;
  }
}

/**
 * Load SDK connector tools and adapt them to AnyAgentTool format.
 * Gracefully returns [] if the SDK isn't available.
 */
export async function loadConnectorToolsAsync(options?: {
  workspaceDir?: string;
  existingToolNames?: Set<string>;
}): Promise<AnyAgentTool[]> {
  const available = await ensureSdk();
  if (!available || !cachedLoadFn || !cachedResolveFn) {
    return [];
  }

  try {
    const connectorsDir = path.resolve(options?.workspaceDir ?? process.cwd(), "connectors");

    const registry = cachedLoadFn({
      workspaceDir: options?.workspaceDir,
      extraPaths: [connectorsDir],
      logger: {
        debug: (msg: string) => logDebug(`[centris-connectors] ${msg}`),
        info: (msg: string) => logInfo(`[centris-connectors] ${msg}`),
        warn: (msg: string) => logWarn(`[centris-connectors] ${msg}`),
        error: (msg: string) => logError(`[centris-connectors] ${msg}`),
      },
      cache: true,
    });

    for (const diag of registry.diagnostics) {
      const prefix = diag.connectorId ? `[${diag.connectorId}] ` : "";
      if (diag.level === "error") {
        logError(`[centris-connectors] ${prefix}${diag.message}`);
      } else {
        logWarn(`[centris-connectors] ${prefix}${diag.message}`);
      }
    }

    const sdkTools = cachedResolveFn({
      registry,
      context: { workspaceDir: options?.workspaceDir },
      existingToolNames: options?.existingToolNames,
    });

    return sdkTools.map((sdkTool) => ({
      name: sdkTool.name,
      label: sdkTool.label ?? sdkTool.name,
      description: sdkTool.description,
      parameters: sdkTool.parameters,
      execute: async (toolCallId: string, params: unknown) => {
        const result = await sdkTool.execute(toolCallId, params);
        return { content: result.content, details: result.details };
      },
    })) as AnyAgentTool[];
  } catch (err) {
    logError(`[centris-connector-bridge] Failed to load connectors: ${String(err)}`);
    return [];
  }
}

/**
 * Synchronous wrapper for use in createOpenClawTools().
 * Returns cached tools from a previous async load, or [] on first call
 * (triggering background load for next invocation).
 */
let cachedConnectorTools: AnyAgentTool[] | null = null;

export function loadConnectorTools(options?: {
  workspaceDir?: string;
  existingToolNames?: Set<string>;
}): AnyAgentTool[] {
  if (cachedConnectorTools !== null) {
    return cachedConnectorTools;
  }

  loadConnectorToolsAsync(options)
    .then((tools) => {
      cachedConnectorTools = tools;
      if (tools.length > 0) {
        logInfo(`[centris-connector-bridge] ${tools.length} connector tool(s) available`);
      }
    })
    .catch(() => {
      cachedConnectorTools = [];
    });

  return [];
}
