import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { AdapterRuntime } from "./adapter-runtime.js";

describe("AdapterRuntime", () => {
  it("blocks destructive operations without explicit approval", async () => {
    const runtime = new AdapterRuntime();
    const result = await runtime.execute(
      {
        adapterId: "crm-adapter",
        system: "crm",
        transport: "sdk",
        operations: [{ operation: "crm.contact.delete", safetyLevel: "destructive" }],
      },
      {
        operation: "crm.contact.delete",
        input: { id: "1" },
        sdk: {
          modulePath: pathToFileURL(
            path.resolve("sdk/typescript/src/execution/__fixtures__/adapter-handler.ts"),
          ).href,
          exportName: "execute",
        },
      },
    );

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("destructive");
  });

  it("executes sdk transport and returns artifacts", async () => {
    const runtime = new AdapterRuntime();
    const result = await runtime.execute(
      {
        adapterId: "crm-adapter",
        system: "crm",
        transport: "sdk",
        operations: [{ operation: "crm.contact.lookup", safetyLevel: "read" }],
      },
      {
        operation: "crm.contact.lookup",
        input: { email: "ada@example.com" },
        sdk: {
          modulePath: pathToFileURL(
            path.resolve("sdk/typescript/src/execution/__fixtures__/adapter-handler.ts"),
          ).href,
          exportName: "execute",
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(Array.isArray(result.artifacts)).toBe(true);
    expect(result.artifacts?.[0]?.schema).toBe("centris/artifact/record-ref@v1");
  });
});
