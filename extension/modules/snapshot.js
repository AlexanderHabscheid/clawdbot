/**
 * Snapshot Module for Centris Chrome Extension
 *
 * GENERALIZED TOKEN-EFFICIENT VERSION with:
 * - CLAWDBOT Pattern: maxChars-based limiting, ARIA role filtering
 * - BROWSEROSS Pattern: WeakMap caching, checkVisibility API
 * - Stable ref caching with LRU eviction
 * - Vision streaming
 * - INSTRUCTION-AWARE FILTERING: Optional keyword extraction and relevance scoring
 *
 * NO domain-specific hardcoding - works across all websites uniformly.
 * Token reduction via: interactive-only selection, visibility filtering,
 * size filtering, maxChars limit, and slim output format.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// INSTRUCTION-AWARE FILTERING (NEW FEB 2026)
// Extracts keywords from user instructions and boosts matching elements
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * CLAWDBOT-INSPIRED: Common stopwords to filter out from instructions
 */
const INSTRUCTION_STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "as",
  "is",
  "was",
  "are",
  "were",
  "been",
  "be",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "must",
  "shall",
  "can",
  "need",
  "dare",
  "ought",
  "used",
  "it",
  "its",
  "this",
  "that",
  "these",
  "those",
  "i",
  "you",
  "he",
  "she",
  "we",
  "they",
  "me",
  "him",
  "her",
  "us",
  "them",
  "my",
  "your",
  "his",
  "our",
  "their",
  "what",
  "which",
  "who",
  "whom",
  "when",
  "where",
  "why",
  "how",
  "all",
  "each",
  "every",
  "both",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "no",
  "nor",
  "not",
  "only",
  "own",
  "same",
  "so",
  "than",
  "too",
  "very",
  "just",
  "also",
  "now",
  "here",
  "there",
  "then",
  "once",
  "please",
  "thanks",
  "thank",
  "help",
  "want",
  "like",
  "get",
  "go",
  "make",
  "let",
]);

/**
 * ACTION VERBS that indicate what type of element to prioritize
 * CLAWDBOT PATTERN: Map verbs to element types
 */
const ACTION_VERB_MAPPINGS = {
  // Clicking actions -> prioritize clickable elements
  click: { type: "clickable", boost: 15 },
  press: { type: "clickable", boost: 15 },
  tap: { type: "clickable", boost: 15 },
  select: { type: "selectable", boost: 15 },
  choose: { type: "selectable", boost: 15 },
  pick: { type: "selectable", boost: 15 },
  open: { type: "clickable", boost: 10 },
  close: { type: "clickable", boost: 10 },

  // Typing actions -> prioritize typeable elements
  type: { type: "typeable", boost: 20 },
  enter: { type: "typeable", boost: 20 },
  input: { type: "typeable", boost: 20 },
  write: { type: "typeable", boost: 20 },
  fill: { type: "typeable", boost: 20 },
  search: { type: "typeable", boost: 15 },

  // Navigation actions
  navigate: { type: "clickable", boost: 10 },
  scroll: { type: null, boost: 5 },
  find: { type: null, boost: 5 },
  read: { type: null, boost: 5 },

  // Email-specific
  compose: { type: "clickable", boost: 15 },
  reply: { type: "clickable", boost: 15 },
  forward: { type: "clickable", boost: 15 },
  send: { type: "clickable", boost: 15 },
  delete: { type: "clickable", boost: 15 },
  archive: { type: "clickable", boost: 15 },
};

/**
 * Extract meaningful keywords from an instruction
 * CLAWDBOT PATTERN: Lightweight keyword extraction without LLM
 *
 * @param {string} instruction - User instruction text
 * @returns {Object} Extracted keywords and metadata
 */
function extractInstructionKeywords(instruction) {
  if (!instruction || typeof instruction !== "string") {
    return { keywords: [], actionVerb: null, targetType: null, boost: 0 };
  }

  const normalized = instruction.toLowerCase().trim();

  // Extract action verb (first verb found)
  let actionVerb = null;
  let targetType = null;
  let verbBoost = 0;

  for (const [verb, mapping] of Object.entries(ACTION_VERB_MAPPINGS)) {
    if (normalized.includes(verb)) {
      actionVerb = verb;
      targetType = mapping.type;
      verbBoost = mapping.boost;
      break;
    }
  }

  // Tokenize and filter
  const tokens = normalized
    .replace(/[^\w\s@.-]/g, " ") // Keep @ . - for emails/domains
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .filter((t) => !INSTRUCTION_STOPWORDS.has(t))
    .filter((t) => !/^\d+$/.test(t)); // Remove pure numbers

  // Dedupe while preserving order
  const seen = new Set();
  const keywords = [];
  for (const token of tokens) {
    if (!seen.has(token)) {
      seen.add(token);
      keywords.push(token);
    }
  }

  // Extract potential proper nouns (capitalized words in original)
  const properNouns = instruction
    .split(/\s+/)
    .filter((w) => /^[A-Z][a-z]/.test(w)) // Starts with capital, followed by lowercase
    .map((w) => w.toLowerCase())
    .filter((w) => !INSTRUCTION_STOPWORDS.has(w));

  // Extract email addresses
  const emailMatches = instruction.match(/[\w.-]+@[\w.-]+\.\w+/g) || [];

  // Extract quoted strings (high priority)
  const quotedMatches = instruction.match(/"([^"]+)"|'([^']+)'/g) || [];
  const quotedStrings = quotedMatches.map((q) => q.replace(/['"]/g, "").toLowerCase());

  return {
    keywords,
    properNouns,
    emails: emailMatches.map((e) => e.toLowerCase()),
    quotedStrings,
    actionVerb,
    targetType,
    verbBoost,
    // Total keyword count for adaptive maxChars
    totalKeywords:
      keywords.length + properNouns.length + emailMatches.length + quotedStrings.length,
  };
}

/**
 * Score an element based on instruction keyword matches
 * CLAWDBOT PATTERN: Weighted scoring without LLM
 *
 * @param {Object} element - Element info object
 * @param {Object} extractedKeywords - Output from extractInstructionKeywords
 * @returns {number} Relevance score (higher = more relevant)
 */
function scoreElementByInstruction(element, extractedKeywords) {
  if (!extractedKeywords || extractedKeywords.keywords.length === 0) {
    return 0; // No instruction = no boost
  }

  let score = 0;

  // Build searchable text from element
  const searchText = [
    element.name || "",
    element.ariaLabel || "",
    element.placeholder || "",
    element.textContent || "",
    element.htmlId || "",
    element.dataTestId || "",
  ]
    .join(" ")
    .toLowerCase();

  // Score for keyword matches
  for (const keyword of extractedKeywords.keywords) {
    if (searchText.includes(keyword)) {
      score += 10; // Base keyword match

      // Exact word boundary match is worth more
      const wordBoundaryRegex = new RegExp(`\\b${keyword}\\b`, "i");
      if (wordBoundaryRegex.test(searchText)) {
        score += 5;
      }
    }
  }

  // Higher score for proper noun matches (likely names, companies)
  for (const noun of extractedKeywords.properNouns || []) {
    if (searchText.includes(noun)) {
      score += 20; // Proper nouns are high value
    }
  }

  // Highest score for email matches
  for (const email of extractedKeywords.emails || []) {
    if (searchText.includes(email)) {
      score += 50; // Email matches are very high value
    }
  }

  // Very high score for quoted string matches
  for (const quoted of extractedKeywords.quotedStrings || []) {
    if (searchText.includes(quoted)) {
      score += 40; // Quoted strings are explicit targets
    }
  }

  // Type-based boost from action verb
  if (extractedKeywords.targetType && element.type === extractedKeywords.targetType) {
    score += extractedKeywords.verbBoost;
  }

  return score;
}

// ═══════════════════════════════════════════════════════════════════════════════
// VISION STREAMING STATE
// ═══════════════════════════════════════════════════════════════════════════════

// NOTE: visionStreamingActive and nodeIdMappings are initialized in background.js
// before modules are loaded to prevent duplicate declaration errors with importScripts
const visionStreamCallbacks = new Map();
const visionStreamIntervals = new Map();

// ═══════════════════════════════════════════════════════════════════════════════
// NODE ID MAPPINGS (shared with other modules via globalThis)
// ═══════════════════════════════════════════════════════════════════════════════

// Alias for cleaner code within this module
// (globalThis.nodeIdMappings is initialized in background.js)

/**
 * Get node mappings for a tab
 */
function getNodeMappings(tabId) {
  return globalThis.nodeIdMappings.get(tabId);
}

/**
 * Set node mappings for a tab
 */
function setNodeMappings(tabId, mapping) {
  globalThis.nodeIdMappings.set(tabId, mapping);
}

/**
 * Clear node mappings for a tab
 */
function clearNodeMappings(tabId) {
  globalThis.nodeIdMappings.delete(tabId);
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLAWDBOT PATTERN: STABLE REF CACHING
// Cache refs per URL so they can be restored when revisiting pages
// Uses LRU eviction to prevent unbounded memory growth
// ═══════════════════════════════════════════════════════════════════════════════

const STABLE_REF_CACHE_MAX_SIZE = 50; // Max number of URL caches to keep
const STABLE_REF_CACHE_TTL = 5 * 60 * 1000; // 5 minutes TTL

// Structure: Map<cacheKey, { refs: Map<stableHash, refInfo>, timestamp, accessOrder }>
// cacheKey = URL pathname (not full URL to handle query params)
let stableRefCache = new Map();
let refCacheAccessOrder = []; // Track access order for LRU eviction

/**
 * Generate a cache key from URL (uses pathname for stability)
 * @param {string} url - Full URL
 * @returns {string} Cache key
 */
function getRefCacheKey(url) {
  try {
    const parsed = new URL(url);
    // Use hostname + pathname for stability (ignore query params, hash)
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return url;
  }
}

/**
 * Cache refs for a URL
 * CLAWDBOT PATTERN: Store refs by stableHash so they can be restored
 *
 * @param {string} url - Page URL
 * @param {Map} refs - Map of stableHash -> element info
 */
function cacheStableRefs(url, refs) {
  const cacheKey = getRefCacheKey(url);

  // Convert refs to storable format
  const refsData = new Map();
  refs.forEach((info, stableHash) => {
    refsData.set(stableHash, {
      nodeId: info.nodeId,
      type: info.type,
      name: info.name,
      role: info.role,
      selector: info.selector,
    });
  });

  // Update cache
  stableRefCache.set(cacheKey, {
    refs: refsData,
    timestamp: Date.now(),
  });

  // Update access order for LRU
  const orderIndex = refCacheAccessOrder.indexOf(cacheKey);
  if (orderIndex > -1) {
    refCacheAccessOrder.splice(orderIndex, 1);
  }
  refCacheAccessOrder.push(cacheKey);

  // LRU eviction if cache is too large
  while (refCacheAccessOrder.length > STABLE_REF_CACHE_MAX_SIZE) {
    const oldestKey = refCacheAccessOrder.shift();
    stableRefCache.delete(oldestKey);
    if (typeof logWithTimestamp === "function") {
      logWithTimestamp("debug", `🗑️ Ref cache evicted: ${oldestKey}`);
    }
  }

  if (typeof logWithTimestamp === "function") {
    logWithTimestamp("debug", `📦 Cached ${refsData.size} refs for ${cacheKey}`);
  }
}

/**
 * Get cached refs for a URL
 * CLAWDBOT PATTERN: Restore refs from cache if available and fresh
 *
 * @param {string} url - Page URL
 * @returns {Map|null} Cached refs or null if not found/expired
 */
function getCachedRefs(url) {
  const cacheKey = getRefCacheKey(url);
  const cached = stableRefCache.get(cacheKey);

  if (!cached) {
    return null;
  }

  // Check TTL
  if (Date.now() - cached.timestamp > STABLE_REF_CACHE_TTL) {
    stableRefCache.delete(cacheKey);
    const orderIndex = refCacheAccessOrder.indexOf(cacheKey);
    if (orderIndex > -1) {
      refCacheAccessOrder.splice(orderIndex, 1);
    }
    if (typeof logWithTimestamp === "function") {
      logWithTimestamp("debug", `⏰ Ref cache expired: ${cacheKey}`);
    }
    return null;
  }

  // Update access order (LRU)
  const orderIndex = refCacheAccessOrder.indexOf(cacheKey);
  if (orderIndex > -1) {
    refCacheAccessOrder.splice(orderIndex, 1);
  }
  refCacheAccessOrder.push(cacheKey);

  if (typeof logWithTimestamp === "function") {
    logWithTimestamp("debug", `📦 Restored ${cached.refs.size} cached refs for ${cacheKey}`);
  }
  return cached.refs;
}

/**
 * Try to match cached refs to new snapshot elements using stableHash
 * CLAWDBOT PATTERN: Preserves nodeIds across snapshot refreshes where possible
 *
 * @param {Array} newElements - New snapshot elements
 * @param {Map} cachedRefs - Cached refs from previous snapshot
 * @returns {Object} { matched: number, reused: Map<stableHash, nodeId> }
 */
function matchCachedRefs(newElements, cachedRefs) {
  const matched = { count: 0, reused: new Map() };

  if (!cachedRefs || cachedRefs.size === 0) {
    return matched;
  }

  newElements.forEach((el) => {
    if (el.stableHash && cachedRefs.has(el.stableHash)) {
      const cachedInfo = cachedRefs.get(el.stableHash);
      // Element with same stableHash found - we can reference by the stable hash
      matched.count++;
      matched.reused.set(el.stableHash, {
        oldNodeId: cachedInfo.nodeId,
        newNodeId: el.nodeId,
        name: el.name,
      });
    }
  });

  if (matched.count > 0 && typeof logWithTimestamp === "function") {
    logWithTimestamp("info", `🔗 Matched ${matched.count} elements to cached refs`);
  }

  return matched;
}

/**
 * Build a ref lookup map from snapshot elements (by stableHash)
 * Used for caching refs
 *
 * @param {Array} elements - Snapshot elements
 * @returns {Map} Map of stableHash -> element info
 */
function buildRefMap(elements) {
  const refMap = new Map();
  elements.forEach((el) => {
    if (el.stableHash) {
      refMap.set(el.stableHash, {
        nodeId: el.nodeId,
        type: el.type,
        name: el.name,
        role: el.role,
        selector: el.selector,
      });
    }
  });
  return refMap;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACCESSIBILITY TREE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get full accessibility tree using Chrome's accessibility API
 * BrowserOS-style: Full AX tree with all properties
 */
async function getAccessibilityTree(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      // Build comprehensive accessibility tree
      function buildAXTree(node, id = 0, parentId = null) {
        const nodeId = id++;
        const tree = {
          id: nodeId,
          role: node.tagName?.toLowerCase() || node.role || "generic",
          name:
            node.getAttribute?.("aria-label") ||
            node.getAttribute?.("title") ||
            node.textContent?.trim().substring(0, 100) ||
            "",
          value: node.value || node.textContent?.trim().substring(0, 100) || "",
          parentId: parentId,
          attributes: {},
          children: [],
        };

        // Get all attributes
        if (node.id) {
          tree.attributes.id = node.id;
        }
        if (node.className) {
          tree.attributes.class = node.className;
        }
        if (node.type) {
          tree.attributes.type = node.type;
        }
        if (node.name) {
          tree.attributes.name = node.name;
        }
        if (node.href) {
          tree.attributes.href = node.href;
        }
        if (node.src) {
          tree.attributes.src = node.src;
        }

        // Get bounds
        if (node.getBoundingClientRect) {
          const rect = node.getBoundingClientRect();
          tree.bounds = {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          };
        }

        // Get states
        tree.states = [];
        if (node.disabled) {
          tree.states.push("disabled");
        }
        if (node.checked !== undefined) {
          tree.states.push("checked");
        }
        if (node.selected) {
          tree.states.push("selected");
        }
        if (node.hidden || node.style?.display === "none") {
          tree.states.push("hidden");
        }

        // Get actions
        tree.actions = [];
        if (node.onclick || node.getAttribute?.("onclick")) {
          tree.actions.push("click");
        }
        if (node.tagName === "INPUT" || node.tagName === "TEXTAREA") {
          tree.actions.push("type");
        }
        if (node.tagName === "A" || node.href) {
          tree.actions.push("navigate");
        }

        // Process children
        for (const child of Array.from(node.children || [])) {
          const [childTree, newId] = buildAXTree(child, id, nodeId);
          tree.children.push(childTree);
          id = newId;
        }

        return [tree, id];
      }

      function flattenTree(node, nodes = {}) {
        nodes[node.id] = {
          id: node.id,
          role: node.role,
          name: node.name,
          value: node.value,
          parentId: node.parentId,
          attributes: node.attributes,
          bounds: node.bounds,
          states: node.states,
          actions: node.actions,
          childIds: node.children.map((c) => c.id),
        };

        for (const child of node.children) {
          flattenTree(child, nodes);
        }

        return nodes;
      }

      const [tree] = buildAXTree(document.body);
      return {
        rootId: tree.id,
        nodes: flattenTree(tree),
        treeData: {
          url: window.location.href,
          title: document.title,
          loaded: document.readyState === "complete",
        },
      };
    },
  });
  return results[0]?.result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN INTERACTIVE SNAPSHOT - FULL PRODUCTION VERSION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get interactive snapshot of all elements on the page
 *
 * GENERALIZED TOKEN-EFFICIENT VERSION:
 * - Interactive-only element selection
 * - Visibility, size, and disabled filtering
 * - maxChars-based output limiting (CLAWDBOT pattern)
 * - Slim JSON format for minimal token usage
 * - Optional instruction-aware relevance sorting
 *
 * @param {number} tabId - Tab ID (optional, uses active tab)
 * @param {Object} options - Snapshot options
 * @param {string} options.instruction - User instruction for keyword-based sorting (optional)
 * @param {number} options.maxChars - Max characters for output (default: 100000)
 * @param {boolean} options.instructionFilteringEnabled - Enable instruction-based sorting (default: true)
 * @returns {Promise<Object>} - Snapshot with interactive elements
 */
async function getInteractiveSnapshot(tabId, options = {}) {
  // Extract instruction-based keywords for filtering
  const instruction = options.instruction || "";
  const instructionFilteringEnabled = options.instructionFilteringEnabled;
  const extractedKeywords = instructionFilteringEnabled
    ? extractInstructionKeywords(instruction)
    : null;

  // ADAPTIVE maxChars: If we have specific keywords, we can be more aggressive with filtering
  // More keywords = more specific task = fewer elements needed
  // Default 4000 chars (~1K tokens). The old default of 100K was a full DOM dump
  // that burned 88K+ tokens on complex pages like Cloudflare/Gmail.
  let adaptiveMaxChars = options.maxChars || 4000;
  if (extractedKeywords && extractedKeywords.totalKeywords > 0) {
    // Reduce maxChars for more specific instructions
    // Minimum 2000 chars (roughly 15-25 elements)
    adaptiveMaxChars = Math.max(2000, adaptiveMaxChars - extractedKeywords.totalKeywords * 500);
  }
  // CRITICAL: Validate tab exists before executing
  // FEB 2026 FIX: Race condition - new tabs may not be registered immediately after creation
  // Retry once after 300ms if tab validation fails on first try
  const validateTabWithRetry = async (tid, retryCount = 0) => {
    if (!tid || tid === undefined) {
      // No tabId provided - get active tab
      const activeTab = await getActiveTab();
      if (!activeTab.success || !activeTab.id) {
        return {
          success: false,
          error: `No active tab found. Please navigate to a page first using navigate_browser.`,
        };
      }
      return { success: true, tabId: activeTab.id, url: activeTab.url };
    }

    // Validate provided tabId exists
    try {
      const tab = await chrome.tabs.get(tid);
      if (tab) {
        return { success: true, tabId: tid, url: tab.url };
      }
    } catch (e) {
      // Tab not found - retry once after delay (race condition with new tab creation)
      if (retryCount === 0) {
        if (typeof logWithTimestamp === "function") {
          logWithTimestamp(
            "warn",
            `⏳ Tab ${tid} not found, retrying in 300ms (race condition fix)`,
          );
        }
        await new Promise((r) => setTimeout(r, 300));
        return validateTabWithRetry(tid, 1);
      }
    }

    // After retry, fall back to active tab
    const activeTab = await getActiveTab();
    if (activeTab.success && activeTab.id) {
      if (typeof logWithTimestamp === "function") {
        logWithTimestamp(
          "warn",
          `⚠️ Tab ${tid} not found, using active tab ${activeTab.id} instead`,
        );
      }
      return { success: true, tabId: activeTab.id, url: activeTab.url, fallback: true };
    }

    return {
      success: false,
      error: `Tab ${tid} does not exist and no active tab available. Please navigate first.`,
    };
  };

  try {
    const validation = await validateTabWithRetry(tabId);
    if (!validation.success) {
      return { success: false, error: validation.error };
    }
    tabId = validation.tabId;
    if (typeof logWithTimestamp === "function" && validation.fallback) {
      logWithTimestamp("info", "📋 Using fallback tab for get_interactive_snapshot", {
        tabId,
        url: validation.url,
      });
    }
  } catch (e) {
    if (typeof logWithTimestamp === "function") {
      logWithTimestamp("error", "❌ Error validating tab for get_interactive_snapshot", {
        tabId,
        error: e.message,
      });
    }
    return {
      success: false,
      error: `Failed to validate tab: ${e.message}. Please navigate to a page first.`,
    };
  }

  // Check for restricted URLs (chrome://, chrome-extension://, etc.)
  try {
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url || "";

    if (
      url.startsWith("chrome://") ||
      url.startsWith("chrome-extension://") ||
      url.startsWith("edge://") ||
      url.startsWith("about:") ||
      url.startsWith("devtools://") ||
      url === "" ||
      url === "about:blank"
    ) {
      // This should rarely happen now since getActiveTab() filters restricted pages
      // But keep as a safety net for explicit tabId parameters
      if (typeof logWithTimestamp === "function") {
        logWithTimestamp("info", "📋 Restricted page - will use getActiveTab fallback", {
          tabId: tabId,
          url: url,
        });
      }

      // Let getActiveTab find a valid non-restricted tab
      const activeTabResult = await getActiveTab();
      if (activeTabResult.success && activeTabResult.id && activeTabResult.id !== tabId) {
        if (typeof logWithTimestamp === "function") {
          logWithTimestamp("info", "🔄 Switched to non-restricted tab", {
            fromTabId: tabId,
            toTabId: activeTabResult.id,
            url: activeTabResult.tab?.url,
          });
        }
        // Recursively call with the valid tab
        return await getInteractiveSnapshot(activeTabResult.id);
      }

      return {
        success: false,
        error: `Cannot get interactive elements on "${url}". This is a protected browser page. Chrome security prevents script access to chrome:// and other internal pages.`,
        restrictedPage: true,
        suggestion: "Use navigate_browser to go to a website (http:// or https://) first.",
        snapshotId: Date.now(),
        timestamp: Date.now(),
        interactiveNodes: [],
        metadata: {
          totalProcessed: 0,
          filteredCount: 0,
          url: url,
          restrictedPage: true,
        },
      };
    }
  } catch (e) {
    if (typeof logWithTimestamp === "function") {
      logWithTimestamp("error", "❌ Failed to check tab URL", { error: e.message });
    }
  }

  // Execute the main snapshot extraction script
  // FEB 2026 FIX: Must run in MAIN world so that window.__centrisNodeMap is
  // accessible to clickNode() which also runs in MAIN world. Previously ran
  // in ISOLATED world (default), making __centrisNodeMap invisible to clicks.
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (viewportExpansion = 0, efficientMode = {}, instructionData = null) => {
      // INSTRUCTION-AWARE SCORING FUNCTION (injected into page context)
      function scoreElementByKeywords(element, instructionData) {
        if (
          !instructionData ||
          !instructionData.keywords ||
          instructionData.keywords.length === 0
        ) {
          return 0;
        }

        let score = 0;
        const searchText = [
          element.name || "",
          element.ariaLabel || "",
          element.placeholder || "",
          element.textContent || "",
          element.htmlId || "",
          element.dataTestId || "",
        ]
          .join(" ")
          .toLowerCase();

        // Keyword matches
        for (const keyword of instructionData.keywords) {
          if (searchText.includes(keyword)) {
            score += 10;
            const wordBoundaryRegex = new RegExp(`\\b${keyword}\\b`, "i");
            if (wordBoundaryRegex.test(searchText)) {
              score += 5;
            }
          }
        }

        // Proper noun matches
        for (const noun of instructionData.properNouns || []) {
          if (searchText.includes(noun)) {
            score += 20;
          }
        }

        // Email matches
        for (const email of instructionData.emails || []) {
          if (searchText.includes(email)) {
            score += 50;
          }
        }

        // Quoted string matches
        for (const quoted of instructionData.quotedStrings || []) {
          if (searchText.includes(quoted)) {
            score += 40;
          }
        }

        // Type boost from action verb
        if (instructionData.targetType && element.type === instructionData.targetType) {
          score += instructionData.verbBoost || 0;
        }

        return score;
      }
      // ═══════════════════════════════════════════════════════════════════════════
      // CLAWDBOT-STYLE DOM EXTRACTION WITH ARIA ROLE-BASED FILTERING
      // Based on Clawdbot pw-role-snapshot.ts - semantic role filtering WITHOUT LLM
      // Key optimizations: ARIA role filtering, compact mode, maxChars limit
      // ═══════════════════════════════════════════════════════════════════════════

      // CLAWDBOT PATTERN: ARIA ROLE SETS FOR SEMANTIC FILTERING
      const INTERACTIVE_ROLES = new Set([
        "button",
        "link",
        "textbox",
        "checkbox",
        "radio",
        "combobox",
        "listbox",
        "menuitem",
        "menuitemcheckbox",
        "menuitemradio",
        "option",
        "searchbox",
        "slider",
        "spinbutton",
        "switch",
        "tab",
        "treeitem",
      ]);

      const CONTENT_ROLES = new Set([
        "heading",
        "cell",
        "gridcell",
        "columnheader",
        "rowheader",
        "listitem",
        "article",
        "region",
        "main",
        "navigation",
      ]);

      const STRUCTURAL_ROLES = new Set([
        "generic",
        "group",
        "list",
        "table",
        "row",
        "rowgroup",
        "grid",
        "treegrid",
        "menu",
        "menubar",
        "toolbar",
        "tablist",
        "tree",
        "directory",
        "document",
        "application",
        "presentation",
        "none",
      ]);

      // Efficient mode options (Clawdbot pattern)
      const {
        interactive = false, // Only include INTERACTIVE_ROLES elements
        compact = false, // Remove unnamed structural elements
        maxDepth = -1, // Max DOM depth (-1 = unlimited)
        maxChars = 4000, // Max output characters (~1,000 tokens). Default kept tight for Centris.
      } = efficientMode;

      const interactiveElements = [];

      // ═══════════════════════════════════════════════════════════════════════════
      // BROWSEROSS OPTIMIZATION 1: WeakMap Caching
      // Cache getBoundingClientRect() and getComputedStyle() results
      // ═══════════════════════════════════════════════════════════════════════════
      const rectCache = new WeakMap();
      const styleCache = new WeakMap();

      function getCachedRect(element) {
        if (!element) {
          return null;
        }
        if (rectCache.has(element)) {
          return rectCache.get(element);
        }
        const rect = element.getBoundingClientRect();
        rectCache.set(element, rect);
        return rect;
      }

      function getCachedStyle(element) {
        if (!element) {
          return null;
        }
        if (styleCache.has(element)) {
          return styleCache.get(element);
        }
        const style = window.getComputedStyle(element);
        styleCache.set(element, style);
        return style;
      }

      // ═══════════════════════════════════════════════════════════════════════════
      // BROWSEROSS OPTIMIZATION 2: Early Tag Pruning
      // ═══════════════════════════════════════════════════════════════════════════
      const SKIP_TAGS = new Set([
        "SVG",
        "SCRIPT",
        "STYLE",
        "LINK",
        "META",
        "NOSCRIPT",
        "TEMPLATE",
        "HEAD",
        "BR",
        "HR",
        "WBR",
        "COL",
        "COLGROUP",
        "BASE",
        "EMBED",
        "PARAM",
        "SOURCE",
        "TRACK",
        "AREA",
        "MAP",
      ]);

      // ═══════════════════════════════════════════════════════════════════════════
      // BROWSEROSS OPTIMIZATION 3: checkVisibility() API
      // ═══════════════════════════════════════════════════════════════════════════
      function isElementVisible(element) {
        if (!element) {
          return false;
        }

        try {
          if (typeof element.checkVisibility === "function") {
            return element.checkVisibility({
              checkOpacity: true,
              checkVisibilityCSS: true,
            });
          }
        } catch (e) {}

        // Fallback
        const style = getCachedStyle(element);
        if (!style) {
          return false;
        }
        if (style.display === "none" || style.visibility === "hidden") {
          return false;
        }
        if (parseFloat(style.opacity) < 0.1) {
          return false;
        }

        const rect = getCachedRect(element);
        if (!rect || rect.width < 2 || rect.height < 2) {
          return false;
        }

        return true;
      }

      // Filter statistics
      const filterStats = {
        total: 0,
        passed: 0,
        skippedByRole: 0,
        skippedByCompact: 0,
        skippedByVisibility: 0,
        skippedByOcclusion: 0,
        skippedByViewport: 0,
        skippedBySize: 0,
        skippedByDisabled: 0,
      };

      // Generate stable hash for element identification
      function generateStableHash(el) {
        const components = [];
        components.push(el.tagName?.toLowerCase() || "unknown");
        if (el.id) {
          components.push(`id:${el.id}`);
        }

        const stableAttrs = ["name", "data-testid", "role", "type", "href", "aria-label"];
        for (const attr of stableAttrs) {
          const value = el.getAttribute?.(attr);
          if (value) {
            components.push(`${attr}:${value.substring(0, 50)}`);
          }
        }

        const fingerprint = components.join("|");
        let hash = 0;
        for (let i = 0; i < fingerprint.length; i++) {
          hash = (hash << 5) - hash + fingerprint.charCodeAt(i);
          hash = hash & hash;
        }
        return { hash: Math.abs(hash).toString(36), components };
      }

      // UNIQUE nodeId generation - simple incrementing counter
      // FEB 2026 FIX: Previously used getStableNodeId(stableHash) which mapped
      // stable hashes to nodeIds. But repeated elements (email rows, search results,
      // product cards) share the same stable hash, so they ALL got the SAME nodeId.
      // This made it impossible to click a specific item in a list.
      // Now each element gets a truly unique nodeId via simple counter.
      // stableHash is still stored as a separate field for cross-snapshot matching.
      let nextNodeId = 1;

      // Get selector for element
      function getSelector(el) {
        if (el.id) {
          return `#${el.id}`;
        }
        if (el.className && typeof el.className === "string") {
          const classes = el.className
            .split(" ")
            .filter((c) => c && !c.includes(":"))
            .join(".");
          if (classes) {
            return `${el.tagName.toLowerCase()}.${classes}`;
          }
        }
        return el.tagName?.toLowerCase() || "unknown";
      }

      // Determine node type
      function getNodeType(el) {
        const tag = el.tagName.toUpperCase();
        const role = el.getAttribute("role");
        const inputType = el.type?.toLowerCase();

        // Typeable elements
        if (
          tag === "INPUT" &&
          ["text", "email", "password", "search", "tel", "url", "number"].includes(inputType)
        ) {
          return "typeable";
        }
        if (tag === "TEXTAREA") {
          return "typeable";
        }
        if (el.isContentEditable) {
          return "typeable";
        }
        if (role === "textbox" || role === "searchbox" || role === "combobox") {
          return "typeable";
        }

        // Selectable elements
        if (tag === "SELECT") {
          return "selectable";
        }
        if (["checkbox", "radio"].includes(inputType)) {
          return "selectable";
        }
        if (["checkbox", "radio", "option", "listbox"].includes(role)) {
          return "selectable";
        }

        // Everything else is clickable
        return "clickable";
      }

      // Get element name
      function getName(el) {
        const ariaLabel = el.getAttribute("aria-label");
        if (ariaLabel) {
          return ariaLabel.trim();
        }

        const placeholder = el.getAttribute("placeholder");
        if (placeholder) {
          return placeholder.trim();
        }

        const title = el.getAttribute("title");
        if (title) {
          return title.trim();
        }

        let text = el.innerText || el.textContent || "";
        text = text.trim().replace(/\s+/g, " ").substring(0, 100);
        if (text) {
          return text;
        }

        if (el.value && el.type !== "password") {
          return el.value.substring(0, 50);
        }

        return "";
      }

      // Node map for internal tracking
      const nodeMap = new Map();
      const processedElements = new Set();
      const filteredElements = [];

      // Check for large canvas (indicates canvas-based editor)
      const hasLargeCanvas = Array.from(document.querySelectorAll("canvas")).some((c) => {
        const rect = c.getBoundingClientRect();
        return rect.width > 300 && rect.height > 200;
      });

      // Frame offset calculation
      const frameOffset = { x: 0, y: 0 };

      // Interactive selectors
      const interactiveSelectors = [
        "a[href]",
        "button",
        "input",
        "select",
        "textarea",
        '[role="button"]',
        '[role="link"]',
        '[role="checkbox"]',
        '[role="radio"]',
        '[role="textbox"]',
        '[role="searchbox"]',
        '[role="combobox"]',
        '[role="listbox"]',
        '[role="menuitem"]',
        '[role="menuitemcheckbox"]',
        '[role="menuitemradio"]',
        '[role="tab"]',
        '[role="option"]',
        '[role="switch"]',
        '[role="slider"]',
        '[role="spinbutton"]',
        '[role="treeitem"]',
        '[contenteditable="true"]',
        '[contenteditable=""]',
        '[tabindex]:not([tabindex="-1"])',
        "[onclick]",
        "[data-action]",
        "[data-testid]",
      ];

      const candidates = document.querySelectorAll(interactiveSelectors.join(","));

      candidates.forEach((el) => {
        filterStats.total++;

        // Early tag pruning
        if (SKIP_TAGS.has(el.tagName)) {
          filterStats.skippedByRole++;
          return;
        }

        // Skip already processed
        if (processedElements.has(el)) {
          return;
        }
        processedElements.add(el);

        // Visibility check
        if (!isElementVisible(el)) {
          filterStats.skippedByVisibility++;
          return;
        }

        // Size check
        const rect = getCachedRect(el);
        if (!rect || rect.width < 5 || rect.height < 5) {
          filterStats.skippedBySize++;
          return;
        }

        // Disabled check
        if (el.disabled || el.getAttribute("aria-disabled") === "true") {
          filterStats.skippedByDisabled++;
          return;
        }

        filterStats.passed++;
        filteredElements.push(el);

        const tagName = el.tagName;
        const role = el.getAttribute("role") || "";
        const ariaLabel = el.getAttribute("aria-label") || "";
        const placeholder = el.getAttribute("placeholder") || "";
        const ariaMultiline = el.getAttribute("aria-multiline");
        const dataTestId = el.getAttribute("data-testid") || "";
        const inputType = el.type?.toLowerCase() || "";

        const nodeType = getNodeType(el);
        const name = getName(el);

        const adjustedBounds = {
          x: Math.round(rect.x + frameOffset.x),
          y: Math.round(rect.y + frameOffset.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };

        const area = adjustedBounds.width * adjustedBounds.height;

        // Check if in dialog
        const isInDialog =
          !!el.closest('[role="dialog"]') ||
          !!el.closest('[role="alertdialog"]') ||
          !!el.closest("dialog");

        // Get closest landmark. Check chrome (banner/header/nav) before main so
        // waffle/app-switcher in headers are tagged correctly and excluded from main content.
        const closestLandmark =
          el.closest('[role="banner"]') ||
          el.closest("header") ||
          el.closest('[role="navigation"]') ||
          el.closest("nav") ||
          el.closest('[role="main"]') ||
          el.closest("main") ||
          el.closest('[role="form"]') ||
          el.closest('[role="search"]') ||
          el.closest("form");
        const landmarkRole =
          closestLandmark?.getAttribute("role") || closestLandmark?.tagName?.toLowerCase() || "";

        // Rich editor detection
        const isRichEditor = !!(
          (el.isContentEditable && tagName !== "INPUT" && tagName !== "TEXTAREA") ||
          ariaMultiline === "true" ||
          (role === "document" && el.isContentEditable) ||
          el.ownerDocument?.designMode === "on" ||
          el.hasAttribute("data-editor") ||
          el.hasAttribute("data-text-editor") ||
          el.hasAttribute("data-rich-text")
        );

        const htmlId = el.id || null;
        const className =
          typeof el.className === "string" && el.className.trim() ? el.className.trim() : null;

        const stableId = generateStableHash(el);
        const assignedNodeId = nextNodeId++;

        const nodeInfo = {
          nodeId: assignedNodeId,
          stableHash: stableId.hash,
          type: nodeType,
          name: name,
          bounds: adjustedBounds,
          selector: getSelector(el),
          htmlId: htmlId,
          className: className,
          textContent: name?.substring(0, 100) || null,
          coordinates: adjustedBounds
            ? {
                x: Math.round(adjustedBounds.x + adjustedBounds.width / 2),
                y: Math.round(adjustedBounds.y + adjustedBounds.height / 2),
              }
            : null,
          tagName: tagName?.toLowerCase(),
          isContentEditable:
            el.isContentEditable ||
            el.getAttribute("contenteditable") === "true" ||
            el.getAttribute("contenteditable") === "",
          isInheritedEditable: el.isContentEditable && el.getAttribute("contenteditable") === null,
          inIframe: frameOffset.x !== 0 || frameOffset.y !== 0,
          hasShadowRoot: !!el.shadowRoot,
          isInputCapture: el._isInputCapture || false,
          placeholder: placeholder,
          ariaLabel: ariaLabel,
          role: role,
          ariaMultiline: ariaMultiline === "true",
          area: area,
          isInDialog: isInDialog,
          landmarkRole: landmarkRole,
          inputType: inputType || "",
          isRichEditor: isRichEditor,
          dataTestId: dataTestId,
        };

        nodeMap.set(nodeInfo.nodeId, el);
        interactiveElements.push(nodeInfo);
      });

      // Store node mapping globally for this tab
      window.__centrisNodeMap = nodeMap;

      // ═══════════════════════════════════════════════════════════════════════════
      // ELEMENT SCORING - GENERALIZED (No domain-specific logic)
      // Only uses instruction-aware filtering when instruction is provided
      // ═══════════════════════════════════════════════════════════════════════════
      const url = window.location.href.toLowerCase();

      // Score each element - only by instruction keywords if provided
      interactiveElements.forEach((el) => {
        // Default: no relevance scoring (all elements equal)
        el._instructionScore = 0;
        el._totalRelevance = 0;

        // INSTRUCTION-AWARE SCORING (only when instruction provided)
        // Score elements based on keyword matches from user instruction
        if (instructionData && instructionData.keywords && instructionData.keywords.length > 0) {
          const instructionScore = scoreElementByKeywords(el, instructionData);
          el._instructionScore = instructionScore;
          el._totalRelevance = instructionScore;
        }
      });

      // ═══════════════════════════════════════════════════════════════════════════
      // CLAWDBOT PATTERN: maxChars-BASED LIMITING
      // ═══════════════════════════════════════════════════════════════════════════
      const originalCount = interactiveElements.length;

      // Sort by instruction relevance and type priority
      const typePriority = { typeable: 0, clickable: 1, selectable: 2, other: 3 };

      // Check if we have instruction-based scoring
      const hasInstructionScoring =
        instructionData && instructionData.keywords && instructionData.keywords.length > 0;

      interactiveElements.sort((a, b) => {
        // INSTRUCTION SCORING TAKES PRIORITY (when provided)
        if (hasInstructionScoring) {
          const aInstructionScore = a._instructionScore || 0;
          const bInstructionScore = b._instructionScore || 0;

          // If one has instruction matches and the other doesn't, instruction match wins
          if (aInstructionScore > 0 && bInstructionScore === 0) {
            return -1;
          }
          if (bInstructionScore > 0 && aInstructionScore === 0) {
            return 1;
          }

          // Both have instruction matches - sort by score
          if (aInstructionScore !== bInstructionScore) {
            return bInstructionScore - aInstructionScore;
          }
        }

        // DEFAULT: Sort by visual position (top-to-bottom, left-to-right)
        // This is the most intuitive ordering for any webpage
        const aY = a.bounds?.y ?? 0;
        const bY = b.bounds?.y ?? 0;
        const yDiff = aY - bY;
        if (Math.abs(yDiff) > 10) {
          return yDiff;
        }

        const aX = a.bounds?.x ?? 0;
        const bX = b.bounds?.x ?? 0;
        if (aX !== bX) {
          return aX - bX;
        }

        // Type priority (typeable > clickable > selectable)
        const typeDiff = (typePriority[a.type] || 3) - (typePriority[b.type] || 3);
        if (typeDiff !== 0) {
          return typeDiff;
        }

        // Prefer labeled elements
        const aHasLabel = a.ariaLabel || a.name?.length > 3 ? 1 : 0;
        const bHasLabel = b.ariaLabel || b.name?.length > 3 ? 1 : 0;
        if (bHasLabel !== aHasLabel) {
          return bHasLabel - aHasLabel;
        }

        // Larger elements last (smaller more likely to be actionable)
        return (a.area || 0) - (b.area || 0);
      });

      // Build slim elements with maxChars limit
      const TYPE_ABBREV = {
        clickable: "cl",
        typeable: "ty",
        selectable: "se",
        other: "ot",
      };

      const slimElements = [];
      let totalChars = 0;
      let truncatedAt = -1;

      for (let i = 0; i < interactiveElements.length; i++) {
        const el = interactiveElements[i];

        const label = (el.ariaLabel || el.name || el.placeholder || "").substring(0, 35);

        const bounds = el.bounds
          ? {
              x: Math.round(el.bounds.x),
              y: Math.round(el.bounds.y),
              w: Math.round(el.bounds.width),
              h: Math.round(el.bounds.height),
            }
          : undefined;

        // LLM-facing format: ONLY id + type + name.
        // Bounds and stableHash stay in _internalNodes for click resolution.
        const slimEl = {
          id: el.nodeId,
          t: TYPE_ABBREV[el.type] || "ot",
          n: label || el.tagName,
        };
        // Only include role when it adds meaning beyond what type already says
        if (el.role && el.role !== "link" && el.role !== "button" && el.role !== "textbox") {
          slimEl.r = el.role;
        }

        const elChars = JSON.stringify(slimEl).length + 1;

        if (maxChars > 0 && totalChars + elChars > maxChars) {
          truncatedAt = i;
          break;
        }

        totalChars += elChars;
        slimElements.push(slimEl);
      }

      const truncatedElements = interactiveElements.slice(0, slimElements.length);

      // Count node types
      const typeCount = { ty: 0, cl: 0, se: 0, ot: 0 };
      slimElements.forEach((el) => {
        typeCount[el.t] = (typeCount[el.t] || 0) + 1;
      });

      const hasRichEditor = truncatedElements.some((el) => el.isRichEditor || el.ariaMultiline);
      const hasContentEditable = truncatedElements.some((el) => el.isContentEditable);
      const hasInputCapture = truncatedElements.some((el) => el.isInputCapture);
      const hasCanvasEditor = hasLargeCanvas && (hasInputCapture || !hasContentEditable);

      // Lean return: only what the gateway needs.
      // _internalNodes is for click resolution (extension keeps its own copy via nodeIdMappings).
      // metadata is stripped to url + count — everything else was diagnostic bloat.
      return {
        interactiveNodes: slimElements,
        _internalNodes: truncatedElements,
        metadata: {
          url: url,
          totalElements: slimElements.length,
        },
      };
    },
    args: [0, { interactive: true, compact: true, maxChars: adaptiveMaxChars }, extractedKeywords],
  });

  const snapshot = results[0]?.result;

  if (!snapshot) {
    return { success: false, error: "No snapshot result", interactiveNodes: [] };
  }

  // Store node mappings for this tab
  if (!globalThis.nodeIdMappings.has(tabId)) {
    globalThis.nodeIdMappings.set(tabId, new Map());
  }
  const tabMapping = globalThis.nodeIdMappings.get(tabId);

  const internalNodes = snapshot._internalNodes || snapshot.interactiveNodes;
  internalNodes.forEach((node) => {
    tabMapping.set(node.nodeId, node);
  });

  // CLAWDBOT PATTERN: STABLE REF CACHING
  try {
    const pageUrl = snapshot.metadata?.url;
    if (pageUrl && internalNodes.length > 0) {
      const cachedRefs = getCachedRefs(pageUrl);
      if (cachedRefs) {
        const matchResult = matchCachedRefs(internalNodes, cachedRefs);
        if (matchResult.count > 0) {
          snapshot.metadata = snapshot.metadata || {};
          snapshot.metadata.cachedRefsMatched = matchResult.count;
          snapshot.metadata.cachedRefsTotal = cachedRefs.size;
        }
      }

      const refMap = buildRefMap(internalNodes);
      if (refMap.size > 0) {
        cacheStableRefs(pageUrl, refMap);
        snapshot.metadata = snapshot.metadata || {};
        snapshot.metadata.refsCached = refMap.size;
      }
    }
  } catch (cacheError) {
    if (typeof logWithTimestamp === "function") {
      logWithTimestamp("warn", `Ref caching error: ${cacheError.message}`);
    }
  }

  // FEB 2026 FIX: Keep _internalNodes for backend - it needs bounds data for ordinal selection
  // Previously this was deleted to reduce payload, but backend needs it to identify content rows
  // The backend browser_tools.py extracts bounds from _internalNodes for proper element selection

  snapshot.success = true;
  return snapshot;
}

// ═══════════════════════════════════════════════════════════════════════════════
// UNLIMITED SNAPSHOT - For debug view
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * UNLIMITED version of getInteractiveSnapshot for popup debug view
 * Returns ALL visible elements without the maxChars limit
 */
async function getInteractiveSnapshotUnlimited(tabId) {
  try {
    if (!tabId || tabId === undefined) {
      const activeTab = await getActiveTab();
      if (!activeTab.success || !activeTab.id) {
        return { success: false, error: "No active tab found", interactiveNodes: [] };
      }
      tabId = activeTab.id;
    }
  } catch (e) {
    return { success: false, error: e.message, interactiveNodes: [] };
  }

  try {
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url || "";
    if (
      url.startsWith("chrome://") ||
      url.startsWith("chrome-extension://") ||
      url.startsWith("edge://") ||
      url.startsWith("about:") ||
      url === ""
    ) {
      return {
        success: false,
        error: "Cannot access this page type",
        interactiveNodes: [],
        restrictedPage: true,
      };
    }
  } catch (e) {}

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const interactiveElements = [];
      const SKIP_TAGS = new Set([
        "SVG",
        "SCRIPT",
        "STYLE",
        "LINK",
        "META",
        "NOSCRIPT",
        "TEMPLATE",
        "HEAD",
      ]);

      const selectors = [
        "a[href]",
        "button",
        "input",
        "select",
        "textarea",
        '[role="button"]',
        '[role="link"]',
        '[role="checkbox"]',
        '[role="radio"]',
        '[role="textbox"]',
        '[role="searchbox"]',
        '[role="combobox"]',
        '[role="listbox"]',
        '[role="menuitem"]',
        '[role="tab"]',
        '[role="option"]',
        '[role="switch"]',
        '[contenteditable="true"]',
        '[tabindex]:not([tabindex="-1"])',
        "[onclick]",
        "[data-action]",
      ];

      const elements = document.querySelectorAll(selectors.join(","));
      let nodeId = 1;

      elements.forEach((el) => {
        if (SKIP_TAGS.has(el.tagName)) {
          return;
        }

        const rect = el.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) {
          return;
        }

        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
          return;
        }

        let type = "clickable";
        const tag = el.tagName;
        const inputType = el.type?.toLowerCase();

        if (
          tag === "INPUT" &&
          ["text", "email", "password", "search", "tel", "url", "number"].includes(inputType)
        ) {
          type = "typeable";
        } else if (tag === "TEXTAREA" || el.contentEditable === "true") {
          type = "typeable";
        } else if (tag === "SELECT" || el.getAttribute("role") === "listbox") {
          type = "selectable";
        }

        const name =
          el.ariaLabel ||
          el.name ||
          el.placeholder ||
          el.textContent?.trim().substring(0, 50) ||
          "";

        interactiveElements.push({
          nodeId: nodeId++,
          type: type,
          name: name,
          role: el.getAttribute("role") || undefined,
          bounds: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
          tagName: tag,
        });
      });

      interactiveElements.sort((a, b) => {
        const yDiff = (a.bounds?.y || 0) - (b.bounds?.y || 0);
        if (Math.abs(yDiff) > 10) {
          return yDiff;
        }
        return (a.bounds?.x || 0) - (b.bounds?.x || 0);
      });

      const TYPE_ABBREV = { clickable: "cl", typeable: "ty", selectable: "se", other: "ot" };

      // LLM-facing: only id + type + name. Bounds stay in _internalNodes.
      const slimElements = interactiveElements.map((el) => {
        const slim = {
          id: el.nodeId,
          t: TYPE_ABBREV[el.type] || "ot",
          n: (el.name || "").substring(0, 50),
        };
        if (el.role && el.role !== "link" && el.role !== "button" && el.role !== "textbox") {
          slim.r = el.role;
        }
        return slim;
      });

      return {
        interactiveNodes: slimElements,
        _internalNodes: interactiveElements,
        metadata: {
          totalElements: interactiveElements.length,
          url: window.location.href,
        },
      };
    },
  });

  const result = results[0]?.result;
  if (result) {
    result.success = true;
  }
  return result || { success: false, error: "No result" };
}

/**
 * Get interactive elements (legacy API compatibility)
 */
async function getInteractiveElements(tabId) {
  const snapshot = await getInteractiveSnapshot(tabId);

  if (!snapshot.interactiveNodes) {
    return [];
  }

  return snapshot.interactiveNodes.map((node) => ({
    node_id: node.id,
    type:
      node.t === "cl"
        ? "clickable"
        : node.t === "ty"
          ? "typeable"
          : node.t === "se"
            ? "selectable"
            : "other",
    name: node.n,
    role: node.r,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCREENSHOTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Take a screenshot of the visible area
 */
async function takeScreenshot(tabId) {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: "png" });

    return {
      success: true,
      image: dataUrl,
      format: "png",
      timestamp: Date.now(),
    };
  } catch (e) {
    return { success: false, error: `Screenshot failed: ${e.message}` };
  }
}

/**
 * Take a screenshot of a specific element
 */
async function takeElementScreenshot(tabId, selector) {
  try {
    const boundsResult = await chrome.scripting.executeScript({
      target: { tabId },
      func: (selector) => {
        const el = document.querySelector(selector);
        if (!el) {
          return null;
        }

        el.scrollIntoView({ block: "center" });
        const rect = el.getBoundingClientRect();

        return {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      },
      args: [selector],
    });

    const bounds = boundsResult[0]?.result;
    if (!bounds) {
      return { success: false, error: "Element not found" };
    }

    const screenshot = await takeScreenshot(tabId);
    if (!screenshot.success) {
      return screenshot;
    }

    return {
      success: true,
      image: screenshot.image,
      format: "png",
      bounds,
      timestamp: Date.now(),
    };
  } catch (e) {
    return { success: false, error: `Element screenshot failed: ${e.message}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// VISION STREAMING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Start streaming screenshots for vision-based interaction
 */
function startVisionStream(tabId, callback, intervalMs = 500) {
  if (visionStreamIntervals.has(tabId)) {
    return { success: false, error: "Vision stream already active for this tab" };
  }

  globalThis.visionStreamingActive = true;
  visionStreamCallbacks.set(tabId, callback);

  const interval = setInterval(async () => {
    const screenshot = await takeScreenshot(tabId);
    const cb = visionStreamCallbacks.get(tabId);
    if (cb && screenshot.success) {
      cb(screenshot.image);
    }
  }, intervalMs);

  visionStreamIntervals.set(tabId, interval);

  return { success: true, streaming: true };
}

/**
 * Stop vision streaming for a tab
 */
function stopVisionStream(tabId) {
  const interval = visionStreamIntervals.get(tabId);
  if (interval) {
    clearInterval(interval);
    visionStreamIntervals.delete(tabId);
  }

  visionStreamCallbacks.delete(tabId);

  if (visionStreamIntervals.size === 0) {
    globalThis.visionStreamingActive = false;
  }

  return { success: true, stopped: true };
}

/**
 * Stop all vision streams
 */
function stopAllVisionStreams() {
  for (const tabId of visionStreamIntervals.keys()) {
    stopVisionStream(tabId);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CACHED SNAPSHOT ACCESS
// ═══════════════════════════════════════════════════════════════════════════════

// cachedSnapshots is initialized in background.js (globalThis.cachedSnapshots)

function setCachedSnapshot(tabId, snapshot) {
  globalThis.cachedSnapshots.set(tabId, snapshot);
}

function getCachedSnapshot(tabId) {
  return globalThis.cachedSnapshots.get(tabId);
}

function clearCachedSnapshot(tabId) {
  globalThis.cachedSnapshots.delete(tabId);
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

if (typeof globalThis !== "undefined") {
  // Main snapshot functions
  globalThis.getInteractiveSnapshot = getInteractiveSnapshot;
  globalThis.getInteractiveSnapshotUnlimited = getInteractiveSnapshotUnlimited;
  globalThis.getInteractiveElements = getInteractiveElements;
  globalThis.getAccessibilityTree = getAccessibilityTree;

  // Instruction-aware filtering utilities (for testing/debugging)
  globalThis.extractInstructionKeywords = extractInstructionKeywords;
  globalThis.scoreElementByInstruction = scoreElementByInstruction;

  // Screenshots
  globalThis.takeScreenshot = takeScreenshot;
  globalThis.takeElementScreenshot = takeElementScreenshot;

  // Vision streaming
  globalThis.startVisionStream = startVisionStream;
  globalThis.stopVisionStream = stopVisionStream;
  globalThis.stopAllVisionStreams = stopAllVisionStreams;
  // visionStreamingActive is already on globalThis (initialized in background.js)

  // Node mappings
  // nodeIdMappings is already on globalThis (initialized in background.js)
  globalThis.getNodeMappings = getNodeMappings;
  globalThis.setNodeMappings = setNodeMappings;
  globalThis.clearNodeMappings = clearNodeMappings;

  // Stable ref caching
  globalThis.cacheStableRefs = cacheStableRefs;
  globalThis.getCachedRefs = getCachedRefs;
  globalThis.matchCachedRefs = matchCachedRefs;
  globalThis.buildRefMap = buildRefMap;
  globalThis.getRefCacheKey = getRefCacheKey;

  // FEB 2026 FIX: Export unlimited snapshot for popup debugging
  globalThis.getInteractiveSnapshotUnlimited = getInteractiveSnapshotUnlimited;

  // Cached snapshots
  globalThis.setCachedSnapshot = setCachedSnapshot;
  globalThis.getCachedSnapshot = getCachedSnapshot;
  globalThis.clearCachedSnapshot = clearCachedSnapshot;
}
