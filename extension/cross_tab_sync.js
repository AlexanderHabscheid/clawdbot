/**
 * Cross-Tab Memory Sync for Centris AI Chrome Extension
 *
 * Synchronizes memory and context across browser tabs using:
 * - chrome.storage.sync for cross-device sync (100KB limit)
 * - chrome.storage.local for larger local storage
 * - BroadcastChannel for real-time tab communication
 *
 * Memory Types:
 * - Recent tasks and outcomes
 * - User preferences
 * - Learned patterns (action sequences that worked)
 * - Error recoveries (how errors were fixed)
 *
 * Usage:
 *   await crossTabSync.init();
 *
 *   // Store a memory
 *   await crossTabSync.storeMemory({
 *     type: 'task_execution',
 *     content: { instruction: 'Go to gmail', success: true }
 *   });
 *
 *   // Get recent memories
 *   const memories = await crossTabSync.getRecentMemories(10);
 */

class CrossTabSync {
  constructor() {
    this.config = {
      STORAGE_KEY_SYNC: "centris_memories_sync", // chrome.storage.sync (cross-device)
      STORAGE_KEY_LOCAL: "centris_memories_local", // chrome.storage.local (larger)
      BROADCAST_CHANNEL: "centris_memory_channel", // BroadcastChannel name
      MAX_SYNC_ENTRIES: 50, // Limit for sync storage
      MAX_LOCAL_ENTRIES: 500, // Limit for local storage
      MAX_ENTRY_SIZE: 1000, // Max chars per entry content
      SYNC_QUOTA_BYTES: 8192, // Per-key quota for sync storage
    };

    // In-memory cache
    this.memoryCache = [];

    // Listeners
    this.listeners = new Set();

    // BroadcastChannel for real-time sync between tabs
    this.broadcastChannel = null;

    console.log("[CrossTabSync] Created");
  }

  /**
   * Initialize cross-tab sync
   */
  async init() {
    // Set up BroadcastChannel for real-time updates
    this._setupBroadcastChannel();

    // Listen for storage changes from other tabs/devices
    chrome.storage.onChanged.addListener((changes, areaName) => {
      this._onStorageChanged(changes, areaName);
    });

    // Load existing memories
    await this.loadMemories();

    console.log("[CrossTabSync] Initialized with", this.memoryCache.length, "memories");
    return this;
  }

  /**
   * Set up BroadcastChannel for real-time tab sync
   */
  _setupBroadcastChannel() {
    try {
      this.broadcastChannel = new BroadcastChannel(this.config.BROADCAST_CHANNEL);

      this.broadcastChannel.onmessage = (event) => {
        const { type, data } = event.data;

        if (type === "memory_added") {
          // Add to cache without re-broadcasting
          this._addToCache(data.memory, false);
          this._notifyListeners("memory_added", data.memory);
        } else if (type === "memory_cleared") {
          this.memoryCache = [];
          this._notifyListeners("memories_cleared", {});
        }
      };

      console.log("[CrossTabSync] BroadcastChannel set up");
    } catch (error) {
      console.warn("[CrossTabSync] BroadcastChannel not supported:", error);
    }
  }

  /**
   * Handle storage changes from other tabs/devices
   */
  _onStorageChanged(changes, areaName) {
    // Check for memory changes
    const syncKey = this.config.STORAGE_KEY_SYNC;
    const localKey = this.config.STORAGE_KEY_LOCAL;

    if ((areaName === "sync" && changes[syncKey]) || (areaName === "local" && changes[localKey])) {
      // Reload memories
      this.loadMemories().then(() => {
        this._notifyListeners("memories_synced", {
          count: this.memoryCache.length,
          source: areaName,
        });
      });
    }
  }

  /**
   * Store a new memory entry
   * @param {Object} entry - Memory entry to store
   * @returns {string} Memory ID
   */
  async storeMemory(entry) {
    const memory = {
      id: `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: entry.type || "general",
      content: this._truncateContent(entry.content),
      priority: entry.priority || "medium",
      tags: entry.tags || [],
      storedAt: Date.now(),
      accessCount: 0,
    };

    // Add to cache
    this._addToCache(memory, true);

    // Persist to storage
    await this._persistMemories();

    // Notify listeners
    this._notifyListeners("memory_added", memory);

    console.debug("[CrossTabSync] Stored memory:", memory.id, memory.type);
    return memory.id;
  }

  /**
   * Store a task execution memory
   */
  async storeTaskExecution(instruction, success, toolCalls = [], durationMs = 0) {
    return this.storeMemory({
      type: "task_execution",
      content: {
        instruction: instruction.substring(0, 200),
        success: success,
        toolCalls: toolCalls.slice(0, 10),
        durationMs: durationMs,
      },
      priority: success ? "medium" : "high",
      tags: ["task", success ? "success" : "failure"],
    });
  }

  /**
   * Store an error recovery memory
   */
  async storeErrorRecovery(error, recovery, successful) {
    return this.storeMemory({
      type: "error_recovery",
      content: {
        error: error.substring(0, 200),
        recovery: recovery.substring(0, 200),
        successful: successful,
      },
      priority: successful ? "high" : "critical",
      tags: ["error", "recovery"],
    });
  }

  /**
   * Store a learned pattern
   */
  async storePattern(patternType, triggerContext, actionSequence, successRate) {
    return this.storeMemory({
      type: "learned_pattern",
      content: {
        patternType: patternType,
        trigger: triggerContext,
        actions: actionSequence.slice(0, 20),
        successRate: successRate,
      },
      priority: successRate >= 0.7 ? "high" : "medium",
      tags: ["pattern", patternType],
    });
  }

  /**
   * Get recent memories
   * @param {number} limit - Max memories to return
   * @param {string} type - Optional filter by type
   * @returns {Array} Recent memories
   */
  async getRecentMemories(limit = 10, type = null) {
    let memories = [...this.memoryCache];

    // Filter by type if specified
    if (type) {
      memories = memories.filter((m) => m.type === type);
    }

    // Sort by recency
    memories.sort((a, b) => b.storedAt - a.storedAt);

    // Update access counts
    const result = memories.slice(0, limit);
    result.forEach((m) => m.accessCount++);

    return result;
  }

  /**
   * Get memories matching a query
   * @param {string} query - Search query
   * @param {number} limit - Max results
   * @returns {Array} Matching memories
   */
  async searchMemories(query, limit = 10) {
    const queryLower = query.toLowerCase();

    const matches = this.memoryCache.filter((memory) => {
      const contentStr = JSON.stringify(memory.content).toLowerCase();
      const tagsStr = (memory.tags || []).join(" ").toLowerCase();
      return contentStr.includes(queryLower) || tagsStr.includes(queryLower);
    });

    // Sort by relevance (number of matches) and recency
    matches.sort((a, b) => {
      const aContent = JSON.stringify(a.content).toLowerCase();
      const bContent = JSON.stringify(b.content).toLowerCase();
      const aMatches = (aContent.match(new RegExp(queryLower, "g")) || []).length;
      const bMatches = (bContent.match(new RegExp(queryLower, "g")) || []).length;

      if (aMatches !== bMatches) {
        return bMatches - aMatches;
      }
      return b.storedAt - a.storedAt;
    });

    return matches.slice(0, limit);
  }

  /**
   * Get relevant patterns for a context
   * @param {Object} context - Current context
   * @returns {Array} Matching patterns
   */
  async getRelevantPatterns(context) {
    const patterns = this.memoryCache.filter((m) => m.type === "learned_pattern");

    // Score patterns by relevance to current context
    const scored = patterns.map((pattern) => {
      let score = 0;
      const trigger = pattern.content?.trigger || {};

      // Match domain
      if (
        trigger.domain &&
        context.domain &&
        trigger.domain.toLowerCase() === context.domain.toLowerCase()
      ) {
        score += 3;
      }

      // Match page type
      if (trigger.pageType && context.pageType && trigger.pageType === context.pageType) {
        score += 2;
      }

      // Match URL pattern
      if (
        trigger.urlPattern &&
        context.url &&
        context.url.toLowerCase().includes(trigger.urlPattern.toLowerCase())
      ) {
        score += 2;
      }

      // Factor in success rate
      score *= pattern.content?.successRate || 0.5;

      return { pattern, score };
    });

    // Sort by score and return top patterns
    scored.sort((a, b) => b.score - a.score);
    return scored
      .filter((s) => s.score > 0)
      .slice(0, 5)
      .map((s) => s.pattern);
  }

  /**
   * Get context summary for LLM
   * @returns {Object} Context summary
   */
  async getContextForLLM() {
    const recentTasks = await this.getRecentMemories(5, "task_execution");
    const patterns = await this.getRecentMemories(3, "learned_pattern");
    const errorRecoveries = await this.getRecentMemories(2, "error_recovery");

    return {
      recentTasks: recentTasks.map((t) => ({
        instruction: t.content?.instruction || "Unknown",
        success: t.content?.success || false,
        toolsUsed: (t.content?.toolCalls || []).slice(0, 3),
      })),
      learnedPatterns: patterns.map((p) => ({
        type: p.content?.patternType || "Unknown",
        successRate: p.content?.successRate || 0,
      })),
      recentErrors: errorRecoveries.map((e) => ({
        error: e.content?.error || "Unknown",
        resolution: e.content?.recovery || "Unknown",
        worked: e.content?.successful || false,
      })),
      totalMemories: this.memoryCache.length,
      capturedAt: Date.now(),
    };
  }

  /**
   * Add memory to cache
   */
  _addToCache(memory, broadcast = true) {
    // Add to front of cache
    this.memoryCache.unshift(memory);

    // Trim cache
    if (this.memoryCache.length > this.config.MAX_LOCAL_ENTRIES) {
      this.memoryCache = this.memoryCache.slice(0, this.config.MAX_LOCAL_ENTRIES);
    }

    // Broadcast to other tabs
    if (broadcast && this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage({
          type: "memory_added",
          data: { memory },
        });
      } catch (error) {
        console.warn("[CrossTabSync] Broadcast failed:", error);
      }
    }
  }

  /**
   * Truncate content to fit storage limits
   */
  _truncateContent(content) {
    if (typeof content === "string") {
      return content.substring(0, this.config.MAX_ENTRY_SIZE);
    }

    if (typeof content === "object") {
      const str = JSON.stringify(content);
      if (str.length > this.config.MAX_ENTRY_SIZE) {
        // Truncate large fields
        const truncated = { ...content };
        for (const [key, value] of Object.entries(truncated)) {
          if (typeof value === "string" && value.length > 200) {
            truncated[key] = value.substring(0, 200) + "...";
          } else if (Array.isArray(value) && value.length > 10) {
            truncated[key] = value.slice(0, 10);
          }
        }
        return truncated;
      }
    }

    return content;
  }

  /**
   * Persist memories to storage
   */
  async _persistMemories() {
    try {
      // Store high-priority items to sync storage (cross-device)
      const syncMemories = this.memoryCache
        .filter((m) => m.priority === "critical" || m.priority === "high")
        .slice(0, this.config.MAX_SYNC_ENTRIES);

      // Store all to local storage
      const localMemories = this.memoryCache.slice(0, this.config.MAX_LOCAL_ENTRIES);

      await Promise.all([
        chrome.storage.sync
          .set({
            [this.config.STORAGE_KEY_SYNC]: syncMemories,
          })
          .catch((err) => {
            // Sync storage might be full
            console.warn("[CrossTabSync] Sync storage error:", err);
          }),
        chrome.storage.local.set({
          [this.config.STORAGE_KEY_LOCAL]: localMemories,
        }),
      ]);

      console.debug(
        "[CrossTabSync] Persisted",
        syncMemories.length,
        "sync,",
        localMemories.length,
        "local",
      );
    } catch (error) {
      console.error("[CrossTabSync] Persist failed:", error);
    }
  }

  /**
   * Load memories from storage
   */
  async loadMemories() {
    try {
      const [syncResult, localResult] = await Promise.all([
        chrome.storage.sync.get([this.config.STORAGE_KEY_SYNC]),
        chrome.storage.local.get([this.config.STORAGE_KEY_LOCAL]),
      ]);

      const syncMemories = syncResult[this.config.STORAGE_KEY_SYNC] || [];
      const localMemories = localResult[this.config.STORAGE_KEY_LOCAL] || [];

      // Merge memories (sync takes precedence for duplicates)
      const memoryMap = new Map();

      for (const memory of localMemories) {
        memoryMap.set(memory.id, memory);
      }

      for (const memory of syncMemories) {
        memoryMap.set(memory.id, memory);
      }

      this.memoryCache = Array.from(memoryMap.values());

      // Sort by recency
      this.memoryCache.sort((a, b) => b.storedAt - a.storedAt);

      console.log("[CrossTabSync] Loaded", this.memoryCache.length, "memories");
    } catch (error) {
      console.error("[CrossTabSync] Load failed:", error);
    }
  }

  /**
   * Clear all memories
   */
  async clear() {
    this.memoryCache = [];

    await Promise.all([
      chrome.storage.sync.remove([this.config.STORAGE_KEY_SYNC]),
      chrome.storage.local.remove([this.config.STORAGE_KEY_LOCAL]),
    ]);

    // Broadcast clear to other tabs
    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage({ type: "memory_cleared", data: {} });
    }

    this._notifyListeners("memories_cleared", {});
    console.log("[CrossTabSync] Cleared all memories");
  }

  /**
   * Subscribe to memory updates
   * @param {Function} callback - Callback function(eventType, data)
   * @returns {Function} Unsubscribe function
   */
  onMemoryUpdate(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  _notifyListeners(eventType, data) {
    for (const listener of this.listeners) {
      try {
        listener(eventType, data);
      } catch (error) {
        console.error("[CrossTabSync] Listener error:", error);
      }
    }
  }

  /**
   * Get stats for debugging
   */
  getStats() {
    const byType = {};
    for (const memory of this.memoryCache) {
      byType[memory.type] = (byType[memory.type] || 0) + 1;
    }

    return {
      totalMemories: this.memoryCache.length,
      byType: byType,
      listenerCount: this.listeners.size,
      broadcastAvailable: this.broadcastChannel !== null,
    };
  }
}

// Export singleton instance
const crossTabSync = new CrossTabSync();

// Make available globally for background.js
if (typeof globalThis !== "undefined") {
  globalThis.crossTabSync = crossTabSync;
}
