/**
 * Centris Computer Tool
 *
 * Controls the user's desktop applications via native Accessibility APIs.
 * Uses the centris-native-control module (C++/Obj-C) for:
 *   - Application management (launch, focus, list running apps)
 *   - Window management (list, focus, resize, move windows)
 *   - UI element discovery via Accessibility tree (<10ms, 100% accurate coordinates)
 *   - Element interaction (click, type, press keys, scroll)
 *   - Mouse/keyboard control
 *   - Display information
 *
 * This is the "hands" for native apps, just like centris_browser is for web apps.
 *
 * The native module lives at desktop/native-control/ and compiles via node-gyp.
 * It must be built before use: cd desktop/native-control && npm install
 */

import { Type } from "@sinclair/typebox";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { stringEnum } from "../schema/typebox.js";
// ─── Native module loading ──────────────────────────────────────────────────
import { type AnyAgentTool, jsonResult } from "./common.js";

/** Max chars for serialized snapshot elements. Matches browser tool budget. */
const MAX_SNAPSHOT_CHARS = 4000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let nativeControl: any = null;
let nativeLoadError: string | null = null;
let initialized = false;

function loadNativeModule() {
  if (nativeControl) {
    return nativeControl;
  }
  if (nativeLoadError) {
    return null;
  }

  try {
    const require = createRequire(import.meta.url);
    // Try multiple resolution strategies since the bundled dist/ changes import.meta paths.
    // 1) Relative from source layout (src/agents/tools/ → repo root)
    // 2) Relative from dist/ layout (dist/ → repo root)
    // 3) Absolute fallback using process.cwd()
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
    throw new Error(`Not found in any of: ${candidates.join(", ")}`);
  } catch (err) {
    nativeLoadError = err instanceof Error ? err.message : String(err);
    return null;
  }
}

function ensureInitialized(): void {
  if (initialized) {
    return;
  }
  const mod = loadNativeModule();
  if (!mod) {
    throw new Error(
      `Native control module not available: ${nativeLoadError ?? "unknown error"}. ` +
        "Build it with: cd desktop/native-control && npm install",
    );
  }
  mod.initialize({ cacheElements: true, cacheTimeoutMs: 1000 });
  initialized = true;
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
      ensureInitialized();

      const params = args as Record<string, unknown>;
      const action = params.action as string;

      switch (action) {
        // ─── App snapshot (accessibility tree) ────────────────────────
        // Cap output to ~1K tokens like the browser tool. Complex apps (Xcode,
        // Finder) can return 500+ elements; uncapped that's 10-20K tokens.
        case "snapshot": {
          const options: Record<string, unknown> = {};
          if (typeof params.appName === "string") {
            options.appName = params.appName;
          }
          if (typeof params.windowTitle === "string") {
            options.windowTitle = params.windowTitle;
          }
          const snapshot = nativeControl.getInteractiveSnapshot(options);
          const rawElements: Array<Record<string, unknown>> = snapshot.elements ?? [];
          const totalCount = rawElements.length;

          // Strip to lean format: {id, role, name} — drop bounds/value/enabled/focused
          // to match the browser tool's token-efficient approach.
          // Include value only for text fields (useful for reading current input state).
          const slim: Array<Record<string, unknown>> = [];
          let charCount = 0;
          for (const el of rawElements) {
            const entry: Record<string, unknown> = {
              id: el.id,
              role: el.role,
              name: typeof el.name === "string" ? el.name.slice(0, 60) : "",
            };
            // Keep value for text fields so the LLM can see current input state
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

        // ─── Click element by ID ──────────────────────────────────────
        case "click_element": {
          const elementId = params.elementId;
          if (typeof elementId !== "number") {
            throw new Error("elementId (number) is required. Get IDs from a snapshot first.");
          }
          const result = nativeControl.clickElement(elementId, {});
          return jsonResult({ success: result, elementId });
        }

        // ─── Type into element ────────────────────────────────────────
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

        // ─── Press key on element ─────────────────────────────────────
        case "press_key": {
          const key = params.key;
          if (typeof key !== "string" || !key) {
            throw new Error("key (string) is required (e.g. 'Enter', 'Tab', 'Escape').");
          }
          const result = nativeControl.keyPress(key);
          return jsonResult({ success: result, key });
        }

        // ─── Find elements by criteria ────────────────────────────────
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
          const totalCount = elements.length;
          // Cap output like snapshot to prevent token bloat
          const slim: Array<Record<string, unknown>> = [];
          let charCount = 0;
          for (const el of elements) {
            const entry: Record<string, unknown> = {
              id: el.id,
              role: el.role,
              name: typeof el.name === "string" ? el.name.slice(0, 60) : "",
            };
            if (el.value) {
              entry.value = typeof el.value === "string" ? el.value.slice(0, 100) : el.value;
            }
            const elStr = JSON.stringify(entry);
            if (charCount + elStr.length + 1 > MAX_SNAPSHOT_CHARS) {
              break;
            }
            charCount += elStr.length + 1;
            slim.push(entry);
          }
          const result: Record<string, unknown> = {
            count: totalCount,
            elements: slim,
          };
          if (slim.length < totalCount) {
            result._note = `${slim.length}/${totalCount} shown. Narrow your role/name filters.`;
          }
          return jsonResult(result);
        }

        // ─── List running applications ────────────────────────────────
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

        // ─── Launch app ───────────────────────────────────────────────
        case "launch_app": {
          const bundleId = (params.bundleId ?? params.appName) as string | undefined;
          if (!bundleId) {
            throw new Error("bundleId or appName is required.");
          }
          const result = nativeControl.launchApp(bundleId);
          return jsonResult({ success: result, bundleId });
        }

        // ─── Activate (focus) app ─────────────────────────────────────
        case "activate_app": {
          const appName = params.appName;
          if (typeof appName !== "string" || !appName) {
            throw new Error("appName is required.");
          }
          const result = nativeControl.activateApp(appName);
          return jsonResult({ success: result, appName });
        }

        // ─── List windows ─────────────────────────────────────────────
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

        // ─── Focus window ─────────────────────────────────────────────
        case "focus_window": {
          const windowId = params.windowId;
          if (typeof windowId !== "number") {
            throw new Error("windowId (number) is required.");
          }
          const result = nativeControl.focusWindow(windowId);
          return jsonResult({ success: result, windowId });
        }

        // ─── Move window ──────────────────────────────────────────────
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

        // ─── Resize window ────────────────────────────────────────────
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

        // ─── Direct mouse click ───────────────────────────────────────
        case "mouse_click": {
          const x = params.mouseX ?? params.x;
          const y = params.mouseY ?? params.y;
          if (typeof x !== "number" || typeof y !== "number") {
            throw new Error("mouseX and mouseY are required.");
          }
          const result = nativeControl.click(x, y, {});
          return jsonResult({ success: result, x, y });
        }

        // ─── Direct mouse move ────────────────────────────────────────
        case "mouse_move": {
          const x = params.mouseX ?? params.x;
          const y = params.mouseY ?? params.y;
          if (typeof x !== "number" || typeof y !== "number") {
            throw new Error("mouseX and mouseY are required.");
          }
          const result = nativeControl.moveMouse(x, y);
          return jsonResult({ success: result, x, y });
        }

        // ─── Type text with keyboard ──────────────────────────────────
        case "type_text": {
          const text = params.text;
          if (typeof text !== "string" || !text) {
            throw new Error("text is required.");
          }
          const result = nativeControl.type(text);
          return jsonResult({ success: result });
        }

        // ─── Key combo (e.g. cmd+c) ──────────────────────────────────
        case "key_combo": {
          const key = params.key;
          if (typeof key !== "string" || !key) {
            throw new Error("key combo is required (e.g. 'cmd+c', 'ctrl+shift+n').");
          }
          const result = nativeControl.keyPress(key);
          return jsonResult({ success: result, key });
        }

        // ─── Scroll ───────────────────────────────────────────────────
        case "scroll": {
          const deltaX = typeof params.deltaX === "number" ? params.deltaX : 0;
          const deltaY = typeof params.deltaY === "number" ? params.deltaY : -3;
          const result = nativeControl.scroll({ deltaX, deltaY });
          return jsonResult({ success: result, deltaX, deltaY });
        }

        // ─── Get display info ─────────────────────────────────────────
        case "get_displays": {
          const displays = nativeControl.getDisplays();
          return jsonResult({ displays });
        }

        // ─── Insert text at cursor (no clipboard) ─────────────────────
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
    },
  };
}
