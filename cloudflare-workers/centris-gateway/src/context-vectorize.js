/**
 * Context Vectorize - Instant User Context Detection & Matching
 * ==============================================================
 *
 * This module handles instant context detection when Centris starts up.
 * It pre-vectorizes common app states so we can:
 *   1. Instantly know what the user is looking at
 *   2. Know what capabilities are available in that context
 *   3. Route to the right tools without LLM overhead
 *
 * PROBLEM SOLVED:
 * ===============
 * User says "Hey Centris" from a blank desktop.
 * Without context vectorization:
 *   - System doesn't know user wants to LAUNCH something
 *   - Might try to interact with non-existent browser
 *   - Takes 500ms+ to figure out context
 *
 * With context vectorization:
 *   - <5ms: Detect "Finder" or "blank desktop" context
 *   - <5ms: Vector lookup returns "system_control" capabilities
 *   - Instantly knows: offer to launch apps, open URLs, open files
 *
 * Setup:
 *   1. Create Vectorize index: wrangler vectorize create centris-contexts --dimensions=768 --metric=cosine
 *   2. Bind in wrangler.toml: [[vectorize]] binding = "CONTEXTS" index_name = "centris-contexts"
 *   3. Deploy and call POST /api/context/populate to index all contexts
 */

// ═══════════════════════════════════════════════════════════════════════════════
// CONTEXT SIGNATURES - Pre-defined app states with capabilities
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Context signatures represent what the user might be looking at.
 * Each has:
 *   - identifiers: How to detect this context (app name, bundle ID, window patterns)
 *   - capabilities: What Centris can do in this context
 *   - available_tools: Which tool categories are relevant
 *   - suggested_actions: Quick actions to offer the user
 */
export const CONTEXT_SIGNATURES = [
  // ═══════════════════════════════════════════════════════════════════════════
  // BLANK DESKTOP / FINDER - The "I want to start something" context
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "desktop-blank",
    name: "Blank Desktop",
    description:
      "User is on desktop with Finder as frontmost app, no windows focused. Ready to launch applications or navigate.",
    identifiers: {
      apps: ["Finder"],
      bundle_ids: ["com.apple.finder"],
      window_patterns: ["^$", "Finder"], // Empty title or just "Finder"
      element_hints: ["desktop", "Finder"],
    },
    capabilities: [
      "launch_applications",
      "open_urls",
      "file_navigation",
      "system_control",
      "dictation",
    ],
    available_tools: [
      "launch_app",
      "open_url",
      "navigate_browser",
      "open_file",
      "type_text",
      "system_control",
    ],
    suggested_actions: [
      {
        action: "launch_app",
        description: "Open an application",
        examples: ["Open Chrome", "Launch Slack", "Open VS Code"],
      },
      {
        action: "open_url",
        description: "Go to a website",
        examples: ["Go to Google", "Open Gmail", "Navigate to YouTube"],
      },
      {
        action: "find_file",
        description: "Find a file or folder",
        examples: ["Find my downloads", "Open Documents folder"],
      },
    ],
    context_prompt:
      "User is on a blank desktop or in Finder. They likely want to launch an application, open a website, or navigate to a file. Ask what they'd like to open or do.",
    priority: 100, // High priority - base context
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // FINDER WITH WINDOW - File management context
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "finder-window",
    name: "Finder Window",
    description: "User has a Finder window open, browsing files and folders",
    identifiers: {
      apps: ["Finder"],
      bundle_ids: ["com.apple.finder"],
      window_patterns: ["Documents", "Downloads", "Desktop", "Applications", "/"],
      has_window: true,
    },
    capabilities: [
      "file_operations",
      "file_navigation",
      "launch_applications",
      "open_files",
      "copy_move_files",
    ],
    available_tools: [
      "open_file",
      "open_folder",
      "copy_file",
      "move_file",
      "rename_file",
      "launch_app",
      "type_text",
    ],
    suggested_actions: [
      {
        action: "open_file",
        description: "Open a file",
        examples: ["Open this file", "Open the selected file"],
      },
      {
        action: "navigate",
        description: "Go to a location",
        examples: ["Go to Downloads", "Open Documents"],
      },
      {
        action: "organize",
        description: "Organize files",
        examples: ["Move this to Desktop", "Create a new folder"],
      },
    ],
    context_prompt:
      "User has a Finder window open. They're likely browsing files and may want to open, organize, or navigate to files and folders.",
    priority: 90,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CHROME - GENERAL BROWSING
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "chrome-general",
    name: "Chrome Browser",
    description: "User is browsing the web in Chrome, general browsing context",
    identifiers: {
      apps: ["Google Chrome", "Chrome"],
      bundle_ids: ["com.google.Chrome"],
      window_patterns: ["*"],
    },
    capabilities: [
      "web_navigation",
      "page_interaction",
      "form_filling",
      "data_extraction",
      "screenshot",
      "search",
    ],
    available_tools: [
      "navigate_browser",
      "get_page_content",
      "get_interactive_snapshot",
      "click_node",
      "input_text_node",
      "press_key",
      "scroll",
      "take_screenshot",
    ],
    suggested_actions: [
      {
        action: "navigate",
        description: "Go to a website",
        examples: ["Go to Gmail", "Open Amazon"],
      },
      {
        action: "interact",
        description: "Interact with page",
        examples: ["Click that button", "Fill out this form"],
      },
      {
        action: "extract",
        description: "Get information",
        examples: ["Read this page", "What does it say?"],
      },
    ],
    context_prompt:
      "User is browsing the web in Chrome. They can navigate, interact with pages, fill forms, or extract information.",
    priority: 80,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CHROME - GMAIL (Email context)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "chrome-gmail",
    name: "Gmail",
    description: "User is in Gmail, email management context",
    identifiers: {
      apps: ["Google Chrome", "Chrome"],
      bundle_ids: ["com.google.Chrome"],
      url_patterns: ["mail.google.com", "gmail.com"],
      window_patterns: ["Gmail", "Inbox", "Compose"],
    },
    capabilities: [
      "email_read",
      "email_compose",
      "email_reply",
      "email_forward",
      "email_search",
      "attachment_handling",
    ],
    available_tools: [
      "get_page_content",
      "get_interactive_snapshot",
      "click_node",
      "input_text_node",
      "press_key",
      "attach_file",
      "scroll",
    ],
    suggested_actions: [
      {
        action: "compose",
        description: "Write an email",
        examples: ["Compose a new email", "Write to John"],
      },
      {
        action: "reply",
        description: "Reply to email",
        examples: ["Reply to this email", "Send a response"],
      },
      {
        action: "search",
        description: "Find emails",
        examples: ["Find emails from Sarah", "Search for invoices"],
      },
    ],
    context_prompt: "User is in Gmail. They can compose, reply, forward, or search emails.",
    priority: 95, // Higher than general Chrome
    parent_context: "chrome-general",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CHROME - GOOGLE SEARCH
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "chrome-google-search",
    name: "Google Search",
    description: "User is on Google search page",
    identifiers: {
      apps: ["Google Chrome", "Chrome"],
      bundle_ids: ["com.google.Chrome"],
      url_patterns: ["google.com/search", "google.com/?q="],
      window_patterns: ["Google", "Search"],
    },
    capabilities: ["search_refine", "result_navigation", "extract_results"],
    available_tools: ["input_text_node", "click_node", "get_page_content", "press_key"],
    suggested_actions: [
      {
        action: "search",
        description: "Search for something",
        examples: ["Search for restaurants nearby", "Find Python tutorials"],
      },
      {
        action: "click_result",
        description: "Go to a result",
        examples: ["Open the first result", "Go to Wikipedia article"],
      },
    ],
    context_prompt:
      "User is on Google Search. They can search for things, refine searches, or navigate to results.",
    priority: 93,
    parent_context: "chrome-general",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CHROME - E-COMMERCE (Amazon, etc.)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "chrome-ecommerce",
    name: "E-Commerce Site",
    description: "User is on an e-commerce website like Amazon, shopping context",
    identifiers: {
      apps: ["Google Chrome", "Chrome"],
      bundle_ids: ["com.google.Chrome"],
      url_patterns: ["amazon.com", "walmart.com", "target.com", "bestbuy.com", "ebay.com"],
      window_patterns: ["Amazon", "Walmart", "Target", "Best Buy", "eBay", "Cart", "Checkout"],
    },
    capabilities: [
      "product_search",
      "add_to_cart",
      "checkout",
      "price_comparison",
      "review_reading",
    ],
    available_tools: [
      "get_page_content",
      "get_interactive_snapshot",
      "click_node",
      "input_text_node",
      "scroll",
    ],
    suggested_actions: [
      {
        action: "search",
        description: "Search for products",
        examples: ["Find wireless headphones", "Search for laptop stand"],
      },
      {
        action: "purchase",
        description: "Buy items",
        examples: ["Add this to cart", "Proceed to checkout"],
      },
      {
        action: "compare",
        description: "Compare products",
        examples: ["What are the reviews?", "Is this a good price?"],
      },
    ],
    context_prompt:
      "User is on an e-commerce site. They can search products, add to cart, checkout, or compare items.",
    priority: 92,
    parent_context: "chrome-general",
    confirmation_required_for: ["checkout", "purchase", "add_to_cart"],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SLACK - Messaging context
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "slack-app",
    name: "Slack",
    description: "User is in Slack messaging application",
    identifiers: {
      apps: ["Slack"],
      bundle_ids: ["com.tinyspeck.slackmacgap"],
      window_patterns: ["Slack", "#"],
    },
    capabilities: [
      "send_message",
      "read_messages",
      "switch_channel",
      "search_messages",
      "react_to_message",
    ],
    available_tools: [
      "get_interactive_snapshot",
      "click_element",
      "type_into_element",
      "type_text",
      "press_key",
    ],
    suggested_actions: [
      {
        action: "message",
        description: "Send a message",
        examples: ["Send a message to Sarah", "Type hello in general"],
      },
      {
        action: "navigate",
        description: "Go to channel",
        examples: ["Go to #engineering", "Open DMs with John"],
      },
      {
        action: "search",
        description: "Search messages",
        examples: ["Find messages about project X"],
      },
    ],
    context_prompt:
      "User is in Slack. They can send messages, navigate channels, or search for content.",
    priority: 85,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // VS CODE - Coding context
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "vscode-app",
    name: "VS Code",
    description: "User is in Visual Studio Code, coding context",
    identifiers: {
      apps: ["Code", "Visual Studio Code", "VSCode"],
      bundle_ids: ["com.microsoft.VSCode"],
      window_patterns: [".ts", ".js", ".py", ".go", ".java", "- Code"],
    },
    capabilities: [
      "code_editing",
      "file_navigation",
      "terminal_commands",
      "search_code",
      "git_operations",
    ],
    available_tools: ["type_text", "press_key", "get_interactive_snapshot", "click_element"],
    suggested_actions: [
      {
        action: "edit",
        description: "Edit code",
        examples: ["Add a comment", "Fix this function"],
      },
      {
        action: "navigate",
        description: "Navigate files",
        examples: ["Go to definition", "Find usages"],
      },
      { action: "run", description: "Run commands", examples: ["Run the tests", "Open terminal"] },
    ],
    context_prompt:
      "User is in VS Code coding. They can edit code, navigate files, or run commands. Be careful with code edits - confirm before making changes.",
    priority: 85,
    confirmation_required_for: ["edit_code", "run_command", "git_commit"],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // NOTES - Note-taking context
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "notes-app",
    name: "Notes",
    description: "User is in Apple Notes, note-taking context",
    identifiers: {
      apps: ["Notes"],
      bundle_ids: ["com.apple.Notes"],
      window_patterns: ["Notes"],
    },
    capabilities: ["create_note", "edit_note", "search_notes", "organize_notes"],
    available_tools: ["type_text", "press_key", "get_interactive_snapshot", "click_element"],
    suggested_actions: [
      {
        action: "create",
        description: "Create a note",
        examples: ["Create a new note", "Start a shopping list"],
      },
      {
        action: "edit",
        description: "Edit content",
        examples: ["Add this to my notes", "Append a reminder"],
      },
      {
        action: "find",
        description: "Find notes",
        examples: ["Find my meeting notes", "Search for recipe"],
      },
    ],
    context_prompt: "User is in Notes app. They can create, edit, or search notes.",
    priority: 80,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // TERMINAL - Command line context
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "terminal-app",
    name: "Terminal",
    description: "User is in Terminal, command line context",
    identifiers: {
      apps: ["Terminal", "iTerm2", "iTerm", "Warp", "Alacritty", "Hyper"],
      bundle_ids: ["com.apple.Terminal", "com.googlecode.iterm2", "dev.warp.Warp-Stable"],
      window_patterns: ["~", "bash", "zsh", "Terminal", "ssh"],
    },
    capabilities: ["run_commands", "file_operations", "system_admin"],
    available_tools: ["type_text", "press_key"],
    suggested_actions: [
      {
        action: "run",
        description: "Run a command",
        examples: ["List files", "Show current directory"],
      },
      {
        action: "navigate",
        description: "Navigate directories",
        examples: ["Go to home folder", "Change to project directory"],
      },
    ],
    context_prompt:
      "User is in Terminal. They can run commands. Be careful with destructive commands - confirm before executing rm, sudo, etc.",
    priority: 85,
    confirmation_required_for: ["rm", "sudo", "delete", "format", "kill"],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // MESSAGES - iMessage context
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "messages-app",
    name: "Messages",
    description: "User is in Apple Messages, texting context",
    identifiers: {
      apps: ["Messages"],
      bundle_ids: ["com.apple.MobileSMS"],
      window_patterns: ["Messages"],
    },
    capabilities: ["send_message", "read_messages", "search_conversations"],
    available_tools: ["type_text", "press_key", "get_interactive_snapshot", "click_element"],
    suggested_actions: [
      {
        action: "message",
        description: "Send a message",
        examples: ["Send a text to Mom", "Reply saying I'll be late"],
      },
      {
        action: "read",
        description: "Read messages",
        examples: ["Read my latest messages", "What did John say?"],
      },
    ],
    context_prompt: "User is in Messages app. They can send or read iMessages and SMS.",
    priority: 85,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ZOOM - Video conferencing context
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "zoom-app",
    name: "Zoom",
    description: "User is in Zoom, video conferencing context",
    identifiers: {
      apps: ["zoom.us", "Zoom"],
      bundle_ids: ["us.zoom.xos"],
      window_patterns: ["Zoom", "Meeting"],
    },
    capabilities: ["meeting_control", "screen_share", "chat"],
    available_tools: ["click_element", "type_text", "press_key"],
    suggested_actions: [
      {
        action: "control",
        description: "Meeting controls",
        examples: ["Mute myself", "Share my screen", "Leave meeting"],
      },
      {
        action: "chat",
        description: "Chat in meeting",
        examples: ["Send a message to everyone", "Type in chat"],
      },
    ],
    context_prompt:
      "User is in Zoom. They can control meeting settings, share screen, or use chat.",
    priority: 85,
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// CONTEXT DETECTION - Match current state to context signature
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Detect context from system state without using LLM
 * This is the FAST PATH - <5ms total
 *
 * @param {Object} systemState - Current system state from desktop app
 * @param {string} systemState.appName - Frontmost application name
 * @param {string} systemState.bundleId - App bundle identifier
 * @param {string} systemState.windowTitle - Current window title
 * @param {string} systemState.url - Current URL if browser (optional)
 * @param {Array} systemState.elements - Interactive elements if available (optional)
 * @returns {Object} Matched context with capabilities
 */
export function detectContext(systemState) {
  const { appName, bundleId, windowTitle, url, elements } = systemState;

  if (!appName) {
    // No app info - return blank desktop context
    return {
      ...CONTEXT_SIGNATURES.find((c) => c.id === "desktop-blank"),
      detection_method: "fallback",
      confidence: 0.5,
    };
  }

  // Sort by priority (higher first)
  const sortedContexts = [...CONTEXT_SIGNATURES].toSorted((a, b) => b.priority - a.priority);

  let bestMatch = null;
  let bestScore = 0;

  for (const context of sortedContexts) {
    let score = 0;
    const matches = [];

    // Check app name
    if (
      context.identifiers.apps?.some((app) => appName.toLowerCase().includes(app.toLowerCase()))
    ) {
      score += 30;
      matches.push("app_name");
    }

    // Check bundle ID
    if (
      context.identifiers.bundle_ids?.some((bid) => bundleId?.toLowerCase() === bid.toLowerCase())
    ) {
      score += 25;
      matches.push("bundle_id");
    }

    // Check URL patterns (for browser contexts)
    if (url && context.identifiers.url_patterns) {
      if (
        context.identifiers.url_patterns.some((pattern) =>
          url.toLowerCase().includes(pattern.toLowerCase()),
        )
      ) {
        score += 40; // URLs are very specific
        matches.push("url");
      }
    }

    // Check window title patterns
    if (windowTitle && context.identifiers.window_patterns) {
      for (const pattern of context.identifiers.window_patterns) {
        if (pattern === "*") {
          continue;
        } // Wildcard matches anything
        if (pattern === "^$" && !windowTitle.trim()) {
          score += 20; // Empty window title
          matches.push("empty_window");
          break;
        }
        if (windowTitle.toLowerCase().includes(pattern.toLowerCase())) {
          score += 15;
          matches.push("window_title");
          break;
        }
      }
    }

    // Check for window presence (Finder specific)
    if (context.identifiers.has_window !== undefined) {
      const hasWindow = windowTitle && windowTitle.trim() && windowTitle !== "Finder";
      if (context.identifiers.has_window === hasWindow) {
        score += 10;
        matches.push("has_window");
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = {
        ...context,
        detection_method: "rule_based",
        confidence: Math.min(score / 100, 1.0),
        matched_on: matches,
      };
    }
  }

  return (
    bestMatch || {
      ...CONTEXT_SIGNATURES.find((c) => c.id === "desktop-blank"),
      detection_method: "fallback",
      confidence: 0.3,
    }
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// VECTORIZE FUNCTIONS - Semantic context matching
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Search for matching context using Vectorize
 * Use this when rule-based detection has low confidence
 *
 * @param {Object} env - Cloudflare worker environment with CONTEXTS binding
 * @param {string} userIntent - What the user wants to do
 * @param {Object} systemState - Current system state
 * @param {Object} options - Search options
 * @returns {Promise<Array>} Matching contexts with scores
 */
export async function searchContexts(env, userIntent, systemState = {}, options = {}) {
  const { topK = 3, minScore = 0.7 } = options;

  // First, try rule-based detection
  const ruleBasedContext = detectContext(systemState);

  // If high confidence, return rule-based result
  if (ruleBasedContext.confidence >= 0.8) {
    return [
      {
        ...ruleBasedContext,
        score: ruleBasedContext.confidence,
        source: "rule_based",
      },
    ];
  }

  // Low confidence - augment with vector search
  if (!env.CONTEXTS) {
    console.log("Vectorize CONTEXTS not available, using rule-based only");
    return [{ ...ruleBasedContext, score: ruleBasedContext.confidence, source: "rule_based" }];
  }

  try {
    // Create rich query combining intent and state
    const queryText = buildContextQuery(userIntent, systemState);

    // Get embedding
    const embedding = await getEmbedding(env, queryText);

    // Query Vectorize
    const results = await env.CONTEXTS.query(embedding, {
      topK,
      returnMetadata: true,
    });

    // Combine with rule-based result
    const vectorMatches = results.matches
      .filter((match) => match.score >= minScore)
      .map((match) => ({
        id: match.id,
        score: match.score,
        ...match.metadata,
        source: "vector",
      }));

    // Merge: if rule-based is in vector results, boost its score
    const merged = [];
    let foundRuleBased = false;

    for (const vm of vectorMatches) {
      if (vm.id === ruleBasedContext.id) {
        merged.push({
          ...ruleBasedContext,
          score: Math.min((ruleBasedContext.confidence + vm.score) / 2 + 0.1, 1.0),
          source: "combined",
        });
        foundRuleBased = true;
      } else {
        merged.push(vm);
      }
    }

    if (!foundRuleBased && ruleBasedContext.confidence > 0.5) {
      merged.unshift({
        ...ruleBasedContext,
        score: ruleBasedContext.confidence,
        source: "rule_based",
      });
    }

    return merged.slice(0, topK);
  } catch (error) {
    console.error("Context vector search failed:", error);
    return [{ ...ruleBasedContext, score: ruleBasedContext.confidence, source: "rule_based" }];
  }
}

/**
 * Build a rich query text for embedding
 */
function buildContextQuery(userIntent, systemState) {
  const parts = [];

  if (userIntent) {
    parts.push(`User wants to: ${userIntent}`);
  }

  if (systemState.appName) {
    parts.push(`Application: ${systemState.appName}`);
  }

  if (systemState.windowTitle) {
    parts.push(`Window: ${systemState.windowTitle}`);
  }

  if (systemState.url) {
    parts.push(`URL: ${systemState.url}`);
  }

  return parts.join(". ");
}

/**
 * Get embedding for text using Workers AI
 */
async function getEmbedding(env, text) {
  if (!env.AI) {
    throw new Error("Workers AI not available");
  }

  const response = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
    text: [text],
  });

  return response.data[0];
}

// ═══════════════════════════════════════════════════════════════════════════════
// POPULATE VECTORIZE - Index all context signatures
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Populate Vectorize index with context embeddings
 * Run this once to initialize or update the index
 */
export async function populateContexts(env) {
  if (!env.CONTEXTS || !env.AI) {
    throw new Error("Vectorize CONTEXTS and AI bindings required");
  }

  const vectors = [];
  const debug = {
    embeddingsGenerated: 0,
    errors: [],
  };

  for (const context of CONTEXT_SIGNATURES) {
    try {
      // Create rich text for embedding
      const textForEmbedding = [
        context.name,
        context.description,
        `Capabilities: ${context.capabilities.join(", ")}`,
        `Apps: ${context.identifiers.apps?.join(", ") || ""}`,
        `Suggested: ${context.suggested_actions.map((a) => a.description).join(", ")}`,
      ].join(". ");

      // Get embedding
      const embedding = await getEmbedding(env, textForEmbedding);

      if (!embedding || !Array.isArray(embedding)) {
        debug.errors.push(`Context ${context.id}: embedding not an array`);
        continue;
      }

      debug.embeddingsGenerated++;

      vectors.push({
        id: context.id,
        values: embedding,
        metadata: {
          name: context.name,
          description: context.description,
          capabilities: context.capabilities.join(","),
          priority: context.priority,
          context_prompt: context.context_prompt,
        },
      });
    } catch (error) {
      debug.errors.push(`Context ${context.id}: ${error.message}`);
    }
  }

  if (vectors.length === 0) {
    return {
      success: false,
      error: "No vectors generated",
      debug,
    };
  }

  // Insert into Vectorize
  try {
    const result = await env.CONTEXTS.upsert(vectors);
    return {
      success: true,
      contextsIndexed: vectors.length,
      debug,
      result,
    };
  } catch (error) {
    return {
      success: false,
      error: `Vectorize upsert failed: ${error.message}`,
      debug,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// API HANDLERS - HTTP endpoints for context operations
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Handle context detection endpoint
 * POST /api/context/detect
 * Body: { appName, bundleId, windowTitle, url?, intent? }
 */
export async function handleContextDetect(request, env) {
  try {
    const body = await request.json();
    const { appName, bundleId, windowTitle, url, intent } = body;

    const systemState = { appName, bundleId, windowTitle, url };

    // If intent provided, use vector search for better matching
    if (intent) {
      const matches = await searchContexts(env, intent, systemState);
      return jsonResponse({
        success: true,
        context: matches[0],
        alternatives: matches.slice(1),
        systemState,
      });
    }

    // Otherwise, use fast rule-based detection
    const context = detectContext(systemState);

    return jsonResponse({
      success: true,
      context,
      systemState,
    });
  } catch (error) {
    return jsonResponse(
      {
        success: false,
        error: error.message,
      },
      500,
    );
  }
}

/**
 * Handle context population endpoint
 * POST /api/context/populate
 */
export async function handleContextPopulate(request, env) {
  try {
    const result = await populateContexts(env);
    return jsonResponse(result);
  } catch (error) {
    return jsonResponse(
      {
        success: false,
        error: error.message,
      },
      500,
    );
  }
}

/**
 * List all available contexts
 * GET /api/context/list
 */
export async function handleContextList(request) {
  return jsonResponse({
    success: true,
    contexts: CONTEXT_SIGNATURES.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      capabilities: c.capabilities,
      priority: c.priority,
    })),
    count: CONTEXT_SIGNATURES.length,
  });
}

/**
 * Get context capabilities for a specific context
 * GET /api/context/:id/capabilities
 */
export async function handleContextCapabilities(request) {
  const url = new URL(request.url);
  const pathParts = url.pathname.split("/");
  const contextId = pathParts[pathParts.indexOf("context") + 1];

  const context = CONTEXT_SIGNATURES.find((c) => c.id === contextId);

  if (!context) {
    return jsonResponse(
      {
        success: false,
        error: `Context '${contextId}' not found`,
      },
      404,
    );
  }

  return jsonResponse({
    success: true,
    context: {
      id: context.id,
      name: context.name,
      capabilities: context.capabilities,
      available_tools: context.available_tools,
      suggested_actions: context.suggested_actions,
      context_prompt: context.context_prompt,
    },
  });
}

// Helper function
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// All exports are inline (export const, export function, export async function)
// No additional export block needed
