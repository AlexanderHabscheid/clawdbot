/**
 * Centris Browser Tool
 *
 * Controls the user's REAL Chrome browser through the Centris Chrome extension.
 * No Playwright. No screenshots. DOM snapshots only.
 *
 * The extension connects to the gateway via WebSocket (/ws/centris/extension).
 * This tool sends commands to the extension and receives structured results.
 *
 * Available actions:
 *   snapshot    — Get a DOM snapshot of interactive elements (buttons, inputs, links)
 *   click       — Click an element by nodeId from the snapshot
 *   type        — Type text into an element by nodeId
 *   navigate    — Navigate the active tab to a URL
 *   scroll      — Scroll the page (up/down)
 *   press_key   — Press a keyboard key (Enter, Tab, Escape, etc.)
 *   tabs        — List open browser tabs
 *   read_page   — Extract readable text content from the page
 */

import { Type } from "@sinclair/typebox";
import {
  isCentrisExtensionConnected,
  sendExtensionCommand,
  waitForExtension,
} from "../../gateway/centris-extension-bridge.js";
import {
  resolveManifestForUrl,
  formatManifestForToolResultJson,
} from "../centris-manifest-bridge.js";
import { stringEnum, optionalStringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";

const CENTRIS_BROWSER_ACTIONS = [
  "snapshot",
  "click",
  "type",
  "navigate",
  "scroll",
  "press_key",
  "tabs",
  "read_page",
] as const;

const SCROLL_DIRECTIONS = ["up", "down"] as const;

export const CentrisBrowserToolSchema = Type.Object({
  action: stringEnum(CENTRIS_BROWSER_ACTIONS),
  // click / type: nodeId from a previous snapshot
  nodeId: Type.Optional(Type.Number()),
  // type: the text to type
  text: Type.Optional(Type.String()),
  // navigate: target URL
  url: Type.Optional(Type.String()),
  // scroll: direction
  direction: optionalStringEnum(SCROLL_DIRECTIONS),
  // scroll: amount in pixels
  amount: Type.Optional(Type.Number()),
  // press_key: key name (Enter, Tab, Escape, etc.)
  key: Type.Optional(Type.String()),
  // press_key: modifier keys
  ctrl: Type.Optional(Type.Boolean()),
  alt: Type.Optional(Type.Boolean()),
  shift: Type.Optional(Type.Boolean()),
  meta: Type.Optional(Type.Boolean()),
  // snapshot: instruction for keyword-aware filtering
  instruction: Type.Optional(Type.String()),
});

export function createCentrisBrowserTool(): AnyAgentTool {
  return {
    label: "CentrisBrowser",
    name: "centris_browser",
    description: [
      "Control the user's real Chrome browser.",
      "",
      "navigate: goes to URL AND returns interactive elements. No separate snapshot needed.",
      "click: clicks nodeId AND returns post-click elements + page content. No separate snapshot or read_page needed.",
      "type: with nodeId types into that element. WITHOUT nodeId types at current cursor/focus — batch click+type in one turn.",
      "snapshot: only if you need to re-examine elements without navigating/clicking.",
      "read_page: only if you need page text without clicking.",
      "",
      "Elements: {id, t, n} — id=nodeId, t=cl/ty/se, n=label.",
      "BATCH tool calls: click + type(no nodeId) in same turn when click opens an editor.",
    ].join("\n"),
    parameters: CentrisBrowserToolSchema,
    execute: async (_toolCallId, args) => {
      // Wait up to 10s for extension reconnect (MV3 service worker may be waking)
      if (!isCentrisExtensionConnected()) {
        const reconnected = await waitForExtension(10_000);
        if (!reconnected) {
          return jsonResult({
            error:
              "Chrome extension not connected. The user needs to have the Centris Chrome extension installed and their browser open.",
            connected: false,
          });
        }
      }

      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      switch (action) {
        // ─── Snapshot (DOM only, never screenshot) ─────────────────────
        case "snapshot": {
          const instruction =
            typeof params.instruction === "string" ? params.instruction : undefined;
          const result = await sendExtensionCommand("get_interactive_snapshot", {
            instruction,
            maxChars: 4000, // ~1K tokens. Explicit so extension doesn't fall back to 100K default.
          });
          const snapshot = result as Record<string, unknown>;

          // Strip fields the LLM doesn't need. _internalNodes is the full DOM dump
          // used only by the extension for click resolution (it keeps its own copy).
          delete snapshot._internalNodes;
          delete snapshot.hasCanvasEditor;
          delete snapshot.hasInputCapture;
          delete snapshot.duration_ms;
          delete snapshot.snapshotId;
          delete snapshot.timestamp;
          delete snapshot.success;

          // Strip each element to just what the LLM needs: {id, t, n, r}
          // The old Centris system only sent these 4 fields.
          // Bounds (b) and stableHash (h) are for extension-internal click resolution
          // — the extension keeps its own copy. Stripping them saves ~45% per element.
          const nodes = snapshot?.interactiveNodes;
          if (Array.isArray(nodes)) {
            const totalCount = nodes.length;
            const slim: Array<Record<string, unknown>> = [];
            let charCount = 0;
            const MAX_SNAPSHOT_CHARS = 4000;

            for (const node of nodes) {
              const el: Record<string, unknown> = {
                id: node.id ?? node.nodeId,
                t: node.t ?? node.type,
                n: typeof node.n === "string" ? node.n.slice(0, 60) : (node.name ?? ""),
              };
              // Only include role if it adds info (skip generic "link", "button" when type says it)
              if (node.r && node.r !== "link" && node.r !== "button") {
                el.r = node.r;
              }
              const elStr = JSON.stringify(el);
              if (charCount + elStr.length + 1 > MAX_SNAPSHOT_CHARS) {
                break;
              }
              charCount += elStr.length + 1;
              slim.push(el);
            }
            snapshot.interactiveNodes = slim;
            if (slim.length < totalCount) {
              snapshot._note = `${slim.length}/${totalCount} shown. Pass instruction="..." to filter.`;
            }
          }

          // Strip metadata to bare minimum
          const meta = snapshot.metadata as Record<string, unknown> | undefined;
          if (meta) {
            snapshot.metadata = { url: meta.url };
          }

          return jsonResult(snapshot);
        }

        // ─── Click by nodeId ───────────────────────────────────────────
        // Old Centris: click returned post-click state so the LLM didn't
        // need a separate snapshot call. We do the same — click, wait briefly
        // for DOM to settle, then include a mini snapshot in the response.
        case "click": {
          const nodeId = params.nodeId;
          if (typeof nodeId !== "number") {
            throw new Error(
              "nodeId (number) is required for click action. Get nodeIds from a snapshot first.",
            );
          }
          const clickResult = (await sendExtensionCommand("click_node", { nodeId })) as Record<
            string,
            unknown
          >;

          // After click: grab post-click elements AND page content so the LLM
          // can respond immediately without a separate read_page turn.
          // This collapses the flow from 4 turns to 3:
          //   Turn 1: navigate → elements
          //   Turn 2: click → elements + page content (this)
          //   Turn 3: text summary
          if (clickResult.success !== false) {
            try {
              await new Promise((r) => setTimeout(r, 500));
              // Fetch snapshot and readable content in parallel
              const [snap, readable] = await Promise.all([
                sendExtensionCommand("get_interactive_snapshot", {
                  maxChars: 4000,
                }) as Promise<Record<string, unknown>>,
                sendExtensionCommand("get_readable_content", {}) as Promise<
                  Record<string, unknown>
                >,
              ]);
              const nodes = snap?.interactiveNodes;
              if (Array.isArray(nodes)) {
                const slim = nodes.slice(0, 20).map((node: Record<string, unknown>) => ({
                  id: node.id ?? node.nodeId,
                  t: node.t ?? node.type,
                  n: typeof node.n === "string" ? node.n.slice(0, 60) : (node.name ?? ""),
                }));
                clickResult.postClickElements = slim;
                clickResult.url = (snap.metadata as Record<string, unknown>)?.url;
              }
              // Include page content so model doesn't need a separate read_page call
              let content =
                typeof readable.content === "string"
                  ? readable.content
                  : typeof readable.text === "string"
                    ? readable.text
                    : undefined;
              if (typeof content === "string") {
                if (content.length > 3000) {
                  content = content.slice(0, 3000) + "\n...[truncated]";
                }
                clickResult.pageContent = content;
              }
            } catch {
              /* snapshot/content failure shouldn't break click */
            }
          }

          // Inject manifest context for click results too — the LLM may be
          // mid-way through an action recipe and needs the landmarks/actions.
          try {
            const clickUrl = clickResult.url as string | undefined;
            if (clickUrl) {
              const resolved = resolveManifestForUrl(clickUrl);
              if (resolved) {
                clickResult._manifest = formatManifestForToolResultJson(resolved);
              }
            }
          } catch {
            /* manifest resolution failure shouldn't break click */
          }

          return jsonResult(clickResult);
        }

        // ─── Type text ────────────────────────────────────────────────
        // With nodeId: types into a specific element (standard flow).
        // Without nodeId: types at current cursor/focus position via global_type.
        // This enables batching click + type in one turn — click opens the
        // editor, type fires immediately into it without needing the editor's nodeId.
        case "type": {
          const nodeId = params.nodeId;
          const text = typeof params.text === "string" ? params.text : "";
          if (!text) {
            throw new Error("text is required for type action.");
          }
          if (typeof nodeId === "number") {
            const result = await sendExtensionCommand("type_into_node", {
              nodeId,
              text,
            });
            return jsonResult(result);
          }
          // No nodeId: type into the currently focused element
          const result = await sendExtensionCommand("global_type", { text });
          return jsonResult(result);
        }

        // ─── Navigate to URL ───────────────────────────────────────────
        // Old Centris: navigate always returned interactive elements so the
        // LLM could act immediately without a separate snapshot turn.
        case "navigate": {
          const url = typeof params.url === "string" ? params.url.trim() : "";
          if (!url) {
            throw new Error("url is required for navigate action.");
          }
          const navResult = (await sendExtensionCommand("navigate_browser", {
            url,
          })) as Record<string, unknown>;

          // Auto-include a snapshot so the LLM sees the page in the same turn.
          // This saves a full round-trip (old system: 7 turns → 3 turns).
          if (navResult.success !== false) {
            try {
              // Wait for page load before snapshotting.
              // 500ms was too short for heavy SPAs (Gmail, etc.) — returned 1 element
              // and forced extra read_page + snapshot calls (6 turns instead of 3).
              await new Promise((r) => setTimeout(r, 1500));
              const snap = (await sendExtensionCommand("get_interactive_snapshot", {
                instruction:
                  typeof params.instruction === "string" ? params.instruction : undefined,
                maxChars: 4000,
              })) as Record<string, unknown>;
              // Build landmark lookup from _internalNodes before stripping.
              // The extension tags each element with its closest semantic container
              // (main, nav, form, search). This lets us filter generically —
              // no hardcoded site-specific names.
              const internalNodes = snap._internalNodes as
                | Array<Record<string, unknown>>
                | undefined;
              const landmarkByNodeId = new Map<number, string>();
              const boundsByNodeId = new Map<
                number,
                { x: number; y: number; w: number; h: number }
              >();
              if (Array.isArray(internalNodes)) {
                for (const inode of internalNodes) {
                  const nid = (inode.nodeId as number) ?? (inode.id as number);
                  if (typeof inode.landmarkRole === "string" && inode.landmarkRole) {
                    landmarkByNodeId.set(nid, inode.landmarkRole);
                  }
                  const b = inode.bounds as
                    | { x: number; y: number; width: number; height: number }
                    | undefined;
                  if (b) {
                    boundsByNodeId.set(nid, {
                      x: b.x,
                      y: b.y,
                      w: b.width,
                      h: b.height,
                    });
                  }
                }
              }
              delete snap._internalNodes;

              const nodes = snap?.interactiveNodes;
              if (Array.isArray(nodes)) {
                const totalCount = nodes.length;

                // Generic content-vs-chrome classification using landmarks + position.
                // Works on any website — no hardcoded names.
                // Strategy: prefer elements in <main> / role="main". Exclude elements
                // in <nav> / role="navigation". For pages without landmarks, use
                // position heuristic (sidebar items tend to be x < 200px).
                const mainContent: Array<Record<string, unknown>> = [];
                const other: Array<Record<string, unknown>> = [];
                const GENERIC_NAMES = new Set(["div", "span", "a"]);

                for (const node of nodes) {
                  const nid = (node.id ?? node.nodeId) as number;
                  const type = node.t ?? node.type;
                  const name: string =
                    typeof node.n === "string"
                      ? node.n
                      : typeof node.name === "string"
                        ? node.name
                        : "";
                  // Always skip checkboxes and very short/generic names
                  if (type === "se") {
                    continue;
                  }
                  if (name.length < 3) {
                    continue;
                  }
                  if (GENERIC_NAMES.has(name)) {
                    continue;
                  }

                  const landmark = landmarkByNodeId.get(nid) ?? "";
                  const bounds = boundsByNodeId.get(nid);

                  // Classify: main content vs chrome
                  const isNav = landmark === "navigation" || landmark === "nav";
                  const isMain = landmark === "main";
                  // Position heuristic: sidebar items typically x < 200
                  const isSidebarPosition = bounds && bounds.x < 200;

                  if (isNav || (isSidebarPosition && !isMain)) {
                    other.push(node);
                  } else {
                    mainContent.push(node);
                  }
                }

                // Prefer main content elements; fall back to all if no landmark data
                const source = mainContent.length > 0 ? mainContent : [...mainContent, ...other];
                const slim: Array<Record<string, unknown>> = [];
                let charCount = 0;
                for (const node of source) {
                  const type = node.t ?? node.type;
                  const name: string =
                    typeof node.n === "string"
                      ? node.n
                      : typeof node.name === "string"
                        ? node.name
                        : "";
                  const el: Record<string, unknown> = {
                    id: node.id ?? node.nodeId,
                    t: type,
                    n: name.slice(0, 60),
                  };
                  if (node.r && node.r !== "link" && node.r !== "button") {
                    el.r = node.r;
                  }
                  const elStr = JSON.stringify(el);
                  if (charCount + elStr.length + 1 > 4000) {
                    break;
                  }
                  charCount += elStr.length + 1;
                  slim.push(el);
                }
                navResult.interactiveNodes = slim;
                if (slim.length < totalCount) {
                  navResult._note = `${slim.length}/${totalCount} shown`;
                }
              }
              navResult.url = (snap.metadata as Record<string, unknown>)?.url ?? url;
            } catch {
              /* snapshot failure shouldn't break navigate */
            }
          }
          // Strip verbose fields the LLM doesn't need
          delete navResult.requestedUrl;
          delete navResult.navigated;
          delete navResult.tabId;
          delete navResult.loadTime;
          delete navResult.duration_ms;

          // Check if this URL has a pre-mapped manifest.
          // If yes, inject the semantic map so the LLM can follow action recipes
          // instead of discovering elements through expensive snapshot cycles.
          try {
            const finalUrl = (navResult.url as string) ?? url;
            const resolved = resolveManifestForUrl(finalUrl);
            if (resolved) {
              navResult._manifest = formatManifestForToolResultJson(resolved);
            }
          } catch {
            /* manifest resolution failure shouldn't break navigate */
          }

          return jsonResult(navResult);
        }

        // ─── Scroll ────────────────────────────────────────────────────
        case "scroll": {
          const direction = typeof params.direction === "string" ? params.direction : "down";
          const amount = typeof params.amount === "number" ? params.amount : 400;
          const result = await sendExtensionCommand("scroll", {
            direction,
            amount,
          });
          return jsonResult(result);
        }

        // ─── Press key ─────────────────────────────────────────────────
        case "press_key": {
          const key = typeof params.key === "string" ? params.key : "";
          if (!key) {
            throw new Error("key is required for press_key action (e.g. Enter, Tab, Escape).");
          }
          const result = await sendExtensionCommand("press_key", {
            key,
            ctrl: Boolean(params.ctrl),
            alt: Boolean(params.alt),
            shift: Boolean(params.shift),
            meta: Boolean(params.meta),
          });
          return jsonResult(result);
        }

        // ─── List tabs ─────────────────────────────────────────────────
        case "tabs": {
          const result = await sendExtensionCommand("get_tabs", {});
          return jsonResult(result);
        }

        // ─── Read page content ─────────────────────────────────────────
        case "read_page": {
          const result = (await sendExtensionCommand("get_readable_content", {})) as Record<
            string,
            unknown
          >;
          // Cap readable content to prevent token bloat on long pages.
          // The extension may return both `content` and `text` with identical data —
          // delete the duplicate and cap the survivor aggressively.
          const MAX_CONTENT_CHARS = 4000;
          // Prefer `content`; drop `text` if it's a duplicate
          if (typeof result.text === "string" && typeof result.content === "string") {
            delete result.text;
          } else if (typeof result.text === "string" && !result.content) {
            result.content = result.text;
            delete result.text;
          }
          if (typeof result.content === "string" && result.content.length > MAX_CONTENT_CHARS) {
            result.content =
              result.content.slice(0, MAX_CONTENT_CHARS) + "\n...[content truncated]";
          }
          // Strip verbose metadata the LLM doesn't need
          delete result.contentLength;
          delete result.method;
          delete result.truncated;
          return jsonResult(result);
        }

        default:
          throw new Error(`Unknown centris_browser action: ${action}`);
      }
    },
  };
}
