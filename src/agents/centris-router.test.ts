import { describe, expect, it, vi } from "vitest";
import { SILENT_REPLY_TOKEN } from "../auto-reply/tokens.js";
import {
  classifyCentrisIntent,
  applyCentrisRouting,
  compactStaleSnapshots,
  detectSingleToolDone,
} from "./centris-router.js";

// Suppress log noise from router
vi.mock("../logger.js", () => ({
  logInfo: vi.fn(),
  logDebug: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

// ─── classifyCentrisIntent ──────────────────────────────────────────────────

describe("classifyCentrisIntent", () => {
  // ── Browser domain ──────────────────────────────────────────────────────
  it("classifies navigation keywords as browser", () => {
    expect(classifyCentrisIntent("go to google.com")).toBe("browser");
    expect(classifyCentrisIntent("navigate to the dashboard")).toBe("browser");
    expect(classifyCentrisIntent("open url https://example.com")).toBe("browser");
  });

  it("classifies web services as browser", () => {
    expect(classifyCentrisIntent("check my gmail")).toBe("browser");
    expect(classifyCentrisIntent("open youtube")).toBe("browser");
    expect(classifyCentrisIntent("look at reddit")).toBe("browser");
    expect(classifyCentrisIntent("check github issues")).toBe("browser");
  });

  it("classifies web actions as browser", () => {
    expect(classifyCentrisIntent("click on the submit button")).toBe("browser");
    expect(classifyCentrisIntent("fill out the login form")).toBe("browser");
    expect(classifyCentrisIntent("search the web for typescript docs")).toBe("browser");
    expect(classifyCentrisIntent("log in to my account")).toBe("browser");
  });

  it("classifies page interaction as browser", () => {
    expect(classifyCentrisIntent("scroll down the page")).toBe("browser");
    expect(classifyCentrisIntent("take a snapshot of the page")).toBe("browser");
    expect(classifyCentrisIntent("read the page content")).toBe("browser");
    expect(classifyCentrisIntent("what's on the page")).toBe("browser");
  });

  it("classifies browser-specific phrases as browser", () => {
    expect(classifyCentrisIntent("open a new tab")).toBe("browser");
    expect(classifyCentrisIntent("switch tab to the dashboard")).toBe("browser");
    expect(classifyCentrisIntent("in chrome, click the button")).toBe("browser");
  });

  // ── Computer domain ─────────────────────────────────────────────────────
  it("classifies app management as computer", () => {
    expect(classifyCentrisIntent("open app Finder")).toBe("computer");
    expect(classifyCentrisIntent("launch app Safari")).toBe("computer");
    expect(classifyCentrisIntent("quit app Preview")).toBe("computer");
    expect(classifyCentrisIntent("force quit the application")).toBe("computer");
  });

  it("classifies native apps as computer", () => {
    expect(classifyCentrisIntent("open finder")).toBe("computer");
    expect(classifyCentrisIntent("check activity monitor")).toBe("computer");
    expect(classifyCentrisIntent("open system settings")).toBe("computer");
    expect(classifyCentrisIntent("open xcode project")).toBe("computer");
  });

  it("classifies window management as computer", () => {
    expect(classifyCentrisIntent("minimize the window")).toBe("computer");
    expect(classifyCentrisIntent("resize window to 800x600")).toBe("computer");
    expect(classifyCentrisIntent("move window to the left")).toBe("computer");
    expect(classifyCentrisIntent("full screen mode")).toBe("computer");
  });

  it("classifies keyboard shortcuts as computer", () => {
    expect(classifyCentrisIntent("press cmd+c to copy")).toBe("computer");
    expect(classifyCentrisIntent("use ctrl+shift+n")).toBe("computer");
    expect(classifyCentrisIntent("select all and copy paste")).toBe("computer");
  });

  it("classifies system queries as computer", () => {
    expect(classifyCentrisIntent("what apps are running")).toBe("computer");
    expect(classifyCentrisIntent("check the display resolution")).toBe("computer");
    expect(classifyCentrisIntent("turn up the volume")).toBe("computer");
  });

  // ── File domain ─────────────────────────────────────────────────────────
  it("classifies file operations as file", () => {
    expect(classifyCentrisIntent("read file config.json")).toBe("file");
    expect(classifyCentrisIntent("write file output.txt")).toBe("file");
    expect(classifyCentrisIntent("edit the file please")).toBe("file");
    expect(classifyCentrisIntent("create a file named test.py")).toBe("file");
    expect(classifyCentrisIntent("delete file temp.log")).toBe("file");
  });

  it("classifies directory operations as file", () => {
    expect(classifyCentrisIntent("list directory contents")).toBe("file");
    expect(classifyCentrisIntent("create folder images")).toBe("file");
    expect(classifyCentrisIntent("show files in the directory")).toBe("file");
  });

  it("classifies file type mentions as file", () => {
    expect(classifyCentrisIntent("open the .json config")).toBe("file");
    expect(classifyCentrisIntent("check the .py script")).toBe("file");
    expect(classifyCentrisIntent("update the .yaml file")).toBe("file");
  });

  it("classifies file path mentions as file", () => {
    expect(classifyCentrisIntent("read ~/Documents/notes.txt")).toBe("file");
    expect(classifyCentrisIntent("check /users/me/project")).toBe("file");
    expect(classifyCentrisIntent("save to desktop/ folder")).toBe("file");
  });

  it("classifies shell commands as file", () => {
    expect(classifyCentrisIntent("run command git status")).toBe("file");
    expect(classifyCentrisIntent("execute script deploy.sh")).toBe("file");
    expect(classifyCentrisIntent("pip install requests")).toBe("file");
    expect(classifyCentrisIntent("npm install express")).toBe("file");
  });

  // ── General domain (fallback) ───────────────────────────────────────────
  it("returns general for empty input", () => {
    expect(classifyCentrisIntent("")).toBe("general");
    expect(classifyCentrisIntent("   ")).toBe("general");
  });

  it("returns general for unrecognized queries", () => {
    expect(classifyCentrisIntent("what time is it")).toBe("general");
    expect(classifyCentrisIntent("tell me a joke")).toBe("general");
    expect(classifyCentrisIntent("hello")).toBe("general");
  });

  it("returns general when domains tie", () => {
    // "minimize" hits computer=1, "bookmark" hits browser=1 → tie → general
    expect(classifyCentrisIntent("minimize and bookmark")).toBe("general");
  });

  it("resolves slack app vs browser correctly with weighted keywords", () => {
    // "slack app" (weight 2) should beat "in the browser" (weight 1)
    expect(classifyCentrisIntent("open slack app")).toBe("computer");
    // Bare "slack" was removed from browser keywords to avoid ambiguity
    expect(classifyCentrisIntent("open slack in the browser")).toBe("browser");
  });

  // ── Case insensitivity ──────────────────────────────────────────────────
  it("is case-insensitive", () => {
    expect(classifyCentrisIntent("OPEN YOUTUBE")).toBe("browser");
    expect(classifyCentrisIntent("OPEN APP Finder")).toBe("computer");
    expect(classifyCentrisIntent("READ FILE config.json")).toBe("file");
  });
});

// ─── applyCentrisRouting ────────────────────────────────────────────────────

describe("applyCentrisRouting", () => {
  const mockTools = [
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

  it("returns all tools when profile is not centris", () => {
    const messages = [{ role: "user", content: "go to google" }];
    const result = applyCentrisRouting(mockTools, messages, "full");
    expect(result).toEqual(mockTools);
  });

  it("returns all tools when profile is undefined", () => {
    const messages = [{ role: "user", content: "go to google" }];
    const result = applyCentrisRouting(mockTools, messages);
    expect(result).toEqual(mockTools);
  });

  it("returns all tools when no user message exists", () => {
    const messages = [{ role: "assistant", content: "Hello" }];
    const result = applyCentrisRouting(mockTools, messages, "centris");
    expect(result).toEqual(mockTools);
  });

  it("filters to browser tools for browser domain", () => {
    const messages = [{ role: "user", content: "go to youtube" }];
    const result = applyCentrisRouting(mockTools, messages, "centris");
    const names = result.map((t) => t.name);
    expect(names).toContain("centris_browser");
    expect(names).toContain("tts");
    expect(names).not.toContain("web_search");
    expect(names).not.toContain("web_fetch");
    // "browser" (playwright fallback) is not in DOMAIN_TOOLS.browser — only centris_browser is
    expect(names).not.toContain("centris_computer");
    expect(names).not.toContain("read");
    expect(names).not.toContain("exec");
  });

  it("filters to computer tools for computer domain", () => {
    const messages = [{ role: "user", content: "open finder" }];
    const result = applyCentrisRouting(mockTools, messages, "centris");
    const names = result.map((t) => t.name);
    expect(names).toContain("centris_computer");
    expect(names).toContain("tts");
    expect(names).not.toContain("centris_browser");
    expect(names).not.toContain("read");
  });

  it("filters to file tools for file domain", () => {
    const messages = [{ role: "user", content: "read file config.json" }];
    const result = applyCentrisRouting(mockTools, messages, "centris");
    const names = result.map((t) => t.name);
    expect(names).toContain("read");
    expect(names).toContain("write");
    expect(names).toContain("edit");
    expect(names).toContain("exec");
    expect(names).toContain("tts");
    expect(names).not.toContain("centris_browser");
    expect(names).not.toContain("centris_computer");
  });

  it("returns all tools for general domain", () => {
    const messages = [{ role: "user", content: "hello there" }];
    const result = applyCentrisRouting(mockTools, messages, "centris");
    expect(result).toEqual(mockTools);
  });

  it("uses the LAST user message for routing", () => {
    const messages = [
      { role: "user", content: "open finder" }, // computer
      { role: "assistant", content: "ok" },
      { role: "user", content: "go to youtube" }, // browser — should use this
    ];
    const result = applyCentrisRouting(mockTools, messages, "centris");
    const names = result.map((t) => t.name);
    expect(names).toContain("centris_browser");
    expect(names).not.toContain("centris_computer");
  });
});

// ─── compactStaleSnapshots ──────────────────────────────────────────────────

describe("compactStaleSnapshots", () => {
  it("does nothing when profile is not centris", () => {
    const messages = [
      { role: "user" },
      { role: "assistant" },
      { role: "toolResult", content: [{ type: "text", text: "result" }] },
    ];
    const removed = compactStaleSnapshots(messages, "full");
    expect(removed).toBe(0);
    expect(messages).toHaveLength(3);
  });

  it("does nothing when profile is undefined", () => {
    const messages = [
      { role: "user" },
      { role: "assistant" },
      { role: "toolResult", content: [{ type: "text", text: "result" }] },
    ];
    const removed = compactStaleSnapshots(messages);
    expect(removed).toBe(0);
  });

  // Current behavior: compactStaleSnapshots clears ALL messages (clean slate)
  // because Centris is a voice assistant — each command is independent.
  // Old conversation history is pure waste, so everything gets nuked.

  it("clears all messages for centris profile (clean slate)", () => {
    const messages = [{ role: "user" }, { role: "assistant" }];
    const removed = compactStaleSnapshots(messages, "centris");
    expect(removed).toBe(2);
    expect(messages).toHaveLength(0);
  });

  it("clears messages including tool turns", () => {
    const messages = [
      { role: "user" },
      { role: "assistant" },
      { role: "toolResult", content: [{ type: "text", text: "result" }] },
    ];
    const removed = compactStaleSnapshots(messages, "centris");
    expect(removed).toBe(3);
    expect(messages).toHaveLength(0);
  });

  it("clears all turns, including multiple tool turns", () => {
    const messages = [
      { role: "user" },
      { role: "assistant" },
      { role: "toolResult", content: [{ type: "text", text: "old snapshot" }] },
      { role: "assistant" },
      { role: "toolResult", content: [{ type: "text", text: "new snapshot" }] },
    ];
    const removed = compactStaleSnapshots(messages, "centris");
    expect(removed).toBe(5);
    expect(messages).toHaveLength(0);
  });

  it("returns 0 for empty messages array", () => {
    const messages: Array<{ role: string }> = [];
    const removed = compactStaleSnapshots(messages, "centris");
    expect(removed).toBe(0);
    expect(messages).toHaveLength(0);
  });
});

describe("detectSingleToolDone", () => {
  it("returns NO_REPLY for successful single tts result", () => {
    const result = detectSingleToolDone([
      {
        role: "assistant",
        content: [{ type: "toolCall", toolName: "tts", args: { text: "hello" }, id: "t1" }],
      },
      {
        role: "toolResult",
        toolName: "tts",
        isError: false,
        content: [{ type: "text", text: "" }],
      },
    ]);
    expect(result).toBe(SILENT_REPLY_TOKEN);
  });

  it("returns Done for successful single non-tts tool result", () => {
    const result = detectSingleToolDone([
      {
        role: "assistant",
        content: [{ type: "toolCall", toolName: "exec", args: { cmd: "pwd" }, id: "t1" }],
      },
      {
        role: "toolResult",
        toolName: "exec",
        isError: false,
        content: [{ type: "text", text: "" }],
      },
    ]);
    expect(result).toBe("Done.");
  });
});
