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
  | "route.run"
  | "route.record.start"
  | "route.record.stop";

export interface ActionRouteRunRequest {
  routeId: string;
  url?: string;
  params?: Record<string, string>;
  checks?: KernelSuccessCheck[];
}

export interface ActionRouteRunResult {
  ok: boolean;
  executed: number;
  verify?: KernelVerifyResult;
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

export type ActionApiParamsByMethod = {
  observe: KernelObserveRequest;
  act: KernelActRequest;
  verify: KernelVerifyRequest;
  "route.run": ActionRouteRunRequest;
  "route.record.start": ActionRouteRecordStartRequest;
  "route.record.stop": ActionRouteRecordStopRequest;
};

export type ActionApiResultByMethod = {
  observe: KernelObserveResult;
  act: KernelActResult;
  verify: KernelVerifyResult;
  "route.run": ActionRouteRunResult;
  "route.record.start": ActionRouteRecordStartResult;
  "route.record.stop": ActionRouteRecordStopResult;
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
