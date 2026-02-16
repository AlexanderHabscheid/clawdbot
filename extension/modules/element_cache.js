/**
 * Element Cache Module for Centris Chrome Extension
 *
 * FULL PRODUCTION VERSION with:
 * - Node ID mappings per tab
 * - Stable hash computation for element identification
 * - LLM-FREE element finding by text pattern
 * - Smart click/type with intent-based matching
 * - Cached snapshots for fast lookup
 */

// ═══════════════════════════════════════════════════════════════════════════════
// CACHE STORAGE (shared with snapshot.js, but defined here for independence)
// ═══════════════════════════════════════════════════════════════════════════════

// Note: nodeIdMappings and cachedSnapshots are declared in background.js before modules load
// We access them via globalThis to avoid duplicate declarations with importScripts

// Cache expiry time (5 minutes)
const CACHE_EXPIRY_MS = 5 * 60 * 1000;

// ═══════════════════════════════════════════════════════════════════════════════
// STABLE HASH COMPUTATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Compute a stable hash for an element that survives DOM changes
 * Uses multiple element attributes to create a fingerprint
 *
 * @param {Element} element - DOM element
 * @returns {string} - Hash string
 */
function computeElementHash(element) {
  const components = [];

  // Tag name
  components.push(element.tagName?.toLowerCase() || "unknown");

  // ID is very stable
  if (element.id) {
    components.push(`id:${element.id}`);
  }

  // Stable attributes
  const stableAttrs = ["name", "data-testid", "data-test", "role", "type", "href", "aria-label"];
  for (const attr of stableAttrs) {
    const value = element.getAttribute?.(attr);
    if (value) {
      components.push(`${attr}:${value.substring(0, 50)}`);
    }
  }

  // Stable class names (filtering out generated ones)
  if (element.className && typeof element.className === "string") {
    const classes = element.className
      .split(/\s+/)
      .filter((c) => c && c.length > 1 && c.length < 40)
      .filter((c) => !/^(is-|has-|ng-|v-|js-|css-|__|\d)/.test(c))
      .toSorted()
      .slice(0, 5);
    if (classes.length > 0) {
      components.push(`cls:${classes.join(".")}`);
    }
  }

  // Position within landmark (stable context)
  const landmark = element.closest?.(
    '[role="main"], [role="navigation"], main, nav, header, footer, aside, form',
  );
  if (landmark && landmark !== element) {
    const siblings = Array.from(landmark.querySelectorAll(element.tagName?.toLowerCase() || "*"));
    const index = siblings.indexOf(element);
    if (index > -1) {
      const landmarkId =
        landmark.id || landmark.getAttribute?.("role") || landmark.tagName.toLowerCase();
      components.push(`pos:${landmarkId}[${index}]`);
    }
  }

  // Text content hash (first 30 chars)
  const text = (element.textContent || "").trim().substring(0, 30);
  if (text && text.length > 2) {
    let textHash = 0;
    for (let i = 0; i < text.length; i++) {
      textHash = (textHash << 5) - textHash + text.charCodeAt(i);
      textHash = textHash & textHash;
    }
    components.push(`txt:${Math.abs(textHash).toString(36).substring(0, 6)}`);
  }

  // Create final hash
  const fingerprint = components.join("|");
  let hash = 0;
  for (let i = 0; i < fingerprint.length; i++) {
    hash = (hash << 5) - hash + fingerprint.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

// ═══════════════════════════════════════════════════════════════════════════════
// BASIC CACHE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Store node mappings for a tab
 */
function setNodeMappings(tabId, mapping) {
  globalThis.nodeIdMappings.set(tabId, mapping);
}

/**
 * Get node mappings for a tab
 */
function getNodeMappings(tabId) {
  return globalThis.nodeIdMappings.get(tabId);
}

/**
 * Get info for a specific node
 * Enhanced version with full semantic info for pattern replay
 */
async function getNodeInfo(tabId, nodeId) {
  // Get active tab if not specified
  if (!tabId && typeof getActiveTab === "function") {
    const activeTab = await getActiveTab();
    tabId = activeTab?.id;
  }

  if (!tabId) {
    return { success: false, error: "No tab ID available" };
  }

  const tabMapping = globalThis.nodeIdMappings.get(tabId);
  if (!tabMapping) {
    return {
      success: false,
      error: "No snapshot data for this tab. Call getInteractiveSnapshot first.",
    };
  }

  const nodeInfo = tabMapping.get(nodeId);
  if (!nodeInfo) {
    return {
      success: false,
      error: `Node ID ${nodeId} not found in snapshot`,
    };
  }

  // Return the semantic info that can be used for pattern replay
  return {
    success: true,
    nodeId: nodeId,
    nodeInfo: {
      name: nodeInfo.name,
      ariaLabel: nodeInfo.ariaLabel,
      role: nodeInfo.role,
      type: nodeInfo.type,
      tagName: nodeInfo.tagName,
      placeholder: nodeInfo.placeholder,
      textContent: nodeInfo.textContent,
      title: nodeInfo.title,
      htmlId: nodeInfo.htmlId,
      dataTestId: nodeInfo.dataTestId,
      bounds: nodeInfo.bounds,
      selector: nodeInfo.selector,
    },
  };
}

/**
 * Store a snapshot for a tab
 */
function setCachedSnapshot(tabId, snapshot) {
  globalThis.cachedSnapshots.set(tabId, {
    snapshot,
    timestamp: Date.now(),
  });
}

/**
 * Get cached snapshot for a tab if not expired
 */
function getCachedSnapshot(tabId) {
  const cached = globalThis.cachedSnapshots.get(tabId);
  if (!cached) {
    return null;
  }

  if (Date.now() - cached.timestamp > CACHE_EXPIRY_MS) {
    globalThis.cachedSnapshots.delete(tabId);
    return null;
  }

  return cached.snapshot;
}

/**
 * Clear cache for a tab
 */
function clearTabCache(tabId) {
  globalThis.nodeIdMappings.delete(tabId);
  globalThis.cachedSnapshots.delete(tabId);
}

/**
 * Clear all caches
 */
function clearAllCaches() {
  globalThis.nodeIdMappings.clear();
  globalThis.cachedSnapshots.clear();
}

// ═══════════════════════════════════════════════════════════════════════════════
// LLM-FREE ELEMENT FINDING - Text-based search through cached snapshot
// This enables "instant execute" patterns without LLM calls for element discovery
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Find element in current snapshot by text pattern - NO LLM REQUIRED!
 * Searches: name, ariaLabel, textContent, placeholder, role
 *
 * @param {number} tabId - Tab ID
 * @param {string} textPattern - Text to search for (case-insensitive, supports | for OR)
 * @param {object} options - Additional matching options
 * @returns {object} - Matched element with nodeId or error
 */
async function findElementByText(tabId, textPattern, options = {}) {
  const tabMapping = globalThis.nodeIdMappings.get(tabId);
  if (!tabMapping) {
    return {
      success: false,
      error: "No snapshot data for this tab. Call getInteractiveSnapshot first.",
      hint: "Get a fresh snapshot with get_interactive_snapshot before using find_element_by_text",
    };
  }

  const {
    matchType = "contains", // 'exact', 'contains', 'startsWith', 'regex'
    role = null, // Filter by role (button, link, textbox, etc.)
    type = null, // Filter by type (clickable, typeable, selectable)
    preferVisible = true, // Prefer elements with larger bounds (more visible)
    maxResults = 5, // Return top N matches
  } = options;

  const matches = [];
  const patterns = textPattern.split("|").map((p) => p.trim().toLowerCase());

  // Search through all elements in the snapshot
  for (const [nodeId, nodeInfo] of tabMapping.entries()) {
    // Build searchable text from all element properties
    const searchableTexts = [
      nodeInfo.name,
      nodeInfo.ariaLabel,
      nodeInfo.textContent,
      nodeInfo.placeholder,
      nodeInfo.title,
      nodeInfo.htmlId,
      nodeInfo.dataTestId,
    ]
      .filter(Boolean)
      .map((t) => t.toLowerCase());

    // Check if any pattern matches any searchable text
    let matchScore = 0;
    let matchedPattern = null;
    let matchedField = null;

    for (const pattern of patterns) {
      for (const text of searchableTexts) {
        let matched = false;

        if (matchType === "exact") {
          matched = text === pattern;
        } else if (matchType === "startsWith") {
          matched = text.startsWith(pattern);
        } else if (matchType === "regex") {
          try {
            matched = new RegExp(pattern, "i").test(text);
          } catch (e) {
            matched = text.includes(pattern);
          }
        } else {
          // contains (default)
          matched = text.includes(pattern);
        }

        if (matched) {
          // Score based on match quality
          if (text === pattern) {
            matchScore = 100;
          } // Exact match
          else if (text.startsWith(pattern)) {
            matchScore = Math.max(matchScore, 80);
          } else {
            matchScore = Math.max(matchScore, 60);
          }

          // Boost score for ariaLabel/name matches (more semantic)
          if (
            text === (nodeInfo.ariaLabel || "").toLowerCase() ||
            text === (nodeInfo.name || "").toLowerCase()
          ) {
            matchScore += 10;
          }

          matchedPattern = pattern;
          matchedField = text;
        }
      }
    }

    if (matchScore > 0) {
      // Apply role filter
      if (role && nodeInfo.role !== role && nodeInfo.tagName !== role) {
        continue;
      }

      // Apply type filter
      if (type && nodeInfo.type !== type) {
        continue;
      }

      // Boost score for visible elements (has bounds with positive area)
      if (preferVisible && nodeInfo.bounds) {
        const area = nodeInfo.bounds.width * nodeInfo.bounds.height;
        if (area > 0) {
          matchScore += 5;
        }
        if (area > 1000) {
          matchScore += 5;
        } // Reasonably sized element
      }

      matches.push({
        nodeId: nodeId,
        score: matchScore,
        matchedPattern: matchedPattern,
        matchedField: matchedField,
        name: nodeInfo.name,
        ariaLabel: nodeInfo.ariaLabel,
        role: nodeInfo.role,
        type: nodeInfo.type,
        tagName: nodeInfo.tagName,
        bounds: nodeInfo.bounds,
        selector: nodeInfo.selector,
        htmlId: nodeInfo.htmlId,
      });
    }
  }

  // Sort by score (highest first)
  matches.sort((a, b) => b.score - a.score);

  if (matches.length === 0) {
    return {
      success: false,
      error: `No element found matching "${textPattern}"`,
      searchedPattern: textPattern,
      options: options,
      hint: "Try a different text pattern or call get_interactive_snapshot to refresh",
    };
  }

  const topMatch = matches[0];

  return {
    success: true,
    found: true,
    nodeId: topMatch.nodeId,
    score: topMatch.score,
    matchedPattern: topMatch.matchedPattern,
    element: {
      name: topMatch.name,
      ariaLabel: topMatch.ariaLabel,
      role: topMatch.role,
      type: topMatch.type,
      tagName: topMatch.tagName,
      bounds: topMatch.bounds,
      selector: topMatch.selector,
      htmlId: topMatch.htmlId,
    },
    alternativeMatches: matches.slice(1, maxResults).map((m) => ({
      nodeId: m.nodeId,
      score: m.score,
      name: m.name,
      type: m.type,
    })),
  };
}

/**
 * Click element by text pattern - NO LLM REQUIRED!
 * Combines find_element_by_text + click_node in one operation
 * This is the key to instant pattern execution!
 *
 * @param {number} tabId - Tab ID
 * @param {string} textPattern - Text to search for
 * @param {object} options - Matching options
 * @returns {object} - Click result
 */
async function clickElementByText(tabId, textPattern, options = {}) {
  // First, find the element
  const findResult = await findElementByText(tabId, textPattern, {
    ...options,
    type: options.type || "clickable", // Default to clickable elements
  });

  if (!findResult.success) {
    return findResult;
  }

  // Then click it (clickNode must be available from interactions.js)
  if (typeof clickNode === "function") {
    const clickResult = await clickNode(tabId, findResult.nodeId);

    return {
      ...clickResult,
      foundElement: findResult.element,
      matchedPattern: findResult.matchedPattern,
      matchScore: findResult.score,
      method: "text_pattern",
    };
  }

  return {
    success: false,
    error: "clickNode function not available",
    foundElement: findResult.element,
    nodeId: findResult.nodeId,
  };
}

/**
 * Input text into element by text pattern - NO LLM REQUIRED!
 * Combines find_element_by_text + input_text_node in one operation
 *
 * @param {number} tabId - Tab ID
 * @param {string} textPattern - Text pattern to find the input field
 * @param {string} text - Text to type
 * @param {object} options - Matching options
 * @returns {object} - Input result
 */
async function inputTextByPattern(tabId, textPattern, text, options = {}) {
  // First, find the element
  const findResult = await findElementByText(tabId, textPattern, {
    ...options,
    type: options.type || "typeable", // Default to typeable elements
  });

  if (!findResult.success) {
    return findResult;
  }

  // Then type into it (typeIntoNode must be available from interactions.js)
  if (typeof typeIntoNode === "function") {
    const typeResult = await typeIntoNode(tabId, findResult.nodeId, text);

    return {
      ...typeResult,
      foundElement: findResult.element,
      matchedPattern: findResult.matchedPattern,
      matchScore: findResult.score,
      method: "text_pattern",
    };
  }

  return {
    success: false,
    error: "typeIntoNode function not available",
    foundElement: findResult.element,
    nodeId: findResult.nodeId,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SMART CLICK - Intent-based element clicking with ZERO token bloat!
// ═══════════════════════════════════════════════════════════════════════════════
//
// This is the key to massive token reduction:
// - Takes a FRESH snapshot internally (no pre-req)
// - Filters by description BEFORE returning to LLM
// - If 1 match → clicks immediately (ZERO LLM disambiguation tokens!)
// - If 2-5 matches → returns ONLY candidates (~200 tokens vs 3000)
// - If 0 matches → returns error with suggestions
//
// Token reduction: 40 elements × 75 tokens = 3000 → 0-375 tokens (87-100% reduction!)
// ═══════════════════════════════════════════════════════════════════════════════

// Common synonyms for better matching
const SYNONYMS = {
  search: ["search", "find", "lookup", "query"],
  compose: ["compose", "new", "write", "create"],
  send: ["send", "submit", "post", "publish"],
  inbox: ["inbox", "mail", "messages"],
  settings: ["settings", "preferences", "config", "options", "gear", "cog"],
  menu: ["menu", "hamburger", "nav", "navigation"],
  close: ["close", "x", "dismiss", "cancel"],
  login: ["login", "sign in", "signin", "log in"],
  logout: ["logout", "sign out", "signout", "log out"],
  profile: ["profile", "account", "user", "avatar"],
  home: ["home", "main", "dashboard"],
  back: ["back", "previous", "return"],
  next: ["next", "forward", "continue"],
  save: ["save", "update", "apply"],
  delete: ["delete", "remove", "trash", "bin"],
  edit: ["edit", "modify", "change"],
  add: ["add", "plus", "new", "create"],
  refresh: ["refresh", "reload", "sync"],
  download: ["download", "export", "save as"],
  upload: ["upload", "import", "attach"],
};

/**
 * Smart click - takes fresh snapshot, filters by description, auto-clicks if unambiguous
 *
 * @param {number} tabId - Tab ID
 * @param {string} description - Natural language description like "search button", "compose", "inbox"
 * @param {object} options - Options for matching behavior
 * @returns {object} - Click result or candidates for disambiguation
 */
async function smartClick(tabId, description, options = {}) {
  const {
    autoClick = true, // Auto-click if only 1 match found
    maxCandidates = 5, // Max candidates to return for disambiguation
    typeFilter = "clickable", // 'clickable', 'typeable', 'any'
    strictMatch = false, // Require high confidence match
  } = options;

  // Step 1: Take a FRESH snapshot (don't rely on stale cache)
  if (typeof getInteractiveSnapshot !== "function") {
    return {
      success: false,
      error: "getInteractiveSnapshot function not available",
    };
  }

  const snapshotResult = await getInteractiveSnapshot(tabId);

  if (!snapshotResult || !snapshotResult.interactiveNodes) {
    return {
      success: false,
      error: "Failed to get page snapshot",
      hint: "Make sure the page has loaded completely",
    };
  }

  const allElements = snapshotResult.interactiveNodes;

  // Step 2: Parse description into search terms
  const descLower = description.toLowerCase().trim();
  const searchTerms = descLower.split(/[\s,]+/).filter((t) => t.length > 1);

  // Expand search terms with synonyms
  const expandedTerms = new Set(searchTerms);
  for (const term of searchTerms) {
    for (const [key, syns] of Object.entries(SYNONYMS)) {
      if (syns.includes(term) || term.includes(key)) {
        syns.forEach((s) => expandedTerms.add(s));
      }
    }
  }

  // Step 3: Score each element based on description match
  const scoredElements = [];

  for (const el of allElements) {
    // Map abbreviated types back for filtering
    const elType =
      el.t === "cl"
        ? "clickable"
        : el.t === "ty"
          ? "typeable"
          : el.t === "se"
            ? "selectable"
            : "other";

    // Apply type filter
    if (typeFilter === "clickable" && elType !== "clickable") {
      continue;
    }
    if (typeFilter === "typeable" && elType !== "typeable") {
      continue;
    }

    // Build searchable text from element (handling abbreviated format)
    const searchableText = [
      el.n, // name
      el.r, // role
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    let score = 0;
    let matchedTerms = [];

    // Score based on term matches
    for (const term of expandedTerms) {
      if (searchableText.includes(term)) {
        // Exact word match scores higher
        if (new RegExp(`\\b${term}\\b`).test(searchableText)) {
          score += 30;
        } else {
          score += 15;
        }
        matchedTerms.push(term);
      }
    }

    // Bonus for exact name match
    if (el.n && el.n.toLowerCase() === descLower) {
      score += 100;
    }

    // Bonus for role matches
    if (el.r) {
      const roleLower = el.r.toLowerCase();
      if (searchTerms.some((t) => roleLower.includes(t))) {
        score += 20;
      }
    }

    if (score > 0) {
      scoredElements.push({
        nodeId: el.id,
        score: score,
        matchedTerms: matchedTerms,
        // Minimal info for disambiguation (token efficient!)
        name: (el.n || "").substring(0, 40),
        type: elType,
        role: el.r,
      });
    }
  }

  // Sort by score descending
  scoredElements.sort((a, b) => b.score - a.score);

  // Step 4: Make decision based on matches
  const candidates = scoredElements.slice(0, maxCandidates);

  if (candidates.length === 0) {
    // No matches - return error with available elements for debugging
    const availableTypes = { cl: 0, ty: 0, se: 0, ot: 0 };
    allElements.forEach((el) => {
      const t = el.t || "ot";
      availableTypes[t] = (availableTypes[t] || 0) + 1;
    });

    return {
      success: false,
      error: `No element matching "${description}" found`,
      searched: description,
      availableElementTypes: availableTypes,
      totalElements: allElements.length,
      hint: "Try a different description or use get_interactive_snapshot to see all elements",
    };
  }

  if (candidates.length === 1 && autoClick) {
    // Single match - AUTO CLICK! No LLM disambiguation needed!
    const target = candidates[0];

    if (typeof clickNode === "function") {
      const clickResult = await clickNode(tabId, target.nodeId);

      return {
        success: clickResult.success,
        autoClicked: true,
        clicked: target,
        matchConfidence: target.score,
        message: clickResult.success
          ? `Auto-clicked "${target.name || description}"`
          : `Found match but click failed: ${clickResult.error}`,
        ...clickResult,
      };
    }

    return {
      success: false,
      error: "clickNode function not available",
      target: target,
    };
  }

  // Multiple matches - check if top match is significantly better
  if (autoClick && candidates.length >= 2) {
    const topScore = candidates[0].score;
    const secondScore = candidates[1].score;

    // If top match is 2x better than second, auto-click it
    if (topScore >= secondScore * 2 && topScore >= 50) {
      const target = candidates[0];

      if (typeof clickNode === "function") {
        const clickResult = await clickNode(tabId, target.nodeId);

        return {
          success: clickResult.success,
          autoClicked: true,
          clicked: target,
          matchConfidence: target.score,
          message: clickResult.success
            ? `Auto-clicked best match "${target.name || description}"`
            : `Found best match but click failed: ${clickResult.error}`,
          otherCandidates: candidates.slice(1),
          ...clickResult,
        };
      }
    }
  }

  // Multiple ambiguous matches - return candidates for LLM to pick
  // This is MUCH smaller than full snapshot! (5 elements vs 40)
  return {
    success: true,
    autoClicked: false,
    needsDisambiguation: true,
    message: `Found ${candidates.length} possible matches for "${description}"`,
    candidates: candidates,
    hint: "Call click_node with the nodeId of the correct element",
  };
}

/**
 * Smart type - takes fresh snapshot, finds input by description, types into it
 *
 * @param {number} tabId - Tab ID
 * @param {string} description - Natural language description of the input field
 * @param {string} text - Text to type
 * @param {object} options - Options for matching behavior
 * @returns {object} - Type result or candidates for disambiguation
 */
async function smartType(tabId, description, text, options = {}) {
  // Use smart click logic but for typeable elements
  const result = await smartClick(tabId, description, {
    ...options,
    typeFilter: "typeable",
    autoClick: false, // Don't click, we'll type instead
  });

  if (!result.success && !result.needsDisambiguation) {
    return result;
  }

  // Get the target element
  let targetNodeId;

  if (result.autoClicked) {
    // Already found single match
    targetNodeId = result.clicked.nodeId;
  } else if (result.candidates && result.candidates.length > 0) {
    // Take the best match
    if (
      result.candidates.length === 1 ||
      result.candidates[0].score >= (result.candidates[1]?.score || 0) * 2
    ) {
      targetNodeId = result.candidates[0].nodeId;
    } else {
      // Ambiguous - return candidates for disambiguation
      return {
        ...result,
        message: `Found ${result.candidates.length} input fields matching "${description}"`,
        hint: "Call input_text_node with the nodeId of the correct field",
      };
    }
  }

  if (!targetNodeId) {
    return {
      success: false,
      error: "Could not determine target element",
    };
  }

  // Type into the element
  if (typeof typeIntoNode === "function") {
    const typeResult = await typeIntoNode(tabId, targetNodeId, text);

    return {
      ...typeResult,
      autoTyped: true,
      matchedElement: result.candidates?.[0] || result.clicked,
      message: typeResult.success
        ? `Auto-typed into "${result.candidates?.[0]?.name || description}"`
        : `Found match but type failed: ${typeResult.error}`,
    };
  }

  return {
    success: false,
    error: "typeIntoNode function not available",
    targetNodeId: targetNodeId,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB LIFECYCLE
// ═══════════════════════════════════════════════════════════════════════════════

// Clear cache when tab is closed
if (typeof chrome !== "undefined" && chrome.tabs) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    clearTabCache(tabId);
  });

  // Clear cache when tab navigates
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url) {
      clearTabCache(tabId);
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

if (typeof globalThis !== "undefined") {
  // Basic cache management
  globalThis.computeElementHash = computeElementHash;
  globalThis.setNodeMappings = setNodeMappings;
  globalThis.getNodeMappings = getNodeMappings;
  globalThis.getNodeInfo = getNodeInfo;
  globalThis.setCachedSnapshot = setCachedSnapshot;
  globalThis.getCachedSnapshot = getCachedSnapshot;
  globalThis.clearTabCache = clearTabCache;
  globalThis.clearAllCaches = clearAllCaches;

  // LLM-free element finding
  globalThis.findElementByText = findElementByText;
  globalThis.clickElementByText = clickElementByText;
  globalThis.inputTextByPattern = inputTextByPattern;

  // Smart click/type (intent-based)
  globalThis.smartClick = smartClick;
  globalThis.smartType = smartType;
}
