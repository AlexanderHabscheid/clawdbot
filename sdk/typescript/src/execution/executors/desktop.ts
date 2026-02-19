/**
 * @centris/sdk - Desktop Executor
 *
 * Executes capabilities via desktop app automation.
 */

import type { Executor, ExecutorContext, ExecutorResult } from "../types.js";
import { executorError } from "../types.js";

/**
 * Desktop Executor
 *
 * Executes capabilities by automating desktop applications.
 * Uses accessibility APIs (AppleScript on macOS, UI Automation on Windows).
 */
export class DesktopExecutor implements Executor {
  readonly type = "desktop" as const;
  private desktopAvailable: boolean | null = null;

  /**
   * Execute a capability via desktop automation.
   */
  async execute(
    connectorId: string,
    capabilityId: string,
    params: Record<string, unknown>,
    context: ExecutorContext,
  ): Promise<ExecutorResult> {
    void connectorId;
    void capabilityId;
    void params;
    void context;
    return executorError(
      "DESKTOP_NOT_IMPLEMENTED",
      "Desktop executor is not implemented in @centris/sdk yet. Use Centris runtime desktop bridge.",
      {
        retryable: false,
        metadata: { executionMethod: "desktop", latencyMs: 0 },
      },
    );
  }

  /**
   * Check if desktop automation is available.
   */
  async isAvailable(): Promise<boolean> {
    if (this.desktopAvailable === null) {
      this.desktopAvailable = false;
    }
    return this.desktopAvailable;
  }
}
