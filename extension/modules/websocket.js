/**
 * WebSocket Connection Module for Centris Chrome Extension
 *
 * Handles WebSocket communication with the backend server.
 * This is the fallback when Native Messaging is not available.
 * (~5-10ms overhead)
 *
 * Features:
 * - Auto-reconnection with exponential backoff
 * - Response queueing for disconnection recovery
 * - Handshake protocol
 * - Connection state tracking
 */

// ═══════════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════════

// WebSocket connection
let wsConnection = null;

// Reconnection tracking
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

// Vision streaming state (for cleanup on disconnect)
// NOTE: visionStreamingActive is declared in snapshot.js, we use globalThis reference
// visionStreamCallbacks is local to this module for WebSocket-specific cleanup
let wsVisionStreamCallbacks = new Map();

// Connection state tracking
let connectionState = {
  lastConnectionAttempt: null,
  lastSuccessfulConnection: null,
  lastDisconnection: null,
  handshakeSent: false,
  handshakeAcknowledged: false,
  messageCount: { sent: 0, received: 0 },
};

// Response queue for messages that couldn't be sent due to disconnection
const pendingResponseQueue = [];

// Message handler callback (set by connection_manager)
let onWebSocketMessageCallback = null;

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get WebSocket state name from numeric state
 * @param {number} state - WebSocket readyState
 * @returns {string}
 */
function getWebSocketStateName(state) {
  if (state === null || state === undefined) {
    return "null";
  }
  const states = {
    [WebSocket.CONNECTING]: "CONNECTING",
    [WebSocket.OPEN]: "OPEN",
    [WebSocket.CLOSING]: "CLOSING",
    [WebSocket.CLOSED]: "CLOSED",
  };
  return states[state] || `UNKNOWN(${state})`;
}

/**
 * Get current WebSocket ready state
 * @returns {string}
 */
function getWebSocketReadyState() {
  if (!wsConnection) {
    return "null";
  }
  try {
    return getWebSocketStateName(wsConnection.readyState);
  } catch (e) {
    return "null";
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONNECTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Initialize WebSocket connection to backend
 */
let _lastConnectionAttempt = 0;
let _connectionInProgress = false;
let _connectionAttemptCount = 0;

async function connectWebSocket() {
  const connectionId = Date.now();
  _connectionAttemptCount++;

  // FEB 2026 FIX: Light debounce to prevent connection spam.
  // Old code had 30-SECOND debounce which meant the extension couldn't reconnect
  // after a backend restart for 30 seconds. That's why first commands always timed out.
  // 2 seconds is enough to prevent spam while allowing fast reconnection.
  const timeSinceLastAttempt = connectionId - _lastConnectionAttempt;
  if (timeSinceLastAttempt < 2000) {
    // 2 seconds debounce (was 30s!)
    return;
  }

  // Prevent concurrent connection attempts
  if (_connectionInProgress) {
    console.log("[Centris WS] ⚠️ Connection already in progress - skipping");
    if (typeof logWithTimestamp === "function") {
      logWithTimestamp("debug", "⚠️ Connection already in progress - skipping");
    }
    return;
  }

  // FEB 2026: If already connected and open, skip
  if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
    console.log("[Centris WS] ✅ Already connected - skipping reconnection");
    return;
  }

  _lastConnectionAttempt = connectionId;
  connectionState.lastConnectionAttempt = new Date().toISOString();
  connectionState.handshakeSent = false;
  connectionState.handshakeAcknowledged = false;

  if (typeof logWithTimestamp === "function") {
    logWithTimestamp("info", `🔄 WebSocket connection attempt #${reconnectAttempts + 1} initiated`);
  }

  // Prevent duplicate connections - this is expected, don't log
  if (
    wsConnection &&
    (wsConnection.readyState === WebSocket.CONNECTING || wsConnection.readyState === WebSocket.OPEN)
  ) {
    return;
  }

  _connectionInProgress = true;

  // Close existing connection if it exists but is closing/closed
  if (wsConnection && wsConnection.readyState !== WebSocket.CLOSED) {
    if (typeof logWithTimestamp === "function") {
      logWithTimestamp("info", "🔌 Closing existing connection before new attempt", {
        previousState: getWebSocketStateName(wsConnection.readyState),
        connectionId,
      });
    }
    try {
      wsConnection.close();
    } catch (e) {
      if (typeof logWithTimestamp === "function") {
        logWithTimestamp("warn", "⚠️ Error closing existing connection", {
          error: e.message,
          connectionId,
        });
      }
    }
  }

  try {
    // Get WebSocket URL from config
    let wsUrl;
    if (typeof CONFIG !== "undefined" && CONFIG.getExtensionWebSocketUrl) {
      wsUrl = await CONFIG.getExtensionWebSocketUrl();
    } else {
      wsUrl = null;
    }

    if (!wsUrl) {
      _connectionInProgress = false;
      if (typeof logWithTimestamp === "function") {
        logWithTimestamp("warn", "⚠️ No gateway URL available — is the OpenClaw gateway running?");
      }
      // Schedule retry (gateway may start later)
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        const delay = Math.min(2000 * reconnectAttempts, 10000);
        setTimeout(connectWebSocket, delay);
      }
      return;
    }

    if (typeof logWithTimestamp === "function") {
      logWithTimestamp("info", "🌐 Resolved WebSocket URL", { url: wsUrl, connectionId });
      logWithTimestamp("info", "🔌 Creating WebSocket connection", { url: wsUrl, connectionId });
    }

    wsConnection = new WebSocket(wsUrl);

    wsConnection.onopen = () => {
      const openTime = new Date().toISOString();
      connectionState.lastSuccessfulConnection = openTime;
      reconnectAttempts = 0;
      _connectionInProgress = false;

      if (typeof logWithTimestamp === "function") {
        logWithTimestamp("info", "✅ WebSocket connection OPENED", { url: wsUrl });
      }

      // Send handshake immediately (no delay - speed matters)
      sendHandshake(connectionId);

      // Notify popup
      notifyPopup(connectionId);
    };

    wsConnection.onmessage = async (event) => {
      const receiveTime = new Date().toISOString();
      connectionState.messageCount.received++;

      try {
        const message = JSON.parse(event.data);
        const messageType = message.type || "unknown";

        // Handle handshake acknowledgment
        if (
          messageType === "handshake_ack" &&
          connectionState.handshakeSent &&
          !connectionState.handshakeAcknowledged
        ) {
          connectionState.handshakeAcknowledged = true;
          setTimeout(() => {
            retryQueuedResponses();
          }, 100);
          return;
        }

        // Handle server-side ping — respond with pong to keep connection alive.
        // This also keeps the MV3 service worker awake (message activity resets the 30s timer).
        if (messageType === "ping") {
          sendViaWebSocket({ type: "pong", timestamp: Date.now() });
          return;
        }

        // Forward command to handler
        if (onWebSocketMessageCallback) {
          await onWebSocketMessageCallback(message);
        } else {
          console.error("[Centris WS] ❌ NO CALLBACK - message dropped:", messageType);
        }
      } catch (error) {
        if (typeof logWithTimestamp === "function") {
          logWithTimestamp("error", "❌ Error handling WebSocket message", {
            connectionId,
            error: error.message,
            receiveTime,
          });
        }
      }
    };

    wsConnection.onerror = (error) => {
      _connectionInProgress = false;
      let errorMessage = "Unknown error";
      if (error instanceof Error) {
        errorMessage = error.message || error.toString();
      } else if (error && typeof error === "object") {
        errorMessage = error.message || error.type || JSON.stringify(error);
      }

      if (typeof logWithTimestamp === "function") {
        logWithTimestamp("error", "❌ WebSocket ERROR", { error: errorMessage });
      }
    };

    wsConnection.onclose = (event) => {
      const closeTime = new Date().toISOString();
      connectionState.lastDisconnection = closeTime;
      _connectionInProgress = false;

      const isChromeCrash = event.code === 1006 && !event.wasClean;
      const isBackendCrash = event.code === 1001;

      if (typeof logWithTimestamp === "function") {
        logWithTimestamp("info", "🔌 WebSocket connection CLOSED", {
          closeCode: event.code,
          wasClean: event.wasClean,
        });
      }

      wsConnection = null;

      // Stop vision streams on disconnect
      stopAllVisionStreams(connectionId);

      // Handle reconnection
      handleReconnection(event, connectionId, isChromeCrash, isBackendCrash);
    };
  } catch (error) {
    _connectionInProgress = false;
    if (typeof logWithTimestamp === "function") {
      logWithTimestamp("error", "❌ Failed to create WebSocket connection", {
        error: error.message,
      });
    }
  }
}

/**
 * Send handshake message to backend
 */
function sendHandshake(connectionId) {
  const handshakeMessage = {
    type: "extension_ready",
    version: "2.0.0-DEBUG-FEB2026", // DEBUG: Version marker to verify reload
    extensionId: chrome.runtime.id,
    capabilities: [
      "native_messaging",
      "vision_streaming",
      "full_page_screenshots",
      "element_screenshots",
      "vision_based_detection",
      "coordinate_clicking",
      "process_monitoring",
      "window_management",
    ],
  };

  if (typeof logWithTimestamp === "function") {
    logWithTimestamp("info", "📤 Sending WebSocket handshake", {
      connectionId,
      version: handshakeMessage.version,
    });
  }

  const sent = sendViaWebSocket(handshakeMessage);
  if (sent) {
    connectionState.handshakeSent = true;
  }
}

/**
 * Notify popup of connection status
 */
function notifyPopup(connectionId) {
  try {
    chrome.runtime.sendMessage(
      {
        type: "extension_ready",
        version: "2.0.0",
        capabilities: [
          "vision_streaming",
          "full_page_screenshots",
          "element_screenshots",
          "vision_based_detection",
          "coordinate_clicking",
        ],
      },
      () => {
        if (chrome.runtime.lastError) {
          // Popup not open - this is normal
        }
      },
    );
  } catch (e) {
    // Ignore popup notification errors
  }
}

/**
 * Handle reconnection logic
 */
function handleReconnection(event, connectionId, isChromeCrash, isBackendCrash) {
  const shouldReconnect = event.code !== 1000 || isChromeCrash || isBackendCrash;

  if (shouldReconnect) {
    if (isChromeCrash || isBackendCrash) {
      reconnectAttempts = 0;
    }

    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      const delay = Math.min(2000 * reconnectAttempts, 10000);

      if (typeof logWithTimestamp === "function") {
        logWithTimestamp("info", `🔄 Scheduling reconnection`, {
          connectionId,
          attempt: reconnectAttempts,
          maxAttempts: MAX_RECONNECT_ATTEMPTS,
          delayMs: delay,
        });
      }

      setTimeout(connectWebSocket, delay);
    } else {
      if (typeof logWithTimestamp === "function") {
        logWithTimestamp("error", "❌ Max reconnection attempts reached", {
          connectionId,
          maxAttempts: MAX_RECONNECT_ATTEMPTS,
        });
      }

      // Try recovery after 5 minutes
      setTimeout(
        () => {
          reconnectAttempts = 0;
          connectWebSocket();
        },
        5 * 60 * 1000,
      );
    }
  }
}

/**
 * Stop all vision streams on disconnect
 */
function stopAllVisionStreams(connectionId) {
  // Use globalThis since visionStreamingActive is declared in snapshot.js
  if (globalThis.visionStreamingActive) {
    if (typeof logWithTimestamp === "function") {
      logWithTimestamp("info", "🛑 Stopping all vision streams due to disconnect", {
        connectionId,
        activeStreams: wsVisionStreamCallbacks.size,
      });
    }
    wsVisionStreamCallbacks.clear();
    globalThis.visionStreamingActive = false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SENDING MESSAGES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Send a message via WebSocket
 *
 * @param {Object} message - The message to send
 * @returns {boolean} - Whether the send was successful
 */
function sendViaWebSocket(message) {
  if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
    return false;
  }

  try {
    const messageStr = JSON.stringify(message);
    wsConnection.send(messageStr);
    connectionState.messageCount.sent++;

    if (typeof logWithTimestamp === "function") {
      logWithTimestamp("debug", "📤 Sent via WebSocket", {
        type: message.type,
        id: message.id,
        size: messageStr.length,
      });
    }

    return true;
  } catch (error) {
    if (typeof logWithTimestamp === "function") {
      logWithTimestamp("error", "❌ WebSocket send failed", {
        error: error.message,
        type: message.type,
      });
    }
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// RESPONSE QUEUEING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Queue a response for retry after reconnection
 * @param {Object} message - The message to queue
 */
function queueResponseForRetry(message) {
  const queuedMessage = {
    ...message,
    queuedAt: new Date().toISOString(),
    retryCount: 0,
  };

  // Check for duplicates
  const existingIndex = pendingResponseQueue.findIndex((m) => m.id === message.id);
  if (existingIndex >= 0) {
    pendingResponseQueue[existingIndex] = queuedMessage;
  } else {
    pendingResponseQueue.push(queuedMessage);
    if (typeof logWithTimestamp === "function") {
      logWithTimestamp("info", "📦 Response queued for retry", {
        messageId: message.id,
        queueSize: pendingResponseQueue.length,
      });
    }
  }
}

/**
 * Retry all queued responses after reconnection
 */
function retryQueuedResponses() {
  if (pendingResponseQueue.length === 0) {
    return;
  }

  if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
    return;
  }

  if (typeof logWithTimestamp === "function") {
    logWithTimestamp("info", "🔄 Retrying queued responses", {
      queueSize: pendingResponseQueue.length,
    });
  }

  const responsesToRetry = [...pendingResponseQueue];
  pendingResponseQueue.length = 0;

  let successCount = 0;

  for (const message of responsesToRetry) {
    message.retryCount = (message.retryCount || 0) + 1;
    const sent = sendViaWebSocket(message);

    if (sent) {
      successCount++;
    } else if (message.retryCount < 3) {
      pendingResponseQueue.push(message);
    }
  }

  if (typeof logWithTimestamp === "function") {
    logWithTimestamp("info", "✅ Finished retrying queued responses", {
      total: responsesToRetry.length,
      success: successCount,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATUS AND CALLBACKS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Check if WebSocket is currently connected
 * @returns {boolean}
 */
function isWebSocketConnected() {
  return wsConnection && wsConnection.readyState === WebSocket.OPEN;
}

/**
 * Check if WebSocket is busy (connecting or connected)
 * Use this for keep-alive checks to avoid duplicate connection attempts
 * @returns {boolean}
 */
function isWebSocketBusy() {
  if (!wsConnection) {
    return _connectionInProgress;
  }
  // Consider both CONNECTING and OPEN as "busy" - don't try to reconnect
  return (
    wsConnection.readyState === WebSocket.CONNECTING ||
    wsConnection.readyState === WebSocket.OPEN ||
    _connectionInProgress
  );
}

/**
 * Get WebSocket connection state
 * @returns {Object}
 */
function getWebSocketState() {
  return {
    connected: isWebSocketConnected(),
    readyState: getWebSocketReadyState(),
    reconnectAttempts,
    connectionState: { ...connectionState },
    queueSize: pendingResponseQueue.length,
  };
}

/**
 * Set the callback for handling WebSocket messages
 * @param {Function} callback - Callback function(message)
 */
function setWebSocketMessageCallback(callback) {
  onWebSocketMessageCallback = callback;
}

/**
 * Disconnect WebSocket
 */
function disconnectWebSocket() {
  if (wsConnection) {
    try {
      wsConnection.close(1000, "Intentional disconnect");
    } catch (e) {
      // Ignore errors
    }
    wsConnection = null;
  }
}

/**
 * Get the raw WebSocket connection (for advanced use)
 * @returns {WebSocket|null}
 */
function getWebSocketConnection() {
  return wsConnection;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

// Make available globally for service worker
if (typeof globalThis !== "undefined") {
  globalThis.connectWebSocket = connectWebSocket;
  globalThis.sendViaWebSocket = sendViaWebSocket;
  globalThis.isWebSocketConnected = isWebSocketConnected;
  globalThis.isWebSocketBusy = isWebSocketBusy; // FEB 2026: For keep-alive checks
  globalThis.getWebSocketState = getWebSocketState;
  globalThis.setWebSocketMessageCallback = setWebSocketMessageCallback;
  globalThis.disconnectWebSocket = disconnectWebSocket;
  globalThis.getWebSocketConnection = getWebSocketConnection;
  globalThis.getWebSocketStateName = getWebSocketStateName;
  globalThis.queueResponseForRetry = queueResponseForRetry;
  globalThis.retryQueuedResponses = retryQueuedResponses;

  // Expose wsConnection for backward compatibility
  Object.defineProperty(globalThis, "wsConnection", {
    get: () => wsConnection,
    set: (val) => {
      wsConnection = val;
    },
  });
}
