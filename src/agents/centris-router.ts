/**
 * Centris Intent Router
 *
 * Lightweight keyword-based router that classifies user messages into domains,
 * then narrows the tool set to only the relevant domain's tools.
 *
 * This mirrors the OG Centris orchestrator pattern:
 *   1. User says something
 *   2. Router classifies intent → domain (browser, computer, file, general)
 *   3. Only that domain's tools go to the LLM
 *
 * Zero LLM cost — pure keyword matching. The LLM still decides *what* to do
 * with the tools; this just controls *which* tools it sees.
 */

import { logInfo } from "../logger.js";

// ─── Domain definitions ──────────────────────────────────────────────────────

export type CentrisDomain = "browser" | "computer" | "file" | "general";

/** Tools allowed per domain. Tool names are canonical (lowercase). */
const DOMAIN_TOOLS: Record<CentrisDomain, Set<string>> = {
  browser: new Set(["centris_browser", "browser", "web_search", "web_fetch", "tts"]),
  computer: new Set(["centris_computer", "tts"]),
  file: new Set(["read", "write", "edit", "apply_patch", "exec", "tts"]),
  // "general" = full centris profile, no additional filtering
  general: new Set(),
};

// ─── Keyword patterns (inspired by OG Centris orchestrator) ──────────────────
// Each entry is [keyword, weight]. Longer/more-specific matches get higher
// weight so "slack app" (computer, weight 2) beats "slack" (browser, weight 1).
// Default weight is 1 for backwards compatibility.

type WeightedKeyword = [string, number];

/** Helper: create keyword list where every entry gets weight 1. */
const w1 = (keywords: string[]): WeightedKeyword[] => keywords.map((k) => [k, 1]);

const BROWSER_KEYWORDS: WeightedKeyword[] = [
  // Navigation
  ...w1(["navigate", "go to", "open website", "browse", "open url"]),
  ...w1(["open tab", "new tab", "switch tab", "close tab"]),
  // Web services — standalone names (lower weight so "X app" can override)
  ...w1(["gmail", "google", "youtube", "twitter", "facebook", "reddit"]),
  ...w1(["linkedin", "amazon", "github", "cloudflare", "netflix"]),
  ...w1(["instagram", "whatsapp web", "notion", "figma"]),
  // Web actions
  ...w1(["click on", "click the", "type in", "fill out", "fill in"]),
  // "search for" is ambiguous ("search for files" = file domain).
  // Only match clearly web-oriented search phrases.
  ["search the web", 2],
  ["look up online", 2],
  ["search on google", 2],
  ...w1(["submit", "login", "log in", "sign in", "sign up"]),
  ...w1(["download from", "upload to"]),
  // Page interaction
  ...w1(["scroll down", "scroll up", "scroll the page"]),
  ...w1(["take a snapshot", "page snapshot", "dom snapshot"]),
  ...w1(["read the page", "what's on the page", "what do you see"]),
  // Browser-specific
  ...w1(["browser", "webpage", "website", "web page", "bookmark"]),
  ...w1(["in chrome", "in the browser", "on the page"]),
  ...w1(["dashboard", "portal"]),
];

const COMPUTER_KEYWORDS: WeightedKeyword[] = [
  // App management
  ...w1(["open app", "launch app", "open application", "launch application"]),
  ...w1(["close app", "quit app", "force quit"]),
  ...w1(["switch to app", "activate app", "bring up"]),
  // Specific apps (native, not web) — "X app" phrases get weight 2 to beat
  // the bare "X" in browser keywords (e.g. "slack app" > "slack").
  ...w1(["finder", "safari", "terminal", "iterm"]),
  ...w1(["system settings", "system preferences", "activity monitor"]),
  ...w1(["preview", "textedit"]),
  ["notes app", 2],
  ["reminders app", 2],
  ["calendar app", 2],
  ["music app", 2],
  ["photos app", 2],
  ...w1(["xcode", "vscode", "visual studio"]),
  ["slack app", 2],
  ["zoom app", 2],
  ["discord app", 2],
  ...w1(["spotify"]),
  // Window management
  ...w1(["minimize", "maximize", "resize window", "move window"]),
  ...w1(["full screen", "split screen", "arrange windows"]),
  // Desktop interaction
  ...w1(["click button", "press button", "keyboard shortcut"]),
  ...w1(["cmd+", "ctrl+", "alt+", "command+", "control+"]),
  ...w1(["copy paste", "select all"]),
  // System
  ...w1(["running apps", "what apps", "what's running"]),
  ...w1(["display", "screen", "monitor", "resolution"]),
  ...w1(["volume", "brightness", "wifi", "bluetooth"]),
];

const FILE_KEYWORDS: WeightedKeyword[] = [
  // File operations
  ...w1(["read file", "read the file", "open file", "open the file"]),
  ...w1(["write file", "write to file", "create file", "create a file"]),
  ...w1(["save file", "save to file", "save as"]),
  ...w1(["edit file", "edit the file", "modify file", "update file"]),
  ...w1(["delete file", "remove file"]),
  // Directory operations
  ...w1(["list directory", "list folder", "list files", "show files"]),
  ...w1(["create directory", "create folder", "make directory"]),
  // File types
  ...w1([".txt", ".json", ".csv", ".yaml", ".yml", ".md"]),
  ...w1([".py", ".js", ".ts", ".html", ".css"]),
  ...w1([".pdf", ".doc", ".docx", ".xls", ".xlsx"]),
  // File paths
  ...w1(["~/", "/users/", "documents/", "desktop/", "downloads/"]),
  // Content
  ...w1(["file contents", "file content", "what's in the file"]),
  // Terminal / shell (file-adjacent)
  ...w1(["run command", "execute command", "terminal command"]),
  ...w1(["run script", "execute script", "shell command"]),
  ...w1(["pip install", "npm install", "brew install"]),
  ...w1(["ls ", "cat ", "mkdir ", "cp ", "mv ", "rm "]),
  // "search for" in file context — only when combined with file indicators
  ["search for files", 2],
];

// ─── Router ──────────────────────────────────────────────────────────────────

/**
 * Classify a user message into a Centris domain.
 * Returns the domain with the highest keyword match count.
 * Falls back to "general" if no clear winner or ambiguous.
 */
export function classifyCentrisIntent(message: string): CentrisDomain {
  const lower = message.toLowerCase().trim();
  if (!lower) {
    return "general";
  }

  const scores: Record<CentrisDomain, number> = {
    browser: 0,
    computer: 0,
    file: 0,
    general: 0,
  };

  for (const [kw, weight] of BROWSER_KEYWORDS) {
    if (lower.includes(kw)) {
      scores.browser += weight;
    }
  }
  for (const [kw, weight] of COMPUTER_KEYWORDS) {
    if (lower.includes(kw)) {
      scores.computer += weight;
    }
  }
  for (const [kw, weight] of FILE_KEYWORDS) {
    if (lower.includes(kw)) {
      scores.file += weight;
    }
  }

  // Find the domain with the highest score
  const maxScore = Math.max(scores.browser, scores.computer, scores.file);
  if (maxScore === 0) {
    return "general";
  }

  // Check for ties — if ambiguous, stay general so the LLM gets all tools
  const winners = (["browser", "computer", "file"] as const).filter((d) => scores[d] === maxScore);
  if (winners.length > 1) {
    return "general";
  }

  return winners[0];
}

/**
 * Filter tools based on Centris domain routing.
 * Called after tool policy filtering — this is an additive narrowing step.
 *
 * Only active when the centris tool profile is in use.
 * Returns the original tools if domain is "general" or routing doesn't apply.
 */
export function applyCentrisRouting<T extends { name: string }>(
  tools: T[],
  messages: Array<{ role: string; content?: string }>,
  profileName?: string,
): T[] {
  // Only route when the centris profile is active
  if (profileName !== "centris") {
    return tools;
  }

  // Extract the last user message
  const lastUserMsg = [...messages].toReversed().find((m) => m.role === "user" && m.content);
  if (!lastUserMsg?.content) {
    return tools;
  }

  const domain = classifyCentrisIntent(lastUserMsg.content);
  if (domain === "general") {
    logInfo(`[centris-router] domain=general → all ${tools.length} tools`);
    return tools;
  }

  const allowed = DOMAIN_TOOLS[domain];
  const filtered = tools.filter((t) => allowed.has(t.name.toLowerCase()));

  logInfo(
    `[centris-router] domain=${domain} → ${filtered.length} tools (${filtered.map((t) => t.name).join(", ")})`,
  );
  return filtered;
}

// ─── Aggressive context pruning ─────────────────────────────────────────────

/** Max chars for the latest tool result text. Safety net for huge pages. */
const MAX_TOOL_RESULT_CHARS = 4000;

/**
 * Remove old tool turns from conversation history entirely.
 *
 * Old Centris: each agent had its own short context. 3 turns, 10K tokens.
 * New system: single conversation where ALL turns accumulate.
 *
 * Stale tool results contain old nodeIds, old page state, old content —
 * completely useless. Worse: they confuse the LLM if it tries to reuse
 * old nodeIds that no longer exist.
 *
 * Strategy: identify "tool turns" (assistant tool_use + its toolResults),
 * splice out ALL except the latest one. The LLM only needs:
 *   - The user's original request
 *   - The most recent tool result (current page state)
 *
 * Also caps the latest tool result at MAX_TOOL_RESULT_CHARS.
 *
 * Only active when the centris profile is in use.
 * Mutates messages array in place.
 */
export function compactStaleSnapshots<
  T extends {
    role: string;
    toolName?: string;
    content?: Array<{ type: string; text?: string }>;
  },
>(messages: T[], profileName?: string): number {
  if (profileName !== "centris") {
    return 0;
  }

  // Identify tool turns: each turn = one assistant message + its following toolResult(s).
  // A turn ends when we hit another assistant, user, or end of array.
  const turns: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role !== "assistant") {
      continue;
    }
    // Check if this assistant message has tool calls (look ahead for toolResult)
    let hasToolResults = false;
    let turnEnd = i;
    for (let j = i + 1; j < messages.length; j++) {
      if (messages[j].role === "toolResult") {
        hasToolResults = true;
        turnEnd = j;
      } else {
        break;
      }
    }
    if (hasToolResults) {
      turns.push({ start: i, end: turnEnd });
    }
  }

  // Keep only the last tool turn; splice out everything older.
  const KEEP_LATEST = 1;
  if (turns.length <= KEEP_LATEST) {
    // Nothing to prune — but still cap the latest result size
    capLatestToolResults(messages);
    return 0;
  }

  // Mark old turn indices for removal
  const removeSet = new Set<number>();
  const removeTurns = turns.slice(0, turns.length - KEEP_LATEST);
  for (const turn of removeTurns) {
    for (let i = turn.start; i <= turn.end; i++) {
      removeSet.add(i);
    }
  }

  // Splice out old turns (reverse order to preserve indices)
  let removed = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (removeSet.has(i)) {
      messages.splice(i, 1);
      removed++;
    }
  }

  // Cap the latest tool result sizes
  capLatestToolResults(messages);

  if (removed > 0) {
    logInfo(`[centris-router] pruned ${removed} stale messages (${removeTurns.length} old turns)`);
  }
  return removed;
}

/** Cap oversized tool result text in the latest turn. */
function capLatestToolResults<
  T extends {
    role: string;
    content?: Array<{ type: string; text?: string }>;
  },
>(messages: T[]): void {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "toolResult" || !msg.content?.length) {
      continue;
    }
    for (const part of msg.content) {
      if (part.type === "text" && part.text && part.text.length > MAX_TOOL_RESULT_CHARS) {
        part.text = part.text.slice(0, MAX_TOOL_RESULT_CHARS) + "...[truncated]";
      }
    }
    // Only cap the latest turn's results, then stop
    if (msg.role === "toolResult") {
      // Keep going backwards through consecutive toolResults (same turn)
      if (i > 0 && messages[i - 1]?.role === "toolResult") {
        continue;
      }
      break;
    }
  }
}
