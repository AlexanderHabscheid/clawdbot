import crypto from "node:crypto";
import type {
  CentrisManifest,
  ManifestAction,
  ManifestActionSafetyLevel,
  ManifestRoute,
  SelectorStability,
} from "./types.js";

export type ManifestSourceKind = "workspace" | "registry" | "global" | "overlay" | "external";

export interface ManifestTrustPolicy {
  allowUnsignedExternal?: boolean;
  allowedPublishers?: string[];
  allowedAppsByPublisher?: Record<string, string[]>;
  publicKeys?: Record<string, string>;
}

export interface ManifestValidationOptions {
  strict?: boolean;
  targetVersion?: string;
}

export interface ManifestValidationIssue {
  level: "error" | "warning";
  message: string;
  route?: string;
  action?: string;
}

export interface ManifestValidationResult {
  ok: boolean;
  normalized: CentrisManifest;
  issues: ManifestValidationIssue[];
}

export interface ManifestTrustResult {
  trusted: boolean;
  reason: string;
}

type TargetSelectorInfo = {
  selectors: string[];
  landmarkStability?: SelectorStability;
};

function normalizeManifestVersion(input: string): string {
  if (input === "1.0" || input === "2.0") {
    return input;
  }
  return "2.0";
}

function majorVersionOf(version: string): number {
  const majorRaw = version.split(".", 1)[0] ?? "";
  const parsed = Number.parseInt(majorRaw, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isSemanticSelector(selector: string): boolean {
  const normalized = selector.trim().toLowerCase();
  return (
    normalized.includes("data-testid") ||
    normalized.includes("data-test-id") ||
    normalized.includes("data-test") ||
    normalized.includes("data-qa") ||
    normalized.includes("aria-label") ||
    normalized.includes("[role=") ||
    normalized.includes("#")
  );
}

function inferSelectorStability(selector: string): SelectorStability {
  const normalized = selector.trim().toLowerCase();
  if (
    normalized.includes("data-testid") ||
    normalized.includes("data-test-id") ||
    normalized.includes("aria-label") ||
    normalized.includes("[role=") ||
    normalized.startsWith("#")
  ) {
    return "stable";
  }
  if (
    normalized.includes(":nth-child") ||
    normalized.includes(":nth-of-type") ||
    normalized.includes(">") ||
    normalized.includes("+")
  ) {
    return "fragile";
  }
  return "moderate";
}

function classifyActionSafety(action: ManifestAction): ManifestActionSafetyLevel {
  if (action.safetyLevel) {
    return action.safetyLevel;
  }
  for (const step of action.steps) {
    if ("type" in step) {
      return "write";
    }
    if ("press" in step) {
      const key = step.press.trim().toLowerCase();
      if (key === "enter") {
        return "write";
      }
    }
  }
  return "read";
}

function resolveTargetSelectors(
  route: ManifestRoute,
  target: string | undefined,
): TargetSelectorInfo | null {
  const raw = (target ?? "").trim();
  if (!raw) {
    return null;
  }

  const landmark = route.landmarks?.[raw];
  if (landmark) {
    return {
      selectors: landmark.selectors,
      landmarkStability: landmark.stability,
    };
  }
  return { selectors: [raw] };
}

function collectActionTargetSelectors(
  route: ManifestRoute,
  action: ManifestAction,
): TargetSelectorInfo[] {
  const out: TargetSelectorInfo[] = [];
  for (const step of action.steps) {
    if ("click" in step) {
      const resolved = resolveTargetSelectors(route, step.click);
      if (resolved) {
        out.push(resolved);
      }
      continue;
    }
    if ("type" in step) {
      const resolved = resolveTargetSelectors(route, step.type.target);
      if (resolved) {
        out.push(resolved);
      }
      continue;
    }
  }
  return out;
}

function canonicalizeManifestForSigning(manifest: CentrisManifest): string {
  const clone = structuredClone(manifest);
  if (clone.trust) {
    delete clone.trust.signature;
  }

  const stableStringify = (value: unknown): string => {
    if (Array.isArray(value)) {
      return `[${value.map((item) => stableStringify(item)).join(",")}]`;
    }
    if (!value || typeof value !== "object") {
      return JSON.stringify(value);
    }
    const entries = Object.entries(value as Record<string, unknown>).toSorted(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  };

  return stableStringify(clone);
}

function verifySha256Signature(manifest: CentrisManifest, signature: string): boolean {
  const digest = crypto
    .createHash("sha256")
    .update(canonicalizeManifestForSigning(manifest))
    .digest("hex");
  const normalizedSignature = signature
    .replace(/^sha256:/i, "")
    .trim()
    .toLowerCase();
  return digest === normalizedSignature;
}

function parsePublicKey(input: string): crypto.KeyObject | null {
  try {
    if (input.includes("BEGIN PUBLIC KEY")) {
      return crypto.createPublicKey(input);
    }
    const raw = Buffer.from(input, "base64");
    return crypto.createPublicKey({ key: raw, format: "der", type: "spki" });
  } catch {
    return null;
  }
}

function verifyEd25519Signature(
  manifest: CentrisManifest,
  signature: string,
  publicKey: crypto.KeyObject,
): boolean {
  try {
    const payload = Buffer.from(canonicalizeManifestForSigning(manifest), "utf-8");
    const sig = Buffer.from(signature, "base64");
    return crypto.verify(null, payload, publicKey, sig);
  } catch {
    return false;
  }
}

export function validateManifestPolicy(
  manifest: CentrisManifest,
  options?: ManifestValidationOptions,
): ManifestValidationResult {
  const strict = options?.strict === true;
  const issues: ManifestValidationIssue[] = [];
  const normalized: CentrisManifest = {
    ...manifest,
    centris: normalizeManifestVersion(manifest.centris),
  };

  const major = majorVersionOf(manifest.centris);
  if (strict && major > 2) {
    issues.push({
      level: "error",
      message: `Unsupported manifest major version: ${manifest.centris}`,
    });
  }
  if (options?.targetVersion && manifest.centris !== options.targetVersion) {
    issues.push({
      level: strict ? "error" : "warning",
      message: `Manifest version ${manifest.centris} does not match target ${options.targetVersion}`,
    });
  }

  for (const [routeKey, route] of Object.entries(normalized.routes)) {
    for (const [actionName, action] of Object.entries(route.actions ?? {})) {
      const safety = classifyActionSafety(action);
      action.safetyLevel = safety;
      const selectors = collectActionTargetSelectors(route, action);
      const allSelectors = selectors.flatMap((entry) => entry.selectors);
      const hasSemantic = allSelectors.some((selector) => isSemanticSelector(selector));
      const allFragile =
        allSelectors.length > 0 &&
        allSelectors.every((selector) => inferSelectorStability(selector) === "fragile") &&
        selectors.every((entry) => (entry.landmarkStability ?? "moderate") === "fragile");

      if ((safety === "write" || safety === "destructive") && !action.successChecks?.length) {
        issues.push({
          level: strict ? "error" : "warning",
          message: `Action requires successChecks for ${safety} safety level`,
          route: routeKey,
          action: actionName,
        });
      }

      if ((safety === "write" || safety === "destructive") && !hasSemantic) {
        issues.push({
          level: strict ? "error" : "warning",
          message: "Write/destructive action should include semantic anchors/selectors",
          route: routeKey,
          action: actionName,
        });
      }

      if ((safety === "write" || safety === "destructive") && allFragile) {
        issues.push({
          level: "error",
          message: "Write/destructive action relies only on fragile selectors",
          route: routeKey,
          action: actionName,
        });
      }
    }

    for (const [landmarkName, landmark] of Object.entries(route.landmarks ?? {})) {
      if (landmark.stability === "fragile" && strict) {
        issues.push({
          level: "warning",
          message: `Landmark marked fragile: ${landmarkName}`,
          route: routeKey,
        });
      }
    }
  }

  return {
    ok: issues.every((issue) => issue.level !== "error"),
    normalized,
    issues,
  };
}

export function evaluateManifestTrust(params: {
  manifest: CentrisManifest;
  sourceKind: ManifestSourceKind;
  policy?: ManifestTrustPolicy;
}): ManifestTrustResult {
  const policy = params.policy ?? {};
  if (params.sourceKind === "workspace") {
    return { trusted: true, reason: "workspace-local" };
  }

  const trust = params.manifest.trust;
  if (!trust?.publisher) {
    if (policy.allowUnsignedExternal) {
      return { trusted: true, reason: "unsigned-external-allowed" };
    }
    return { trusted: false, reason: "missing publisher metadata" };
  }

  if (policy.allowedPublishers && policy.allowedPublishers.length > 0) {
    if (!policy.allowedPublishers.includes(trust.publisher)) {
      return { trusted: false, reason: `publisher not allowlisted: ${trust.publisher}` };
    }
  }

  const allowedApps = policy.allowedAppsByPublisher?.[trust.publisher];
  if (allowedApps && allowedApps.length > 0 && !allowedApps.includes(params.manifest.app)) {
    return {
      trusted: false,
      reason: `app ${params.manifest.app} not allowlisted for publisher ${trust.publisher}`,
    };
  }

  if (!trust.signature) {
    if (policy.allowUnsignedExternal) {
      return { trusted: true, reason: "unsigned-external-allowed" };
    }
    return { trusted: false, reason: "missing signature" };
  }

  const algorithm =
    trust.signatureAlgorithm ?? (trust.signature.startsWith("sha256:") ? "sha256" : "ed25519");
  if (algorithm === "sha256") {
    return verifySha256Signature(params.manifest, trust.signature)
      ? { trusted: true, reason: "sha256-signature-verified" }
      : { trusted: false, reason: "sha256-signature-mismatch" };
  }

  const keyId = trust.keyId ?? "";
  const keyRaw = policy.publicKeys?.[keyId];
  if (!keyRaw) {
    return { trusted: false, reason: `missing public key for keyId ${keyId || "(empty)"}` };
  }
  const key = parsePublicKey(keyRaw);
  if (!key) {
    return { trusted: false, reason: `invalid public key for keyId ${keyId}` };
  }
  return verifyEd25519Signature(params.manifest, trust.signature, key)
    ? { trusted: true, reason: "ed25519-signature-verified" }
    : { trusted: false, reason: "ed25519-signature-mismatch" };
}

export function sourcePriority(kind: ManifestSourceKind): number {
  switch (kind) {
    case "workspace":
      return 500;
    case "registry":
      return 400;
    case "global":
      return 300;
    case "overlay":
      return 200;
    case "external":
      return 100;
    default:
      return 0;
  }
}

export function detectManifestSourceKind(params: {
  path: string;
  workspaceDir?: string;
}): ManifestSourceKind {
  const normalizedPath = params.path.replace(/\\/g, "/");
  const workspaceRoot = params.workspaceDir?.replace(/\\/g, "/");
  if (workspaceRoot && normalizedPath.startsWith(`${workspaceRoot}/connectors/`)) {
    return "workspace";
  }
  if (normalizedPath.includes("/.centris/registry/") || normalizedPath.includes("/@centris/")) {
    return "registry";
  }
  if (normalizedPath.includes("/.centris/connectors/")) {
    return "global";
  }
  if (normalizedPath.includes("/.openclaw/connectors/")) {
    return "overlay";
  }
  return "external";
}

export function compareSemanticVersionsDesc(a?: string, b?: string): number {
  const parse = (value?: string): number[] => {
    if (!value) {
      return [0, 0, 0];
    }
    return value.split(".").map((part) => Number.parseInt(part, 10) || 0);
  };
  const av = parse(a);
  const bv = parse(b);
  const length = Math.max(av.length, bv.length);
  for (let i = 0; i < length; i++) {
    const ai = av[i] ?? 0;
    const bi = bv[i] ?? 0;
    if (ai !== bi) {
      return bi - ai;
    }
  }
  return 0;
}
