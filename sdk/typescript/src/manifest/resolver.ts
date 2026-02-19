/**
 * Centris Manifest Resolver
 *
 * Builds an in-memory index from loaded manifests and resolves
 * URLs to matching manifests + routes.
 *
 * URL matching: glob-style patterns with * wildcards.
 * Route matching: path patterns with :param placeholders and * wildcards.
 *
 * The resolver is deterministic (no LLM cost). The LLM decides *what to do*
 * with the resolved manifest - the resolver just finds the right one.
 */

import type { LoadedManifest } from "./loader.js";
import type {
  CentrisManifest,
  ManifestIndexEntry,
  ResolvedManifest,
  ManifestRoute,
} from "./types.js";

// --- Manifest Store ---

export class ManifestStore {
  private manifests: LoadedManifest[] = [];
  private urlPatternIndex: Array<{ pattern: RegExp; manifest: CentrisManifest }> = [];

  constructor(loaded?: LoadedManifest[]) {
    if (loaded) {
      this.addAll(loaded);
    }
  }

  addAll(loaded: LoadedManifest[]): void {
    for (const entry of loaded) {
      this.add(entry);
    }
  }

  add(entry: LoadedManifest): void {
    this.manifests.push(entry);
    for (const pattern of entry.manifest.url_patterns) {
      this.urlPatternIndex.push({
        pattern: globToRegex(pattern),
        manifest: entry.manifest,
      });
    }
  }

  get size(): number {
    return this.manifests.length;
  }

  /**
   * Build a compact index for LLM system prompt injection.
   * Each entry is ~30-50 tokens.
   */
  buildIndex(): ManifestIndexEntry[] {
    return this.manifests.map(({ manifest }) => ({
      app: manifest.app,
      description: manifest.description,
      url_patterns: manifest.url_patterns,
      actions: Object.values(manifest.routes).flatMap((route) => Object.keys(route.actions ?? {})),
    }));
  }

  /**
   * Resolve a URL to its matching manifest and route.
   * Returns the first match (manifests loaded first have priority).
   */
  resolve(url: string): ResolvedManifest | null {
    const normalizedUrl = normalizeUrl(url);

    for (const { pattern, manifest } of this.urlPatternIndex) {
      if (!pattern.test(normalizedUrl)) {
        continue;
      }

      // URL matches - find the best route
      const urlPath = extractPath(url);
      const matched = matchRoute(urlPath, manifest.routes);
      if (!matched) {
        continue;
      }

      return {
        app: manifest.app,
        description: manifest.description,
        url: url,
        route: matched.routeKey,
        landmarks: matched.route.landmarks ?? {},
        actions: matched.route.actions ?? {},
      };
    }

    return null;
  }

  /**
   * Find manifests whose app name or description match a query.
   * Used for the LLM to look up manifests by name without URL context.
   */
  findByApp(appName: string): CentrisManifest | null {
    const lower = appName.toLowerCase();
    return (
      this.manifests.find(
        ({ manifest }) =>
          manifest.app.toLowerCase() === lower ||
          manifest.description?.toLowerCase().includes(lower),
      )?.manifest ?? null
    );
  }
}

// --- URL pattern matching ---

// Glob-to-regex: * matches any chars, app.slack.com/* matches any path, etc.
function globToRegex(pattern: string): RegExp {
  let normalized = pattern;

  // Strip protocol if present
  normalized = normalized.replace(/^https?:\/\//, "");
  // Strip trailing slash
  normalized = normalized.replace(/\/$/, "");

  // Escape regex special chars (except * which we handle)
  const escaped = normalized.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

  // Replace * with regex wildcard
  const regexStr = escaped.replace(/\*/g, ".*");

  return new RegExp(`^${regexStr}$`, "i");
}

function normalizeUrl(url: string): string {
  let normalized = url;
  normalized = normalized.replace(/^https?:\/\//, "");
  normalized = normalized.replace(/\/$/, "");
  // Strip query params and hash for matching
  normalized = normalized.replace(/[?#].*$/, "");
  return normalized;
}

function extractPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    // If it's not a full URL, treat the whole thing as a path
    const afterHost = url.replace(/^https?:\/\/[^/]+/, "");
    return afterHost || "/";
  }
}

// --- Route matching ---

/**
 * Match a URL path against route patterns.
 * Route patterns support :param placeholders and * wildcards.
 *
 * Returns the most specific match (fewest wildcards).
 */
function matchRoute(
  urlPath: string,
  routes: Record<string, ManifestRoute>,
): { routeKey: string; route: ManifestRoute } | null {
  let bestMatch: { routeKey: string; route: ManifestRoute; specificity: number } | null = null;

  for (const [routeKey, route] of Object.entries(routes)) {
    const specificity = routeMatches(urlPath, routeKey);
    if (specificity === -1) {
      continue;
    }

    if (!bestMatch || specificity > bestMatch.specificity) {
      bestMatch = { routeKey, route, specificity };
    }
  }

  return bestMatch;
}

/**
 * Check if a URL path matches a route pattern.
 * Returns specificity score (higher = more specific), or -1 for no match.
 *
 * Route patterns: /client/:workspace matches extra trailing segments,
 * suffix wildcards like new* match segments starting with "new".
 */
function routeMatches(urlPath: string, routePattern: string): number {
  const urlParts = urlPath.split("/").filter(Boolean);
  const routeParts = routePattern.split("/").filter(Boolean);

  if (routeParts.length === 0) {
    return urlParts.length === 0 ? 0 : -1;
  }
  if (routeParts.length === 1 && routeParts[0] === "*") {
    return 0;
  }

  let specificity = 0;
  let ui = 0;
  let ri = 0;

  while (ri < routeParts.length) {
    const rp = routeParts[ri];

    if (rp === "*") {
      ui = urlParts.length;
      ri++;
      continue;
    }

    // Suffix wildcard: "new*" matches segments starting with "new"
    if (rp.endsWith("*") && rp.length > 1) {
      if (ui >= urlParts.length) {
        return -1;
      }
      const prefix = rp.slice(0, -1);
      if (!urlParts[ui].startsWith(prefix)) {
        return -1;
      }
      specificity += 2;
      ui = urlParts.length;
      ri++;
      continue;
    }

    if (ui >= urlParts.length) {
      return -1;
    }

    if (rp.startsWith(":")) {
      specificity += 1;
    } else if (rp === urlParts[ui]) {
      specificity += 2;
    } else {
      return -1;
    }

    ui++;
    ri++;
  }

  // Extra URL segments are OK - route patterns are prefix matches.
  // /client/:workspace matches /client/T123/C456 (extra segments are sub-paths).
  return specificity;
}
