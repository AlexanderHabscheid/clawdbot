/**
 * Voice Activity Detection (VAD) Processor
 * 
 * Detects speech in audio streams to:
 * - Only transmit audio when speech is detected
 * - Reduce bandwidth and backend load
 * - Trigger voice start/end events for UI feedback
 * 
 * Uses simple energy-based VAD (can be upgraded to WebRTC VAD or Silero VAD)
 */

#ifndef CENTRIS_VAD_PROCESSOR_H
#define CENTRIS_VAD_PROCESSOR_H

#include <cstdint>
#include <functional>
#include <vector>
#include <deque>

namespace centris {

/**
 * VAD State
 */
enum class VADState {
  Silence,   // No voice detected
  Speech,    // Voice is being detected
  Ending     // Voice ended, in cooldown period
};

/**
 * VAD Configuration
 */
struct VADConfig {
  float threshold = 0.03f;          // TUNED: Detection threshold (was 0.5, too high for whispers)
  int silenceTimeoutMs = 400;       // MATCHED WITH BACKEND: 400ms silence timeout (was 500)
  int speechPaddingMs = 150;        // INCREASED: More padding for smooth transitions (was 100)
  int minSpeechDurationMs = 80;     // REDUCED: Catch short utterances better (was 100)
  int sampleRate = 16000;           // Audio sample rate
  int frameSize = 320;              // Frame size in samples (20ms at 16kHz)
};

/**
 * VAD Processor
 */
class VADProcessor {
public:
  VADProcessor();
  ~VADProcessor() = default;

  /**
   * Initialize with configuration
   */
  bool Initialize(const VADConfig& config);

  /**
   * Process audio samples
   * 
   * @param samples Audio samples (16-bit signed integer)
   * @param count Number of samples
   * @return true if speech is currently detected
   */
  bool Process(const int16_t* samples, size_t count);

  /**
   * Get current VAD state
   */
  VADState GetState() const { return state_; }

  /**
   * Check if speech is active (including padding)
   */
  bool IsSpeechActive() const;

  /**
   * Get current audio level (RMS normalized to 0.0 - 1.0)
   */
  float GetAudioLevel() const { return currentLevel_; }

  /**
   * Get smoothed audio level for visualization
   */
  float GetSmoothedLevel() const { return smoothedLevel_; }

  /**
   * Reset state
   */
  void Reset();

  // Callbacks
  using VoiceStartCallback = std::function<void()>;
  using VoiceEndCallback = std::function<void()>;

  void SetVoiceStartCallback(VoiceStartCallback cb) { voiceStartCb_ = cb; }
  void SetVoiceEndCallback(VoiceEndCallback cb) { voiceEndCb_ = cb; }

private:
  /**
   * Calculate RMS (Root Mean Square) energy of samples
   */
  float CalculateRMS(const int16_t* samples, size_t count);

  /**
   * Update smoothed level with exponential moving average
   */
  void UpdateSmoothedLevel(float level);

  /**
   * Check if level exceeds threshold
   */
  bool IsAboveThreshold(float level);

  /**
   * Handle state transitions
   */
  void TransitionToSpeech();
  void TransitionToEnding();
  void TransitionToSilence();

  VADConfig config_;
  VADState state_ = VADState::Silence;

  // Level tracking
  float currentLevel_ = 0.0f;
  float smoothedLevel_ = 0.0f;
  float peakLevel_ = 0.0f;

  // Timing
  int silenceSamples_ = 0;
  int speechSamples_ = 0;
  int silenceThresholdSamples_ = 0;
  int minSpeechSamples_ = 0;
  int paddingSamples_ = 0;

  // History for adaptive threshold
  std::deque<float> levelHistory_;
  static constexpr size_t kLevelHistorySize = 50;

  // Callbacks
  VoiceStartCallback voiceStartCb_;
  VoiceEndCallback voiceEndCb_;
};

} // namespace centris

#endif // CENTRIS_VAD_PROCESSOR_H
