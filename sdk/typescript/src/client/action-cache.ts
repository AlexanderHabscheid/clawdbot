/**
 * @centris/sdk - Action Cache & Replay
 *
 * Record flows for deterministic replay. Wraps route.record.start/stop and route.run.
 */

import type { ActionRouteMemoryStep } from "../action-api/types.js";
import type { Centris } from "./index.js";

/**
 * Serializable action cache for save/load and replay.
 * routeId comes from route.record.stop; steps are optional (for documentation).
 */
export interface ActionCache {
  /** Cache format version */
  version: "1.0";
  /** Route ID from recording (required for replay) */
  routeId: string;
  /** Intent that was recorded */
  intent?: string;
  /** URL pattern or site */
  site?: string;
  /** Recorded steps (optional; server holds canonical copy) */
  steps?: ActionRouteMemoryStep[];
  /** When the cache was created */
  createdAt: string;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Options for recordRoute().
 */
export interface RecordRouteOptions {
  /** Starting URL (optional) */
  url?: string;
  /** Parameters for the flow */
  params?: Record<string, string>;
  /** Extra metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Result of recordRoute() - use sessionId to stop recording.
 */
export interface RecordRouteResult {
  sessionId: string;
  startedAt?: string;
}

/**
 * Options for stopRouteRecording().
 */
export interface StopRouteRecordingOptions {
  /** Outcome of the recording */
  outcome?: "success" | "failed" | "cancelled";
  /** Extra metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Result of stopRouteRecording() - contains the route ID for replay.
 */
export interface StopRouteRecordingResult {
  routeId?: string;
  updatedAt?: string;
  /** Build an ActionCache from this result for save/replay */
  toCache?: (opts?: {
    intent?: string;
    site?: string;
    metadata?: Record<string, unknown>;
  }) => ActionCache;
}

/**
 * Options for replayRoute().
 */
export interface ReplayRouteOptions {
  /** URL to run against (overrides cache if provided) */
  url?: string;
  /** Parameters for the route */
  params?: Record<string, string>;
}

/**
 * Start recording a route. Perform actions (via do() or other means), then call stopRouteRecording.
 *
 * @example
 * ```ts
 * const { sessionId } = await centris.recordRoute("Login to Gmail");
 * // ... user or agent performs actions ...
 * const { routeId } = await centris.stopRouteRecording(sessionId);
 * const cache = centris.buildActionCache(routeId, "Login to Gmail", steps);
 * fs.writeFileSync("login-cache.json", JSON.stringify(cache, null, 2));
 * ```
 */
export async function recordRoute(
  client: Centris,
  intent: string,
  options: RecordRouteOptions = {},
): Promise<RecordRouteResult> {
  const result = await client.routeRecordStart({
    intent,
    url: options.url,
    params: options.params,
    metadata: options.metadata,
  });
  if (!result.ok) {
    throw new Error("route.record.start failed");
  }
  return {
    sessionId: result.sessionId,
    startedAt: result.startedAt,
  };
}

/**
 * Stop route recording and get the route ID for replay.
 */
export async function stopRouteRecording(
  client: Centris,
  sessionId: string,
  options: StopRouteRecordingOptions = {},
): Promise<StopRouteRecordingResult> {
  const result = await client.routeRecordStop({
    sessionId,
    outcome: options.outcome,
    metadata: options.metadata,
  });
  if (!result.ok) {
    throw new Error("route.record.stop failed");
  }
  const routeId = result.routeId;
  return {
    routeId,
    updatedAt: result.updatedAt,
    toCache:
      routeId !== undefined
        ? (opts) =>
            buildActionCache(routeId, {
              intent: opts?.intent,
              site: opts?.site,
              metadata: opts?.metadata ?? options.metadata,
            })
        : undefined,
  };
}

/**
 * Build an ActionCache from route data for serialization.
 */
export function buildActionCache(
  routeId: string,
  opts?: {
    intent?: string;
    site?: string;
    steps?: ActionRouteMemoryStep[];
    metadata?: Record<string, unknown>;
  },
): ActionCache {
  return {
    version: "1.0",
    routeId,
    intent: opts?.intent,
    site: opts?.site,
    steps: opts?.steps,
    createdAt: new Date().toISOString(),
    metadata: opts?.metadata,
  };
}

/**
 * Replay a route from cache. Uses route.run with the cached routeId.
 *
 * @example
 * ```ts
 * const cache = JSON.parse(fs.readFileSync("login-cache.json", "utf-8"));
 * const result = await centris.replayRoute(cache, { url: "https://gmail.com" });
 * ```
 */
export async function replayRoute(
  client: Centris,
  cache: ActionCache,
  options: ReplayRouteOptions = {},
): Promise<{ ok: boolean; executed: number; details?: Record<string, unknown> }> {
  const routeId = cache.routeId;
  const params = options.params ?? (cache.metadata?.params as Record<string, string> | undefined);

  const result = await client.routeRun({
    routeId,
    url: options.url,
    params,
  });

  return {
    ok: result.ok,
    executed: result.executed,
    details: result.verify ? { verify: result.verify } : undefined,
  };
}
