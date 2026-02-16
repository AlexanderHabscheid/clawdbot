/**
 * Command Cache for Centris AI
 * ============================
 * Provides instant responses for common voice commands.
 * These commands bypass the LLM entirely for sub-50ms response times.
 *
 * IMPORTANT: Commands here should be:
 * 1. Deterministic (same command = same action always)
 * 2. High-frequency (common user requests)
 * 3. Simple (no context needed)
 *
 * For context-dependent commands, use the LLM.
 */

// =====================================================
// PRE-DEFINED COMMAND MAPPINGS
// =====================================================

export const COMMAND_CACHE = {
  // =====================================================
  // NAVIGATION COMMANDS
  // =====================================================
  "go to gmail": { action: "navigate", url: "https://mail.google.com" },
  "open gmail": { action: "navigate", url: "https://mail.google.com" },
  "go to google": { action: "navigate", url: "https://google.com" },
  "open google": { action: "navigate", url: "https://google.com" },
  "go to youtube": { action: "navigate", url: "https://youtube.com" },
  "open youtube": { action: "navigate", url: "https://youtube.com" },
  "go to twitter": { action: "navigate", url: "https://twitter.com" },
  "go to x": { action: "navigate", url: "https://twitter.com" },
  "open twitter": { action: "navigate", url: "https://twitter.com" },
  "go to facebook": { action: "navigate", url: "https://facebook.com" },
  "open facebook": { action: "navigate", url: "https://facebook.com" },
  "go to linkedin": { action: "navigate", url: "https://linkedin.com" },
  "open linkedin": { action: "navigate", url: "https://linkedin.com" },
  "go to github": { action: "navigate", url: "https://github.com" },
  "open github": { action: "navigate", url: "https://github.com" },
  "go to reddit": { action: "navigate", url: "https://reddit.com" },
  "open reddit": { action: "navigate", url: "https://reddit.com" },
  "go to amazon": { action: "navigate", url: "https://amazon.com" },
  "open amazon": { action: "navigate", url: "https://amazon.com" },
  "go to google drive": { action: "navigate", url: "https://drive.google.com" },
  "open google drive": { action: "navigate", url: "https://drive.google.com" },
  "go to google docs": { action: "navigate", url: "https://docs.google.com" },
  "open google docs": { action: "navigate", url: "https://docs.google.com" },
  "go to google sheets": { action: "navigate", url: "https://sheets.google.com" },
  "open google sheets": { action: "navigate", url: "https://sheets.google.com" },
  "go to calendar": { action: "navigate", url: "https://calendar.google.com" },
  "open calendar": { action: "navigate", url: "https://calendar.google.com" },
  "go to google calendar": { action: "navigate", url: "https://calendar.google.com" },
  "go to notion": { action: "navigate", url: "https://notion.so" },
  "open notion": { action: "navigate", url: "https://notion.so" },
  "go to slack": { action: "navigate", url: "https://slack.com" },
  "open slack": { action: "navigate", url: "https://slack.com" },
  "go to chatgpt": { action: "navigate", url: "https://chat.openai.com" },
  "open chatgpt": { action: "navigate", url: "https://chat.openai.com" },
  "go to claude": { action: "navigate", url: "https://claude.ai" },
  "open claude": { action: "navigate", url: "https://claude.ai" },
  "go to figma": { action: "navigate", url: "https://figma.com" },
  "open figma": { action: "navigate", url: "https://figma.com" },
  "go to spotify": { action: "navigate", url: "https://open.spotify.com" },
  "open spotify": { action: "navigate", url: "https://open.spotify.com" },
  "go to netflix": { action: "navigate", url: "https://netflix.com" },
  "open netflix": { action: "navigate", url: "https://netflix.com" },

  // =====================================================
  // BROWSER CONTROL COMMANDS
  // =====================================================
  "scroll down": { action: "scroll", direction: "down", amount: 300 },
  "scroll up": { action: "scroll", direction: "up", amount: 300 },
  "scroll down more": { action: "scroll", direction: "down", amount: 600 },
  "scroll up more": { action: "scroll", direction: "up", amount: 600 },
  "scroll to top": { action: "scroll", direction: "top" },
  "scroll to bottom": { action: "scroll", direction: "bottom" },
  "go to top": { action: "scroll", direction: "top" },
  "go to bottom": { action: "scroll", direction: "bottom" },
  "page down": { action: "scroll", direction: "down", amount: 800 },
  "page up": { action: "scroll", direction: "up", amount: 800 },

  "go back": { action: "navigate_back" },
  "go forward": { action: "navigate_forward" },
  back: { action: "navigate_back" },
  forward: { action: "navigate_forward" },

  refresh: { action: "refresh" },
  reload: { action: "refresh" },
  "reload page": { action: "refresh" },
  "refresh page": { action: "refresh" },

  "close tab": { action: "close_tab" },
  "close this tab": { action: "close_tab" },
  "new tab": { action: "new_tab" },
  "open new tab": { action: "new_tab" },
  "next tab": { action: "next_tab" },
  "previous tab": { action: "previous_tab" },

  // =====================================================
  // SYSTEM/KEYBOARD COMMANDS
  // =====================================================
  copy: { action: "keyboard", keys: ["cmd", "c"] },
  "copy that": { action: "keyboard", keys: ["cmd", "c"] },
  paste: { action: "keyboard", keys: ["cmd", "v"] },
  "paste that": { action: "keyboard", keys: ["cmd", "v"] },
  cut: { action: "keyboard", keys: ["cmd", "x"] },
  "cut that": { action: "keyboard", keys: ["cmd", "x"] },
  undo: { action: "keyboard", keys: ["cmd", "z"] },
  "undo that": { action: "keyboard", keys: ["cmd", "z"] },
  redo: { action: "keyboard", keys: ["cmd", "shift", "z"] },
  "redo that": { action: "keyboard", keys: ["cmd", "shift", "z"] },
  save: { action: "keyboard", keys: ["cmd", "s"] },
  "save that": { action: "keyboard", keys: ["cmd", "s"] },
  "select all": { action: "keyboard", keys: ["cmd", "a"] },
  find: { action: "keyboard", keys: ["cmd", "f"] },
  search: { action: "keyboard", keys: ["cmd", "f"] },
  print: { action: "keyboard", keys: ["cmd", "p"] },

  // =====================================================
  // ZOOM COMMANDS
  // =====================================================
  "zoom in": { action: "keyboard", keys: ["cmd", "+"] },
  "zoom out": { action: "keyboard", keys: ["cmd", "-"] },
  "reset zoom": { action: "keyboard", keys: ["cmd", "0"] },

  // =====================================================
  // MEDIA COMMANDS
  // =====================================================
  play: { action: "keyboard", keys: ["space"] },
  pause: { action: "keyboard", keys: ["space"] },
  "play pause": { action: "keyboard", keys: ["space"] },
  mute: { action: "keyboard", keys: ["m"] },
  unmute: { action: "keyboard", keys: ["m"] },
  fullscreen: { action: "keyboard", keys: ["f"] },
  "exit fullscreen": { action: "keyboard", keys: ["escape"] },

  // =====================================================
  // TEXT EDITING COMMANDS
  // =====================================================
  delete: { action: "keyboard", keys: ["backspace"] },
  "delete that": { action: "keyboard", keys: ["backspace"] },
  enter: { action: "keyboard", keys: ["enter"] },
  "press enter": { action: "keyboard", keys: ["enter"] },
  escape: { action: "keyboard", keys: ["escape"] },
  cancel: { action: "keyboard", keys: ["escape"] },
  tab: { action: "keyboard", keys: ["tab"] },
  "next field": { action: "keyboard", keys: ["tab"] },

  // =====================================================
  // MISC COMMANDS
  // =====================================================
  stop: { action: "stop" },
  "stop listening": { action: "stop_listening" },
  nevermind: { action: "cancel" },
  "never mind": { action: "cancel" },
  help: { action: "help" },
};

// =====================================================
// COMMAND MATCHING
// =====================================================

/**
 * Match user input against command cache.
 * Uses exact match first, then fuzzy matching for typos.
 *
 * @param {string} input - User's voice command (transcribed)
 * @returns {{ matched: boolean, command?: object, confidence: number }}
 */
export function matchCommand(input) {
  if (!input) {
    return { matched: false };
  }

  const normalized = normalizeInput(input);

  // 1. Exact match
  if (COMMAND_CACHE[normalized]) {
    return {
      matched: true,
      command: COMMAND_CACHE[normalized],
      confidence: 1.0,
      originalInput: input,
      normalizedInput: normalized,
    };
  }

  // 2. Fuzzy match for small variations (typos, missing words)
  let bestMatch = null;
  let bestScore = 0;
  const threshold = 0.85; // 85% similarity required

  for (const [key, value] of Object.entries(COMMAND_CACHE)) {
    const score = similarity(normalized, key);
    if (score > threshold && score > bestScore) {
      bestScore = score;
      bestMatch = { key, value };
    }
  }

  if (bestMatch) {
    return {
      matched: true,
      command: bestMatch.value,
      confidence: bestScore,
      originalInput: input,
      normalizedInput: normalized,
      matchedKey: bestMatch.key,
    };
  }

  // 3. Check for navigation patterns: "go to [website]"
  const navMatch = matchNavigationPattern(normalized);
  if (navMatch) {
    return {
      matched: true,
      command: navMatch,
      confidence: 0.9,
      originalInput: input,
      normalizedInput: normalized,
      generatedFromPattern: true,
    };
  }

  return { matched: false, originalInput: input, normalizedInput: normalized };
}

/**
 * Normalize input for matching.
 * Lowercases, removes punctuation, trims whitespace.
 */
function normalizeInput(input) {
  return input
    .toLowerCase()
    .replace(/[.,!?;:'"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Match navigation patterns like "go to example.com"
 */
function matchNavigationPattern(input) {
  // Pattern: "go to [domain]" or "open [domain]"
  const patterns = [
    /^(?:go to|open|navigate to|visit)\s+([a-z0-9][a-z0-9-]*\.[a-z]{2,})$/i,
    /^(?:go to|open|navigate to|visit)\s+([a-z0-9][a-z0-9-]*\.[a-z0-9-]*\.[a-z]{2,})$/i,
  ];

  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match) {
      let domain = match[1];
      // Add https:// if missing
      if (!domain.startsWith("http")) {
        domain = `https://${domain}`;
      }
      return {
        action: "navigate",
        url: domain,
        generated: true,
      };
    }
  }

  return null;
}

/**
 * Calculate similarity between two strings using Levenshtein distance.
 * Returns a score between 0 (completely different) and 1 (identical).
 */
function similarity(s1, s2) {
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;

  if (longer.length === 0) {
    return 1.0;
  }

  const editDistance = levenshtein(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

/**
 * Calculate Levenshtein edit distance between two strings.
 */
function levenshtein(s1, s2) {
  const costs = [];

  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i;

    for (let j = 0; j <= s2.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else if (j > 0) {
        let newValue = costs[j - 1];

        if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        }

        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }

    if (i > 0) {
      costs[s2.length] = lastValue;
    }
  }

  return costs[s2.length];
}

// =====================================================
// COMMAND LIST EXPORT (for documentation/UI)
// =====================================================

/**
 * Get all available commands grouped by category.
 * Useful for help dialogs or documentation.
 */
export function getCommandList() {
  const categories = {
    navigation: [],
    browser: [],
    keyboard: [],
    media: [],
    text: [],
    misc: [],
  };

  for (const [command, action] of Object.entries(COMMAND_CACHE)) {
    if (action.action === "navigate") {
      categories.navigation.push({ command, ...action });
    } else if (
      [
        "scroll",
        "navigate_back",
        "navigate_forward",
        "refresh",
        "close_tab",
        "new_tab",
        "next_tab",
        "previous_tab",
      ].includes(action.action)
    ) {
      categories.browser.push({ command, ...action });
    } else if (
      action.action === "keyboard" &&
      action.keys?.some((k) => ["space", "m", "f", "escape"].includes(k))
    ) {
      categories.media.push({ command, ...action });
    } else if (action.action === "keyboard") {
      categories.keyboard.push({ command, ...action });
    } else {
      categories.misc.push({ command, ...action });
    }
  }

  return categories;
}
