# Centris Native Audio Module Architecture

## Overview

This native audio module provides Wispr Flow-level performance (<700ms end-to-end latency) by:

- Using native Core Audio (macOS) / WASAPI (Windows) instead of MediaRecorder
- Pre-allocated circular buffers to avoid GC pauses
- Direct WebSocket connection to backend for streaming transcription
- Real-time VAD (Voice Activity Detection) to minimize data transfer
- Zero-copy audio streaming where possible

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Electron Renderer (UI)                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │   React     │  │  Waveform   │  │  Status     │  │  Transcript │        │
│  │   App       │  │  Visualizer │  │  Indicator  │  │  Display    │        │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │
│         │                │                │                │                │
│         └────────────────┴────────────────┴────────────────┘                │
│                                    │                                        │
│                           IPC (contextBridge)                               │
└────────────────────────────────────┼────────────────────────────────────────┘
                                     │
┌────────────────────────────────────┼────────────────────────────────────────┐
│                           Electron Main Process                             │
│                                    │                                        │
│  ┌─────────────────────────────────┴─────────────────────────────────────┐  │
│  │                    NativeAudioBridge (JavaScript)                      │  │
│  │  - Manages native module lifecycle                                     │  │
│  │  - Handles IPC from renderer                                           │  │
│  │  - Emits events to renderer                                            │  │
│  └─────────────────────────────────┬─────────────────────────────────────┘  │
│                                    │                                        │
│                           Node.js Addon API                                 │
│                                    │                                        │
└────────────────────────────────────┼────────────────────────────────────────┘
                                     │
┌────────────────────────────────────┼────────────────────────────────────────┐
│                     Native Audio Module (C++)                               │
│                                    │                                        │
│  ┌─────────────────────────────────┴─────────────────────────────────────┐  │
│  │                      CentrisAudioCapture                               │  │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐        │  │
│  │  │  AudioCapture   │  │  CircularBuffer │  │  VADProcessor   │        │  │
│  │  │  (Platform)     │──│  (Pre-allocated)│──│  (WebRTC VAD)   │        │  │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘        │  │
│  │           │                                          │                  │  │
│  │           │                                          │                  │  │
│  │  ┌────────┴────────┐                      ┌──────────┴──────────┐      │  │
│  │  │  macOS:         │                      │  StreamProcessor     │      │  │
│  │  │  Core Audio     │                      │  - Resampling        │      │  │
│  │  │  AudioQueue     │                      │  - Format Conversion │      │  │
│  │  ├─────────────────┤                      │  - Chunking          │      │  │
│  │  │  Windows:       │                      └──────────┬──────────┘      │  │
│  │  │  WASAPI         │                                 │                  │  │
│  │  │  IAudioClient   │                                 │                  │  │
│  │  └─────────────────┘                                 │                  │  │
│  │                                                      │                  │  │
│  │  ┌───────────────────────────────────────────────────┴───────────────┐  │  │
│  │  │                    WebSocketClient (Native)                        │  │  │
│  │  │  - Direct connection to Centris backend                            │  │  │
│  │  │  - Binary audio streaming (Opus/PCM)                               │  │  │
│  │  │  - Streaming transcription responses                               │  │  │
│  │  │  - Heartbeat/reconnection                                          │  │  │
│  │  └───────────────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     │ WebSocket (wss://)
                                     │ Binary Audio Stream
                                     │
┌────────────────────────────────────┼────────────────────────────────────────┐
│                        Centris Backend (Python)                             │
│                                    │                                        │
│  ┌─────────────────────────────────┴─────────────────────────────────────┐  │
│  │                    StreamingTranscriptionService                       │  │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐        │  │
│  │  │  AudioDecoder   │──│  Whisper/       │──│  TextProcessor  │        │  │
│  │  │  (Opus→PCM)     │  │  Faster-Whisper │  │  (LLM Cleanup)  │        │  │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘        │  │
│  │                                                      │                  │  │
│  │                                           ┌──────────┴──────────┐      │  │
│  │                                           │  ResponseStreamer   │      │  │
│  │                                           │  - Partial results  │      │  │
│  │                                           │  - Final transcript │      │  │
│  │                                           └─────────────────────┘      │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Latency Breakdown Target

| Stage                     | Target Latency | Current (Electron) |
| ------------------------- | -------------- | ------------------ |
| Audio capture → Buffer    | <5ms           | ~20-50ms           |
| VAD detection             | <10ms          | N/A                |
| Network transmission      | <50ms          | ~100ms             |
| Transcription (streaming) | <300ms         | ~500-1000ms        |
| LLM cleanup               | <200ms         | ~300ms             |
| Text paste                | <50ms          | ~100ms             |
| **Total**                 | **<615ms**     | **~1500-2000ms**   |

## Module Structure

```
native-audio/
├── ARCHITECTURE.md          # This file
├── binding.gyp              # Node.js native module build config
├── package.json             # Native module package
├── src/
│   ├── centris_audio.cc     # Main Node.js addon entry point
│   ├── centris_audio.h      # Main header
│   ├── audio_capture.h      # Platform-agnostic audio capture interface
│   ├── audio_capture_mac.cc # macOS Core Audio implementation
│   ├── audio_capture_mac.h
│   ├── audio_capture_win.cc # Windows WASAPI implementation
│   ├── audio_capture_win.h
│   ├── circular_buffer.h    # Lock-free circular buffer
│   ├── circular_buffer.cc
│   ├── vad_processor.h      # Voice Activity Detection
│   ├── vad_processor.cc
│   ├── stream_processor.h   # Audio processing pipeline
│   ├── stream_processor.cc
│   ├── websocket_client.h   # Native WebSocket client
│   └── websocket_client.cc
├── lib/
│   └── index.js             # JavaScript wrapper
└── test/
    └── test.js              # Unit tests
```

## Key Design Decisions

### 1. Pre-allocated Circular Buffers

- Avoid malloc/free during audio callback (causes glitches)
- Use lock-free ring buffer for audio thread → processing thread
- Size: 16KB (1 second of 16kHz 16-bit audio)

### 2. Voice Activity Detection (VAD)

- Use WebRTC VAD or Silero VAD
- Only send audio when speech detected
- Reduces bandwidth and backend load
- Configurable sensitivity

### 3. Streaming Protocol

- WebSocket with binary frames
- Audio format: Opus 16kHz mono (or raw PCM fallback)
- Message types:
  - `AUDIO_START`: Begin streaming
  - `AUDIO_DATA`: Binary audio chunk
  - `AUDIO_END`: End of utterance
  - `TRANSCRIPT_PARTIAL`: Interim result
  - `TRANSCRIPT_FINAL`: Final transcript

### 4. Thread Model

```
┌─────────────────┐
│  Audio Thread   │  ← Real-time priority, no allocations
│  (OS callback)  │
└────────┬────────┘
         │ Lock-free buffer
         ▼
┌─────────────────┐
│ Processing      │  ← Normal priority
│ Thread          │  ← VAD, resampling, encoding
└────────┬────────┘
         │ Thread-safe queue
         ▼
┌─────────────────┐
│ Network Thread  │  ← WebSocket I/O
│ (libuv/io)      │
└─────────────────┘
```

## API Design

### JavaScript API (Renderer)

```javascript
// In renderer process (via IPC)
const { nativeAudio } = window.electronAPI;

// Start recording
await nativeAudio.startCapture({
  deviceId: "default",
  sampleRate: 16000,
  channels: 1,
  vadEnabled: true,
  vadThreshold: 0.5,
  backendUrl: "wss://api.centris.ai/v1/stream",
});

// Listen for events
nativeAudio.onAudioLevel((level) => {
  // Real-time audio level (0-100)
  updateWaveform(level);
});

nativeAudio.onVoiceStart(() => {
  // Voice detected
  showRecordingIndicator();
});

nativeAudio.onVoiceEnd(() => {
  // Voice ended
});

nativeAudio.onTranscriptPartial((text) => {
  // Interim transcript
  showPartialTranscript(text);
});

nativeAudio.onTranscriptFinal((result) => {
  // Final transcript
  handleTranscript(result.text, result.confidence);
});

// Stop recording
await nativeAudio.stopCapture();

// Get available devices
const devices = await nativeAudio.getInputDevices();
```

### C++ Native API

```cpp
// centris_audio.h
class CentrisAudioCapture {
public:
  // Configuration
  struct Config {
    std::string deviceId = "default";
    int sampleRate = 16000;
    int channels = 1;
    bool vadEnabled = true;
    float vadThreshold = 0.5f;
    std::string backendUrl;
    std::string authToken;
  };

  // Lifecycle
  bool Initialize(const Config& config);
  bool Start();
  bool Stop();
  void Shutdown();

  // Callbacks (called from processing thread)
  using AudioLevelCallback = std::function<void(float level)>;
  using VoiceStartCallback = std::function<void()>;
  using VoiceEndCallback = std::function<void()>;
  using TranscriptCallback = std::function<void(const std::string& text, bool isFinal, float confidence)>;
  using ErrorCallback = std::function<void(const std::string& error)>;

  void SetAudioLevelCallback(AudioLevelCallback cb);
  void SetVoiceStartCallback(VoiceStartCallback cb);
  void SetVoiceEndCallback(VoiceEndCallback cb);
  void SetTranscriptCallback(TranscriptCallback cb);
  void SetErrorCallback(ErrorCallback cb);

  // Device enumeration
  static std::vector<AudioDevice> GetInputDevices();

private:
  std::unique_ptr<AudioCapture> capture_;
  std::unique_ptr<CircularBuffer> buffer_;
  std::unique_ptr<VADProcessor> vad_;
  std::unique_ptr<StreamProcessor> processor_;
  std::unique_ptr<WebSocketClient> ws_;
  std::thread processingThread_;
  std::atomic<bool> running_{false};
};
```

## Backend Streaming Protocol

### WebSocket Connection

```
wss://api.centris.ai/v1/audio/stream
Headers:
  Authorization: Bearer <token>
  X-Client-Id: <device-id>
  X-Audio-Format: opus/16000/1 | pcm/16000/1
```

### Message Format (JSON + Binary)

```javascript
// Control messages (JSON)
{
  "type": "audio_start",
  "timestamp": 1234567890,
  "format": "opus/16000/1",
  "vad_enabled": true
}

{
  "type": "audio_end",
  "timestamp": 1234567890,
  "duration_ms": 2500
}

// Audio data (Binary)
// First 4 bytes: sequence number (uint32)
// Rest: Opus-encoded audio data

// Response messages (JSON)
{
  "type": "transcript_partial",
  "text": "hello wor",
  "timestamp": 1234567890
}

{
  "type": "transcript_final",
  "text": "Hello world",
  "confidence": 0.95,
  "duration_ms": 1200,
  "processing_ms": 450
}
```

## Build Requirements

### macOS

- Xcode Command Line Tools
- Frameworks: CoreAudio, AudioToolbox, Security

### Windows

- Visual Studio 2019+ with C++ workload
- Windows SDK

### Cross-platform Dependencies

- libwebsockets (WebSocket client)
- opus (audio encoding)
- webrtc-audio-processing (VAD) or silero-vad

## Performance Optimizations

1. **Lock-free data structures**: No mutexes in audio callback
2. **Memory pooling**: Pre-allocate all buffers at startup
3. **SIMD processing**: Use AVX/NEON for audio processing
4. **Connection pooling**: Keep WebSocket connection alive
5. **Opus encoding**: Low-latency mode (10ms frames)
6. **Adaptive bitrate**: Adjust quality based on network conditions

## Migration Path

1. **Phase 1**: Implement native audio capture (Core Audio/WASAPI)
2. **Phase 2**: Add VAD and circular buffer
3. **Phase 3**: Implement WebSocket streaming
4. **Phase 4**: Integrate with existing Electron UI
5. **Phase 5**: Backend streaming transcription
6. **Phase 6**: Performance tuning and edge cases

## Testing Strategy

1. **Unit tests**: C++ components (buffer, VAD, processor)
2. **Integration tests**: Full pipeline with mock backend
3. **Latency benchmarks**: Measure each stage
4. **Platform tests**: macOS (Intel/ARM), Windows (10/11)
5. **Device tests**: Various microphones, sample rates
