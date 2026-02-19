/**
 * @centris/sdk - Browser Executor
 *
 * Executes capabilities via browser automation through the Centris Chrome extension.
 * Uses the gateway's extension bridge (WebSocket) — no Playwright or puppeteer needed.
 */

import type { Executor, ExecutorContext, ExecutorResult, UIMapping } from "../types.js";
import { executorSuccess, executorError } from "../types.js";

/**
 * Function signature matching the gateway's sendExtensionCommand.
 * Injected at construction so the SDK doesn't hard-import gateway internals.
 */
export type SendCommandFn = (
  type: string,
  data?: Record<string, unknown>,
  timeoutMs?: number,
) => Promise<unknown>;

/**
 * Function signature matching isCentrisExtensionConnected.
 */
export type IsConnectedFn = () => boolean;

interface BrowserAction {
  type:
    | "navigate"
    | "click"
    | "click_nodeId"
    | "type"
    | "type_nodeId"
    | "wait"
    | "snapshot"
    | "press_key";
  selector?: string;
  nodeId?: number;
  value?: string;
  url?: string;
  key?: string;
  timeout?: number;
}

/**
 * Browser Executor
 *
 * Routes capability execution through the real Centris Chrome extension bridge.
 * Translates UI mappings (semantic action recipes) into extension commands.
 */
export class BrowserExecutor implements Executor {
  readonly type = "browser" as const;
  private sendCommand: SendCommandFn | null;
  private isConnected: IsConnectedFn | null;

  constructor(options?: { sendCommand?: SendCommandFn; isConnected?: IsConnectedFn }) {
    this.sendCommand = options?.sendCommand ?? null;
    this.isConnected = options?.isConnected ?? null;
  }

  /**
   * Bind the executor to the gateway's extension bridge at runtime.
   * Called during gateway startup once the bridge module is loaded.
   */
  bind(sendCommand: SendCommandFn, isConnected: IsConnectedFn): void {
    this.sendCommand = sendCommand;
    this.isConnected = isConnected;
  }

  async execute(
    connectorId: string,
    capabilityId: string,
    params: Record<string, unknown>,
    context: ExecutorContext,
  ): Promise<ExecutorResult> {
    const startTime = Date.now();
    const meta = () => ({ executionMethod: "browser" as const, latencyMs: Date.now() - startTime });

    if (!this.sendCommand) {
      return executorError(
        "NO_BRIDGE",
        "Browser executor not bound to extension bridge. Call bind() first.",
        {
          retryable: false,
          metadata: meta(),
        },
      );
    }

    const uiMappings = context.uiMappings ?? [];
    if (uiMappings.length === 0) {
      return executorError(
        "NO_UI_MAPPINGS",
        `No UI mappings available for ${connectorId}.${capabilityId}`,
        { retryable: false, metadata: meta() },
      );
    }

    try {
      const actions = this.generateActions(capabilityId, params, uiMappings);
      const result = await this.executeActions(actions);
      return executorSuccess(result, meta());
    } catch (err) {
      return executorError("BROWSER_ERROR", String(err), {
        retryable: true,
        metadata: meta(),
      });
    }
  }

  private generateActions(
    capabilityId: string,
    params: Record<string, unknown>,
    uiMappings: UIMapping[],
  ): BrowserAction[] {
    const actions: BrowserAction[] = [];

    const relevantMappings = uiMappings.filter(
      (m) => m.context?.includes(capabilityId) || m.semanticRole.includes(capabilityId),
    );

    for (const mapping of relevantMappings) {
      const nodeId = (mapping as UIMapping & { nodeId?: number }).nodeId;

      switch (mapping.action) {
        case "click":
          actions.push(
            nodeId != null
              ? { type: "click_nodeId", nodeId }
              : { type: "click", selector: mapping.selector },
          );
          break;

        case "type": {
          const inputParam = Object.entries(params).find(
            ([key]) => mapping.semanticRole.includes(key) || mapping.context?.includes(key),
          );
          if (inputParam) {
            actions.push(
              nodeId != null
                ? { type: "type_nodeId", nodeId, value: String(inputParam[1]) }
                : { type: "type", selector: mapping.selector, value: String(inputParam[1]) },
            );
          }
          break;
        }

        case "navigate":
          if (params.url && typeof params.url === "string") {
            actions.push({ type: "navigate", url: params.url });
          }
          break;

        case "press_key":
          if (mapping.context?.[0]) {
            actions.push({ type: "press_key", key: mapping.context[0] });
          }
          break;
      }
    }

    return actions;
  }

  private async executeActions(actions: BrowserAction[]): Promise<Record<string, unknown>> {
    const send = this.sendCommand!;
    const results: unknown[] = [];

    for (const action of actions) {
      switch (action.type) {
        case "navigate":
          results.push(await send("navigate", { url: action.url }));
          break;

        case "click":
          results.push(await send("click_node", { selector: action.selector }));
          break;

        case "click_nodeId":
          results.push(await send("click_node", { nodeId: action.nodeId }));
          break;

        case "type":
          results.push(await send("type_text", { selector: action.selector, text: action.value }));
          break;

        case "type_nodeId":
          results.push(await send("type_text", { nodeId: action.nodeId, text: action.value }));
          break;

        case "snapshot":
          results.push(await send("get_interactive_snapshot", { maxChars: 4000 }));
          break;

        case "press_key":
          results.push(await send("press_key", { key: action.key }));
          break;

        case "wait":
          await new Promise((r) => setTimeout(r, action.timeout ?? 500));
          break;
      }
    }

    return { executed: true, actions: actions.length, results };
  }

  async isAvailable(): Promise<boolean> {
    if (!this.isConnected) {
      return false;
    }
    return this.isConnected();
  }
}
