/**
 * Native Messaging Module for Centris Chrome Extension
 *
 * Handles communication with the native host application via Chrome's
 * Native Messaging protocol. This is the fastest communication method
 * (~1-2ms overhead) and is preferred over WebSocket when available.
 *
 * The native host (centris_host.py) relays messages to the backend server.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════════

// Native Messaging port
let nativePort = null;

// Whether Native Messaging is available and connected
let nativeMessagingAvailable = false;

// Retry count for connection attempts
let nativeMessagingRetryCount = 0;

// Message handler callback (set by connection_manager)
let onNativeMessageCallback = null;

// Fallback callback when native messaging fails
let onFallbackCallback = null;

// ═══════════════════════════════════════════════════════════════════════════════
// ERROR DIAGNOSIS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Diagnose Native Messaging errors based on error message
 * Provides actionable troubleshooting information
 *
 * @param {string} errorMessage - The error message from Chrome
 * @returns {Object|null} Diagnosis object with issue and solution
 */
function getNativeMessagingErrorDiagnosis(errorMessage) {
  if (!errorMessage) {
    return null;
  }

  const errorLower = errorMessage.toLowerCase();

  if (
    errorLower.includes("specified native messaging host not found") ||
    errorLower.includes("host not found")
  ) {
    return {
      issue: "Native host manifest not installed",
      solution: "Run install_native_host.sh to install the manifest",
      manifestPath:
        "~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.centris.host.json",
    };
  }

  if (errorLower.includes("access denied") || errorLower.includes("permission")) {
    return {
      issue: "Permission denied",
      solution: "Check file permissions on host script and manifest",
      checkScript: "ls -l /usr/local/bin/centris_host.py",
      checkManifest:
        "ls -l ~/Library/Application\\ Support/Google/Chrome/NativeMessagingHosts/com.centris.host.json",
    };
  }

  if (errorLower.includes("invalid extension") || errorLower.includes("extension id")) {
    return {
      issue: "Extension ID mismatch",
      solution: "Update manifest with correct extension ID from chrome://extensions",
      manifestPath:
        "~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.centris.host.json",
    };
  }

  if (errorLower.includes("could not connect") || errorLower.includes("connection")) {
    return {
      issue: "Host script connection failed",
      solution: "Check if host script exists and is executable",
      checkScript: "which python3 && ls -l /usr/local/bin/centris_host.py",
    };
  }

  return {
    issue: "Unknown error",
    solution: "Check Chrome console and host script logs",
    checkLogs: "Check Console.app for centris_host.py errors",
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONNECTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Try to connect via Native Messaging
 * Returns true if successful, false if should fall back to WebSocket
 *
 * @returns {Promise<boolean>}
 */
async function tryConnectNativeMessaging() {
  // Ensure CONFIG is available
  const hostName =
    typeof CONFIG !== "undefined" && CONFIG.NATIVE_HOST_NAME
      ? CONFIG.NATIVE_HOST_NAME
      : "com.centris.host";

  return new Promise((resolve) => {
    try {
      if (typeof logWithTimestamp === "function") {
        logWithTimestamp("info", "🔌 Attempting Native Messaging connection...", {
          hostName: hostName,
          attempt: nativeMessagingRetryCount + 1,
          extensionId: chrome.runtime.id,
        });
      }

      // Connect to native host
      nativePort = chrome.runtime.connectNative(hostName);

      // Check for immediate errors (Chrome sets lastError synchronously)
      const immediateError = chrome.runtime.lastError;
      if (immediateError) {
        if (typeof logWithTimestamp === "function") {
          logWithTimestamp("error", "❌ Native Messaging connection failed immediately", {
            error: immediateError.message,
            hostName: hostName,
            extensionId: chrome.runtime.id,
            commonCauses: [
              "Native host manifest not installed",
              "Extension ID mismatch in manifest",
              "Host script not found or not executable",
              "Python3 not available in PATH",
            ],
          });
        }
        nativeMessagingAvailable = false;
        nativePort = null;
        resolve(false);
        return;
      }

      if (!nativePort) {
        if (typeof logWithTimestamp === "function") {
          logWithTimestamp("warn", "⚠️ Native Messaging port is null", {
            hostName: hostName,
            extensionId: chrome.runtime.id,
          });
        }
        nativeMessagingAvailable = false;
        resolve(false);
        return;
      }

      // Set up message handler
      nativePort.onMessage.addListener((message) => {
        handleNativeMessage(message);
      });

      // Set up disconnect handler
      nativePort.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError;
        const errorDetails = error
          ? {
              message: error.message,
              diagnosis: getNativeMessagingErrorDiagnosis(error.message),
            }
          : {
              message: "No error message (disconnected without error)",
              possibleCauses: [
                "Host script exited immediately",
                "Host script crashed on startup",
                "Python3 not found or script syntax error",
                "Host script path incorrect in manifest",
              ],
            };

        if (typeof logWithTimestamp === "function") {
          logWithTimestamp("warn", "🔌 Native Messaging disconnected", {
            ...errorDetails,
            wasConnected: nativeMessagingAvailable,
            hostName: hostName,
            extensionId: chrome.runtime.id,
          });
        }

        nativePort = null;
        nativeMessagingAvailable = false;

        // Trigger fallback if callback is set
        if (onFallbackCallback) {
          onFallbackCallback();
        }
      });

      // Wait a short time for connection to establish
      setTimeout(() => {
        if (nativePort) {
          // Send handshake
          const handshakeMessage = {
            type: "extension_ready",
            version: "2.0.0",
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

          try {
            nativePort.postMessage(handshakeMessage);
            nativeMessagingAvailable = true;
            if (typeof logWithTimestamp === "function") {
              logWithTimestamp("info", "✅ Native Messaging handshake sent", {
                extensionId: chrome.runtime.id,
              });
            }
            resolve(true);
          } catch (e) {
            if (typeof logWithTimestamp === "function") {
              logWithTimestamp("error", "❌ Failed to send Native Messaging handshake", {
                error: e.message,
              });
            }
            nativeMessagingAvailable = false;
            resolve(false);
          }
        } else {
          if (typeof logWithTimestamp === "function") {
            logWithTimestamp("warn", "⚠️ Native port became null during setup");
          }
          resolve(false);
        }
      }, 100);
    } catch (e) {
      if (typeof logWithTimestamp === "function") {
        logWithTimestamp("warn", "⚠️ Native Messaging not available", {
          error: e.message,
          hostName: hostName,
        });
      }
      nativeMessagingAvailable = false;
      nativePort = null;
      resolve(false);
    }
  });
}

/**
 * Handle message received from Native Messaging host
 * @param {Object} message - The received message
 */
function handleNativeMessage(message) {
  if (typeof logWithTimestamp === "function") {
    logWithTimestamp("debug", "📥 Native message received", {
      type: message.type,
      id: message.id,
    });
  }

  // Handle host_ready message (initial handshake from host)
  if (message.type === "host_ready") {
    const bridgeToken = typeof message.bridge_token === "string" ? message.bridge_token.trim() : "";
    if (
      bridgeToken &&
      typeof CONFIG !== "undefined" &&
      typeof CONFIG.setExtensionToken === "function"
    ) {
      CONFIG.setExtensionToken(bridgeToken);
      if (typeof logWithTimestamp === "function") {
        logWithTimestamp("info", "🔐 Bridge token provisioned from native host");
      }
    }
    if (typeof logWithTimestamp === "function") {
      logWithTimestamp("info", "✅ Native host ready", {
        version: message.version,
        backendConnected: message.backend_connected,
        pid: message.pid,
      });
    }
    return;
  }

  // Handle fallback signal from host
  if (message.fallback_to_websocket) {
    if (typeof logWithTimestamp === "function") {
      logWithTimestamp("info", "📡 Host requested fallback to WebSocket", {
        reason: message.error,
      });
    }
    nativeMessagingAvailable = false;
    if (onFallbackCallback) {
      onFallbackCallback();
    }
    return;
  }

  // Handle handshake acknowledgment
  if (message.type === "handshake_ack") {
    if (typeof logWithTimestamp === "function") {
      logWithTimestamp("info", "✅ Native Messaging handshake acknowledged", {
        backendConnected: message.backend_connected,
      });
    }
    return;
  }

  // Handle pong (keep-alive response)
  if (message.type === "pong") {
    if (typeof logWithTimestamp === "function") {
      logWithTimestamp("debug", "📡 Pong received from native host");
    }
    return;
  }

  // Forward other messages to the registered callback
  if (onNativeMessageCallback) {
    onNativeMessageCallback(message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SENDING MESSAGES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Send a message via Native Messaging
 *
 * @param {Object} message - The message to send
 * @returns {boolean} - Whether the send was successful
 */
function sendViaNativeMessaging(message) {
  if (!nativePort || !nativeMessagingAvailable) {
    return false;
  }

  try {
    nativePort.postMessage(message);
    if (typeof logWithTimestamp === "function") {
      logWithTimestamp("debug", "📤 Sent via Native Messaging", {
        type: message.type,
        id: message.id,
      });
    }
    return true;
  } catch (e) {
    if (typeof logWithTimestamp === "function") {
      logWithTimestamp("warn", "⚠️ Native Messaging send failed", {
        error: e.message,
      });
    }
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATUS AND CALLBACKS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Check if Native Messaging is currently available
 * @returns {boolean}
 */
function isNativeMessagingAvailable() {
  return nativeMessagingAvailable && nativePort !== null;
}

/**
 * Set the callback for handling messages from native host
 * @param {Function} callback - Callback function(message)
 */
function setNativeMessageCallback(callback) {
  onNativeMessageCallback = callback;
}

/**
 * Set the callback for when native messaging fails and should fallback
 * @param {Function} callback - Callback function()
 */
function setFallbackCallback(callback) {
  onFallbackCallback = callback;
}

/**
 * Disconnect from Native Messaging
 */
function disconnectNativeMessaging() {
  if (nativePort) {
    try {
      nativePort.disconnect();
    } catch (e) {
      // Ignore errors on disconnect
    }
    nativePort = null;
  }
  nativeMessagingAvailable = false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

// Make available globally for service worker
if (typeof globalThis !== "undefined") {
  globalThis.tryConnectNativeMessaging = tryConnectNativeMessaging;
  globalThis.sendViaNativeMessaging = sendViaNativeMessaging;
  globalThis.isNativeMessagingAvailable = isNativeMessagingAvailable;
  globalThis.setNativeMessageCallback = setNativeMessageCallback;
  globalThis.setFallbackCallback = setFallbackCallback;
  globalThis.disconnectNativeMessaging = disconnectNativeMessaging;
  globalThis.getNativeMessagingErrorDiagnosis = getNativeMessagingErrorDiagnosis;

  // Expose state for debugging
  globalThis.getNativeMessagingState = () => ({
    available: nativeMessagingAvailable,
    connected: nativePort !== null,
    retryCount: nativeMessagingRetryCount,
  });
}
