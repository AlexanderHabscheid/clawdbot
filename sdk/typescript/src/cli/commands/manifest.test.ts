import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CLIContext } from "../types.js";
import { doctorManifest, publishManifest } from "./manifest.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "centris-manifest-test-"));
}

function writeManifest(filePath: string): void {
  const manifest = {
    centris: "2.0",
    app: "example",
    description: "Example app",
    url_patterns: ["example.com/*"],
    routes: {
      "/": {
        landmarks: {
          compose: {
            role: "button",
            selectors: ["[aria-label='Compose']"],
            stability: "stable",
          },
        },
        actions: {
          openCompose: {
            description: "Open compose",
            confidence: 0.8,
            successChecks: [{ type: "element_visible", value: "[aria-label='Compose']" }],
            steps: [{ click: "compose" }],
          },
        },
      },
    },
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
}

function createContext(cwd: string): CLIContext {
  return {
    cwd,
    verbose: false,
    logger: {
      info: () => {},
      success: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
  };
}

describe("manifest commands", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("doctorManifest outputs json report", async () => {
    const cwd = makeTempDir();
    const manifestPath = path.join(cwd, "centris.json");
    writeManifest(manifestPath);
    const outSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    await doctorManifest(
      {
        file: "centris.json",
        json: true,
      },
      createContext(cwd),
    );

    const output = String(outSpy.mock.calls[0]?.[0] ?? "");
    expect(output).toContain('"operation": "manifest.doctor"');
    expect(output).toContain('"ok": true');
  });

  it("publishManifest dry-run does not write output files", async () => {
    const cwd = makeTempDir();
    const manifestPath = path.join(cwd, "centris.json");
    writeManifest(manifestPath);

    await publishManifest(
      {
        file: "centris.json",
        dryRun: true,
      },
      createContext(cwd),
    );

    expect(fs.existsSync(path.join(cwd, ".well-known", "centris.json"))).toBe(false);
  });

  it("publishManifest writes well-known and connector artifacts", async () => {
    const cwd = makeTempDir();
    const manifestPath = path.join(cwd, "centris.json");
    writeManifest(manifestPath);

    await publishManifest(
      {
        file: "centris.json",
        connectorOutDir: "dist/example-manifest",
      },
      createContext(cwd),
    );

    expect(fs.existsSync(path.join(cwd, ".well-known", "centris.json"))).toBe(true);
    expect(fs.existsSync(path.join(cwd, "dist", "example-manifest", "centris.json"))).toBe(true);
    expect(fs.existsSync(path.join(cwd, "dist", "example-manifest", "README.md"))).toBe(true);
  });
});
