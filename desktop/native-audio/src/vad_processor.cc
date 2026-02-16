/**
 * Voice Activity Detection (VAD) Processor Implementation
 */

#include "vad_processor.h"
#include <cmath>
#include <algorithm>
#include <numeric>

namespace centris {

VADProcessor::VADProcessor() = default;

bool VADProcessor::Initialize(const VADConfig& config) {
  config_ = config;

  // Calculate sample counts from millisecond durations
  int samplesPerMs = config.sampleRate / 1000;
  silenceThresholdSamples_ = config.silenceTimeoutMs * samplesPerMs;
  minSpeechSamples_ = config.minSpeechDurationMs * samplesPerMs;
  paddingSamples_ = config.speechPaddingMs * samplesPerMs;

  Reset();
  return true;
}

bool VADProcessor::Process(const int16_t* samples, size_t count) {
  // Calculate RMS level
  float level = CalculateRMS(samples, count);
  currentLevel_ = level;
  UpdateSmoothedLevel(level);

  // Update level history for adaptive threshold
  levelHistory_.push_back(level);
  if (levelHistory_.size() > kLevelHistorySize) {
    levelHistory_.pop_front();
  }

  // Track peak level
  if (level > peakLevel_) {
    peakLevel_ = level;
  } else {
    // Slowly decay peak level
    peakLevel_ *= 0.999f;
  }

  bool isSpeech = IsAboveThreshold(level);

  switch (state_) {
    case VADState::Silence:
      if (isSpeech) {
        speechSamples_ += static_cast<int>(count);
        if (speechSamples_ >= minSpeechSamples_) {
          TransitionToSpeech();
        }
      } else {
        speechSamples_ = 0;
      }
      break;

    case VADState::Speech:
      if (!isSpeech) {
        silenceSamples_ += static_cast<int>(count);
        if (silenceSamples_ >= silenceThresholdSamples_) {
          TransitionToEnding();
        }
      } else {
        silenceSamples_ = 0;
        speechSamples_ += static_cast<int>(count);
      }
      break;

    case VADState::Ending:
      // Brief cooldown before fully transitioning to silence
      // This allows for brief pauses in speech
      silenceSamples_ += static_cast<int>(count);
      if (isSpeech) {
        // Speech resumed - go back to Speech state
        state_ = VADState::Speech;
        silenceSamples_ = 0;
      } else if (silenceSamples_ >= paddingSamples_) {
        TransitionToSilence();
      }
      break;
  }

  return state_ == VADState::Speech || state_ == VADState::Ending;
}

bool VADProcessor::IsSpeechActive() const {
  return state_ == VADState::Speech || state_ == VADState::Ending;
}

void VADProcessor::Reset() {
  state_ = VADState::Silence;
  currentLevel_ = 0.0f;
  smoothedLevel_ = 0.0f;
  peakLevel_ = 0.0f;
  silenceSamples_ = 0;
  speechSamples_ = 0;
  levelHistory_.clear();
}

float VADProcessor::CalculateRMS(const int16_t* samples, size_t count) {
  if (count == 0) return 0.0f;

  // Calculate sum of squares
  double sumSquares = 0.0;
  for (size_t i = 0; i < count; i++) {
    double sample = static_cast<double>(samples[i]) / 32768.0;  // Normalize to -1.0 to 1.0
    sumSquares += sample * sample;
  }

  // Calculate RMS
  double rms = std::sqrt(sumSquares / count);

  // Convert to dB-like scale (0.0 to 1.0)
  // Using a simple log scale with minimum threshold
  const double minDb = -60.0;  // Noise floor
  const double maxDb = 0.0;    // Maximum level

  if (rms < 0.000001) {
    return 0.0f;
  }

  double db = 20.0 * std::log10(rms);
  db = std::max(db, minDb);
  db = std::min(db, maxDb);

  // Normalize to 0.0 - 1.0
  return static_cast<float>((db - minDb) / (maxDb - minDb));
}

void VADProcessor::UpdateSmoothedLevel(float level) {
  // Exponential moving average with different attack/release
  const float attackCoeff = 0.3f;   // Fast attack
  const float releaseCoeff = 0.05f; // Slow release

  if (level > smoothedLevel_) {
    smoothedLevel_ = attackCoeff * level + (1.0f - attackCoeff) * smoothedLevel_;
  } else {
    smoothedLevel_ = releaseCoeff * level + (1.0f - releaseCoeff) * smoothedLevel_;
  }
}

bool VADProcessor::IsAboveThreshold(float level) {
  // Use fixed threshold for more reliable voice detection
  // The adaptive threshold was too aggressive and would miss speech in noisy environments
  // The backend's Faster-Whisper has its own VAD, so we can be more permissive here
  
  // For dictation, we want to capture everything above the configured threshold
  // without adaptive adjustment that could block speech
  float threshold = config_.threshold;
  
  // Only apply minimal adaptive adjustment when clearly in silence (very low levels)
  if (!levelHistory_.empty()) {
    float avgLevel = std::accumulate(levelHistory_.begin(), levelHistory_.end(), 0.0f) / levelHistory_.size();
    
    // Only raise threshold if background is very quiet and we have a high threshold setting
    // This prevents threshold creep in normal/noisy environments
    if (avgLevel < 0.05f && config_.threshold > 0.2f) {
      // Slightly raise threshold only in very quiet environments
      float margin = 0.05f;  // 5% above background (was 15% - too aggressive)
      threshold = std::max(config_.threshold, avgLevel + margin);
    }
  }

  return level > threshold;
}

void VADProcessor::TransitionToSpeech() {
  if (state_ != VADState::Speech) {
    state_ = VADState::Speech;
    silenceSamples_ = 0;
    
    if (voiceStartCb_) {
      voiceStartCb_();
    }
  }
}

void VADProcessor::TransitionToEnding() {
  if (state_ != VADState::Ending) {
    state_ = VADState::Ending;
  }
}

void VADProcessor::TransitionToSilence() {
  if (state_ != VADState::Silence) {
    state_ = VADState::Silence;
    speechSamples_ = 0;
    silenceSamples_ = 0;
    
    if (voiceEndCb_) {
      voiceEndCb_();
    }
  }
}

} // namespace centris
