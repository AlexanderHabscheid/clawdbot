import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./centris-extension-bridge.js", () => ({
  isCentrisExtensionConnected: vi.fn(),
  sendExtensionCommand: vi.fn(),
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
import { isCentrisExtensionConnected, sendExtensionCommand } from "./centris-extension-bridge.js";

describe("handleActionApiEnvelope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
