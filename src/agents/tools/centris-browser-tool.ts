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
} from "../../gateway/centris-extension-bridge.js";
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
      "click: clicks nodeId AND returns post-click page elements. No separate snapshot needed.",
      "type: types text into nodeId.",
      "snapshot: get current page elements (only if you need to re-examine without navigating/clicking).",
      "read_page: get readable text content of current page.",
      "scroll/press_key/tabs: other actions.",
      "",
      "Elements: {id, t, n} — id=nodeId for click/type, t=cl/ty/se, n=label.",
      "Typical 3-turn flow: navigate → click → read_page+respond.",
    ].join("\n"),
    parameters: CentrisBrowserToolSchema,
    execute: async (_toolCallId, args) => {
      if (!isCentrisExtensionConnected()) {
        return jsonResult({
          error:
            "Chrome extension not connected. The user needs to have the Centris Chrome extension installed and their browser open.",
          connected: false,
        });
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

          // If click succeeded, grab a quick post-click snapshot so the LLM
          // sees the new page state without needing another turn.
          if (clickResult.success !== false) {
            try {
              // Small delay for DOM to settle after click
              await new Promise((r) => setTimeout(r, 300));
              const snap = (await sendExtensionCommand("get_interactive_snapshot", {
                maxChars: 4000,
              })) as Record<string, unknown>;
              const nodes = snap?.interactiveNodes;
              if (Array.isArray(nodes)) {
                const slim = nodes.slice(0, 30).map((node: Record<string, unknown>) => ({
                  id: node.id ?? node.nodeId,
                  t: node.t ?? node.type,
                  n: typeof node.n === "string" ? node.n.slice(0, 60) : (node.name ?? ""),
                }));
                clickResult.postClickElements = slim;
                clickResult.url = (snap.metadata as Record<string, unknown>)?.url;
              }
              delete snap._internalNodes;
            } catch {
              /* snapshot failure shouldn't break click */
            }
          }
          return jsonResult(clickResult);
        }

        // ─── Type into element by nodeId ───────────────────────────────
        case "type": {
          const nodeId = params.nodeId;
          const text = typeof params.text === "string" ? params.text : "";
          if (typeof nodeId !== "number") {
            throw new Error(
              "nodeId (number) is required for type action. Get nodeIds from a snapshot first.",
            );
          }
          if (!text) {
            throw new Error("text is required for type action.");
          }
          const result = await sendExtensionCommand("type_into_node", {
            nodeId,
            text,
          });
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
              // Wait for page load before snapshotting
              await new Promise((r) => setTimeout(r, 500));
              const snap = (await sendExtensionCommand("get_interactive_snapshot", {
                instruction:
                  typeof params.instruction === "string" ? params.instruction : undefined,
                maxChars: 4000,
              })) as Record<string, unknown>;
              delete snap._internalNodes;
              const nodes = snap?.interactiveNodes;
              if (Array.isArray(nodes)) {
                const totalCount = nodes.length;
                const slim: Array<Record<string, unknown>> = [];
                let charCount = 0;
                for (const node of nodes) {
                  const el: Record<string, unknown> = {
                    id: node.id ?? node.nodeId,
                    t: node.t ?? node.type,
                    n: typeof node.n === "string" ? node.n.slice(0, 60) : (node.name ?? ""),
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
                  navResult._note = `${slim.length}/${totalCount} elements. Use snapshot with instruction to filter.`;
                }
              }
              navResult.url = (snap.metadata as Record<string, unknown>)?.url ?? url;
            } catch {
              /* snapshot failure shouldn't break navigate */
            }
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
          // Cap readable content to prevent token bloat on long pages
          const MAX_CONTENT_CHARS = 6000;
          if (typeof result.content === "string" && result.content.length > MAX_CONTENT_CHARS) {
            result.content =
              result.content.slice(0, MAX_CONTENT_CHARS) + "\n...[content truncated]";
          }
          return jsonResult(result);
        }

        default:
          throw new Error(`Unknown centris_browser action: ${action}`);
      }
    },
  };
}
