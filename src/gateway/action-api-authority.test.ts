import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./centris-extension-bridge.js", () => ({
  isCentrisExtensionConnected: vi.fn(),
  sendExtensionCommand: vi.fn(),
}));
vi.mock("./centris-desktop-bridge.js", () => ({
  isCentrisDesktopConnected: vi.fn(),
  sendDesktopCommand: vi.fn(),
}));
vi.mock("../../sdk/typescript/src/manifest/loader.js", () => ({
  loadManifests: vi.fn(() => []),
}));
vi.mock("../../sdk/typescript/src/kernel/learned-routes.js", () => ({
  persistLearnedRoute: vi.fn(),
  updateLearnedRouteOutcome: vi.fn(),
}));

import { persistLearnedRoute } from "../../sdk/typescript/src/kernel/learned-routes.js";
import { loadManifests } from "../../sdk/typescript/src/manifest/loader.js";
import { handleActionApiEnvelope } from "./action-api-authority.js";
import { isCentrisDesktopConnected, sendDesktopCommand } from "./centris-desktop-bridge.js";
import { isCentrisExtensionConnected, sendExtensionCommand } from "./centris-extension-bridge.js";

describe("handleActionApiEnvelope", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(isCentrisExtensionConnected).mockReturnValue(true);
    vi.mocked(isCentrisDesktopConnected).mockReturnValue(true);
    await handleActionApiEnvelope({
      method: "web.memory.invalidate",
      params: { scope: "all" },
    });
  });

  it("persists recorded routes into learned manifest storage on record-stop", async () => {
    vi.mocked(isCentrisExtensionConnected).mockReturnValue(true);
    vi.mocked(sendExtensionCommand).mockResolvedValue({ success: true });

    const started = await handleActionApiEnvelope({
      method: "route.record.start",
      params: {
        intent: "submit form",
        url: "https://example.com/forms",
      },
    });
    expect(started.ok).toBe(true);
    const sessionId = (started.result as { sessionId: string }).sessionId;

    await handleActionApiEnvelope({
      method: "act",
      params: {
        kind: "click",
        target: "#submit",
      },
    });

    const stopped = await handleActionApiEnvelope({
      method: "route.record.stop",
      params: {
        sessionId,
        outcome: "success",
      },
    });

    expect(stopped.ok).toBe(true);
    const routeId = (stopped.result as { routeId: string }).routeId;
    expect(vi.mocked(persistLearnedRoute)).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          id: routeId,
          urlPattern: "https://example.com/*",
        }),
      }),
    );
  });

  it("runs route from persisted manifests when in-memory route cache is empty", async () => {
    vi.mocked(isCentrisExtensionConnected).mockReturnValue(true);
    vi.mocked(sendExtensionCommand).mockResolvedValue({ success: true });
    const routeId = `persisted_route_${Date.now()}`;

    vi.mocked(loadManifests).mockReturnValue([
      {
        source: "/tmp/centris.json",
        manifest: {
          centris: "2.0",
          app: "example",
          description: "example",
          url_patterns: ["https://example.com/*"],
          routes: {
            "/forms": {
              actions: {
                [routeId]: {
                  description: "submit",
                  steps: [{ press: "Enter" }],
                },
              },
            },
          },
        },
      },
    ]);

    const result = await handleActionApiEnvelope({
      method: "route.run",
      params: {
        routeId,
        url: "https://example.com/forms",
      },
    });
    expect(result.ok).toBe(true);
    expect(vi.mocked(sendExtensionCommand)).toHaveBeenCalledWith("press_key", {
      key: "Enter",
    });
  });

  it("returns bridge error when extension is disconnected", async () => {
    vi.mocked(isCentrisExtensionConnected).mockReturnValue(false);

    const result = await handleActionApiEnvelope({
      method: "observe",
      params: {},
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("BRIDGE_NOT_CONNECTED");
  });

  it("validates web memory payloads without requiring browser bridge", async () => {
    vi.mocked(isCentrisExtensionConnected).mockReturnValue(false);

    const result = await handleActionApiEnvelope({
      method: "web.memory.validate",
      params: {
        strict: true,
        payload: {
          url: "https://example.com/billing",
          actionIndex: [
            {
              actionId: "open_invoices",
              intent: "open invoices",
              affordance: "click",
              anchors: [{ anchorType: "test_id", value: "invoices-link" }],
            },
          ],
        },
      },
    });

    expect(result.ok).toBe(true);
    expect((result.result as { ok: boolean }).ok).toBe(true);
  });

  it("returns desktop bridge error when desktop is disconnected", async () => {
    vi.mocked(isCentrisDesktopConnected).mockReturnValue(false);

    const result = await handleActionApiEnvelope({
      method: "desktop.apps",
      params: {},
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("DESKTOP_NOT_CONNECTED");
  });

  it("handles desktop snapshot/apps/click methods", async () => {
    vi.mocked(isCentrisDesktopConnected).mockReturnValue(true);
    vi.mocked(sendDesktopCommand)
      .mockResolvedValueOnce({
        appName: "Safari",
        windowTitle: "Tab 1",
        elements: [{ id: 1, role: "AXButton", name: "OK", value: null }],
      })
      .mockResolvedValueOnce([{ name: "Safari" }, { name: "Slack" }])
      .mockResolvedValueOnce({ clicked: true });

    const snapshot = await handleActionApiEnvelope({
      method: "desktop.snapshot",
      params: { appName: "Safari" },
    });
    expect(snapshot.ok).toBe(true);
    expect(vi.mocked(sendDesktopCommand)).toHaveBeenCalledWith("snapshot", {
      appName: "Safari",
      windowTitle: undefined,
    });

    const apps = await handleActionApiEnvelope({
      method: "desktop.apps",
      params: {},
    });
    expect(apps.ok).toBe(true);
    expect(apps.result).toEqual({ apps: [{ name: "Safari" }, { name: "Slack" }] });

    const click = await handleActionApiEnvelope({
      method: "desktop.click",
      params: { elementId: 7 },
    });
    expect(click.ok).toBe(true);
    expect(vi.mocked(sendDesktopCommand)).toHaveBeenLastCalledWith("click_element", {
      elementId: 7,
    });
  });

  it("prefers request routeMemory when confidence is high", async () => {
    vi.mocked(isCentrisExtensionConnected).mockReturnValue(true);
    vi.mocked(sendExtensionCommand).mockResolvedValue({ success: true });

    const result = await handleActionApiEnvelope({
      method: "route.run",
      params: {
        routeId: "download_latest",
        url: "https://example.com/billing",
        actionIndex: [
          {
            actionId: "open_invoices",
            affordance: "click",
            nodeHints: [{ selector: "#invoices-link" }],
            confidence: 0.9,
          },
        ],
        routeMemory: {
          routeId: "download_latest",
          confidence: 0.9,
          steps: [{ actionId: "open_invoices", operation: "click" }],
        },
      },
    });

    expect(result.ok).toBe(true);
    expect((result.result as { source?: string }).source).toBe("memory");
    expect(vi.mocked(sendExtensionCommand)).toHaveBeenCalledWith("click_node", {
      selector: "#invoices-link",
    });
  });

  it("falls back to manifest route when routeMemory confidence is low", async () => {
    vi.mocked(isCentrisExtensionConnected).mockReturnValue(true);
    vi.mocked(sendExtensionCommand).mockResolvedValue({ success: true });
    const routeId = `manifest_route_${Date.now()}`;
    vi.mocked(loadManifests).mockReturnValue([
      {
        source: "/tmp/centris.json",
        manifest: {
          centris: "2.0",
          app: "example",
          description: "example",
          url_patterns: ["https://example.com/*"],
          routes: {
            "/billing": {
              actions: {
                [routeId]: {
                  description: "submit",
                  steps: [{ press: "Enter" }],
                },
              },
            },
          },
        },
      },
    ]);

    const result = await handleActionApiEnvelope({
      method: "route.run",
      params: {
        routeId,
        url: "https://example.com/billing",
        routeMemory: {
          routeId,
          confidence: 0.2,
          steps: [{ operation: "click" }],
        },
      },
    });

    expect(result.ok).toBe(true);
    expect((result.result as { source?: string }).source).toBe("manifest");
    expect(vi.mocked(sendExtensionCommand)).toHaveBeenCalledWith("press_key", {
      key: "Enter",
    });
  });

  it("indexes, resolves, executes, invalidates, and reports web memory stats", async () => {
    vi.mocked(isCentrisExtensionConnected).mockReturnValue(true);
    vi.mocked(sendExtensionCommand).mockResolvedValue({ success: true });

    const indexResult = await handleActionApiEnvelope({
      method: "web.memory.index",
      params: {
        url: "https://example.com/billing",
        intent: "open invoices",
        pageFingerprint: { fingerprintId: "billing-v3", confidence: 0.9 },
        actionIndex: [
          {
            actionId: "open_invoices",
            affordance: "click",
            nodeHints: [{ selector: "#invoices-link" }],
            confidence: 0.9,
          },
        ],
        routeMemory: {
          routeId: "open_invoice_route",
          confidence: 0.9,
          steps: [{ actionId: "open_invoices", operation: "click" }],
        },
      },
    });
    expect(indexResult.ok).toBe(true);

    const resolved = await handleActionApiEnvelope({
      method: "web.memory.resolve",
      params: {
        url: "https://example.com/billing",
        intent: "open invoices",
      },
    });
    expect(resolved.ok).toBe(true);
    expect((resolved.result as { hit: boolean }).hit).toBe(true);

    const executed = await handleActionApiEnvelope({
      method: "web.memory.execute",
      params: {
        url: "https://example.com/billing",
        intent: "open invoices",
      },
    });
    expect(executed.ok).toBe(true);
    expect((executed.result as { source?: string }).source).toBe("cache");

    const stats = await handleActionApiEnvelope({
      method: "web.memory.stats",
      params: {},
    });
    expect(stats.ok).toBe(true);
    expect((stats.result as { entries: number }).entries).toBeGreaterThanOrEqual(1);

    const invalidated = await handleActionApiEnvelope({
      method: "web.memory.invalidate",
      params: {
        scope: "all",
      },
    });
    expect(invalidated.ok).toBe(true);
    expect((invalidated.result as { invalidated: number }).invalidated).toBeGreaterThanOrEqual(1);
  });

  it("retries route memory actions with alternate semantic anchors", async () => {
    vi.mocked(isCentrisExtensionConnected).mockReturnValue(true);
    vi.mocked(sendExtensionCommand)
      .mockRejectedValueOnce(new Error("stale node id"))
      .mockResolvedValueOnce({ success: true });

    const result = await handleActionApiEnvelope({
      method: "route.run",
      params: {
        routeId: "checkout_submit",
        actionIndex: [
          {
            actionId: "submit_order",
            affordance: "click",
            nodeHints: [{ nodeId: 11 }],
            anchors: [{ anchorType: "test_id", value: "submit-order" }],
            confidence: 0.95,
          },
        ],
        routeMemory: {
          routeId: "checkout_submit",
          confidence: 0.95,
          steps: [{ actionId: "submit_order", operation: "click" }],
        },
      },
    });
    expect(result.ok).toBe(true);
    expect((result.result as { source?: string }).source).toBe("memory");
    expect(vi.mocked(sendExtensionCommand)).toHaveBeenNthCalledWith(1, "click_node", {
      nodeId: 11,
    });
    expect(vi.mocked(sendExtensionCommand)).toHaveBeenNthCalledWith(2, "click_node", {
      selector: "[data-testid='submit-order']",
    });
  });

  it("observes snapshot when extension is connected", async () => {
    vi.mocked(isCentrisExtensionConnected).mockReturnValue(true);
    vi.mocked(sendExtensionCommand).mockResolvedValue({
      metadata: { url: "https://example.com", title: "Example" },
      interactiveNodes: [{ n: "Submit", selector: "#submit" }],
    });

    const result = await handleActionApiEnvelope({
      method: "observe",
      params: {},
    });

    expect(result.ok).toBe(true);
    expect(result.result).toEqual({
      url: "https://example.com",
      title: "Example",
      interactive: [{ name: "Submit", selector: "#submit" }],
    });
  });
});
