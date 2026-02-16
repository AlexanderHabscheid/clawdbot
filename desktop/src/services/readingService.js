/**
 * Reading Service - Handles text-to-speech reading of documents and emails
 *
 * This is the inverse of Dictation Mode:
 * - Dictation: Voice → Text (you speak, it types)
 * - Reading: Text → Voice (it speaks, you listen)
 *
 * Features:
 * - Stream audio chunks for long documents
 * - Pause/Resume/Stop controls
 * - Speed adjustment (0.5x - 2.0x)
 * - Skip forward/back between chunks
 * - Progress tracking
 * - Voice selection
 *
 * Integration with:
 * - Native Control: Text extraction via accessibility APIs
 * - Chrome Extension: Web page content extraction
 * - Backend: TTS synthesis via OpenAI
 */

import { getAudioSystem } from "./audioSystem";

// Backend URL
const BACKEND_URL = "http://localhost:8766";

// Available TTS voices
export const READING_VOICES = {
  nova: { name: "Nova", description: "Clear, neutral - best for reading", gender: "neutral" },
  alloy: { name: "Alloy", description: "Balanced, slightly warmer", gender: "neutral" },
  echo: { name: "Echo", description: "Male, conversational", gender: "male" },
  fable: { name: "Fable", description: "Expressive, storytelling", gender: "neutral" },
  onyx: { name: "Onyx", description: "Deep, authoritative", gender: "male" },
  shimmer: { name: "Shimmer", description: "Female, warm", gender: "female" },
};

// Reading state enum
export const ReadingState = {
  IDLE: "idle",
  READING: "reading",
  PAUSED: "paused",
  LOADING: "loading",
};

/**
 * Reading Service - Manages text-to-speech reading sessions
 */
class ReadingService {
  constructor() {
    this.state = ReadingState.IDLE;
    this.currentSession = null;
    this.audioQueue = [];
    this.isPlaying = false;
    this.isPaused = false;
    this.voice = "nova";
    this.speed = 1.0;

    // Callbacks
    this.onStateChange = null;
    this.onProgressUpdate = null;
    this.onError = null;
    this.onChunkReady = null;
    this.onReadingComplete = null;

    // Audio system reference
    this.audioSystem = null;

    console.log("[ReadingService] 📖 Initialized");
  }

  /**
   * Set event callbacks
   */
  setCallbacks({ onStateChange, onProgressUpdate, onError, onChunkReady, onReadingComplete }) {
    this.onStateChange = onStateChange;
    this.onProgressUpdate = onProgressUpdate;
    this.onError = onError;
    this.onChunkReady = onChunkReady;
    this.onReadingComplete = onReadingComplete;
  }

  /**
   * Get or initialize audio system
   */
  getAudioSystem() {
    if (!this.audioSystem) {
      this.audioSystem = getAudioSystem();
    }
    return this.audioSystem;
  }

  /**
   * Update state and notify listeners
   */
  _setState(newState) {
    const oldState = this.state;
    this.state = newState;
    console.log(`[ReadingService] State: ${oldState} → ${newState}`);
    this.onStateChange?.(newState, oldState);
  }

  /**
   * Start reading text aloud
   *
   * @param {string} text - Text to read
   * @param {Object} options - Reading options
   * @param {string} options.voice - TTS voice (nova, alloy, echo, fable, onyx, shimmer)
   * @param {string} options.title - Optional title/source name
   * @param {string} options.source - Source type (selection, article, email, etc.)
   * @returns {Promise<boolean>} - True if reading started successfully
   */
  async startReading(text, options = {}) {
    const { voice = this.voice, title, source } = options;

    if (!text || !text.trim()) {
      console.error("[ReadingService] No text to read");
      this.onError?.({ title: "No Text", description: "No text provided to read" });
      return false;
    }

    this._setState(ReadingState.LOADING);

    try {
      // Start reading session on backend
      const response = await fetch(`${BACKEND_URL}/api/reading/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice, title, source }),
      });

      const session = await response.json();

      if (!session.success) {
        console.error("[ReadingService] Failed to start:", session.error);
        this._setState(ReadingState.IDLE);
        this.onError?.({ title: "Reading Failed", description: session.error });
        return false;
      }

      this.currentSession = session;
      this.voice = voice;
      this.isPlaying = true;
      this.isPaused = false;
      this._setState(ReadingState.READING);

      console.log(
        `[ReadingService] 📖 Started: ${session.word_count} words, ` +
          `~${session.estimated_duration_seconds}s, ${session.total_chunks} chunks`,
      );

      // Start fetching and playing chunks
      await this._playChunks();

      return true;
    } catch (error) {
      console.error("[ReadingService] Error starting:", error);
      this._setState(ReadingState.IDLE);
      this.onError?.({ title: "Reading Error", description: error.message });
      return false;
    }
  }

  /**
   * Start reading selected text from the current app
   * Uses native control to get selected text
   */
  async readSelectedText(options = {}) {
    try {
      // Get selected text via native control (Electron IPC)
      if (window.electronAPI?.getSelectedText) {
        const selectedText = await window.electronAPI.getSelectedText();
        if (selectedText && selectedText.trim()) {
          return this.startReading(selectedText, { ...options, source: "selection" });
        }
      }

      // Fallback: use clipboard
      const clipboardText = await navigator.clipboard.readText();
      if (clipboardText && clipboardText.trim()) {
        return this.startReading(clipboardText, { ...options, source: "clipboard" });
      }

      this.onError?.({ title: "No Selection", description: "No text is selected or in clipboard" });
      return false;
    } catch (error) {
      console.error("[ReadingService] Error reading selection:", error);
      this.onError?.({ title: "Selection Error", description: error.message });
      return false;
    }
  }

  /**
   * Internal method to fetch and play audio chunks
   */
  async _playChunks() {
    const audioSystem = this.getAudioSystem();

    while (this.isPlaying && !this.isPaused) {
      try {
        const response = await fetch(`${BACKEND_URL}/api/reading/chunk`);

        if (response.status === 204) {
          // Reading complete
          console.log("[ReadingService] ✅ Reading complete");
          this._setState(ReadingState.IDLE);
          this.isPlaying = false;
          this.currentSession = null;
          this.onReadingComplete?.();
          break;
        }

        if (!response.ok) {
          throw new Error(`Chunk fetch failed: ${response.status}`);
        }

        const audioBlob = await response.blob();
        const blobUrl = URL.createObjectURL(audioBlob);

        // Update progress
        await this._updateProgress();

        // Notify chunk ready
        this.onChunkReady?.(blobUrl);

        // Play audio chunk
        await audioSystem.playVoiceResponse(blobUrl, { queue: true });

        // Clean up blob URL after playback
        URL.revokeObjectURL(blobUrl);
      } catch (error) {
        console.error("[ReadingService] Error fetching chunk:", error);
        this.onError?.({ title: "Playback Error", description: error.message });
        break;
      }
    }
  }

  /**
   * Update reading progress from backend
   */
  async _updateProgress() {
    try {
      const response = await fetch(`${BACKEND_URL}/api/reading/progress`);
      const progress = await response.json();
      this.onProgressUpdate?.(progress);
    } catch (error) {
      console.warn("[ReadingService] Progress update failed:", error);
    }
  }

  /**
   * Send control command to backend
   */
  async _sendControl(action) {
    try {
      const response = await fetch(`${BACKEND_URL}/api/reading/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      return await response.json();
    } catch (error) {
      console.error(`[ReadingService] Control error (${action}):`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Pause reading
   */
  async pause() {
    if (this.state !== ReadingState.READING) {
      return { success: false, error: "Not currently reading" };
    }

    this.isPaused = true;
    this._setState(ReadingState.PAUSED);

    // Pause audio playback
    this.getAudioSystem().tts.pause();

    // Notify backend
    return await this._sendControl("pause");
  }

  /**
   * Resume reading
   */
  async resume() {
    if (this.state !== ReadingState.PAUSED) {
      return { success: false, error: "Not paused" };
    }

    this.isPaused = false;
    this._setState(ReadingState.READING);

    // Resume audio playback
    this.getAudioSystem().tts.resume();

    // Notify backend and continue fetching chunks
    const result = await this._sendControl("resume");
    this._playChunks();

    return result;
  }

  /**
   * Stop reading completely
   */
  async stop() {
    this.isPlaying = false;
    this.isPaused = false;
    this._setState(ReadingState.IDLE);
    this.currentSession = null;

    // Stop audio playback
    this.getAudioSystem().stopVoice();
    this.getAudioSystem().tts.clearQueue();

    // Notify backend
    return await this._sendControl("stop");
  }

  /**
   * Increase reading speed
   */
  async faster() {
    this.speed = Math.min(2.0, this.speed + 0.25);
    console.log(`[ReadingService] Speed: ${this.speed}x`);
    return await this._sendControl("faster");
  }

  /**
   * Decrease reading speed
   */
  async slower() {
    this.speed = Math.max(0.5, this.speed - 0.25);
    console.log(`[ReadingService] Speed: ${this.speed}x`);
    return await this._sendControl("slower");
  }

  /**
   * Skip to next chunk
   */
  async skipForward() {
    return await this._sendControl("skip");
  }

  /**
   * Go back to previous chunk
   */
  async skipBack() {
    return await this._sendControl("back");
  }

  /**
   * Restart from the beginning
   */
  async restart() {
    this._setState(ReadingState.READING);
    this.isPlaying = true;
    this.isPaused = false;

    const result = await this._sendControl("restart");
    this._playChunks();

    return result;
  }

  /**
   * Change TTS voice
   */
  async setVoice(voice) {
    if (!READING_VOICES[voice]) {
      return { success: false, error: `Invalid voice: ${voice}` };
    }

    this.voice = voice;

    try {
      const response = await fetch(`${BACKEND_URL}/api/reading/voice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice }),
      });
      return await response.json();
    } catch (error) {
      console.error("[ReadingService] Set voice error:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Summarize text before reading
   *
   * @param {string} text - Full text to summarize
   * @param {string} style - 'brief', 'detailed', or 'key_points'
   * @returns {Promise<Object>} - Summary result
   */
  async summarize(text, style = "brief") {
    try {
      const response = await fetch(`${BACKEND_URL}/api/reading/summarize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, style }),
      });
      return await response.json();
    } catch (error) {
      console.error("[ReadingService] Summarize error:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Summarize and then read the summary
   */
  async summarizeAndRead(text, style = "brief", options = {}) {
    const result = await this.summarize(text, style);

    if (result.success && result.summary) {
      return this.startReading(result.summary, { ...options, source: "summary" });
    }

    this.onError?.({ title: "Summarization Failed", description: result.error });
    return false;
  }

  /**
   * Extract text from current context and read it
   * Uses the reading source router on the backend
   */
  async readFromContext(context = {}) {
    this._setState(ReadingState.LOADING);

    try {
      // Get app context from native control if available
      let fullContext = { ...context };

      if (window.electronAPI?.getActiveApp) {
        const appInfo = await window.electronAPI.getActiveApp();
        fullContext = { ...fullContext, ...appInfo };
      }

      // Request text extraction from backend
      const response = await fetch(`${BACKEND_URL}/api/reading/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fullContext),
      });

      const result = await response.json();

      if (result.success && result.text) {
        return this.startReading(result.text, {
          title: result.title,
          source: result.source,
        });
      }

      this._setState(ReadingState.IDLE);
      this.onError?.({
        title: "Extraction Failed",
        description: result.error || "Could not extract text from this context",
      });
      return false;
    } catch (error) {
      console.error("[ReadingService] Context read error:", error);
      this._setState(ReadingState.IDLE);
      this.onError?.({ title: "Reading Error", description: error.message });
      return false;
    }
  }

  /**
   * Get current reading state
   */
  getState() {
    return {
      state: this.state,
      isPlaying: this.isPlaying,
      isPaused: this.isPaused,
      session: this.currentSession,
      voice: this.voice,
      speed: this.speed,
    };
  }

  /**
   * Get reading progress
   */
  async getProgress() {
    try {
      const response = await fetch(`${BACKEND_URL}/api/reading/progress`);
      return await response.json();
    } catch (error) {
      console.error("[ReadingService] Get progress error:", error);
      return { state: "idle", progress: 0 };
    }
  }

  /**
   * Check if reading is currently active
   */
  isActive() {
    return this.state === ReadingState.READING || this.state === ReadingState.PAUSED;
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    this.stop();
    this.onStateChange = null;
    this.onProgressUpdate = null;
    this.onError = null;
    this.onChunkReady = null;
    this.onReadingComplete = null;
    console.log("[ReadingService] 🧹 Cleaned up");
  }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

let readingServiceInstance = null;

/**
 * Get the reading service instance
 */
export function getReadingService() {
  if (!readingServiceInstance) {
    readingServiceInstance = new ReadingService();
  }
  return readingServiceInstance;
}

// Export class for testing
export { ReadingService };
export default getReadingService;
