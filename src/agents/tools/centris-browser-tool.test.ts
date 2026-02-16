import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the extension bridge BEFORE importing the tool.
// vi.mock is hoisted — references to outer variables fail. Use vi.hoisted().
const { mockConnected, mockSendCommand } = vi.hoisted(() => ({
  mockConnected: vi.fn<() => boolean>(() => true),
  mockSendCommand: vi.fn<(type: string, data?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock("../../gateway/centris-extension-bridge.js", () => ({
  isCentrisExtensionConnected: mockConnected,
  sendExtensionCommand: mockSendCommand,
}));

import { createCentrisBrowserTool } from "./centris-browser-tool.js";

// Helper to extract the JSON payload from a tool result
function getResultPayload(result: { content: Array<{ text?: string }> }): Record<string, unknown> {
  const text = result.content[0]?.text;
  return text ? JSON.parse(text) : {};
}

describe("centris_browser tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnected.mockReturnValue(true);
  });

  // ─── Connection check ──────────────────────────────────────────────────

  it("returns error when extension is not connected", async () => {
    mockConnected.mockReturnValue(false);
    const tool = createCentrisBrowserTool();
    const result = (await tool.execute("call-1", { action: "snapshot" })) as {
      content: Array<{ text?: string }>;
    };
    const payload = getResultPayload(result);
    expect(payload.error).toContain("Chrome extension not connected");
    expect(payload.connected).toBe(false);
  });

  // ─── Snapshot action ──────────────────────────────────────────────────

  it("snapshot: strips unnecessary fields from extension response", async () => {
    mockSendCommand.mockResolvedValue({
      _internalNodes: [{ huge: "data" }],
      hasCanvasEditor: false,
      hasInputCapture: false,
      duration_ms: 42,
      snapshotId: "abc",
      timestamp: 12345,
      success: true,
      metadata: { url: "https://example.com", title: "Test", extra: "stuff" },
      interactiveNodes: [
        { id: 1, t: "cl", n: "Submit", r: "link", b: { x: 0, y: 0 }, h: "abc123" },
        { id: 2, t: "ty", n: "Email", r: "textbox", b: { x: 0, y: 50 }, h: "def456" },
      ],
    });
    const tool = createCentrisBrowserTool();
    const result = (await tool.execute("call-1", { action: "snapshot" })) as {
      content: Array<{ text?: string }>;
    };
    const payload = getResultPayload(result);

    // Stripped fields should be gone
    expect(payload._internalNodes).toBeUndefined();
    expect(payload.hasCanvasEditor).toBeUndefined();
    expect(payload.duration_ms).toBeUndefined();
    expect(payload.snapshotId).toBeUndefined();
    expect(payload.timestamp).toBeUndefined();
    expect(payload.success).toBeUndefined();

    // Metadata should only have url
    expect(payload.metadata).toEqual({ url: "https://example.com" });

    // Elements should be slim: {id, t, n} — no b, no h
    const nodes = payload.interactiveNodes as Array<Record<string, unknown>>;
    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toEqual({ id: 1, t: "cl", n: "Submit" }); // r="link" stripped (generic)
    expect(nodes[1]).toEqual({ id: 2, t: "ty", n: "Email", r: "textbox" }); // r="textbox" kept
  });

  it("snapshot: caps elements at 4000 chars", async () => {
    const manyNodes = Array.from({ length: 200 }, (_, i) => ({
      id: i,
      t: "cl",
      n: `Button number ${i} with a long label to inflate size`,
      r: "button",
    }));
    mockSendCommand.mockResolvedValue({
      metadata: { url: "https://example.com" },
      interactiveNodes: manyNodes,
    });
    const tool = createCentrisBrowserTool();
    const result = (await tool.execute("call-1", { action: "snapshot" })) as {
      content: Array<{ text?: string }>;
    };
    const payload = getResultPayload(result);
    const nodes = payload.interactiveNodes as Array<Record<string, unknown>>;

    expect(nodes.length).toBeLessThan(200);
    expect(payload._note).toContain("shown");
  });

  it("snapshot: truncates long element names to 60 chars", async () => {
    const longName = "A".repeat(100);
    mockSendCommand.mockResolvedValue({
      metadata: { url: "https://example.com" },
      interactiveNodes: [{ id: 1, t: "cl", n: longName }],
    });
    const tool = createCentrisBrowserTool();
    const result = (await tool.execute("call-1", { action: "snapshot" })) as {
      content: Array<{ text?: string }>;
    };
    const payload = getResultPayload(result);
    const nodes = payload.interactiveNodes as Array<Record<string, unknown>>;
    expect((nodes[0].n as string).length).toBe(60);
  });

  // ─── Click action ─────────────────────────────────────────────────────

  it("click: requires nodeId", async () => {
    const tool = createCentrisBrowserTool();
    await expect(tool.execute("call-1", { action: "click" })).rejects.toThrow("nodeId");
  });

  it("click: includes post-click snapshot elements", async () => {
    mockSendCommand.mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({
      metadata: { url: "https://example.com/after-click" },
      interactiveNodes: [
        { id: 10, t: "cl", n: "Next Page" },
        { id: 11, t: "ty", n: "Search" },
      ],
    });
    const tool = createCentrisBrowserTool();
    const result = (await tool.execute("call-1", { action: "click", nodeId: 5 })) as {
      content: Array<{ text?: string }>;
    };
    const payload = getResultPayload(result);

    expect(payload.success).toBe(true);
    expect(payload.url).toBe("https://example.com/after-click");
    expect(payload.postClickElements).toBeDefined();
    const elements = payload.postClickElements as Array<Record<string, unknown>>;
    expect(elements).toHaveLength(2);
    expect(elements[0].id).toBe(10);
  });

  // ─── Type action ──────────────────────────────────────────────────────

  it("type: requires nodeId and text", async () => {
    const tool = createCentrisBrowserTool();
    await expect(tool.execute("call-1", { action: "type", text: "hello" })).rejects.toThrow(
      "nodeId",
    );
    await expect(tool.execute("call-1", { action: "type", nodeId: 1 })).rejects.toThrow("text");
  });

  it("type: sends correct command to extension", async () => {
    mockSendCommand.mockResolvedValue({ success: true });
    const tool = createCentrisBrowserTool();
    await tool.execute("call-1", { action: "type", nodeId: 5, text: "hello world" });
    expect(mockSendCommand).toHaveBeenCalledWith("type_into_node", {
      nodeId: 5,
      text: "hello world",
    });
  });

  // ─── Navigate action ──────────────────────────────────────────────────

  it("navigate: requires url", async () => {
    const tool = createCentrisBrowserTool();
    await expect(tool.execute("call-1", { action: "navigate" })).rejects.toThrow("url");
  });

  it("navigate: auto-includes snapshot in response", async () => {
    mockSendCommand.mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({
      metadata: { url: "https://google.com" },
      interactiveNodes: [
        { id: 1, t: "ty", n: "Search" },
        { id: 2, t: "cl", n: "Google Search" },
      ],
    });
    const tool = createCentrisBrowserTool();
    const result = (await tool.execute("call-1", {
      action: "navigate",
      url: "https://google.com",
    })) as { content: Array<{ text?: string }> };
    const payload = getResultPayload(result);

    expect(payload.success).toBe(true);
    expect(payload.url).toBe("https://google.com");
    expect(payload.interactiveNodes).toBeDefined();
    const nodes = payload.interactiveNodes as Array<Record<string, unknown>>;
    expect(nodes).toHaveLength(2);
  });

  // ─── Read page action ─────────────────────────────────────────────────

  it("read_page: caps content at 6000 chars", async () => {
    const bigContent = "x".repeat(10000);
    mockSendCommand.mockResolvedValue({ content: bigContent });
    const tool = createCentrisBrowserTool();
    const result = (await tool.execute("call-1", { action: "read_page" })) as {
      content: Array<{ text?: string }>;
    };
    const payload = getResultPayload(result);
    const content = payload.content as string;
    expect(content.length).toBeLessThan(bigContent.length);
    expect(content).toContain("...[content truncated]");
    expect(content.length).toBe(6000 + "\n...[content truncated]".length);
  });

  it("read_page: does not cap short content", async () => {
    mockSendCommand.mockResolvedValue({ content: "Short page text" });
    const tool = createCentrisBrowserTool();
    const result = (await tool.execute("call-1", { action: "read_page" })) as {
      content: Array<{ text?: string }>;
    };
    const payload = getResultPayload(result);
    expect(payload.content).toBe("Short page text");
  });

  // ─── Press key action ─────────────────────────────────────────────────

  it("press_key: requires key", async () => {
    const tool = createCentrisBrowserTool();
    await expect(tool.execute("call-1", { action: "press_key" })).rejects.toThrow("key");
  });

  it("press_key: sends modifiers correctly", async () => {
    mockSendCommand.mockResolvedValue({ success: true });
    const tool = createCentrisBrowserTool();
    await tool.execute("call-1", { action: "press_key", key: "Enter", ctrl: true, meta: true });
    expect(mockSendCommand).toHaveBeenCalledWith("press_key", {
      key: "Enter",
      ctrl: true,
      alt: false,
      shift: false,
      meta: true,
    });
  });

  // ─── Scroll action ────────────────────────────────────────────────────

  it("scroll: defaults to down/400", async () => {
    mockSendCommand.mockResolvedValue({ success: true });
    const tool = createCentrisBrowserTool();
    await tool.execute("call-1", { action: "scroll" });
    expect(mockSendCommand).toHaveBeenCalledWith("scroll", {
      direction: "down",
      amount: 400,
    });
  });

  // ─── Tabs action ──────────────────────────────────────────────────────

  it("tabs: returns tab list from extension", async () => {
    const tabs = [
      { id: 1, title: "Google", url: "https://google.com" },
      { id: 2, title: "GitHub", url: "https://github.com" },
    ];
    mockSendCommand.mockResolvedValue(tabs);
    const tool = createCentrisBrowserTool();
    const result = (await tool.execute("call-1", { action: "tabs" })) as {
      content: Array<{ text?: string }>;
    };
    const payload = getResultPayload(result);
    expect(payload).toEqual(tabs);
  });

  // ─── Unknown action ───────────────────────────────────────────────────

  it("throws for unknown action", async () => {
    const tool = createCentrisBrowserTool();
    await expect(tool.execute("call-1", { action: "explode" })).rejects.toThrow(
      "Unknown centris_browser action",
    );
  });
});
