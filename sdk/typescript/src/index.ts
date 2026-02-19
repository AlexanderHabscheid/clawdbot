/**
 * @centris/sdk - Main Entry Point
 *
 * The Centris SDK enables third-party developers to create connectors
 * that make their applications Centris-compatible.
 *
 * @example
 * ```typescript
 * import { Type } from '@centris/sdk';
 * import type { CentrisConnectorDefinition, CentrisConnectorApi } from '@centris/sdk';
 *
 * const SendMessageSchema = Type.Object({
 *   channel: Type.String({ minLength: 1 }),
 *   message: Type.String({ minLength: 1 }),
 * });
 *
 * export default {
 *   id: 'my-connector',
 *   name: 'My Connector',
 *   version: '1.0.0',
 *
 *   register(api: CentrisConnectorApi) {
 *     api.registerTool({
 *       name: 'send_message',
 *       description: 'Send a message',
 *       parameters: SendMessageSchema,
 *       async execute(toolCallId, params) {
 *         // Implementation
 *         return {
 *           content: [{ type: 'text', text: 'Message sent!' }],
 *         };
 *       },
 *     });
 *   },
 * } satisfies CentrisConnectorDefinition;
 * ```
 */

// =============================================================================
// Schema Exports (TypeBox)
// =============================================================================

export {
  // TypeBox re-exports
  Type,
  type Static,
  type TSchema,
  // String enum utilities
  stringEnum,
  optionalStringEnum,
  // Common primitives
  NonEmptyString,
  PositiveInteger,
  NonNegativeInteger,
  Timestamp,
  UrlString,
  EmailString,
  UuidString,
  // Execution & Auth
  ExecutionMethodValues,
  ExecutionMethodSchema,
  type ExecutionMethod,
  AuthSchemeValues,
  AuthSchemeSchema,
  type AuthScheme,
  // Response schemas
  ResponseMetadataSchema,
  type ResponseMetadata,
  SuccessResponseSchema,
  type SuccessResponse,
  ErrorDetailsSchema,
  type ErrorDetails,
  ErrorResponseSchema,
  type ErrorResponse,
  ExecutionResultSchema,
  type ExecutionResult,
  // Tool result schemas
  TextContentSchema,
  ImageContentSchema,
  ToolResultContentSchema,
  ToolResultSchema,
  type ToolResult,
  // Capability & Connector schemas
  CapabilitySchema,
  type Capability,
  OAuthConfigSchema,
  type OAuthConfig,
  ConnectorCardSchema,
  type ConnectorCard,
  // Validation utilities
  compileSchema,
  validate,
  validateOrThrow,
  type ValidationResult,
} from "./schema/typebox.js";

// =============================================================================
// Plugin Types & API
// =============================================================================

export type {
  // Browser automation interface (sandboxed - safe for third-party developers)
  BrowserBridge,
  BrowserOperationResult,
  BrowserTab,
  InteractiveElement,
  ScreenshotResult,
  // Logger
  ConnectorLogger,
  // Config
  ConnectorConfigUiHint,
  ConnectorConfigValidation,
  ConnectorConfigSchema,
  // Tool types
  ConnectorToolContext,
  CentrisTool,
  ConnectorToolFactory,
  // Gateway types
  GatewayRequestContext,
  GatewayRequestHandler,
  // CLI types
  ConnectorCliContext,
  ConnectorCliRegistrar,
  // Service types
  ConnectorServiceContext,
  ConnectorService,
  // Connector definition
  CentrisConnectorDefinition,
  CentrisConnectorModule,
  CentrisConnectorApi,
  // Origin & diagnostics
  ConnectorOrigin,
  ConnectorDiagnostic,
} from "./plugin/types.js";

export { createConnectorApi } from "./plugin/api.js";

// =============================================================================
// Config Types
// =============================================================================

export type {
  ConnectorConfigEntry,
  ConnectorsConfig,
  GatewayConfig,
  LoggingConfig,
  CentrisConfig,
  NormalizedConnectorsConfig,
} from "./config/types.js";

export {
  normalizeStringList,
  normalizeConnectorEntries,
  normalizeConnectorsConfig,
} from "./config/types.js";

// =============================================================================
// Loader & Registry
// =============================================================================

export {
  // Discovery
  discoverCentrisConnectors,
  CONFIG_DIR,
  NPM_CONNECTOR_PREFIX,
  resolveUserPath,
  type ConnectorCandidate,
  type ConnectorDiscoveryResult,
} from "./loader/discovery.js";

export {
  // Registry
  createConnectorRegistry,
  resolveConnectorTools,
  type ConnectorToolRegistration,
  type ConnectorCliRegistration,
  type ConnectorServiceRegistration,
  type ConnectorGatewayRegistration,
  type ConnectorRecord,
  type ConnectorRegistry,
  type CreateConnectorRegistryParams,
  type CreateConnectorRegistryResult,
} from "./loader/registry.js";

export {
  // Loader
  loadCentrisConnectors,
  invalidateConnectorCache,
  type ConnectorLoadOptions,
  type ConnectorLoadResult,
} from "./loader/loader.js";

// =============================================================================
// Validation
// =============================================================================

export {
  validateConnectorConfig,
  extractConfigUiHints,
  createConfigSchema,
  anyObjectSchema,
  mergeConfigSchemas,
  type ConfigValidationResult,
} from "./validation/config.js";

// =============================================================================
// Tool Utilities
// =============================================================================

export {
  // Parameter reading
  readStringParam,
  readStringOrNumberParam,
  readNumberParam,
  readBooleanParam,
  readStringArrayParam,
  type StringParamOptions,
  // Result builders
  jsonResult,
  textResult,
  errorResult,
  imageResult,
  successResult,
  // Action gate
  createActionGate,
  type ActionGate,
  // Utilities
  sleep,
  retry,
  truncate,
  formatBytes,
} from "./tools/common.js";

// =============================================================================
// MCP Gateway
// =============================================================================

export {
  CentrisMCPGateway,
  createMCPGateway,
  MCPServer,
  createMCPServer,
  type MCPGatewayOptions,
  type MCPServerOptions,
  type RegisteredConnector,
  type MCPToolCall,
  type MCPToolResult,
  type MCPResource,
} from "./gateway/index.js";

// =============================================================================
// Execution Engine
// =============================================================================

export {
  ExecutionEngine,
  createExecutionEngine,
  ExecutionRouter,
  createExecutionRouter,
  APIExecutor,
  BrowserExecutor,
  DesktopExecutor,
  // Result helper functions (inspired by clawdbot patterns)
  executorSuccess,
  executorError,
  type ExecutionPlan,
  type ExecutionMethod as ExecutorMethod,
  type ExecutionOptions,
  type ExecutorContext,
  type ExecutorResult,
  type ExecutorError,
  type ExecutorMetadata,
  type UIMapping,
} from "./execution/index.js";

// =============================================================================
// Action Kernel
// =============================================================================

export {
  ACTION_KERNEL_SPEC_VERSION,
  PlaywrightActionKernel,
  type ActionKernelSpecVersion,
  type ActionKernel,
  type KernelActionKind,
  type KernelRouteStep,
  type KernelSuccessCheck,
  type KernelObserveRequest,
  type KernelObserveResult,
  type KernelActRequest,
  type KernelActResult,
  type KernelVerifyRequest,
  type KernelVerifyResult,
  type KernelRouteRequest,
  type KernelRouteResult,
  type KernelLearnRequest,
  type KernelLearnResult,
} from "./kernel/index.js";

// =============================================================================
// Action API Contract
// =============================================================================

export {
  ACTION_API_SPEC_VERSION,
  type ActionApiMethod,
  type ActionRouteRunRequest,
  type ActionRouteRunResult,
  type ActionRouteRecordStartRequest,
  type ActionRouteRecordStartResult,
  type ActionRouteRecordStopRequest,
  type ActionRouteRecordStopResult,
  type ActionApiParamsByMethod,
  type ActionApiResultByMethod,
  type ActionApiRequestEnvelope,
  type ActionApiError,
  type ActionApiResponseEnvelope,
} from "./action-api/index.js";

// =============================================================================
// API Client
// =============================================================================

export {
  Centris,
  do,
  DEFAULT_API_VERSION,
  CentrisError,
  AuthenticationError,
  RateLimitError,
  type CentrisResult,
  type CentrisUsage,
  type CentrisClientOptions,
  type DeprecationCallback,
} from "./client/index.js";

// =============================================================================
// CLI
// =============================================================================

export {
  createCLI,
  runCLI,
  initConnector,
  validateConnector,
  testConnector,
  serveConnector,
  publishConnector,
  runDoCommand,
  runObserveActionCommand,
  runActActionCommand,
  runVerifyActionCommand,
  runRouteRunActionCommand,
  runRouteRecordStartActionCommand,
  runRouteRecordStopActionCommand,
  initManifest,
  validateManifestFile,
  recordRoute,
  runRoute,
  testRoute,
  type CLIOptions,
  type InitOptions,
  type TestOptions,
  type ServeOptions,
  type PublishOptions,
  type DoOptions,
  type ObserveOptions,
  type ActOptions,
  type VerifyOptions,
  type RouteRunApiOptions,
  type RouteRecordStartApiOptions,
  type RouteRecordStopApiOptions,
  type ManifestInitOptions,
  type ManifestValidateOptions,
  type RouteRecordOptions,
  type RouteRunOptions,
  type RouteTestOptions,
} from "./cli/index.js";

// =============================================================================
// Site Manifest System
// =============================================================================

export type {
  CentrisManifest,
  ManifestLandmark,
  ManifestAction,
  ManifestActionStep,
  ManifestSuccessCheck,
  ManifestRoute,
  ManifestIndexEntry,
  ResolvedManifest,
  SelectorChain,
  SelectorStability,
  ManifestLoaderOptions,
  LoadedManifest,
} from "./manifest/index.js";

export {
  loadManifests,
  validateManifest,
  ManifestStore,
  formatManifestIndex,
  formatResolvedManifest,
  formatResolvedManifestJson,
} from "./manifest/index.js";
