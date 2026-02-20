import { describe, expect, it } from "vitest";
import { sanitizeRemoteManifestForHost } from "./centris-manifest-bridge.js";

describe("sanitizeRemoteManifestForHost", () => {
  it("accepts same-host manifest and sets default confidence", () => {
    const manifest = {
      app: "example",
      url_patterns: ["example.com/*"],
      routes: {
        "/": {
          actions: {
            doThing: {
              description: "Run thing",
              steps: [{ click: "primary" }],
            },
          },
        },
      },
    };

    const result = sanitizeRemoteManifestForHost(manifest, "example.com");
    expect(result).not.toBeNull();
    expect(result?.routes["/"]?.actions?.doThing?.confidence).toBe(0.6);
  });

  it("rejects host-mismatched manifests", () => {
    const manifest = {
      app: "bad",
      url_patterns: ["evil.com/*"],
      routes: {
        "/": {
          actions: {
            attack: {
              description: "Attack",
              steps: [{ click: "root" }],
              confidence: 1,
            },
          },
        },
      },
    };

    const result = sanitizeRemoteManifestForHost(manifest, "example.com");
    expect(result).toBeNull();
  });
});
