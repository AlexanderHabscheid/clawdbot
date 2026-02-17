import { describe, expect, it, vi } from "vitest";

/**
 * Centris Voice Pipeline Tests
 *
 * Tests the voice WebSocket endpoint that bridges the Electron app's audio
 * to Deepgram transcription and agent execution.
 *
 * Strategy: mock the dynamic audio module imports and test the WebSocket
 * protocol handling — session lifecycle, mode switching, and degraded state
 * when Deepgram is not configured.
 */

vi.mock("../logger.js", () => ({
  logInfo: vi.fn(),
  logDebug: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

// ─── Mock WebSocket ─────────────────────────────────────────────────────────

function createMockVoiceWs() {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const sent: string[] = [];

  const ws = {
    OPEN: 1,
    readyState: 1,
    send: vi.fn((data: string) => sent.push(data)),
    close: vi.fn(),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const list = listeners.get(event) ?? [];
      list.push(handler);
      listeners.set(event, list);
    }),
  };

  return {
    ws: ws as unknown as import("ws").WebSocket,
    sent,
    receive(msg: Record<string, unknown>) {
      const handlers = listeners.get("message") ?? [];
      for (const handler of handlers) {
        handler(JSON.stringify(msg));
      }
    },
    disconnect() {
      ws.readyState = 3;
      const handlers = listeners.get("close") ?? [];
      for (const handler of handlers) {
        handler();
      }
    },
  };
}

import type { IncomingMessage } from "node:http";

const mockReq = {} as IncomingMessage;

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("centris-voice", () => {
  describe("isCentrisVoicePath", () => {
    it("matches the voice endpoint", async () => {
      const { isCentrisVoicePath } = await import("./centris-voice.js");
      expect(isCentrisVoicePath("/ws/centris/voice")).toBe(true);
    });

    it("rejects other paths", async () => {
      const { isCentrisVoicePath } = await import("./centris-voice.js");
      expect(isCentrisVoicePath("/ws/centris/extension")).toBe(false);
      expect(isCentrisVoicePath("/ws/something")).toBe(false);
      expect(isCentrisVoicePath("/")).toBe(false);
    });
  });

  describe("handleCentrisVoiceConnection", () => {
    it("registers message, close, and error handlers", async () => {
      const { handleCentrisVoiceConnection } = await import("./centris-voice.js");
      const mock = createMockVoiceWs();

      await handleCentrisVoiceConnection(mock.ws, mockReq);

      // Should register handlers for all three events
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const onSpy = mock.ws.on;
      expect(onSpy).toHaveBeenCalledWith("message", expect.any(Function));
      expect(onSpy).toHaveBeenCalledWith("close", expect.any(Function));
      expect(onSpy).toHaveBeenCalledWith("error", expect.any(Function));
    });

    it("handles recording_start without Deepgram gracefully", async () => {
      // Without DEEPGRAM_API_KEY, the adapter is null.
      // The handler should send an error, not crash.
      const { handleCentrisVoiceConnection } = await import("./centris-voice.js");
      const mock = createMockVoiceWs();

      await handleCentrisVoiceConnection(mock.ws, mockReq);

      mock.receive({
        type: "recording_start",
        sessionId: "test-session",
        sampleRate: 16000,
        channels: 1,
        mode: "action",
      });

      // Should either send error or silently handle (depends on env)
      // At minimum, it should not crash
    });

    it("handles audio message without active session gracefully", async () => {
      const { handleCentrisVoiceConnection } = await import("./centris-voice.js");
      const mock = createMockVoiceWs();

      await handleCentrisVoiceConnection(mock.ws, mockReq);

      // Send audio without starting a session — should not crash
      mock.receive({
        type: "audio",
        data: Buffer.from("fake-audio").toString("base64"),
      });
    });

    it("handles voice_end without active session gracefully", async () => {
      const { handleCentrisVoiceConnection } = await import("./centris-voice.js");
      const mock = createMockVoiceWs();

      await handleCentrisVoiceConnection(mock.ws, mockReq);

      // End voice without starting — should not crash
      mock.receive({ type: "voice_end" });
    });

    it("handles mode_switch message", async () => {
      const { handleCentrisVoiceConnection } = await import("./centris-voice.js");
      const mock = createMockVoiceWs();

      await handleCentrisVoiceConnection(mock.ws, mockReq);

      // Mode switch without active session — should not crash
      mock.receive({ type: "mode_switch", mode: "dictation" });
    });

    it("handles malformed JSON gracefully", async () => {
      const { handleCentrisVoiceConnection } = await import("./centris-voice.js");
      const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
      const ws = {
        OPEN: 1,
        readyState: 1,
        send: vi.fn(),
        close: vi.fn(),
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          const list = listeners.get(event) ?? [];
          list.push(handler);
          listeners.set(event, list);
        }),
      } as unknown as import("ws").WebSocket;

      await handleCentrisVoiceConnection(ws, mockReq);

      // Send malformed JSON
      const handlers = listeners.get("message") ?? [];
      for (const handler of handlers) {
        handler("not-valid-json{{{");
      }

      // Should send error message, not crash
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const sendSpy = ws.send;
      expect(sendSpy).toHaveBeenCalledWith(expect.stringContaining("error"));
    });

    it("handles disconnect cleanly", async () => {
      const { handleCentrisVoiceConnection } = await import("./centris-voice.js");
      const mock = createMockVoiceWs();

      await handleCentrisVoiceConnection(mock.ws, mockReq);
      mock.disconnect();
      // Should not throw
    });
  });
});
