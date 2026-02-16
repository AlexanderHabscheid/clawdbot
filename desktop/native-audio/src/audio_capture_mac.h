/**
 * macOS Core Audio Implementation
 * 
 * Uses AudioQueue API for low-latency audio capture.
 * AudioQueue is chosen over AudioUnit because:
 * - Simpler API
 * - Good latency (10-20ms)
 * - Automatic format conversion
 * - Works well with modern macOS
 */

#ifndef CENTRIS_AUDIO_CAPTURE_MAC_H
#define CENTRIS_AUDIO_CAPTURE_MAC_H

#ifdef CENTRIS_PLATFORM_MAC

#include "audio_capture.h"
#include <AudioToolbox/AudioToolbox.h>
#include <CoreAudio/CoreAudio.h>
#include <atomic>
#include <string>
#include <mutex>

namespace centris {

/**
 * macOS Core Audio implementation using AudioQueue
 */
class AudioCaptureMac : public AudioCapture {
public:
  AudioCaptureMac();
  ~AudioCaptureMac() override;

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
  // AudioQueue callback (static to match C callback signature)
  static void AudioQueueCallback(
    void* userData,
    AudioQueueRef queue,
    AudioQueueBufferRef buffer,
    const AudioTimeStamp* startTime,
    UInt32 numPackets,
    const AudioStreamPacketDescription* packetDesc
  );

  // Internal callback handler
  void HandleAudioData(AudioQueueBufferRef buffer, const AudioTimeStamp* startTime);

  // Setup helpers
  bool SetupAudioQueue();
  bool AllocateBuffers();
  void CleanupBuffers();
  AudioDeviceID GetDeviceIDFromString(const std::string& deviceId);
  CFStringRef GetDeviceUIDFromAudioDeviceID(AudioDeviceID deviceId);

  // Audio format
  AudioStreamBasicDescription format_;
  AudioFormat outputFormat_;

  // AudioQueue resources
  AudioQueueRef queue_;
  static constexpr int kNumBuffers = 3;  // Triple buffering for smooth capture
  AudioQueueBufferRef buffers_[kNumBuffers];
  
  // Device
  std::string deviceId_;
  AudioDeviceID deviceObjectId_;
  CFStringRef deviceUID_;  // Device UID for AudioQueue (must be CFStringRef, not AudioDeviceID)

  // State
  std::atomic<bool> initialized_{false};
  std::atomic<bool> running_{false};
  AudioCallback callback_;
  std::mutex callbackMutex_;

  // Buffer configuration
  int bufferSizeMs_;
  size_t bufferSizeSamples_;
  size_t bufferSizeBytes_;

  // Timing
  uint64_t hostTimeBase_;
  double latencyMs_;
};

} // namespace centris

#endif // CENTRIS_PLATFORM_MAC

#endif // CENTRIS_AUDIO_CAPTURE_MAC_H
