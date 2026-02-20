/**
 * @centris/sdk - Manifest CLI Commands
 *
 * Helpers for creating and validating centris site manifests.
 */

import fs from "node:fs";
import path from "node:path";
import type { CentrisManifest } from "../../manifest/types.js";
import type {
  CLIContext,
  ManifestDoctorOptions,
  ManifestInitOptions,
  ManifestPublishOptions,
  ManifestValidateOptions,
} from "../types.js";
import { validateManifest } from "../../manifest/loader.js";

function toSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function defaultOutputPath(cwd: string, app: string): string {
  return path.join(cwd, "connectors", toSlug(app), "centris.json");
}

/**
 * Create a starter manifest file.
 */
export async function initManifest(options: ManifestInitOptions, ctx: CLIContext): Promise<void> {
  const app = options.app.trim();
  if (!app) {
    throw new Error("App name is required.");
  }

  const outPath = path.resolve(ctx.cwd, options.out ?? defaultOutputPath(ctx.cwd, app));
  const outDir = path.dirname(outPath);
  if (fs.existsSync(outPath) && !options.force) {
    throw new Error(`Manifest already exists at ${outPath}. Re-run with --force to overwrite.`);
  }

  fs.mkdirSync(outDir, { recursive: true });

  const urlPatterns =
    options.urlPatterns && options.urlPatterns.length > 0
      ? options.urlPatterns
      : [`${toSlug(app)}.com/*`];
  const manifest = {
    centris: "2.0",
    app: toSlug(app),
    description: options.description ?? `${app} site map for Centris automation`,
    url_patterns: urlPatterns,
    routes: {
      "/": {
        landmarks: {
          primary_action: {
            role: "button",
            selectors: ["[data-testid='primary-action']", "[aria-label='Primary action']"],
            stability: "stable",
            description: "Main action button on the landing page",
          },
        },
        actions: {
          primary_flow: {
            description: "Example action recipe",
            params: ["text"],
            steps: [
              { click: "primary_action" },
              { type: { target: "primary_action", value: "{{text}}" } },
            ],
          },
        },
      },
    },
  };

  fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
  ctx.logger.success(`Created manifest: ${outPath}`);
}

/**
 * Validate a manifest file.
 */
export async function validateManifestFile(
  options: ManifestValidateOptions,
  ctx: CLIContext,
): Promise<void> {
  const file = path.resolve(ctx.cwd, options.file ?? "centris.json");
  if (!fs.existsSync(file)) {
    throw new Error(`Manifest not found: ${file}`);
  }

  const raw = fs.readFileSync(file, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in ${file}: ${String(err)}`, { cause: err });
  }

  const manifest = validateManifest(parsed);
  if (!manifest) {
    throw new Error(`Invalid Centris manifest structure: ${file}`);
  }

  if (options.strict) {
    const hasRoutes = Object.keys(manifest.routes).length > 0;
    const hasContent = Object.values(manifest.routes).some(
      (route) =>
        Object.keys(route.landmarks ?? {}).length > 0 ||
        Object.keys(route.actions ?? {}).length > 0,
    );

    if (!hasRoutes || !hasContent) {
      throw new Error(
        `Strict validation failed: manifest must include at least one route with landmarks or actions (${file}).`,
      );
    }
  }

  ctx.logger.success(`Manifest is valid: ${file}`);
}

function parseManifestFromFile(filePath: string): CentrisManifest {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Manifest not found: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in ${filePath}: ${String(err)}`, { cause: err });
  }

  const manifest = validateManifest(parsed);
  if (!manifest) {
    throw new Error(`Invalid Centris manifest structure: ${filePath}`);
  }
  return manifest;
}

type ManifestDiagnostics = {
  app: string;
  file: string;
  routeCount: number;
  actionCount: number;
  landmarkCount: number;
  hostPatterns: string[];
  warnings: string[];
  errors: string[];
};

function parsePatternHost(pattern: string): string | null {
  const trimmed = pattern.trim();
  if (!trimmed) {
    return null;
  }
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    return url.hostname.replace(/^\*\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function collectManifestDiagnostics(file: string, manifest: CentrisManifest): ManifestDiagnostics {
  const warnings: string[] = [];
  const errors: string[] = [];

  const hostPatterns = manifest.url_patterns
    .map(parsePatternHost)
    .filter((host): host is string => Boolean(host));
  const uniqueHosts = [...new Set(hostPatterns)];

  if (uniqueHosts.length === 0) {
    errors.push("No valid host patterns found in url_patterns.");
  }

  const routeEntries = Object.entries(manifest.routes);
  let actionCount = 0;
  let landmarkCount = 0;

  for (const [routeKey, route] of routeEntries) {
    const actions = Object.entries(route.actions ?? {});
    const landmarks = Object.entries(route.landmarks ?? {});
    actionCount += actions.length;
    landmarkCount += landmarks.length;

    if (actions.length === 0 && landmarks.length === 0) {
      warnings.push(`Route "${routeKey}" has no landmarks or actions.`);
    }

    for (const [actionName, action] of actions) {
      if (!action.successChecks || action.successChecks.length === 0) {
        warnings.push(`Action "${routeKey}:${actionName}" has no success checks.`);
      }
      if (typeof action.confidence !== "number") {
        warnings.push(`Action "${routeKey}:${actionName}" is missing confidence.`);
      }
    }

    for (const [landmarkName, landmark] of landmarks) {
      if (landmark.stability === "fragile") {
        warnings.push(`Landmark "${routeKey}:${landmarkName}" is marked fragile.`);
      }
      if (landmark.selectors.length > 8) {
        warnings.push(
          `Landmark "${routeKey}:${landmarkName}" has ${landmark.selectors.length} selectors.`,
        );
      }
    }
  }

  if (actionCount === 0) {
    errors.push("Manifest defines no actions.");
  }

  return {
    app: manifest.app,
    file,
    routeCount: routeEntries.length,
    actionCount,
    landmarkCount,
    hostPatterns: uniqueHosts,
    warnings,
    errors,
  };
}

export async function doctorManifest(
  options: ManifestDoctorOptions,
  ctx: CLIContext,
): Promise<void> {
  const file = path.resolve(ctx.cwd, options.file ?? "centris.json");
  const manifest = parseManifestFromFile(file);
  const report = collectManifestDiagnostics(file, manifest);
  const ok = report.errors.length === 0 && (!options.strict || report.warnings.length === 0);

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok,
          operation: "manifest.doctor",
          summary: ok ? "Manifest passed diagnostics" : "Manifest has diagnostics",
          data: report,
          warnings: report.warnings,
          errors: report.errors,
          meta: { profile: "centris", connector_id: manifest.app },
        },
        null,
        2,
      )}\n`,
    );
    if (!ok) {
      process.exitCode = 2;
    }
    return;
  }

  ctx.logger.info(`Manifest: ${report.file}`);
  ctx.logger.info(
    `Routes=${report.routeCount}, Actions=${report.actionCount}, Landmarks=${report.landmarkCount}`,
  );
  ctx.logger.info(`Hosts: ${report.hostPatterns.join(", ") || "(none)"}`);

  for (const warning of report.warnings) {
    ctx.logger.warn(warning);
  }
  for (const error of report.errors) {
    ctx.logger.error(error);
  }

  if (!ok) {
    throw new Error(
      options.strict
        ? "Manifest doctor failed (strict mode)."
        : "Manifest doctor found blocking issues.",
    );
  }
  ctx.logger.success("Manifest doctor passed.");
}

function ensureWritableOutput(filePath: string, force: boolean): void {
  if (fs.existsSync(filePath) && !force) {
    throw new Error(`Output exists: ${filePath}. Re-run with --force to overwrite.`);
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export async function publishManifest(
  options: ManifestPublishOptions,
  ctx: CLIContext,
): Promise<void> {
  const file = path.resolve(ctx.cwd, options.file ?? "centris.json");
  const manifest = parseManifestFromFile(file);
  const diagnostics = collectManifestDiagnostics(file, manifest);
  if (diagnostics.errors.length > 0) {
    throw new Error(`Manifest publish blocked: ${diagnostics.errors.join(" ")}`);
  }

  const outputs: string[] = [];
  const wellKnownOut = path.resolve(ctx.cwd, options.wellKnownOut ?? ".well-known/centris.json");
  outputs.push(wellKnownOut);

  let connectorManifestOut: string | null = null;
  let connectorReadmeOut: string | null = null;
  if (options.connectorOutDir) {
    const connectorDir = path.resolve(ctx.cwd, options.connectorOutDir);
    connectorManifestOut = path.join(connectorDir, "centris.json");
    connectorReadmeOut = path.join(connectorDir, "README.md");
    outputs.push(connectorManifestOut, connectorReadmeOut);
  }

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          operation: "manifest.publish",
          summary: options.dryRun ? "Dry-run publish plan" : "Manifest published",
          data: {
            app: manifest.app,
            source: file,
            outputs,
            dryRun: Boolean(options.dryRun),
          },
          warnings: diagnostics.warnings,
          errors: [],
        },
        null,
        2,
      )}\n`,
    );
    if (options.dryRun) {
      return;
    }
  }

  if (options.dryRun) {
    ctx.logger.info(`Dry run: ${outputs.join(", ")}`);
    return;
  }

  ensureWritableOutput(wellKnownOut, Boolean(options.force));
  fs.writeFileSync(wellKnownOut, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");

  if (connectorManifestOut && connectorReadmeOut) {
    ensureWritableOutput(connectorManifestOut, Boolean(options.force));
    ensureWritableOutput(connectorReadmeOut, Boolean(options.force));
    fs.writeFileSync(connectorManifestOut, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
    const readme = [
      `# ${manifest.app} Centris Manifest`,
      "",
      "This package exposes a `centris.json` website manifest for Centris pre-injection.",
      "",
      "## Usage",
      "",
      "- Host this file at `/.well-known/centris.json`, or",
      "- Distribute this package to Centris users and load as an extra manifest path.",
      "",
    ].join("\n");
    fs.writeFileSync(connectorReadmeOut, `${readme}\n`, "utf-8");
  }

  ctx.logger.success(`Published manifest to ${wellKnownOut}`);
  if (connectorManifestOut) {
    ctx.logger.success(
      `Published connector package files to ${path.dirname(connectorManifestOut)}`,
    );
  }
}
