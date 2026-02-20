/**
 * @centris/sdk - Action API Contract
 *
 * Stable runtime-facing schema for Electron/extension/CLI integration.
 */

import type {
  ActionKernelSpecVersion,
  KernelActRequest,
  KernelActResult,
  KernelObserveRequest,
  KernelObserveResult,
  KernelSuccessCheck,
  KernelVerifyRequest,
  KernelVerifyResult,
} from "../kernel/types.js";

export const ACTION_API_SPEC_VERSION: ActionKernelSpecVersion = "2026-02-19";

export type ActionApiMethod =
  | "observe"
  | "act"
  | "verify"
  | "desktop.snapshot"
  | "desktop.find"
  | "desktop.click"
  | "desktop.type"
  | "desktop.apps"
  | "desktop.windows"
  | "route.run"
  | "route.record.start"
  | "route.record.stop"
  | "web.memory.index"
  | "web.memory.validate"
  | "web.memory.resolve"
  | "web.memory.execute"
  | "web.memory.invalidate"
  | "web.memory.stats";

export interface ActionArtifact {
  artifactType: string;
  schema: string;
  producerOperation: string;
  value: Record<string, unknown>;
}

export type ActionAffordance =
  | "click"
  | "type"
  | "select"
  | "submit"
  | "navigate"
  | "press"
  | "read"
  | "wait";

export type ActionRegion = "header" | "nav" | "main" | "sidebar" | "modal" | "footer" | "unknown";

export type ActionAnchorType =
  | "label"
  | "aria_label"
  | "placeholder"
  | "near_text"
  | "selector"
  | "test_id"
  | "business_id"
  | "role"
  | "url"
  | "region";

export interface ActionAnchor {
  anchorType: ActionAnchorType;
  value: string;
  weight?: number;
}

export interface ActionNodeHint {
  nodeId?: number;
  selector?: string;
  role?: string;
  name?: string;
}

export interface ActionLandmark {
  role: string;
  label?: string;
  region?: ActionRegion;
  selectors?: string[];
  textHints?: string[];
}

export interface ActionPageFingerprint {
  fingerprintId?: string;
  urlPattern?: string;
  titleHints?: string[];
  headings?: string[];
  navLabels?: string[];
  primaryActions?: string[];
  landmarks?: ActionLandmark[];
  interactiveSummary?: {
    total?: number;
    buttons?: number;
    links?: number;
    inputs?: number;
    forms?: number;
    menus?: number;
    dialogs?: number;
  };
  signatureHash?: string;
  generatedAt?: string;
  confidence?: number;
}

export interface ActionIndexEntry {
  actionId: string;
  intent: string;
  affordance: ActionAffordance;
  semanticLabel?: string;
  region?: ActionRegion;
  nodeHints?: ActionNodeHint[];
  anchors?: ActionAnchor[];
  preconditions?: string[];
  successChecks?: KernelSuccessCheck[];
  fallbackActionIds?: string[];
  confidence?: number;
  updatedAt?: string;
}

export interface ActionRouteMemoryStep {
  stepId?: string;
  actionId?: string;
  operation?: string;
  params?: Record<string, string>;
  expectedPageFingerprintId?: string;
  successChecks?: KernelSuccessCheck[];
}

export interface ActionRouteMemory {
  routeId: string;
  intent?: string;
  site?: string;
  pageFingerprintId?: string;
  steps: ActionRouteMemoryStep[];
  preconditions?: string[];
  successChecks?: KernelSuccessCheck[];
  fallbackRouteIds?: string[];
  confidence?: number;
  version?: string;
  updatedAt?: string;
}

export interface ActionRouteRunRequest {
  routeId: string;
  url?: string;
  params?: Record<string, string>;
  checks?: KernelSuccessCheck[];
  artifacts?: ActionArtifact[];
  pageFingerprint?: ActionPageFingerprint;
  actionIndex?: ActionIndexEntry[];
  routeMemory?: ActionRouteMemory;
}

export interface ActionRouteRunResult {
  ok: boolean;
  executed: number;
  verify?: KernelVerifyResult;
  artifacts?: ActionArtifact[];
  source?: "memory" | "manifest" | "live";
  pageFingerprint?: ActionPageFingerprint;
  actionIndex?: ActionIndexEntry[];
  routeMemory?: ActionRouteMemory;
}

export interface ActionRouteRecordStartRequest {
  intent: string;
  url?: string;
  params?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

export interface ActionRouteRecordStartResult {
  ok: boolean;
  sessionId: string;
  startedAt?: string;
}

export interface ActionRouteRecordStopRequest {
  sessionId: string;
  outcome?: "success" | "failed" | "cancelled";
  metadata?: Record<string, unknown>;
}

export interface ActionRouteRecordStopResult {
  ok: boolean;
  routeId?: string;
  updatedAt?: string;
}

export interface ActionWebMemoryIndexRequest {
  url: string;
  intent?: string;
  playbook?: Record<string, unknown>;
  pageFingerprint?: ActionPageFingerprint;
  actionIndex?: ActionIndexEntry[];
  routeMemory?: ActionRouteMemory;
  ttlMs?: number;
  metadata?: Record<string, unknown>;
}

export interface ActionWebMemoryIndexResult {
  ok: boolean;
  cacheKey?: string;
  version?: string;
  createdAt?: string;
  expiresAt?: string;
  pageFingerprint?: ActionPageFingerprint;
  actionIndex?: ActionIndexEntry[];
  routeMemory?: ActionRouteMemory;
  artifact?: ActionArtifact;
}

export interface ActionWebMemoryValidateRequest {
  payload: ActionWebMemoryIndexRequest;
  strict?: boolean;
}

export interface ActionWebMemoryValidateResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  normalized?: ActionWebMemoryIndexRequest;
  stats?: {
    actionCount: number;
    anchorCount: number;
    nodeHintCount: number;
    semanticAnchorCount: number;
  };
}

export interface ActionWebMemoryResolveRequest {
  url: string;
  intent?: string;
  maxAgeMs?: number;
}

export interface ActionWebMemoryResolveResult {
  hit: boolean;
  cacheKey?: string;
  playbook?: Record<string, unknown>;
  generatedAt?: string;
  expiresAt?: string;
  source?: "cache" | "live";
  confidence?: number;
  pageFingerprint?: ActionPageFingerprint;
  actionIndex?: ActionIndexEntry[];
  routeMemory?: ActionRouteMemory;
  artifact?: ActionArtifact;
}

export interface ActionWebMemoryExecuteRequest {
  url: string;
  intent?: string;
  operation?: string;
  pageFingerprintId?: string;
  routeId?: string;
  params?: Record<string, unknown>;
}

export interface ActionWebMemoryExecuteResult {
  ok: boolean;
  source?: "cache" | "live";
  executed?: number;
  confidence?: number;
  pageFingerprint?: ActionPageFingerprint;
  actionIndex?: ActionIndexEntry[];
  routeMemory?: ActionRouteMemory;
  details?: Record<string, unknown>;
  artifacts?: ActionArtifact[];
}

export interface ActionWebMemoryInvalidateRequest {
  url?: string;
  playbookId?: string;
  scope?: "url" | "domain" | "all";
  reason?: string;
}

export interface ActionWebMemoryInvalidateResult {
  ok: boolean;
  invalidated: number;
}

export interface ActionWebMemoryStatsRequest {
  url?: string;
  window?: "1h" | "24h" | "7d" | "30d";
}

export interface ActionWebMemoryStatsResult {
  entries: number;
  hits: number;
  misses: number;
  hitRate?: number;
  avgResolveMs?: number;
  indexedPages?: number;
  indexedActions?: number;
  indexedRoutes?: number;
  avgExecuteMs?: number;
}

export interface DesktopElement {
  id: number;
  role?: string;
  name?: string;
  value?: string;
}

export interface ActionDesktopSnapshotRequest {
  appName?: string;
  windowTitle?: string;
}

export interface ActionDesktopSnapshotResult {
  appName?: string;
  windowTitle?: string;
  elementCount: number;
  elements: DesktopElement[];
  note?: string;
}

export interface ActionDesktopFindRequest {
  appName?: string;
  windowTitle?: string;
  role?: string;
  name?: string;
}

export interface ActionDesktopFindResult {
  count: number;
  elements: DesktopElement[];
  note?: string;
}

export interface ActionDesktopClickRequest {
  elementId: number;
}

export interface ActionDesktopClickResult {
  ok: boolean;
  details?: Record<string, unknown>;
}

export interface ActionDesktopTypeRequest {
  text: string;
  elementId?: number;
}

export interface ActionDesktopTypeResult {
  ok: boolean;
  details?: Record<string, unknown>;
}

export interface ActionDesktopAppsResult {
  apps: Array<Record<string, unknown>>;
}

export interface ActionDesktopWindowsRequest {
  appName?: string;
}

export interface ActionDesktopWindowsResult {
  windows: Array<Record<string, unknown>>;
}

export type ActionApiParamsByMethod = {
  observe: KernelObserveRequest;
  act: KernelActRequest;
  verify: KernelVerifyRequest;
  "desktop.snapshot": ActionDesktopSnapshotRequest;
  "desktop.find": ActionDesktopFindRequest;
  "desktop.click": ActionDesktopClickRequest;
  "desktop.type": ActionDesktopTypeRequest;
  "desktop.apps": Record<string, never>;
  "desktop.windows": ActionDesktopWindowsRequest;
  "route.run": ActionRouteRunRequest;
  "route.record.start": ActionRouteRecordStartRequest;
  "route.record.stop": ActionRouteRecordStopRequest;
  "web.memory.index": ActionWebMemoryIndexRequest;
  "web.memory.validate": ActionWebMemoryValidateRequest;
  "web.memory.resolve": ActionWebMemoryResolveRequest;
  "web.memory.execute": ActionWebMemoryExecuteRequest;
  "web.memory.invalidate": ActionWebMemoryInvalidateRequest;
  "web.memory.stats": ActionWebMemoryStatsRequest;
};

export type ActionApiResultByMethod = {
  observe: KernelObserveResult;
  act: KernelActResult;
  verify: KernelVerifyResult;
  "desktop.snapshot": ActionDesktopSnapshotResult;
  "desktop.find": ActionDesktopFindResult;
  "desktop.click": ActionDesktopClickResult;
  "desktop.type": ActionDesktopTypeResult;
  "desktop.apps": ActionDesktopAppsResult;
  "desktop.windows": ActionDesktopWindowsResult;
  "route.run": ActionRouteRunResult;
  "route.record.start": ActionRouteRecordStartResult;
  "route.record.stop": ActionRouteRecordStopResult;
  "web.memory.index": ActionWebMemoryIndexResult;
  "web.memory.validate": ActionWebMemoryValidateResult;
  "web.memory.resolve": ActionWebMemoryResolveResult;
  "web.memory.execute": ActionWebMemoryExecuteResult;
  "web.memory.invalidate": ActionWebMemoryInvalidateResult;
  "web.memory.stats": ActionWebMemoryStatsResult;
};

export interface ActionApiRequestEnvelope<M extends ActionApiMethod = ActionApiMethod> {
  specVersion: ActionKernelSpecVersion;
  method: M;
  id?: string;
  params: ActionApiParamsByMethod[M];
}

export interface ActionApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ActionApiResponseEnvelope<M extends ActionApiMethod = ActionApiMethod> {
  specVersion: ActionKernelSpecVersion;
  method: M;
  id?: string;
  ok: boolean;
  result?: ActionApiResultByMethod[M];
  error?: ActionApiError;
}
