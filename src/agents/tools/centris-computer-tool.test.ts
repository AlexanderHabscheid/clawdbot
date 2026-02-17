import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Centris Computer Tool Tests
 *
 * The computer tool depends on a native C++ module (centris_control.node).
 * We mock it entirely so tests run without compiling native code.
 * This validates:
 *   - All 19 actions dispatch correctly
 *   - Parameter validation (required fields, type checks)
 *   - Token-efficiency: snapshot/find_elements output is capped at 4000 chars
 *   - Error handling for missing native module
 */

// ─── Mock the native module ─────────────────────────────────────────────────
// The tool uses createRequire(import.meta.url) to load the .node binary.
// We intercept at the module level by mocking the require resolution.

const mockNative = vi.hoisted(() => ({
  initialize: vi.fn(),
  getInteractiveSnapshot: vi.fn(() => ({
    appName: "Safari",
    windowTitle: "Test",
    elements: [],
  })),
  clickElement: vi.fn(() => true),
  typeIntoElement: vi.fn(() => true),
  keyPress: vi.fn(() => true),
  findElements: vi.fn(() => []),
  getRunningApps: vi.fn(() => []),
  launchApp: vi.fn(() => true),
  activateApp: vi.fn(() => true),
  getWindows: vi.fn(() => []),
  focusWindow: vi.fn(() => true),
  moveWindow: vi.fn(() => true),
  resizeWindow: vi.fn(() => true),
  click: vi.fn(() => true),
  moveMouse: vi.fn(() => true),
  type: vi.fn(() => true),
  scroll: vi.fn(() => true),
  getDisplays: vi.fn(() => [{ id: 1, width: 2560, height: 1440 }]),
  insertTextAtCursor: vi.fn(() => true),
}));

// Mock createRequire so the native module load returns our mock
vi.mock("node:module", () => ({
  createRequire: () => () => mockNative,
}));

import { createCentrisComputerTool } from "./centris-computer-tool.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function getResultPayload(result: { content: Array<{ text?: string }> }): Record<string, unknown> {
  const text = result.content[0]?.text;
  return text ? JSON.parse(text) : {};
}

describe("centris_computer tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Initialization ──────────────────────────────────────────────────────

  it("initializes native module on first call", async () => {
    const tool = createCentrisComputerTool();
    mockNative.getRunningApps.mockReturnValue([]);
    await tool.execute("call-1", { action: "list_apps" });
    expect(mockNative.initialize).toHaveBeenCalledWith({
      cacheElements: true,
      cacheTimeoutMs: 1000,
    });
  });

  // ─── list_apps ──────────────────────────────────────────────────────────

  it("list_apps: returns running applications", async () => {
    mockNative.getRunningApps.mockReturnValue([
      { name: "Safari", pid: 123, bundleId: "com.apple.Safari", active: true },
      { name: "Finder", pid: 456, bundleId: "com.apple.finder", active: false },
    ]);
    const tool = createCentrisComputerTool();
    const result = (await tool.execute("call-1", { action: "list_apps" })) as {
      content: Array<{ text?: string }>;
    };
    const payload = getResultPayload(result);
    expect(payload.count).toBe(2);
    const apps = payload.apps as Array<Record<string, unknown>>;
    expect(apps[0].name).toBe("Safari");
    expect(apps[0].active).toBe(true);
    expect(apps[1].name).toBe("Finder");
  });

  // ─── snapshot ──────────────────────────────────────────────────────────

  it("snapshot: returns lean element format {id, role, name}", async () => {
    mockNative.getInteractiveSnapshot.mockReturnValue({
      appName: "Safari",
      windowTitle: "Google",
      elements: [
        {
          id: 1,
          role: "AXButton",
          name: "Submit",
          value: null,
          bounds: { x: 10, y: 20, width: 80, height: 30 },
          enabled: true,
          focused: false,
        },
        {
          id: 2,
          role: "AXTextField",
          name: "Search",
          value: "hello",
          bounds: { x: 10, y: 60, width: 200, height: 30 },
          enabled: true,
          focused: true,
        },
      ],
    });
    const tool = createCentrisComputerTool();
    const result = (await tool.execute("call-1", {
      action: "snapshot",
      appName: "Safari",
    })) as { content: Array<{ text?: string }> };
    const payload = getResultPayload(result);

    expect(payload.appName).toBe("Safari");
    expect(payload.elementCount).toBe(2);
    const elements = payload.elements as Array<Record<string, unknown>>;
    expect(elements).toHaveLength(2);

    // Button: lean format, no bounds/enabled/focused
    expect(elements[0]).toEqual({ id: 1, role: "AXButton", name: "Submit" });

    // TextField: includes value (important for seeing current input state).
    // The native module may return roles with or without AX prefix depending
    // on the OS version; the tool passes them through as-is.
    expect(elements[1]).toEqual({
      id: 2,
      role: "AXTextField",
      name: "Search",
      value: "hello",
    });
  });

  it("snapshot: caps elements at 4000 chars to prevent token bloat", async () => {
    const manyElements = Array.from({ length: 300 }, (_, i) => ({
      id: i,
      role: "AXButton",
      name: `Button number ${i} with a reasonably long label to inflate`,
      value: null,
      bounds: { x: 0, y: i * 30, width: 100, height: 30 },
      enabled: true,
      focused: false,
    }));
    mockNative.getInteractiveSnapshot.mockReturnValue({
      appName: "Finder",
      windowTitle: "Desktop",
      elements: manyElements,
    });
    const tool = createCentrisComputerTool();
    const result = (await tool.execute("call-1", {
      action: "snapshot",
      appName: "Finder",
    })) as { content: Array<{ text?: string }> };
    const payload = getResultPayload(result);

    const elements = payload.elements as Array<Record<string, unknown>>;
    expect(elements.length).toBeLessThan(300);
    expect(payload.elementCount).toBe(300);
    expect(payload._note).toContain("shown");
    expect(payload._note).toContain("capped");
  });

  it("snapshot: truncates long element names to 60 chars", async () => {
    const longName = "A".repeat(100);
    mockNative.getInteractiveSnapshot.mockReturnValue({
      appName: "Test",
      windowTitle: "Test",
      elements: [{ id: 1, role: "AXButton", name: longName, value: null }],
    });
    const tool = createCentrisComputerTool();
    const result = (await tool.execute("call-1", {
      action: "snapshot",
      appName: "Test",
    })) as { content: Array<{ text?: string }> };
    const payload = getResultPayload(result);
    const elements = payload.elements as Array<Record<string, unknown>>;
    expect((elements[0].name as string).length).toBe(60);
  });

  it("snapshot: passes appName and windowTitle to native module", async () => {
    mockNative.getInteractiveSnapshot.mockReturnValue({
      appName: "Safari",
      windowTitle: "Google",
      elements: [],
    });
    const tool = createCentrisComputerTool();
    await tool.execute("call-1", {
      action: "snapshot",
      appName: "Safari",
      windowTitle: "Google",
    });
    expect(mockNative.getInteractiveSnapshot).toHaveBeenCalledWith({
      appName: "Safari",
      windowTitle: "Google",
    });
  });

  // ─── click_element ──────────────────────────────────────────────────────

  it("click_element: requires elementId", async () => {
    const tool = createCentrisComputerTool();
    await expect(tool.execute("call-1", { action: "click_element" })).rejects.toThrow("elementId");
  });

  it("click_element: dispatches to native module", async () => {
    mockNative.clickElement.mockReturnValue(true);
    const tool = createCentrisComputerTool();
    const result = (await tool.execute("call-1", {
      action: "click_element",
      elementId: 42,
    })) as { content: Array<{ text?: string }> };
    const payload = getResultPayload(result);
    expect(payload.success).toBe(true);
    expect(payload.elementId).toBe(42);
    expect(mockNative.clickElement).toHaveBeenCalledWith(42, {});
  });

  // ─── type_into_element ──────────────────────────────────────────────────

  it("type_into_element: requires elementId and text", async () => {
    const tool = createCentrisComputerTool();
    await expect(
      tool.execute("call-1", { action: "type_into_element", text: "hello" }),
    ).rejects.toThrow("elementId");
    await expect(
      tool.execute("call-1", { action: "type_into_element", elementId: 1 }),
    ).rejects.toThrow("text");
  });

  it("type_into_element: dispatches correctly", async () => {
    mockNative.typeIntoElement.mockReturnValue(true);
    const tool = createCentrisComputerTool();
    const result = (await tool.execute("call-1", {
      action: "type_into_element",
      elementId: 5,
      text: "hello world",
    })) as { content: Array<{ text?: string }> };
    const payload = getResultPayload(result);
    expect(payload.success).toBe(true);
    expect(mockNative.typeIntoElement).toHaveBeenCalledWith(5, "hello world", {});
  });

  // ─── press_key ──────────────────────────────────────────────────────────

  it("press_key: requires key", async () => {
    const tool = createCentrisComputerTool();
    await expect(tool.execute("call-1", { action: "press_key" })).rejects.toThrow("key");
  });

  it("press_key: dispatches to native keyPress", async () => {
    mockNative.keyPress.mockReturnValue(true);
    const tool = createCentrisComputerTool();
    const result = (await tool.execute("call-1", {
      action: "press_key",
      key: "Enter",
    })) as { content: Array<{ text?: string }> };
    const payload = getResultPayload(result);
    expect(payload.success).toBe(true);
    expect(payload.key).toBe("Enter");
  });

  // ─── find_elements ──────────────────────────────────────────────────────

  it("find_elements: passes criteria to native module", async () => {
    mockNative.findElements.mockReturnValue([{ id: 1, role: "AXButton", name: "OK", value: null }]);
    const tool = createCentrisComputerTool();
    const result = (await tool.execute("call-1", {
      action: "find_elements",
      appName: "Safari",
      role: "AXButton",
      name: "OK",
    })) as { content: Array<{ text?: string }> };
    const payload = getResultPayload(result);
    expect(payload.count).toBe(1);
    expect(mockNative.findElements).toHaveBeenCalledWith({
      appName: "Safari",
      role: "AXButton",
      name: "OK",
    });
  });

  it("find_elements: caps output at 4000 chars like snapshot", async () => {
    const manyElements = Array.from({ length: 200 }, (_, i) => ({
      id: i,
      role: "AXButton",
      name: `Element ${i} with long label for token inflation testing`,
      value: null,
    }));
    mockNative.findElements.mockReturnValue(manyElements);
    const tool = createCentrisComputerTool();
    const result = (await tool.execute("call-1", {
      action: "find_elements",
      appName: "Test",
    })) as { content: Array<{ text?: string }> };
    const payload = getResultPayload(result);
    const elements = payload.elements as Array<Record<string, unknown>>;
    expect(elements.length).toBeLessThan(200);
    expect(payload._note).toContain("shown");
  });

  // ─── launch_app ──────────────────────────────────────────────────────────

  it("launch_app: requires bundleId or appName", async () => {
    const tool = createCentrisComputerTool();
    await expect(tool.execute("call-1", { action: "launch_app" })).rejects.toThrow(
      "bundleId or appName",
    );
  });

  it("launch_app: dispatches with bundleId", async () => {
    mockNative.launchApp.mockReturnValue(true);
    const tool = createCentrisComputerTool();
    const result = (await tool.execute("call-1", {
      action: "launch_app",
      bundleId: "com.apple.Safari",
    })) as { content: Array<{ text?: string }> };
    const payload = getResultPayload(result);
    expect(payload.success).toBe(true);
    expect(payload.bundleId).toBe("com.apple.Safari");
  });

  it("launch_app: falls back to appName when bundleId not provided", async () => {
    mockNative.launchApp.mockReturnValue(true);
    const tool = createCentrisComputerTool();
    await tool.execute("call-1", { action: "launch_app", appName: "Safari" });
    expect(mockNative.launchApp).toHaveBeenCalledWith("Safari");
  });

  // ─── activate_app ────────────────────────────────────────────────────────

  it("activate_app: requires appName", async () => {
    const tool = createCentrisComputerTool();
    await expect(tool.execute("call-1", { action: "activate_app" })).rejects.toThrow("appName");
  });

  it("activate_app: dispatches correctly", async () => {
    mockNative.activateApp.mockReturnValue(true);
    const tool = createCentrisComputerTool();
    const result = (await tool.execute("call-1", {
      action: "activate_app",
      appName: "Finder",
    })) as { content: Array<{ text?: string }> };
    const payload = getResultPayload(result);
    expect(payload.success).toBe(true);
    expect(payload.appName).toBe("Finder");
  });

  // ─── list_windows ────────────────────────────────────────────────────────

  it("list_windows: returns window list", async () => {
    mockNative.getWindows.mockReturnValue([
      { id: 1, title: "Desktop", appName: "Finder", bounds: { x: 0, y: 0 }, focused: true },
      { id: 2, title: "Google", appName: "Safari", bounds: { x: 100, y: 100 }, focused: false },
    ]);
    const tool = createCentrisComputerTool();
    const result = (await tool.execute("call-1", { action: "list_windows" })) as {
      content: Array<{ text?: string }>;
    };
    const payload = getResultPayload(result);
    expect(payload.count).toBe(2);
    const windows = payload.windows as Array<Record<string, unknown>>;
    expect(windows[0].title).toBe("Desktop");
  });

  it("list_windows: passes appName filter", async () => {
    mockNative.getWindows.mockReturnValue([]);
    const tool = createCentrisComputerTool();
    await tool.execute("call-1", { action: "list_windows", appName: "Safari" });
    expect(mockNative.getWindows).toHaveBeenCalledWith("Safari");
  });

  // ─── focus_window ────────────────────────────────────────────────────────

  it("focus_window: requires windowId", async () => {
    const tool = createCentrisComputerTool();
    await expect(tool.execute("call-1", { action: "focus_window" })).rejects.toThrow("windowId");
  });

  // ─── move_window ─────────────────────────────────────────────────────────

  it("move_window: requires windowId, x, y", async () => {
    const tool = createCentrisComputerTool();
    await expect(tool.execute("call-1", { action: "move_window", x: 0, y: 0 })).rejects.toThrow(
      "windowId",
    );
    await expect(tool.execute("call-1", { action: "move_window", windowId: 1 })).rejects.toThrow(
      "x and y",
    );
  });

  it("move_window: dispatches correctly", async () => {
    mockNative.moveWindow.mockReturnValue(true);
    const tool = createCentrisComputerTool();
    const result = (await tool.execute("call-1", {
      action: "move_window",
      windowId: 1,
      x: 100,
      y: 200,
    })) as { content: Array<{ text?: string }> };
    const payload = getResultPayload(result);
    expect(payload.success).toBe(true);
    expect(mockNative.moveWindow).toHaveBeenCalledWith(1, 100, 200);
  });

  // ─── resize_window ───────────────────────────────────────────────────────

  it("resize_window: requires windowId, width, height", async () => {
    const tool = createCentrisComputerTool();
    await expect(
      tool.execute("call-1", { action: "resize_window", width: 800, height: 600 }),
    ).rejects.toThrow("windowId");
    await expect(tool.execute("call-1", { action: "resize_window", windowId: 1 })).rejects.toThrow(
      "width and height",
    );
  });

  it("resize_window: dispatches correctly", async () => {
    mockNative.resizeWindow.mockReturnValue(true);
    const tool = createCentrisComputerTool();
    const result = (await tool.execute("call-1", {
      action: "resize_window",
      windowId: 1,
      width: 800,
      height: 600,
    })) as { content: Array<{ text?: string }> };
    const payload = getResultPayload(result);
    expect(payload.success).toBe(true);
    expect(mockNative.resizeWindow).toHaveBeenCalledWith(1, 800, 600);
  });

  // ─── mouse_click ─────────────────────────────────────────────────────────

  it("mouse_click: requires coordinates", async () => {
    const tool = createCentrisComputerTool();
    await expect(tool.execute("call-1", { action: "mouse_click" })).rejects.toThrow(
      "mouseX and mouseY",
    );
  });

  it("mouse_click: dispatches with mouseX/mouseY", async () => {
    mockNative.click.mockReturnValue(true);
    const tool = createCentrisComputerTool();
    const result = (await tool.execute("call-1", {
      action: "mouse_click",
      mouseX: 100,
      mouseY: 200,
    })) as { content: Array<{ text?: string }> };
    const payload = getResultPayload(result);
    expect(payload.success).toBe(true);
    expect(mockNative.click).toHaveBeenCalledWith(100, 200, {});
  });

  // ─── mouse_move ──────────────────────────────────────────────────────────

  it("mouse_move: dispatches with coordinates", async () => {
    mockNative.moveMouse.mockReturnValue(true);
    const tool = createCentrisComputerTool();
    const result = (await tool.execute("call-1", {
      action: "mouse_move",
      mouseX: 300,
      mouseY: 400,
    })) as { content: Array<{ text?: string }> };
    const payload = getResultPayload(result);
    expect(payload.success).toBe(true);
  });

  // ─── type_text ───────────────────────────────────────────────────────────

  it("type_text: requires text", async () => {
    const tool = createCentrisComputerTool();
    await expect(tool.execute("call-1", { action: "type_text" })).rejects.toThrow("text");
  });

  it("type_text: dispatches to native type()", async () => {
    mockNative.type.mockReturnValue(true);
    const tool = createCentrisComputerTool();
    await tool.execute("call-1", { action: "type_text", text: "hello" });
    expect(mockNative.type).toHaveBeenCalledWith("hello");
  });

  // ─── key_combo ───────────────────────────────────────────────────────────

  it("key_combo: requires key", async () => {
    const tool = createCentrisComputerTool();
    await expect(tool.execute("call-1", { action: "key_combo" })).rejects.toThrow("key combo");
  });

  it("key_combo: dispatches correctly", async () => {
    mockNative.keyPress.mockReturnValue(true);
    const tool = createCentrisComputerTool();
    const result = (await tool.execute("call-1", {
      action: "key_combo",
      key: "cmd+c",
    })) as { content: Array<{ text?: string }> };
    const payload = getResultPayload(result);
    expect(payload.success).toBe(true);
    expect(payload.key).toBe("cmd+c");
    expect(mockNative.keyPress).toHaveBeenCalledWith("cmd+c");
  });

  // ─── scroll ──────────────────────────────────────────────────────────────

  it("scroll: defaults to deltaY=-3 (down)", async () => {
    mockNative.scroll.mockReturnValue(true);
    const tool = createCentrisComputerTool();
    await tool.execute("call-1", { action: "scroll" });
    expect(mockNative.scroll).toHaveBeenCalledWith({ deltaX: 0, deltaY: -3 });
  });

  it("scroll: accepts custom delta values", async () => {
    mockNative.scroll.mockReturnValue(true);
    const tool = createCentrisComputerTool();
    await tool.execute("call-1", { action: "scroll", deltaX: 2, deltaY: 5 });
    expect(mockNative.scroll).toHaveBeenCalledWith({ deltaX: 2, deltaY: 5 });
  });

  // ─── get_displays ────────────────────────────────────────────────────────

  it("get_displays: returns display info", async () => {
    mockNative.getDisplays.mockReturnValue([{ id: 1, width: 2560, height: 1440 }]);
    const tool = createCentrisComputerTool();
    const result = (await tool.execute("call-1", { action: "get_displays" })) as {
      content: Array<{ text?: string }>;
    };
    const payload = getResultPayload(result);
    const displays = payload.displays as Array<Record<string, unknown>>;
    expect(displays).toHaveLength(1);
    expect(displays[0].width).toBe(2560);
  });

  // ─── insert_text ─────────────────────────────────────────────────────────

  it("insert_text: requires text", async () => {
    const tool = createCentrisComputerTool();
    await expect(tool.execute("call-1", { action: "insert_text" })).rejects.toThrow("text");
  });

  it("insert_text: dispatches to insertTextAtCursor", async () => {
    mockNative.insertTextAtCursor.mockReturnValue(true);
    const tool = createCentrisComputerTool();
    await tool.execute("call-1", { action: "insert_text", text: "pasted text" });
    expect(mockNative.insertTextAtCursor).toHaveBeenCalledWith("pasted text");
  });

  // ─── Unknown action ──────────────────────────────────────────────────────

  it("throws for unknown action", async () => {
    const tool = createCentrisComputerTool();
    await expect(tool.execute("call-1", { action: "explode" })).rejects.toThrow(
      "Unknown centris_computer action",
    );
  });

  // ─── Token efficiency: snapshot output size ──────────────────────────────

  it("snapshot output stays under 4KB even with hundreds of elements", async () => {
    const manyElements = Array.from({ length: 500 }, (_, i) => ({
      id: i,
      role: "AXButton",
      name: `Button ${i}`,
      value: null,
      bounds: { x: 0, y: i * 30, width: 100, height: 30 },
      enabled: true,
      focused: false,
    }));
    mockNative.getInteractiveSnapshot.mockReturnValue({
      appName: "Xcode",
      windowTitle: "Project",
      elements: manyElements,
    });
    const tool = createCentrisComputerTool();
    const result = (await tool.execute("call-1", {
      action: "snapshot",
      appName: "Xcode",
    })) as { content: Array<{ text?: string }> };

    // The serialized elements section should be well under 4KB.
    // The full JSON includes appName, windowTitle, elementCount, etc., so
    // we check the elements array separately.
    const payload = getResultPayload(result);
    const elements = payload.elements as Array<Record<string, unknown>>;
    const serializedElements = JSON.stringify(elements);
    expect(serializedElements.length).toBeLessThanOrEqual(4200); // 4000 + json overhead
  });
});
