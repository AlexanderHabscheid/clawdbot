const { spawn } = require("child_process");
const path = require("path");
const EventEmitter = require("events");
const fs = require("fs");
const loggerModule = require("../utils/logger");
const logger = loggerModule.default || loggerModule;

class GlobeKeyManager extends EventEmitter {
  constructor() {
    super();
    this.process = null;
    this.isSupported = process.platform === "darwin";
    this.hasReportedError = false;
    this._startPromise = null; // Track ongoing start() to prevent duplicate spawns
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
    logger.debug("[GlobeKeyManager] start() called");
    logger.debug("[GlobeKeyManager] isSupported:", this.isSupported);
    logger.debug("[GlobeKeyManager] process already exists:", !!this.process);
    logger.debug("[GlobeKeyManager] _startPromise exists:", !!this._startPromise);

    // Prevent concurrent start() calls from spawning multiple processes
    if (this._startPromise) {
      logger.debug("[GlobeKeyManager] Already starting - returning existing promise");
      return this._startPromise;
    }

    if (!this.isSupported || this.process) {
      logger.debug("[GlobeKeyManager] Skipping start - not supported or already running");
      return;
    }

    // Wrap the entire start logic in a promise to prevent race conditions
    this._startPromise = this._doStart();

    try {
      await this._startPromise;
    } finally {
      this._startPromise = null;
    }
  }

  async _doStart() {
    // Check accessibility permissions first
    logger.debug("[GlobeKeyManager] Checking accessibility permissions...");
    const hasPermissions = await this.checkAccessibilityPermissions();
    logger.debug("[GlobeKeyManager] Accessibility permissions granted:", hasPermissions);

    if (!hasPermissions) {
      this.reportError(
        new Error(
          "Accessibility permissions required for Globe key. Please enable Centris AI in System Settings > Privacy & Security > Accessibility.",
        ),
      );
      return;
    }

    const listenerPath = this.resolveListenerBinary();
    logger.debug("[GlobeKeyManager] Resolved listener binary path:", listenerPath);

    if (!listenerPath) {
      this.reportError(
        new Error(
          "macOS Globe listener binary not found. Run `npm run compile:globe` before packaging.",
        ),
      );
      return;
    }

    try {
      fs.accessSync(listenerPath, fs.constants.X_OK);
      logger.debug("[GlobeKeyManager] ✅ Binary is executable");
    } catch (accessError) {
      console.error("[GlobeKeyManager] ❌ Binary not executable:", accessError.message);
      this.reportError(new Error(`macOS Globe listener is not executable: ${listenerPath}`));
      return;
    }

    logger.debug("[GlobeKeyManager] Spawning globe listener process...");
    this.hasReportedError = false;
    this.process = spawn(listenerPath);
    logger.debug("[GlobeKeyManager] ✅ Process spawned, PID:", this.process.pid);

    this.process.stdout.setEncoding("utf8");
    this.process.stdout.on("data", (chunk) => {
      logger.debug("[GlobeKeyManager] 📥 Received stdout:", chunk.trim());
      chunk
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line) => {
          logger.debug("[GlobeKeyManager] 🔑 Processing line:", line);
          if (line === "STARTED") {
            logger.debug("[GlobeKeyManager] ✅ Binary confirmed started");
          } else if (line === "FN_DOWN") {
            logger.debug("[GlobeKeyManager] 🎯 GLOBE KEY DOWN - emitting event");
            this.emit("globe-down");
          } else if (line === "FN_UP") {
            logger.debug("[GlobeKeyManager] 🎯 GLOBE KEY UP - emitting event");
            this.emit("globe-up");
          }
        });
    });

    this.process.stderr.setEncoding("utf8");
    this.process.stderr.on("data", (data) => {
      const message = data.toString().trim();
      logger.debug("[GlobeKeyManager] 📥 Received stderr:", message);
      if (message.length > 0) {
        // Check if it's a permission-related error
        if (
          message.includes("Failed to open HID manager") ||
          message.includes("permission") ||
          message.includes("accessibility")
        ) {
          console.error("[GlobeKeyManager] ❌ Permission error detected");
          this.reportError(
            new Error(
              "Accessibility permissions required for Globe key. Please enable Centris AI in System Settings > Privacy & Security > Accessibility.",
            ),
          );
        } else {
          console.error("[GlobeKeyManager] ❌ Other error:", message);
          this.reportError(new Error(message));
        }
      }
    });

    this.process.on("error", (error) => {
      console.error("[GlobeKeyManager] ❌ Process error:", error.message);
      this.reportError(error);
      this.process = null;
    });

    this.process.on("exit", (code, signal) => {
      logger.debug("[GlobeKeyManager] Process exited - code:", code, "signal:", signal);
      this.process = null;
      if (code !== 0) {
        const error = new Error(
          `Globe key listener exited with code ${code ?? "null"} signal ${signal ?? "null"}`,
        );
        console.error("[GlobeKeyManager] ❌ Abnormal exit:", error.message);
        this.reportError(error);
      }
    });

    logger.debug(
      "[GlobeKeyManager] ✅ Globe key listener is now active and listening for Fn/Globe key",
    );
  }

  stop() {
    if (this.process) {
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
    // Suppress all error output - onboarding handles permission setup
    // No console output to avoid spam
    this.emit("error", error);
  }

  resolveListenerBinary() {
    const candidates = new Set([
      path.join(__dirname, "..", "..", "resources", "bin", "macos-globe-listener"),
      path.join(__dirname, "..", "..", "resources", "macos-globe-listener"),
    ]);

    if (process.resourcesPath) {
      [
        path.join(process.resourcesPath, "macos-globe-listener"),
        path.join(process.resourcesPath, "bin", "macos-globe-listener"),
        path.join(process.resourcesPath, "resources", "macos-globe-listener"),
        path.join(process.resourcesPath, "resources", "bin", "macos-globe-listener"),
        path.join(process.resourcesPath, "app.asar.unpacked", "resources", "macos-globe-listener"),
        path.join(
          process.resourcesPath,
          "app.asar.unpacked",
          "resources",
          "bin",
          "macos-globe-listener",
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

module.exports = GlobeKeyManager;
