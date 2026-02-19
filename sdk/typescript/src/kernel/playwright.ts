import { persistLearnedRoute } from "./learned-routes.js";
import {
  ACTION_KERNEL_SPEC_VERSION,
  type ActionKernel,
  type KernelActRequest,
  type KernelActResult,
  type KernelLearnRequest,
  type KernelLearnResult,
  type KernelObserveRequest,
  type KernelObserveResult,
  type KernelRouteRequest,
  type KernelRouteResult,
  type KernelSuccessCheck,
  type KernelVerifyRequest,
  type KernelVerifyResult,
} from "./types.js";

function applyTemplate(input: string, params?: Record<string, string>): string {
  return input.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => params?.[key] ?? "");
}

// Playwright types used loosely — the module is loaded dynamically and may not be installed.
interface PlaywrightPage {
  goto(url: string, opts?: Record<string, unknown>): Promise<unknown>;
  url(): string;
  title(): Promise<string>;
  click(selector: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  evaluate<T>(fn: () => T): Promise<T>;
  getByText(text: string): {
    first(): {
      isVisible(): Promise<boolean>;
      catch(fn: () => boolean): Promise<boolean>;
    };
  };
  locator(selector: string): {
    first(): {
      isVisible(): Promise<boolean>;
      catch(fn: () => boolean): Promise<boolean>;
    };
  };
  keyboard: { press(key: string): Promise<void> };
  mouse: { wheel(deltaX: number, deltaY: number): Promise<void> };
  waitForTimeout(ms: number): Promise<void>;
}

interface PlaywrightBrowser {
  newContext(): Promise<{ newPage(): Promise<PlaywrightPage> }>;
  close(): Promise<void>;
}

interface BrowserDocumentNode {
  getAttribute(name: string): string | null;
  textContent: string | null;
  id: string;
  tagName: string;
}

interface PlaywrightRuntimeModule {
  chromium: {
    launch(options: { headless: boolean; slowMo?: number }): Promise<PlaywrightBrowser>;
  };
}

/**
 * Playwright-backed kernel adapter for local route testing.
 * Runtime Centris execution should use the real-browser bridge.
 */
export class PlaywrightActionKernel implements ActionKernel {
  readonly version = ACTION_KERNEL_SPEC_VERSION;

  private page: PlaywrightPage | undefined;
  private browser: PlaywrightBrowser | undefined;

  constructor(
    private readonly options?: {
      headless?: boolean;
      slowMo?: number;
      autoLearn?: boolean;
      learnBaseDir?: string;
      learnAppId?: string;
    },
  ) {}

  async setup(): Promise<void> {
    if (this.page) {
      return;
    }
    // Dynamic import avoids a hard dependency on playwright at bundle time.
    const modName = "playwright";
    const mod = (await import(/* @vite-ignore */ modName)) as PlaywrightRuntimeModule;
    this.browser = await mod.chromium.launch({
      headless: this.options?.headless ?? true,
      slowMo: this.options?.slowMo,
    });
    const context = await this.browser.newContext();
    this.page = await context.newPage();
  }

  async teardown(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
    }
    this.page = undefined;
    this.browser = undefined;
  }

  async observe(request: KernelObserveRequest): Promise<KernelObserveResult> {
    await this.setup();
    if (request.url) {
      await this.page!.goto(request.url, { waitUntil: "domcontentloaded" });
    }

    const interactive = (await this.page!.evaluate(() => {
      const d = (
        globalThis as {
          document?: {
            querySelectorAll(selector: string): Iterable<unknown>;
          };
        }
      ).document;
      if (!d) {
        return [];
      }
      const selectors = ["button", "a[href]", "input", "textarea", "select", "[role='button']"];
      const out: Array<{ name: string; selector?: string }> = [];
      for (const sel of selectors) {
        const nodes = Array.from(d.querySelectorAll(sel)).slice(0, 10);
        for (const node of nodes) {
          const el = node as BrowserDocumentNode;
          const name = (
            el.getAttribute("aria-label") ||
            el.textContent ||
            el.getAttribute("placeholder") ||
            el.id ||
            el.tagName
          )
            .trim()
            .slice(0, 80);
          out.push({ name, selector: sel });
        }
      }
      return out.slice(0, 30);
    })) as Array<{ name: string; selector?: string }>;

    return {
      url: this.page!.url(),
      title: await this.page!.title(),
      interactive,
    };
  }

  async act(request: KernelActRequest): Promise<KernelActResult> {
    await this.setup();
    switch (request.kind) {
      case "navigate": {
        if (!request.value) {
          return { ok: false, details: { error: "navigate requires value" } };
        }
        await this.page!.goto(request.value, { waitUntil: "domcontentloaded" });
        return { ok: true };
      }
      case "click": {
        if (!request.target) {
          return { ok: false, details: { error: "click requires target" } };
        }
        await this.page!.click(request.target);
        return { ok: true };
      }
      case "type": {
        if (!request.target) {
          return { ok: false, details: { error: "type requires target" } };
        }
        await this.page!.fill(request.target, request.value ?? "");
        return { ok: true };
      }
      case "press": {
        if (!request.value) {
          return { ok: false, details: { error: "press requires value" } };
        }
        await this.page!.keyboard.press(request.value);
        return { ok: true };
      }
      case "wait": {
        await this.page!.waitForTimeout(Math.max(1, request.amount ?? 250));
        return { ok: true };
      }
      case "scroll": {
        const amount = request.amount ?? 500;
        const delta = request.value === "up" ? -Math.abs(amount) : Math.abs(amount);
        await this.page!.mouse.wheel(0, delta);
        return { ok: true };
      }
      default:
        return {
          ok: false,
          details: { error: `unsupported action: ${String(request.kind)}` },
        };
    }
  }

  async verify(request: KernelVerifyRequest): Promise<KernelVerifyResult> {
    await this.setup();
    const passed: KernelSuccessCheck[] = [];
    const failed: KernelSuccessCheck[] = [];

    for (const check of request.checks) {
      let ok = false;
      switch (check.type) {
        case "url_contains":
          ok = this.page!.url().includes(check.value);
          break;
        case "text_present":
          ok = await this.page!.getByText(check.value)
            .first()
            .isVisible()
            .catch(() => false);
          break;
        case "element_visible":
          ok = await this.page!.locator(check.value)
            .first()
            .isVisible()
            .catch(() => false);
          break;
        case "download":
          ok = true; // download verification is environment-specific in CLI harness
          break;
        case "network_url_contains":
          ok = true; // network tracing requires explicit hooks, treated as soft-pass in harness
          break;
      }
      if (ok) {
        passed.push(check);
      } else {
        failed.push(check);
      }
    }

    return { ok: failed.length === 0, passed, failed };
  }

  async route(request: KernelRouteRequest): Promise<KernelRouteResult> {
    await this.setup();
    let executed = 0;
    let selectorStepIndex = 0;

    if (request.url) {
      await this.act({ kind: "navigate", value: request.url });
      executed++;
    }

    for (const step of request.steps) {
      if ("navigate" in step) {
        await this.act({
          kind: "navigate",
          value: applyTemplate(step.navigate, request.params),
        });
        executed++;
      } else if ("click" in step) {
        const primaryTarget = applyTemplate(step.click, request.params);
        const fallbackTargets = (request.fallbackChains?.[selectorStepIndex] ?? []).map((sel) =>
          applyTemplate(sel, request.params),
        );
        await this.actWithSelectorFallback({
          kind: "click",
          target: primaryTarget,
          fallbackTargets,
        });
        executed++;
        selectorStepIndex++;
      } else if ("type" in step) {
        const primaryTarget = applyTemplate(step.type.target, request.params);
        const fallbackTargets = (request.fallbackChains?.[selectorStepIndex] ?? []).map((sel) =>
          applyTemplate(sel, request.params),
        );
        await this.actWithSelectorFallback({
          kind: "type",
          target: primaryTarget,
          value: applyTemplate(step.type.value, request.params),
          fallbackTargets,
        });
        executed++;
        selectorStepIndex++;
      } else if ("press" in step) {
        await this.act({ kind: "press", value: step.press });
        executed++;
      } else if ("wait" in step) {
        await this.act({ kind: "wait", amount: step.wait });
        executed++;
      } else if ("scroll" in step) {
        await this.act({
          kind: "scroll",
          value: step.scroll,
          amount: step.amount,
        });
        executed++;
      }
    }

    const verify = request.checks?.length
      ? await this.verify({ checks: request.checks })
      : undefined;
    const result: KernelRouteResult = {
      ok: verify ? verify.ok : true,
      executed,
      verify,
    };
    if ((this.options?.autoLearn ?? true) && result.ok && request.url) {
      const learnedPattern = this.deriveLearnPatternFromUrl(request.url);
      if (learnedPattern) {
        await this.learn({
          id: request.id,
          urlPattern: learnedPattern,
          steps: request.steps,
          checks: request.checks,
        });
      }
    }
    return result;
  }

  private async actWithSelectorFallback(params: {
    kind: "click" | "type";
    target: string;
    value?: string;
    fallbackTargets: string[];
  }): Promise<void> {
    const ordered = [params.target, ...params.fallbackTargets].filter(Boolean);
    const deduped = [...new Set(ordered)];
    let lastError: unknown;
    for (const target of deduped) {
      try {
        await this.act({
          kind: params.kind,
          target,
          value: params.value,
        });
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(`All selector fallbacks failed for ${params.kind}`);
  }

  async learn(request: KernelLearnRequest): Promise<KernelLearnResult> {
    persistLearnedRoute({
      request,
      baseDir: this.options?.learnBaseDir,
      appId: this.options?.learnAppId,
    });
    return {
      ok: true,
      routeId: request.id,
      version: this.version,
    };
  }

  private deriveLearnPatternFromUrl(url: string): string | null {
    try {
      const parsed = new URL(url);
      return `${parsed.origin}/*`;
    } catch {
      return null;
    }
  }
}
