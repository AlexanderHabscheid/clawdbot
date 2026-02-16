/**
 * Domain Context Packages for Centris AI
 * =======================================
 * Pre-defined context packages for common domains.
 * These are embedded in the Worker for instant access (~0ms vs ~50ms file reads).
 *
 * Each package contains:
 * - patterns: Reliable selectors and interaction patterns
 * - expectedTools: Most likely tools needed
 * - waitTimes: Recommended wait times after actions (ms)
 * - gotchas: Common pitfalls to avoid
 *
 * Usage in Worker:
 *   import { DOMAIN_PACKAGES, getDomainContext, formatContextForLLM } from './domain-packages.js';
 *
 *   const context = getDomainContext('gmail.com');
 *   const contextString = formatContextForLLM(context);
 */

// =============================================================================
// PRE-DEFINED DOMAIN PACKAGES
// =============================================================================

export const DOMAIN_PACKAGES = {
  // =========================================================================
  // EMAIL DOMAINS
  // =========================================================================
  "gmail.com": {
    domain: "gmail.com",
    aliases: ["mail.google.com"],
    patterns: [
      "Compose button: aria-label='Compose'",
      "Search bar: aria-label='Search mail'",
      "Gmail uses dynamic class names - ALWAYS use aria-labels",
      "Wait for inbox to load after navigation (~1-1.5s)",
      "Reply button: aria-label='Reply'",
      "Delete button: aria-label='Delete'",
      "Email list items: role='row' with nested role='gridcell'",
    ],
    expectedTools: [
      "navigate_browser",
      "get_interactive_snapshot",
      "click_node",
      "input_text_node",
      "get_page_content",
    ],
    commonTasks: {
      readEmails: "Sequential: navigate → list → click_one → read_content → back → next",
      compose: "Click compose → wait 800ms → fill_fields → send",
      search: "Click search → type query → wait 1s → read results",
    },
    waitTimes: {
      afterNavigate: 1500,
      afterComposeClick: 800,
      afterSend: 500,
      afterSearch: 1000,
    },
    gotchas: [
      "Gmail class names change frequently - NEVER use class selectors",
      "Compose modal takes 500-800ms to fully appear",
      "Search results load asynchronously - wait for them",
    ],
    tokenEstimate: 350,
  },

  "outlook.com": {
    domain: "outlook.com",
    aliases: ["outlook.live.com", "outlook.office365.com", "outlook.office.com"],
    patterns: [
      "New mail button: aria-label='New mail'",
      "Navigation sidebar uses role='menuitem'",
      "Calendar button: aria-label='Calendar'",
      "Settings gear: aria-label='Settings'",
      "Folder pane uses role='tree'",
    ],
    expectedTools: [
      "navigate_browser",
      "get_interactive_snapshot",
      "click_node",
      "input_text_node",
      "get_page_content",
    ],
    waitTimes: {
      afterNavigate: 2000,
      afterComposeClick: 1000,
    },
    gotchas: [
      "Outlook has multiple product versions with different UIs",
      "Wait for full page load - Outlook is slow",
    ],
    tokenEstimate: 220,
  },

  // =========================================================================
  // SEARCH ENGINES
  // =========================================================================
  "google.com": {
    domain: "google.com",
    aliases: ["www.google.com"],
    patterns: [
      "Search box: name='q' or aria-label='Search'",
      "Search button: aria-label='Google Search'",
      "I'm Feeling Lucky: aria-label=\"I'm Feeling Lucky\"",
      "Search results: each result in div.g with h3 for title",
    ],
    expectedTools: [
      "navigate_browser",
      "get_interactive_snapshot",
      "click_node",
      "input_text_node",
    ],
    waitTimes: {
      afterNavigate: 500,
      afterSearch: 1000,
    },
    gotchas: [
      "Search results layout varies by query type",
      "Featured snippets may appear above regular results",
    ],
    tokenEstimate: 180,
  },

  // =========================================================================
  // VIDEO/MEDIA
  // =========================================================================
  "youtube.com": {
    domain: "youtube.com",
    aliases: ["www.youtube.com"],
    patterns: [
      "Search box: name='search_query' or aria-label='Search'",
      "Video player: role='application' or class='html5-video-player'",
      "Pause/Play: aria-label contains 'pause' or 'play'",
      "Video titles: a#video-title",
      "Subscribe button: aria-label contains 'Subscribe'",
    ],
    expectedTools: [
      "navigate_browser",
      "get_interactive_snapshot",
      "click_node",
      "input_text_node",
      "scroll_page",
    ],
    waitTimes: {
      afterNavigate: 1000,
      afterSearch: 1500,
      afterVideoClick: 2000,
    },
    gotchas: [
      "YouTube heavily uses Shadow DOM - some elements not accessible",
      "Video autoplay may interfere with interactions",
      "Infinite scroll - use scroll_page to load more",
    ],
    tokenEstimate: 250,
  },

  // =========================================================================
  // DOCUMENTS
  // =========================================================================
  "docs.google.com": {
    domain: "docs.google.com",
    aliases: [],
    patterns: [
      "Document title is contenteditable div at top",
      "Toolbar buttons have aria-labels",
      "Menu items use role='menuitem'",
      "Main editor: contenteditable='true' with largest area",
    ],
    expectedTools: [
      "navigate_browser",
      "get_interactive_snapshot",
      "click_node",
      "input_text_node",
    ],
    commonTasks: {
      createDoc: "Navigate to docs.google.com/document/create",
      typeContent: "Click main editor → use input_text_node with auto-fallback",
    },
    waitTimes: {
      afterNavigate: 2000,
      afterCreate: 1500,
    },
    gotchas: [
      "Canvas-based editor - standard input may not work",
      "input_text_node has built-in fallback for canvas editors",
      "Wait for 'Loading' to disappear before interacting",
    ],
    tokenEstimate: 230,
  },

  "sheets.google.com": {
    domain: "sheets.google.com",
    patterns: [
      "Cell editor: contenteditable or input in cell",
      "Toolbar similar to Docs",
      "Cell references: A1, B2, etc.",
    ],
    expectedTools: [
      "navigate_browser",
      "get_interactive_snapshot",
      "click_node",
      "input_text_node",
    ],
    waitTimes: {
      afterNavigate: 2000,
    },
    tokenEstimate: 120,
  },

  // =========================================================================
  // SOCIAL MEDIA
  // =========================================================================
  "twitter.com": {
    domain: "twitter.com",
    aliases: ["x.com"],
    patterns: [
      "Tweet compose: aria-label='Post' or aria-label='Tweet'",
      "Search: aria-label='Search'",
      "Home timeline loads dynamically with infinite scroll",
      "Tweet actions: aria-label contains 'Like', 'Repost', 'Reply'",
    ],
    expectedTools: [
      "navigate_browser",
      "get_interactive_snapshot",
      "click_node",
      "input_text_node",
      "scroll_page",
    ],
    waitTimes: {
      afterNavigate: 2000,
      afterScroll: 1000,
    },
    gotchas: ["Twitter/X changes UI frequently", "Timeline uses infinite scroll - use scroll_page"],
    tokenEstimate: 200,
  },

  "linkedin.com": {
    domain: "linkedin.com",
    aliases: ["www.linkedin.com"],
    patterns: [
      "Search: aria-label='Search'",
      "Messaging button: aria-label='Messaging'",
      "Connections: aria-label contains 'network'",
      "Post button: aria-label='Start a post'",
    ],
    expectedTools: [
      "navigate_browser",
      "get_interactive_snapshot",
      "click_node",
      "input_text_node",
    ],
    waitTimes: {
      afterNavigate: 2000,
    },
    gotchas: ["LinkedIn has aggressive rate limiting", "Many modals and overlays"],
    tokenEstimate: 160,
  },

  // =========================================================================
  // DEVELOPER TOOLS
  // =========================================================================
  "github.com": {
    domain: "github.com",
    aliases: ["www.github.com"],
    patterns: [
      "Search: aria-label='Search GitHub' or '/'",
      "Repository tabs use role='tab'",
      "Issues link: aria-label contains 'Issues'",
      "Code button: contains text 'Code' (green button)",
    ],
    expectedTools: [
      "navigate_browser",
      "get_interactive_snapshot",
      "click_node",
      "input_text_node",
    ],
    waitTimes: {
      afterNavigate: 1000,
    },
    gotchas: ["GitHub uses turbo for navigation - may not trigger full reload"],
    tokenEstimate: 170,
  },

  // =========================================================================
  // LOCAL OPERATIONS (Non-web)
  // =========================================================================
  file_system: {
    domain: "file_system",
    patterns: [
      "Use absolute paths when possible",
      "Check file exists before read_file",
      "write_file creates parent directories automatically",
      "open_file opens in default app for that file type",
    ],
    expectedTools: ["read_file", "write_file", "list_directory", "open_file", "search_files"],
    commonTasks: {
      saveOutput: "write_file(path, content) → open_file(path)",
    },
    gotchas: ["read_file requires file to exist - use write_file to create"],
    tokenEstimate: 150,
  },

  applications: {
    domain: "applications",
    patterns: [
      "Use exact app names for open_application",
      "App names are case-insensitive",
      "Check if app is running before switching",
    ],
    expectedTools: [
      "open_application",
      "switch_application",
      "get_running_applications",
      "close_application",
    ],
    tokenEstimate: 100,
  },
};

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Normalize a domain name for lookups.
 * Removes www., mail., http(s)://, etc.
 */
export function normalizeDomain(domain) {
  if (!domain) {
    return "";
  }

  let normalized = domain.toLowerCase().trim();

  // Remove protocol
  if (normalized.startsWith("http://")) {
    normalized = normalized.slice(7);
  } else if (normalized.startsWith("https://")) {
    normalized = normalized.slice(8);
  }

  // Remove path
  const slashIndex = normalized.indexOf("/");
  if (slashIndex > 0) {
    normalized = normalized.slice(0, slashIndex);
  }

  // Remove common prefixes
  if (normalized.startsWith("www.")) {
    normalized = normalized.slice(4);
  }
  if (normalized.startsWith("mail.")) {
    normalized = normalized.slice(5);
  }

  return normalized;
}

/**
 * Get domain context package for a domain/URL.
 * Checks exact match, then aliases, then partial matches.
 */
export function getDomainContext(domainOrUrl) {
  const domain = normalizeDomain(domainOrUrl);

  // Exact match
  if (DOMAIN_PACKAGES[domain]) {
    return { ...DOMAIN_PACKAGES[domain], source: "exact" };
  }

  // Check aliases
  for (const [key, pkg] of Object.entries(DOMAIN_PACKAGES)) {
    const aliases = pkg.aliases || [];
    for (const alias of aliases) {
      if (normalizeDomain(alias) === domain) {
        return { ...pkg, source: "alias", matchedVia: alias };
      }
    }
  }

  // Partial match (e.g., calendar.google.com → google.com patterns)
  for (const [key, pkg] of Object.entries(DOMAIN_PACKAGES)) {
    if (key.includes(domain) || domain.includes(key)) {
      return { ...pkg, source: "partial", matchedVia: key };
    }

    // Check aliases for partial
    const aliases = pkg.aliases || [];
    for (const alias of aliases) {
      const normalizedAlias = normalizeDomain(alias);
      if (normalizedAlias.includes(domain) || domain.includes(normalizedAlias)) {
        return { ...pkg, source: "partial_alias", matchedVia: alias };
      }
    }
  }

  return null;
}

/**
 * Format domain context for LLM prompt injection.
 * Returns a concise string suitable for system prompt augmentation.
 */
export function formatContextForLLM(context, options = {}) {
  if (!context) {
    return "";
  }

  const { maxPatterns = 7, includeGotchas = true, includeTasks = false } = options;

  const parts = [];
  const domain = context.domain || "Unknown";

  // Patterns section (most important)
  if (context.patterns?.length > 0) {
    parts.push(`### ${domain} Patterns`);
    const patterns = context.patterns.slice(0, maxPatterns);
    parts.push(patterns.map((p) => `- ${p}`).join("\n"));
  }

  // Gotchas section
  if (includeGotchas && context.gotchas?.length > 0) {
    parts.push("### Watch Out For");
    const gotchas = context.gotchas.slice(0, 3);
    parts.push(gotchas.map((g) => `⚠️ ${g}`).join("\n"));
  }

  // Common tasks (optional)
  if (includeTasks && context.commonTasks) {
    parts.push("### Task Patterns");
    const tasks = Object.entries(context.commonTasks).slice(0, 3);
    parts.push(tasks.map(([name, pattern]) => `- ${name}: ${pattern}`).join("\n"));
  }

  return parts.join("\n\n");
}

/**
 * Get recommended wait time for an action on a domain.
 */
export function getWaitTime(domainOrUrl, action = "afterNavigate") {
  const context = getDomainContext(domainOrUrl);
  if (!context?.waitTimes) {
    return 500;
  } // Default 500ms

  return context.waitTimes[action] || 500;
}

/**
 * Get expected tools for a domain.
 */
export function getExpectedTools(domainOrUrl) {
  const context = getDomainContext(domainOrUrl);
  return context?.expectedTools || [];
}

/**
 * Get all available domains.
 */
export function getAllDomains() {
  return Object.keys(DOMAIN_PACKAGES);
}

/**
 * Get domain context stats.
 */
export function getDomainStats() {
  const domains = Object.keys(DOMAIN_PACKAGES);
  const totalTokens = Object.values(DOMAIN_PACKAGES).reduce(
    (sum, pkg) => sum + (pkg.tokenEstimate || 0),
    0,
  );

  return {
    totalDomains: domains.length,
    domains,
    totalTokenEstimate: totalTokens,
    avgTokensPerDomain: Math.round(totalTokens / domains.length),
  };
}
