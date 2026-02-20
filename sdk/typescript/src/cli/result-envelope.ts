export type SafetyLevel = "read" | "write" | "external" | "destructive";

export interface CliArtifact {
  artifactType: string;
  schema: string;
  producerOperation: string;
  value: Record<string, unknown>;
}

export interface CliResultEnvelope<TData = unknown> {
  ok: boolean;
  operation: string;
  summary: string;
  data: TData;
  warnings: string[];
  errors: string[];
  artifacts?: CliArtifact[];
  meta: {
    durationMs: number;
    requestId: string;
    profile?: string;
    connectorId?: string;
    system?: string;
    systemVersion?: string;
    safetyLevel?: SafetyLevel;
    retryHint?: string;
  };
}

function generateRequestId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `req_${ts}_${rand}`;
}

export function createCliResultEnvelope<TData = unknown>(params: {
  ok: boolean;
  operation: string;
  summary: string;
  data: TData;
  warnings?: string[];
  errors?: string[];
  artifacts?: CliArtifact[];
  durationMs: number;
  requestId?: string;
  profile?: string;
  connectorId?: string;
  system?: string;
  systemVersion?: string;
  safetyLevel?: SafetyLevel;
  retryHint?: string;
}): CliResultEnvelope<TData> {
  return {
    ok: params.ok,
    operation: params.operation,
    summary: params.summary,
    data: params.data,
    warnings: params.warnings ?? [],
    errors: params.errors ?? [],
    ...(params.artifacts && params.artifacts.length > 0 ? { artifacts: params.artifacts } : {}),
    meta: {
      durationMs: Math.max(0, Math.floor(params.durationMs)),
      requestId: params.requestId ?? generateRequestId(),
      profile: params.profile,
      connectorId: params.connectorId,
      system: params.system,
      systemVersion: params.systemVersion,
      safetyLevel: params.safetyLevel,
      retryHint: params.retryHint,
    },
  };
}

export function printCliResultEnvelope(envelope: CliResultEnvelope): void {
  console.log(JSON.stringify(envelope, null, 2));
}
