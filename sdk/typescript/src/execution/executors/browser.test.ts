import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExecutorContext } from "../types.js";
import { persistLearnedRoute } from "../../kernel/learned-routes.js";
import { BrowserExecutor } from "./browser.js";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs.length = 0;
});

describe("BrowserExecutor", () => {
  it("returns NO_BRIDGE when unbound", async () => {
    const executor = new BrowserExecutor();
    const result = await executor.execute("slack", "send", {}, { uiMappings: [] });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NO_BRIDGE");
    }
  });

  it("returns NO_UI_MAPPINGS when context has no mappings", async () => {
    const executor = new BrowserExecutor({
      sendCommand: vi.fn(),
      isConnected: () => true,
      autoLearn: false,
    });

    const result = await executor.execute("slack", "send", {}, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NO_UI_MAPPINGS");
    }
  });

  it("converts mappings into extension commands", async () => {
    const sendCommand = vi.fn().mockResolvedValue({ ok: true });
    const executor = new BrowserExecutor({
      sendCommand,
      isConnected: () => true,
      autoLearn: false,
    });

    const context: ExecutorContext = {
      uiMappings: [
        {
          selector: "#composer",
          nodeId: 42,
          semanticRole: "send_message",
          action: "click",
          context: ["send_message"],
        },
        {
          selector: "#composer",
          nodeId: 43,
          semanticRole: "message",
          action: "type",
          context: ["send_message", "message"],
        },
      ],
    };

    const result = await executor.execute(
      "slack",
      "send_message",
      { message: "hello world" },
      context,
    );

    expect(result.ok).toBe(true);
    expect(sendCommand).toHaveBeenCalledTimes(2);
    expect(sendCommand).toHaveBeenNthCalledWith(1, "click_node", {
      nodeId: 42,
    });
    expect(sendCommand).toHaveBeenNthCalledWith(2, "type_text", {
      nodeId: 43,
      text: "hello world",
    });
  });

  it("returns NO_ACTIONS when only selector-based mappings are provided", async () => {
    const sendCommand = vi.fn().mockResolvedValue({ ok: true });
    const executor = new BrowserExecutor({
      sendCommand,
      isConnected: () => true,
      autoLearn: false,
    });

    const context: ExecutorContext = {
      uiMappings: [
        {
          selector: "#primary",
          semanticRole: "send_message",
          action: "click",
          context: ["send_message"],
        },
        {
          selector: "[data-testid='send']",
          semanticRole: "send_message",
          action: "click",
          context: ["send_message"],
        },
      ],
    };

    const result = await executor.execute("slack", "send_message", {}, context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NO_ACTIONS");
    }
    expect(sendCommand).toHaveBeenCalledTimes(0);
  });

  it("fails nodeId action when nodeId is stale instead of silently falling back to selectors", async () => {
    const sendCommand = vi.fn(async (type: string, data?: Record<string, unknown>) => {
      if (type === "type_text" && typeof data?.nodeId === "number") {
        throw new Error("stale node id");
      }
      return { ok: true };
    });
    const executor = new BrowserExecutor({
      sendCommand,
      isConnected: () => true,
      autoLearn: false,
    });

    const context: ExecutorContext = {
      uiMappings: [
        {
          selector: "#composer",
          nodeId: 42,
          semanticRole: "message",
          action: "type",
          context: ["send_message", "message"],
        },
        {
          selector: "[data-testid='composer']",
          semanticRole: "message",
          action: "type",
          context: ["send_message", "message"],
        },
      ],
    };

    const result = await executor.execute(
      "slack",
      "send_message",
      { message: "hello world" },
      context,
    );
    expect(result.ok).toBe(false);
    expect(sendCommand).toHaveBeenNthCalledWith(1, "type_text", {
      nodeId: 42,
      text: "hello world",
    });
    expect(sendCommand).toHaveBeenCalledTimes(1);
  });

  it("reports availability from bound connection probe", async () => {
    const executor = new BrowserExecutor({
      sendCommand: vi.fn(),
      isConnected: () => true,
      autoLearn: false,
    });

    await expect(executor.isAvailable()).resolves.toBe(true);
  });

  it("auto-binds bridge functions from runtime metadata", async () => {
    const sendCommand = vi.fn().mockResolvedValue({ ok: true });
    const isConnected = vi.fn().mockReturnValue(true);
    const executor = new BrowserExecutor();

    const context: ExecutorContext = {
      metadata: {
        sendExtensionCommand: sendCommand,
        isCentrisExtensionConnected: isConnected,
      },
      uiMappings: [
        {
          selector: "#go",
          nodeId: 7,
          semanticRole: "open",
          action: "click",
          context: ["open_page"],
        },
      ],
    };

    const result = await executor.execute("demo", "open_page", {}, context);

    expect(result.ok).toBe(true);
    expect(sendCommand).toHaveBeenCalledWith("click_node", {
      nodeId: 7,
    });
  });

  it("auto-learns routes from live browser traces", async () => {
    const learnBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), "centris-browser-learn-"));
    tmpDirs.push(learnBaseDir);

    const sendCommand = vi.fn(async (type: string, data?: Record<string, unknown>) => {
      if (type === "navigate") {
        return { ok: true, url: data?.url };
      }
      if (type === "get_interactive_snapshot") {
        return {
          interactiveNodes: [
            { id: 42, selector: "#composer" },
            { id: 7, selector: "#send" },
          ],
        };
      }
      return { ok: true };
    });
    const executor = new BrowserExecutor({
      sendCommand,
      isConnected: () => true,
      learnBaseDir,
    });

    const context: ExecutorContext = {
      uiMappings: [
        {
          selector: "#send",
          nodeId: 7,
          semanticRole: "send_message",
          action: "click",
          context: ["send_message"],
        },
        {
          selector: "#composer",
          nodeId: 42,
          semanticRole: "message",
          action: "type",
          context: ["send_message", "message"],
        },
      ],
    };

    const result = await executor.execute(
      "slack",
      "send_message",
      { url: "https://app.slack.com/client/T1/C1", message: "hello world" },
      context,
    );
    expect(result.ok).toBe(true);

    const manifestPath = path.join(learnBaseDir, "slack", "centris.json");
    expect(fs.existsSync(manifestPath)).toBe(true);
    const raw = fs.readFileSync(manifestPath, "utf-8");
    const parsed = JSON.parse(raw) as {
      url_patterns: string[];
      routes: Record<
        string,
        { actions?: Record<string, { steps: unknown[]; fallbackChains?: string[][] }> }
      >;
    };
    expect(parsed.url_patterns).toContain("https://app.slack.com/*");
    expect(parsed.routes["/*"]?.actions?.["slack.send_message"]?.steps.length).toBeGreaterThan(0);
    expect(
      parsed.routes["/*"]?.actions?.["slack.send_message"]?.fallbackChains?.length,
    ).toBeGreaterThan(0);
  });

  it("down-ranks learned routes on execution failure", async () => {
    const learnBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), "centris-browser-learn-"));
    tmpDirs.push(learnBaseDir);

    persistLearnedRoute({
      baseDir: learnBaseDir,
      appId: "slack",
      now: new Date("2026-02-19T00:00:00.000Z"),
      request: {
        id: "slack.send_message",
        urlPattern: "https://app.slack.com/*",
        steps: [{ click: "#send" }],
      },
    });

    const sendCommand = vi.fn(async (type: string) => {
      if (type === "click_node") {
        throw new Error("click failed");
      }
      return { ok: true };
    });
    const executor = new BrowserExecutor({
      sendCommand,
      isConnected: () => true,
      learnBaseDir,
    });
    const context: ExecutorContext = {
      uiMappings: [
        {
          selector: "#send",
          semanticRole: "send_message",
          action: "click",
          context: ["send_message"],
        },
      ],
    };

    const result = await executor.execute(
      "slack",
      "send_message",
      { url: "https://app.slack.com/client/T1/C1" },
      context,
    );
    expect(result.ok).toBe(false);

    const manifestPath = path.join(learnBaseDir, "slack", "centris.json");
    const raw = fs.readFileSync(manifestPath, "utf-8");
    const parsed = JSON.parse(raw) as {
      routes: Record<string, { actions?: Record<string, { confidence?: number }> }>;
    };
    expect((parsed.routes["/*"]?.actions?.["slack.send_message"]?.confidence ?? 1) < 0.8).toBe(
      true,
    );
  });
});
