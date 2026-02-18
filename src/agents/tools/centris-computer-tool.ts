/**
 * Centris Computer Tool
 *
 * Controls the user's desktop applications via native Accessibility APIs.
 *
 * Two execution paths:
 *   1. **Desktop bridge** (primary): Commands are sent over WebSocket to the
 *      Electron app running on the user's Mac. The Electron app executes them
 *      via the native C++ module and sends results back. This works from the
 *      cloud gateway (Railway).
 *   2. **Local native module** (fallback): When running a local gateway with
 *      the native module available, commands execute in-process for lower
 *      latency (~10ms vs ~50-200ms over WebSocket).
 *
 * This is the "hands" for native apps, just like centris_browser is for web apps.
 */

import { Type } from "@sinclair/typebox";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import {
  isCentrisDesktopConnected,
  sendDesktopCommand,
} from "../../gateway/centris-desktop-bridge.js";
import { stringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, jsonResult } from "./common.js";

/** Max chars for serialized snapshot elements. Matches browser tool budget. */
const MAX_SNAPSHOT_CHARS = 4000;

// ─── Native module loading (local fallback) ─────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let nativeControl: any = null;
let nativeLoadAttempted = false;
let initialized = false;

function loadNativeModule() {
  if (nativeControl) {
    return nativeControl;
  }
  if (nativeLoadAttempted) {
    return null;
  }
  nativeLoadAttempted = true;

  try {
    const require = createRequire(import.meta.url);
    const candidates = [
      resolve(
        import.meta.dirname ?? ".",
        "../../../desktop/native-control/build/Release/centris_control.node",
      ),
      resolve(
        import.meta.dirname ?? ".",
        "../desktop/native-control/build/Release/centris_control.node",
      ),
      resolve(process.cwd(), "desktop/native-control/build/Release/centris_control.node"),
    ];
    for (const candidate of candidates) {
      try {
        nativeControl = require(candidate);
        return nativeControl;
      } catch {
        // try next
      }
    }
  } catch {
    // Native module not available — will use bridge instead
  }
  return null;
}

function ensureLocalInitialized(): boolean {
  if (initialized) {
    return true;
  }
  const mod = loadNativeModule();
  if (!mod) {
    return false;
  }
  mod.initialize({ cacheElements: true, cacheTimeoutMs: 1000 });
  initialized = true;
  return true;
}

/** Returns true if we should route commands over the desktop bridge. */
function useBridge(): boolean {
  // If native module is available locally, prefer it (faster, dev mode)
  if (ensureLocalInitialized()) {
    return false;
  }
  // Otherwise use the bridge (cloud gateway → Electron app)
  return true;
}

// ─── Tool schema ────────────────────────────────────────────────────────────

const COMPUTER_ACTIONS = [
  "snapshot",
  "click_element",
  "type_into_element",
  "press_key",
  "find_elements",
  "list_apps",
  "launch_app",
  "activate_app",
  "list_windows",
  "focus_window",
  "move_window",
  "resize_window",
  "mouse_click",
  "mouse_move",
  "type_text",
  "key_combo",
  "scroll",
  "get_displays",
  "insert_text",
] as const;

export const CentrisComputerToolSchema = Type.Object({
  action: stringEnum(COMPUTER_ACTIONS),
  // snapshot / find_elements / activate_app / launch_app: target app
  appName: Type.Optional(Type.String()),
  // snapshot: filter by window title
  windowTitle: Type.Optional(Type.String()),
  // click_element / type_into_element: element ID from snapshot
  elementId: Type.Optional(Type.Number()),
  // type_into_element / type_text / insert_text: text content
  text: Type.Optional(Type.String()),
  // find_elements: element role filter
  role: Type.Optional(Type.String()),
  // find_elements: element name filter
  name: Type.Optional(Type.String()),
  // press_key / key_combo: key or combo string
  key: Type.Optional(Type.String()),
  // focus_window / move_window / resize_window: window ID
  windowId: Type.Optional(Type.Number()),
  // move_window: target coordinates
  x: Type.Optional(Type.Number()),
  y: Type.Optional(Type.Number()),
  // resize_window: target dimensions
  width: Type.Optional(Type.Number()),
  height: Type.Optional(Type.Number()),
  // mouse_click / mouse_move: coordinates
  mouseX: Type.Optional(Type.Number()),
  mouseY: Type.Optional(Type.Number()),
  // scroll: direction and amount
  deltaX: Type.Optional(Type.Number()),
  deltaY: Type.Optional(Type.Number()),
  // launch_app: bundle ID or path
  bundleId: Type.Optional(Type.String()),
});

// ─── Tool factory ───────────────────────────────────────────────────────────

export function createCentrisComputerTool(): AnyAgentTool {
  return {
    label: "CentrisComputer",
    name: "centris_computer",
    description: [
      "Control desktop applications on the user's computer via native Accessibility APIs.",
      "This gives you DOM-like access to ANY native app (Finder, Safari, Slack, Zoom, System Settings, etc.).",
      "Element coordinates are exact (<10ms, 100% accurate) — no screenshots or vision needed.",
      "",
      "Workflow for interacting with desktop apps:",
      '1. action="list_apps" — see what apps are running',
      '2. action="activate_app" appName="Safari" — bring an app to front',
      '3. action="snapshot" appName="Safari" — get all interactive elements (buttons, text fields, menus) with IDs',
      '4. action="click_element" elementId=N — click a specific element from the snapshot',
      '5. action="type_into_element" elementId=N text="..." — type into a text field',
      "6. After any action, take a new snapshot to see updated state.",
      "",
      "Element snapshot returns: {id, role, name, value, bounds: {x,y,width,height}, enabled, focused}",
      "Use the id for click_element/type_into_element.",
      "",
      "Other capabilities:",
      '- action="launch_app" bundleId="com.apple.Safari" — open an app',
      '- action="list_windows" — list all windows (optionally filter by appName)',
      '- action="focus_window" windowId=N — bring a window to front',
      '- action="key_combo" key="cmd+c" — press keyboard shortcuts',
      '- action="insert_text" text="..." — insert text at cursor in focused field (no clipboard)',
      '- action="scroll" deltaY=-3 — scroll up/down',
      '- action="mouse_click" mouseX=100 mouseY=200 — click at coordinates',
      '- action="get_displays" — get display info',
    ].join("\n"),
    parameters: CentrisComputerToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = params.action as string;

      if (useBridge()) {
        return executeViaBridge(action, params);
      }
      return executeLocal(action, params);
    },
  };
}

// ─── Shared helpers ─────────────────────────────────────────────────────────

function capElements(rawElements: Array<Record<string, unknown>>): {
  slim: Array<Record<string, unknown>>;
  totalCount: number;
} {
  const totalCount = rawElements.length;
  const slim: Array<Record<string, unknown>> = [];
  let charCount = 0;
  for (const el of rawElements) {
    const entry: Record<string, unknown> = {
      id: el.id,
      role: el.role,
      name: typeof el.name === "string" ? el.name.slice(0, 60) : "",
    };
    if (el.value && el.role === "AXTextField") {
      entry.value = typeof el.value === "string" ? el.value.slice(0, 100) : el.value;
    }
    const elStr = JSON.stringify(entry);
    if (charCount + elStr.length + 1 > MAX_SNAPSHOT_CHARS) {
      break;
    }
    charCount += elStr.length + 1;
    slim.push(entry);
  }
  return { slim, totalCount };
}

// ─── Bridge execution (cloud gateway → Electron desktop app) ────────────────

async function executeViaBridge(
  action: string,
  params: Record<string, unknown>,
): Promise<ReturnType<typeof jsonResult>> {
  if (!isCentrisDesktopConnected()) {
    throw new Error(
      "Centris desktop app is not connected. The user needs the Electron app running to control their computer.",
    );
  }

  const result = (await sendDesktopCommand(action, params)) as Record<string, unknown>;

  // Cap snapshot/find_elements output the same way the local path does,
  // so we don't blow the LLM's token budget.
  if (action === "snapshot" && Array.isArray(result.elements)) {
    const { slim, totalCount } = capElements(result.elements as Array<Record<string, unknown>>);
    const capped: Record<string, unknown> = {
      appName: result.appName,
      windowTitle: result.windowTitle,
      elementCount: totalCount,
      elements: slim,
    };
    if (slim.length < totalCount) {
      capped._note = `${slim.length}/${totalCount} shown (capped at ~1K tokens). Use find_elements with role/name to filter.`;
    }
    return jsonResult(capped);
  }

  if (action === "find_elements" && Array.isArray(result.elements)) {
    const { slim, totalCount } = capElements(result.elements as Array<Record<string, unknown>>);
    const capped: Record<string, unknown> = { count: totalCount, elements: slim };
    if (slim.length < totalCount) {
      capped._note = `${slim.length}/${totalCount} shown. Narrow your role/name filters.`;
    }
    return jsonResult(capped);
  }

  return jsonResult(result);
}

// ─── Local execution (native module in-process) ─────────────────────────────

async function executeLocal(
  action: string,
  params: Record<string, unknown>,
): Promise<ReturnType<typeof jsonResult>> {
  switch (action) {
    case "snapshot": {
      const options: Record<string, unknown> = {};
      if (typeof params.appName === "string") {
        options.appName = params.appName;
      }
      if (typeof params.windowTitle === "string") {
        options.windowTitle = params.windowTitle;
      }
      const snapshot = nativeControl.getInteractiveSnapshot(options);
      const { slim, totalCount } = capElements(snapshot.elements ?? []);
      const result: Record<string, unknown> = {
        appName: snapshot.appName,
        windowTitle: snapshot.windowTitle,
        elementCount: totalCount,
        elements: slim,
      };
      if (slim.length < totalCount) {
        result._note = `${slim.length}/${totalCount} shown (capped at ~1K tokens). Use find_elements with role/name to filter.`;
      }
      return jsonResult(result);
    }

    case "click_element": {
      const elementId = params.elementId;
      if (typeof elementId !== "number") {
        throw new Error("elementId (number) is required. Get IDs from a snapshot first.");
      }
      const result = nativeControl.clickElement(elementId, {});
      return jsonResult({ success: result, elementId });
    }

    case "type_into_element": {
      const elementId = params.elementId;
      const text = params.text;
      if (typeof elementId !== "number") {
        throw new Error("elementId (number) is required.");
      }
      if (typeof text !== "string" || !text) {
        throw new Error("text (string) is required.");
      }
      const result = nativeControl.typeIntoElement(elementId, text, {});
      return jsonResult({ success: result, elementId });
    }

    case "press_key": {
      const key = params.key;
      if (typeof key !== "string" || !key) {
        throw new Error("key (string) is required (e.g. 'Enter', 'Tab', 'Escape').");
      }
      const result = nativeControl.keyPress(key);
      return jsonResult({ success: result, key });
    }

    case "find_elements": {
      const criteria: Record<string, unknown> = {};
      if (typeof params.appName === "string") {
        criteria.appName = params.appName;
      }
      if (typeof params.role === "string") {
        criteria.role = params.role;
      }
      if (typeof params.name === "string") {
        criteria.name = params.name;
      }
      const elements: Array<Record<string, unknown>> = nativeControl.findElements(criteria);
      const { slim, totalCount } = capElements(elements);
      const result: Record<string, unknown> = { count: totalCount, elements: slim };
      if (slim.length < totalCount) {
        result._note = `${slim.length}/${totalCount} shown. Narrow your role/name filters.`;
      }
      return jsonResult(result);
    }

    case "list_apps": {
      const apps = nativeControl.getRunningApps();
      return jsonResult({
        count: apps.length,
        apps: apps.map((app: Record<string, unknown>) => ({
          name: app.name,
          pid: app.pid,
          bundleId: app.bundleId,
          active: app.active,
        })),
      });
    }

    case "launch_app": {
      const bundleId = (params.bundleId ?? params.appName) as string | undefined;
      if (!bundleId) {
        throw new Error("bundleId or appName is required.");
      }
      const result = nativeControl.launchApp(bundleId);
      return jsonResult({ success: result, bundleId });
    }

    case "activate_app": {
      const appName = params.appName;
      if (typeof appName !== "string" || !appName) {
        throw new Error("appName is required.");
      }
      const result = nativeControl.activateApp(appName);
      return jsonResult({ success: result, appName });
    }

    case "list_windows": {
      const appName = typeof params.appName === "string" ? params.appName : "";
      const windows = nativeControl.getWindows(appName);
      return jsonResult({
        count: windows.length,
        windows: windows.map((w: Record<string, unknown>) => ({
          id: w.id,
          title: w.title,
          appName: w.appName,
          bounds: w.bounds,
          focused: w.focused,
        })),
      });
    }

    case "focus_window": {
      const windowId = params.windowId;
      if (typeof windowId !== "number") {
        throw new Error("windowId (number) is required.");
      }
      const result = nativeControl.focusWindow(windowId);
      return jsonResult({ success: result, windowId });
    }

    case "move_window": {
      const windowId = params.windowId;
      const x = params.x;
      const y = params.y;
      if (typeof windowId !== "number") {
        throw new Error("windowId required");
      }
      if (typeof x !== "number" || typeof y !== "number") {
        throw new Error("x and y required");
      }
      const result = nativeControl.moveWindow(windowId, x, y);
      return jsonResult({ success: result, windowId, x, y });
    }

    case "resize_window": {
      const windowId = params.windowId;
      const width = params.width;
      const height = params.height;
      if (typeof windowId !== "number") {
        throw new Error("windowId required");
      }
      if (typeof width !== "number" || typeof height !== "number") {
        throw new Error("width and height required");
      }
      const result = nativeControl.resizeWindow(windowId, width, height);
      return jsonResult({ success: result, windowId, width, height });
    }

    case "mouse_click": {
      const x = params.mouseX ?? params.x;
      const y = params.mouseY ?? params.y;
      if (typeof x !== "number" || typeof y !== "number") {
        throw new Error("mouseX and mouseY are required.");
      }
      const result = nativeControl.click(x, y, {});
      return jsonResult({ success: result, x, y });
    }

    case "mouse_move": {
      const x = params.mouseX ?? params.x;
      const y = params.mouseY ?? params.y;
      if (typeof x !== "number" || typeof y !== "number") {
        throw new Error("mouseX and mouseY are required.");
      }
      const result = nativeControl.moveMouse(x, y);
      return jsonResult({ success: result, x, y });
    }

    case "type_text": {
      const text = params.text;
      if (typeof text !== "string" || !text) {
        throw new Error("text is required.");
      }
      const result = nativeControl.type(text);
      return jsonResult({ success: result });
    }

    case "key_combo": {
      const key = params.key;
      if (typeof key !== "string" || !key) {
        throw new Error("key combo is required (e.g. 'cmd+c', 'ctrl+shift+n').");
      }
      const result = nativeControl.keyPress(key);
      return jsonResult({ success: result, key });
    }

    case "scroll": {
      const deltaX = typeof params.deltaX === "number" ? params.deltaX : 0;
      const deltaY = typeof params.deltaY === "number" ? params.deltaY : -3;
      const result = nativeControl.scroll({ deltaX, deltaY });
      return jsonResult({ success: result, deltaX, deltaY });
    }

    case "get_displays": {
      const displays = nativeControl.getDisplays();
      return jsonResult({ displays });
    }

    case "insert_text": {
      const text = params.text;
      if (typeof text !== "string") {
        throw new Error("text is required.");
      }
      const result = nativeControl.insertTextAtCursor(text);
      return jsonResult({ success: result });
    }

    default:
      throw new Error(`Unknown centris_computer action: ${action}`);
  }
}
