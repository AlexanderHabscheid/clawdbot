import path from "node:path";
import { describe, it, expect, beforeEach } from "vitest";
import type { CentrisManifest, LoadedManifest } from "./index.js";
import {
  formatManifestIndex,
  formatResolvedManifest,
  formatResolvedManifestJson,
} from "./formatter.js";
import { loadManifests, validateManifest } from "./loader.js";
import { ManifestStore } from "./resolver.js";

const SLACK_MANIFEST: CentrisManifest = {
  centris: "1.0",
  app: "slack",
  description: "Slack messaging workspace",
  url_patterns: ["app.slack.com/*", "*.slack.com/client/*"],
  routes: {
    "/client/:workspace": {
      landmarks: {
        sidebar: {
          role: "navigation",
          selectors: ["[data-qa='channel-sidebar']", ".p-channel_sidebar"],
          stability: "stable",
          description: "Channel list sidebar",
        },
        composer: {
          role: "textbox",
          selectors: ["[data-qa='message_input']", ".ql-editor", "[role='textbox']"],
          stability: "stable",
          description: "Message input field",
        },
      },
      actions: {
        send_message: {
          description: "Send a message to the current channel",
          params: ["message"],
          steps: [
            { click: "composer" },
            { type: { target: "composer", value: "{{message}}" } },
            { press: "Enter" },
          ],
        },
      },
    },
  },
};

const GITHUB_MANIFEST: CentrisManifest = {
  centris: "1.0",
  app: "github",
  description: "GitHub code hosting",
  url_patterns: ["github.com/*"],
  routes: {
    "/:owner/:repo": {
      landmarks: {
        repo_nav: {
          role: "navigation",
          selectors: ["nav[aria-label='Repository']"],
          description: "Tab bar",
        },
      },
      actions: {
        go_to_issues: {
          description: "Navigate to issues tab",
          steps: [{ click: "repo_nav [data-content='Issues']" }],
        },
      },
    },
    "/:owner/:repo/issues/new*": {
      landmarks: {
        title_input: {
          role: "textbox",
          selectors: ["#issue_title"],
          description: "Issue title",
        },
      },
      actions: {
        fill_issue: {
          description: "Fill issue form",
          params: ["title", "body"],
          steps: [
            { click: "title_input" },
            { type: { target: "title_input", value: "{{title}}" } },
          ],
        },
      },
    },
  },
};

function loaded(m: CentrisManifest): LoadedManifest {
  return {
    manifest: m,
    source: `/fake/${m.app}/centris.json`,
    sourceKind: "workspace",
    trusted: true,
    trustReason: "test",
    diagnostics: [],
  };
}

// ─── Resolver tests ──────────────────────────────────────────────────────────

describe("ManifestStore", () => {
  let store: ManifestStore;

  beforeEach(() => {
    store = new ManifestStore([loaded(SLACK_MANIFEST), loaded(GITHUB_MANIFEST)]);
  });

  it("reports correct size", () => {
    expect(store.size).toBe(2);
  });

  describe("buildIndex", () => {
    it("builds compact index entries", () => {
      const index = store.buildIndex();
      expect(index).toHaveLength(2);

      const slack = index.find((e) => e.app === "slack");
      expect(slack).toBeDefined();
      expect(slack!.url_patterns).toEqual(["app.slack.com/*", "*.slack.com/client/*"]);
      expect(slack!.actions).toEqual(["send_message"]);

      const github = index.find((e) => e.app === "github");
      expect(github).toBeDefined();
      expect(github!.actions).toContain("go_to_issues");
      expect(github!.actions).toContain("fill_issue");
    });
  });

  describe("resolve", () => {
    it("matches Slack URL", () => {
      const result = store.resolve("https://app.slack.com/client/T12345/C67890");
      expect(result).not.toBeNull();
      expect(result!.app).toBe("slack");
      expect(result!.route).toBe("/client/:workspace");
      expect(result!.landmarks.sidebar).toBeDefined();
      expect(result!.landmarks.sidebar.selectors[0]).toBe("[data-qa='channel-sidebar']");
      expect(result!.actions.send_message).toBeDefined();
    });

    it("matches Slack subdomain URL", () => {
      const result = store.resolve("https://mycompany.slack.com/client/T12345");
      expect(result).not.toBeNull();
      expect(result!.app).toBe("slack");
    });

    it("matches GitHub repo URL", () => {
      const result = store.resolve("https://github.com/openclaw/openclaw");
      expect(result).not.toBeNull();
      expect(result!.app).toBe("github");
      expect(result!.route).toBe("/:owner/:repo");
    });

    it("matches GitHub issues/new URL to most specific route", () => {
      const result = store.resolve("https://github.com/openclaw/openclaw/issues/new");
      expect(result).not.toBeNull();
      expect(result!.app).toBe("github");
      expect(result!.route).toBe("/:owner/:repo/issues/new*");
      expect(result!.landmarks.title_input).toBeDefined();
    });

    it("returns null for unmatched URL", () => {
      const result = store.resolve("https://example.com/whatever");
      expect(result).toBeNull();
    });

    it("handles URL with query params and hash", () => {
      const result = store.resolve("https://app.slack.com/client/T123?foo=bar#section");
      expect(result).not.toBeNull();
      expect(result!.app).toBe("slack");
    });
  });

  describe("findByApp", () => {
    it("finds by exact name", () => {
      const result = store.findByApp("slack");
      expect(result).not.toBeNull();
      expect(result!.app).toBe("slack");
    });

    it("finds by case-insensitive name", () => {
      const result = store.findByApp("GitHub");
      expect(result).not.toBeNull();
    });

    it("returns null for unknown app", () => {
      const result = store.findByApp("notion");
      expect(result).toBeNull();
    });
  });
});

// ─── Formatter tests ─────────────────────────────────────────────────────────

describe("formatManifestIndex", () => {
  it("returns empty string for no entries", () => {
    expect(formatManifestIndex([])).toBe("");
  });

  it("formats entries with app names and actions", () => {
    const store = new ManifestStore([loaded(SLACK_MANIFEST)]);
    const output = formatManifestIndex(store.buildIndex());

    expect(output).toContain("Pre-mapped Sites");
    expect(output).toContain("slack");
    expect(output).toContain("send_message");
    expect(output).toContain("app.slack.com/*");
  });
});

describe("formatResolvedManifest", () => {
  it("formats landmarks and actions", () => {
    const store = new ManifestStore([loaded(SLACK_MANIFEST)]);
    const resolved = store.resolve("https://app.slack.com/client/T123")!;
    const output = formatResolvedManifest(resolved);

    expect(output).toContain("[Pre-mapped: slack]");
    expect(output).toContain("sidebar");
    expect(output).toContain("[data-qa='channel-sidebar']");
    expect(output).toContain("send_message");
    expect(output).toContain("press: Enter");
  });
});

describe("formatResolvedManifestJson", () => {
  it("formats as compact JSON structure", () => {
    const store = new ManifestStore([loaded(SLACK_MANIFEST)]);
    const resolved = store.resolve("https://app.slack.com/client/T123")!;
    const output = formatResolvedManifestJson(resolved);

    expect(output._premapped).toBe("slack");
    expect(output.landmarks).toBeDefined();
    expect(output.actions).toBeDefined();

    const landmarks = output.landmarks as Record<string, { sel: string; role: string }>;
    expect(landmarks.sidebar.sel).toBe("[data-qa='channel-sidebar']");
    expect(landmarks.sidebar.role).toBe("navigation");
  });
});

// ─── Loader tests ────────────────────────────────────────────────────────────

describe("loadManifests", () => {
  it("loads manifests from workspace connectors directory", () => {
    const workspaceDir = path.resolve(__dirname, "..", "..", "..", "..");
    const results = loadManifests({ workspaceDir });

    // Should find at least the slack and github example manifests
    const apps = results.map((r) => r.manifest.app);
    expect(apps).toContain("slack");
    expect(apps).toContain("github");
  });

  it("validates manifest structure", () => {
    const workspaceDir = path.resolve(__dirname, "..", "..", "..", "..");
    const results = loadManifests({ workspaceDir });

    for (const { manifest } of results) {
      expect(manifest.centris).toBe("1.0");
      expect(typeof manifest.app).toBe("string");
      expect(manifest.url_patterns.length).toBeGreaterThan(0);
      expect(Object.keys(manifest.routes).length).toBeGreaterThan(0);
    }
  });

  it("returns empty array for nonexistent directory", () => {
    const results = loadManifests({ workspaceDir: "/nonexistent/path" });
    // May still find global manifests, but should not throw
    expect(Array.isArray(results)).toBe(true);
  });

  it("migrates legacy verify field into successChecks", () => {
    const legacy = {
      centris: "1.0",
      app: "legacy",
      url_patterns: ["legacy.example.com/*"],
      routes: {
        "/": {
          actions: {
            submit: {
              description: "Submit",
              steps: [{ click: "#submit" }],
              verify: [{ type: "url_contains", value: "/done" }],
            },
          },
        },
      },
    };
    const parsed = validateManifest(legacy);
    expect(parsed).not.toBeNull();
    expect(parsed?.routes["/"]?.actions?.submit?.successChecks?.[0]).toEqual({
      type: "url_contains",
      value: "/done",
    });
  });
});
