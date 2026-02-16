/**
 * macOS Core Audio Implementation
 */

#ifdef CENTRIS_PLATFORM_MAC

#include "audio_capture_mac.h"
#include <mach/mach_time.h>
#include <iostream>

namespace centris {

AudioCaptureMac::AudioCaptureMac()
    : queue_(nullptr)
    , deviceObjectId_(kAudioObjectUnknown)
    , deviceUID_(nullptr)
    , bufferSizeMs_(20)
    , bufferSizeSamples_(0)
    , bufferSizeBytes_(0)
    , hostTimeBase_(0)
    , latencyMs_(0.0) {
  
  // Initialize buffer pointers
  for (int i = 0; i < kNumBuffers; i++) {
    buffers_[i] = nullptr;
  }
  
  // Get host time base for accurate timing
  mach_timebase_info_data_t timebase;
  mach_timebase_info(&timebase);
  hostTimeBase_ = (uint64_t)timebase.numer / timebase.denom;
}

AudioCaptureMac::~AudioCaptureMac() {
  Shutdown();
}

bool AudioCaptureMac::Initialize(const AudioConfig& config) {
  if (initialized_.load()) {
    return true;
  }

  // Store configuration
  deviceId_ = config.deviceId;
  bufferSizeMs_ = config.bufferSizeMs;

  // Setup audio format (16kHz, mono, 16-bit signed integer)
  format_.mSampleRate = static_cast<Float64>(config.sampleRate);
  format_.mFormatID = kAudioFormatLinearPCM;
  format_.mFormatFlags = kLinearPCMFormatFlagIsSignedInteger | kLinearPCMFormatFlagIsPacked;
  format_.mBitsPerChannel = static_cast<UInt32>(config.bitsPerSample);
  format_.mChannelsPerFrame = static_cast<UInt32>(config.channels);
  format_.mBytesPerFrame = format_.mChannelsPerFrame * (format_.mBitsPerChannel / 8);
  format_.mFramesPerPacket = 1;
  format_.mBytesPerPacket = format_.mBytesPerFrame * format_.mFramesPerPacket;
  format_.mReserved = 0;

  // Store output format
  outputFormat_.sampleRate = config.sampleRate;
  outputFormat_.channels = config.channels;
  outputFormat_.bitsPerSample = config.bitsPerSample;
  outputFormat_.isFloat = false;

  // Calculate buffer sizes
  bufferSizeSamples_ = (config.sampleRate * bufferSizeMs_) / 1000;
  bufferSizeBytes_ = bufferSizeSamples_ * format_.mBytesPerFrame;

  // Get device ID and UID
  // CRITICAL: AudioQueue's kAudioQueueProperty_CurrentDevice expects a CFStringRef UID,
  // NOT an AudioDeviceID. Error -66683 occurs if you pass the wrong type.
  if (!deviceId_.empty() && deviceId_ != "default") {
    deviceObjectId_ = GetDeviceIDFromString(deviceId_);
    if (deviceObjectId_ == kAudioObjectUnknown) {
      std::cerr << "[AudioCaptureMac] Invalid device ID: " << deviceId_ << std::endl;
      return false;
    }
    
    // Get the device UID (CFStringRef) from the AudioDeviceID
    deviceUID_ = GetDeviceUIDFromAudioDeviceID(deviceObjectId_);
    if (deviceUID_ == nullptr) {
      std::cerr << "[AudioCaptureMac] Could not get device UID for device: " << deviceId_ << std::endl;
      // Continue with default device rather than failing
      deviceObjectId_ = kAudioObjectUnknown;
    } else {
      // Log the UID for debugging
      char uidBuf[256];
      if (CFStringGetCString(deviceUID_, uidBuf, sizeof(uidBuf), kCFStringEncodingUTF8)) {
        std::cout << "[AudioCaptureMac] Using device UID: " << uidBuf << std::endl;
      }
    }
  }

  // Setup AudioQueue
  if (!SetupAudioQueue()) {
    std::cerr << "[AudioCaptureMac] Failed to setup AudioQueue" << std::endl;
    return false;
  }

  // Allocate buffers
  if (!AllocateBuffers()) {
    std::cerr << "[AudioCaptureMac] Failed to allocate buffers" << std::endl;
    AudioQueueDispose(queue_, true);
    queue_ = nullptr;
    return false;
  }

  initialized_.store(true);
  std::cout << "[AudioCaptureMac] Initialized: " << config.sampleRate << "Hz, "
            << config.channels << "ch, " << config.bitsPerSample << "bit, "
            << bufferSizeMs_ << "ms buffers" << std::endl;
  
  return true;
}

bool AudioCaptureMac::SetupAudioQueue() {
  // Create input AudioQueue
  OSStatus status = AudioQueueNewInput(
    &format_,
    AudioQueueCallback,
    this,  // userData
    nullptr,  // run loop (nullptr = use internal thread)
    nullptr,  // run loop mode
    0,  // flags
    &queue_
  );

  if (status != noErr) {
    std::cerr << "[AudioCaptureMac] AudioQueueNewInput failed: " << status << std::endl;
    return false;
  }

  // Set device if specified
  // CRITICAL: Must use CFStringRef UID, not AudioDeviceID
  // kAudioQueueProperty_CurrentDevice expects a CFStringRef containing the device UID
  if (deviceUID_ != nullptr) {
    status = AudioQueueSetProperty(
      queue_,
      kAudioQueueProperty_CurrentDevice,
      &deviceUID_,
      sizeof(deviceUID_)
    );
    if (status != noErr) {
      std::cerr << "[AudioCaptureMac] Failed to set device with UID: " << status << std::endl;
      // Continue with default device
    } else {
      std::cout << "[AudioCaptureMac] Successfully set audio device" << std::endl;
    }
  } else if (deviceObjectId_ != kAudioObjectUnknown) {
    // Fallback: Log warning that we couldn't set specific device
    std::cerr << "[AudioCaptureMac] Warning: deviceUID_ is null but deviceObjectId_ is set. Using default device." << std::endl;
  }

  // Enable level metering for audio level callbacks
  UInt32 enableMetering = 1;
  AudioQueueSetProperty(
    queue_,
    kAudioQueueProperty_EnableLevelMetering,
    &enableMetering,
    sizeof(enableMetering)
  );

  return true;
}

bool AudioCaptureMac::AllocateBuffers() {
  for (int i = 0; i < kNumBuffers; i++) {
    OSStatus status = AudioQueueAllocateBuffer(
      queue_,
      static_cast<UInt32>(bufferSizeBytes_),
      &buffers_[i]
    );

    if (status != noErr) {
      std::cerr << "[AudioCaptureMac] AudioQueueAllocateBuffer failed: " << status << std::endl;
      CleanupBuffers();
      return false;
    }
  }
  return true;
}

void AudioCaptureMac::CleanupBuffers() {
  for (int i = 0; i < kNumBuffers; i++) {
    if (buffers_[i] != nullptr) {
      AudioQueueFreeBuffer(queue_, buffers_[i]);
      buffers_[i] = nullptr;
    }
  }
}

bool AudioCaptureMac::Start(AudioCallback callback) {
  if (!initialized_.load()) {
    std::cerr << "[AudioCaptureMac] Not initialized" << std::endl;
    return false;
  }

  if (running_.load()) {
    return true;  // Already running
  }

  {
    std::lock_guard<std::mutex> lock(callbackMutex_);
    callback_ = callback;
  }

  // Enqueue all buffers to start capture
  for (int i = 0; i < kNumBuffers; i++) {
    OSStatus status = AudioQueueEnqueueBuffer(queue_, buffers_[i], 0, nullptr);
    if (status != noErr) {
      std::cerr << "[AudioCaptureMac] AudioQueueEnqueueBuffer failed: " << status << std::endl;
      return false;
    }
  }

  // Start the queue
  OSStatus status = AudioQueueStart(queue_, nullptr);
  if (status != noErr) {
    std::cerr << "[AudioCaptureMac] AudioQueueStart failed: " << status << std::endl;
    return false;
  }

  running_.store(true);
  std::cout << "[AudioCaptureMac] Started capturing audio" << std::endl;
  return true;
}

void AudioCaptureMac::Stop() {
  if (!running_.load()) {
    return;
  }

  running_.store(false);

  if (queue_ != nullptr) {
    // Stop immediately (false = stop after current buffer)
    AudioQueueStop(queue_, true);
  }

  {
    std::lock_guard<std::mutex> lock(callbackMutex_);
    callback_ = nullptr;
  }

  std::cout << "[AudioCaptureMac] Stopped capturing audio" << std::endl;
}

void AudioCaptureMac::Shutdown() {
  Stop();

  if (queue_ != nullptr) {
    CleanupBuffers();
    AudioQueueDispose(queue_, true);
    queue_ = nullptr;
  }

  // Clean up device UID
  if (deviceUID_ != nullptr) {
    CFRelease(deviceUID_);
    deviceUID_ = nullptr;
  }

  initialized_.store(false);
}

bool AudioCaptureMac::IsRunning() const {
  return running_.load();
}

AudioFormat AudioCaptureMac::GetFormat() const {
  return outputFormat_;
}

size_t AudioCaptureMac::GetBufferSize() const {
  return bufferSizeSamples_;
}

double AudioCaptureMac::GetLatencyMs() const {
  return latencyMs_;
}

bool AudioCaptureMac::SetDevice(const std::string& deviceId) {
  if (running_.load()) {
    std::cerr << "[AudioCaptureMac] Cannot change device while running" << std::endl;
    return false;
  }

  // Clean up previous device UID
  if (deviceUID_ != nullptr) {
    CFRelease(deviceUID_);
    deviceUID_ = nullptr;
  }

  deviceId_ = deviceId;
  
  if (!deviceId.empty() && deviceId != "default") {
    deviceObjectId_ = GetDeviceIDFromString(deviceId);
    if (deviceObjectId_ == kAudioObjectUnknown) {
      return false;
    }
    
    // Get the device UID for AudioQueue
    deviceUID_ = GetDeviceUIDFromAudioDeviceID(deviceObjectId_);
    if (deviceUID_ == nullptr) {
      std::cerr << "[AudioCaptureMac] Warning: Could not get UID for device " << deviceId << std::endl;
      // Don't fail - we'll use default device
    }
  } else {
    deviceObjectId_ = kAudioObjectUnknown;  // Use default
    deviceUID_ = nullptr;
  }

  return true;
}

AudioDeviceID AudioCaptureMac::GetDeviceIDFromString(const std::string& deviceId) {
  // Try to parse as numeric ID
  try {
    return static_cast<AudioDeviceID>(std::stoul(deviceId));
  } catch (...) {
    // Not a numeric ID, search by name
    auto devices = GetInputDevices();
    for (const auto& device : devices) {
      if (device.id == deviceId || device.name == deviceId) {
        return static_cast<AudioDeviceID>(std::stoul(device.id));
      }
    }
    return kAudioObjectUnknown;
  }
}

CFStringRef AudioCaptureMac::GetDeviceUIDFromAudioDeviceID(AudioDeviceID deviceId) {
  // Get the device UID (unique identifier string) from the AudioDeviceID
  // This UID is what kAudioQueueProperty_CurrentDevice expects
  AudioObjectPropertyAddress propertyAddress = {
    kAudioDevicePropertyDeviceUID,
    kAudioObjectPropertyScopeGlobal,
    kAudioObjectPropertyElementMain
  };

  CFStringRef deviceUID = nullptr;
  UInt32 dataSize = sizeof(deviceUID);

  OSStatus status = AudioObjectGetPropertyData(
    deviceId,
    &propertyAddress,
    0,
    nullptr,
    &dataSize,
    &deviceUID
  );

  if (status != noErr) {
    std::cerr << "[AudioCaptureMac] Failed to get device UID: " << status << std::endl;
    return nullptr;
  }

  return deviceUID;  // Caller owns this reference and must CFRelease it
}

// Static AudioQueue callback
void AudioCaptureMac::AudioQueueCallback(
    void* userData,
    AudioQueueRef queue,
    AudioQueueBufferRef buffer,
    const AudioTimeStamp* startTime,
    UInt32 numPackets,
    const AudioStreamPacketDescription* packetDesc) {
  
  auto* self = static_cast<AudioCaptureMac*>(userData);
  if (self != nullptr) {
    self->HandleAudioData(buffer, startTime);
  }

  // Re-enqueue buffer for continuous capture
  if (self != nullptr && self->running_.load()) {
    AudioQueueEnqueueBuffer(queue, buffer, 0, nullptr);
  }
}

void AudioCaptureMac::HandleAudioData(AudioQueueBufferRef buffer, const AudioTimeStamp* startTime) {
  if (!running_.load() || buffer->mAudioDataByteSize == 0) {
    return;
  }

  // Calculate timestamp in microseconds
  uint64_t timestamp = 0;
  if (startTime != nullptr && (startTime->mFlags & kAudioTimeStampHostTimeValid)) {
    timestamp = (startTime->mHostTime * hostTimeBase_) / 1000;  // Convert to microseconds
  }

  // Calculate number of samples
  size_t sampleCount = buffer->mAudioDataByteSize / format_.mBytesPerFrame;
  
  // DEBUG: Calculate RMS to verify audio is not silent
  const int16_t* samples = reinterpret_cast<const int16_t*>(buffer->mAudioData);
  double sumSquares = 0;
  for (size_t i = 0; i < sampleCount; i++) {
    double sample = samples[i] / 32768.0;
    sumSquares += sample * sample;
  }
  double rms = std::sqrt(sumSquares / sampleCount);
  
  // Log every 50th buffer to avoid spam
  static int bufferCount = 0;
  if (++bufferCount % 50 == 1) {
    std::cout << "[AudioCaptureMac] Buffer #" << bufferCount 
              << ": " << sampleCount << " samples, RMS=" << rms 
              << ", bytes=" << buffer->mAudioDataByteSize << std::endl;
  }

  // Call the callback (on audio thread!)
  std::lock_guard<std::mutex> lock(callbackMutex_);
  if (callback_) {
    callback_(
      samples,
      sampleCount,
      timestamp
    );
  }
}

// Static methods for device enumeration
std::vector<AudioDevice> AudioCaptureMac::GetInputDevices() {
  std::vector<AudioDevice> devices;

  // Get number of audio devices
  AudioObjectPropertyAddress propertyAddress = {
    kAudioHardwarePropertyDevices,
    kAudioObjectPropertyScopeGlobal,
    kAudioObjectPropertyElementMain
  };

  UInt32 dataSize = 0;
  OSStatus status = AudioObjectGetPropertyDataSize(
    kAudioObjectSystemObject,
    &propertyAddress,
    0,
    nullptr,
    &dataSize
  );

  if (status != noErr || dataSize == 0) {
    return devices;
  }

  // Get device IDs
  size_t deviceCount = dataSize / sizeof(AudioDeviceID);
  std::vector<AudioDeviceID> deviceIds(deviceCount);

  status = AudioObjectGetPropertyData(
    kAudioObjectSystemObject,
    &propertyAddress,
    0,
    nullptr,
    &dataSize,
    deviceIds.data()
  );

  if (status != noErr) {
    return devices;
  }

  // Get default input device
  AudioDeviceID defaultInputDevice = kAudioObjectUnknown;
  propertyAddress.mSelector = kAudioHardwarePropertyDefaultInputDevice;
  dataSize = sizeof(defaultInputDevice);
  AudioObjectGetPropertyData(
    kAudioObjectSystemObject,
    &propertyAddress,
    0,
    nullptr,
    &dataSize,
    &defaultInputDevice
  );

  // Enumerate devices
  for (AudioDeviceID deviceId : deviceIds) {
    // Check if device has input channels
    propertyAddress.mSelector = kAudioDevicePropertyStreamConfiguration;
    propertyAddress.mScope = kAudioDevicePropertyScopeInput;

    status = AudioObjectGetPropertyDataSize(deviceId, &propertyAddress, 0, nullptr, &dataSize);
    if (status != noErr || dataSize == 0) {
      continue;
    }

    std::vector<uint8_t> bufferListData(dataSize);
    auto* bufferList = reinterpret_cast<AudioBufferList*>(bufferListData.data());

    status = AudioObjectGetPropertyData(deviceId, &propertyAddress, 0, nullptr, &dataSize, bufferList);
    if (status != noErr) {
      continue;
    }

    // Count input channels
    UInt32 inputChannels = 0;
    for (UInt32 i = 0; i < bufferList->mNumberBuffers; i++) {
      inputChannels += bufferList->mBuffers[i].mNumberChannels;
    }

    if (inputChannels == 0) {
      continue;  // Not an input device
    }

    // Get device name
    propertyAddress.mSelector = kAudioDevicePropertyDeviceNameCFString;
    propertyAddress.mScope = kAudioObjectPropertyScopeGlobal;

    CFStringRef nameRef = nullptr;
    dataSize = sizeof(nameRef);
    status = AudioObjectGetPropertyData(deviceId, &propertyAddress, 0, nullptr, &dataSize, &nameRef);

    std::string name = "Unknown Device";
    if (status == noErr && nameRef != nullptr) {
      char nameBuf[256];
      if (CFStringGetCString(nameRef, nameBuf, sizeof(nameBuf), kCFStringEncodingUTF8)) {
        name = nameBuf;
      }
      CFRelease(nameRef);
    }

    // Get nominal sample rate
    Float64 sampleRate = 0;
    propertyAddress.mSelector = kAudioDevicePropertyNominalSampleRate;
    dataSize = sizeof(sampleRate);
    AudioObjectGetPropertyData(deviceId, &propertyAddress, 0, nullptr, &dataSize, &sampleRate);

    AudioDevice device;
    device.id = std::to_string(deviceId);
    device.name = name;
    device.isDefault = (deviceId == defaultInputDevice);
    device.maxChannels = static_cast<int>(inputChannels);
    device.defaultSampleRate = static_cast<int>(sampleRate);

    devices.push_back(device);
  }

  return devices;
}

AudioDevice AudioCaptureMac::GetDefaultInputDevice() {
  auto devices = GetInputDevices();
  for (const auto& device : devices) {
    if (device.isDefault) {
      return device;
    }
  }

  // Return first device if no default found
  if (!devices.empty()) {
    return devices[0];
  }

  // Return empty device
  return AudioDevice{"", "No Input Device", false, 0, 0};
}

// Factory function
std::unique_ptr<AudioCapture> AudioCapture::Create() {
  return std::make_unique<AudioCaptureMac>();
}

std::vector<AudioDevice> AudioCapture::GetInputDevices() {
  return AudioCaptureMac::GetInputDevices();
}

AudioDevice AudioCapture::GetDefaultInputDevice() {
  return AudioCaptureMac::GetDefaultInputDevice();
}

} // namespace centris

#endif // CENTRIS_PLATFORM_MAC
