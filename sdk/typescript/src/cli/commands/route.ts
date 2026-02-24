import fs from "node:fs";
import path from "node:path";
import type {
  CLIContext,
  RouteRecordOptions,
  RouteRunOptions,
  RouteTestOptions,
} from "../types.js";
import { Centris } from "../../client/index.js";
import { PlaywrightActionKernel } from "../../kernel/index.js";
import {
  type CentrisManifest,
  type ManifestActionStep,
  type ManifestSuccessCheck,
  validateManifest,
  validateManifestPolicy,
  ManifestStore,
} from "../../manifest/index.js";

function safeParseJson<T>(raw: string | undefined, fallback: T): T {
  if (!raw || !raw.trim()) {
    return fallback;
  }
  return JSON.parse(raw) as T;
}

function defaultManifestPath(cwd: string, app: string): string {
  return path.join(cwd, "connectors", app, "centris.json");
}

function parseSteps(raw: string): ManifestActionStep[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("steps must be a JSON array");
  }
  return parsed as ManifestActionStep[];
}

function readManifest(filePath: string): CentrisManifest {
  const abs = path.resolve(filePath);
  const raw = fs.readFileSync(abs, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  const validated = validateManifest(parsed);
  if (!validated) {
    throw new Error(`Invalid manifest: ${abs}`);
  }
  const policy = validateManifestPolicy(validated, { strict: true, targetVersion: "2.0" });
  if (!policy.ok) {
    const errors = policy.issues
      .filter((issue) => issue.level === "error")
      .map((issue) => issue.message)
      .join(" | ");
    throw new Error(`Manifest policy validation failed: ${errors}`);
  }
  return policy.normalized;
}

function writeManifest(filePath: string, manifest: CentrisManifest): void {
  const abs = path.resolve(filePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
}

export async function recordRoute(options: RouteRecordOptions, ctx: CLIContext): Promise<void> {
  const app = options.app.trim().toLowerCase();
  const outPath = path.resolve(ctx.cwd, options.out ?? defaultManifestPath(ctx.cwd, app));
  const steps = parseSteps(options.steps);
  const params = safeParseJson<string[] | undefined>(options.params, undefined);
  const checks = safeParseJson<ManifestSuccessCheck[] | undefined>(options.checks, undefined);
  const fallbackChains = safeParseJson<string[][] | undefined>(options.fallbackChains, undefined);

  const manifest: CentrisManifest = fs.existsSync(outPath)
    ? readManifest(outPath)
    : {
        centris: "2.0",
        app,
        description: `${app} route manifest`,
        url_patterns: [options.urlPattern],
        routes: {},
      };

  if (!manifest.url_patterns.includes(options.urlPattern)) {
    manifest.url_patterns.push(options.urlPattern);
  }
  manifest.centris = "2.0";

  const route = manifest.routes[options.routePattern] ?? {};
  route.actions = route.actions ?? {};

  route.actions[options.action] = {
    description: options.description,
    params,
    steps,
    successChecks: checks,
    safetyLevel:
      options.safetyLevel === "read" ||
      options.safetyLevel === "write" ||
      options.safetyLevel === "destructive"
        ? options.safetyLevel
        : undefined,
    confidence:
      typeof options.confidence === "number" && Number.isFinite(options.confidence)
        ? Math.max(0, Math.min(1, options.confidence))
        : undefined,
    lastVerifiedAt: new Date().toISOString(),
    fallbackChains,
  };

  manifest.routes[options.routePattern] = route;
  writeManifest(outPath, manifest);
  ctx.logger.success(`Recorded route ${options.action} in ${outPath}`);
}

type ResolvedRoute = {
  manifest: CentrisManifest;
  routeKey: string;
  actionName: string;
};

function resolveRouteForUrl(params: {
  manifest: CentrisManifest;
  url: string;
  action: string;
}): ResolvedRoute {
  const store = new ManifestStore([
    {
      manifest: params.manifest,
      source: "inline",
      sourceKind: "workspace",
      trusted: true,
      trustReason: "inline",
      diagnostics: [],
    },
  ]);
  const resolved = store.resolve(params.url);
  if (!resolved) {
    throw new Error(`No manifest route matched URL: ${params.url}`);
  }
  const action = resolved.actions[params.action];
  if (!action) {
    throw new Error(`Action not found on matched route ${resolved.route}: ${params.action}`);
  }
  return {
    manifest: params.manifest,
    routeKey: resolved.route,
    actionName: params.action,
  };
}

function resolveManifestPath(cwd: string, optManifest: string | undefined): string {
  if (optManifest) {
    return path.resolve(cwd, optManifest);
  }
  return path.resolve(cwd, "centris.json");
}

function printRoutePlan(
  ctx: CLIContext,
  manifest: CentrisManifest,
  routeKey: string,
  action: string,
): void {
  const route = manifest.routes[routeKey];
  const actionDef = route?.actions?.[action];
  if (!actionDef) {
    return;
  }
  ctx.logger.info(`Route: ${routeKey}`);
  ctx.logger.info(`Action: ${action}`);
  ctx.logger.info(`Steps: ${actionDef.steps.length}`);
  actionDef.steps.forEach((step, idx) => {
    ctx.logger.info(`  ${idx + 1}. ${JSON.stringify(step)}`);
  });
}

function buildRouteRuntimeId(manifest: CentrisManifest, routeKey: string, action: string): string {
  return `${manifest.app}:${routeKey}:${action}`;
}

async function executeWithPlaywright(options: {
  manifest: CentrisManifest;
  routeKey: string;
  action: string;
  url: string;
  params?: Record<string, string>;
  headful?: boolean;
  slowMo?: number;
}): Promise<{ ok: boolean; executed: number; verifyOk: boolean | null }> {
  const route = options.manifest.routes[options.routeKey];
  const actionDef = route?.actions?.[options.action];
  if (!actionDef) {
    throw new Error(`Action not found: ${options.action}`);
  }

  const kernel = new PlaywrightActionKernel({
    headless: options.headful !== true,
    slowMo: options.slowMo,
  });

  try {
    const result = await kernel.route({
      id: options.action,
      url: options.url,
      steps: actionDef.steps,
      params: options.params,
      checks: actionDef.successChecks,
      fallbackChains: actionDef.fallbackChains,
    });
    return {
      ok: result.ok,
      executed: result.executed,
      verifyOk: result.verify?.ok ?? null,
    };
  } finally {
    await kernel.teardown();
  }
}

async function executeWithRuntime(options: {
  manifest: CentrisManifest;
  routeKey: string;
  action: string;
  url: string;
  params?: Record<string, string>;
  checks?: ManifestSuccessCheck[];
  apiKey?: string;
  baseUrl?: string;
  apiVersion?: string;
  timeoutMs?: number;
}): Promise<{ ok: boolean; executed: number; verifyOk: boolean | null }> {
  const client = new Centris({
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    apiVersion: options.apiVersion,
    timeoutMs: options.timeoutMs,
  });

  const result = await client.routeRun({
    routeId: buildRouteRuntimeId(options.manifest, options.routeKey, options.action),
    url: options.url,
    params: options.params,
    checks: options.checks,
  });

  return {
    ok: result.ok,
    executed: result.executed,
    verifyOk: result.verify?.ok ?? null,
  };
}

function updateActionVerificationState(params: {
  manifestPath: string;
  manifest: CentrisManifest;
  routeKey: string;
  action: string;
  verifyOk: boolean | null;
}): void {
  const route = params.manifest.routes[params.routeKey];
  const actionDef = route?.actions?.[params.action];
  if (!actionDef) {
    return;
  }

  const prior = actionDef.confidence ?? 0.5;
  const nextConfidence =
    params.verifyOk == null
      ? prior
      : params.verifyOk
        ? Math.min(1, prior + 0.05)
        : Math.max(0, prior - 0.1);

  route.actions![params.action] = {
    ...actionDef,
    confidence: Number(nextConfidence.toFixed(3)),
    lastVerifiedAt: new Date().toISOString(),
  };

  writeManifest(params.manifestPath, params.manifest);
}

export async function runRoute(options: RouteRunOptions, ctx: CLIContext): Promise<void> {
  const manifestPath = resolveManifestPath(ctx.cwd, options.manifest);
  const manifest = readManifest(manifestPath);
  const resolved = resolveRouteForUrl({ manifest, url: options.url, action: options.action });
  const params = safeParseJson<Record<string, string> | undefined>(options.params, undefined);

  printRoutePlan(ctx, manifest, resolved.routeKey, resolved.actionName);

  const actionDef = manifest.routes[resolved.routeKey]?.actions?.[resolved.actionName];
  if (!actionDef) {
    throw new Error(`Action missing after resolve: ${resolved.actionName}`);
  }
  if (actionDef.safetyLevel === "destructive" && options.allowDestructive !== true) {
    throw new Error(
      `Action ${resolved.routeKey}:${resolved.actionName} is destructive; re-run with --allow-destructive`,
    );
  }
  const checks = actionDef.successChecks;

  const result = options.playwright
    ? await executeWithPlaywright({
        manifest,
        routeKey: resolved.routeKey,
        action: resolved.actionName,
        url: options.url,
        params,
        headful: options.headful,
        slowMo: options.slowMo,
      })
    : await executeWithRuntime({
        manifest,
        routeKey: resolved.routeKey,
        action: resolved.actionName,
        url: options.url,
        params,
        checks,
        apiKey: options.apiKey,
        baseUrl: options.baseUrl,
        apiVersion: options.apiVersion,
        timeoutMs: options.timeoutMs,
      });

  if (!result.ok) {
    throw new Error(
      `Route run failed (executed=${result.executed}, verify=${String(result.verifyOk)})`,
    );
  }

  updateActionVerificationState({
    manifestPath,
    manifest,
    routeKey: resolved.routeKey,
    action: resolved.actionName,
    verifyOk: result.verifyOk,
  });

  ctx.logger.success(`Route executed successfully (steps=${result.executed})`);
}

export async function testRoute(options: RouteTestOptions, ctx: CLIContext): Promise<void> {
  if (!options.playwright) {
    throw new Error("Route test requires --playwright.");
  }
  await runRoute(options, ctx);
}
