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
  browser: new Set(["centris_browser", "web_search", "web_fetch", "tts"]),
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
  ...w1(["frontmost", "active window", "focused window", "focused app"]),
  // Desktop/window snapshots — weight 2 to beat file's "my desktop"
  ["frontmost window", 2],
  ["window snapshot", 2],
  ["desktop snapshot", 2],
  ["on my desktop", 2],
  // Desktop interaction
  ...w1(["click button", "press button", "keyboard shortcut"]),
  ...w1(["cmd+", "ctrl+", "alt+", "command+", "control+"]),
  ...w1(["copy paste", "select all"]),
  // System
  ...w1(["running apps", "running applications", "what apps", "what's running"]),
  ...w1(["list apps", "list applications", "open applications"]),
  ...w1(["display", "screen", "monitor", "resolution"]),
  ...w1(["volume", "brightness", "wifi", "bluetooth"]),
  // AX / accessibility
  ...w1(["accessibility", "ui elements", "ax tree"]),
];

const FILE_KEYWORDS: WeightedKeyword[] = [
  // File operations
  ...w1(["read file", "read the file", "open file", "open the file"]),
  ...w1(["write file", "write to file", "create file", "create a file"]),
  ...w1(["save file", "save to file", "save as"]),
  ...w1(["edit file", "edit the file", "modify file", "update file"]),
  ...w1(["delete file", "remove file"]),
  // Organization — common voice patterns
  ...w1(["organize", "sort files", "move files", "clean up files"]),
  ...w1(["into folders", "into folder", "into directory"]),
  // Directory operations
  ...w1(["list directory", "list folder", "list files", "show files"]),
  ...w1(["create directory", "create folder", "make directory"]),
  // File types
  ...w1([".txt", ".json", ".csv", ".yaml", ".yml", ".md"]),
  ...w1([".py", ".js", ".ts", ".html", ".css"]),
  ...w1([".pdf", ".doc", ".docx", ".xls", ".xlsx"]),
  // File paths — "desktop" without slash for voice (users say "my desktop files")
  ...w1(["~/", "/users/", "documents/", "desktop/", "downloads/"]),
  ...w1(["my desktop", "my documents", "my downloads"]),
  // File nouns — voice users say "my files", "the files"
  ...w1(["my files", "the files", "these files"]),
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
 * Remove old messages from conversation history between commands.
 *
 * Centris is a voice assistant: each command is independent.
 * Old conversation history is pure waste. This function runs BEFORE prompt()
 * adds the new user message, so everything currently in the array is from
 * previous commands. Nuke it all.
 *
 * Mutates messages array in place.
 */
export function compactStaleSnapshots<
  T extends {
    role: string;
    toolName?: string;
    content?:
      | string
      | Array<{ type: string; text?: string; thinking?: string; thinkingSignature?: string }>;
  },
>(messages: T[], profileName?: string): number {
  if (profileName !== "centris") {
    return 0;
  }

  const totalOld = messages.length;
  if (totalOld > 0) {
    messages.splice(0, totalOld);
    logInfo(`[centris-router] cleared ${totalOld} old messages (clean slate for new command)`);
    return totalOld;
  }

  return 0;
}

// ─── Intra-command context compaction (transformContext hook) ────────────────
//
// ROOT CAUSE OF TOKEN RUNAWAY:
//   pi-agent-core's agentLoop creates its OWN copy of the messages array
//   (agent-loop.js line 16: `messages: [...context.messages, ...prompts]`).
//   All tool results are pushed to this local copy, NOT agent._state.messages.
//   The old mid-loop compaction code (in pi-embedded-subscribe.handlers.tools.ts)
//   modified agent._state.messages — a COMPLETELY DIFFERENT array. No-op.
//
// FIX:
//   Use the `transformContext` hook, which runs on the agentLoop's local
//   messages array BEFORE every LLM call (agent-loop.js line 136-138).
//   This is the only hook that touches the actual messages the LLM receives.
//
// STRATEGY:
//   For a multi-step browser flow (navigate → click → type), each step returns
//   a DOM snapshot. The LLM only needs the LATEST snapshot — old ones contain
//   stale nodeIds and content. We:
//     1. Keep user messages (the original command)
//     2. Strip thinking content from assistant messages
//     3. Compress ALL tool results except the most recent to a 1-line summary
//     4. Cap the latest tool result at MAX_TOOL_RESULT_CHARS
//
//   This keeps context flat: ~2300 base + ~100 compressed + ~2000 latest ≈ ~4400
//   instead of linear growth per step.

interface CompactableMessage {
  role: string;
  toolName?: string;
  content?:
    | string
    | Array<{ type: string; text?: string; thinking?: string; thinkingSignature?: string }>;
}

/**
 * Compact context for Centris before each LLM call.
 *
 * Called via agent.transformContext — runs on the agentLoop's OWN messages
 * array, which is the actual array sent to the LLM. This is the ONLY hook
 * that can affect intra-command token usage.
 *
 * Returns a new array (does not mutate input).
 */
export function compactCentrisContext<T extends CompactableMessage>(messages: T[]): T[] {
  if (messages.length === 0) {
    return messages;
  }

  // Find the index of the LAST toolResult message
  let lastToolResultIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "toolResult") {
      lastToolResultIdx = i;
      break;
    }
  }

  // No tool results yet (first LLM call) — nothing to compact
  if (lastToolResultIdx === -1) {
    return messages;
  }

  const result: T[] = [];
  let compressedCount = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // Keep user messages as-is (the original command)
    if (msg.role === "user") {
      result.push(msg);
      continue;
    }

    // Assistant messages: strip thinking, keep tool calls lean
    if (msg.role === "assistant") {
      if (Array.isArray(msg.content)) {
        const leanContent = msg.content.map((part) => {
          if (part.type === "thinking") {
            return { ...part, thinking: "", thinkingSignature: undefined };
          }
          // Strip verbose text from old assistant turns (before latest tool result)
          if (
            part.type === "text" &&
            i < lastToolResultIdx &&
            typeof part.text === "string" &&
            part.text.length > 80
          ) {
            return { ...part, text: part.text.slice(0, 80) + "..." };
          }
          return part;
        });
        result.push({ ...msg, content: leanContent } as T);
      } else {
        result.push(msg);
      }
      continue;
    }

    // Tool results: compress all except the latest one
    if (msg.role === "toolResult") {
      if (i === lastToolResultIdx) {
        // Latest tool result: keep full but cap size
        if (Array.isArray(msg.content)) {
          const cappedContent = msg.content.map((part) => {
            if (
              part.type === "text" &&
              typeof part.text === "string" &&
              part.text.length > MAX_TOOL_RESULT_CHARS
            ) {
              return {
                ...part,
                text: part.text.slice(0, MAX_TOOL_RESULT_CHARS) + "...[truncated]",
              };
            }
            return part;
          });
          result.push({ ...msg, content: cappedContent } as T);
        } else {
          result.push(msg);
        }
      } else {
        // Old tool result: compress to tiny summary
        compressedCount++;
        const summary = compressToolResult(msg);
        result.push({ ...msg, content: [{ type: "text", text: summary }] } as T);
      }
      continue;
    }

    // Other message types: pass through
    result.push(msg);
  }

  if (compressedCount > 0) {
    logInfo(
      `[centris-context] compressed ${compressedCount} old tool results, kept latest at idx ${lastToolResultIdx}`,
    );
  }

  return result;
}

// ─── Single-tool short-circuit (skip Call 2 at streamFn level) ───────────────
//
// pi-agent-core's agentLoop always makes a second LLM call after tool execution
// to check if the LLM wants more tools. For simple single-tool tasks (write, exec),
// the LLM returns 0 output tokens — a wasted API call that burns ~2400 input tokens.
//
// Fix: wrap `streamFn` to intercept Call 2. When the LLM context contains exactly
// one successful tool result, return a synthetic "done" response instead of calling
// the API. The loop sees no tool calls → exits. Zero tokens burned for Call 2.
//
// Detection: check the LLM-formatted messages (Message[]) passed to streamFn.
// These have the final shape the API would see: user, assistant (with tool call),
// and toolResult messages.

/** Tools whose single-tool results don't need LLM interpretation. */
const SKIP_CALL2_TOOLS = new Set(["write", "edit", "apply_patch", "exec", "centris_computer"]);

/**
 * Check if LLM messages represent a completed single-tool task.
 * Returns formatted text if Call 2 can be skipped, null otherwise.
 */
export function detectSingleToolDone(
  messages: Array<{ role: string; toolName?: string; isError?: boolean; content?: unknown }>,
): string | null {
  const toolResults = messages.filter((m) => m.role === "toolResult");
  if (toolResults.length !== 1) {
    return null;
  }

  const result = toolResults[0];
  if (result.isError) {
    return null;
  }
  if (!result.toolName || !SKIP_CALL2_TOOLS.has(result.toolName)) {
    return null;
  }

  // Check assistant had exactly 1 tool call
  const assistants = messages.filter((m) => m.role === "assistant");
  const lastAssistant = assistants[assistants.length - 1];
  if (lastAssistant && Array.isArray(lastAssistant.content)) {
    const toolCalls = (lastAssistant.content as Array<{ type?: string }>).filter(
      (p) => p.type === "toolCall",
    );
    if (toolCalls.length > 1) {
      return null;
    }
  }

  logInfo(`[centris-call2-skip] single-tool done: ${result.toolName} → skipping Call 2`);
  return "Done.";
}

/** Extract a tiny summary from a tool result message. */
function compressToolResult<T extends CompactableMessage>(msg: T): string {
  if (!Array.isArray(msg.content)) {
    return '{"status":"ok"}';
  }

  for (const part of msg.content) {
    if (part.type !== "text" || typeof part.text !== "string") {
      continue;
    }
    try {
      const data = JSON.parse(part.text) as Record<string, unknown>;
      const summary: Record<string, unknown> = { status: data.success !== false ? "ok" : "error" };
      if (data.url) {
        summary.url = data.url;
      }
      if (data.action) {
        summary.action = data.action;
      }
      if (typeof data.clickedText === "string") {
        summary.clicked = data.clickedText.slice(0, 40);
      }
      return JSON.stringify(summary);
    } catch {
      return `${part.text.slice(0, 40)}...[compressed]`;
    }
  }

  return '{"status":"ok"}';
}
