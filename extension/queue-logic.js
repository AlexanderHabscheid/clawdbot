/**
 * Response Queue Logic
 *
 * Extracted from background.js for testing.
 * Handles queuing and retrying responses when WebSocket disconnects.
 */

/**
 * Create a response queue manager
 * @param {Object} options
 * @param {Function} options.sendMessage - Function to send messages
 * @param {Function} options.isConnected - Function to check connection status
 * @param {number} options.maxRetries - Max retry attempts (default: 3)
 */
function createResponseQueue(options = {}) {
  const maxRetries = options.maxRetries ?? 3;
  const sendMessage = options.sendMessage ?? (() => false);
  const isConnected = options.isConnected ?? (() => false);

  const queue = [];

  /**
   * Queue a response for retry
   * @param {Object} message - Message to queue
   * @returns {boolean} - True if added, false if updated existing
   */
  function queueForRetry(message) {
    const queuedMessage = {
      ...message,
      queuedAt: new Date().toISOString(),
      retryCount: 0,
    };

    // Check if this response is already queued (avoid duplicates)
    const existingIndex = queue.findIndex((m) => m.id === message.id);
    if (existingIndex >= 0) {
      queue[existingIndex] = queuedMessage;
      return false; // Updated existing
    }

    queue.push(queuedMessage);
    return true; // Added new
  }

  /**
   * Retry all queued responses
   * @returns {{ total: number, success: number, failed: number, remaining: number }}
   */
  function retryAll() {
    if (queue.length === 0) {
      return { total: 0, success: 0, failed: 0, remaining: 0 };
    }

    if (!isConnected()) {
      return { total: queue.length, success: 0, failed: 0, remaining: queue.length };
    }

    // Copy and clear queue
    const toRetry = [...queue];
    queue.length = 0;

    let successCount = 0;
    let failCount = 0;

    for (const message of toRetry) {
      message.retryCount = (message.retryCount || 0) + 1;
      const sent = sendMessage(message);

      if (sent) {
        successCount++;
      } else {
        failCount++;
        // Re-queue if still failed and under max retries
        if (message.retryCount < maxRetries) {
          queue.push(message);
        }
        // Otherwise drop the message (max retries exceeded)
      }
    }

    return {
      total: toRetry.length,
      success: successCount,
      failed: failCount,
      remaining: queue.length,
    };
  }

  /**
   * Get current queue size
   */
  function size() {
    return queue.length;
  }

  /**
   * Clear the queue
   */
  function clear() {
    queue.length = 0;
  }

  /**
   * Get queue contents (for testing/debugging)
   */
  function getAll() {
    return [...queue];
  }

  return {
    queueForRetry,
    retryAll,
    size,
    clear,
    getAll,
  };
}

// Export for testing (CommonJS for Node.js test runners)
if (typeof module !== "undefined" && module.exports) {
  module.exports = { createResponseQueue };
}
