/**
 * @centris/sdk - Plugin Types
 *
 * Type definitions for the Centris connector plugin system.
 * Pattern inspired by Clawdbot's ClawdbotPluginApi.
 *
 * SECURITY NOTE FOR THIRD-PARTY DEVELOPERS:
 * =========================================
 * The SDK exposes a sandboxed BrowserBridge interface. You DO NOT have access to:
 * - Internal Centris codebase or implementation details
 * - User credentials or session tokens
 * - System-level operations outside browser automation
 * - Other connectors' data or state
 */

import type { TSchema } from "@sinclair/typebox";
import type { CentrisConfig } from "../config/types.js";
import type { ToolResult } from "../schema/typebox.js";

// =============================================================================
// Browser Bridge Interface (Public API for Third-Party Developers)
// =============================================================================

/**
 * Result type for browser operations.
 */
export interface BrowserOperationResult {
  success: boolean;
  error?: string;
  [key: string]: unknown;
}

/**
 * Tab information.
 */
export interface BrowserTab {
  url: string;
  title?: string;
  active?: boolean;
}

/**
 * Interactive element from a DOM snapshot.
 *
 * The Centris extension assigns each visible interactive element a numeric nodeId.
 * Connectors can target elements by nodeId (preferred — stable within a page session)
 * or by CSS selector (useful for pre-mapped connectors with known DOM structure).
 */
export interface InteractiveElement {
  /** Numeric node ID assigned by the Centris extension snapshot */
  nodeId: number;
  /** CSS selector (optional — available when the element has a stable selector) */
  selector?: string;
  /** Abbreviated element type: "cl" (clickable), "ty" (typeable), "se" (select) */
  type: string;
  /** Human-readable label (button text, input placeholder, link text, etc.) */
  name: string;
  /** ARIA role when it adds context beyond the type */
  role?: string;
  /** @deprecated Use name instead */
  text?: string;
  /** @deprecated Use name instead */
  placeholder?: string;
}

/**
 * Screenshot result.
 */
export interface ScreenshotResult {
  success: boolean;
  data?: string; // base64
  mimeType?: string;
  error?: string;
}

/**
 * Secure browser automation interface for connector developers.
 *
 * This is the ONLY way connectors interact with the user's browser.
 * The actual implementation is provided by Centris at runtime.
 *
 * WHAT YOU CAN DO:
 * - Navigate to URLs
 * - Click elements by nodeId (from snapshot) or CSS selector
 * - Type text into inputs by nodeId or selector
 * - Wait for elements/navigation
 * - Read page content
 * - Get interactive element snapshots
 *
 * WHAT YOU CANNOT DO:
 * - Access cookies/localStorage directly
 * - Execute arbitrary JavaScript
 * - Access other tabs/windows
 * - Read/write files on the user's system
 * - Make network requests outside the browser
 *
 * @example
 * ```typescript
 * async function fillForm(
 *   toolCallId: string,
 *   params: { name: string; email: string },
 *   context?: ConnectorToolContext
 * ) {
 *   const bridge = context?.browserBridge;
 *   if (!bridge) return errorResult("Browser bridge not available");
 *
 *   // Navigate returns interactive elements automatically
 *   const nav = await bridge.navigateBrowser("https://example.com/form");
 *
 *   // Use nodeIds from the snapshot for fast, deterministic interaction
 *   const snapshot = await bridge.getInteractiveSnapshot();
 *   const nameField = snapshot.elements.find(e => e.name.includes("Name"));
 *   const emailField = snapshot.elements.find(e => e.name.includes("Email"));
 *
 *   if (nameField) await bridge.clickByNodeId(nameField.nodeId);
 *   await bridge.typeText(params.name);
 *
 *   if (emailField) await bridge.clickByNodeId(emailField.nodeId);
 *   await bridge.typeText(params.email);
 *
 *   // Or use CSS selectors for pre-mapped connectors with known DOM
 *   await bridge.clickNode('[type="submit"]');
 *
 *   return textResult("Form submitted");
 * }
 * ```
 */
export interface BrowserBridge {
  // =========================================================================
  // Navigation
  // =========================================================================

  /**
   * Navigate to a URL in the active tab.
   * @param url - The URL to navigate to
   * @returns Promise resolving to operation result
   */
  navigateBrowser(url: string): Promise<BrowserOperationResult>;

  /**
   * Get information about the current tab.
   * @returns Promise resolving to tab info
   */
  getActiveTab(): Promise<BrowserTab>;

  /**
   * Get information about all open tabs.
   * @returns Promise resolving to array of tab info
   */
  getAllTabs(): Promise<BrowserTab[]>;

  // =========================================================================
  // DOM Interaction — by nodeId (preferred, from snapshot)
  // =========================================================================

  /**
   * Click an element by its numeric nodeId from a snapshot.
   * Preferred over CSS selectors — nodeIds are stable within a page session
   * and guaranteed to reference visible, interactive elements.
   * @param nodeId - Numeric ID from InteractiveElement.nodeId
   * @returns Promise resolving to operation result (includes post-click elements)
   */
  clickByNodeId(nodeId: number): Promise<BrowserOperationResult>;

  /**
   * Type text into an element identified by nodeId.
   * @param nodeId - Numeric ID from InteractiveElement.nodeId
   * @param text - Text to type
   * @returns Promise resolving to operation result
   */
  typeByNodeId(nodeId: number, text: string): Promise<BrowserOperationResult>;

  // =========================================================================
  // DOM Interaction — by CSS selector (for pre-mapped connectors)
  // =========================================================================

  /**
   * Click an element by CSS selector.
   * Use clickByNodeId when possible — selectors may match invisible or non-interactive elements.
   * @param selector - CSS selector (e.g., '[data-testid="submit"]')
   * @returns Promise resolving to operation result
   */
  clickNode(selector: string): Promise<BrowserOperationResult>;

  /**
   * Clear and type text into an input element by CSS selector.
   * @param selector - CSS selector for the input element
   * @param text - Text to type
   * @returns Promise resolving to operation result
   */
  inputTextNode(selector: string, text: string): Promise<BrowserOperationResult>;

  /**
   * Type text at the current cursor position (no target element needed).
   * Useful after a click that focuses an input.
   * @param text - Text to type
   * @returns Promise resolving to operation result
   */
  typeText(text: string): Promise<BrowserOperationResult>;

  /**
   * Press a keyboard key.
   * @param key - Key to press (e.g., "Enter", "Tab", "Escape")
   * @returns Promise resolving to operation result
   */
  pressKey(key: string): Promise<BrowserOperationResult>;

  /**
   * Fill multiple form fields at once.
   * @param fields - Object mapping CSS selectors to values
   * @returns Promise resolving to operation result
   */
  fillForm(fields: Record<string, string>): Promise<BrowserOperationResult>;

  /**
   * Select an option in a dropdown.
   * @param selector - CSS selector for the select element
   * @param value - Value or visible text of the option
   * @returns Promise resolving to operation result
   */
  selectOption(selector: string, value: string): Promise<BrowserOperationResult>;

  // =========================================================================
  // Waiting
  // =========================================================================

  /**
   * Wait for a specified number of milliseconds.
   * @param ms - Milliseconds to wait
   * @returns Promise resolving when wait is complete
   */
  wait(ms: number): Promise<BrowserOperationResult>;

  /**
   * Wait for an element to appear in the DOM.
   * @param selector - CSS selector to wait for
   * @param timeoutMs - Maximum time to wait (default 10000)
   * @returns Promise resolving when element appears
   */
  waitForSelector(selector: string, timeoutMs?: number): Promise<BrowserOperationResult>;

  /**
   * Wait for page navigation to complete.
   * @param timeoutMs - Maximum time to wait (default 30000)
   * @returns Promise resolving when navigation completes
   */
  waitForNavigation(timeoutMs?: number): Promise<BrowserOperationResult>;

  // =========================================================================
  // Content
  // =========================================================================

  /**
   * Get the text content of the current page.
   * @returns Promise resolving to page text content
   */
  getPageContent(): Promise<string>;

  /**
   * Get a snapshot of interactive elements on the page.
   * @returns Promise resolving to interactive elements
   */
  getInteractiveSnapshot(): Promise<{ elements: InteractiveElement[] }>;

  /**
   * Scroll the page.
   * @param direction - "up" or "down"
   * @param amount - Pixels to scroll
   * @returns Promise resolving to operation result
   */
  scrollPage(direction: "up" | "down", amount?: number): Promise<BrowserOperationResult>;

  // =========================================================================
  // Screenshots
  // =========================================================================

  /**
   * Take a screenshot of the current page.
   * @returns Promise resolving to screenshot data
   */
  takeScreenshot(): Promise<ScreenshotResult>;
}

// =============================================================================
// Logger Interface
// =============================================================================

/**
 * Logger interface for connectors.
 */
export interface ConnectorLogger {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

// =============================================================================
// Config Schema & UI Hints
// =============================================================================

/**
 * UI hints for config schema fields.
 * Shown in the developer portal and desktop app settings.
 */
export interface ConnectorConfigUiHint {
  /** Human-readable label */
  label?: string;
  /** Help text / description */
  help?: string;
  /** Group name for organizing fields */
  group?: string;
  /** Display order within group */
  order?: number;
  /** Mark as advanced setting (hidden by default) */
  advanced?: boolean;
  /** Mark as sensitive (password field) */
  sensitive?: boolean;
  /** Placeholder text */
  placeholder?: string;
}

/**
 * Validation result from config schema.
 */
export type ConnectorConfigValidation =
  | { ok: true; value?: unknown }
  | { ok: false; errors: string[] };

/**
 * Config schema with validation and UI hints.
 * Compatible with Zod, TypeBox, or custom validators.
 */
export interface ConnectorConfigSchema {
  /** Zod-style validation (safeParse) */
  safeParse?: (value: unknown) => {
    success: boolean;
    data?: unknown;
    error?: {
      issues?: Array<{ path: Array<string | number>; message: string }>;
    };
  };
  /** TypeBox-style validation (parse with throw) */
  parse?: (value: unknown) => unknown;
  /** Custom validation */
  validate?: (value: unknown) => ConnectorConfigValidation;
  /** UI hints for config fields */
  uiHints?: Record<string, ConnectorConfigUiHint>;
}

// =============================================================================
// Tool Types
// =============================================================================

/**
 * Context passed to tool execution.
 *
 * The browserBridge enables deterministic browser automation - SDK connectors
 * can use the same primitives as the LLM agent but without LLM-in-loop overhead.
 *
 * IMPORTANT: The browserBridge is a sandboxed interface. You cannot access
 * Centris internals, user credentials, or perform system-level operations.
 */
export interface ConnectorToolContext {
  /** Full Centris config */
  config?: CentrisConfig;
  /** Workspace directory path */
  workspaceDir?: string;
  /** Connector's directory path */
  connectorDir?: string;
  /** Connector ID */
  connectorId?: string;
  /** Session key for user session */
  sessionKey?: string;
  /** User ID */
  userId?: string;
  /** Authentication tokens */
  auth?: {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
  };
  /**
   * Browser bridge for deterministic browser automation (sandboxed interface).
   *
   * This is the key difference between SDK connectors and LLM-in-loop automation:
   * - SDK connectors: Use browserBridge for pre-compiled, deterministic scripts
   * - LLM-in-loop: Each step requires LLM decision → snapshot → action cycle
   */
  browserBridge?: BrowserBridge;
}

/**
 * Tool definition for Centris connectors.
 */
export interface CentrisTool<TParams = unknown, TDetails = unknown> {
  /** Unique tool name */
  name: string;
  /** Human-readable label */
  label?: string;
  /** Tool description for AI context */
  description: string;
  /** Input parameters schema (TypeBox or JSON Schema) */
  parameters: TSchema | Record<string, unknown>;
  /** Execute the tool */
  execute: (
    toolCallId: string,
    params: TParams,
    context?: ConnectorToolContext,
  ) => Promise<ToolResult<TDetails>>;
}

/**
 * Tool factory function type.
 * Can return a single tool, array of tools, or null/undefined to skip.
 */
export type ConnectorToolFactory = (
  ctx: ConnectorToolContext,
) => CentrisTool | CentrisTool[] | null | undefined;

// =============================================================================
// Gateway Types
// =============================================================================

/**
 * Gateway request context.
 */
export interface GatewayRequestContext {
  userId?: string;
  sessionKey?: string;
  connectorId?: string;
}

/**
 * Gateway request handler type.
 */
export type GatewayRequestHandler = (
  params: unknown,
  context: GatewayRequestContext,
) => Promise<unknown>;

// =============================================================================
// CLI Types
// =============================================================================

/**
 * CLI context for registering commands.
 */
export interface ConnectorCliContext {
  /** Commander.js program instance */
  program: unknown;
  /** Full Centris config */
  config: CentrisConfig;
  /** Workspace directory */
  workspaceDir?: string;
  /** Logger instance */
  logger: ConnectorLogger;
}

/**
 * CLI registrar function type.
 */
export type ConnectorCliRegistrar = (ctx: ConnectorCliContext) => void | Promise<void>;

// =============================================================================
// Service Types
// =============================================================================

/**
 * Service context for lifecycle management.
 */
export interface ConnectorServiceContext {
  /** Full Centris config */
  config: CentrisConfig;
  /** Workspace directory */
  workspaceDir?: string;
  /** State directory for persistent data */
  stateDir: string;
  /** Logger instance */
  logger: ConnectorLogger;
}

/**
 * Background service definition.
 */
export interface ConnectorService {
  /** Unique service ID */
  id: string;
  /** Start the service */
  start: (ctx: ConnectorServiceContext) => void | Promise<void>;
  /** Stop the service (optional) */
  stop?: (ctx: ConnectorServiceContext) => void | Promise<void>;
}

// =============================================================================
// Connector Definition
// =============================================================================

/**
 * Connector definition exported from a package.
 * This is what connector developers export from their main file.
 */
export interface CentrisConnectorDefinition {
  /** Connector ID (optional, derived from package name if not provided) */
  id?: string;
  /** Display name */
  name?: string;
  /** Description */
  description?: string;
  /** Semantic version */
  version?: string;
  /** Config schema for validation */
  configSchema?: ConnectorConfigSchema;
  /** Register function called when connector is loaded */
  register?: (api: CentrisConnectorApi) => void | Promise<void>;
  /** Alias for register (for compatibility) */
  activate?: (api: CentrisConnectorApi) => void | Promise<void>;
}

/**
 * Connector module export type.
 * Can be a definition object or a register function.
 */
export type CentrisConnectorModule =
  | CentrisConnectorDefinition
  | ((api: CentrisConnectorApi) => void | Promise<void>);

// =============================================================================
// Connector API
// =============================================================================

/**
 * The API surface exposed to connector developers.
 * This is passed to the connector's register() function.
 */
export interface CentrisConnectorApi {
  // Identity
  /** Connector ID */
  id: string;
  /** Display name */
  name: string;
  /** Version string */
  version?: string;
  /** Description */
  description?: string;
  /** Source file path */
  source: string;

  // Config access
  /** Full Centris config */
  config: CentrisConfig;
  /** Connector-specific config from centris.config */
  connectorConfig?: Record<string, unknown>;

  // Logging
  /** Logger instance */
  logger: ConnectorLogger;

  // Registration methods
  /**
   * Register a tool or tool factory.
   * @param tool - Tool definition or factory function
   * @param opts - Optional name overrides
   */
  registerTool: (
    tool: CentrisTool | ConnectorToolFactory,
    opts?: { name?: string; names?: string[] },
  ) => void;

  /**
   * Register a gateway method handler.
   * @param method - Method name (e.g., 'slack.send')
   * @param handler - Request handler function
   */
  registerGatewayMethod: (method: string, handler: GatewayRequestHandler) => void;

  /**
   * Register CLI commands.
   * @param registrar - Function to register commands
   * @param opts - Optional command name hints
   */
  registerCli: (registrar: ConnectorCliRegistrar, opts?: { commands?: string[] }) => void;

  /**
   * Register a background service.
   * @param service - Service definition
   */
  registerService: (service: ConnectorService) => void;

  // Utilities
  /**
   * Resolve a path relative to the connector's directory.
   * @param input - Relative path
   * @returns Absolute path
   */
  resolvePath: (input: string) => string;
}

// =============================================================================
// Origin & Diagnostic Types
// =============================================================================

/**
 * Where the connector was discovered from.
 */
export type ConnectorOrigin = "global" | "workspace" | "config" | "npm";

/**
 * Diagnostic message from connector loading.
 */
export interface ConnectorDiagnostic {
  level: "warn" | "error";
  message: string;
  connectorId?: string;
  source?: string;
}
