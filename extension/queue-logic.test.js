/**
 * Tests for Response Queue Logic
 *
 * Run with: node --test queue-logic.test.js
 * Or with Vitest: npx vitest queue-logic.test.js
 */

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert");
const { createResponseQueue } = require("./queue-logic.js");

describe("createResponseQueue", () => {
  let queue;
  let mockSendMessage;
  let mockIsConnected;

  beforeEach(() => {
    mockSendMessage = () => true;
    mockIsConnected = () => true;
    queue = createResponseQueue({
      sendMessage: mockSendMessage,
      isConnected: mockIsConnected,
      maxRetries: 3,
    });
  });

  describe("queueForRetry", () => {
    it("adds new message to queue", () => {
      const result = queue.queueForRetry({ id: "msg1", type: "response" });
      assert.strictEqual(result, true);
      assert.strictEqual(queue.size(), 1);
    });

    it("updates existing message instead of duplicating", () => {
      queue.queueForRetry({ id: "msg1", data: "original" });
      const result = queue.queueForRetry({ id: "msg1", data: "updated" });

      assert.strictEqual(result, false); // Updated, not added
      assert.strictEqual(queue.size(), 1);

      const messages = queue.getAll();
      assert.strictEqual(messages[0].data, "updated");
    });

    it("handles multiple different messages", () => {
      queue.queueForRetry({ id: "msg1" });
      queue.queueForRetry({ id: "msg2" });
      queue.queueForRetry({ id: "msg3" });

      assert.strictEqual(queue.size(), 3);
    });

    it("sets queuedAt timestamp", () => {
      queue.queueForRetry({ id: "msg1" });
      const messages = queue.getAll();
      assert.ok(messages[0].queuedAt);
      assert.ok(new Date(messages[0].queuedAt) instanceof Date);
    });

    it("initializes retryCount to 0", () => {
      queue.queueForRetry({ id: "msg1" });
      const messages = queue.getAll();
      assert.strictEqual(messages[0].retryCount, 0);
    });
  });

  describe("retryAll", () => {
    it("returns zeros when queue is empty", () => {
      const result = queue.retryAll();
      assert.deepStrictEqual(result, { total: 0, success: 0, failed: 0, remaining: 0 });
    });

    it("skips retry when not connected", () => {
      queue = createResponseQueue({
        sendMessage: () => true,
        isConnected: () => false,
      });

      queue.queueForRetry({ id: "msg1" });
      queue.queueForRetry({ id: "msg2" });

      const result = queue.retryAll();
      assert.strictEqual(result.total, 2);
      assert.strictEqual(result.remaining, 2);
    });

    it("sends all messages when connected", () => {
      let sentMessages = [];
      queue = createResponseQueue({
        sendMessage: (msg) => {
          sentMessages.push(msg);
          return true;
        },
        isConnected: () => true,
      });

      queue.queueForRetry({ id: "msg1" });
      queue.queueForRetry({ id: "msg2" });

      const result = queue.retryAll();
      assert.strictEqual(result.total, 2);
      assert.strictEqual(result.success, 2);
      assert.strictEqual(result.failed, 0);
      assert.strictEqual(result.remaining, 0);
      assert.strictEqual(sentMessages.length, 2);
    });

    it("re-queues failed messages under max retries", () => {
      queue = createResponseQueue({
        sendMessage: () => false, // Always fails
        isConnected: () => true,
        maxRetries: 3,
      });

      queue.queueForRetry({ id: "msg1" });

      // First retry
      let result = queue.retryAll();
      assert.strictEqual(result.failed, 1);
      assert.strictEqual(result.remaining, 1);
      assert.strictEqual(queue.getAll()[0].retryCount, 1);

      // Second retry
      result = queue.retryAll();
      assert.strictEqual(queue.getAll()[0].retryCount, 2);

      // Third retry - should be dropped (retryCount = 3 >= maxRetries = 3)
      result = queue.retryAll();
      assert.strictEqual(result.remaining, 0);
    });

    it("drops messages after max retries exceeded", () => {
      let retryCount = 0;
      queue = createResponseQueue({
        sendMessage: () => {
          retryCount++;
          return false;
        },
        isConnected: () => true,
        maxRetries: 2,
      });

      queue.queueForRetry({ id: "msg1" });

      queue.retryAll(); // retry 1
      queue.retryAll(); // retry 2 - should be dropped after this

      const result = queue.retryAll();
      assert.strictEqual(result.total, 0); // Nothing to retry
      assert.strictEqual(queue.size(), 0);
    });

    it("increments retryCount on each attempt", () => {
      queue = createResponseQueue({
        sendMessage: () => false,
        isConnected: () => true,
        maxRetries: 5,
      });

      queue.queueForRetry({ id: "msg1" });

      queue.retryAll();
      assert.strictEqual(queue.getAll()[0].retryCount, 1);

      queue.retryAll();
      assert.strictEqual(queue.getAll()[0].retryCount, 2);

      queue.retryAll();
      assert.strictEqual(queue.getAll()[0].retryCount, 3);
    });
  });

  describe("clear", () => {
    it("removes all messages", () => {
      queue.queueForRetry({ id: "msg1" });
      queue.queueForRetry({ id: "msg2" });
      assert.strictEqual(queue.size(), 2);

      queue.clear();
      assert.strictEqual(queue.size(), 0);
    });
  });

  describe("size", () => {
    it("returns correct count", () => {
      assert.strictEqual(queue.size(), 0);

      queue.queueForRetry({ id: "msg1" });
      assert.strictEqual(queue.size(), 1);

      queue.queueForRetry({ id: "msg2" });
      assert.strictEqual(queue.size(), 2);
    });
  });

  describe("getAll", () => {
    it("returns copy of queue", () => {
      queue.queueForRetry({ id: "msg1" });
      const all = queue.getAll();

      // Modify returned array
      all.push({ id: "msg2" });

      // Original queue should be unchanged
      assert.strictEqual(queue.size(), 1);
    });
  });
});

describe("Message ordering (FIFO)", () => {
  it("processes messages in queue order", () => {
    const sentOrder = [];
    const queue = createResponseQueue({
      sendMessage: (msg) => {
        sentOrder.push(msg.id);
        return true;
      },
      isConnected: () => true,
    });

    queue.queueForRetry({ id: "first" });
    queue.queueForRetry({ id: "second" });
    queue.queueForRetry({ id: "third" });

    queue.retryAll();

    assert.deepStrictEqual(sentOrder, ["first", "second", "third"]);
  });
});

describe("Edge cases", () => {
  it("handles message with no id", () => {
    const queue = createResponseQueue({
      sendMessage: () => true,
      isConnected: () => true,
    });

    // Messages without id should still be queued
    queue.queueForRetry({ type: "response", data: "test" });
    assert.strictEqual(queue.size(), 1);
  });

  it("handles undefined message id gracefully", () => {
    const queue = createResponseQueue({
      sendMessage: () => true,
      isConnected: () => true,
    });

    queue.queueForRetry({ id: undefined, data: "test1" });
    queue.queueForRetry({ id: undefined, data: "test2" });

    // Both should be treated as duplicates (undefined === undefined)
    assert.strictEqual(queue.size(), 1);
  });

  it("handles mixed success/failure in batch", () => {
    let callCount = 0;
    const queue = createResponseQueue({
      sendMessage: () => {
        callCount++;
        return callCount % 2 === 0;
      }, // Alternates
      isConnected: () => true,
      maxRetries: 3,
    });

    queue.queueForRetry({ id: "msg1" });
    queue.queueForRetry({ id: "msg2" });
    queue.queueForRetry({ id: "msg3" });

    const result = queue.retryAll();
    // msg1: fails (call 1), msg2: succeeds (call 2), msg3: fails (call 3)
    assert.strictEqual(result.success, 1);
    assert.strictEqual(result.failed, 2);
    assert.strictEqual(result.remaining, 2); // msg1 and msg3 re-queued
  });
});
