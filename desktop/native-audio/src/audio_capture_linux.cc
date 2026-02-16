/**
 * Linux PulseAudio Audio Capture Implementation
 * 
 * Uses PulseAudio Simple API for audio capture.
 * For lower latency, consider using PulseAudio async API or JACK.
 */

#ifdef CENTRIS_PLATFORM_LINUX

#include "audio_capture.h"
#include <pulse/simple.h>
#include <pulse/error.h>
#include <atomic>
#include <string>
#include <mutex>
#include <thread>
#include <iostream>
#include <cstring>

namespace centris {

/**
 * Linux PulseAudio implementation
 */
class AudioCaptureLinux : public AudioCapture {
public:
  AudioCaptureLinux();
  ~AudioCaptureLinux() override;

  // AudioCapture interface
  bool Initialize(const AudioConfig& config) override;
  bool Start(AudioCallback callback) override;
  void Stop() override;
  void Shutdown() override;
  bool IsRunning() const override;
  AudioFormat GetFormat() const override;
  size_t GetBufferSize() const override;
  double GetLatencyMs() const override;
  bool SetDevice(const std::string& deviceId) override;

  // Static methods for device enumeration
  static std::vector<AudioDevice> GetInputDevices();
  static AudioDevice GetDefaultInputDevice();

private:
  // Capture thread main loop
  void CaptureThreadMain();

  // Audio format
  AudioFormat outputFormat_;
  pa_sample_spec sampleSpec_;

  // PulseAudio
  pa_simple* paStream_ = nullptr;

  // Device
  std::string deviceId_;

  // State
  std::atomic<bool> initialized_{false};
  std::atomic<bool> running_{false};
  AudioCallback callback_;
  std::mutex callbackMutex_;

  // Capture thread
  std::thread captureThread_;

  // Buffer configuration
  size_t bufferSizeSamples_ = 0;
  int bufferSizeMs_ = 20;
  double latencyMs_ = 0.0;
};

AudioCaptureLinux::AudioCaptureLinux() = default;

AudioCaptureLinux::~AudioCaptureLinux() {
  Shutdown();
}

bool AudioCaptureLinux::Initialize(const AudioConfig& config) {
  if (initialized_.load()) {
    return true;
  }

  deviceId_ = config.deviceId;
  bufferSizeMs_ = config.bufferSizeMs;

  // Setup sample spec
  sampleSpec_.format = PA_SAMPLE_S16LE;  // 16-bit signed little-endian
  sampleSpec_.rate = static_cast<uint32_t>(config.sampleRate);
  sampleSpec_.channels = static_cast<uint8_t>(config.channels);

  // Store output format
  outputFormat_.sampleRate = config.sampleRate;
  outputFormat_.channels = config.channels;
  outputFormat_.bitsPerSample = 16;
  outputFormat_.isFloat = false;

  // Calculate buffer size
  bufferSizeSamples_ = (config.sampleRate * bufferSizeMs_) / 1000;

  // Create PulseAudio stream
  int error;
  const char* device = (deviceId_.empty() || deviceId_ == "default") ? nullptr : deviceId_.c_str();

  pa_buffer_attr bufferAttr;
  bufferAttr.maxlength = static_cast<uint32_t>(-1);
  bufferAttr.tlength = static_cast<uint32_t>(-1);
  bufferAttr.prebuf = static_cast<uint32_t>(-1);
  bufferAttr.minreq = static_cast<uint32_t>(-1);
  bufferAttr.fragsize = static_cast<uint32_t>(bufferSizeSamples_ * sizeof(int16_t));

  paStream_ = pa_simple_new(
    nullptr,           // Use default server
    "Centris AI",      // Application name
    PA_STREAM_RECORD,  // Stream direction
    device,            // Device (nullptr = default)
    "Voice Capture",   // Stream description
    &sampleSpec_,      // Sample format
    nullptr,           // Channel map (default)
    &bufferAttr,       // Buffer attributes
    &error             // Error code
  );

  if (paStream_ == nullptr) {
    std::cerr << "[AudioCaptureLinux] Failed to create PulseAudio stream: " 
              << pa_strerror(error) << std::endl;
    return false;
  }

  // Calculate latency
  latencyMs_ = static_cast<double>(bufferSizeMs_);

  initialized_.store(true);
  std::cout << "[AudioCaptureLinux] Initialized: " << config.sampleRate << "Hz, "
            << config.channels << "ch, " << bufferSizeMs_ << "ms buffers" << std::endl;

  return true;
}

bool AudioCaptureLinux::Start(AudioCallback callback) {
  if (!initialized_.load()) {
    std::cerr << "[AudioCaptureLinux] Not initialized" << std::endl;
    return false;
  }

  if (running_.load()) {
    return true;
  }

  {
    std::lock_guard<std::mutex> lock(callbackMutex_);
    callback_ = callback;
  }

  running_.store(true);

  // Start capture thread
  captureThread_ = std::thread(&AudioCaptureLinux::CaptureThreadMain, this);

  std::cout << "[AudioCaptureLinux] Started capturing audio" << std::endl;
  return true;
}

void AudioCaptureLinux::Stop() {
  if (!running_.load()) {
    return;
  }

  running_.store(false);

  // Wait for capture thread
  if (captureThread_.joinable()) {
    captureThread_.join();
  }

  {
    std::lock_guard<std::mutex> lock(callbackMutex_);
    callback_ = nullptr;
  }

  std::cout << "[AudioCaptureLinux] Stopped capturing audio" << std::endl;
}

void AudioCaptureLinux::Shutdown() {
  Stop();

  if (paStream_ != nullptr) {
    pa_simple_free(paStream_);
    paStream_ = nullptr;
  }

  initialized_.store(false);
}

bool AudioCaptureLinux::IsRunning() const {
  return running_.load();
}

AudioFormat AudioCaptureLinux::GetFormat() const {
  return outputFormat_;
}

size_t AudioCaptureLinux::GetBufferSize() const {
  return bufferSizeSamples_;
}

double AudioCaptureLinux::GetLatencyMs() const {
  return latencyMs_;
}

bool AudioCaptureLinux::SetDevice(const std::string& deviceId) {
  if (running_.load()) {
    std::cerr << "[AudioCaptureLinux] Cannot change device while running" << std::endl;
    return false;
  }

  deviceId_ = deviceId;
  return true;
}

void AudioCaptureLinux::CaptureThreadMain() {
  // Allocate read buffer
  std::vector<int16_t> buffer(bufferSizeSamples_);
  int error;

  while (running_.load()) {
    // Read audio data
    int bytesRead = pa_simple_read(
      paStream_,
      buffer.data(),
      buffer.size() * sizeof(int16_t),
      &error
    );

    if (bytesRead < 0) {
      std::cerr << "[AudioCaptureLinux] Read error: " << pa_strerror(error) << std::endl;
      continue;
    }

    // Call callback
    std::lock_guard<std::mutex> lock(callbackMutex_);
    if (callback_) {
      callback_(buffer.data(), bufferSizeSamples_, 0);
    }
  }
}

// Static methods for device enumeration
std::vector<AudioDevice> AudioCaptureLinux::GetInputDevices() {
  std::vector<AudioDevice> devices;

  // PulseAudio simple API doesn't support device enumeration
  // Return a default device entry
  AudioDevice defaultDevice;
  defaultDevice.id = "default";
  defaultDevice.name = "Default Input Device";
  defaultDevice.isDefault = true;
  defaultDevice.maxChannels = 2;
  defaultDevice.defaultSampleRate = 44100;

  devices.push_back(defaultDevice);

  return devices;
}

AudioDevice AudioCaptureLinux::GetDefaultInputDevice() {
  AudioDevice device;
  device.id = "default";
  device.name = "Default Input Device";
  device.isDefault = true;
  device.maxChannels = 2;
  device.defaultSampleRate = 44100;
  return device;
}

// Factory function
std::unique_ptr<AudioCapture> AudioCapture::Create() {
  return std::make_unique<AudioCaptureLinux>();
}

std::vector<AudioDevice> AudioCapture::GetInputDevices() {
  return AudioCaptureLinux::GetInputDevices();
}

AudioDevice AudioCapture::GetDefaultInputDevice() {
  return AudioCaptureLinux::GetDefaultInputDevice();
}

} // namespace centris

#endif // CENTRIS_PLATFORM_LINUX
