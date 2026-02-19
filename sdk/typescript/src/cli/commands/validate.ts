/**
 * @centris/sdk - CLI Validate Command
 *
 * Validate a connector's schema and configuration.
 */

import { createJiti } from "jiti";
import fs from "node:fs";
import path from "node:path";
import type { CentrisConnectorDefinition } from "../../plugin/types.js";
import type { ValidateOptions, CLIContext } from "../types.js";

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export async function validateConnector(options: ValidateOptions, ctx: CLIContext): Promise<void> {
  const { logger } = ctx;
  const connectorPath = path.resolve(ctx.cwd, options.path ?? ".");

  logger.info(`Validating connector at ${connectorPath}`);

  const result: ValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
  };

  // Check for package.json or pyproject.toml
  const packageJsonPath = path.join(connectorPath, "package.json");
  const pyprojectPath = path.join(connectorPath, "pyproject.toml");

  let isTypeScript = false;

  if (fs.existsSync(packageJsonPath)) {
    isTypeScript = true;
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));

    // Check for centrisConnector field
    if (!pkg.centrisConnector) {
      result.warnings.push("Missing 'centrisConnector' field in package.json");
    } else {
      if (!pkg.centrisConnector.id) {
        result.errors.push("Missing 'centrisConnector.id' in package.json");
        result.valid = false;
      }
    }

    // Check for required keywords
    const keywords = pkg.keywords ?? [];
    if (!keywords.includes("centris-connector")) {
      result.warnings.push("Missing 'centris-connector' keyword in package.json");
    }

    // Check main entry
    if (!pkg.main) {
      result.errors.push("Missing 'main' field in package.json");
      result.valid = false;
    }
  } else if (fs.existsSync(pyprojectPath)) {
    // Python project validation
    const content = fs.readFileSync(pyprojectPath, "utf-8");
    if (!content.includes("centris-sdk")) {
      result.warnings.push("Missing 'centris-sdk' dependency in pyproject.toml");
    }
  } else {
    result.errors.push("No package.json or pyproject.toml found. Is this a connector project?");
    result.valid = false;
  }

  // Try to load and validate the connector module
  if (isTypeScript && result.valid) {
    try {
      const jiti = createJiti(import.meta.url, { interopDefault: true });

      // Find the main file
      const mainCandidates = [
        path.join(connectorPath, "src", "index.ts"),
        path.join(connectorPath, "src", "connector.ts"),
        path.join(connectorPath, "dist", "index.js"),
        path.join(connectorPath, "index.ts"),
        path.join(connectorPath, "index.js"),
      ];

      let mainFile: string | null = null;
      for (const candidate of mainCandidates) {
        if (fs.existsSync(candidate)) {
          mainFile = candidate;
          break;
        }
      }

      if (!mainFile) {
        result.errors.push("Could not find connector entry point");
        result.valid = false;
      } else {
        logger.debug?.(`Loading connector from ${mainFile}`);

        const mod = jiti(mainFile);
        const connector = mod.default ?? mod.connector ?? mod;

        if (typeof connector === "object" && connector !== null) {
          const def = connector as CentrisConnectorDefinition;

          // Validate connector definition
          if (!def.id && !def.name) {
            result.warnings.push("Connector missing 'id' and 'name'");
          }

          if (!def.register && !def.activate) {
            result.errors.push("Connector missing 'register' or 'activate' function");
            result.valid = false;
          }

          // Validate version format
          if (def.version && !/^\d+\.\d+\.\d+/.test(def.version)) {
            result.warnings.push(`Version '${def.version}' doesn't follow semver`);
          }

          logger.success(`Loaded connector: ${def.name ?? def.id ?? "unnamed"}`);
        } else {
          result.errors.push("Connector module doesn't export a valid definition");
          result.valid = false;
        }
      }
    } catch (err) {
      result.errors.push(`Failed to load connector: ${String(err)}`);
      result.valid = false;
    }
  }

  // Output results
  logger.info("");

  if (result.warnings.length > 0) {
    logger.warn(`${result.warnings.length} warning(s):`);
    for (const warning of result.warnings) {
      logger.warn(`  - ${warning}`);
    }
  }

  if (result.errors.length > 0) {
    logger.error(`${result.errors.length} error(s):`);
    for (const error of result.errors) {
      logger.error(`  - ${error}`);
    }
  }

  if (result.valid) {
    logger.success("Validation passed!");
  } else {
    logger.error("Validation failed!");
    process.exit(1);
  }
}
