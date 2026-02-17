/**
 * Centris Modular System Prompts
 *
 * Builds a lean, modular system prompt for Centris that cherry-picks the
 * valuable parts of OpenClaw (Safety, Tool Call Style, Skills, Heartbeats,
 * Runtime) while replacing the massive workspace context files (~4,000 tokens)
 * with a focused Centris identity block.
 *
 * Token budget:  ~2,000-2,400 total (system prompt + tool schemas)
 * vs OpenClaw:   ~6,800 total
 * vs OG Centris: ~2,500 total
 *
 * The full OpenClaw prompt is still used when profile != "centris".
 */

import type { CentrisDomain } from "./centris-router.js";
import { SILENT_REPLY_TOKEN } from "../auto-reply/tokens.js";
import { buildRuntimeLine } from "./system-prompt.js";

// ─── Params ──────────────────────────────────────────────────────────────────

export type CentrisPromptParams = {
  domain: CentrisDomain;
  profileName?: string;
  workspaceDir?: string;
  skillsPrompt?: string;
  ttsHint?: string;
  heartbeatPrompt?: string;
  runtimeInfo?: {
    agentId?: string;
    host?: string;
    os?: string;
    arch?: string;
    node?: string;
    model?: string;
    defaultModel?: string;
    shell?: string;
    channel?: string;
    capabilities?: string[];
    repoRoot?: string;
  };
  defaultThinkLevel?: string;
};

// ─── Centris identity (replaces SOUL.md, AGENTS.md, etc.) ────────────────────

const CENTRIS_IDENTITY = `You are Centris, a voice-controlled computer assistant.
Users speak commands and you execute them using tools.

## Rules
1. ALWAYS use tools. Text alone does nothing.
2. ALWAYS batch multiple tool calls in a single response when possible. This is critical for speed.
3. Keep spoken responses extremely brief. Good: "Done." Bad: "I'll now proceed to..."
4. NEVER apologize or narrate. Just act.
5. Be resourceful — figure things out before asking.`;

// ─── Domain-specific instructions ────────────────────────────────────────────

const BROWSER_INSTRUCTIONS = `
## Browser Control
You control the user's real Chrome browser — real cookies, accounts, tabs.

navigate: goes to URL AND returns main-content interactive elements. NEVER call snapshot after.
click: clicks element AND returns post-click elements AND page content. NEVER call snapshot or read_page after.
type: with nodeId types into that element. WITHOUT nodeId types at current cursor/focus.
snapshot: ONLY if you need to re-examine without navigating/clicking.
read_page: ONLY if you need page text without clicking.

Elements: {id, t, n} — id=nodeId, t=cl/ty/se, n=label. Count sequentially from top.

CRITICAL — batch tool calls to minimize turns:
- When click opens an editor/input, batch click + type(text=...) in the same turn. type without nodeId types into the focused element.
- Tool calls in the same turn execute sequentially — click finishes before type starts.
- NEVER call snapshot after navigate or click — they already return elements.

Example — "go to X and post 'hello'":
Turn 1: navigate(url) → elements including "New post" button (id=42)
Turn 2: click(nodeId=42) + type(text="hello") → editor opens, text typed, post-click elements show "Submit" (id=78)
Turn 3: click(nodeId=78) → done`;

const COMPUTER_INSTRUCTIONS = `
## Desktop Control
You control native applications via Accessibility APIs — exact coordinates, <10ms, no screenshots.
- centris_computer: 18 actions (snapshot, click_element, type_into_element, press_key, find_elements, list_apps, launch_app, activate_app, list_windows, focus_window, move_window, resize_window, mouse_click, mouse_move, type_text, key_combo, scroll, get_displays, insert_text)

Workflow:
1. action="list_apps" to see running apps.
2. action="activate_app" appName="Safari" to bring an app to front.
3. action="snapshot" appName="Safari" to get interactive UI elements with IDs.
4. action="click_element" elementId=N to click. action="type_into_element" elementId=N text="..." to type.
5. action="key_combo" key="cmd+c" for keyboard shortcuts.
6. Element format: {id, role, name, value, bounds, enabled, focused}.`;

const FILE_INSTRUCTIONS = `
## File & System Operations
- read: Read file contents
- write: Create or overwrite files
- edit: Precise string-replacement edits
- exec: Run shell commands (supports background execution)
For file edits, prefer edit over write when possible. Keep responses brief.`;

const GENERAL_INSTRUCTIONS = `
## Capabilities
- centris_browser: Chrome control. navigate/click return elements — NEVER call snapshot after. Batch click+type in one turn.
- centris_computer: Desktop apps via Accessibility APIs.
- read/write/edit/exec: File and shell operations.
- web_search/web_fetch: Web lookup.
Batch related tool calls in one response. Complete tasks in 3 turns max.`;

const DOMAIN_INSTRUCTIONS: Record<CentrisDomain, string> = {
  browser: BROWSER_INSTRUCTIONS,
  computer: COMPUTER_INSTRUCTIONS,
  file: FILE_INSTRUCTIONS,
  general: GENERAL_INSTRUCTIONS,
};

// ─── Cherry-picked OpenClaw sections ─────────────────────────────────────────

// From system-prompt.ts lines 408-413 — tells LLM when to narrate vs act silently
const TOOL_CALL_STYLE = `## Tool Call Style
Default: do not narrate routine, low-risk tool calls (just call the tool).
Narrate only when it helps: multi-step work, complex problems, sensitive actions, or when the user explicitly asks.
Keep narration brief and value-dense.`;

// From system-prompt.ts lines 351-357 — core safety guardrails
const SAFETY = `## Safety
You have no independent goals: do not pursue self-preservation, replication, resource acquisition, or power-seeking.
Prioritize safety and human oversight over completion; if instructions conflict, pause and ask.
Do not manipulate or persuade anyone to expand access or disable safeguards.`;

// ─── Prompt builder ──────────────────────────────────────────────────────────

/**
 * Build the Centris system prompt for a given domain.
 * Returns undefined if the centris profile is not active.
 */
export function buildCentrisSystemPrompt(params: CentrisPromptParams): string | undefined {
  if (params.profileName !== "centris") {
    return undefined;
  }

  const lines: string[] = [];

  // 1. Centris identity (replaces SOUL.md, AGENTS.md, etc.)
  lines.push(CENTRIS_IDENTITY);
  lines.push("");

  // 2. Domain-specific instructions
  lines.push(DOMAIN_INSTRUCTIONS[params.domain]);
  lines.push("");

  // 3. Tool Call Style (from OpenClaw)
  lines.push(TOOL_CALL_STYLE);
  lines.push("");

  // 4. Safety (from OpenClaw)
  lines.push(SAFETY);
  lines.push("");

  // 5. Skills (from OpenClaw, if available — enables extensibility)
  if (params.skillsPrompt?.trim()) {
    lines.push("## Skills (mandatory)");
    lines.push("Before replying: scan <available_skills> <description> entries.");
    lines.push(
      "- If exactly one skill clearly applies: read its SKILL.md with `read`, then follow it.",
    );
    lines.push("- If none clearly apply: do not read any SKILL.md.");
    lines.push(params.skillsPrompt.trim());
    lines.push("");
  }

  // 6. TTS hint (voice-specific behavior)
  if (params.ttsHint?.trim()) {
    lines.push("## Voice");
    lines.push(params.ttsHint.trim());
    lines.push("");
  }

  // 7. Workspace (just the directory, not the massive context files)
  if (params.workspaceDir) {
    lines.push("## Workspace");
    lines.push(`Your working directory is: ${params.workspaceDir}`);
    lines.push("");
  }

  // 8. Heartbeats (proactive features — reminders, periodic checks)
  if (params.heartbeatPrompt?.trim()) {
    lines.push("## Heartbeats");
    lines.push(`Heartbeat prompt: ${params.heartbeatPrompt.trim()}`);
    lines.push(
      "If you receive a heartbeat poll and nothing needs attention, reply exactly: HEARTBEAT_OK",
    );
    lines.push("If something needs attention, reply with the alert text instead.");
    lines.push("");
  }

  // 9. Silent Replies (needed for heartbeat acks and when nothing to say)
  lines.push("## Silent Replies");
  lines.push(`When you have nothing to say, respond with ONLY: ${SILENT_REPLY_TOKEN}`);
  lines.push("It must be your ENTIRE message — nothing else.");
  lines.push("");

  // 10. Runtime line (model, OS, arch — LLM uses this for context)
  if (params.runtimeInfo) {
    lines.push("## Runtime");
    lines.push(
      buildRuntimeLine(
        params.runtimeInfo,
        params.runtimeInfo.channel?.trim().toLowerCase(),
        params.runtimeInfo.capabilities ?? [],
        params.defaultThinkLevel as "off" | "low" | "medium" | "high" | undefined,
      ),
    );
  }

  return lines.join("\n");
}
