const { spawn } = require("child_process");
const path = require("path");
const EventEmitter = require("events");
const fs = require("fs");
// Handle ES module interop - logger might be exported as { default: Logger }
const loggerModule = require("../utils/logger");
const logger = loggerModule.default || loggerModule;

/**
 * Fn+Space Key Manager
 *
 * This manager uses CGEventTap (like Wispr Flow) to detect Fn+Space globally.
 * Unlike Electron's globalShortcut, this can detect Fn modifier + Space key.
 */
class FnSpaceKeyManager extends EventEmitter {
  constructor() {
    super();
    this.process = null;
    this.isSupported = process.platform === "darwin";
    this.hasReportedError = false;
  }

  async checkAccessibilityPermissions() {
    if (process.platform !== "darwin") {
      return true;
    }

    return new Promise((resolve) => {
      const { spawn } = require("child_process");
      const testProcess = spawn("osascript", [
        "-e",
        'tell application "System Events" to get name of first process',
      ]);

      let testError = "";
      testProcess.stderr.on("data", (data) => {
        testError += data.toString();
      });

      testProcess.on("close", (code) => {
        resolve(code === 0);
      });

      testProcess.on("error", () => {
        resolve(false);
      });
    });
  }

  async start() {
    if (!this.isSupported) {
      logger.log("[FnSpaceKeyManager] Not macOS, skipping Fn+Space listener");
      return;
    }

    if (this.process) {
      logger.log("[FnSpaceKeyManager] Already running");
      return;
    }

    // Check accessibility permissions first
    const hasPermissions = await this.checkAccessibilityPermissions();
    if (!hasPermissions) {
      this.reportError(
        new Error(
          "Accessibility permissions required for Fn+Space hotkey. Please enable Centris AI in System Settings > Privacy & Security > Accessibility.",
        ),
      );
      return;
    }

    const listenerPath = this.resolveListenerBinary();
    if (!listenerPath) {
      this.reportError(
        new Error(
          "macOS Fn+Space listener binary not found. Run `npm run compile:fn-space` before packaging.",
        ),
      );
      return;
    }

    try {
      fs.accessSync(listenerPath, fs.constants.X_OK);
    } catch (accessError) {
      this.reportError(new Error(`macOS Fn+Space listener is not executable: ${listenerPath}`));
      return;
    }

    logger.log("[FnSpaceKeyManager] Starting Fn+Space listener...");
    this.hasReportedError = false;
    this.process = spawn(listenerPath);

    this.process.stdout.setEncoding("utf8");
    this.process.stdout.on("data", (chunk) => {
      chunk
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line) => {
          if (line === "FN_SPACE_DOWN") {
            logger.log("[FnSpaceKeyManager] Fn+Space detected!");
            this.emit("fn-space-down");
          }
        });
    });

    this.process.stderr.setEncoding("utf8");
    this.process.stderr.on("data", (data) => {
      const message = data.toString().trim();
      if (message.length > 0) {
        if (
          message.includes("Failed to create event tap") ||
          message.includes("Accessibility permissions required") ||
          message.includes("permission") ||
          message.includes("accessibility")
        ) {
          this.reportError(
            new Error(
              "Accessibility permissions required for Fn+Space hotkey. Please enable Centris AI in System Settings > Privacy & Security > Accessibility.",
            ),
          );
        } else {
          this.reportError(new Error(message));
        }
      }
    });

    this.process.on("error", (error) => {
      this.reportError(error);
      this.process = null;
    });

    this.process.on("exit", (code, signal) => {
      this.process = null;
      if (code !== 0 && code !== null) {
        const error = new Error(
          `Fn+Space listener exited with code ${code} signal ${signal ?? "null"}`,
        );
        this.reportError(error);
      }
    });
  }

  stop() {
    if (this.process) {
      logger.log("[FnSpaceKeyManager] Stopping Fn+Space listener...");
      this.process.kill();
      this.process = null;
    }
  }

  reportError(error) {
    if (this.hasReportedError) {
      return;
    }
    this.hasReportedError = true;
    if (this.process) {
      try {
        this.process.kill();
      } catch {
        // ignore
      } finally {
        this.process = null;
      }
    }
    this.emit("error", error);
  }

  resolveListenerBinary() {
    const candidates = new Set([
      path.join(__dirname, "..", "..", "resources", "bin", "macos-fn-space-listener"),
      path.join(__dirname, "..", "..", "resources", "macos-fn-space-listener"),
    ]);

    if (process.resourcesPath) {
      [
        path.join(process.resourcesPath, "macos-fn-space-listener"),
        path.join(process.resourcesPath, "bin", "macos-fn-space-listener"),
        path.join(process.resourcesPath, "resources", "macos-fn-space-listener"),
        path.join(process.resourcesPath, "resources", "bin", "macos-fn-space-listener"),
        path.join(
          process.resourcesPath,
          "app.asar.unpacked",
          "resources",
          "macos-fn-space-listener",
        ),
        path.join(
          process.resourcesPath,
          "app.asar.unpacked",
          "resources",
          "bin",
          "macos-fn-space-listener",
        ),
      ].forEach((candidate) => candidates.add(candidate));
    }

    const candidatePaths = [...candidates];

    for (const candidate of candidatePaths) {
      try {
        const stats = fs.statSync(candidate);
        if (stats.isFile()) {
          return candidate;
        }
      } catch {
        continue;
      }
    }

    return null;
  }
}

module.exports = FnSpaceKeyManager;
