/**
 * Platform-agnostic Audio Capture Interface
 * 
 * Defines the interface for native audio capture.
 * Platform-specific implementations:
 * - macOS: Core Audio (AudioQueue API)
 * - Windows: WASAPI (IAudioClient)
 * - Linux: PulseAudio
 */

#ifndef CENTRIS_AUDIO_CAPTURE_H
#define CENTRIS_AUDIO_CAPTURE_H

#include <string>
#include <vector>
#include <functional>
#include <cstdint>
#include <memory>

namespace centris {

/**
 * Audio device information
 */
struct AudioDevice {
  std::string id;
  std::string name;
  bool isDefault = false;
  int maxChannels = 0;
  int defaultSampleRate = 0;
};

/**
 * Audio capture configuration
 */
struct AudioConfig {
  std::string deviceId = "default";
  int sampleRate = 16000;        // 16kHz optimal for speech recognition
  int channels = 1;               // Mono
  int bitsPerSample = 16;         // 16-bit PCM
  int bufferSizeMs = 20;          // 20ms buffers (320 samples at 16kHz)
  bool vadEnabled = true;         // Voice Activity Detection
  float vadThreshold = 0.06f;     // VAD sensitivity (0.0 - 1.0) - LOW for whispered speech
  int vadSilenceMs = 500;         // Silence duration to end utterance
  std::string backendUrl;         // WebSocket URL for streaming
  std::string authToken;          // Authentication token
};

/**
 * Audio format specification
 */
struct AudioFormat {
  int sampleRate = 0;      // e.g., 16000, 44100, 48000
  int channels = 0;        // 1 = mono, 2 = stereo
  int bitsPerSample = 0;   // 16 or 32
  bool isFloat = false;    // true for float samples, false for integer
};

/**
 * Abstract audio capture interface
 */
class AudioCapture {
public:
  virtual ~AudioCapture() = default;

  /**
   * Audio data callback type
   * 
   * @param data Pointer to audio samples (int16_t for 16-bit)
   * @param sampleCount Number of samples (not bytes!)
   * @param timestamp Timestamp in microseconds (from audio device)
   * 
   * IMPORTANT: This callback is called from the OS audio thread!
   * - Do NOT allocate memory
   * - Do NOT block
   * - Do NOT call any non-thread-safe functions
   * - Just copy data to a lock-free buffer and return
   */
  using AudioCallback = std::function<void(const int16_t* data, size_t sampleCount, uint64_t timestamp)>;

  /**
   * Initialize the audio capture system
   * 
   * @param config Audio configuration
   * @return true on success
   */
  virtual bool Initialize(const AudioConfig& config) = 0;

  /**
   * Start capturing audio
   * 
   * @param callback Callback function for audio data
   * @return true on success
   */
  virtual bool Start(AudioCallback callback) = 0;

  /**
   * Stop capturing audio
   */
  virtual void Stop() = 0;

  /**
   * Shutdown and release resources
   */
  virtual void Shutdown() = 0;

  /**
   * Check if currently capturing
   */
  virtual bool IsRunning() const = 0;

  /**
   * Get current audio format
   */
  virtual AudioFormat GetFormat() const = 0;

  /**
   * Get actual buffer size in samples
   */
  virtual size_t GetBufferSize() const = 0;

  /**
   * Get latency in milliseconds
   */
  virtual double GetLatencyMs() const = 0;

  /**
   * Set input device
   * 
   * @param deviceId Device ID (empty or "default" for default device)
   * @return true on success
   */
  virtual bool SetDevice(const std::string& deviceId) = 0;

  /**
   * Get list of available input devices
   */
  static std::vector<AudioDevice> GetInputDevices();

  /**
   * Get default input device
   */
  static AudioDevice GetDefaultInputDevice();

  /**
   * Create platform-specific audio capture instance
   */
  static std::unique_ptr<AudioCapture> Create();
};

} // namespace centris

#endif // CENTRIS_AUDIO_CAPTURE_H
