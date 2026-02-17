import { describe, expect, it, vi } from "vitest";

/**
 * Centris Integration Tests
 *
 * End-to-end validation of the centris system components working together:
 *   1. Token budget — real prompt sizes stay within budget across all domains
 *   2. Tool policy — centris profile exposes exactly the right tools
 *   3. Router + prompt integration — domain classification → correct prompt
 *   4. Context pruning effectiveness — old turns are removed, latest capped
 *
 * These tests use NO mocks for the centris code — they test real behavior.
 * Only external dependencies (logger, buildRuntimeLine) are mocked.
 */

vi.mock("../logger.js", () => ({
  logInfo: vi.fn(),
  logDebug: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("./system-prompt.js", () => ({
  buildRuntimeLine: vi.fn(
    (info: Record<string, string>) =>
      `Runtime: model=${info.model ?? "unknown"} os=${info.os ?? "unknown"}`,
  ),
}));

import { buildCentrisSystemPrompt } from "./centris-prompts.js";
import {
  classifyCentrisIntent,
  applyCentrisRouting,
  compactStaleSnapshots,
  compactCentrisContext,
} from "./centris-router.js";
import { expandToolGroups, resolveToolProfilePolicy } from "./tool-policy.js";

// ─── Token budget: real prompt sizes ──────────────────────────────────────

describe("token budget", () => {
  // Rule of thumb: 1 token ≈ 4 chars for English text.
  // OpenClaw full prompt: ~6,800 tokens (~27,200 chars).
  // Centris target: ~2,000-2,400 tokens (~8,000-9,600 chars).

  const domains = ["browser", "computer", "file", "general"] as const;

  for (const domain of domains) {
    it(`${domain} domain: minimal prompt is under 3000 chars (~750 tokens)`, () => {
      const prompt = buildCentrisSystemPrompt({
        domain,
        profileName: "centris",
      })!;
      expect(prompt).toBeDefined();
      expect(prompt.length).toBeLessThan(3000);
    });

    it(`${domain} domain: fully loaded prompt is under 5000 chars (~1250 tokens)`, () => {
      const prompt = buildCentrisSystemPrompt({
        domain,
        profileName: "centris",
        workspaceDir: "/Users/testuser/Documents/project",
        skillsPrompt:
          "<available_skills><skill name='test'>Test skill description</skill></available_skills>",
        ttsHint: "Speak extremely briefly. One sentence max.",
        heartbeatPrompt: "Check server status and disk space every 5 minutes.",
        runtimeInfo: {
          agentId: "agent-123",
          host: "macbook",
          os: "darwin",
          arch: "arm64",
          node: "22.0.0",
          model: "claude-4-sonnet-20260214",
          defaultModel: "claude-4-sonnet-20260214",
          shell: "/bin/zsh",
          channel: "centris-voice",
          capabilities: ["browser", "computer", "files", "web"],
          repoRoot: "/Users/testuser/project",
        },
        defaultThinkLevel: "low",
      })!;
      expect(prompt).toBeDefined();
      expect(prompt.length).toBeLessThan(5000);
    });
  }

  it("centris prompt is at least 3x smaller than a typical full prompt", () => {
    // A typical full OpenClaw prompt is ~27,000 chars. Centris should be well under 9,000.
    const centrisPrompt = buildCentrisSystemPrompt({
      domain: "general",
      profileName: "centris",
      workspaceDir: "/test",
      skillsPrompt: "<skills>test</skills>",
      ttsHint: "Brief.",
      heartbeatPrompt: "Check stuff.",
      runtimeInfo: { model: "test", os: "darwin" },
    })!;
    // The full OpenClaw prompt includes SOUL.md, AGENTS.md, workspace context, etc.
    // We assert centris stays under 1/3 of the estimated full prompt size.
    const estimatedFullPromptChars = 27_000;
    expect(centrisPrompt.length).toBeLessThan(estimatedFullPromptChars / 3);
  });
});

// ─── Tool policy: centris profile ─────────────────────────────────────────

describe("centris tool policy", () => {
  it("centris profile resolves to group:centris allow list", () => {
    const policy = resolveToolProfilePolicy("centris");
    expect(policy).toBeDefined();
    expect(policy!.allow).toEqual(["group:centris"]);
    expect(policy!.deny).toBeUndefined();
  });

  it("group:centris expands to exactly the expected tools", () => {
    const tools = expandToolGroups(["group:centris"]);
    const expected = new Set([
      "centris_browser",
      "centris_computer",
      "browser",
      "read",
      "write",
      "edit",
      "apply_patch",
      "exec",
      "web_search",
      "web_fetch",
      "tts",
      "cron",
      "session_status",
    ]);
    expect(new Set(tools)).toEqual(expected);
  });

  it("centris profile does NOT include messaging, sessions_spawn, or image tools", () => {
    const tools = new Set(expandToolGroups(["group:centris"]));
    // These are expensive/unnecessary for Centris (token cost, unrelated features)
    expect(tools.has("message")).toBe(false);
    expect(tools.has("sessions_spawn")).toBe(false);
    expect(tools.has("image")).toBe(false);
    expect(tools.has("canvas")).toBe(false);
    expect(tools.has("nodes")).toBe(false);
    expect(tools.has("gateway")).toBe(false);
  });

  it("centris profile includes file tools for the file agent", () => {
    const tools = new Set(expandToolGroups(["group:centris"]));
    expect(tools.has("read")).toBe(true);
    expect(tools.has("write")).toBe(true);
    expect(tools.has("edit")).toBe(true);
    expect(tools.has("apply_patch")).toBe(true);
    expect(tools.has("exec")).toBe(true);
  });

  it("centris profile includes browser tools", () => {
    const tools = new Set(expandToolGroups(["group:centris"]));
    expect(tools.has("centris_browser")).toBe(true);
    expect(tools.has("browser")).toBe(true); // Playwright fallback
    expect(tools.has("web_search")).toBe(true);
    expect(tools.has("web_fetch")).toBe(true);
  });

  it("centris profile includes computer tools", () => {
    const tools = new Set(expandToolGroups(["group:centris"]));
    expect(tools.has("centris_computer")).toBe(true);
  });
});

// ─── Router + prompt integration ──────────────────────────────────────────

describe("router → prompt integration", () => {
  it("browser message → browser domain → browser prompt", () => {
    const domain = classifyCentrisIntent("go to youtube and search for typescript tutorials");
    expect(domain).toBe("browser");
    const prompt = buildCentrisSystemPrompt({ domain, profileName: "centris" })!;
    expect(prompt).toContain("## Browser Control");
    expect(prompt).toContain("CRITICAL — batch tool calls to minimize turns");
  });

  it("computer message → computer domain → computer prompt", () => {
    // Use a clear computer-only command (no file keywords)
    const domain = classifyCentrisIntent("open system settings and check activity monitor");
    expect(domain).toBe("computer");
    const prompt = buildCentrisSystemPrompt({ domain, profileName: "centris" })!;
    expect(prompt).toContain("## Desktop Control");
    expect(prompt).toContain("Accessibility APIs");
  });

  it("file message → file domain → file prompt", () => {
    const domain = classifyCentrisIntent("read file ~/Documents/notes.txt");
    expect(domain).toBe("file");
    const prompt = buildCentrisSystemPrompt({ domain, profileName: "centris" })!;
    expect(prompt).toContain("## File & System Operations");
    expect(prompt).toContain("exec: Run shell commands");
  });

  it("ambiguous message → general domain → general prompt", () => {
    const domain = classifyCentrisIntent("hello what can you do");
    expect(domain).toBe("general");
    const prompt = buildCentrisSystemPrompt({ domain, profileName: "centris" })!;
    expect(prompt).toContain("## Capabilities");
  });
});

// ─── Router + tool filtering integration ──────────────────────────────────

describe("router → tool filtering integration", () => {
  const allTools = [
    { name: "centris_browser" },
    { name: "centris_computer" },
    { name: "read" },
    { name: "write" },
    { name: "edit" },
    { name: "apply_patch" },
    { name: "exec" },
    { name: "web_search" },
    { name: "web_fetch" },
    { name: "tts" },
    { name: "cron" },
    { name: "session_status" },
    { name: "browser" },
  ];

  it("browser domain: only browser + web tools (saves ~60% of tool schema tokens)", () => {
    const messages = [{ role: "user", content: "go to youtube" }];
    const filtered = applyCentrisRouting(allTools, messages, "centris");
    const names = new Set(filtered.map((t) => t.name));

    // Should have: centris_browser, web_search, web_fetch, tts
    expect(names.size).toBe(4);
    expect(names.has("centris_browser")).toBe(true);
    expect(names.has("web_search")).toBe(true);
    expect(names.has("web_fetch")).toBe(true);
    expect(names.has("tts")).toBe(true);

    // Tool schema token savings: 4/13 tools = ~69% reduction
    const savings = 1 - filtered.length / allTools.length;
    expect(savings).toBeGreaterThan(0.5);
  });

  it("computer domain: only computer + tts (saves ~85% of tool schema tokens)", () => {
    const messages = [{ role: "user", content: "open finder" }];
    const filtered = applyCentrisRouting(allTools, messages, "centris");
    const names = new Set(filtered.map((t) => t.name));

    expect(names.size).toBe(2);
    expect(names.has("centris_computer")).toBe(true);
    expect(names.has("tts")).toBe(true);

    const savings = 1 - filtered.length / allTools.length;
    expect(savings).toBeGreaterThan(0.8);
  });

  it("file domain: only file tools + exec + tts (saves ~54% of tool schema tokens)", () => {
    const messages = [{ role: "user", content: "read file config.json" }];
    const filtered = applyCentrisRouting(allTools, messages, "centris");
    const names = new Set(filtered.map((t) => t.name));

    expect(names.size).toBe(6);
    expect(names.has("read")).toBe(true);
    expect(names.has("write")).toBe(true);
    expect(names.has("edit")).toBe(true);
    expect(names.has("apply_patch")).toBe(true);
    expect(names.has("exec")).toBe(true);
    expect(names.has("tts")).toBe(true);
  });
});

// ─── Context pruning effectiveness ─────────────────────────────────────────

describe("context pruning effectiveness", () => {
  it("compactStaleSnapshots clears all old messages between commands", () => {
    const messages: Array<{
      role: string;
      toolName?: string;
      content?: Array<{ type: string; text?: string }>;
    }> = [{ role: "user" }];

    for (let i = 0; i < 10; i++) {
      messages.push({ role: "assistant" });
      messages.push({
        role: "toolResult",
        content: [{ type: "text", text: `snapshot result from turn ${i}` }],
      });
    }

    expect(messages.length).toBe(21);

    const removed = compactStaleSnapshots(messages, "centris");
    expect(removed).toBe(21);
    expect(messages.length).toBe(0);
  });

  it("compactCentrisContext compresses old tool results, keeps latest full", () => {
    const snapshotText = JSON.stringify({
      url: "https://example.com",
      interactiveNodes: Array.from({ length: 40 }, (_, i) => ({
        id: i,
        type: "button",
        name: `Element ${i}`,
      })),
    });

    const messages: Array<{
      role: string;
      content?: Array<{ type: string; text?: string }>;
    }> = [{ role: "user" }];

    for (let i = 0; i < 5; i++) {
      messages.push({ role: "assistant" });
      messages.push({
        role: "toolResult",
        content: [{ type: "text", text: snapshotText }],
      });
    }

    const compacted = compactCentrisContext(messages);

    // All messages are preserved (same count), but old tool results are compressed
    expect(compacted.length).toBe(messages.length);

    // Latest tool result should keep its full content
    const latestToolResult = compacted[compacted.length - 1];
    expect(latestToolResult.role).toBe("toolResult");
    expect(latestToolResult.content?.[0]?.text?.length).toBeGreaterThan(100);

    // Old tool results should be compressed (tiny summaries)
    const oldToolResults = compacted.filter(
      (m, idx) => m.role === "toolResult" && idx < compacted.length - 1,
    );
    for (const old of oldToolResults) {
      expect(old.content?.[0]?.text?.length).toBeLessThan(100);
    }
  });

  it("compactCentrisContext caps oversized latest tool result", () => {
    const hugeSnapshot = JSON.stringify({
      interactiveNodes: Array.from({ length: 500 }, (_, i) => ({
        id: i,
        type: "button",
        name: `Element ${i} with a very long name for testing purposes`,
      })),
    });

    const messages = [
      { role: "user" as const },
      { role: "assistant" as const },
      {
        role: "toolResult" as const,
        content: [{ type: "text" as const, text: hugeSnapshot }],
      },
    ];

    const compacted = compactCentrisContext(messages);

    const text = compacted[2].content?.[0]?.text ?? "";
    expect(text.length).toBeLessThanOrEqual(4000 + "...[truncated]".length);
  });

  it("calculates token savings from intra-command compaction", () => {
    const snapshotText = "x".repeat(2000);
    const messages: Array<{
      role: string;
      content?: Array<{ type: string; text?: string }>;
    }> = [{ role: "user" }];
    for (let i = 0; i < 5; i++) {
      messages.push({ role: "assistant" });
      messages.push({
        role: "toolResult",
        content: [{ type: "text", text: snapshotText }],
      });
    }

    const totalCharsBefore = messages
      .filter((m) => m.role === "toolResult")
      .reduce((sum, m) => sum + (m.content?.[0]?.text?.length ?? 0), 0);

    const compacted = compactCentrisContext(messages);

    const totalCharsAfter = compacted
      .filter((m) => m.role === "toolResult")
      .reduce((sum, m) => sum + (m.content?.[0]?.text?.length ?? 0), 0);

    // 5 turns * 2000 chars = 10,000 before
    expect(totalCharsBefore).toBe(10_000);
    // After: 4 compressed (~40 chars each) + 1 full (2000) ≈ 2160
    expect(totalCharsAfter).toBeLessThan(2500);
    const savings = 1 - totalCharsAfter / totalCharsBefore;
    // 4 old tool results compressed from 2000 chars each to ~40 chars = ~7840 chars saved
    expect(savings).toBeGreaterThanOrEqual(0.75);
  });
});
