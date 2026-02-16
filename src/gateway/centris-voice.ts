/**
 * Centris voice WebSocket endpoint for the gateway.
 *
 * Accepts audio from the Centris Electron app and routes it through
 * Deepgram streaming transcription → agent execution or dictation cleanup.
 *
 * Protocol (JSON messages over WebSocket):
 *   Client → Server:
 *     { type: "recording_start", sessionId, sampleRate?, channels?, mode? }
 *     { type: "audio", data: "<base64-encoded PCM>" }
 *     { type: "voice_end" }
 *
 *   Server → Client:
 *     { type: "transcript", text, partial: true|false }
 *     { type: "result", text, mode: "action"|"dictation" }
 *     { type: "error", message }
 */

import type { IncomingMessage } from "node:http";
import type { WebSocket } from "ws";
import { logDebug, logError, logInfo, logWarn } from "../logger.js";

// Audio modules are loaded dynamically — they may not exist yet.
// Placeholder type for the Deepgram adapter until audio modules are implemented
interface DeepgramAdapter {
  startStreaming(opts: { sampleRate: number; channels: number }): Promise<void>;
  stopStreaming(): Promise<{ text: string }>;
  sendAudio(data: Buffer): void;
  onPartialTranscript(cb: (text: string) => void): void;
}
let DeepgramStreamingAdapter: (new (opts: { apiKey: string }) => DeepgramAdapter) | null = null;
let cleanupDictationText: ((text: string) => string) | null = null;
try {
  // Dynamic import so the voice pipeline degrades gracefully when audio modules
  // haven't been implemented yet (stub phase).
  const deepgramMod = await import("../audio/deepgram-streaming.js");
  DeepgramStreamingAdapter = deepgramMod.DeepgramStreamingAdapter;
  const dictMod = await import("../audio/dictation-cleanup.js");
  cleanupDictationText = dictMod.cleanupDictationText;
} catch {
  logDebug("[centris-voice] audio modules not available; voice features will be disabled");
}

export type CentrisVoiceMode = "action" | "dictation";

interface VoiceSession {
  sessionId: string;
  mode: CentrisVoiceMode;
  ws: WebSocket;
}

let adapter: DeepgramAdapter | null = null;

function getAdapter(): DeepgramAdapter | null {
  if (adapter) {
    return adapter;
  }
  if (!DeepgramStreamingAdapter) {
    logWarn("[centris-voice] DeepgramStreamingAdapter not available; voice features disabled");
    return null;
  }
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    logWarn("[centris-voice] DEEPGRAM_API_KEY not set; voice features disabled");
    return null;
  }
  adapter = new DeepgramStreamingAdapter({ apiKey });
  return adapter;
}

function sendWs(ws: WebSocket, message: Record<string, unknown>) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

/**
 * Handle a WebSocket connection for Centris voice.
 * Called from the gateway's WebSocket upgrade handler when path = /ws/centris/voice.
 */
export async function handleCentrisVoiceConnection(ws: WebSocket, _req: IncomingMessage) {
  const deepgram = getAdapter();
  let voiceSession: VoiceSession | null = null;

  logInfo("[centris-voice] client connected");

  ws.on("message", async (raw) => {
    try {
      const rawStr =
        typeof raw === "string"
          ? raw
          : Buffer.isBuffer(raw)
            ? raw.toString("utf-8")
            : Buffer.from(raw as ArrayBuffer).toString("utf-8");
      const msg = JSON.parse(rawStr) as Record<string, unknown>;
      const type = msg.type as string;

      if (type === "recording_start") {
        if (!deepgram) {
          sendWs(ws, {
            type: "error",
            message: "Voice features unavailable (DEEPGRAM_API_KEY not set)",
          });
          return;
        }

        const sessionId = typeof msg.sessionId === "string" ? msg.sessionId : `voice-${Date.now()}`;
        const sampleRate = typeof msg.sampleRate === "number" ? msg.sampleRate : 16000;
        const channels = typeof msg.channels === "number" ? msg.channels : 1;
        const mode = (msg.mode === "dictation" ? "dictation" : "action") as CentrisVoiceMode;

        // Create Deepgram streaming session
        const dgSession = await deepgram.createSession(sessionId, sampleRate, channels);

        voiceSession = { sessionId, mode, ws };

        // Wire transcript callbacks to WebSocket
        dgSession.connection?.onTranscript((text, isFinal) => {
          sendWs(ws, { type: "transcript", text, partial: !isFinal });
        });

        sendWs(ws, { type: "session_started", sessionId, mode });
        logDebug(`[centris-voice] session started: ${sessionId} (mode=${mode})`);
        return;
      }

      if (type === "audio") {
        if (!voiceSession || !deepgram) {
          return;
        }
        const base64Data = msg.data as string;
        if (!base64Data) {
          return;
        }
        const audioChunk = Buffer.from(base64Data, "base64");
        deepgram.sendAudio(voiceSession.sessionId, audioChunk);
        return;
      }

      if (type === "voice_end") {
        if (!voiceSession || !deepgram) {
          return;
        }

        const finalText = await deepgram.finalizeSession(voiceSession.sessionId);
        logDebug(`[centris-voice] finalized: "${finalText}" (mode=${voiceSession.mode})`);

        if (!finalText.trim()) {
          sendWs(ws, { type: "result", text: "", mode: voiceSession.mode });
          return;
        }

        if (voiceSession.mode === "dictation") {
          // Dictation: clean text and return for pasting
          const cleaned = cleanupDictationText ? cleanupDictationText(finalText) : finalText;
          sendWs(ws, { type: "result", text: cleaned, mode: "dictation" });
        } else {
          // Action mode: return transcript for agent processing
          // The Electron app sends this to the gateway's chat/agent endpoint
          sendWs(ws, { type: "result", text: finalText, mode: "action" });
        }

        // Reset for next recording
        deepgram.resetSession(voiceSession.sessionId);
        return;
      }

      if (type === "mode_switch") {
        if (voiceSession) {
          voiceSession.mode = (
            msg.mode === "dictation" ? "dictation" : "action"
          ) as CentrisVoiceMode;
          sendWs(ws, { type: "mode_changed", mode: voiceSession.mode });
        }
        return;
      }
    } catch (err) {
      logError(
        `[centris-voice] message error: ${err instanceof Error ? err.message : String(err)}`,
      );
      sendWs(ws, { type: "error", message: "Internal error processing voice message" });
    }
  });

  ws.on("close", () => {
    if (voiceSession && deepgram) {
      deepgram.closeSession(voiceSession.sessionId);
    }
    logInfo("[centris-voice] client disconnected");
  });

  ws.on("error", (err) => {
    logError(`[centris-voice] websocket error: ${err.message}`);
  });
}

/** Check if a WebSocket upgrade path is for Centris voice */
export function isCentrisVoicePath(pathname: string): boolean {
  return pathname === "/ws/centris/voice";
}
