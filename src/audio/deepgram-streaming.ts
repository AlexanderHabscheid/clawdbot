/**
 * Deepgram Streaming Adapter
 *
 * Manages streaming audio transcription sessions via Deepgram's real-time API.
 * Each session has its own WebSocket connection to Deepgram, allowing
 * multiple concurrent voice sessions.
 *
 * Usage: instantiated by centris-voice.ts when DEEPGRAM_API_KEY is set.
 */

import { logDebug, logError, logInfo, logWarn } from "../logger.js";

interface TranscriptCallback {
  (text: string, isFinal: boolean): void;
}

interface DeepgramConnection {
  onTranscript(cb: TranscriptCallback): void;
  close(): void;
}

interface StreamingSession {
  sessionId: string;
  sampleRate: number;
  channels: number;
  connection: DeepgramConnection | null;
  transcriptCallbacks: TranscriptCallback[];
  buffer: Buffer[];
  finalText: string;
  closed: boolean;
}

export class DeepgramStreamingAdapter {
  private apiKey: string;
  private sessions = new Map<string, StreamingSession>();

  constructor(opts: { apiKey: string }) {
    this.apiKey = opts.apiKey;
    logInfo("[deepgram] adapter initialized");
  }

  /**
   * Create a new streaming transcription session.
   * Opens a WebSocket to Deepgram's real-time API.
   */
  async createSession(
    sessionId: string,
    sampleRate: number,
    channels: number,
  ): Promise<{ connection: DeepgramConnection | null }> {
    // Close existing session with same ID
    if (this.sessions.has(sessionId)) {
      this.closeSession(sessionId);
    }

    const session: StreamingSession = {
      sessionId,
      sampleRate,
      channels,
      connection: null,
      transcriptCallbacks: [],
      buffer: [],
      finalText: "",
      closed: false,
    };

    try {
      // Node 22+ has a global WebSocket but its constructor only accepts
      // (url, protocols?) — headers must go via the 'ws' library or an HTTP
      // upgrade approach. Use the 'ws' package if available, fall back to global.
      const wsUrl = `wss://api.deepgram.com/v1/listen?model=nova-3&language=en&smart_format=true&sample_rate=${sampleRate}&channels=${channels}&encoding=linear16`;
      let ws: WebSocket;
      try {
        // Prefer the 'ws' library which supports headers in constructor
        const { default: WsLib } = await import("ws");
        ws = new (WsLib as unknown as typeof WebSocket)(wsUrl, {
          headers: { Authorization: `Token ${this.apiKey}` },
        } as unknown as string);
      } catch {
        // Fallback: global WebSocket (no auth headers — will fail on Deepgram)
        ws = new WebSocket(wsUrl);
      }

      const connection: DeepgramConnection = {
        onTranscript(cb: TranscriptCallback) {
          session.transcriptCallbacks.push(cb);
        },
        close() {
          try {
            ws.close();
          } catch {
            // ignore
          }
        },
      };

      ws.addEventListener("message", (event: MessageEvent) => {
        try {
          const data = JSON.parse(typeof event.data === "string" ? event.data : "{}") as {
            type?: string;
            channel?: { alternatives?: Array<{ transcript?: string }> };
            is_final?: boolean;
            speech_final?: boolean;
          };

          if (data.type === "Results") {
            const transcript = data.channel?.alternatives?.[0]?.transcript ?? "";
            const isFinal = Boolean(data.is_final);

            if (transcript) {
              if (isFinal) {
                session.finalText += (session.finalText ? " " : "") + transcript;
              }
              for (const cb of session.transcriptCallbacks) {
                cb(transcript, isFinal);
              }
            }
          }
        } catch (err) {
          logError(
            `[deepgram] message parse error: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      });

      ws.addEventListener("error", () => {
        logError(`[deepgram] ws error for session ${sessionId}`);
      });

      ws.addEventListener("close", () => {
        logDebug(`[deepgram] ws closed for session ${sessionId}`);
      });

      // Wait for connection to open
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Deepgram connection timeout")), 5000);
        ws.addEventListener("open", () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      session.connection = connection;

      // Store raw ws reference for sending audio
      (session as unknown as Record<string, unknown>)._ws = ws;

      this.sessions.set(sessionId, session);
      logDebug(`[deepgram] session created: ${sessionId}`);

      return { connection };
    } catch (err) {
      logError(
        `[deepgram] failed to create session: ${err instanceof Error ? err.message : String(err)}`,
      );
      session.connection = null;
      this.sessions.set(sessionId, session);
      return { connection: null };
    }
  }

  /** Send audio data to an active session. */
  sendAudio(sessionId: string, data: Buffer): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.closed) {
      return;
    }

    const ws = (session as unknown as Record<string, unknown>)._ws as WebSocket | undefined;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(data as unknown as ArrayBuffer);
    } else {
      // Buffer audio if connection isn't ready yet
      session.buffer.push(data);
    }
  }

  /** Finalize a session and return the accumulated transcript. */
  async finalizeSession(sessionId: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      logWarn(`[deepgram] finalizeSession: unknown session ${sessionId}`);
      return "";
    }

    // Send close signal to Deepgram to flush remaining audio
    const ws = (session as unknown as Record<string, unknown>)._ws as WebSocket | undefined;
    if (ws && ws.readyState === WebSocket.OPEN) {
      // Deepgram expects an empty byte message to signal end of audio
      ws.send(new Uint8Array(0));
      // Give Deepgram a moment to flush final results
      await new Promise((r) => setTimeout(r, 500));
    }

    const result = session.finalText.trim();
    logDebug(`[deepgram] finalized session ${sessionId}: "${result.slice(0, 80)}..."`);
    return result;
  }

  /** Reset session state for reuse (new recording in same session). */
  resetSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    session.finalText = "";
    session.buffer = [];
    logDebug(`[deepgram] reset session ${sessionId}`);
  }

  /** Close and clean up a session. */
  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    session.closed = true;
    session.connection?.close();
    this.sessions.delete(sessionId);
    logDebug(`[deepgram] closed session ${sessionId}`);
  }
}
