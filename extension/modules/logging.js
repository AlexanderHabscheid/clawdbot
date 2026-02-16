/**
 * Smart Logging System for Centris Chrome Extension
 *
 * Features:
 * - Log level control (debug/info/warn/error/none)
 * - Message deduplication to prevent spam
 * - Timestamped output
 * - Convenient log.* shorthand methods
 */

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

// Log level: 'debug' | 'info' | 'warn' | 'error' | 'none'
// Set to 'warn' for production, 'debug' for development
let LOG_LEVEL = "warn";

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3, none: 99 };

// Deduplication: track recent log messages to prevent spam
const _recentLogs = new Map(); // message hash -> { count, lastTime }
const LOG_DEDUP_WINDOW_MS = 5000; // Deduplicate within 5 seconds
const LOG_DEDUP_MAX_COUNT = 3; // Show message max 3 times in window

// ═══════════════════════════════════════════════════════════════════════════════
// INTERNAL HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a simple hash from message + data keys for deduplication
 * @param {string} message - Log message
 * @param {Object} data - Optional data object
 * @returns {string} - Hash key
 */
function _hashMessage(message, data) {
  const key = message + (data ? JSON.stringify(Object.keys(data).toSorted()) : "");
  return key;
}

/**
 * Check if a message should be logged based on level and deduplication
 * @param {string} level - Log level
 * @param {string} message - Log message
 * @param {Object} data - Optional data
 * @returns {boolean} - Whether to log
 */
function _shouldLog(level, message, data) {
  // Check log level
  if (LOG_LEVELS[level] < LOG_LEVELS[LOG_LEVEL]) {
    return false;
  }

  // Always log errors
  if (level === "error") {
    return true;
  }

  // Deduplication check
  const hash = _hashMessage(message, data);
  const now = Date.now();
  const recent = _recentLogs.get(hash);

  if (recent) {
    // Within dedup window?
    if (now - recent.lastTime < LOG_DEDUP_WINDOW_MS) {
      recent.count++;
      recent.lastTime = now;

      // Suppress if over limit
      if (recent.count > LOG_DEDUP_MAX_COUNT) {
        return false;
      }
    } else {
      // Window expired, reset
      recent.count = 1;
      recent.lastTime = now;
    }
  } else {
    _recentLogs.set(hash, { count: 1, lastTime: now });
  }

  // Cleanup old entries periodically
  if (_recentLogs.size > 100) {
    for (const [key, val] of _recentLogs) {
      if (now - val.lastTime > LOG_DEDUP_WINDOW_MS * 2) {
        _recentLogs.delete(key);
      }
    }
  }

  return true;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Log a message with timestamp and level control
 * @param {string} level - 'debug' | 'info' | 'warn' | 'error'
 * @param {string} message - Log message
 * @param {Object} data - Optional data to log
 */
function logWithTimestamp(level, message, data = null) {
  if (!_shouldLog(level, message, data)) {
    return; // Skip duplicate or below-level logs
  }

  const timestamp = new Date().toISOString();
  const prefix = `[Centris ${timestamp.slice(11, 19)}]`; // Shorter timestamp (HH:MM:SS)

  switch (level) {
    case "info":
      console.log(prefix, message, data || "");
      break;
    case "warn":
      console.warn(prefix, message, data || "");
      break;
    case "error":
      console.error(prefix, message, data || "");
      break;
    case "debug":
      console.debug(prefix, message, data || "");
      break;
    default:
      console.log(prefix, message, data || "");
  }
}

/**
 * Convenient log object with level-specific methods
 */
const log = {
  debug: (msg, data) => logWithTimestamp("debug", msg, data),
  info: (msg, data) => logWithTimestamp("info", msg, data),
  warn: (msg, data) => logWithTimestamp("warn", msg, data),
  error: (msg, data) => logWithTimestamp("error", msg, data),
};

/**
 * Set the global log level
 * @param {string} level - 'debug' | 'info' | 'warn' | 'error' | 'none'
 */
function setLogLevel(level) {
  if (LOG_LEVELS[level] !== undefined) {
    LOG_LEVEL = level;
    console.log(`[Logging] Log level set to: ${level}`);
  } else {
    console.warn(`[Logging] Invalid log level: ${level}. Valid: debug, info, warn, error, none`);
  }
}

/**
 * Get the current log level
 * @returns {string}
 */
function getLogLevel() {
  return LOG_LEVEL;
}

/**
 * Clear the deduplication cache
 */
function clearLogCache() {
  _recentLogs.clear();
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

// Make available globally for service worker
if (typeof globalThis !== "undefined") {
  globalThis.logWithTimestamp = logWithTimestamp;
  globalThis.log = log;
  globalThis.LOG_LEVELS = LOG_LEVELS;
  globalThis.setLogLevel = setLogLevel;
  globalThis.getLogLevel = getLogLevel;
  globalThis.clearLogCache = clearLogCache;
}
