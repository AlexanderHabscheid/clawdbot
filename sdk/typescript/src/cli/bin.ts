#!/usr/bin/env node
/**
 * @centris/sdk CLI
 *
 * Command-line interface for Centris connector development.
 *
 * Usage:
 *   centris init <id>          Initialize a new connector project
 *   centris validate [path]    Validate a connector
 *   centris test [path]        Test a connector
 *   centris serve [path]       Start development server
 *   centris publish [path]     Publish to registry
 */

import { runCLI } from "./program.js";

runCLI().catch((err) => {
  console.error("CLI Error:", err);
  process.exit(1);
});
