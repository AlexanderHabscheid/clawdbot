import { describe, it, expect } from "vitest";
import type { CentrisManifest } from "./types.js";
import { evaluateManifestTrust, validateManifestPolicy } from "./policy.js";

const BASE_MANIFEST: CentrisManifest = {
  centris: "2.0",
  app: "acme",
  description: "Acme app",
  url_patterns: ["acme.example.com/*"],
  routes: {
    "/": {
      landmarks: {
        compose: {
          role: "textbox",
          selectors: [".editor > div:nth-child(2)"],
          stability: "fragile",
        },
      },
      actions: {
        send: {
          description: "Send message",
          steps: [
            { click: "compose" },
            { type: { target: "compose", value: "hello" } },
            { press: "Enter" },
          ],
        },
      },
    },
  },
};

describe("manifest policy", () => {
  it("flags write actions that are fragile and missing checks in strict mode", () => {
    const result = validateManifestPolicy(structuredClone(BASE_MANIFEST), {
      strict: true,
      targetVersion: "2.0",
    });
    expect(result.ok).toBe(false);
    const messages = result.issues.map((issue) => issue.message);
    expect(messages).toContain("Action requires successChecks for write safety level");
    expect(messages).toContain(
      "Write/destructive action should include semantic anchors/selectors",
    );
    expect(messages).toContain("Write/destructive action relies only on fragile selectors");
  });

  it("passes strict checks when action has semantic anchor and success checks", () => {
    const manifest = structuredClone(BASE_MANIFEST);
    const rootRoute = manifest.routes["/"];
    expect(rootRoute).toBeDefined();
    if (!rootRoute) {
      throw new Error("missing root route");
    }
    const compose = rootRoute.landmarks?.compose;
    const send = rootRoute.actions?.send;
    expect(compose).toBeDefined();
    expect(send).toBeDefined();
    if (!compose || !send) {
      throw new Error("missing compose/send fixtures");
    }

    compose.selectors = ["[data-testid='compose']"];
    compose.stability = "stable";
    send.successChecks = [{ type: "text_present", value: "Sent" }];
    send.safetyLevel = "write";
    const result = validateManifestPolicy(manifest, { strict: true, targetVersion: "2.0" });
    expect(result.ok).toBe(true);
  });
});

describe("manifest trust", () => {
  it("trusts workspace manifests without signatures", () => {
    const result = evaluateManifestTrust({
      manifest: structuredClone(BASE_MANIFEST),
      sourceKind: "workspace",
      policy: {},
    });
    expect(result.trusted).toBe(true);
  });

  it("rejects unsigned external manifests by default", () => {
    const result = evaluateManifestTrust({
      manifest: structuredClone(BASE_MANIFEST),
      sourceKind: "external",
      policy: {},
    });
    expect(result.trusted).toBe(false);
  });

  it("enforces publisher allowlist for non-local manifests", () => {
    const manifest = structuredClone(BASE_MANIFEST);
    manifest.trust = {
      publisher: "trusted-co",
    };
    const result = evaluateManifestTrust({
      manifest,
      sourceKind: "external",
      policy: {
        allowUnsignedExternal: true,
        allowedPublishers: ["different-publisher"],
      },
    });
    expect(result.trusted).toBe(false);
  });
});
