/**
 * Context Collector Service
 * ==========================
 *
 * This service provides INSTANT context detection when Centris activates.
 * It tells the system what the user is looking at the moment they say "Hey Centris"
 * or press the activation hotkey.
 *
 * KEY PROBLEM SOLVED:
 * User is on a blank desktop and says "Hey Centris, open Google"
 * Without context detection:
 *   - System might try to interact with non-existent browser
 *   - Would fail or take multiple attempts
 *
 * With context detection:
 *   - <10ms: Detect Finder/Desktop context
 *   - Know immediately: need to LAUNCH browser first
 *   - Execute: launch Chrome → navigate to Google
 *
 * ARCHITECTURE:
 * 1. Local detection (native-control module) → <5ms
 * 2. Optional: Cloud vectorize lookup for intent matching → <50ms
 * 3. Returns context + available capabilities
 */

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

// Try to load native-control module
let nativeControl = null;
try {
  nativeControl = require("../../native-control");
} catch (e) {
  console.log("[ContextCollector] Native control not available, using AppleScript fallback");
}

class ContextCollector {
  constructor() {
    this.cachedContext = null;
    this.cacheTimestamp = 0;
    this.cacheTTLMs = 500; // Cache for 500ms to avoid redundant calls

    // Context detection state
    this.lastDetection = null;

    // Cloudflare endpoint for vector-enhanced detection
    // Uses the deployed Centris Gateway worker for semantic context matching
    this.cloudflareEndpoint =
      process.env.CENTRIS_GATEWAY_URL || "https://centris-gateway.a-7cd.workers.dev";
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN API - Get Current Context
  // ═════════════════════════════════════════════════════════════════════════════

  /**
   * Get the current user context - what they're looking at right now
   * This is the primary method to call when Centris activates
   *
   * @param {Object} options
   * @param {boolean} options.useCloud - Use Cloudflare for enhanced detection
   * @param {string} options.intent - User's intent (if known) for better matching
   * @returns {Promise<Object>} Context object with capabilities
   */
  async getCurrentContext(options = {}) {
    const { useCloud = false, intent = null } = options;

    // Check cache
    if (this.cachedContext && Date.now() - this.cacheTimestamp < this.cacheTTLMs) {
      return { ...this.cachedContext, fromCache: true };
    }

    const startTime = Date.now();

    try {
      // Step 1: Get raw system state (native or AppleScript)
      const systemState = await this.getSystemState();

      // Step 2: Detect context from system state
      const context = this.detectContextLocally(systemState);

      // Step 3: Optionally enhance with cloud vectorize
      if (useCloud && this.cloudflareEndpoint && intent) {
        try {
          const enhanced = await this.enhanceWithCloud(context, systemState, intent);
          context.cloudEnhanced = enhanced;
        } catch (e) {
          console.log("[ContextCollector] Cloud enhancement failed, using local:", e.message);
        }
      }

      // Add timing info
      context.detectionTimeMs = Date.now() - startTime;
      context.timestamp = Date.now();

      // Cache result
      this.cachedContext = context;
      this.cacheTimestamp = Date.now();
      this.lastDetection = context;

      return context;
    } catch (error) {
      console.error("[ContextCollector] Failed to detect context:", error.message);

      // Return a safe fallback
      return {
        id: "desktop-blank",
        name: "Unknown Context",
        appName: "Unknown",
        capabilities: ["launch_applications", "open_urls", "type_text"],
        available_tools: ["launch_app", "open_url", "type_text"],
        confidence: 0.1,
        error: error.message,
        detectionTimeMs: Date.now() - startTime,
        timestamp: Date.now(),
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SYSTEM STATE COLLECTION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get raw system state - frontmost app, window, URL if browser
   */
  async getSystemState() {
    // Try native-control first (fastest)
    if (nativeControl && typeof nativeControl.getFrontmostApp === "function") {
      return await this.getSystemStateNative();
    }

    // Fall back to platform-specific methods
    if (process.platform === "darwin") {
      return await this.getSystemStateMacOS();
    } else if (process.platform === "win32") {
      return await this.getSystemStateWindows();
    } else {
      return await this.getSystemStateLinux();
    }
  }

  /**
   * Get system state using native-control module (fastest)
   */
  async getSystemStateNative() {
    try {
      const appInfo = await nativeControl.getFrontmostApp();
      const windowInfo = await nativeControl.getFrontmostWindow();

      return {
        appName: appInfo?.name || "",
        bundleId: appInfo?.bundleId || "",
        windowTitle: windowInfo?.title || "",
        windowBounds: windowInfo?.bounds || null,
        pid: appInfo?.pid || null,
        // URL will be added by browser extension if Chrome is frontmost
        url: null,
        source: "native-control",
      };
    } catch (e) {
      console.log("[ContextCollector] Native control failed:", e.message);
      return this.getSystemStateMacOS();
    }
  }

  /**
   * Get system state on macOS using AppleScript
   */
  async getSystemStateMacOS() {
    return new Promise((resolve, reject) => {
      const script = `
        tell application "System Events"
          set frontApp to first application process whose frontmost is true
          set frontAppName to name of frontApp
          set frontAppBundle to bundle identifier of frontApp
          
          try
            set frontWindow to first window of frontApp
            set frontWindowTitle to name of frontWindow
          on error
            set frontWindowTitle to ""
          end try
          
          return frontAppName & "|||" & frontAppBundle & "|||" & frontWindowTitle
        end tell
      `;

      const proc = spawn("osascript", ["-e", script]);

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      const timeoutId = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGKILL");
        reject(new Error("AppleScript timed out"));
      }, 2000);

      proc.on("close", (code) => {
        if (timedOut) {
          return;
        }
        clearTimeout(timeoutId);

        if (code === 0 && stdout.trim()) {
          const parts = stdout.trim().split("|||");
          resolve({
            appName: parts[0] || "",
            bundleId: parts[1] || "",
            windowTitle: parts[2] || "",
            url: null,
            source: "applescript",
          });
        } else {
          reject(new Error(`AppleScript failed: ${stderr}`));
        }
      });

      proc.on("error", (error) => {
        if (timedOut) {
          return;
        }
        clearTimeout(timeoutId);
        reject(error);
      });
    });
  }

  /**
   * Get system state on Windows using PowerShell
   */
  async getSystemStateWindows() {
    return new Promise((resolve, reject) => {
      const script = `
        Add-Type -AssemblyName UIAutomationClient
        $desktop = [System.Windows.Automation.AutomationElement]::RootElement
        $focusedElement = [System.Windows.Automation.AutomationElement]::FocusedElement
        if ($null -ne $focusedElement) {
          $processId = $focusedElement.Current.ProcessId
          $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
          $appName = if ($process) { $process.ProcessName } else { "Unknown" }
          $windowTitle = $focusedElement.Current.Name
          Write-Output "$appName|||$windowTitle"
        }
      `;

      const proc = spawn("powershell", ["-Command", script]);

      let stdout = "";
      let timedOut = false;

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      const timeoutId = setTimeout(() => {
        timedOut = true;
        proc.kill();
        reject(new Error("PowerShell timed out"));
      }, 3000);

      proc.on("close", (code) => {
        if (timedOut) {
          return;
        }
        clearTimeout(timeoutId);

        const parts = stdout.trim().split("|||");
        resolve({
          appName: parts[0] || "",
          bundleId: "",
          windowTitle: parts[1] || "",
          url: null,
          source: "powershell",
        });
      });

      proc.on("error", (error) => {
        if (timedOut) {
          return;
        }
        clearTimeout(timeoutId);
        reject(error);
      });
    });
  }

  /**
   * Get system state on Linux using xdotool
   */
  async getSystemStateLinux() {
    return new Promise((resolve, reject) => {
      const proc = spawn("xdotool", ["getactivewindow", "getwindowname"]);

      let stdout = "";
      let timedOut = false;

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      const timeoutId = setTimeout(() => {
        timedOut = true;
        proc.kill();
        resolve({
          appName: "",
          bundleId: "",
          windowTitle: "",
          url: null,
          source: "xdotool-fallback",
        });
      }, 2000);

      proc.on("close", (code) => {
        if (timedOut) {
          return;
        }
        clearTimeout(timeoutId);

        resolve({
          appName: "",
          bundleId: "",
          windowTitle: stdout.trim(),
          url: null,
          source: "xdotool",
        });
      });

      proc.on("error", (error) => {
        if (timedOut) {
          return;
        }
        clearTimeout(timeoutId);
        resolve({
          appName: "",
          bundleId: "",
          windowTitle: "",
          url: null,
          source: "xdotool-error",
        });
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LOCAL CONTEXT DETECTION (Rule-based, <5ms)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Detect context locally using rule-based matching
   * This is the FAST PATH - no network, no LLM
   */
  detectContextLocally(systemState) {
    const { appName, bundleId, windowTitle, url } = systemState;

    // Context signatures with detection rules
    const contexts = this.getContextSignatures();

    let bestMatch = null;
    let bestScore = 0;

    for (const ctx of contexts) {
      let score = 0;
      const matches = [];

      // Match by app name
      if (ctx.apps?.some((app) => appName?.toLowerCase().includes(app.toLowerCase()))) {
        score += 30;
        matches.push("app");
      }

      // Match by bundle ID
      if (ctx.bundleIds?.some((bid) => bundleId?.toLowerCase() === bid.toLowerCase())) {
        score += 25;
        matches.push("bundleId");
      }

      // Match by URL (for browsers)
      if (
        url &&
        ctx.urlPatterns?.some((pattern) => url.toLowerCase().includes(pattern.toLowerCase()))
      ) {
        score += 40;
        matches.push("url");
      }

      // Match by window title
      if (
        windowTitle &&
        ctx.windowPatterns?.some((pattern) => {
          if (pattern === "*") {
            return true;
          }
          if (pattern === "^$") {
            return !windowTitle.trim();
          }
          return windowTitle.toLowerCase().includes(pattern.toLowerCase());
        })
      ) {
        score += 15;
        matches.push("window");
      }

      // Special case: Finder with no real window = blank desktop
      if (
        ctx.id === "desktop-blank" &&
        (appName === "Finder" || bundleId === "com.apple.finder") &&
        (!windowTitle || windowTitle === "Finder" || windowTitle.trim() === "")
      ) {
        score += 50;
        matches.push("blank-desktop");
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = {
          ...ctx,
          confidence: Math.min(score / 100, 1.0),
          matchedOn: matches,
          systemState,
        };
      }
    }

    // Fallback to blank desktop
    if (!bestMatch) {
      const fallback = contexts.find((c) => c.id === "desktop-blank");
      return {
        ...fallback,
        confidence: 0.3,
        matchedOn: ["fallback"],
        systemState,
      };
    }

    return bestMatch;
  }

  /**
   * Get context signatures - cached locally for instant matching
   * These match the server-side CONTEXT_SIGNATURES
   */
  getContextSignatures() {
    return [
      {
        id: "desktop-blank",
        name: "Blank Desktop",
        apps: ["Finder"],
        bundleIds: ["com.apple.finder"],
        windowPatterns: ["^$", "Finder"],
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
            examples: ["Open Chrome", "Launch Slack"],
          },
          {
            action: "open_url",
            description: "Go to a website",
            examples: ["Go to Google", "Open Gmail"],
          },
        ],
        context_prompt:
          "User is on blank desktop. They likely want to launch an app or open a website.",
        priority: 100,
      },
      {
        id: "finder-window",
        name: "Finder Window",
        apps: ["Finder"],
        bundleIds: ["com.apple.finder"],
        windowPatterns: ["Documents", "Downloads", "Desktop", "Applications", "/"],
        capabilities: ["file_operations", "file_navigation", "launch_applications", "open_files"],
        available_tools: ["open_file", "open_folder", "copy_file", "launch_app"],
        priority: 90,
      },
      {
        id: "chrome-general",
        name: "Chrome Browser",
        apps: ["Google Chrome", "Chrome"],
        bundleIds: ["com.google.Chrome"],
        windowPatterns: ["*"],
        capabilities: ["web_navigation", "page_interaction", "form_filling", "data_extraction"],
        available_tools: [
          "navigate_browser",
          "get_page_content",
          "click_node",
          "input_text_node",
          "press_key",
        ],
        priority: 80,
      },
      {
        id: "chrome-gmail",
        name: "Gmail",
        apps: ["Google Chrome", "Chrome"],
        bundleIds: ["com.google.Chrome"],
        urlPatterns: ["mail.google.com", "gmail.com"],
        windowPatterns: ["Gmail", "Inbox", "Compose"],
        capabilities: ["email_read", "email_compose", "email_reply", "email_search"],
        available_tools: ["get_page_content", "click_node", "input_text_node"],
        priority: 95,
      },
      {
        id: "chrome-ecommerce",
        name: "E-Commerce",
        apps: ["Google Chrome", "Chrome"],
        bundleIds: ["com.google.Chrome"],
        urlPatterns: ["amazon.com", "walmart.com", "target.com", "bestbuy.com", "ebay.com"],
        capabilities: ["product_search", "add_to_cart", "checkout"],
        available_tools: ["get_page_content", "click_node", "input_text_node"],
        confirmation_required: ["checkout", "purchase"],
        priority: 92,
      },
      {
        id: "slack-app",
        name: "Slack",
        apps: ["Slack"],
        bundleIds: ["com.tinyspeck.slackmacgap"],
        capabilities: ["send_message", "read_messages", "switch_channel"],
        available_tools: ["type_text", "press_key", "click_element"],
        priority: 85,
      },
      {
        id: "vscode-app",
        name: "VS Code",
        apps: ["Code", "Visual Studio Code", "VSCode"],
        bundleIds: ["com.microsoft.VSCode"],
        capabilities: ["code_editing", "file_navigation", "terminal_commands"],
        available_tools: ["type_text", "press_key", "click_element"],
        priority: 85,
      },
      {
        id: "terminal-app",
        name: "Terminal",
        apps: ["Terminal", "iTerm2", "iTerm", "Warp"],
        bundleIds: ["com.apple.Terminal", "com.googlecode.iterm2", "dev.warp.Warp-Stable"],
        capabilities: ["run_commands", "file_operations"],
        available_tools: ["type_text", "press_key"],
        confirmation_required: ["rm", "sudo", "delete"],
        priority: 85,
      },
      {
        id: "notes-app",
        name: "Notes",
        apps: ["Notes"],
        bundleIds: ["com.apple.Notes"],
        capabilities: ["create_note", "edit_note", "search_notes"],
        available_tools: ["type_text", "press_key", "click_element"],
        priority: 80,
      },
      {
        id: "messages-app",
        name: "Messages",
        apps: ["Messages"],
        bundleIds: ["com.apple.MobileSMS"],
        capabilities: ["send_message", "read_messages"],
        available_tools: ["type_text", "press_key", "click_element"],
        priority: 85,
      },
    ];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CLOUD ENHANCEMENT (Optional, for better intent matching)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Enhance local detection with cloud vectorize
   * Use when you have user intent and want better matching
   */
  async enhanceWithCloud(localContext, systemState, intent) {
    if (!this.cloudflareEndpoint) {
      return null;
    }

    try {
      const response = await fetch(`${this.cloudflareEndpoint}/api/context/detect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appName: systemState.appName,
          bundleId: systemState.bundleId,
          windowTitle: systemState.windowTitle,
          url: systemState.url,
          intent,
        }),
        timeout: 100, // 100ms timeout - don't wait too long
      });

      if (response.ok) {
        const data = await response.json();
        return data.context;
      }
    } catch (e) {
      console.log("[ContextCollector] Cloud enhancement failed:", e.message);
    }

    return null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BROWSER URL INTEGRATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Update context with browser URL (called by extension bridge)
   */
  updateBrowserUrl(url) {
    if (
      this.cachedContext &&
      (this.cachedContext.id?.startsWith("chrome") ||
        this.cachedContext.appName === "Google Chrome")
    ) {
      this.cachedContext.url = url;
      this.cachedContext.systemState = {
        ...this.cachedContext.systemState,
        url,
      };

      // Re-detect with URL for better accuracy
      const updated = this.detectContextLocally({
        ...this.cachedContext.systemState,
        url,
      });

      this.cachedContext = updated;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITY METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Check if current context requires confirmation for an action
   */
  requiresConfirmation(action) {
    const ctx = this.lastDetection;
    if (!ctx?.confirmation_required) {
      return false;
    }

    return ctx.confirmation_required.some((pattern) =>
      action.toLowerCase().includes(pattern.toLowerCase()),
    );
  }

  /**
   * Get the context prompt to inject into LLM system message
   */
  getContextPrompt() {
    return (
      this.lastDetection?.context_prompt ||
      "User context is unknown. Ask what they would like to do."
    );
  }

  /**
   * Get available tools for current context
   */
  getAvailableTools() {
    return this.lastDetection?.available_tools || [];
  }

  /**
   * Check if we're on a blank desktop (launch context)
   */
  isBlankDesktop() {
    return this.lastDetection?.id === "desktop-blank";
  }

  /**
   * Check if we're in a browser
   */
  isBrowserContext() {
    return (
      this.lastDetection?.id?.startsWith("chrome") ||
      this.lastDetection?.appName === "Google Chrome"
    );
  }

  /**
   * Clear cached context
   */
  clearCache() {
    this.cachedContext = null;
    this.cacheTimestamp = 0;
  }
}

// Singleton instance
let contextCollectorInstance = null;

function getContextCollector() {
  if (!contextCollectorInstance) {
    contextCollectorInstance = new ContextCollector();
  }
  return contextCollectorInstance;
}

module.exports = { ContextCollector, getContextCollector };
