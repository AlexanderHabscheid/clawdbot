import { describe, expect, it } from "vitest";
import { ExecutionRouter } from "./router.js";

describe("ExecutionRouter", () => {
  it("uses preferred method when allowed and available", async () => {
    const router = new ExecutionRouter();
    const plan = await router.planExecution({
      connectorId: "slack",
      capabilityId: "send",
      params: {},
      context: {},
      metadata: {
        executionMethods: ["api", "desktop", "browser"],
      },
      preferences: { preferredMethod: "desktop" },
    });

    expect(plan.method).toBe("desktop");
  });

  it("prefers api when credentials are present", async () => {
    const router = new ExecutionRouter();
    const plan = await router.planExecution({
      connectorId: "slack",
      capabilityId: "send",
      params: {},
      context: { auth: { accessToken: "token_1" } },
      metadata: {
        executionMethods: ["api", "desktop", "browser"],
      },
    });

    expect(plan.method).toBe("api");
  });

  it("prefers local methods when no API credentials exist", async () => {
    const router = new ExecutionRouter();
    const plan = await router.planExecution({
      connectorId: "slack",
      capabilityId: "send",
      params: {},
      context: {},
      metadata: {
        executionMethods: ["api", "desktop", "browser"],
      },
    });

    expect(plan.method).toBe("desktop");
    expect(plan.fallbackMethods).toEqual(["api", "browser"]);
  });

  it("respects disallowed browser automation setting", async () => {
    const router = new ExecutionRouter();
    const plan = await router.planExecution({
      connectorId: "slack",
      capabilityId: "send",
      params: {},
      context: {},
      metadata: {
        executionMethods: ["browser", "desktop"],
      },
      preferences: {
        allowBrowserAutomation: false,
      },
    });

    expect(plan.method).toBe("desktop");
  });
});
