/**
 * Centralized logging utility with log levels
 *
 * LOG_LEVEL environment variable controls verbosity:
 * - "error"  : Only errors
 * - "warn"   : Errors + warnings
 * - "info"   : Errors + warnings + info (default in production)
 * - "log"    : Errors + warnings + info + logs
 * - "debug"  : Everything (default in development)
 * - "silent" : No output except critical errors
 *
 * Set LOG_LEVEL=info to reduce verbose logging in dev mode.
 */

const isDevelopment =
  typeof process !== "undefined" && process.env && process.env.NODE_ENV === "development";

// Log levels (higher = more verbose)
const LOG_LEVELS = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  log: 4,
  debug: 5,
};

// Get configured log level
function getLogLevel() {
  if (typeof process !== "undefined" && process.env && process.env.LOG_LEVEL) {
    return LOG_LEVELS[process.env.LOG_LEVEL.toLowerCase()] ?? LOG_LEVELS.debug;
  }
  // Default: debug in dev, info in production
  return isDevelopment ? LOG_LEVELS.debug : LOG_LEVELS.info;
}

class Logger {
  constructor() {
    this.level = getLogLevel();
  }

  // Refresh level (useful if env changes at runtime)
  refreshLevel() {
    this.level = getLogLevel();
  }

  log(...args) {
    if (this.level >= LOG_LEVELS.log) {
      console.log(...args);
    }
  }

  error(...args) {
    // Always log errors (level 1+)
    if (this.level >= LOG_LEVELS.error) {
      console.error(...args);
    }
  }

  warn(...args) {
    if (this.level >= LOG_LEVELS.warn) {
      console.warn(...args);
    }
  }

  info(...args) {
    if (this.level >= LOG_LEVELS.info) {
      console.info(...args);
    }
  }

  debug(...args) {
    if (this.level >= LOG_LEVELS.debug) {
      console.debug(...args);
    }
  }
}

// Export singleton instance
const logger = new Logger();

// Export for CommonJS (Node.js/Electron main process)
// In Node.js/Electron main process, module is always defined
if (typeof module !== "undefined" && module.exports) {
  // Set both direct export and default for ES module interop
  module.exports = logger;
  // Also set default property for ES module interop when using require()
  if (!module.exports.default) {
    module.exports.default = logger;
  }
}

// Export for ES modules (renderer process)
if (typeof window !== "undefined") {
  window.logger = logger;
}

// Also export as default for ES module compatibility (Vite/build tools)
// This is needed for ES module imports but causes Node.js to wrap require() results
export default logger;
