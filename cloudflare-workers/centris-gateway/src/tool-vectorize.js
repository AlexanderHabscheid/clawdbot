/**
 * Tool-RAG / BigTool Pattern - Semantic Tool Selection for Centris AI
 * =====================================================================
 *
 * Implements Antonio Gulli's BigTool pattern: select relevant tools via
 * embedding similarity instead of sending all tools to the LLM.
 *
 * PROBLEM:
 *   Sending 20+ tools to LLM causes:
 *   - Token waste (~5K tokens just for tool definitions)
 *   - Decision paralysis (LLM picks wrong tool)
 *   - Slower responses
 *
 * SOLUTION:
 *   1. Embed tool descriptions using Workers AI
 *   2. Store embeddings in Vectorize index
 *   3. When user intent arrives, embed it and find top-K similar tools
 *   4. Send only those tools to LLM
 *
 * RESULTS (from Gulli's research):
 *   - 3x improvement in tool selection accuracy
 *   - ~40% token reduction
 *   - Works even with smaller models (Qwen-14b success reported)
 *
 * Setup:
 *   1. Create Vectorize index: wrangler vectorize create centris-tools --dimensions=768 --metric=cosine
 *   2. Bind in wrangler.toml: [[vectorize]] binding = "TOOLS" index_name = "centris-tools"
 *   3. Deploy and call POST /api/tools/populate to index all tools
 */

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL DEFINITIONS FOR EMBEDDING
// These are the canonical tool descriptions used for embedding
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * All tools with rich descriptions for embedding.
 *
 * Each tool includes:
 * - name: Tool function name
 * - description: What the tool does
 * - use_cases: When to use this tool (helps embedding match user intents)
 * - category: Tool category for fallback filtering
 * - keywords: Important terms for fallback matching
 */
export const TOOL_DEFINITIONS = [
  // ═══════════════════════════════════════════════════════════════════════════
  // BROWSER TOOLS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: "navigate_browser",
    description:
      "Navigate to a URL in the browser. Opens web pages, websites, and web applications.",
    use_cases: [
      "go to a website",
      "open a web page",
      "navigate to URL",
      "visit a site",
      "open gmail",
      "go to google",
      "open youtube",
    ],
    category: "browser",
    keywords: ["navigate", "url", "website", "open", "go to", "browse", "visit"],
  },
  {
    name: "get_interactive_snapshot",
    description:
      "Get all clickable and interactive elements on the current page. Returns nodeIds for clicking and typing.",
    use_cases: [
      "see what's on the page",
      "find buttons to click",
      "locate input fields",
      "get page elements",
      "find clickable items",
    ],
    category: "browser",
    keywords: ["snapshot", "elements", "interactive", "clickable", "page", "inspect"],
  },
  {
    name: "click_node",
    description:
      "Click on an element by its nodeId or stable hash. Used for clicking buttons, links, and interactive elements.",
    use_cases: [
      "click a button",
      "click a link",
      "select an option",
      "press a button",
      "interact with element",
    ],
    category: "browser",
    keywords: ["click", "press", "select", "button", "link", "tap"],
  },
  {
    name: "type_text",
    description:
      "Type text into the currently focused input field. Used for entering text in forms, search boxes, and text areas.",
    use_cases: [
      "type in a text box",
      "enter text",
      "fill in a form",
      "type search query",
      "write message",
      "input text",
    ],
    category: "browser",
    keywords: ["type", "text", "input", "enter", "write", "fill"],
  },
  {
    name: "press_key",
    description:
      "Press keyboard keys like Enter, Tab, Escape, arrows, Backspace. Used for form submission and navigation.",
    use_cases: [
      "press enter",
      "submit form",
      "press escape",
      "press tab",
      "navigate with arrow keys",
    ],
    category: "browser",
    keywords: ["key", "enter", "tab", "escape", "submit", "keyboard", "press"],
  },
  {
    name: "get_page_content",
    description:
      "Get the text content of the current page. Used for reading articles, emails, and extracting information.",
    use_cases: ["read the page", "get text content", "read article", "read email", "extract text"],
    category: "browser",
    keywords: ["read", "content", "text", "extract", "article", "page"],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // READING TOOLS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: "read_aloud",
    description:
      "Read existing page content aloud using text-to-speech. ONLY for listening to content, NOT for writing or composing. Use for 'read this to me' or 'read this article aloud' commands.",
    use_cases: [
      "read this to me",
      "read aloud",
      "speak this article",
      "listen to page",
      "read article aloud",
      "read page out loud",
      "text to speech",
    ],
    category: "reading",
    keywords: ["read", "aloud", "speak", "tts", "listen", "audio", "dictation"],
  },
  {
    name: "reading_control",
    description:
      "Control active reading: pause, resume, stop, faster, slower. For controlling TTS playback.",
    use_cases: ["pause reading", "stop reading", "speed up", "slow down", "resume reading"],
    category: "reading",
    keywords: ["pause", "stop", "resume", "speed", "control", "reading"],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // FILE TOOLS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: "read_file",
    description:
      "Read content from a file on the local filesystem. For reading documents, code, and text files.",
    use_cases: [
      "read a file",
      "open document",
      "view file contents",
      "read code file",
      "check file",
    ],
    category: "file",
    keywords: ["read", "file", "open", "document", "content", "view"],
  },
  {
    name: "write_file",
    description:
      "Write content to a file on the local filesystem. For creating or overwriting files.",
    use_cases: ["save to file", "create file", "write document", "save content", "create notes"],
    category: "file",
    keywords: ["write", "save", "create", "file", "document", "content"],
  },
  {
    name: "list_directory",
    description: "List files and folders in a directory. For browsing the filesystem.",
    use_cases: ["list files", "show folder contents", "browse directory", "what files are here"],
    category: "file",
    keywords: ["list", "directory", "folder", "files", "browse"],
  },
  {
    name: "open_file",
    description:
      "Open a file with its default application. For opening documents, images, and media files.",
    use_cases: ["open file", "open document", "open image", "open pdf", "launch file"],
    category: "file",
    keywords: ["open", "launch", "file", "document", "default"],
  },
  {
    name: "file_str_replace",
    description: "Replace text in a file. For editing files by replacing specific content.",
    use_cases: ["replace text in file", "edit file", "find and replace", "modify document"],
    category: "file",
    keywords: ["replace", "edit", "modify", "find", "text"],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PDF TOOLS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: "read_pdf",
    description: "Read and extract text content from a PDF file.",
    use_cases: ["read pdf", "extract pdf text", "view pdf content", "open pdf"],
    category: "pdf",
    keywords: ["pdf", "read", "extract", "document"],
  },
  {
    name: "create_pdf",
    description: "Create a new PDF document from text or HTML content.",
    use_cases: ["create pdf", "generate pdf", "make pdf document", "convert to pdf"],
    category: "pdf",
    keywords: ["pdf", "create", "generate", "document"],
  },
  {
    name: "merge_pdfs",
    description: "Merge multiple PDF files into one document.",
    use_cases: ["merge pdfs", "combine pdfs", "join pdf files", "concatenate pdfs"],
    category: "pdf",
    keywords: ["pdf", "merge", "combine", "join"],
  },
  {
    name: "split_pdf",
    description: "Split a PDF into separate files by page ranges.",
    use_cases: ["split pdf", "separate pdf pages", "extract pages from pdf"],
    category: "pdf",
    keywords: ["pdf", "split", "separate", "pages", "extract"],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SYSTEM TOOLS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: "open_application",
    description:
      "Open a macOS application by name. For launching apps like Chrome, Finder, Terminal.",
    use_cases: [
      "open app",
      "launch application",
      "start program",
      "open chrome",
      "open finder",
      "launch terminal",
    ],
    category: "system",
    keywords: ["open", "launch", "app", "application", "program", "start"],
  },
  {
    name: "get_running_applications",
    description: "Get a list of currently running applications.",
    use_cases: ["what apps are running", "list open applications", "running programs"],
    category: "system",
    keywords: ["running", "apps", "list", "applications", "processes"],
  },
  {
    name: "get_clipboard",
    description: "Get the current clipboard content.",
    use_cases: ["get clipboard", "what's copied", "paste content", "clipboard contents"],
    category: "system",
    keywords: ["clipboard", "copy", "paste", "copied"],
  },
  {
    name: "set_clipboard",
    description: "Set the clipboard content to specified text.",
    use_cases: ["copy to clipboard", "set clipboard", "copy text"],
    category: "system",
    keywords: ["clipboard", "copy", "set", "text"],
  },
  {
    name: "execute_terminal_command",
    description:
      "Execute a terminal command and return the output. For running shell commands, npm, git, or any CLI tool.",
    use_cases: [
      "run command",
      "execute terminal",
      "shell command",
      "run script",
      "npm install",
      "git status",
      "run npm",
      "execute bash",
    ],
    category: "system",
    keywords: ["terminal", "command", "shell", "execute", "run", "npm", "git", "bash", "cli"],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ADDITIONAL FILE TOOLS (missing from original)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: "create_directory",
    description: "Create a new folder/directory on the filesystem.",
    use_cases: ["create folder", "make directory", "new folder", "mkdir"],
    category: "file",
    keywords: ["create", "directory", "folder", "mkdir", "new"],
  },
  {
    name: "delete_file",
    description: "Delete a file or folder from the filesystem. Use with caution.",
    use_cases: ["delete file", "remove file", "delete folder", "trash file"],
    category: "file",
    keywords: ["delete", "remove", "trash", "file", "folder"],
  },
  {
    name: "move_file",
    description: "Move or rename a file or folder to a new location.",
    use_cases: ["move file", "rename file", "relocate document", "move folder"],
    category: "file",
    keywords: ["move", "rename", "relocate", "file", "folder"],
  },
  {
    name: "search_files",
    description: "Search for files by name or content in the filesystem.",
    use_cases: ["find file", "search for document", "locate file", "where is file"],
    category: "file",
    keywords: ["search", "find", "locate", "file", "document"],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ADDITIONAL PDF TOOLS (missing from original)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: "edit_pdf_text",
    description: "Add text overlay to an existing PDF page. For annotations, notes, or watermarks.",
    use_cases: ["add text to pdf", "annotate pdf", "add watermark", "pdf annotation"],
    category: "pdf",
    keywords: ["pdf", "edit", "annotate", "text", "overlay", "watermark"],
  },
  {
    name: "pdf_add_page",
    description: "Add a blank page or content page to an existing PDF.",
    use_cases: ["add page to pdf", "insert pdf page", "append page"],
    category: "pdf",
    keywords: ["pdf", "add", "page", "insert", "append"],
  },
  {
    name: "pdf_remove_pages",
    description: "Remove specific pages from a PDF document.",
    use_cases: ["remove pdf page", "delete page from pdf", "remove pages"],
    category: "pdf",
    keywords: ["pdf", "remove", "delete", "page"],
  },
  {
    name: "pdf_info",
    description: "Get information about a PDF: page count, size, metadata.",
    use_cases: ["pdf info", "how many pages in pdf", "pdf metadata", "pdf details"],
    category: "pdf",
    keywords: ["pdf", "info", "metadata", "pages", "size"],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // APPLICATION TOOLS (missing)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: "close_application",
    description: "Close/quit a running application by name.",
    use_cases: ["close app", "quit application", "exit program", "close chrome"],
    category: "system",
    keywords: ["close", "quit", "exit", "app", "application"],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // WINDOW TOOLS (all missing)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: "get_windows",
    description: "List all open windows, optionally filtered by app name.",
    use_cases: ["list windows", "what windows are open", "show windows"],
    category: "window",
    keywords: ["windows", "list", "open", "visible"],
  },
  {
    name: "focus_window",
    description: "Bring a specific window to the front and focus it.",
    use_cases: ["focus window", "bring to front", "switch to window", "activate window"],
    category: "window",
    keywords: ["focus", "window", "front", "activate", "switch"],
  },
  {
    name: "resize_window",
    description: "Resize a window to specified dimensions.",
    use_cases: ["resize window", "change window size", "make window bigger", "shrink window"],
    category: "window",
    keywords: ["resize", "window", "size", "dimensions"],
  },
  {
    name: "move_window",
    description: "Move a window to a new position on screen.",
    use_cases: ["move window", "reposition window", "window position"],
    category: "window",
    keywords: ["move", "window", "position", "location"],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PROCESS TOOLS (missing)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: "get_processes",
    description: "List running processes with PID, CPU, and memory usage.",
    use_cases: ["list processes", "what's running", "cpu usage", "memory usage"],
    category: "system",
    keywords: ["processes", "pid", "cpu", "memory", "running"],
  },
  {
    name: "kill_process",
    description: "Terminate a process by its PID. Use with caution.",
    use_cases: ["kill process", "terminate process", "stop process", "end task"],
    category: "system",
    keywords: ["kill", "terminate", "stop", "process", "pid"],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ADDITIONAL SYSTEM TOOLS (missing)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: "get_system_info",
    description: "Get OS and hardware information about the computer.",
    use_cases: ["system info", "computer specs", "os version", "hardware info"],
    category: "system",
    keywords: ["system", "info", "hardware", "os", "specs"],
  },
  {
    name: "change_system_setting",
    description: "Change a system setting like brightness, volume, etc.",
    use_cases: ["change setting", "adjust brightness", "set volume", "system preference"],
    category: "system",
    keywords: ["setting", "preference", "brightness", "volume", "change"],
  },
  {
    name: "get_network_info",
    description: "Get network and IP address information.",
    use_cases: ["network info", "ip address", "wifi status", "internet connection"],
    category: "system",
    keywords: ["network", "ip", "wifi", "internet", "connection"],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // DESKTOP GUI TOOLS (all missing) - Native app control
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: "get_desktop_snapshot",
    description:
      "Get interactive elements from native desktop apps (Finder, TextEdit, Slack, etc.) with IDs for clicking.",
    use_cases: [
      "see desktop app elements",
      "get native app buttons",
      "finder elements",
      "desktop ui",
    ],
    category: "desktop",
    keywords: ["desktop", "snapshot", "native", "app", "finder", "elements"],
  },
  {
    name: "click_desktop_element",
    description: "Click on a native app element by ID from get_desktop_snapshot.",
    use_cases: [
      "click in finder",
      "click native button",
      "click desktop element",
      "click app button",
    ],
    category: "desktop",
    keywords: ["click", "desktop", "native", "element", "button"],
  },
  {
    name: "type_desktop",
    description: "Type text into a native app text field by ID.",
    use_cases: ["type in native app", "enter text in finder", "type in text field"],
    category: "desktop",
    keywords: ["type", "desktop", "native", "text", "input"],
  },
  {
    name: "keyboard_hotkey",
    description: "Press a keyboard shortcut like cmd+c, cmd+v, cmd+tab.",
    use_cases: ["press shortcut", "cmd c", "copy shortcut", "paste shortcut", "keyboard shortcut"],
    category: "desktop",
    keywords: ["hotkey", "shortcut", "cmd", "keyboard", "ctrl"],
  },
  {
    name: "mouse_click",
    description: "Click at x,y screen coordinates. Fallback when element IDs unavailable.",
    use_cases: ["click at position", "click coordinates", "click x y", "screen click"],
    category: "desktop",
    keywords: ["mouse", "click", "coordinates", "position", "x", "y"],
  },
  {
    name: "keyboard_type",
    description: "Type text to the currently focused element (like physical keyboard).",
    use_cases: ["type text", "keyboard input", "type to focused"],
    category: "desktop",
    keywords: ["keyboard", "type", "text", "input"],
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// SEMANTIC TOOL SELECTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Select relevant tools using semantic search (Gulli BigTool pattern).
 *
 * @param {Object} env - Cloudflare worker environment with TOOLS binding
 * @param {string} intent - User's intent/command
 * @param {Object} options - Selection options
 * @returns {Promise<Array>} Array of relevant tool names with scores
 */
export async function selectToolsSemantic(env, intent, options = {}) {
  const { topK = 7, minScore = 0.45, category = null } = options; // 0.45 for natural language queries

  // If Vectorize is not available, fall back to keyword matching
  if (!env.TOOLS) {
    console.log("Tool Vectorize not available, using keyword fallback");
    return selectToolsKeyword(intent, topK, category);
  }

  try {
    // Get embedding for user intent using Workers AI
    const embedding = await getEmbedding(env, intent);

    // Query Vectorize for similar tools
    const results = await env.TOOLS.query(embedding, {
      topK,
      returnMetadata: true,
      filter: category ? { category } : undefined,
    });

    // Filter by minimum score and format results
    const matches = results.matches
      .filter((match) => match.score >= minScore)
      .map((match) => ({
        name: match.id, // Tool name is the ID
        score: match.score,
        category: match.metadata?.category,
        description: match.metadata?.description,
      }));

    return matches;
  } catch (error) {
    console.error("Tool semantic search failed:", error);
    return selectToolsKeyword(intent, topK, category);
  }
}

/**
 * Get embedding for text using Workers AI.
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

/**
 * Fallback keyword-based tool selection when Vectorize is unavailable.
 */
function selectToolsKeyword(intent, topK, category = null) {
  const intentLower = intent.toLowerCase();
  const words = intentLower.split(/\s+/);

  const scored = TOOL_DEFINITIONS.filter((tool) => !category || tool.category === category)
    .map((tool) => {
      // Calculate keyword overlap
      const keywordMatches = tool.keywords.filter(
        (kw) => intentLower.includes(kw) || words.some((w) => w.includes(kw) || kw.includes(w)),
      );

      // Check use case similarity
      const useCaseMatches = tool.use_cases.filter((uc) => {
        const ucLower = uc.toLowerCase();
        return (
          words.some((w) => ucLower.includes(w)) ||
          intentLower.includes(ucLower.split(" ").slice(0, 2).join(" "))
        );
      });

      // Combined score
      const keywordScore = keywordMatches.length / tool.keywords.length;
      const useCaseScore = useCaseMatches.length / tool.use_cases.length;
      const score = Math.min((keywordScore * 0.5 + useCaseScore * 0.5) * 1.5, 1.0);

      return {
        name: tool.name,
        score,
        category: tool.category,
        description: tool.description,
      };
    })
    .filter((t) => t.score > 0.1)
    .toSorted((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored;
}

// ═══════════════════════════════════════════════════════════════════════════════
// INDEX POPULATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Populate the tool Vectorize index with all tool embeddings.
 * Run this once to initialize or update the index.
 */
export async function populateToolIndex(env) {
  if (!env.TOOLS || !env.AI) {
    throw new Error("Vectorize (TOOLS) and AI bindings required");
  }

  const vectors = [];
  const debug = {
    embeddingsGenerated: 0,
    embeddingDimensions: null,
    errors: [],
  };

  for (const tool of TOOL_DEFINITIONS) {
    try {
      // Create rich text for embedding using:
      // 1. Description (main matching)
      // 2. Use cases (alternative phrasings)
      // 3. Keywords (important terms)
      const textForEmbedding = [
        tool.description,
        `Use cases: ${tool.use_cases.join(". ")}`,
        `Keywords: ${tool.keywords.join(", ")}`,
      ].join(". ");

      // Get embedding
      const embedding = await getEmbedding(env, textForEmbedding);

      if (!embedding || !Array.isArray(embedding)) {
        debug.errors.push(`Tool ${tool.name}: embedding not an array`);
        continue;
      }

      if (debug.embeddingDimensions === null) {
        debug.embeddingDimensions = embedding.length;
      }

      debug.embeddingsGenerated++;

      vectors.push({
        id: tool.name, // Use tool name as ID for easy lookup
        values: embedding,
        metadata: {
          category: tool.category,
          description: tool.description,
          keywords: tool.keywords.join(","),
          use_case_count: tool.use_cases.length,
          type: "tool_definition",
        },
      });
    } catch (error) {
      debug.errors.push(`Tool ${tool.name}: ${error.message}`);
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
    const result = await env.TOOLS.upsert(vectors);
    return {
      success: true,
      toolsIndexed: vectors.length,
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
// API HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Handle tool selection request.
 * POST /api/tools/select
 * Body: { intent: string, topK?: number, minScore?: number, category?: string }
 */
export async function handleToolSelection(request, env) {
  try {
    const body = await request.json();
    const { intent, topK = 7, minScore = 0.45, category = null } = body; // 0.45 for natural language

    if (!intent) {
      return new Response(
        JSON.stringify({
          error: "Missing required field: intent",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const startTime = Date.now();
    const tools = await selectToolsSemantic(env, intent, {
      topK,
      minScore,
      category,
    });
    const latencyMs = Date.now() - startTime;

    return new Response(
      JSON.stringify({
        success: true,
        query: intent,
        tools,
        toolCount: tools.length,
        latencyMs,
        source: env.TOOLS ? "vectorize" : "keyword_fallback",
      }),
      {
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error.message,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

/**
 * Handle tool index population request.
 * POST /api/tools/populate
 */
export async function handleToolPopulate(request, env) {
  try {
    const startTime = Date.now();
    const result = await populateToolIndex(env);
    const latencyMs = Date.now() - startTime;

    return new Response(
      JSON.stringify({
        ...result,
        latencyMs,
      }),
      {
        status: result.success ? 200 : 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

/**
 * Get all tool definitions (for debugging/inspection).
 * GET /api/tools/definitions
 */
export async function handleToolDefinitions(request, env) {
  return new Response(
    JSON.stringify({
      success: true,
      tools: TOOL_DEFINITIONS.map((t) => ({
        name: t.name,
        description: t.description,
        category: t.category,
        keywords: t.keywords,
        use_cases: t.use_cases,
      })),
      totalTools: TOOL_DEFINITIONS.length,
      categories: [...new Set(TOOL_DEFINITIONS.map((t) => t.category))],
    }),
    {
      headers: { "Content-Type": "application/json" },
    },
  );
}
