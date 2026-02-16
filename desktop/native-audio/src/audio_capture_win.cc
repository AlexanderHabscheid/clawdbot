/**
 * Windows WASAPI Audio Capture Implementation
 * 
 * Uses Windows Audio Session API (WASAPI) for low-latency audio capture.
 * WASAPI provides exclusive mode for lowest latency, or shared mode for compatibility.
 */

#ifdef CENTRIS_PLATFORM_WIN

#include "audio_capture.h"
#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <functiondiscoverykeys_devpkey.h>
#include <atomic>
#include <string>
#include <mutex>
#include <thread>
#include <iostream>

// Link required libraries
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "oleaut32.lib")

namespace centris {

/**
 * Windows WASAPI implementation
 */
class AudioCaptureWin : public AudioCapture {
public:
  AudioCaptureWin();
  ~AudioCaptureWin() override;

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

  // COM initialization helper
  bool InitializeCOM();

  // Setup helpers
  bool SetupDevice();
  bool SetupAudioClient();
  void Cleanup();

  // Audio format
  AudioFormat outputFormat_;
  WAVEFORMATEX* waveFormat_ = nullptr;

  // WASAPI interfaces
  IMMDeviceEnumerator* deviceEnumerator_ = nullptr;
  IMMDevice* device_ = nullptr;
  IAudioClient* audioClient_ = nullptr;
  IAudioCaptureClient* captureClient_ = nullptr;

  // Device
  std::string deviceId_;

  // State
  std::atomic<bool> initialized_{false};
  std::atomic<bool> running_{false};
  AudioCallback callback_;
  std::mutex callbackMutex_;

  // Capture thread
  std::thread captureThread_;
  HANDLE stopEvent_ = nullptr;

  // Buffer configuration
  UINT32 bufferFrameCount_ = 0;
  double latencyMs_ = 0.0;
  bool comInitialized_ = false;
};

AudioCaptureWin::AudioCaptureWin() = default;

AudioCaptureWin::~AudioCaptureWin() {
  Shutdown();
}

bool AudioCaptureWin::InitializeCOM() {
  if (comInitialized_) {
    return true;
  }

  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(hr) && hr != RPC_E_CHANGED_MODE) {
    std::cerr << "[AudioCaptureWin] Failed to initialize COM: " << hr << std::endl;
    return false;
  }

  comInitialized_ = true;
  return true;
}

bool AudioCaptureWin::Initialize(const AudioConfig& config) {
  if (initialized_.load()) {
    return true;
  }

  if (!InitializeCOM()) {
    return false;
  }

  deviceId_ = config.deviceId;

  // Store output format
  outputFormat_.sampleRate = config.sampleRate;
  outputFormat_.channels = config.channels;
  outputFormat_.bitsPerSample = config.bitsPerSample;
  outputFormat_.isFloat = false;

  // Create device enumerator
  HRESULT hr = CoCreateInstance(
    __uuidof(MMDeviceEnumerator),
    nullptr,
    CLSCTX_ALL,
    __uuidof(IMMDeviceEnumerator),
    reinterpret_cast<void**>(&deviceEnumerator_)
  );

  if (FAILED(hr)) {
    std::cerr << "[AudioCaptureWin] Failed to create device enumerator: " << hr << std::endl;
    return false;
  }

  // Setup device
  if (!SetupDevice()) {
    Cleanup();
    return false;
  }

  // Setup audio client
  if (!SetupAudioClient()) {
    Cleanup();
    return false;
  }

  // Create stop event
  stopEvent_ = CreateEvent(nullptr, TRUE, FALSE, nullptr);
  if (stopEvent_ == nullptr) {
    std::cerr << "[AudioCaptureWin] Failed to create stop event" << std::endl;
    Cleanup();
    return false;
  }

  initialized_.store(true);
  std::cout << "[AudioCaptureWin] Initialized successfully" << std::endl;
  return true;
}

bool AudioCaptureWin::SetupDevice() {
  HRESULT hr;

  if (deviceId_.empty() || deviceId_ == "default") {
    // Get default capture device
    hr = deviceEnumerator_->GetDefaultAudioEndpoint(eCapture, eConsole, &device_);
  } else {
    // Get specific device by ID
    std::wstring wideId(deviceId_.begin(), deviceId_.end());
    hr = deviceEnumerator_->GetDevice(wideId.c_str(), &device_);
  }

  if (FAILED(hr)) {
    std::cerr << "[AudioCaptureWin] Failed to get audio device: " << hr << std::endl;
    return false;
  }

  return true;
}

bool AudioCaptureWin::SetupAudioClient() {
  // Activate audio client
  HRESULT hr = device_->Activate(
    __uuidof(IAudioClient),
    CLSCTX_ALL,
    nullptr,
    reinterpret_cast<void**>(&audioClient_)
  );

  if (FAILED(hr)) {
    std::cerr << "[AudioCaptureWin] Failed to activate audio client: " << hr << std::endl;
    return false;
  }

  // Get mix format
  hr = audioClient_->GetMixFormat(&waveFormat_);
  if (FAILED(hr)) {
    std::cerr << "[AudioCaptureWin] Failed to get mix format: " << hr << std::endl;
    return false;
  }

  // Initialize audio client in shared mode
  // For lower latency, use exclusive mode (AUDCLNT_SHAREMODE_EXCLUSIVE)
  REFERENCE_TIME requestedDuration = 200000; // 20ms in 100ns units

  hr = audioClient_->Initialize(
    AUDCLNT_SHAREMODE_SHARED,
    AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
    requestedDuration,
    0,
    waveFormat_,
    nullptr
  );

  if (FAILED(hr)) {
    std::cerr << "[AudioCaptureWin] Failed to initialize audio client: " << hr << std::endl;
    return false;
  }

  // Get buffer size
  hr = audioClient_->GetBufferSize(&bufferFrameCount_);
  if (FAILED(hr)) {
    std::cerr << "[AudioCaptureWin] Failed to get buffer size: " << hr << std::endl;
    return false;
  }

  // Calculate latency
  latencyMs_ = (double)bufferFrameCount_ / waveFormat_->nSamplesPerSec * 1000.0;

  // Get capture client
  hr = audioClient_->GetService(
    __uuidof(IAudioCaptureClient),
    reinterpret_cast<void**>(&captureClient_)
  );

  if (FAILED(hr)) {
    std::cerr << "[AudioCaptureWin] Failed to get capture client: " << hr << std::endl;
    return false;
  }

  std::cout << "[AudioCaptureWin] Audio client initialized: "
            << waveFormat_->nSamplesPerSec << "Hz, "
            << waveFormat_->nChannels << "ch, "
            << waveFormat_->wBitsPerSample << "bit, "
            << latencyMs_ << "ms buffer" << std::endl;

  return true;
}

bool AudioCaptureWin::Start(AudioCallback callback) {
  if (!initialized_.load()) {
    std::cerr << "[AudioCaptureWin] Not initialized" << std::endl;
    return false;
  }

  if (running_.load()) {
    return true;
  }

  {
    std::lock_guard<std::mutex> lock(callbackMutex_);
    callback_ = callback;
  }

  // Reset stop event
  ResetEvent(stopEvent_);

  // Start audio client
  HRESULT hr = audioClient_->Start();
  if (FAILED(hr)) {
    std::cerr << "[AudioCaptureWin] Failed to start audio client: " << hr << std::endl;
    return false;
  }

  running_.store(true);

  // Start capture thread
  captureThread_ = std::thread(&AudioCaptureWin::CaptureThreadMain, this);

  std::cout << "[AudioCaptureWin] Started capturing audio" << std::endl;
  return true;
}

void AudioCaptureWin::Stop() {
  if (!running_.load()) {
    return;
  }

  running_.store(false);

  // Signal stop event
  if (stopEvent_ != nullptr) {
    SetEvent(stopEvent_);
  }

  // Wait for capture thread
  if (captureThread_.joinable()) {
    captureThread_.join();
  }

  // Stop audio client
  if (audioClient_ != nullptr) {
    audioClient_->Stop();
  }

  {
    std::lock_guard<std::mutex> lock(callbackMutex_);
    callback_ = nullptr;
  }

  std::cout << "[AudioCaptureWin] Stopped capturing audio" << std::endl;
}

void AudioCaptureWin::Shutdown() {
  Stop();
  Cleanup();
  initialized_.store(false);
}

void AudioCaptureWin::Cleanup() {
  if (stopEvent_ != nullptr) {
    CloseHandle(stopEvent_);
    stopEvent_ = nullptr;
  }

  if (captureClient_ != nullptr) {
    captureClient_->Release();
    captureClient_ = nullptr;
  }

  if (audioClient_ != nullptr) {
    audioClient_->Release();
    audioClient_ = nullptr;
  }

  if (device_ != nullptr) {
    device_->Release();
    device_ = nullptr;
  }

  if (deviceEnumerator_ != nullptr) {
    deviceEnumerator_->Release();
    deviceEnumerator_ = nullptr;
  }

  if (waveFormat_ != nullptr) {
    CoTaskMemFree(waveFormat_);
    waveFormat_ = nullptr;
  }

  if (comInitialized_) {
    CoUninitialize();
    comInitialized_ = false;
  }
}

bool AudioCaptureWin::IsRunning() const {
  return running_.load();
}

AudioFormat AudioCaptureWin::GetFormat() const {
  return outputFormat_;
}

size_t AudioCaptureWin::GetBufferSize() const {
  return static_cast<size_t>(bufferFrameCount_);
}

double AudioCaptureWin::GetLatencyMs() const {
  return latencyMs_;
}

bool AudioCaptureWin::SetDevice(const std::string& deviceId) {
  if (running_.load()) {
    std::cerr << "[AudioCaptureWin] Cannot change device while running" << std::endl;
    return false;
  }

  deviceId_ = deviceId;
  return true;
}

void AudioCaptureWin::CaptureThreadMain() {
  // Capture thread - polls for audio data
  while (running_.load()) {
    // Wait for data or stop event
    DWORD waitResult = WaitForSingleObject(stopEvent_, 10); // 10ms timeout
    if (waitResult == WAIT_OBJECT_0) {
      break; // Stop event signaled
    }

    // Get available packet
    UINT32 packetLength = 0;
    HRESULT hr = captureClient_->GetNextPacketSize(&packetLength);
    if (FAILED(hr)) {
      continue;
    }

    while (packetLength != 0) {
      BYTE* data;
      UINT32 numFramesAvailable;
      DWORD flags;

      hr = captureClient_->GetBuffer(&data, &numFramesAvailable, &flags, nullptr, nullptr);
      if (FAILED(hr)) {
        break;
      }

      // Convert to 16-bit samples if needed and call callback
      if (data != nullptr && numFramesAvailable > 0) {
        // TODO: Format conversion if waveFormat_ is not 16-bit PCM
        // For now, assume 16-bit PCM
        
        std::lock_guard<std::mutex> lock(callbackMutex_);
        if (callback_) {
          callback_(
            reinterpret_cast<const int16_t*>(data),
            static_cast<size_t>(numFramesAvailable),
            0 // TODO: Calculate timestamp
          );
        }
      }

      hr = captureClient_->ReleaseBuffer(numFramesAvailable);
      if (FAILED(hr)) {
        break;
      }

      hr = captureClient_->GetNextPacketSize(&packetLength);
      if (FAILED(hr)) {
        break;
      }
    }
  }
}

// Static methods for device enumeration
std::vector<AudioDevice> AudioCaptureWin::GetInputDevices() {
  std::vector<AudioDevice> devices;

  // Initialize COM
  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  bool comInitialized = SUCCEEDED(hr) || hr == RPC_E_CHANGED_MODE;

  if (!comInitialized) {
    return devices;
  }

  // Create device enumerator
  IMMDeviceEnumerator* enumerator = nullptr;
  hr = CoCreateInstance(
    __uuidof(MMDeviceEnumerator),
    nullptr,
    CLSCTX_ALL,
    __uuidof(IMMDeviceEnumerator),
    reinterpret_cast<void**>(&enumerator)
  );

  if (FAILED(hr) || enumerator == nullptr) {
    CoUninitialize();
    return devices;
  }

  // Get default device ID
  IMMDevice* defaultDevice = nullptr;
  std::wstring defaultDeviceId;
  hr = enumerator->GetDefaultAudioEndpoint(eCapture, eConsole, &defaultDevice);
  if (SUCCEEDED(hr) && defaultDevice != nullptr) {
    LPWSTR deviceIdStr = nullptr;
    if (SUCCEEDED(defaultDevice->GetId(&deviceIdStr))) {
      defaultDeviceId = deviceIdStr;
      CoTaskMemFree(deviceIdStr);
    }
    defaultDevice->Release();
  }

  // Enumerate capture devices
  IMMDeviceCollection* collection = nullptr;
  hr = enumerator->EnumAudioEndpoints(eCapture, DEVICE_STATE_ACTIVE, &collection);
  if (FAILED(hr) || collection == nullptr) {
    enumerator->Release();
    CoUninitialize();
    return devices;
  }

  UINT count = 0;
  collection->GetCount(&count);

  for (UINT i = 0; i < count; i++) {
    IMMDevice* device = nullptr;
    if (FAILED(collection->Item(i, &device))) {
      continue;
    }

    AudioDevice audioDevice;

    // Get device ID
    LPWSTR deviceIdStr = nullptr;
    if (SUCCEEDED(device->GetId(&deviceIdStr))) {
      std::wstring wideId(deviceIdStr);
      audioDevice.id = std::string(wideId.begin(), wideId.end());
      audioDevice.isDefault = (wideId == defaultDeviceId);
      CoTaskMemFree(deviceIdStr);
    }

    // Get device name
    IPropertyStore* props = nullptr;
    if (SUCCEEDED(device->OpenPropertyStore(STGM_READ, &props))) {
      PROPVARIANT varName;
      PropVariantInit(&varName);
      if (SUCCEEDED(props->GetValue(PKEY_Device_FriendlyName, &varName))) {
        if (varName.vt == VT_LPWSTR) {
          std::wstring wideName(varName.pwszVal);
          audioDevice.name = std::string(wideName.begin(), wideName.end());
        }
        PropVariantClear(&varName);
      }
      props->Release();
    }

    // Get channel count and sample rate
    IAudioClient* client = nullptr;
    if (SUCCEEDED(device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, reinterpret_cast<void**>(&client)))) {
      WAVEFORMATEX* format = nullptr;
      if (SUCCEEDED(client->GetMixFormat(&format))) {
        audioDevice.maxChannels = format->nChannels;
        audioDevice.defaultSampleRate = format->nSamplesPerSec;
        CoTaskMemFree(format);
      }
      client->Release();
    }

    devices.push_back(audioDevice);
    device->Release();
  }

  collection->Release();
  enumerator->Release();
  CoUninitialize();

  return devices;
}

AudioDevice AudioCaptureWin::GetDefaultInputDevice() {
  auto devices = GetInputDevices();
  for (const auto& device : devices) {
    if (device.isDefault) {
      return device;
    }
  }

  if (!devices.empty()) {
    return devices[0];
  }

  return AudioDevice{"", "No Input Device", false, 0, 0};
}

// Factory function
std::unique_ptr<AudioCapture> AudioCapture::Create() {
  return std::make_unique<AudioCaptureWin>();
}

std::vector<AudioDevice> AudioCapture::GetInputDevices() {
  return AudioCaptureWin::GetInputDevices();
}

AudioDevice AudioCapture::GetDefaultInputDevice() {
  return AudioCaptureWin::GetDefaultInputDevice();
}

} // namespace centris

#endif // CENTRIS_PLATFORM_WIN
