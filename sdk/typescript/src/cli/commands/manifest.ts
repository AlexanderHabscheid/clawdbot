/**
 * @centris/sdk - Manifest CLI Commands
 *
 * Helpers for creating and validating centris site manifests.
 */

import fs from "node:fs";
import path from "node:path";
import type { CLIContext, ManifestInitOptions, ManifestValidateOptions } from "../types.js";
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
    centris: "1.0",
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
