/**
 * @centris/sdk - Action Kernel Types
 *
 * Versioned contract for deterministic action execution.
 */

export const ACTION_KERNEL_SPEC_VERSION = "2026-02-19" as const;
export type ActionKernelSpecVersion = typeof ACTION_KERNEL_SPEC_VERSION;

export type KernelActionKind = "navigate" | "click" | "type" | "press" | "wait" | "scroll";

export type KernelRouteStep =
  | { navigate: string }
  | { click: string }
  | { type: { target: string; value: string } }
  | { press: string }
  | { wait: number }
  | { scroll: "up" | "down"; amount?: number };

export type KernelSuccessCheck =
  | { type: "url_contains"; value: string }
  | { type: "text_present"; value: string }
  | { type: "element_visible"; value: string }
  | { type: "download"; value?: string }
  | { type: "network_url_contains"; value: string };

export interface KernelObserveRequest {
  url?: string;
  instruction?: string;
}

export interface KernelObserveResult {
  url: string;
  title?: string;
  interactive?: Array<{
    name: string;
    nodeId?: number;
    type?: string;
    role?: string;
    /** @deprecated Runtime actions should use nodeId, not selector strings. */
    selector?: string;
  }>;
}

export interface KernelActRequest {
  kind: KernelActionKind;
  /** Preferred for click/type actions when available from observe(). */
  nodeId?: number;
  target?: string;
  value?: string;
  amount?: number;
}

export interface KernelActResult {
  ok: boolean;
  details?: Record<string, unknown>;
}

export interface KernelVerifyRequest {
  checks: KernelSuccessCheck[];
}

export interface KernelVerifyResult {
  ok: boolean;
  passed: KernelSuccessCheck[];
  failed: KernelSuccessCheck[];
}

export interface KernelRouteRequest {
  id: string;
  url?: string;
  steps: KernelRouteStep[];
  params?: Record<string, string>;
  checks?: KernelSuccessCheck[];
  fallbackChains?: string[][];
}

export interface KernelRouteResult {
  ok: boolean;
  executed: number;
  verify?: KernelVerifyResult;
}

export interface KernelLearnRequest {
  id: string;
  urlPattern: string;
  steps: KernelRouteStep[];
  checks?: KernelSuccessCheck[];
  fallbackChains?: string[][];
}

export interface KernelLearnResult {
  ok: boolean;
  routeId: string;
  version: ActionKernelSpecVersion;
}

export interface ActionKernel {
  readonly version: ActionKernelSpecVersion;
  observe(request: KernelObserveRequest): Promise<KernelObserveResult>;
  act(request: KernelActRequest): Promise<KernelActResult>;
  verify(request: KernelVerifyRequest): Promise<KernelVerifyResult>;
  route(request: KernelRouteRequest): Promise<KernelRouteResult>;
  learn(request: KernelLearnRequest): Promise<KernelLearnResult>;
}
