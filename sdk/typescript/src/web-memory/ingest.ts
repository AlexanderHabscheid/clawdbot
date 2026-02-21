import type {
  ActionAnchor,
  ActionAffordance,
  ActionWebMemoryIndexRequest,
} from "../action-api/index.js";

const ALLOWED_ANCHOR_TYPES = new Set([
  "label",
  "aria_label",
  "placeholder",
  "near_text",
  "selector",
  "test_id",
  "business_id",
  "role",
  "url",
  "region",
]);

const SEMANTIC_ANCHOR_TYPES = new Set(["test_id", "business_id", "label", "aria_label"]);

export interface WebMemoryValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  normalized: ActionWebMemoryIndexRequest;
  stats: {
    actionCount: number;
    anchorCount: number;
    nodeHintCount: number;
    semanticAnchorCount: number;
  };
}

function clampConfidence(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}

function normalizeAnchor(anchor: ActionAnchor): ActionAnchor | null {
  if (!anchor || typeof anchor !== "object") {
    return null;
  }
  const type = (anchor.anchorType ?? "").trim();
  const value = (anchor.value ?? "").trim();
  if (!type || !value) {
    return null;
  }
  if (!ALLOWED_ANCHOR_TYPES.has(type)) {
    return null;
  }
  return {
    anchorType: type as ActionAnchor["anchorType"],
    value,
    weight:
      typeof anchor.weight === "number" && Number.isFinite(anchor.weight)
        ? Math.max(0, Math.min(1, Number(anchor.weight.toFixed(3))))
        : undefined,
  };
}

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    return "";
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.toString();
  } catch {
    return trimmed;
  }
}

export function validateWebMemoryIndexPayload(
  payload: ActionWebMemoryIndexRequest,
  options?: { strict?: boolean },
): WebMemoryValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const strict = options?.strict === true;

  const normalized: ActionWebMemoryIndexRequest = {
    ...payload,
    url: normalizeUrl(payload.url ?? ""),
    intent: typeof payload.intent === "string" ? payload.intent.trim() : undefined,
    ttlMs:
      typeof payload.ttlMs === "number" && Number.isFinite(payload.ttlMs)
        ? Math.max(1, Math.floor(payload.ttlMs))
        : undefined,
    actionIndex: [],
    pageFingerprint: payload.pageFingerprint
      ? {
          ...payload.pageFingerprint,
          confidence: clampConfidence(payload.pageFingerprint.confidence),
        }
      : undefined,
    routeMemory: payload.routeMemory
      ? {
          ...payload.routeMemory,
          routeId: payload.routeMemory.routeId?.trim() ?? "",
          confidence: clampConfidence(payload.routeMemory.confidence),
          steps: Array.isArray(payload.routeMemory.steps) ? payload.routeMemory.steps : [],
        }
      : undefined,
  };

  if (!normalized.url) {
    errors.push("url is required");
  } else {
    try {
      // Require absolute URL for deterministic indexing keys.
      new URL(normalized.url);
    } catch {
      errors.push("url must be an absolute URL");
    }
  }

  if (normalized.routeMemory && !normalized.routeMemory.routeId) {
    errors.push("routeMemory.routeId is required when routeMemory is provided");
  }

  const actionIds = new Set<string>();
  let anchorCount = 0;
  let nodeHintCount = 0;
  let semanticAnchorCount = 0;
  const actions = Array.isArray(payload.actionIndex) ? payload.actionIndex : [];
  for (let index = 0; index < actions.length; index++) {
    const entry = actions[index];
    if (!entry) {
      continue;
    }
    const actionId = entry.actionId?.trim() ?? "";
    const affordance = entry.affordance;
    if (!actionId) {
      errors.push(`actionIndex[${index}].actionId is required`);
      continue;
    }
    if (actionIds.has(actionId)) {
      errors.push(`actionIndex contains duplicate actionId: ${actionId}`);
      continue;
    }
    actionIds.add(actionId);
    if (!affordance) {
      errors.push(`actionIndex[${index}].affordance is required`);
      continue;
    }

    const anchors = Array.isArray(entry.anchors)
      ? entry.anchors
          .map((anchor) => normalizeAnchor(anchor))
          .filter((anchor): anchor is ActionAnchor => anchor !== null)
      : [];
    anchorCount += anchors.length;
    for (const anchor of anchors) {
      if (SEMANTIC_ANCHOR_TYPES.has(anchor.anchorType)) {
        semanticAnchorCount++;
      }
    }

    const nodeHints = Array.isArray(entry.nodeHints)
      ? entry.nodeHints.filter((hint) => {
          const hasNodeId = typeof hint.nodeId === "number" && Number.isFinite(hint.nodeId);
          const hasSelector = typeof hint.selector === "string" && hint.selector.trim().length > 0;
          return hasNodeId || hasSelector;
        })
      : [];
    nodeHintCount += nodeHints.length;

    if (anchors.length === 0 && nodeHints.length === 0) {
      warnings.push(
        `actionIndex[${index}] (${actionId}) has no anchors or node hints; execution may drift`,
      );
    }

    const normalizedAffordance = affordance;
    normalized.actionIndex!.push({
      ...entry,
      actionId,
      affordance: normalizedAffordance,
      intent: entry.intent?.trim() ?? normalized.intent ?? actionId,
      semanticLabel: entry.semanticLabel?.trim() || undefined,
      anchors,
      nodeHints,
      confidence: clampConfidence(entry.confidence),
    });
  }

  if (normalized.actionIndex!.length === 0) {
    warnings.push("actionIndex is empty; this will not accelerate route execution");
  }
  if (strict && semanticAnchorCount === 0) {
    errors.push(
      "strict validation requires at least one semantic anchor (test_id, business_id, label, or aria_label)",
    );
  } else if (semanticAnchorCount === 0) {
    warnings.push(
      "no semantic anchors found; add test_id/business_id anchors for drift resistance",
    );
  }

  if (!normalized.pageFingerprint?.fingerprintId) {
    warnings.push(
      "pageFingerprint.fingerprintId is missing; drift detection quality will be lower",
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    normalized,
    stats: {
      actionCount: normalized.actionIndex!.length,
      anchorCount,
      nodeHintCount,
      semanticAnchorCount,
    },
  };
}

export interface WebMemoryEmitterNode {
  actionId: string;
  affordance: ActionAffordance;
  label?: string;
  selector?: string;
  nodeId?: number;
  role?: string;
  ariaLabel?: string;
  placeholder?: string;
  testId?: string;
  businessId?: string;
  confidence?: number;
}

export function createWebMemoryIndexPayload(params: {
  url: string;
  intent?: string;
  fingerprintId?: string;
  ttlMs?: number;
  nodes: WebMemoryEmitterNode[];
}): ActionWebMemoryIndexRequest {
  return {
    url: params.url,
    intent: params.intent,
    ttlMs: params.ttlMs,
    pageFingerprint: {
      fingerprintId: params.fingerprintId,
      urlPattern: params.url,
      generatedAt: new Date().toISOString(),
      confidence: 0.8,
    },
    actionIndex: params.nodes.map((node) => {
      const anchors: ActionAnchor[] = [];
      if (node.label) {
        anchors.push({ anchorType: "label", value: node.label, weight: 1 });
      }
      if (node.selector) {
        anchors.push({ anchorType: "selector", value: node.selector, weight: 0.85 });
      }
      if (node.role) {
        anchors.push({ anchorType: "role", value: node.role, weight: 0.7 });
      }
      if (node.ariaLabel) {
        anchors.push({ anchorType: "aria_label", value: node.ariaLabel, weight: 0.8 });
      }
      if (node.placeholder) {
        anchors.push({ anchorType: "placeholder", value: node.placeholder, weight: 0.75 });
      }
      if (node.testId) {
        anchors.push({ anchorType: "test_id", value: node.testId, weight: 0.92 });
      }
      if (node.businessId) {
        anchors.push({ anchorType: "business_id", value: node.businessId, weight: 0.94 });
      }
      return {
        actionId: node.actionId,
        intent: params.intent ?? node.actionId,
        affordance: node.affordance,
        semanticLabel: node.label,
        nodeHints: [
          {
            nodeId: typeof node.nodeId === "number" ? node.nodeId : undefined,
            selector: node.selector,
            role: node.role,
            name: node.label,
          },
        ],
        anchors,
        confidence: clampConfidence(node.confidence) ?? 0.8,
      };
    }),
  };
}
