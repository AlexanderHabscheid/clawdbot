import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectSelfExtensionCapabilityGap, runSelfExtensionIfNeeded } from "./self-extend.js";

const tempDirs: string[] = [];

async function makeTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-self-extend-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) {
      continue;
    }
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("detectSelfExtensionCapabilityGap", () => {
  it("detects explicit capability-gap language when no tools were used", () => {
    const reason = detectSelfExtensionCapabilityGap({
      assistantTexts: ["I cannot complete this because I do not have the required skill."],
      toolMetas: [],
      aborted: false,
      timedOut: false,
    });
    expect(reason).toBeTruthy();
  });

  it("does not detect a gap when tools were used", () => {
    const reason = detectSelfExtensionCapabilityGap({
      assistantTexts: ["I cannot finish this part."],
      toolMetas: [{ toolName: "read" }],
      aborted: false,
      timedOut: false,
    });
    expect(reason).toBeUndefined();
  });
});

describe("runSelfExtensionIfNeeded", () => {
  it("creates a skill scaffold in workspace skills directory", async () => {
    const workspaceDir = await makeTempWorkspace();
    const result = await runSelfExtensionIfNeeded({
      workspaceDir,
      prompt: "Create a migration validator for SQL files and run it",
      reason: "missing skill for migration validation",
      selfExtend: { enabled: true, autoCommit: false, autoPush: false },
    });
    expect(result.created).toBe(true);
    expect(result.skillName).toBeTruthy();
    const filePath = result.skillFilePath;
    expect(filePath).toBeTruthy();
    const content = await fs.readFile(filePath!, "utf8");
    expect(content).toContain("---");
    expect(content).toContain("## Workflow");
    expect(content).toContain("## Validation");
  });

  it("no-ops when self extension is disabled", async () => {
    const workspaceDir = await makeTempWorkspace();
    const result = await runSelfExtensionIfNeeded({
      workspaceDir,
      prompt: "any prompt",
      reason: "gap",
      selfExtend: { enabled: false },
    });
    expect(result.created).toBe(false);
  });
});
