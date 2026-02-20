import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import type {
  ActionAnchor,
  ActionIndexEntry,
  ActionPageFingerprint,
  ActionWebMemoryExecuteRequest,
  ActionWebMemoryIndexRequest,
  ActionWebMemoryInvalidateRequest,
  ActionWebMemoryResolveRequest,
  ActionWebMemoryStatsRequest,
} from "../../action-api/index.js";
import type {
  CLIContext,
  WebMemoryExecuteOptions,
  WebMemoryIndexOptions,
  WebMemoryInvalidateOptions,
  WebMemoryResolveOptions,
  WebMemoryStatsOptions,
} from "../types.js";
import { Centris } from "../../client/index.js";
import { createCliResultEnvelope, printCliResultEnvelope } from "../result-envelope.js";

function createClient(options: {
  apiKey?: string;
  baseUrl?: string;
  apiVersion?: string;
  timeoutMs?: number;
}): Centris {
  return new Centris({
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    apiVersion: options.apiVersion,
    timeoutMs: options.timeoutMs,
  });
}

function parseJsonObject(raw: string | undefined, field: string): Record<string, unknown> {
  if (!raw || raw.trim().length === 0) {
    return {};
  }
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${field} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") {
      return value;
    }
  }
  return "";
}

function slugify(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "action";
}

function inferAffordanceFromNode(node: Record<string, unknown>): ActionIndexEntry["affordance"] {
  const role = readString(node, "r", "role").toLowerCase();
  const type = readString(node, "t", "type").toLowerCase();
  const name = readString(node, "n", "name").toLowerCase();
  if (type.includes("input") || role === "textbox") {
    return "type";
  }
  if (role === "link" || type.includes("link")) {
    return "navigate";
  }
  if (name.includes("submit")) {
    return "submit";
  }
  return "click";
}

function readStringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function pushAnchor(
  target: ActionAnchor[],
  seen: Set<string>,
  anchorType: ActionAnchor["anchorType"],
  value: string | undefined,
  weight: number,
): void {
  const normalized = (value ?? "").trim();
  if (!normalized) {
    return;
  }
  const key = `${anchorType}:${normalized}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  target.push({ anchorType, value: normalized, weight });
}

function deriveAnchors(node: Record<string, unknown>, semanticLabel: string): ActionAnchor[] {
  const selector = typeof node.selector === "string" ? node.selector : undefined;
  const role = readString(node, "r", "role");
  const ariaLabel = readString(node, "ariaLabel", "aria_label");
  const placeholder = readString(node, "placeholder");
  const testIds = [
    readString(node, "testId", "test_id", "dataTestId", "data-testid"),
    ...readStringArray(node, "testIds"),
  ];
  const businessIds = [
    readString(node, "businessId", "business_id", "actionId", "data-centris-action"),
    ...readStringArray(node, "businessIds"),
  ];

  const anchors: ActionAnchor[] = [];
  const seen = new Set<string>();
  pushAnchor(anchors, seen, "label", semanticLabel, 1);
  pushAnchor(anchors, seen, "selector", selector, 0.85);
  pushAnchor(anchors, seen, "role", role, 0.7);
  pushAnchor(anchors, seen, "aria_label", ariaLabel, 0.8);
  pushAnchor(anchors, seen, "placeholder", placeholder, 0.75);
  for (const testId of testIds) {
    pushAnchor(anchors, seen, "test_id", testId, 0.9);
  }
  for (const businessId of businessIds) {
    pushAnchor(anchors, seen, "business_id", businessId, 0.92);
  }
  return anchors;
}

async function deriveSnapshotIndexing(params: {
  snapshotFile: string;
  url: string;
  fingerprintId?: string;
  intent?: string;
}): Promise<{
  pageFingerprint: ActionPageFingerprint;
  actionIndex: ActionIndexEntry[];
}> {
  const raw = await readFile(params.snapshotFile, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("snapshot file must contain a JSON object");
  }
  const snapshot = parsed as Record<string, unknown>;
  const metadata =
    typeof snapshot.metadata === "object" && snapshot.metadata && !Array.isArray(snapshot.metadata)
      ? (snapshot.metadata as Record<string, unknown>)
      : {};
  const interactiveNodes = Array.isArray(snapshot.interactiveNodes)
    ? (snapshot.interactiveNodes as Array<Record<string, unknown>>)
    : [];
  const headings = Array.isArray(snapshot.headings)
    ? (snapshot.headings as unknown[]).filter((item): item is string => typeof item === "string")
    : [];
  const navLabels = Array.isArray(snapshot.navLabels)
    ? (snapshot.navLabels as unknown[]).filter((item): item is string => typeof item === "string")
    : [];
  const primaryActions = interactiveNodes
    .map((node) => readString(node, "n", "name").trim())
    .filter((item) => item.length > 0)
    .slice(0, 12);
  const signatureHash = `sha256:${crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        url: params.url,
        title: metadata.title,
        headings,
        navLabels,
        count: interactiveNodes.length,
      }),
    )
    .digest("hex")}`;

  const pageFingerprint: ActionPageFingerprint = {
    fingerprintId: params.fingerprintId,
    urlPattern: params.url,
    titleHints: typeof metadata.title === "string" ? [metadata.title] : [],
    headings,
    navLabels,
    primaryActions,
    interactiveSummary: {
      total: interactiveNodes.length,
      buttons: interactiveNodes.filter((node) => readString(node, "r", "role") === "button").length,
      links: interactiveNodes.filter((node) => readString(node, "r", "role") === "link").length,
      inputs: interactiveNodes.filter((node) =>
        readString(node, "t", "type").toLowerCase().includes("input"),
      ).length,
    },
    signatureHash,
    generatedAt: new Date().toISOString(),
    confidence: 0.7,
  };

  const actionIndexCandidates: Array<ActionIndexEntry | null> = interactiveNodes.map(
    (node, index) => {
      const semanticLabel = readString(node, "n", "name").trim();
      if (!semanticLabel) {
        return null;
      }
      const selector = typeof node.selector === "string" ? node.selector : undefined;
      const nodeId =
        typeof node.nodeId === "number"
          ? node.nodeId
          : typeof node.id === "number"
            ? node.id
            : undefined;
      const anchors = deriveAnchors(node, semanticLabel);
      return {
        actionId: `${slugify(semanticLabel)}_${index + 1}`,
        intent: params.intent ?? semanticLabel,
        affordance: inferAffordanceFromNode(node),
        semanticLabel,
        nodeHints: [
          {
            nodeId,
            selector,
            role: typeof node.r === "string" ? node.r : undefined,
            name: semanticLabel,
          },
        ],
        anchors,
        confidence: 0.65,
        updatedAt: new Date().toISOString(),
      };
    },
  );

  const actionIndex = actionIndexCandidates.filter(
    (item): item is ActionIndexEntry => item !== null,
  );

  return { pageFingerprint, actionIndex };
}

export async function runWebMemoryIndexCommand(
  options: WebMemoryIndexOptions,
  ctx: CLIContext,
): Promise<void> {
  const startedAt = Date.now();
  const client = createClient(options);
  const derived =
    options.snapshotFile && options.snapshotFile.trim().length > 0
      ? await deriveSnapshotIndexing({
          snapshotFile: options.snapshotFile,
          url: options.url,
          fingerprintId: options.fingerprintId,
          intent: options.intent,
        })
      : undefined;
  const payload: ActionWebMemoryIndexRequest = {
    url: options.url,
    intent: options.intent,
    ttlMs: options.ttlMs,
    ...(options.playbook ? { playbook: parseJsonObject(options.playbook, "playbook") } : {}),
    ...(options.metadata ? { metadata: parseJsonObject(options.metadata, "metadata") } : {}),
    ...(derived?.pageFingerprint ? { pageFingerprint: derived.pageFingerprint } : {}),
    ...(derived ? { actionIndex: derived.actionIndex } : {}),
  };
  const result = await client.webMemory.index(payload);

  if (options.json) {
    printCliResultEnvelope(
      createCliResultEnvelope({
        ok: Boolean(result.ok),
        operation: "web.memory.index",
        summary: result.ok
          ? `Indexed web memory for ${options.url}`
          : `Failed to index web memory for ${options.url}`,
        data: result,
        errors: result.ok ? [] : ["web memory index failed"],
        durationMs: Date.now() - startedAt,
        safetyLevel: "write",
        artifacts: result.artifact ? [result.artifact] : [],
      }),
    );
    return;
  }

  if (!result.ok) {
    ctx.logger.error(`Web memory index failed for ${options.url}`);
    process.exit(1);
  }

  ctx.logger.success(`Indexed web memory for ${options.url}`);
  if (result.cacheKey) {
    ctx.logger.info(`Cache key: ${result.cacheKey}`);
  }
  if (derived) {
    ctx.logger.info(
      `Derived page fingerprint + ${derived.actionIndex.length} action index entries`,
    );
  }
}

export async function runWebMemoryResolveCommand(
  options: WebMemoryResolveOptions,
  ctx: CLIContext,
): Promise<void> {
  const startedAt = Date.now();
  const client = createClient(options);
  const payload: ActionWebMemoryResolveRequest = {
    url: options.url,
    intent: options.intent,
    maxAgeMs: options.maxAgeMs,
  };
  const result = await client.webMemory.resolve(payload);

  if (options.json) {
    printCliResultEnvelope(
      createCliResultEnvelope({
        ok: true,
        operation: "web.memory.resolve",
        summary: result.hit
          ? `Resolved cached playbook for ${options.url}`
          : `No cached playbook found for ${options.url}`,
        data: result,
        durationMs: Date.now() - startedAt,
        safetyLevel: "read",
        artifacts: result.artifact ? [result.artifact] : [],
      }),
    );
    return;
  }

  if (!result.hit) {
    ctx.logger.warn(`No cached playbook found for ${options.url}`);
    return;
  }

  ctx.logger.success(`Resolved cached playbook for ${options.url}`);
  if (result.cacheKey) {
    ctx.logger.info(`Cache key: ${result.cacheKey}`);
  }
}

export async function runWebMemoryExecuteCommand(
  options: WebMemoryExecuteOptions,
  ctx: CLIContext,
): Promise<void> {
  const startedAt = Date.now();
  const client = createClient(options);
  const payload: ActionWebMemoryExecuteRequest = {
    url: options.url,
    intent: options.intent,
    operation: options.operation,
    ...(options.params ? { params: parseJsonObject(options.params, "params") } : {}),
  };
  const result = await client.webMemory.execute(payload);

  if (options.json) {
    printCliResultEnvelope(
      createCliResultEnvelope({
        ok: Boolean(result.ok),
        operation: "web.memory.execute",
        summary: result.ok
          ? `Executed web memory plan for ${options.url}`
          : `Web memory execution failed for ${options.url}`,
        data: result,
        errors: result.ok ? [] : ["web memory execute failed"],
        durationMs: Date.now() - startedAt,
        safetyLevel: "external",
        artifacts: result.artifacts,
      }),
    );
    return;
  }

  if (!result.ok) {
    ctx.logger.error(`Web memory execution failed for ${options.url}`);
    process.exit(1);
  }

  ctx.logger.success(`Executed web memory plan for ${options.url}`);
  if (result.source) {
    ctx.logger.info(`Source: ${result.source}`);
  }
}

export async function runWebMemoryInvalidateCommand(
  options: WebMemoryInvalidateOptions,
  ctx: CLIContext,
): Promise<void> {
  if (!options.yes) {
    ctx.logger.error("web-memory invalidate is destructive. Re-run with --yes to confirm.");
    process.exit(1);
  }

  const startedAt = Date.now();
  const client = createClient(options);
  const payload: ActionWebMemoryInvalidateRequest = {
    url: options.url,
    playbookId: options.playbookId,
    scope: options.scope,
    reason: options.reason,
  };
  const result = await client.webMemory.invalidate(payload);

  if (options.json) {
    printCliResultEnvelope(
      createCliResultEnvelope({
        ok: Boolean(result.ok),
        operation: "web.memory.invalidate",
        summary: result.ok
          ? `Invalidated ${result.invalidated} web memory entries`
          : "Web memory invalidate failed",
        data: result,
        errors: result.ok ? [] : ["web memory invalidate failed"],
        durationMs: Date.now() - startedAt,
        safetyLevel: "destructive",
      }),
    );
    return;
  }

  if (!result.ok) {
    ctx.logger.error("Web memory invalidate failed");
    process.exit(1);
  }

  ctx.logger.success(`Invalidated ${result.invalidated} web memory entries`);
}

export async function runWebMemoryStatsCommand(
  options: WebMemoryStatsOptions,
  ctx: CLIContext,
): Promise<void> {
  const startedAt = Date.now();
  const client = createClient(options);
  const payload: ActionWebMemoryStatsRequest = {
    url: options.url,
    window: options.window,
  };
  const result = await client.webMemory.stats(payload);

  if (options.json) {
    printCliResultEnvelope(
      createCliResultEnvelope({
        ok: true,
        operation: "web.memory.stats",
        summary: `Web memory stats (${options.window ?? "24h"})`,
        data: result,
        durationMs: Date.now() - startedAt,
        safetyLevel: "read",
      }),
    );
    return;
  }

  ctx.logger.success("Web memory stats");
  ctx.logger.info(`Entries: ${result.entries}`);
  ctx.logger.info(`Hits: ${result.hits}`);
  ctx.logger.info(`Misses: ${result.misses}`);
}
