import { describe, expect, it, vi } from "vitest";
import { buildCentrisSystemPrompt } from "./centris-prompts.js";

// Mock buildRuntimeLine since it has complex deps
vi.mock("./system-prompt.js", () => ({
  buildRuntimeLine: vi.fn(
    (info: Record<string, string>) =>
      `Runtime: model=${info.model ?? "unknown"} os=${info.os ?? "unknown"}`,
  ),
}));

// ─── Non-centris profiles ───────────────────────────────────────────────────

describe("buildCentrisSystemPrompt", () => {
  it("returns undefined when profileName is not centris", () => {
    expect(buildCentrisSystemPrompt({ domain: "general", profileName: "full" })).toBeUndefined();
    expect(buildCentrisSystemPrompt({ domain: "browser", profileName: "coding" })).toBeUndefined();
    expect(buildCentrisSystemPrompt({ domain: "file", profileName: "minimal" })).toBeUndefined();
  });

  it("returns undefined when profileName is undefined", () => {
    expect(buildCentrisSystemPrompt({ domain: "general" })).toBeUndefined();
  });

  // ─── Core structure ───────────────────────────────────────────────────────

  it("always includes Centris identity", () => {
    const prompt = buildCentrisSystemPrompt({ domain: "general", profileName: "centris" });
    expect(prompt).toBeDefined();
    expect(prompt).toContain("You are Centris, a voice-controlled computer assistant");
    expect(prompt).toContain("ALWAYS use tools");
    expect(prompt).toContain("NEVER apologize or narrate");
  });

  it("always includes Tool Call Style section", () => {
    const prompt = buildCentrisSystemPrompt({ domain: "general", profileName: "centris" })!;
    expect(prompt).toContain("## Tool Call Style");
    expect(prompt).toContain("do not narrate routine");
  });

  it("always includes Safety section", () => {
    const prompt = buildCentrisSystemPrompt({ domain: "general", profileName: "centris" })!;
    expect(prompt).toContain("## Safety");
    expect(prompt).toContain("no independent goals");
    expect(prompt).toContain("human oversight");
  });

  it("always includes Silent Replies section", () => {
    const prompt = buildCentrisSystemPrompt({ domain: "general", profileName: "centris" })!;
    expect(prompt).toContain("## Silent Replies");
    expect(prompt).toContain("NO_REPLY");
  });

  // ─── Domain-specific instructions ─────────────────────────────────────────

  it("includes browser instructions for browser domain", () => {
    const prompt = buildCentrisSystemPrompt({ domain: "browser", profileName: "centris" })!;
    expect(prompt).toContain("## Browser Control");
    expect(prompt).toContain("navigate:");
    expect(prompt).toContain("click:");
    expect(prompt).toContain("CRITICAL");
    // Should NOT contain other domain instructions
    expect(prompt).not.toContain("## Desktop Control");
    expect(prompt).not.toContain("## File & System Operations");
  });

  it("includes computer instructions for computer domain", () => {
    const prompt = buildCentrisSystemPrompt({ domain: "computer", profileName: "centris" })!;
    expect(prompt).toContain("## Desktop Control");
    expect(prompt).toContain("Accessibility APIs");
    expect(prompt).toContain("centris_computer: 18 actions");
    expect(prompt).not.toContain("## Browser Control");
    expect(prompt).not.toContain("## File & System Operations");
  });

  it("includes file instructions for file domain", () => {
    const prompt = buildCentrisSystemPrompt({ domain: "file", profileName: "centris" })!;
    expect(prompt).toContain("## File & System Operations");
    expect(prompt).toContain("read: Read file contents");
    expect(prompt).toContain("exec: Run shell commands");
    expect(prompt).not.toContain("## Browser Control");
    expect(prompt).not.toContain("## Desktop Control");
  });

  it("includes general instructions for general domain", () => {
    const prompt = buildCentrisSystemPrompt({ domain: "general", profileName: "centris" })!;
    expect(prompt).toContain("## Capabilities");
    expect(prompt).toContain("centris_browser");
    expect(prompt).toContain("centris_computer");
    expect(prompt).toContain("read/write/edit/exec");
  });

  // ─── Optional sections ────────────────────────────────────────────────────

  it("includes skills section when skillsPrompt is provided", () => {
    const prompt = buildCentrisSystemPrompt({
      domain: "general",
      profileName: "centris",
      skillsPrompt: "<available_skills>test skill</available_skills>",
    })!;
    expect(prompt).toContain("## Skills (mandatory)");
    expect(prompt).toContain("test skill");
  });

  it("omits skills section when skillsPrompt is empty", () => {
    const prompt = buildCentrisSystemPrompt({
      domain: "general",
      profileName: "centris",
      skillsPrompt: "",
    })!;
    expect(prompt).not.toContain("## Skills");
  });

  it("omits skills section when skillsPrompt is whitespace", () => {
    const prompt = buildCentrisSystemPrompt({
      domain: "general",
      profileName: "centris",
      skillsPrompt: "   ",
    })!;
    expect(prompt).not.toContain("## Skills");
  });

  it("includes TTS hint when provided", () => {
    const prompt = buildCentrisSystemPrompt({
      domain: "general",
      profileName: "centris",
      ttsHint: "Speak briefly.",
    })!;
    expect(prompt).toContain("## Voice");
    expect(prompt).toContain("Speak briefly.");
  });

  it("omits TTS section when ttsHint is empty", () => {
    const prompt = buildCentrisSystemPrompt({
      domain: "general",
      profileName: "centris",
      ttsHint: "",
    })!;
    expect(prompt).not.toContain("## Voice");
  });

  it("includes workspace when provided", () => {
    const prompt = buildCentrisSystemPrompt({
      domain: "general",
      profileName: "centris",
      workspaceDir: "/home/user/project",
    })!;
    expect(prompt).toContain("## Workspace");
    expect(prompt).toContain("/home/user/project");
  });

  it("omits workspace when not provided", () => {
    const prompt = buildCentrisSystemPrompt({
      domain: "general",
      profileName: "centris",
    })!;
    expect(prompt).not.toContain("## Workspace");
  });

  it("includes heartbeat section when heartbeatPrompt provided", () => {
    const prompt = buildCentrisSystemPrompt({
      domain: "general",
      profileName: "centris",
      heartbeatPrompt: "Check server status every 5 minutes",
    })!;
    expect(prompt).toContain("## Heartbeats");
    expect(prompt).toContain("Check server status every 5 minutes");
    expect(prompt).toContain("HEARTBEAT_OK");
  });

  it("omits heartbeat section when heartbeatPrompt empty", () => {
    const prompt = buildCentrisSystemPrompt({
      domain: "general",
      profileName: "centris",
      heartbeatPrompt: "",
    })!;
    expect(prompt).not.toContain("## Heartbeats");
  });

  it("includes runtime line when runtimeInfo provided", () => {
    const prompt = buildCentrisSystemPrompt({
      domain: "general",
      profileName: "centris",
      runtimeInfo: {
        model: "claude-4-sonnet",
        os: "darwin",
        arch: "arm64",
      },
    })!;
    expect(prompt).toContain("## Runtime");
    expect(prompt).toContain("claude-4-sonnet");
  });

  it("omits runtime section when runtimeInfo not provided", () => {
    const prompt = buildCentrisSystemPrompt({
      domain: "general",
      profileName: "centris",
    })!;
    expect(prompt).not.toContain("## Runtime");
  });

  // ─── Token budget sanity check ────────────────────────────────────────────

  it("produces a prompt under 3000 chars for minimal config", () => {
    const prompt = buildCentrisSystemPrompt({
      domain: "general",
      profileName: "centris",
    })!;
    // ~2000-2400 tokens ≈ ~8000-9600 chars. But without optional sections
    // it should be well under that.
    expect(prompt.length).toBeLessThan(3000);
  });

  it("produces a prompt under 5000 chars even with all sections", () => {
    const prompt = buildCentrisSystemPrompt({
      domain: "browser",
      profileName: "centris",
      workspaceDir: "/home/user/project",
      skillsPrompt: "<skills>test</skills>",
      ttsHint: "Speak briefly",
      heartbeatPrompt: "Check stuff",
      runtimeInfo: { model: "test-model", os: "darwin" },
    })!;
    // Even fully loaded, the Centris prompt should be lean
    expect(prompt.length).toBeLessThan(5000);
  });

  // ─── Section ordering ─────────────────────────────────────────────────────

  it("places identity before domain instructions before safety", () => {
    const prompt = buildCentrisSystemPrompt({
      domain: "browser",
      profileName: "centris",
    })!;
    const identityIdx = prompt.indexOf("You are Centris");
    const domainIdx = prompt.indexOf("## Browser Control");
    const toolCallIdx = prompt.indexOf("## Tool Call Style");
    const safetyIdx = prompt.indexOf("## Safety");
    const silentIdx = prompt.indexOf("## Silent Replies");

    expect(identityIdx).toBeLessThan(domainIdx);
    expect(domainIdx).toBeLessThan(toolCallIdx);
    expect(toolCallIdx).toBeLessThan(safetyIdx);
    expect(safetyIdx).toBeLessThan(silentIdx);
  });
});
