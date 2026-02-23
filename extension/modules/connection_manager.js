/**
 * Unified Connection Manager for Centris Chrome Extension
 *
 * Provides a unified interface for communication with the backend,
 * automatically selecting the best available method:
 *
 * 1. Native Messaging (fastest, ~1-2ms) - if available
 * 2. WebSocket (fallback, ~5-10ms)
 *
 * Features:
 * - Automatic failover between communication methods
 * - Connection state tracking
 * - Message routing to appropriate handlers
 */

// ═══════════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════════

// Current communication method: 'native_messaging' | 'websocket' | 'disconnected'
let communicationMethod = "disconnected";

// Message handler callback for incoming commands from backend
let onMessageCallback = null;

// Connection state for status display
let connectionManagerState = {
  initialized: false,
  lastSendTime: null,
  lastReceiveTime: null,
  sendCount: 0,
  receiveCount: 0,
};

// ═══════════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Initialize communication with the backend
 * Tries Native Messaging first, falls back to WebSocket
 */
let _initInProgress = false;
let _lastInitTime = 0;

async function initializeCommunication() {
  const now = Date.now();

  // Debounce: don't init more than once every 5 seconds
  if (now - _lastInitTime < 5000) {
    return;
  }

  // Prevent concurrent initialization
  if (_initInProgress) {
    return;
  }

  _initInProgress = true;
  _lastInitTime = now;

  if (typeof logWithTimestamp === "function") {
    logWithTimestamp("info", "🚀 Initializing communication...");
  }

  try {
    // Set up message routing
    setupMessageRouting();

    // Try Native Messaging first if preferred
    const preferNative = typeof CONFIG !== "undefined" && CONFIG.PREFER_NATIVE_MESSAGING;

    if (preferNative && typeof tryConnectNativeMessaging === "function") {
      const nativeConnected = await tryConnectNativeMessaging();
      if (nativeConnected) {
        communicationMethod = "native_messaging";
        connectionManagerState.initialized = true;

        if (typeof logWithTimestamp === "function") {
          logWithTimestamp("info", "✅ Using Native Messaging (fastest mode)");
        }
        return;
      }
    }

    // Fall back to WebSocket
    if (typeof logWithTimestamp === "function") {
      logWithTimestamp("info", "📡 Falling back to WebSocket connection");
    }

    communicationMethod = "websocket";
    connectionManagerState.initialized = true;

    if (typeof connectWebSocket === "function") {
      await connectWebSocket();
    }
  } finally {
    _initInProgress = false;
  }
}

/**
 * Set up message routing from both communication channels
 */
function setupMessageRouting() {
  // Route Native Messaging messages
  if (typeof setNativeMessageCallback === "function") {
    setNativeMessageCallback((message) => {
      connectionManagerState.receiveCount++;
      connectionManagerState.lastReceiveTime = new Date().toISOString();

      if (onMessageCallback) {
        onMessageCallback(message);
      }
    });
  }

  // Route WebSocket messages
  if (typeof setWebSocketMessageCallback === "function") {
    setWebSocketMessageCallback((message) => {
      connectionManagerState.receiveCount++;
      connectionManagerState.lastReceiveTime = new Date().toISOString();

      // FEB 2026 DEBUG: Log navigate messages to trace where data is lost
      if (message && (message.type === "navigate" || message.type === "navigate_browser")) {
        console.log("[ConnMgr] 🔍 NAVIGATE received - message:", JSON.stringify(message));
        console.log("[ConnMgr] 🔍 NAVIGATE - message.data:", JSON.stringify(message.data));
        console.log("[ConnMgr] 🔍 NAVIGATE - message.url:", message.url);
        console.log("[ConnMgr] 🔍 NAVIGATE - message.navigate_url:", message.navigate_url);
      }

      if (onMessageCallback) {
        onMessageCallback(message);
      }
    });
  }

  // Set up fallback callback for Native Messaging (with debounce)
  let _fallbackTriggered = false;
  if (typeof setFallbackCallback === "function") {
    setFallbackCallback(() => {
      // Only trigger fallback once per session
      if (_fallbackTriggered) {
        return;
      }
      _fallbackTriggered = true;

      if (typeof logWithTimestamp === "function") {
        logWithTimestamp("info", "📡 Native Messaging failed - switching to WebSocket");
      }
      communicationMethod = "websocket";

      if (typeof connectWebSocket === "function") {
        connectWebSocket();
      }
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SENDING MESSAGES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Send a message to the backend via the best available method
 *
 * @param {Object} message - The message to send
 * @returns {boolean} - Whether the send was successful
 */
function sendToBackend(message) {
  connectionManagerState.sendCount++;
  connectionManagerState.lastSendTime = new Date().toISOString();

  // Try Native Messaging first if it's the current method
  if (communicationMethod === "native_messaging") {
    if (typeof sendViaNativeMessaging === "function") {
      const sent = sendViaNativeMessaging(message);
      if (sent) {
        if (typeof logWithTimestamp === "function") {
          logWithTimestamp("debug", "📤 Sent via Native Messaging", {
            type: message.type,
            id: message.id,
          });
        }
        return true;
      }
    }
    // Native Messaging failed, try WebSocket
    if (typeof logWithTimestamp === "function") {
      logWithTimestamp("warn", "⚠️ Native Messaging send failed, trying WebSocket");
    }
  }

  // Try WebSocket
  if (typeof sendViaWebSocket === "function") {
    const sent = sendViaWebSocket(message);
    if (sent) {
      if (typeof logWithTimestamp === "function") {
        logWithTimestamp("debug", "📤 Sent via WebSocket", {
          type: message.type,
          id: message.id,
        });
      }
      return true;
    }
  }

  // No communication channel available
  if (typeof logWithTimestamp === "function") {
    logWithTimestamp("error", "❌ No communication channel available", {
      method: communicationMethod,
      type: message.type,
    });
  }

  // Queue response for retry if it's a response message
  if (message.type === "response" && typeof queueResponseForRetry === "function") {
    queueResponseForRetry(message);
  }

  return false;
}

/**
 * Send a message to the desktop app (alias for sendToBackend)
 * Kept for backward compatibility with existing code
 *
 * @param {Object} message - The message to send
 * @returns {boolean} - Whether the send was successful
 */
function sendToDesktopApp(message) {
  return sendToBackend(message);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATUS AND CALLBACKS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Check if currently connected to backend
 * @returns {boolean}
 */
function isConnected() {
  if (communicationMethod === "native_messaging") {
    return typeof isNativeMessagingAvailable === "function" && isNativeMessagingAvailable();
  }
  if (communicationMethod === "websocket") {
    return typeof isWebSocketConnected === "function" && isWebSocketConnected();
  }
  return false;
}

/**
 * Check if connection is busy (connecting or connected)
 * Use this for keep-alive/reconnection checks to avoid duplicate attempts
 * @returns {boolean}
 */
function isConnectionBusy() {
  if (communicationMethod === "native_messaging") {
    return typeof isNativeMessagingAvailable === "function" && isNativeMessagingAvailable();
  }
  if (communicationMethod === "websocket") {
    // FEB 2026: Use isWebSocketBusy() to check both CONNECTING and OPEN
    return typeof isWebSocketBusy === "function" && isWebSocketBusy();
  }
  return _initInProgress || _forceReconnectInProgress;
}

/**
 * Get current connection status
 * @returns {Object}
 */
function getConnectionStatus() {
  const nativeState =
    typeof getNativeMessagingState === "function"
      ? getNativeMessagingState()
      : { available: false, connected: false };

  const wsState =
    typeof getWebSocketState === "function" ? getWebSocketState() : { connected: false };

  return {
    method: communicationMethod,
    connected: isConnected(),
    nativeMessaging: nativeState,
    webSocket: wsState,
    stats: { ...connectionManagerState },
  };
}

/**
 * Set the callback for handling messages from backend
 * @param {Function} callback - Callback function(message)
 */
function setMessageCallback(callback) {
  onMessageCallback = callback;
}

/**
 * Get current communication method
 * @returns {string}
 */
function getCommunicationMethod() {
  return communicationMethod;
}

/**
 * Force reconnection (e.g., when switching backends)
 */
let _forceReconnectInProgress = false;
let _lastForceReconnect = 0;

async function forceReconnect() {
  const now = Date.now();

  // Prevent concurrent reconnections and debounce
  if (_forceReconnectInProgress) {
    if (typeof logWithTimestamp === "function") {
      logWithTimestamp("debug", "🔄 Force reconnect already in progress - skipping");
    }
    return;
  }

  if (now - _lastForceReconnect < 30000) {
    if (typeof logWithTimestamp === "function") {
      logWithTimestamp("debug", "🔄 Force reconnect debounced (< 30s since last)");
    }
    return;
  }

  _forceReconnectInProgress = true;
  _lastForceReconnect = now;

  try {
    if (typeof logWithTimestamp === "function") {
      logWithTimestamp("info", "🔄 Force reconnecting...");
    }

    // Disconnect current connections
    if (typeof disconnectNativeMessaging === "function") {
      disconnectNativeMessaging();
    }
    if (typeof disconnectWebSocket === "function") {
      disconnectWebSocket();
    }

    communicationMethod = "disconnected";

    // Reinitialize
    await initializeCommunication();
  } finally {
    _forceReconnectInProgress = false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// KEEP-ALIVE SYSTEM - Critical for Manifest V3 Service Worker Persistence
// ═══════════════════════════════════════════════════════════════════════════════

// Active commands tracking (for command-specific keep-alive)
const activeCommands = new Map(); // commandId -> { startTime, type }
let commandKeepAliveActive = false;

/**
 * Track active command (for keep-alive during execution)
 * @param {string} commandId - Unique command ID
 * @param {string} commandType - Type of command being executed
 */
function trackActiveCommand(commandId, commandType) {
  activeCommands.set(commandId, {
    startTime: Date.now(),
    type: commandType,
  });

  // Start command-specific keep-alive if not already running
  if (!commandKeepAliveActive && chrome.alarms) {
    commandKeepAliveActive = true;
    chrome.alarms.create("command_keep_alive", { delayInMinutes: 0.05 }); // 3 seconds

    if (typeof logWithTimestamp === "function") {
      logWithTimestamp("debug", "🔋 Started command keep-alive", { commandId, commandType });
    }
  }
}

/**
 * Untrack completed command
 * @param {string} commandId - Command ID that completed
 */
function untrackCommand(commandId) {
  activeCommands.delete(commandId);

  // Stop command keep-alive if no more active commands
  if (activeCommands.size === 0 && commandKeepAliveActive) {
    commandKeepAliveActive = false;
    if (chrome.alarms) {
      chrome.alarms.clear("command_keep_alive");
    }

    if (typeof logWithTimestamp === "function") {
      logWithTimestamp("debug", "🔋 Stopped command keep-alive - all commands complete");
    }
  }
}

/**
 * Get WebSocket state name for logging
 */
function getWebSocketStateName(readyState) {
  switch (readyState) {
    case 0:
      return "CONNECTING";
    case 1:
      return "OPEN";
    case 2:
      return "CLOSING";
    case 3:
      return "CLOSED";
    default:
      return "UNKNOWN";
  }
}

/**
 * Initialize keep-alive alarms
 * CRITICAL for Manifest V3 service worker persistence
 */
function initializeKeepAlive() {
  if (!chrome.alarms) {
    if (typeof logWithTimestamp === "function") {
      logWithTimestamp("warn", "⚠️ Chrome alarms API not available - keep-alive disabled");
    }
    return;
  }

  // Set up alarm listener
  let _lastKeepAliveReconnect = 0;
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "keep_alive") {
      // Wake up service worker — this prevents MV3 suspension.
      // If disconnected, reconnect immediately (no 60s debounce).
      if (!isConnectionBusy()) {
        const now = Date.now();
        if (now - _lastKeepAliveReconnect > 5000) {
          _lastKeepAliveReconnect = now;
          initializeCommunication();
        }
      } else if (typeof isWebSocketConnected === "function" && isWebSocketConnected()) {
        // Connection alive — send a ping to keep the WebSocket from idling
        if (
          typeof globalThis.wsConnection !== "undefined" &&
          globalThis.wsConnection &&
          globalThis.wsConnection.readyState === WebSocket.OPEN
        ) {
          try {
            globalThis.wsConnection.send(JSON.stringify({ type: "ping", timestamp: Date.now() }));
          } catch (e) {
            /* ignore */
          }
        }
      }
    } else if (alarm.name === "command_keep_alive") {
      // Command-specific keep-alive
      if (typeof logWithTimestamp === "function") {
        logWithTimestamp("debug", "🔋 Command keep-alive alarm fired", {
          activeCommands: activeCommands.size,
        });
      }

      // Reschedule if commands are still active
      if (activeCommands.size > 0 && commandKeepAliveActive) {
        chrome.alarms.create("command_keep_alive", { delayInMinutes: 0.05 }); // 3 seconds

        // Send ping to keep WebSocket connection alive
        if (
          typeof globalThis.wsConnection !== "undefined" &&
          globalThis.wsConnection &&
          globalThis.wsConnection.readyState === WebSocket.OPEN
        ) {
          try {
            globalThis.wsConnection.send(JSON.stringify({ type: "ping", timestamp: Date.now() }));
          } catch (e) {
            // Ignore ping errors
          }
        }
      }
    }
  });

  // Create main keep-alive alarm (every 25 seconds)
  // Chrome Manifest V3 suspends service workers after 30s of inactivity.
  // 25s keeps us under the threshold so the WebSocket stays alive.
  chrome.alarms.create("keep_alive", { periodInMinutes: 25 / 60 }); // 25 seconds

  if (typeof logWithTimestamp === "function") {
    logWithTimestamp("info", "⏰ Keep-alive alarms initialized (60s interval)");
  }
}

// Periodic reconnection via setInterval removed — the chrome.alarms keep_alive
// handler is the single source of truth for reconnection. setInterval and alarms
// competed, causing duplicate connections and "replacing existing" churn.

// Initialize keep-alive system when module loads (alarm-only — no competing setInterval)
if (typeof chrome !== "undefined" && chrome.alarms) {
  initializeKeepAlive();
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

// Make available globally for service worker
if (typeof globalThis !== "undefined") {
  globalThis.initializeCommunication = initializeCommunication;
  globalThis.sendToBackend = sendToBackend;
  globalThis.sendToDesktopApp = sendToDesktopApp;
  globalThis.isConnected = isConnected;
  globalThis.isConnectionBusy = isConnectionBusy; // FEB 2026: For keep-alive checks
  globalThis.getConnectionStatus = getConnectionStatus;
  globalThis.setMessageCallback = setMessageCallback;
  globalThis.getCommunicationMethod = getCommunicationMethod;
  globalThis.forceReconnect = forceReconnect;

  // Keep-alive functions
  globalThis.trackActiveCommand = trackActiveCommand;
  globalThis.untrackCommand = untrackCommand;
  globalThis.initializeKeepAlive = initializeKeepAlive;
  globalThis.activeCommands = activeCommands;

  // Expose communication method for backward compatibility
  Object.defineProperty(globalThis, "communicationMethod", {
    get: () => communicationMethod,
    set: (val) => {
      communicationMethod = val;
    },
  });
}
