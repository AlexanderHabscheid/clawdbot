/**
 * Centris Site Manifest Types
 *
 * A site manifest is a declarative, machine-readable map of a website's
 * interactive surface. Think robots.txt for crawlers, OpenAPI for APIs  -
 * but for UI automation.
 *
 * Key design decisions:
 * - Uses CSS selectors + ARIA roles (survive code deploys) NOT nodeIds (break on every change)
 * - Selector fallback chains: if .ql-editor breaks, [role="textbox"] still works
 * - The LLM sees the manifest in its system prompt and decides how to use it
 * - No separate routing/classification call  - it's just context
 */

// --- Selector with fallback chain ---

export type SelectorStability = "stable" | "moderate" | "fragile";

export type ManifestActionSafetyLevel = "read" | "write" | "destructive";

/**
 * A selector with a stability hint and fallback chain.
 * The extension tries selectors in order until one matches.
 *
 * Stability guide:
 * - "stable": data-testid, ARIA roles, aria-label  - survives refactors
 * - "moderate": semantic class names (.ql-editor)  - usually stable
 * - "fragile": positional/structural selectors  - breaks on layout changes
 */
export interface SelectorChain {
  selectors: string[];
  stability?: SelectorStability;
}

// --- Landmark ---

/**
 * A named region of the page. Landmarks give the LLM spatial awareness
 * without a full DOM snapshot.
 *
 * Examples: sidebar, composer, message_list, search_bar, header
 */
export interface ManifestLandmark {
  role: string;
  selectors: string[];
  stability?: SelectorStability;
  description?: string;
}

// --- Action step ---

/**
 * A single step in an action recipe.
 * Steps reference landmarks by name or use direct selectors.
 *
 * Template variables use {{variable}} syntax and are filled from action params.
 */
export type ManifestActionStep =
  | { click: string }
  | { type: { target: string; value: string } }
  | { press: string }
  | { navigate: string }
  | { wait: number }
  | { scroll: "up" | "down"; amount?: number };

export type ManifestSuccessCheck =
  | { type: "url_contains"; value: string }
  | { type: "text_present"; value: string }
  | { type: "element_visible"; value: string }
  | { type: "download"; value?: string }
  | { type: "network_url_contains"; value: string };

// --- Action recipe ---

/**
 * A pre-compiled action recipe. The LLM can follow these steps directly
 * instead of discovering them through snapshot -> click -> snapshot cycles.
 */
export interface ManifestAction {
  description: string;
  params?: string[];
  steps: ManifestActionStep[];
  successChecks?: ManifestSuccessCheck[];
  safetyLevel?: ManifestActionSafetyLevel;
  confidence?: number;
  lastVerifiedAt?: string;
  fallbackChains?: string[][];
}

// --- Route ---

/**
 * A route describes a page or set of pages within the app.
 * Route patterns support :param placeholders and * wildcards.
 */
export interface ManifestRoute {
  landmarks?: Record<string, ManifestLandmark>;
  actions?: Record<string, ManifestAction>;
}

// --- Top-level manifest ---

/**
 * The complete site manifest. Lives at:
 * - .well-known/centris.json (first-party, auto-discovered)
 * - connectors/{app}/centris.json (local)
 * - @centris/connector-{app} npm package
 * - ~/.centris/connectors/{app}/centris.json (global)
 */
export interface CentrisManifest {
  /** Manifest spec version */
  centris: string;
  /** App identifier (e.g. "slack", "gmail", "notion") */
  app: string;
  /** Human-readable description */
  description?: string;
  /** Optional manifest package version (for pinning/precedence) */
  version?: string;
  /** Optional publisher trust metadata (required for non-local manifests under strict trust policy) */
  trust?: {
    publisher?: string;
    keyId?: string;
    signature?: string;
    signatureAlgorithm?: "sha256" | "ed25519";
    signedAt?: string;
  };
  /** URL patterns this manifest applies to (glob-style) */
  url_patterns: string[];
  /** Page-specific landmarks and actions, keyed by route pattern */
  routes: Record<string, ManifestRoute>;
}

// --- Manifest index entry (compact, for system prompt) ---

/**
 * A compact summary of a loaded manifest, injected into the LLM system prompt.
 * ~30-50 tokens per entry, so 20 manifests ~ 600-1000 tokens.
 */
export interface ManifestIndexEntry {
  app: string;
  description?: string;
  url_patterns: string[];
  actions: string[];
  source?: "workspace" | "registry" | "global" | "overlay" | "external";
  trusted?: boolean;
}

// --- Resolved manifest (full, injected after URL match) ---

/**
 * A manifest resolved against a specific URL. Contains only the
 * matching route's landmarks and actions.
 */
export interface ResolvedManifest {
  app: string;
  description?: string;
  url: string;
  route: string;
  landmarks: Record<string, ManifestLandmark>;
  actions: Record<string, ManifestAction>;
  metadata?: {
    source: string;
    sourceKind: "workspace" | "registry" | "global" | "overlay" | "external";
    trusted: boolean;
    trustReason?: string;
    specificity?: number;
  };
}
