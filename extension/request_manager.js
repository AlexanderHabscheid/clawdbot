/**
 * Production-grade Request Manager for 100K+ DAU
 *
 * Features:
 * - Priority queue with configurable max size
 * - Rate limiting (requests/second)
 * - Request timeout with auto-retry
 * - Circuit breaker for failing backends
 * - Metrics tracking (latency, success rate, queue depth)
 * - Request deduplication
 */

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const REQUEST_CONFIG = {
  // Queue settings
  MAX_QUEUE_SIZE: 100, // Max pending requests before rejecting
  QUEUE_TIMEOUT_MS: 30000, // Max time request can wait in queue

  // Rate limiting
  RATE_LIMIT_REQUESTS: 20, // Max requests per window
  RATE_LIMIT_WINDOW_MS: 1000, // Rate limit window (1 second)

  // Timeouts
  REQUEST_TIMEOUT_MS: 15000, // Single request timeout
  RETRY_ATTEMPTS: 2, // Retries before failing
  RETRY_DELAY_MS: 1000, // Delay between retries

  // Circuit breaker
  CIRCUIT_BREAKER_THRESHOLD: 5, // Failures before opening circuit
  CIRCUIT_BREAKER_RESET_MS: 30000, // Time before trying again

  // Priority levels (lower = higher priority)
  PRIORITY: {
    CRITICAL: 0, // Auth, handshake
    HIGH: 1, // User-initiated actions (click, type)
    NORMAL: 2, // Snapshots, screenshots
    LOW: 3, // Telemetry, non-essential
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// METRICS TRACKING
// ═══════════════════════════════════════════════════════════════════════════════

class RequestMetrics {
  constructor() {
    this.reset();
  }

  reset() {
    this.requests = {
      total: 0,
      success: 0,
      failed: 0,
      timeout: 0,
      rejected: 0, // Rejected due to queue full or rate limit
    };
    this.latency = {
      samples: [],
      maxSamples: 100,
    };
    this.queueDepth = {
      current: 0,
      max: 0,
    };
    this.circuitBreaker = {
      state: "CLOSED", // CLOSED, OPEN, HALF_OPEN
      failures: 0,
      lastFailure: null,
    };
    this.rateLimit = {
      windowStart: Date.now(),
      requestsInWindow: 0,
    };
    this.startTime = Date.now();
  }

  recordRequest(success, latencyMs, timedOut = false) {
    this.requests.total++;
    if (success) {
      this.requests.success++;
    } else if (timedOut) {
      this.requests.timeout++;
    } else {
      this.requests.failed++;
    }

    // Track latency
    this.latency.samples.push(latencyMs);
    if (this.latency.samples.length > this.latency.maxSamples) {
      this.latency.samples.shift();
    }
  }

  recordRejection() {
    this.requests.rejected++;
  }

  updateQueueDepth(depth) {
    this.queueDepth.current = depth;
    if (depth > this.queueDepth.max) {
      this.queueDepth.max = depth;
    }
  }

  getStats() {
    const latencies = this.latency.samples;
    const avgLatency =
      latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
    const p95Latency =
      latencies.length > 0
        ? latencies.slice().toSorted((a, b) => a - b)[Math.floor(latencies.length * 0.95)]
        : 0;

    const successRate =
      this.requests.total > 0
        ? ((this.requests.success / this.requests.total) * 100).toFixed(2)
        : 100;

    return {
      uptime: Date.now() - this.startTime,
      requests: { ...this.requests },
      successRate: parseFloat(successRate),
      latency: {
        avg: Math.round(avgLatency),
        p95: Math.round(p95Latency),
        samples: latencies.length,
      },
      queue: { ...this.queueDepth },
      circuitBreaker: { ...this.circuitBreaker },
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRIORITY QUEUE
// ═══════════════════════════════════════════════════════════════════════════════

class PriorityQueue {
  constructor(maxSize = REQUEST_CONFIG.MAX_QUEUE_SIZE) {
    this.maxSize = maxSize;
    this.queues = {
      [REQUEST_CONFIG.PRIORITY.CRITICAL]: [],
      [REQUEST_CONFIG.PRIORITY.HIGH]: [],
      [REQUEST_CONFIG.PRIORITY.NORMAL]: [],
      [REQUEST_CONFIG.PRIORITY.LOW]: [],
    };
  }

  get size() {
    return Object.values(this.queues).reduce((sum, q) => sum + q.length, 0);
  }

  isFull() {
    return this.size >= this.maxSize;
  }

  enqueue(item, priority = REQUEST_CONFIG.PRIORITY.NORMAL) {
    if (this.isFull()) {
      // Try to drop lowest priority item
      if (
        priority < REQUEST_CONFIG.PRIORITY.LOW &&
        this.queues[REQUEST_CONFIG.PRIORITY.LOW].length > 0
      ) {
        const dropped = this.queues[REQUEST_CONFIG.PRIORITY.LOW].shift();
        dropped.reject(new Error("Dropped due to queue pressure"));
      } else {
        return false; // Queue full, can't add
      }
    }

    this.queues[priority].push({
      ...item,
      enqueuedAt: Date.now(),
    });
    return true;
  }

  dequeue() {
    // Process highest priority first
    for (const priority of Object.keys(this.queues).toSorted((a, b) => a - b)) {
      const queue = this.queues[priority];
      if (queue.length > 0) {
        const item = queue.shift();

        // Check if request has been waiting too long
        const waitTime = Date.now() - item.enqueuedAt;
        if (waitTime > REQUEST_CONFIG.QUEUE_TIMEOUT_MS) {
          item.reject(new Error(`Request timed out in queue (waited ${waitTime}ms)`));
          return this.dequeue(); // Try next item
        }

        return item;
      }
    }
    return null;
  }

  clear() {
    for (const queue of Object.values(this.queues)) {
      while (queue.length > 0) {
        const item = queue.shift();
        item.reject(new Error("Queue cleared"));
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// REQUEST MANAGER
// ═══════════════════════════════════════════════════════════════════════════════

class RequestManager {
  constructor(sendFunction) {
    this.sendFunction = sendFunction; // Function to actually send the request
    this.queue = new PriorityQueue();
    this.metrics = new RequestMetrics();
    this.pendingRequests = new Map(); // id -> { resolve, reject, startTime, retries }
    this.processing = false;
    this.requestIdCounter = 0;

    // Deduplication: track recent request hashes
    this.recentRequests = new Map(); // hash -> timestamp
    this.DEDUP_WINDOW_MS = 500; // Ignore duplicate requests within 500ms
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Send a request with full production features
   * @param {Object} message - The message to send
   * @param {Object} options - { priority, timeout, deduplicate }
   * @returns {Promise} - Resolves with response or rejects on error/timeout
   */
  async send(message, options = {}) {
    const {
      priority = REQUEST_CONFIG.PRIORITY.NORMAL,
      timeout = REQUEST_CONFIG.REQUEST_TIMEOUT_MS,
      deduplicate = true,
    } = options;

    // Check circuit breaker
    if (!this._checkCircuitBreaker()) {
      this.metrics.recordRejection();
      throw new Error("Circuit breaker OPEN - backend unavailable");
    }

    // Check rate limit
    if (!this._checkRateLimit()) {
      this.metrics.recordRejection();
      throw new Error("Rate limit exceeded");
    }

    // Check deduplication
    if (deduplicate && this._isDuplicate(message)) {
      this.metrics.recordRejection();
      throw new Error("Duplicate request detected");
    }

    // Generate request ID
    const requestId = this._generateRequestId();
    const messageWithId = { ...message, _requestId: requestId };

    // Create promise for this request
    return new Promise((resolve, reject) => {
      const request = {
        id: requestId,
        message: messageWithId,
        resolve,
        reject,
        timeout,
        retries: 0,
      };

      // Try to add to queue
      const added = this.queue.enqueue(request, priority);
      if (!added) {
        this.metrics.recordRejection();
        reject(new Error("Request queue full"));
        return;
      }

      this.metrics.updateQueueDepth(this.queue.size);

      // Start processing if not already
      this._processQueue();
    });
  }

  /**
   * Handle response from backend
   * @param {Object} response - Response with _requestId
   */
  handleResponse(response) {
    const requestId = response._requestId;
    if (!requestId) {
      return false;
    }

    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      return false;
    }

    // Clear timeout
    if (pending.timeoutId) {
      clearTimeout(pending.timeoutId);
    }

    // Calculate latency
    const latency = Date.now() - pending.startTime;

    // Record success
    this.metrics.recordRequest(true, latency);
    this._recordCircuitBreakerSuccess();

    // Remove from pending
    this.pendingRequests.delete(requestId);

    // Resolve promise
    pending.resolve(response);

    // Process next request
    this._processQueue();

    return true;
  }

  /**
   * Get current stats
   */
  getStats() {
    return {
      ...this.metrics.getStats(),
      queueSize: this.queue.size,
      pendingRequests: this.pendingRequests.size,
    };
  }

  /**
   * Clear all pending requests (on disconnect)
   */
  clear() {
    // Reject all pending
    for (const [id, pending] of this.pendingRequests) {
      if (pending.timeoutId) {
        clearTimeout(pending.timeoutId);
      }
      pending.reject(new Error("Connection lost"));
    }
    this.pendingRequests.clear();

    // Clear queue
    this.queue.clear();

    this.metrics.updateQueueDepth(0);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INTERNAL METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  _generateRequestId() {
    return `req_${Date.now()}_${++this.requestIdCounter}`;
  }

  _hashMessage(message) {
    // Simple hash for deduplication
    const str = JSON.stringify({
      type: message.type,
      action: message.action,
      data: message.data,
    });
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(16);
  }

  _isDuplicate(message) {
    const hash = this._hashMessage(message);
    const now = Date.now();

    // Clean old entries
    for (const [h, time] of this.recentRequests) {
      if (now - time > this.DEDUP_WINDOW_MS) {
        this.recentRequests.delete(h);
      }
    }

    if (this.recentRequests.has(hash)) {
      return true;
    }

    this.recentRequests.set(hash, now);
    return false;
  }

  _checkRateLimit() {
    const now = Date.now();
    const windowStart = this.metrics.rateLimit.windowStart;

    // Reset window if expired
    if (now - windowStart > REQUEST_CONFIG.RATE_LIMIT_WINDOW_MS) {
      this.metrics.rateLimit.windowStart = now;
      this.metrics.rateLimit.requestsInWindow = 0;
    }

    // Check if under limit
    if (this.metrics.rateLimit.requestsInWindow >= REQUEST_CONFIG.RATE_LIMIT_REQUESTS) {
      return false;
    }

    this.metrics.rateLimit.requestsInWindow++;
    return true;
  }

  _checkCircuitBreaker() {
    const cb = this.metrics.circuitBreaker;

    if (cb.state === "CLOSED") {
      return true;
    }

    if (cb.state === "OPEN") {
      // Check if we should try again
      const timeSinceFailure = Date.now() - cb.lastFailure;
      if (timeSinceFailure > REQUEST_CONFIG.CIRCUIT_BREAKER_RESET_MS) {
        cb.state = "HALF_OPEN";
        return true;
      }
      return false;
    }

    // HALF_OPEN - allow one request to test
    return true;
  }

  _recordCircuitBreakerSuccess() {
    const cb = this.metrics.circuitBreaker;
    if (cb.state === "HALF_OPEN") {
      cb.state = "CLOSED";
      cb.failures = 0;
    }
  }

  _recordCircuitBreakerFailure() {
    const cb = this.metrics.circuitBreaker;
    cb.failures++;
    cb.lastFailure = Date.now();

    if (cb.failures >= REQUEST_CONFIG.CIRCUIT_BREAKER_THRESHOLD) {
      cb.state = "OPEN";
      console.warn("[RequestManager] Circuit breaker OPENED due to failures");
    }
  }

  async _processQueue() {
    if (this.processing) {
      return;
    }
    this.processing = true;

    try {
      while (true) {
        const request = this.queue.dequeue();
        if (!request) {
          break;
        }

        this.metrics.updateQueueDepth(this.queue.size);

        await this._sendRequest(request);
      }
    } finally {
      this.processing = false;
    }
  }

  async _sendRequest(request) {
    const { id, message, resolve, reject, timeout, retries } = request;

    // Track as pending
    const pending = {
      resolve,
      reject,
      startTime: Date.now(),
      retries,
      timeoutId: null,
    };
    this.pendingRequests.set(id, pending);

    // Set timeout
    pending.timeoutId = setTimeout(() => {
      this._handleTimeout(id, request);
    }, timeout);

    // Actually send
    try {
      const sent = this.sendFunction(message);
      if (!sent) {
        throw new Error("Send function returned false");
      }
    } catch (error) {
      this._handleSendError(id, request, error);
    }
  }

  _handleTimeout(requestId, request) {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      return;
    }

    this.pendingRequests.delete(requestId);

    // Calculate latency (even for timeout)
    const latency = Date.now() - pending.startTime;
    this.metrics.recordRequest(false, latency, true);

    // Record circuit breaker failure
    this._recordCircuitBreakerFailure();

    // Retry?
    if (pending.retries < REQUEST_CONFIG.RETRY_ATTEMPTS) {
      console.log(
        `[RequestManager] Request ${requestId} timed out, retrying (${pending.retries + 1}/${REQUEST_CONFIG.RETRY_ATTEMPTS})`,
      );

      setTimeout(() => {
        const retryRequest = {
          ...request,
          retries: pending.retries + 1,
        };
        this.queue.enqueue(retryRequest, REQUEST_CONFIG.PRIORITY.HIGH);
        this._processQueue();
      }, REQUEST_CONFIG.RETRY_DELAY_MS);
    } else {
      pending.reject(new Error(`Request timed out after ${REQUEST_CONFIG.RETRY_ATTEMPTS} retries`));
    }
  }

  _handleSendError(requestId, request, error) {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      return;
    }

    if (pending.timeoutId) {
      clearTimeout(pending.timeoutId);
    }

    this.pendingRequests.delete(requestId);

    // Calculate latency
    const latency = Date.now() - pending.startTime;
    this.metrics.recordRequest(false, latency);

    // Record circuit breaker failure
    this._recordCircuitBreakerFailure();

    // Retry?
    if (pending.retries < REQUEST_CONFIG.RETRY_ATTEMPTS) {
      setTimeout(() => {
        const retryRequest = {
          ...request,
          retries: pending.retries + 1,
        };
        this.queue.enqueue(retryRequest, REQUEST_CONFIG.PRIORITY.HIGH);
        this._processQueue();
      }, REQUEST_CONFIG.RETRY_DELAY_MS);
    } else {
      pending.reject(error);
    }
  }
}

// Export for use in background.js
if (typeof module !== "undefined" && module.exports) {
  module.exports = { RequestManager, RequestMetrics, PriorityQueue, REQUEST_CONFIG };
}
