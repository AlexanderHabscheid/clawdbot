/**
 * @centris/sdk - CLI Types
 */

export interface CLIOptions {
  /** Working directory */
  cwd?: string;
  /** Verbose output */
  verbose?: boolean;
  /** Config file path */
  config?: string;
}

export interface InitOptions extends CLIOptions {
  /** Connector ID */
  id: string;
  /** Connector name */
  name?: string;
  /** Connector description */
  description?: string;
  /** Language: typescript or python */
  language?: "typescript" | "python";
  /** Template to use */
  template?: "basic" | "oauth" | "browser" | "desktop";
  /** Skip prompts, use defaults */
  yes?: boolean;
}

export interface ValidateOptions extends CLIOptions {
  /** Path to connector */
  path?: string;
  /** Strict validation */
  strict?: boolean;
}

export interface TestOptions extends CLIOptions {
  /** Path to connector */
  path?: string;
  /** Capability ID to test */
  capability?: string;
  /** Test parameters as JSON */
  params?: string;
  /** Run all tests */
  all?: boolean;
  /** Watch mode */
  watch?: boolean;
}

export interface ServeOptions extends CLIOptions {
  /** Path to connector */
  path?: string;
  /** Port to serve on */
  port?: number;
  /** Host to bind to */
  host?: string;
  /** Enable hot reload */
  watch?: boolean;
  /** Open browser */
  open?: boolean;
}

export interface PublishOptions extends CLIOptions {
  /** Path to connector */
  path?: string;
  /** Registry URL */
  registry?: string;
  /** API key for authentication */
  apiKey?: string;
  /** Dry run (don't actually publish) */
  dryRun?: boolean;
  /** Skip confirmation */
  yes?: boolean;
}

export interface CLIContext {
  cwd: string;
  verbose: boolean;
  logger: CLILogger;
}

export interface CLILogger {
  info: (message: string) => void;
  success: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
  debug: (message: string) => void;
}
