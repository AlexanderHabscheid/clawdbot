import type {
  CLIContext,
  DesktopAppsOptions,
  DesktopClickOptions,
  DesktopFindOptions,
  DesktopSnapshotOptions,
  DesktopTypeOptions,
  DesktopWindowsOptions,
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

export async function runDesktopSnapshotCommand(
  options: DesktopSnapshotOptions,
  ctx: CLIContext,
): Promise<void> {
  const startedAt = Date.now();
  const client = createClient(options);
  const result = await client.desktopSnapshot({
    appName: options.appName,
    windowTitle: options.windowTitle,
  });

  if (options.json) {
    printCliResultEnvelope(
      createCliResultEnvelope({
        ok: true,
        operation: "desktop.snapshot",
        summary: `Captured ${result.elementCount} desktop elements`,
        data: result,
        durationMs: Date.now() - startedAt,
      }),
    );
    return;
  }

  ctx.logger.success(`Captured ${result.elementCount} desktop elements`);
  if (result.appName) {
    ctx.logger.info(`App: ${result.appName}`);
  }
  if (result.windowTitle) {
    ctx.logger.info(`Window: ${result.windowTitle}`);
  }
}

export async function runDesktopFindCommand(
  options: DesktopFindOptions,
  ctx: CLIContext,
): Promise<void> {
  const startedAt = Date.now();
  const client = createClient(options);
  const result = await client.desktopFind({
    appName: options.appName,
    windowTitle: options.windowTitle,
    role: options.role,
    name: options.name,
  });

  if (options.json) {
    printCliResultEnvelope(
      createCliResultEnvelope({
        ok: true,
        operation: "desktop.find",
        summary: `Matched ${result.count} desktop elements`,
        data: result,
        durationMs: Date.now() - startedAt,
      }),
    );
    return;
  }

  ctx.logger.success(`Matched ${result.count} desktop elements`);
}

export async function runDesktopClickCommand(
  options: DesktopClickOptions,
  ctx: CLIContext,
): Promise<void> {
  const startedAt = Date.now();
  const client = createClient(options);
  const result = await client.desktopClick({ elementId: options.elementId });

  if (options.json) {
    printCliResultEnvelope(
      createCliResultEnvelope({
        ok: result.ok,
        operation: "desktop.click",
        summary: result.ok ? `Clicked element ${options.elementId}` : "Desktop click failed",
        data: result,
        errors: result.ok ? [] : ["Desktop click failed"],
        durationMs: Date.now() - startedAt,
      }),
    );
    return;
  }

  if (!result.ok) {
    ctx.logger.error("Desktop click failed");
    process.exit(1);
  }
  ctx.logger.success(`Clicked element ${options.elementId}`);
}

export async function runDesktopTypeCommand(
  options: DesktopTypeOptions,
  ctx: CLIContext,
): Promise<void> {
  const startedAt = Date.now();
  const client = createClient(options);
  const result = await client.desktopType({ text: options.text, elementId: options.elementId });

  if (options.json) {
    printCliResultEnvelope(
      createCliResultEnvelope({
        ok: result.ok,
        operation: "desktop.type",
        summary: result.ok ? "Desktop typing succeeded" : "Desktop typing failed",
        data: result,
        errors: result.ok ? [] : ["Desktop typing failed"],
        durationMs: Date.now() - startedAt,
      }),
    );
    return;
  }

  if (!result.ok) {
    ctx.logger.error("Desktop typing failed");
    process.exit(1);
  }
  ctx.logger.success("Desktop typing succeeded");
}

export async function runDesktopAppsCommand(
  options: DesktopAppsOptions,
  ctx: CLIContext,
): Promise<void> {
  const startedAt = Date.now();
  const client = createClient(options);
  const result = await client.desktopApps();

  if (options.json) {
    printCliResultEnvelope(
      createCliResultEnvelope({
        ok: true,
        operation: "desktop.apps",
        summary: `Listed ${result.apps.length} apps`,
        data: result,
        durationMs: Date.now() - startedAt,
      }),
    );
    return;
  }

  ctx.logger.success(`Listed ${result.apps.length} apps`);
}

export async function runDesktopWindowsCommand(
  options: DesktopWindowsOptions,
  ctx: CLIContext,
): Promise<void> {
  const startedAt = Date.now();
  const client = createClient(options);
  const result = await client.desktopWindows({ appName: options.appName });

  if (options.json) {
    printCliResultEnvelope(
      createCliResultEnvelope({
        ok: true,
        operation: "desktop.windows",
        summary: `Listed ${result.windows.length} windows`,
        data: result,
        durationMs: Date.now() - startedAt,
      }),
    );
    return;
  }

  ctx.logger.success(`Listed ${result.windows.length} windows`);
}
