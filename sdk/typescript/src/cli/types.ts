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

export interface DoOptions extends CLIOptions {
  /** Natural-language command */
  command: string;
  /** API key override */
  apiKey?: string;
  /** API base URL override */
  baseUrl?: string;
  /** API version override */
  apiVersion?: string;
  /** Run command async */
  asyncMode?: boolean;
  /** Poll until completion */
  wait?: boolean;
  /** Output raw JSON */
  json?: boolean;
  /** Request timeout */
  timeoutMs?: number;
  /** Poll interval when waiting */
  pollIntervalMs?: number;
  /** Optional execution context */
  context?: Record<string, unknown>;
}

export interface ObserveOptions extends CLIOptions {
  url?: string;
  instruction?: string;
  json?: boolean;
  apiKey?: string;
  baseUrl?: string;
  apiVersion?: string;
  timeoutMs?: number;
}

export interface ActOptions extends CLIOptions {
  kind: "navigate" | "click" | "type" | "press" | "wait" | "scroll";
  nodeId?: number;
  target?: string;
  value?: string;
  amount?: number;
  json?: boolean;
  apiKey?: string;
  baseUrl?: string;
  apiVersion?: string;
  timeoutMs?: number;
}

export interface VerifyOptions extends CLIOptions {
  checks: string;
  json?: boolean;
  apiKey?: string;
  baseUrl?: string;
  apiVersion?: string;
  timeoutMs?: number;
}

export interface RouteRunApiOptions extends CLIOptions {
  routeId: string;
  url?: string;
  params?: string;
  checks?: string;
  artifacts?: string;
  json?: boolean;
  apiKey?: string;
  baseUrl?: string;
  apiVersion?: string;
  timeoutMs?: number;
}

export interface RouteRecordStartApiOptions extends CLIOptions {
  intent: string;
  url?: string;
  params?: string;
  metadata?: string;
  json?: boolean;
  apiKey?: string;
  baseUrl?: string;
  apiVersion?: string;
  timeoutMs?: number;
}

export interface RouteRecordStopApiOptions extends CLIOptions {
  sessionId: string;
  outcome?: "success" | "failed" | "cancelled";
  metadata?: string;
  json?: boolean;
  apiKey?: string;
  baseUrl?: string;
  apiVersion?: string;
  timeoutMs?: number;
}

export interface WebMemoryIndexOptions extends CLIOptions {
  url: string;
  intent?: string;
  playbook?: string;
  ttlMs?: number;
  metadata?: string;
  json?: boolean;
  apiKey?: string;
  baseUrl?: string;
  apiVersion?: string;
  timeoutMs?: number;
}

export interface WebMemoryResolveOptions extends CLIOptions {
  url: string;
  intent?: string;
  maxAgeMs?: number;
  json?: boolean;
  apiKey?: string;
  baseUrl?: string;
  apiVersion?: string;
  timeoutMs?: number;
}

export interface WebMemoryExecuteOptions extends CLIOptions {
  url: string;
  intent?: string;
  operation?: string;
  params?: string;
  json?: boolean;
  apiKey?: string;
  baseUrl?: string;
  apiVersion?: string;
  timeoutMs?: number;
}

export interface WebMemoryInvalidateOptions extends CLIOptions {
  url?: string;
  playbookId?: string;
  scope?: "url" | "domain" | "all";
  reason?: string;
  yes?: boolean;
  json?: boolean;
  apiKey?: string;
  baseUrl?: string;
  apiVersion?: string;
  timeoutMs?: number;
}

export interface WebMemoryStatsOptions extends CLIOptions {
  url?: string;
  window?: "1h" | "24h" | "7d" | "30d";
  json?: boolean;
  apiKey?: string;
  baseUrl?: string;
  apiVersion?: string;
  timeoutMs?: number;
}

export interface ManifestInitOptions extends CLIOptions {
  /** App/site identifier */
  app: string;
  /** Output manifest file path */
  out?: string;
  /** URL patterns for matching pages */
  urlPatterns?: string[];
  /** Human-readable description */
  description?: string;
  /** Overwrite output file if it exists */
  force?: boolean;
}

export interface ManifestValidateOptions extends CLIOptions {
  /** Manifest file path */
  file?: string;
  /** Require at least one route with landmarks/actions */
  strict?: boolean;
}

export interface RouteRecordOptions extends CLIOptions {
  app: string;
  action: string;
  description: string;
  urlPattern: string;
  routePattern: string;
  steps: string;
  params?: string;
  checks?: string;
  fallbackChains?: string;
  out?: string;
  confidence?: number;
}

export interface RouteRunOptions extends CLIOptions {
  action: string;
  url: string;
  params?: string;
  manifest?: string;
  apiKey?: string;
  baseUrl?: string;
  apiVersion?: string;
  timeoutMs?: number;
  playwright?: boolean;
  headful?: boolean;
  slowMo?: number;
}

export interface RouteTestOptions extends RouteRunOptions {}

export interface AdapterRunOptions extends CLIOptions {
  adapter: string;
  operation: string;
  input?: string;
  timeoutMs?: number;
  dryRun?: boolean;
  allowExternal?: boolean;
  allowDestructive?: boolean;
  command?: string;
  args?: string;
  cwd?: string;
  env?: string;
  url?: string;
  method?: "POST" | "PUT" | "PATCH";
  headers?: string;
  module?: string;
  exportName?: string;
  json?: boolean;
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
