/**
 * Centris Native Audio Module
 * 
 * High-performance audio capture for Wispr Flow-level latency (<700ms end-to-end).
 * Uses native OS APIs (Core Audio on macOS, WASAPI on Windows) with pre-allocated
 * buffers and direct WebSocket streaming to the backend.
 */

#ifndef CENTRIS_AUDIO_H
#define CENTRIS_AUDIO_H

#include <napi.h>
#include <string>
#include <memory>
#include <functional>
#include <atomic>
#include <thread>
#include <vector>
#include <mutex>

// Include circular buffer header for template definition (must be before namespace)
#include "circular_buffer.h"
// Include audio capture header for AudioDevice, AudioConfig, AudioFormat definitions
#include "audio_capture.h"

namespace centris {

// Forward declarations
class VADProcessor;
class StreamProcessor;
class WebSocketClient;

/**
 * Audio capture statistics for performance monitoring
 */
struct AudioStats {
  uint64_t totalSamples = 0;
  uint64_t droppedSamples = 0;
  double avgLatencyMs = 0.0;
  double maxLatencyMs = 0.0;
  uint64_t bytesTransmitted = 0;
  uint64_t messagesReceived = 0;
  double avgProcessingMs = 0.0;
};

/**
 * Main audio capture class
 * 
 * Thread model:
 * - Audio callback thread (OS-managed, real-time priority)
 * - Processing thread (normal priority, handles VAD/encoding)
 * - Network thread (libuv/io, handles WebSocket)
 * - Main thread (Node.js event loop, handles callbacks to JS)
 */
class CentrisAudioCapture {
public:
  CentrisAudioCapture();
  ~CentrisAudioCapture();

  // Lifecycle
  bool Initialize(const AudioConfig& config);
  bool Start();
  bool Stop();
  void Shutdown();
  bool IsRunning() const { return running_.load(); }
  bool IsInitialized() const { return initialized_.load(); }

  // Configuration
  const AudioConfig& GetConfig() const { return config_; }
  AudioStats GetStats() const;

  // Device enumeration
  static std::vector<AudioDevice> GetInputDevices();
  static AudioDevice GetDefaultInputDevice();
  
  // Audio chunk retrieval for IPC bridging
  // Returns queued audio chunks that JavaScript should send via Socket.IO
  struct AudioChunkData {
    uint32_t sequence;
    std::vector<uint8_t> data;
  };
  std::vector<AudioChunkData> GetQueuedAudioChunks();

  // Callbacks (thread-safe, called from processing thread)
  using AudioLevelCallback = std::function<void(float level)>;
  using VoiceStartCallback = std::function<void()>;
  using VoiceEndCallback = std::function<void()>;
  using TranscriptCallback = std::function<void(const std::string& text, bool isFinal, float confidence)>;
  using ErrorCallback = std::function<void(const std::string& error)>;
  using AudioChunkCallback = std::function<void(uint32_t sequence, const std::vector<uint8_t>& data)>;

  void SetAudioLevelCallback(AudioLevelCallback cb);
  void SetVoiceStartCallback(VoiceStartCallback cb);
  void SetVoiceEndCallback(VoiceEndCallback cb);
  void SetTranscriptCallback(TranscriptCallback cb);
  void SetErrorCallback(ErrorCallback cb);
  void SetAudioChunkCallback(AudioChunkCallback cb);

private:
  // Audio callback from OS (real-time thread - NO allocations!)
  void OnAudioData(const int16_t* data, size_t sampleCount);

  // Processing thread main loop
  void ProcessingThreadMain();

  // WebSocket message handlers
  void OnWebSocketMessage(const std::string& message);
  void OnWebSocketError(const std::string& error);
  void OnWebSocketConnected();
  void OnWebSocketDisconnected();

  // Internal state
  AudioConfig config_;
  std::atomic<bool> initialized_{false};
  std::atomic<bool> running_{false};
  std::atomic<bool> voiceActive_{false};

  // Components (owned)
  std::unique_ptr<AudioCapture> capture_;
  std::unique_ptr<AudioBuffer16k2s> buffer_;  // 2 seconds at 16kHz
  std::unique_ptr<VADProcessor> vad_;
  std::unique_ptr<StreamProcessor> processor_;
  std::unique_ptr<WebSocketClient> wsClient_;

  // Threading
  std::thread processingThread_;
  std::mutex callbackMutex_;

  // Callbacks
  AudioLevelCallback audioLevelCb_;
  VoiceStartCallback voiceStartCb_;
  VoiceEndCallback voiceEndCb_;
  TranscriptCallback transcriptCb_;
  ErrorCallback errorCb_;
  AudioChunkCallback audioChunkCb_;

  // Local audio chunk queue for GetQueuedAudioChunks (used when no WebSocket)
  // This allows microphone testing to work without a backend connection
  mutable std::mutex localChunksMutex_;
  std::vector<AudioChunkData> localChunks_;
  static constexpr size_t kMaxLocalChunks = 1000;  // Limit memory usage

  // Statistics
  mutable std::mutex statsMutex_;
  AudioStats stats_;
};

/**
 * Node.js addon wrapper class
 * 
 * Exposes CentrisAudioCapture to JavaScript via N-API
 */
class CentrisAudioAddon : public Napi::ObjectWrap<CentrisAudioAddon> {
public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports);
  CentrisAudioAddon(const Napi::CallbackInfo& info);
  ~CentrisAudioAddon();

private:
  // JavaScript methods
  Napi::Value Initialize(const Napi::CallbackInfo& info);
  Napi::Value Start(const Napi::CallbackInfo& info);
  Napi::Value Stop(const Napi::CallbackInfo& info);
  Napi::Value Shutdown(const Napi::CallbackInfo& info);
  Napi::Value IsRunning(const Napi::CallbackInfo& info);
  Napi::Value GetStats(const Napi::CallbackInfo& info);
  
  // Static methods
  static Napi::Value GetInputDevices(const Napi::CallbackInfo& info);
  static Napi::Value GetDefaultInputDevice(const Napi::CallbackInfo& info);

  // Event emitter methods
  Napi::Value On(const Napi::CallbackInfo& info);
  Napi::Value Off(const Napi::CallbackInfo& info);
  
  // Audio chunk retrieval for IPC bridging
  Napi::Value GetQueuedAudioChunks(const Napi::CallbackInfo& info);

  // Internal
  void EmitEvent(const std::string& event, const Napi::Value& data);
  void SetupCallbacks();

  std::unique_ptr<CentrisAudioCapture> capture_;
  Napi::Env env_;
  
  // Thread-safe function references for callbacks
  Napi::ThreadSafeFunction tsfnAudioLevel_;
  Napi::ThreadSafeFunction tsfnVoiceStart_;
  Napi::ThreadSafeFunction tsfnVoiceEnd_;
  Napi::ThreadSafeFunction tsfnTranscript_;
  Napi::ThreadSafeFunction tsfnError_;
  Napi::ThreadSafeFunction tsfnAudioChunk_;
};

} // namespace centris

#endif // CENTRIS_AUDIO_H
