/**
 * Centris Native Audio Module - Node.js Addon Entry Point
 * 
 * This is the main entry point for the native audio module.
 * It exposes the CentrisAudioCapture class to JavaScript via N-API.
 */

#include "centris_audio.h"
#include "audio_capture.h"
// circular_buffer.h is included via centris_audio.h
#include "vad_processor.h"
#include "stream_processor.h"
#include "websocket_client.h"

#include <iostream>
#include <chrono>

namespace centris {

// ============================================================================
// CentrisAudioCapture Implementation
// ============================================================================

CentrisAudioCapture::CentrisAudioCapture() = default;

CentrisAudioCapture::~CentrisAudioCapture() {
  Shutdown();
}

bool CentrisAudioCapture::Initialize(const AudioConfig& config) {
  if (initialized_.load()) {
    return true;
  }

  config_ = config;

  // Create components
  capture_ = AudioCapture::Create();
  if (!capture_) {
    std::cerr << "[CentrisAudioCapture] Failed to create audio capture" << std::endl;
    return false;
  }

  buffer_ = std::make_unique<AudioBuffer16k2s>();  // 2 seconds buffer at 16kHz

  vad_ = std::make_unique<VADProcessor>();
  VADConfig vadConfig;
  vadConfig.threshold = config.vadThreshold;
  vadConfig.silenceTimeoutMs = config.vadSilenceMs;
  vadConfig.sampleRate = config.sampleRate;
  if (!vad_->Initialize(vadConfig)) {
    std::cerr << "[CentrisAudioCapture] Failed to initialize VAD" << std::endl;
    return false;
  }

  processor_ = std::make_unique<StreamProcessor>();
  StreamConfig streamConfig;
  streamConfig.sampleRate = config.sampleRate;
  streamConfig.channels = config.channels;
  if (!processor_->Initialize(streamConfig)) {
    std::cerr << "[CentrisAudioCapture] Failed to initialize stream processor" << std::endl;
    return false;
  }

  wsClient_ = std::make_unique<WebSocketClient>();
  WSConfig wsConfig;
  wsConfig.url = config.backendUrl;
  wsConfig.authToken = config.authToken;
  if (!wsClient_->Initialize(wsConfig)) {
    std::cerr << "[CentrisAudioCapture] Failed to initialize WebSocket client" << std::endl;
    return false;
  }

  // Initialize audio capture
  if (!capture_->Initialize(config)) {
    std::cerr << "[CentrisAudioCapture] Failed to initialize audio capture" << std::endl;
    return false;
  }

  // Setup callbacks
  vad_->SetVoiceStartCallback([this]() {
    voiceActive_.store(true);
    std::lock_guard<std::mutex> lock(callbackMutex_);
    if (voiceStartCb_) {
      voiceStartCb_();
    }
  });

  vad_->SetVoiceEndCallback([this]() {
    voiceActive_.store(false);
    processor_->Flush();  // Send any remaining audio
    std::lock_guard<std::mutex> lock(callbackMutex_);
    if (voiceEndCb_) {
      voiceEndCb_();
    }
  });

  processor_->SetChunkReadyCallback([this](const AudioChunk& chunk) {
    // Queue chunk for JavaScript to retrieve and send via Socket.IO
    // In IPC bridge mode, JavaScript handles the actual WebSocket/Socket.IO connection
    // We always queue chunks regardless of native WebSocket state since JS may be connected
    if (wsClient_) {
      wsClient_->SendBinaryWithSequence(chunk.sequenceNumber, chunk.data);
    }
    
    // ALWAYS queue to local storage for GetQueuedAudioChunks()
    // This allows microphone testing to work without a backend connection
    {
      std::lock_guard<std::mutex> lock(localChunksMutex_);
      AudioChunkData chunkData;
      chunkData.sequence = chunk.sequenceNumber;
      chunkData.data = chunk.data;
      localChunks_.push_back(std::move(chunkData));
      
      // Limit memory usage by removing old chunks if too many
      while (localChunks_.size() > kMaxLocalChunks) {
        localChunks_.erase(localChunks_.begin());
      }
    }
    
    // Also emit audio chunk event to JavaScript for direct forwarding
    // This ensures audio data flows to the renderer for Socket.IO transmission
    std::lock_guard<std::mutex> lock(callbackMutex_);
    if (audioChunkCb_) {
      audioChunkCb_(chunk.sequenceNumber, chunk.data);
    }
  });

  wsClient_->SetMessageCallback([this](const std::string& message) {
    OnWebSocketMessage(message);
  });

  wsClient_->SetErrorCallback([this](const std::string& error) {
    OnWebSocketError(error);
  });

  wsClient_->SetConnectedCallback([this]() {
    OnWebSocketConnected();
  });

  wsClient_->SetDisconnectedCallback([this]() {
    OnWebSocketDisconnected();
  });

  initialized_.store(true);
  std::cout << "[CentrisAudioCapture] Initialized successfully" << std::endl;
  return true;
}

bool CentrisAudioCapture::Start() {
  if (!initialized_.load()) {
    std::cerr << "[CentrisAudioCapture] Not initialized" << std::endl;
    return false;
  }

  if (running_.load()) {
    return true;
  }

  // Connect WebSocket
  if (!config_.backendUrl.empty()) {
    wsClient_->Connect();
  }

  // Start processing thread
  running_.store(true);
  processingThread_ = std::thread(&CentrisAudioCapture::ProcessingThreadMain, this);

  // Start audio capture
  if (!capture_->Start([this](const int16_t* data, size_t count, uint64_t timestamp) {
    OnAudioData(data, count);
  })) {
    std::cerr << "[CentrisAudioCapture] Failed to start audio capture" << std::endl;
    running_.store(false);
    if (processingThread_.joinable()) {
      processingThread_.join();
    }
    return false;
  }

  std::cout << "[CentrisAudioCapture] Started" << std::endl;
  return true;
}

bool CentrisAudioCapture::Stop() {
  if (!running_.load()) {
    return true;
  }

  running_.store(false);

  // Stop audio capture
  if (capture_) {
    capture_->Stop();
  }

  // Wait for processing thread
  if (processingThread_.joinable()) {
    processingThread_.join();
  }

  // Disconnect WebSocket
  if (wsClient_) {
    wsClient_->Disconnect();
  }

  // Reset components
  if (vad_) vad_->Reset();
  if (processor_) processor_->Reset();
  if (buffer_) buffer_->Reset();

  std::cout << "[CentrisAudioCapture] Stopped" << std::endl;
  return true;
}

void CentrisAudioCapture::Shutdown() {
  Stop();

  if (capture_) {
    capture_->Shutdown();
    capture_.reset();
  }

  buffer_.reset();
  vad_.reset();
  processor_.reset();
  wsClient_.reset();

  initialized_.store(false);
}

AudioStats CentrisAudioCapture::GetStats() const {
  std::lock_guard<std::mutex> lock(statsMutex_);
  return stats_;
}

std::vector<AudioDevice> CentrisAudioCapture::GetInputDevices() {
  return AudioCapture::GetInputDevices();
}

AudioDevice CentrisAudioCapture::GetDefaultInputDevice() {
  return AudioCapture::GetDefaultInputDevice();
}

std::vector<CentrisAudioCapture::AudioChunkData> CentrisAudioCapture::GetQueuedAudioChunks() {
  std::vector<AudioChunkData> result;
  
  // Primary: Get from local queue (always available, used for mic testing)
  {
    std::lock_guard<std::mutex> lock(localChunksMutex_);
    result = std::move(localChunks_);
    localChunks_.clear();
  }
  
  // Also check WebSocket queue if available (for compatibility)
  if (wsClient_ && result.empty()) {
    auto messages = wsClient_->GetQueuedMessages();
    for (auto& msg : messages) {
      // Extract sequence number from first 4 bytes (little-endian)
      if (msg.data.size() >= 4) {
        uint32_t seq = static_cast<uint32_t>(msg.data[0]) |
                       (static_cast<uint32_t>(msg.data[1]) << 8) |
                       (static_cast<uint32_t>(msg.data[2]) << 16) |
                       (static_cast<uint32_t>(msg.data[3]) << 24);
        AudioChunkData chunk;
        chunk.sequence = seq;
        chunk.data.assign(msg.data.begin() + 4, msg.data.end());
        result.push_back(std::move(chunk));
      }
    }
  }
  return result;
}

void CentrisAudioCapture::SetAudioLevelCallback(AudioLevelCallback cb) {
  std::lock_guard<std::mutex> lock(callbackMutex_);
  audioLevelCb_ = cb;
}

void CentrisAudioCapture::SetVoiceStartCallback(VoiceStartCallback cb) {
  std::lock_guard<std::mutex> lock(callbackMutex_);
  voiceStartCb_ = cb;
}

void CentrisAudioCapture::SetVoiceEndCallback(VoiceEndCallback cb) {
  std::lock_guard<std::mutex> lock(callbackMutex_);
  voiceEndCb_ = cb;
}

void CentrisAudioCapture::SetTranscriptCallback(TranscriptCallback cb) {
  std::lock_guard<std::mutex> lock(callbackMutex_);
  transcriptCb_ = cb;
}

void CentrisAudioCapture::SetErrorCallback(ErrorCallback cb) {
  std::lock_guard<std::mutex> lock(callbackMutex_);
  errorCb_ = cb;
}

void CentrisAudioCapture::SetAudioChunkCallback(AudioChunkCallback cb) {
  std::lock_guard<std::mutex> lock(callbackMutex_);
  audioChunkCb_ = cb;
}

// Audio callback (called from OS audio thread - must be lock-free!)
void CentrisAudioCapture::OnAudioData(const int16_t* data, size_t sampleCount) {
  // Write to circular buffer (lock-free)
  size_t written = buffer_->Write(data, sampleCount);
  
  // Track dropped samples
  if (written < sampleCount) {
    std::lock_guard<std::mutex> lock(statsMutex_);
    stats_.droppedSamples += (sampleCount - written);
  }
  
  {
    std::lock_guard<std::mutex> lock(statsMutex_);
    stats_.totalSamples += sampleCount;
  }
}

// Processing thread main loop
void CentrisAudioCapture::ProcessingThreadMain() {
  std::vector<int16_t> readBuffer(config_.sampleRate / 10);  // 100ms buffer
  
  while (running_.load()) {
    // Read from circular buffer
    size_t read = buffer_->Read(readBuffer.data(), readBuffer.size());
    
    if (read == 0) {
      // No data available, sleep briefly
      std::this_thread::sleep_for(std::chrono::milliseconds(5));
      continue;
    }
    
    // Process through VAD
    bool isSpeech = false;
    if (config_.vadEnabled && vad_) {
      isSpeech = vad_->Process(readBuffer.data(), read);
      
      // Emit audio level callback
      float level = vad_->GetSmoothedLevel();
      {
        std::lock_guard<std::mutex> lock(callbackMutex_);
        if (audioLevelCb_) {
          audioLevelCb_(level);
        }
      }
    } else {
      isSpeech = true;  // If VAD disabled, always consider as speech
    }
    
    // ALWAYS process audio through stream processor when capturing
    // The backend's Faster-Whisper has its own VAD and will handle silence detection
    // Previously we only processed when speech was detected, causing audio chunks to be missed
    // VAD is now only used for voice start/end callbacks (UI feedback), not for gating audio
    processor_->Process(readBuffer.data(), read, isSpeech);
  }
}

void CentrisAudioCapture::OnWebSocketMessage(const std::string& message) {
  // Parse JSON message from backend
  // Expected format: {"type": "transcript_partial/final", "text": "...", "confidence": 0.95}
  
  // Simple JSON parsing (for production, use a proper JSON library)
  std::string text;
  bool isFinal = false;
  float confidence = 0.0f;
  
  // Check message type
  if (message.find("\"type\":\"transcript_final\"") != std::string::npos ||
      message.find("\"type\": \"transcript_final\"") != std::string::npos) {
    isFinal = true;
  }
  
  // Extract text (simple extraction)
  size_t textStart = message.find("\"text\":\"");
  if (textStart == std::string::npos) {
    textStart = message.find("\"text\": \"");
  }
  if (textStart != std::string::npos) {
    textStart = message.find("\"", textStart + 7) + 1;
    size_t textEnd = message.find("\"", textStart);
    if (textEnd != std::string::npos) {
      text = message.substr(textStart, textEnd - textStart);
    }
  }
  
  // Extract confidence (simple extraction)
  size_t confStart = message.find("\"confidence\":");
  if (confStart != std::string::npos) {
    confStart += 13;
    while (confStart < message.size() && (message[confStart] == ' ' || message[confStart] == ':')) {
      confStart++;
    }
    size_t confEnd = confStart;
    while (confEnd < message.size() && (isdigit(message[confEnd]) || message[confEnd] == '.')) {
      confEnd++;
    }
    if (confEnd > confStart) {
      confidence = std::stof(message.substr(confStart, confEnd - confStart));
    }
  }
  
  // Emit callback
  if (!text.empty()) {
    std::lock_guard<std::mutex> lock(callbackMutex_);
    if (transcriptCb_) {
      transcriptCb_(text, isFinal, confidence);
    }
  }
}

void CentrisAudioCapture::OnWebSocketError(const std::string& error) {
  std::lock_guard<std::mutex> lock(callbackMutex_);
  if (errorCb_) {
    errorCb_(error);
  }
}

void CentrisAudioCapture::OnWebSocketConnected() {
  std::cout << "[CentrisAudioCapture] WebSocket connected" << std::endl;
}

void CentrisAudioCapture::OnWebSocketDisconnected() {
  std::cout << "[CentrisAudioCapture] WebSocket disconnected" << std::endl;
}

// ============================================================================
// Node.js Addon Implementation
// ============================================================================

Napi::Object CentrisAudioAddon::Init(Napi::Env env, Napi::Object exports) {
  Napi::Function func = DefineClass(env, "CentrisAudio", {
    InstanceMethod("initialize", &CentrisAudioAddon::Initialize),
    InstanceMethod("start", &CentrisAudioAddon::Start),
    InstanceMethod("stop", &CentrisAudioAddon::Stop),
    InstanceMethod("shutdown", &CentrisAudioAddon::Shutdown),
    InstanceMethod("isRunning", &CentrisAudioAddon::IsRunning),
    InstanceMethod("getStats", &CentrisAudioAddon::GetStats),
    InstanceMethod("getQueuedAudioChunks", &CentrisAudioAddon::GetQueuedAudioChunks),
    InstanceMethod("on", &CentrisAudioAddon::On),
    InstanceMethod("off", &CentrisAudioAddon::Off),
    StaticMethod("getInputDevices", &CentrisAudioAddon::GetInputDevices),
    StaticMethod("getDefaultInputDevice", &CentrisAudioAddon::GetDefaultInputDevice),
  });

  Napi::FunctionReference* constructor = new Napi::FunctionReference();
  *constructor = Napi::Persistent(func);
  env.SetInstanceData(constructor);

  exports.Set("CentrisAudio", func);
  return exports;
}

CentrisAudioAddon::CentrisAudioAddon(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<CentrisAudioAddon>(info)
    , env_(info.Env()) {
  capture_ = std::make_unique<CentrisAudioCapture>();
}

CentrisAudioAddon::~CentrisAudioAddon() {
  // Release thread-safe functions
  if (tsfnAudioLevel_) tsfnAudioLevel_.Release();
  if (tsfnVoiceStart_) tsfnVoiceStart_.Release();
  if (tsfnVoiceEnd_) tsfnVoiceEnd_.Release();
  if (tsfnTranscript_) tsfnTranscript_.Release();
  if (tsfnError_) tsfnError_.Release();
  if (tsfnAudioChunk_) tsfnAudioChunk_.Release();
}

Napi::Value CentrisAudioAddon::Initialize(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsObject()) {
    Napi::TypeError::New(env, "Config object expected").ThrowAsJavaScriptException();
    return env.Null();
  }

  Napi::Object config = info[0].As<Napi::Object>();
  AudioConfig audioConfig;

  if (config.Has("deviceId")) {
    audioConfig.deviceId = config.Get("deviceId").As<Napi::String>().Utf8Value();
  }
  if (config.Has("sampleRate")) {
    audioConfig.sampleRate = config.Get("sampleRate").As<Napi::Number>().Int32Value();
  }
  if (config.Has("channels")) {
    audioConfig.channels = config.Get("channels").As<Napi::Number>().Int32Value();
  }
  if (config.Has("vadEnabled")) {
    audioConfig.vadEnabled = config.Get("vadEnabled").As<Napi::Boolean>().Value();
  }
  if (config.Has("vadThreshold")) {
    audioConfig.vadThreshold = config.Get("vadThreshold").As<Napi::Number>().FloatValue();
  }
  if (config.Has("backendUrl")) {
    audioConfig.backendUrl = config.Get("backendUrl").As<Napi::String>().Utf8Value();
  }
  if (config.Has("authToken")) {
    audioConfig.authToken = config.Get("authToken").As<Napi::String>().Utf8Value();
  }

  bool result = capture_->Initialize(audioConfig);
  
  if (result) {
    SetupCallbacks();
  }

  return Napi::Boolean::New(env, result);
}

Napi::Value CentrisAudioAddon::Start(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), capture_->Start());
}

Napi::Value CentrisAudioAddon::Stop(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), capture_->Stop());
}

Napi::Value CentrisAudioAddon::Shutdown(const Napi::CallbackInfo& info) {
  capture_->Shutdown();
  return info.Env().Undefined();
}

Napi::Value CentrisAudioAddon::IsRunning(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), capture_->IsRunning());
}

Napi::Value CentrisAudioAddon::GetStats(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  AudioStats stats = capture_->GetStats();

  Napi::Object result = Napi::Object::New(env);
  result.Set("totalSamples", Napi::Number::New(env, static_cast<double>(stats.totalSamples)));
  result.Set("droppedSamples", Napi::Number::New(env, static_cast<double>(stats.droppedSamples)));
  result.Set("avgLatencyMs", Napi::Number::New(env, stats.avgLatencyMs));
  result.Set("maxLatencyMs", Napi::Number::New(env, stats.maxLatencyMs));
  result.Set("bytesTransmitted", Napi::Number::New(env, static_cast<double>(stats.bytesTransmitted)));
  result.Set("messagesReceived", Napi::Number::New(env, static_cast<double>(stats.messagesReceived)));
  result.Set("avgProcessingMs", Napi::Number::New(env, stats.avgProcessingMs));

  return result;
}

Napi::Value CentrisAudioAddon::GetInputDevices(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto devices = CentrisAudioCapture::GetInputDevices();

  Napi::Array result = Napi::Array::New(env, devices.size());
  for (size_t i = 0; i < devices.size(); i++) {
    Napi::Object device = Napi::Object::New(env);
    device.Set("id", Napi::String::New(env, devices[i].id));
    device.Set("name", Napi::String::New(env, devices[i].name));
    device.Set("isDefault", Napi::Boolean::New(env, devices[i].isDefault));
    device.Set("maxChannels", Napi::Number::New(env, devices[i].maxChannels));
    device.Set("defaultSampleRate", Napi::Number::New(env, devices[i].defaultSampleRate));
    result[i] = device;
  }

  return result;
}

Napi::Value CentrisAudioAddon::GetDefaultInputDevice(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto device = CentrisAudioCapture::GetDefaultInputDevice();

  Napi::Object result = Napi::Object::New(env);
  result.Set("id", Napi::String::New(env, device.id));
  result.Set("name", Napi::String::New(env, device.name));
  result.Set("isDefault", Napi::Boolean::New(env, device.isDefault));
  result.Set("maxChannels", Napi::Number::New(env, device.maxChannels));
  result.Set("defaultSampleRate", Napi::Number::New(env, device.defaultSampleRate));

  return result;
}

Napi::Value CentrisAudioAddon::On(const Napi::CallbackInfo& info) {
  // Event registration is handled in SetupCallbacks
  // This method is a placeholder for future dynamic event registration
  return info.Env().Undefined();
}

Napi::Value CentrisAudioAddon::Off(const Napi::CallbackInfo& info) {
  // Event unregistration
  return info.Env().Undefined();
}

Napi::Value CentrisAudioAddon::GetQueuedAudioChunks(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  
  auto chunks = capture_->GetQueuedAudioChunks();
  Napi::Array result = Napi::Array::New(env, chunks.size());
  
  for (size_t i = 0; i < chunks.size(); i++) {
    Napi::Object chunkObj = Napi::Object::New(env);
    chunkObj.Set("sequence", Napi::Number::New(env, chunks[i].sequence));
    Napi::Buffer<uint8_t> buffer = Napi::Buffer<uint8_t>::Copy(
      env, chunks[i].data.data(), chunks[i].data.size());
    chunkObj.Set("data", buffer);
    result[i] = chunkObj;
  }
  
  return result;
}

void CentrisAudioAddon::SetupCallbacks() {
  // Setup thread-safe functions for callbacks from native threads

  // Audio level callback
  tsfnAudioLevel_ = Napi::ThreadSafeFunction::New(
    env_,
    Napi::Function::New(env_, [](const Napi::CallbackInfo&) {}),
    "AudioLevelCallback",
    0,
    1
  );

  capture_->SetAudioLevelCallback([this](float level) {
    auto callback = [level](Napi::Env env, Napi::Function jsCallback) {
      jsCallback.Call({Napi::Number::New(env, level)});
    };
    tsfnAudioLevel_.NonBlockingCall(callback);
  });

  // Voice start callback
  tsfnVoiceStart_ = Napi::ThreadSafeFunction::New(
    env_,
    Napi::Function::New(env_, [](const Napi::CallbackInfo&) {}),
    "VoiceStartCallback",
    0,
    1
  );

  capture_->SetVoiceStartCallback([this]() {
    auto callback = [](Napi::Env env, Napi::Function jsCallback) {
      jsCallback.Call({});
    };
    tsfnVoiceStart_.NonBlockingCall(callback);
  });

  // Voice end callback
  tsfnVoiceEnd_ = Napi::ThreadSafeFunction::New(
    env_,
    Napi::Function::New(env_, [](const Napi::CallbackInfo&) {}),
    "VoiceEndCallback",
    0,
    1
  );

  capture_->SetVoiceEndCallback([this]() {
    auto callback = [](Napi::Env env, Napi::Function jsCallback) {
      jsCallback.Call({});
    };
    tsfnVoiceEnd_.NonBlockingCall(callback);
  });

  // Transcript callback
  tsfnTranscript_ = Napi::ThreadSafeFunction::New(
    env_,
    Napi::Function::New(env_, [](const Napi::CallbackInfo&) {}),
    "TranscriptCallback",
    0,
    1
  );

  capture_->SetTranscriptCallback([this](const std::string& text, bool isFinal, float confidence) {
    auto callback = [text, isFinal, confidence](Napi::Env env, Napi::Function jsCallback) {
      Napi::Object result = Napi::Object::New(env);
      result.Set("text", Napi::String::New(env, text));
      result.Set("isFinal", Napi::Boolean::New(env, isFinal));
      result.Set("confidence", Napi::Number::New(env, confidence));
      jsCallback.Call({result});
    };
    tsfnTranscript_.NonBlockingCall(callback);
  });

  // Error callback
  tsfnError_ = Napi::ThreadSafeFunction::New(
    env_,
    Napi::Function::New(env_, [](const Napi::CallbackInfo&) {}),
    "ErrorCallback",
    0,
    1
  );

  capture_->SetErrorCallback([this](const std::string& error) {
    auto callback = [error](Napi::Env env, Napi::Function jsCallback) {
      jsCallback.Call({Napi::String::New(env, error)});
    };
    tsfnError_.NonBlockingCall(callback);
  });

  // Audio chunk callback - for forwarding audio data to JavaScript
  tsfnAudioChunk_ = Napi::ThreadSafeFunction::New(
    env_,
    Napi::Function::New(env_, [](const Napi::CallbackInfo&) {}),
    "AudioChunkCallback",
    0,
    1
  );

  capture_->SetAudioChunkCallback([this](uint32_t sequence, const std::vector<uint8_t>& data) {
    // Copy data for the callback (data may be invalidated after this function returns)
    std::vector<uint8_t> dataCopy = data;
    auto callback = [sequence, dataCopy](Napi::Env env, Napi::Function jsCallback) {
      Napi::Object result = Napi::Object::New(env);
      result.Set("sequence", Napi::Number::New(env, sequence));
      // Convert to Buffer for efficient binary data transfer
      Napi::Buffer<uint8_t> buffer = Napi::Buffer<uint8_t>::Copy(env, dataCopy.data(), dataCopy.size());
      result.Set("data", buffer);
      jsCallback.Call({result});
    };
    tsfnAudioChunk_.NonBlockingCall(callback);
  });
}

} // namespace centris

// Module initialization
Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
  return centris::CentrisAudioAddon::Init(env, exports);
}

NODE_API_MODULE(centris_audio, InitAll)
