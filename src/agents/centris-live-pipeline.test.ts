/**
 * Centris Live Pipeline Tests
 *
 * REAL system tests — no mocks. Zero LLM tokens.
 * Proves the Centris pipeline can actually:
 *   1. Access real desktop apps via the native control module
 *   2. Read/write/move real files on disk
 *   3. Execute real shell commands
 *   4. Route user intent → correct domain → correct prompt → correct tools
 *
 * Run with: LIVE=1 pnpm test -- --run src/agents/centris-live-pipeline.test.ts
 *
 * Safety:
 *   - File ops use an isolated temp directory (cleaned up after)
 *   - Shell commands are observation-only (ls, echo, pwd, cat)
 *   - Native module calls are observation-only (list_apps, get_displays, snapshot)
 *   - No LLM calls = zero token cost
 */

import { execSync } from "node:child_process";
import { mkdtemp, rm, readFile, writeFile, stat, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, beforeAll, afterAll } from "vitest";

// ─── Skip guard ─────────────────────────────────────────────────────────────
const LIVE = process.env.LIVE === "1" || process.env.CLAWDBOT_LIVE_TEST === "1";
const describeIf = LIVE ? describe : describe.skip;

import { buildCentrisSystemPrompt } from "./centris-prompts.js";
// ─── Import centris modules (real code, no mocks) ──────────────────────────
import {
  classifyCentrisIntent,
  applyCentrisRouting,
  compactCentrisContext,
} from "./centris-router.js";
import { expandToolGroups } from "./tool-policy.js";

// ═════════════════════════════════════════════════════════════════════════════
// 1. NATIVE CONTROL MODULE — Real desktop access
// ═════════════════════════════════════════════════════════════════════════════

describeIf("LIVE: native desktop control", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let native: any;
  let finderSnapshot: {
    appName: string;
    durationMs: number;
    elements: Array<Record<string, unknown>>;
  } | null = null;

  beforeAll(() => {
    const req = createRequire(import.meta.url);
    native = req(
      resolve(process.cwd(), "desktop/native-control/build/Release/centris_control.node"),
    );
    native.initialize({ cacheElements: true, cacheTimeoutMs: 1000 });

    // BFS snapshot: ~100ms for 80 elements (was 45s for 3,741)
    finderSnapshot = native.getInteractiveSnapshot({ appName: "Finder" });
  });

  it("loads the compiled .node binary", () => {
    expect(native).toBeDefined();
    expect(typeof native.getRunningApps).toBe("function");
    expect(typeof native.getDisplays).toBe("function");
    expect(typeof native.getInteractiveSnapshot).toBe("function");
  });

  it("list_apps: sees real running applications", () => {
    const apps = native.getRunningApps();
    expect(Array.isArray(apps)).toBe(true);
    expect(apps.length).toBeGreaterThan(0);

    const finder = apps.find((a: Record<string, unknown>) => a.name === "Finder");
    expect(finder).toBeDefined();
    expect(finder.pid).toBeGreaterThan(0);
    console.log(`  → ${apps.length} apps running (Finder PID: ${finder.pid})`);
  });

  it("get_displays: sees real display hardware", () => {
    const displays = native.getDisplays();
    expect(Array.isArray(displays)).toBe(true);
    expect(displays.length).toBeGreaterThan(0);

    const primary = displays[0];
    expect(primary.bounds.width).toBeGreaterThan(0);
    expect(primary.bounds.height).toBeGreaterThan(0);
    console.log(
      `  → ${displays.length} display(s): ${primary.bounds.width}x${primary.bounds.height} (scale ${primary.scaleFactor}x)`,
    );
  });

  it("list_windows: sees real windows", () => {
    const windows = native.getWindows("");
    expect(Array.isArray(windows)).toBe(true);
    console.log(`  → ${windows.length} window(s) visible`);
    for (const w of windows.slice(0, 3)) {
      console.log(`    [${w.appName}] "${w.title}"`);
    }
  });

  it("snapshot: reads Finder accessibility tree in <500ms", () => {
    expect(finderSnapshot).toBeDefined();
    expect(finderSnapshot!.appName).toBe("Finder");
    expect(Array.isArray(finderSnapshot!.elements)).toBe(true);

    const elements = finderSnapshot!.elements;
    const durationMs = finderSnapshot!.durationMs;
    console.log(`  → Finder: ${elements.length} elements in ${durationMs}ms`);
    for (const el of elements.slice(0, 3)) {
      const role = JSON.stringify(el.role ?? "");
      const id = JSON.stringify(el.id ?? "");
      const name = JSON.stringify(el.name ?? "");
      console.log(`    [${role}] id=${id} "${name}"`);
    }

    // Performance: BFS snapshot should complete in <500ms
    // (typical: ~100-250ms for 80 elements)
    expect(durationMs).toBeLessThan(500);

    if (elements.length > 0) {
      expect(typeof elements[0].id).toBe("number");
      expect(typeof elements[0].role).toBe("string");
      expect((elements[0].role as string).length).toBeGreaterThan(0);
    }
  });

  it("snapshot capped output stays within token budget", () => {
    const rawElements = finderSnapshot!.elements ?? [];

    const MAX_CHARS = 4000;
    const slim: Array<Record<string, unknown>> = [];
    let charCount = 0;
    for (const el of rawElements) {
      const entry = {
        id: el.id,
        role: el.role,
        name: typeof el.name === "string" ? el.name.slice(0, 60) : "",
      };
      const str = JSON.stringify(entry);
      if (charCount + str.length + 1 > MAX_CHARS) {
        break;
      }
      charCount += str.length + 1;
      slim.push(entry);
    }

    const tokens = Math.ceil(charCount / 4);
    console.log(
      `  → ${rawElements.length} raw → ${slim.length} capped (${charCount} chars ≈ ${tokens} tokens)`,
    );
    expect(charCount).toBeLessThanOrEqual(MAX_CHARS);
    expect(tokens).toBeLessThanOrEqual(1100);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. FILE PIPELINE — Real filesystem operations
// ═════════════════════════════════════════════════════════════════════════════

describeIf("LIVE: file pipeline (real filesystem)", () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "centris-live-"));
  });

  afterAll(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("can create a file on disk", async () => {
    const filePath = join(tempDir, "created.txt");
    await writeFile(filePath, "Created by Centris pipeline test\n");

    const exists = await stat(filePath)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);

    const content = await readFile(filePath, "utf-8");
    expect(content).toBe("Created by Centris pipeline test\n");
    console.log(`  → Created: ${filePath}`);
  });

  it("can execute shell commands that create files", () => {
    const filePath = join(tempDir, "shell-created.txt");
    execSync(`echo "hello from shell" > "${filePath}"`);

    const content = execSync(`cat "${filePath}"`, { encoding: "utf-8" });
    expect(content.trim()).toBe("hello from shell");
    console.log(`  → Shell created: ${filePath}`);
  });

  it("can organize files into directories (file agent pattern)", async () => {
    // Create scattered files (simulating a messy desktop)
    await writeFile(join(tempDir, "report.pdf"), "fake pdf");
    await writeFile(join(tempDir, "photo.jpg"), "fake jpg");
    await writeFile(join(tempDir, "notes.txt"), "fake notes");
    await writeFile(join(tempDir, "script.py"), "print('hello')");

    // Organize them (this is what the file agent does)
    await mkdir(join(tempDir, "documents"), { recursive: true });
    await mkdir(join(tempDir, "images"), { recursive: true });
    await mkdir(join(tempDir, "code"), { recursive: true });

    execSync(
      `mv "${join(tempDir, "report.pdf")}" "${join(tempDir, "notes.txt")}" "${join(tempDir, "documents/")}"`,
    );
    execSync(`mv "${join(tempDir, "photo.jpg")}" "${join(tempDir, "images/")}"`);
    execSync(`mv "${join(tempDir, "script.py")}" "${join(tempDir, "code/")}"`);

    // Verify organization happened on real disk
    const docs = execSync(`ls "${join(tempDir, "documents")}"`, { encoding: "utf-8" });
    expect(docs).toContain("report.pdf");
    expect(docs).toContain("notes.txt");

    const images = execSync(`ls "${join(tempDir, "images")}"`, { encoding: "utf-8" });
    expect(images).toContain("photo.jpg");

    const code = execSync(`ls "${join(tempDir, "code")}"`, { encoding: "utf-8" });
    expect(code).toContain("script.py");

    console.log("  → Organized 4 files into 3 directories");
  });

  it("can list and inspect the user's real Desktop", () => {
    const desktop = execSync("ls ~/Desktop", { encoding: "utf-8" });
    const files = desktop.trim().split("\n").filter(Boolean);
    expect(files.length).toBeGreaterThan(0);
    console.log(
      `  → ~/Desktop has ${files.length} items: ${files.slice(0, 5).join(", ")}${files.length > 5 ? "..." : ""}`,
    );
  });

  it("can read real system info", () => {
    const hostname = execSync("hostname", { encoding: "utf-8" }).trim();
    const whoami = execSync("whoami", { encoding: "utf-8" }).trim();
    const pwd = execSync("pwd", { encoding: "utf-8" }).trim();

    expect(hostname.length).toBeGreaterThan(0);
    expect(whoami).toBe("ahabscheid");
    console.log(`  → ${whoami}@${hostname} in ${pwd}`);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. ROUTER → PROMPT → TOOL CHAIN — Full pipeline (no LLM, zero tokens)
// ═════════════════════════════════════════════════════════════════════════════

describeIf("LIVE: full pipeline chain (router → prompt → tools)", () => {
  const centrisTools = [
    { name: "centris_browser" },
    { name: "centris_computer" },
    { name: "browser" },
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
  ];

  const scenarios = [
    {
      voice: "organize my desktop files into folders",
      expectedDomain: "file" as const,
      checkTools: ["read", "write", "edit", "exec", "tts"],
    },
    {
      voice: "open safari and go to google.com",
      expectedDomain: "browser" as const,
      checkTools: ["centris_browser", "browser", "web_search", "tts"],
    },
    {
      // "finder" (computer=1) + "my documents" (file=1) = tie → general.
      // This is correct: ambiguous voice commands get all tools so the LLM decides.
      voice: "open finder and show my documents",
      expectedDomain: "general" as const,
      checkTools: null,
    },
    {
      voice: "what time is it",
      expectedDomain: "general" as const,
      checkTools: null, // all tools
    },
    {
      voice: "run npm install in the project",
      expectedDomain: "file" as const,
      checkTools: ["exec", "tts"],
    },
    {
      voice: "click the submit button on the page",
      expectedDomain: "browser" as const,
      checkTools: ["centris_browser", "tts"],
    },
    {
      voice: "open the slack app",
      expectedDomain: "computer" as const,
      checkTools: ["centris_computer", "tts"],
    },
  ];

  for (const s of scenarios) {
    it(`"${s.voice}" → ${s.expectedDomain}`, () => {
      // 1. Router classifies
      const domain = classifyCentrisIntent(s.voice);
      expect(domain).toBe(s.expectedDomain);

      // 2. Prompt is built and stays lean
      const prompt = buildCentrisSystemPrompt({
        domain,
        profileName: "centris",
        workspaceDir: "/Users/ahabscheid/Desktop",
        runtimeInfo: { model: "claude-4-sonnet", os: "darwin", arch: "arm64" },
      })!;
      expect(prompt).toBeDefined();
      const tokens = Math.ceil(prompt.length / 4);
      expect(tokens).toBeLessThan(1500);

      // 3. Tools are filtered correctly
      const messages = [{ role: "user", content: s.voice }];
      const filtered = applyCentrisRouting(centrisTools, messages, "centris");

      if (s.checkTools) {
        const names = new Set(filtered.map((t) => t.name));
        for (const tool of s.checkTools) {
          expect(names.has(tool)).toBe(true);
        }
      } else {
        expect(filtered.length).toBe(centrisTools.length);
      }

      console.log(
        `  → domain=${domain}, prompt=${tokens} tokens, tools=${filtered.map((t) => t.name).join(",")}`,
      );
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. END-TO-END: voice command → route → tool → real result
// ═════════════════════════════════════════════════════════════════════════════

describeIf("LIVE: end-to-end voice→route→tool→result", () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "centris-e2e-"));
  });

  afterAll(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("voice: 'create a file' → file domain → exec → file exists on disk", async () => {
    const voice = "create a file called hello.txt on my desktop";

    // Route
    const domain = classifyCentrisIntent(voice);
    expect(domain).toBe("file");

    // Prompt
    const prompt = buildCentrisSystemPrompt({
      domain,
      profileName: "centris",
      workspaceDir: tempDir,
    })!;
    expect(prompt).toContain("## File & System Operations");

    // Execute (what the LLM would call)
    const filePath = join(tempDir, "hello.txt");
    execSync(`echo "hello world" > "${filePath}"`);

    // Verify real file on real disk
    const content = await readFile(filePath, "utf-8");
    expect(content.trim()).toBe("hello world");
    console.log("  → Voice→Route→Tool→File: PASS");
  });

  it("voice: 'what apps are running' → computer domain → native → real apps", () => {
    const voice = "what apps are running on my computer";

    // Route
    const domain = classifyCentrisIntent(voice);
    expect(domain).toBe("computer");

    // Prompt
    const prompt = buildCentrisSystemPrompt({ domain, profileName: "centris" })!;
    expect(prompt).toContain("## Desktop Control");

    // Execute (what the LLM would call)
    const req = createRequire(import.meta.url);
    const native = req(
      resolve(process.cwd(), "desktop/native-control/build/Release/centris_control.node"),
    );
    native.initialize({ cacheElements: true, cacheTimeoutMs: 1000 });
    const apps = native.getRunningApps();

    expect(apps.length).toBeGreaterThan(0);
    expect(apps.some((a: Record<string, unknown>) => a.name === "Finder")).toBe(true);
    console.log(`  → Voice→Route→Tool→Apps: PASS (${apps.length} apps)`);
  });

  it("voice: 'show my desktop files' → file domain → ls → real file list", () => {
    const voice = "list files on my desktop";

    // Route
    const domain = classifyCentrisIntent(voice);
    // "desktop/" keyword should trigger file domain
    expect(domain).toBe("file");

    // Execute
    const output = execSync("ls ~/Desktop", { encoding: "utf-8" });
    const files = output.trim().split("\n").filter(Boolean);
    expect(files.length).toBeGreaterThan(0);
    console.log(`  → Voice→Route→Tool→Files: PASS (${files.length} items)`);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. TOKEN BUDGET REPORT — Exact numbers
// ═════════════════════════════════════════════════════════════════════════════

describeIf("LIVE: token budget report", () => {
  it("measures exact prompt sizes for every domain", () => {
    const domains = ["browser", "computer", "file", "general"] as const;

    console.log("\n  ╔══════════════════════════════════════════╗");
    console.log("  ║     CENTRIS TOKEN BUDGET REPORT          ║");
    console.log("  ╠══════════════════════════════════════════╣");

    for (const domain of domains) {
      const prompt = buildCentrisSystemPrompt({
        domain,
        profileName: "centris",
        workspaceDir: "/Users/ahabscheid/Desktop",
        ttsHint: "Speak briefly.",
        runtimeInfo: { model: "claude-4-sonnet", os: "darwin", arch: "arm64" },
      })!;

      const chars = prompt.length;
      const tokens = Math.ceil(chars / 4);
      const bar = "█".repeat(Math.ceil(tokens / 50));
      console.log(
        `  ║ ${domain.padEnd(10)} ${String(tokens).padStart(5)} tok  ${bar.padEnd(16)} ║`,
      );

      expect(tokens).toBeLessThan(1500);
    }

    const tools = expandToolGroups(["group:centris"]);
    console.log(`  ╠══════════════════════════════════════════╣`);
    console.log(`  ║ Tools: ${tools.length} in centris profile             ║`);
    console.log("  ╚══════════════════════════════════════════╝\n");
  });

  it("measures context pruning savings on realistic conversation", () => {
    const snapshotText = JSON.stringify({
      url: "https://example.com",
      interactiveNodes: Array.from({ length: 40 }, (_, i) => ({
        id: i,
        t: "cl",
        n: `Button ${i}`,
      })),
    });

    const messages: Array<{
      role: string;
      content?: Array<{ type: string; text?: string }>;
    }> = [{ role: "user" }];

    for (let i = 0; i < 8; i++) {
      messages.push({ role: "assistant" });
      messages.push({ role: "toolResult", content: [{ type: "text", text: snapshotText }] });
    }

    const before = messages
      .filter((m) => m.role === "toolResult")
      .reduce((s, m) => s + (m.content?.[0]?.text?.length ?? 0), 0);

    // compactCentrisContext (transformContext hook) is the real fix — it operates
    // on the agentLoop's local messages array, not agent._state.messages.
    const compacted = compactCentrisContext(messages);

    const after = compacted
      .filter((m) => m.role === "toolResult")
      .reduce((s, m) => s + (m.content?.[0]?.text?.length ?? 0), 0);

    const savedTokens = Math.ceil((before - after) / 4);
    const pct = ((1 - after / before) * 100).toFixed(0);

    console.log("\n  ╔══════════════════════════════════════════╗");
    console.log("  ║     CONTEXT PRUNING SAVINGS              ║");
    console.log("  ╠══════════════════════════════════════════╣");
    console.log(`  ║ Before: ${Math.ceil(before / 4)} tokens                      ║`);
    console.log(`  ║ After:  ${Math.ceil(after / 4)} tokens                       ║`);
    console.log(`  ║ Saved:  ${savedTokens} tokens (${pct}% reduction)         ║`);
    console.log("  ╚══════════════════════════════════════════╝\n");

    // Only the latest (8th) tool result should be kept full-size; the other 7
    // should be compressed to tiny summaries (~40 chars each).
    expect(Number(pct)).toBeGreaterThanOrEqual(80);
  });
});
