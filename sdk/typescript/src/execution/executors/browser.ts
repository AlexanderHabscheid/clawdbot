/**
 * @centris/sdk - Browser Executor
 *
 * Executes capabilities via browser automation through the Centris Chrome extension.
 * Uses the gateway's extension bridge (WebSocket) — no Playwright or puppeteer needed.
 */

import type { KernelRouteStep, KernelSuccessCheck } from "../../kernel/types.js";
import type { Executor, ExecutorContext, ExecutorResult, UIMapping } from "../types.js";
import { persistLearnedRoute, updateLearnedRouteOutcome } from "../../kernel/learned-routes.js";
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
  semanticRole?: string;
  capabilityContext?: string[];
  fallbackSelectors?: string[];
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
  private autoLearn: boolean;
  private learnBaseDir?: string;
  private learnAppId?: string;
  private captureSnapshotOnLearn: boolean;

  constructor(options?: {
    sendCommand?: SendCommandFn;
    isConnected?: IsConnectedFn;
    autoLearn?: boolean;
    learnBaseDir?: string;
    learnAppId?: string;
    captureSnapshotOnLearn?: boolean;
  }) {
    this.sendCommand = options?.sendCommand ?? null;
    this.isConnected = options?.isConnected ?? null;
    this.autoLearn = options?.autoLearn ?? true;
    this.learnBaseDir = options?.learnBaseDir;
    this.learnAppId = options?.learnAppId;
    this.captureSnapshotOnLearn = options?.captureSnapshotOnLearn ?? true;
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

    // Allow runtime wiring without hard imports: context metadata can provide bridge functions.
    this.tryBindFromContext(context);

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
      if (actions.length === 0) {
        return executorError(
          "NO_ACTIONS",
          `No executable browser actions resolved for ${connectorId}.${capabilityId}`,
          {
            retryable: false,
            metadata: meta(),
          },
        );
      }
      const result = await this.executeActions(actions);
      await this.maybePersistLearnedRoute({
        connectorId,
        capabilityId,
        params,
        context,
        actions,
        executionResult: result,
      });
      return executorSuccess(result, meta());
    } catch (err) {
      await this.maybeRecordFailedLearnedRoute({
        connectorId,
        capabilityId,
        params,
        context,
      });
      return executorError("BROWSER_ERROR", String(err), {
        retryable: true,
        metadata: meta(),
      });
    }
  }

  private tryBindFromContext(context: ExecutorContext): void {
    if (this.sendCommand && this.isConnected) {
      return;
    }

    const meta = context.metadata;
    if (!meta) {
      return;
    }

    const send = meta.sendExtensionCommand;
    const isConnected = meta.isCentrisExtensionConnected;
    if (typeof send === "function" && typeof isConnected === "function") {
      this.bind(send as SendCommandFn, isConnected as IsConnectedFn);
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
          {
            const action =
              nodeId != null
                ? ({
                    type: "click_nodeId",
                    nodeId,
                    semanticRole: mapping.semanticRole,
                    capabilityContext: mapping.context,
                  } as BrowserAction)
                : ({
                    type: "click",
                    selector: mapping.selector,
                    semanticRole: mapping.semanticRole,
                    capabilityContext: mapping.context,
                  } as BrowserAction);
            action.fallbackSelectors = this.buildSelectorChain(
              action,
              mapping.selector,
              uiMappings,
            );
            actions.push(action);
          }
          break;

        case "type": {
          const inputParam = Object.entries(params).find(
            ([key]) => mapping.semanticRole.includes(key) || mapping.context?.includes(key),
          );
          if (inputParam) {
            const action =
              nodeId != null
                ? ({
                    type: "type_nodeId",
                    nodeId,
                    value: String(inputParam[1]),
                    semanticRole: mapping.semanticRole,
                    capabilityContext: mapping.context,
                  } as BrowserAction)
                : ({
                    type: "type",
                    selector: mapping.selector,
                    value: String(inputParam[1]),
                    semanticRole: mapping.semanticRole,
                    capabilityContext: mapping.context,
                  } as BrowserAction);
            action.fallbackSelectors = this.buildSelectorChain(
              action,
              mapping.selector,
              uiMappings,
            );
            actions.push(action);
          }
          break;
        }

        case "navigate":
          if (params.url && typeof params.url === "string") {
            actions.push({
              type: "navigate",
              url: params.url,
              semanticRole: mapping.semanticRole,
              capabilityContext: mapping.context,
            });
          }
          break;

        case "press_key":
          if (mapping.context?.[0]) {
            actions.push({
              type: "press_key",
              key: mapping.context[0],
              semanticRole: mapping.semanticRole,
              capabilityContext: mapping.context,
            });
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
          results.push(
            await this.executeSelectorFallback(action, (selector) =>
              send("click_node", { selector }),
            ),
          );
          break;

        case "click_nodeId":
          results.push(await this.executeNodeOrSelectorFallback(action, "click_node"));
          break;

        case "type":
          results.push(
            await this.executeSelectorFallback(action, (selector) =>
              send("type_text", { selector, text: action.value }),
            ),
          );
          break;

        case "type_nodeId":
          results.push(await this.executeNodeOrSelectorFallback(action, "type_text", action.value));
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

  private async executeSelectorFallback(
    action: BrowserAction,
    call: (selector: string) => Promise<unknown>,
  ): Promise<unknown> {
    const selectors = [action.selector, ...(action.fallbackSelectors ?? [])].filter(
      (selector): selector is string => typeof selector === "string" && selector.trim().length > 0,
    );
    const deduped = [...new Set(selectors)];
    let lastError: unknown;
    for (const selector of deduped) {
      try {
        return await call(selector);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("All selector fallback attempts failed");
  }

  private async executeNodeOrSelectorFallback(
    action: BrowserAction,
    command: "click_node" | "type_text",
    value?: string,
  ): Promise<unknown> {
    const send = this.sendCommand!;
    let nodeError: unknown;
    if (typeof action.nodeId === "number") {
      try {
        if (command === "click_node") {
          return await send(command, { nodeId: action.nodeId });
        }
        return await send(command, { nodeId: action.nodeId, text: value });
      } catch (error) {
        nodeError = error;
      }
    }

    try {
      if (command === "click_node") {
        return await this.executeSelectorFallback(action, (selector) =>
          send(command, { selector }),
        );
      }
      return await this.executeSelectorFallback(action, (selector) =>
        send(command, { selector, text: value }),
      );
    } catch (selectorError) {
      throw selectorError ?? nodeError;
    }
  }

  private async maybePersistLearnedRoute(params: {
    connectorId: string;
    capabilityId: string;
    context: ExecutorContext;
    actions: BrowserAction[];
    executionResult: Record<string, unknown>;
    params: Record<string, unknown>;
  }): Promise<void> {
    if (!this.autoLearn || !this.sendCommand) {
      return;
    }

    const url = this.resolveExecutionUrl(params.params, params.context, params.executionResult);
    const pattern = this.urlToPattern(url);
    if (!pattern) {
      return;
    }

    let snapshot: unknown;
    if (this.captureSnapshotOnLearn) {
      try {
        snapshot = await this.sendCommand("get_interactive_snapshot", { maxChars: 4000 });
      } catch {
        snapshot = undefined;
      }
    }

    const learned = this.actionsToLearnedRoute(
      params.actions,
      params.context.uiMappings ?? [],
      this.extractSelectorsFromSnapshot(snapshot),
    );
    const steps = learned.steps;
    if (steps.length === 0) {
      return;
    }

    const checks: KernelSuccessCheck[] = [];
    if (url) {
      try {
        const parsed = new URL(url);
        if (parsed.pathname && parsed.pathname !== "/") {
          checks.push({ type: "url_contains", value: parsed.pathname });
        }
      } catch {
        // ignore malformed urls from tool responses
      }
    }

    try {
      persistLearnedRoute({
        request: {
          id: `${params.connectorId}.${params.capabilityId}`,
          urlPattern: pattern,
          steps,
          checks: checks.length > 0 ? checks : undefined,
          fallbackChains: learned.fallbackChains.length > 0 ? learned.fallbackChains : undefined,
        },
        baseDir: this.learnBaseDir,
        appId: this.learnAppId ?? params.connectorId,
      });
    } catch {
      // learning persistence is best-effort and should never fail execution
    }
  }

  private async maybeRecordFailedLearnedRoute(params: {
    connectorId: string;
    capabilityId: string;
    params: Record<string, unknown>;
    context: ExecutorContext;
  }): Promise<void> {
    if (!this.autoLearn) {
      return;
    }

    const url = this.resolveExecutionUrl(params.params, params.context, {});
    const pattern = this.urlToPattern(url);
    if (!pattern) {
      return;
    }

    try {
      updateLearnedRouteOutcome({
        routeId: `${params.connectorId}.${params.capabilityId}`,
        urlPattern: pattern,
        outcome: "failure",
        baseDir: this.learnBaseDir,
        appId: this.learnAppId ?? params.connectorId,
      });
    } catch {
      // failure scoring is best-effort and should never fail execution path
    }
  }

  private actionsToLearnedRoute(
    actions: BrowserAction[],
    uiMappings: UIMapping[],
    snapshotSelectors?: Map<number, string>,
  ): { steps: KernelRouteStep[]; fallbackChains: string[][] } {
    const selectorByNodeId = new Map<number, string>();
    for (const mapping of uiMappings) {
      if (typeof mapping.nodeId === "number" && mapping.selector) {
        selectorByNodeId.set(mapping.nodeId, mapping.selector);
      }
    }
    if (snapshotSelectors) {
      for (const [nodeId, selector] of snapshotSelectors.entries()) {
        if (!selectorByNodeId.has(nodeId)) {
          selectorByNodeId.set(nodeId, selector);
        }
      }
    }

    const steps: KernelRouteStep[] = [];
    const fallbackChains: string[][] = [];
    for (const action of actions) {
      switch (action.type) {
        case "navigate":
          if (action.url) {
            steps.push({ navigate: action.url });
          }
          break;
        case "click":
          if (action.selector) {
            steps.push({ click: action.selector });
            fallbackChains.push(
              this.buildSelectorChain(action, action.selector, uiMappings, snapshotSelectors),
            );
          }
          break;
        case "click_nodeId": {
          const selector =
            typeof action.nodeId === "number" ? selectorByNodeId.get(action.nodeId) : undefined;
          if (selector) {
            steps.push({ click: selector });
            fallbackChains.push(
              this.buildSelectorChain(action, selector, uiMappings, snapshotSelectors),
            );
          }
          break;
        }
        case "type":
          if (action.selector) {
            steps.push({
              type: {
                target: action.selector,
                value: action.value ?? "",
              },
            });
            fallbackChains.push(
              this.buildSelectorChain(action, action.selector, uiMappings, snapshotSelectors),
            );
          }
          break;
        case "type_nodeId": {
          const selector =
            typeof action.nodeId === "number" ? selectorByNodeId.get(action.nodeId) : undefined;
          if (selector) {
            steps.push({
              type: {
                target: selector,
                value: action.value ?? "",
              },
            });
            fallbackChains.push(
              this.buildSelectorChain(action, selector, uiMappings, snapshotSelectors),
            );
          }
          break;
        }
        case "press_key":
          if (action.key) {
            steps.push({ press: action.key });
          }
          break;
        case "wait":
          steps.push({ wait: action.timeout ?? 500 });
          break;
        case "snapshot":
          break;
      }
    }
    return { steps, fallbackChains: fallbackChains.filter((chain) => chain.length > 0) };
  }

  private buildSelectorChain(
    action: BrowserAction,
    primarySelector: string,
    uiMappings: UIMapping[],
    snapshotSelectors?: Map<number, string>,
  ): string[] {
    const candidates = new Set<string>();
    candidates.add(primarySelector);

    if (typeof action.nodeId === "number") {
      const snapshotSelector = snapshotSelectors?.get(action.nodeId);
      if (snapshotSelector) {
        candidates.add(snapshotSelector);
      }
    }

    for (const mapping of uiMappings) {
      const roleMatch =
        typeof action.semanticRole === "string" &&
        action.semanticRole.length > 0 &&
        mapping.semanticRole === action.semanticRole;
      const contextMatch =
        action.capabilityContext?.some((ctx) => mapping.context?.includes(ctx)) ?? false;
      const actionMatch = action.type.includes("click")
        ? mapping.action === "click"
        : action.type.includes("type")
          ? mapping.action === "type"
          : false;
      if ((roleMatch || contextMatch) && actionMatch && mapping.selector) {
        candidates.add(mapping.selector);
      }
    }

    return [...candidates]
      .map((selector) => selector.trim())
      .filter(Boolean)
      .toSorted((a, b) => this.selectorStabilityScore(b) - this.selectorStabilityScore(a))
      .slice(0, 5);
  }

  private selectorStabilityScore(selector: string): number {
    let score = 0;
    if (selector.includes("[data-testid")) {
      score += 10;
    }
    if (selector.includes("[data-test")) {
      score += 9;
    }
    if (selector.includes("[aria-label")) {
      score += 8;
    }
    if (selector.includes("[role=")) {
      score += 7;
    }
    if (/#[a-zA-Z0-9_-]+/.test(selector)) {
      score += 6;
    }
    if (selector.includes("[name=")) {
      score += 5;
    }
    if (selector.includes(".")) {
      score += 2;
    }
    if (selector.includes(":nth-")) {
      score -= 5;
    }
    if (selector.includes(">")) {
      score -= 1;
    }
    return score;
  }

  private resolveExecutionUrl(
    execParams: Record<string, unknown>,
    context: ExecutorContext,
    executionResult: Record<string, unknown>,
  ): string | null {
    if (typeof execParams.url === "string" && execParams.url) {
      return execParams.url;
    }

    const metadataUrl = this.getString(context.metadata?.url);
    if (metadataUrl) {
      return metadataUrl;
    }

    const resultList = Array.isArray(executionResult.results) ? executionResult.results : [];
    for (const item of resultList) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const record = item as Record<string, unknown>;
      const url = this.getString(record.url) ?? this.getString(record.currentUrl);
      if (url) {
        return url;
      }
    }
    return null;
  }

  private urlToPattern(url: string | null): string | null {
    if (!url) {
      return null;
    }
    try {
      const parsed = new URL(url);
      return `${parsed.origin}/*`;
    } catch {
      return null;
    }
  }

  private getString(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value : null;
  }

  private extractSelectorsFromSnapshot(snapshot: unknown): Map<number, string> {
    const selectors = new Map<number, string>();
    if (!snapshot || typeof snapshot !== "object") {
      return selectors;
    }
    const record = snapshot as Record<string, unknown>;
    const nodes = Array.isArray(record.interactiveNodes)
      ? record.interactiveNodes
      : Array.isArray(record.nodes)
        ? record.nodes
        : [];
    for (const node of nodes) {
      if (!node || typeof node !== "object") {
        continue;
      }
      const entry = node as Record<string, unknown>;
      const nodeId = typeof entry.nodeId === "number" ? entry.nodeId : entry.id;
      const selector =
        typeof entry.selector === "string"
          ? entry.selector
          : typeof entry.s === "string"
            ? entry.s
            : undefined;
      if (typeof nodeId === "number" && selector) {
        selectors.set(nodeId, selector);
      }
    }
    return selectors;
  }

  async isAvailable(): Promise<boolean> {
    if (!this.isConnected) {
      return false;
    }
    return this.isConnected();
  }
}
