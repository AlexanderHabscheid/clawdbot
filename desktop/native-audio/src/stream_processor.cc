/**
 * Stream Processor Implementation
 */

#include "stream_processor.h"
#include <chrono>
#include <cstring>
#include <cmath>
#include <algorithm>
#include <iostream>

namespace centris {

StreamProcessor::StreamProcessor() = default;

StreamProcessor::~StreamProcessor() = default;

bool StreamProcessor::Initialize(const StreamConfig& config) {
  config_ = config;
  
  // Calculate samples per chunk
  samplesPerChunk_ = (config.sampleRate * config.chunkDurationMs) / 1000;
  
  // Reserve accumulator
  accumulator_.reserve(samplesPerChunk_ * 2);
  
  Reset();
  return true;
}

bool StreamProcessor::Process(const int16_t* samples, size_t count, bool isSpeech) {
  // Track speech state transitions
  bool wasInSpeech = inSpeech_;
  inSpeech_ = isSpeech;
  
  if (isSpeech) {
    silenceAccumulated_ = 0;
  } else {
    silenceAccumulated_ += static_cast<int>(count);
  }
  
  // Apply auto gain control if enabled (CRITICAL for whispered speech)
  std::vector<int16_t> gainedSamples;
  const int16_t* processedSamples = samples;
  if (config_.autoGainControl && isSpeech) {
    gainedSamples.assign(samples, samples + count);
    ApplyAutoGain(gainedSamples.data(), count);
    processedSamples = gainedSamples.data();
  }
  
  // Accumulate samples
  size_t offset = 0;
  while (offset < count) {
    size_t remaining = count - offset;
    size_t needed = samplesPerChunk_ - accumulator_.size();
    size_t toCopy = std::min(remaining, needed);
    
    accumulator_.insert(accumulator_.end(), processedSamples + offset, processedSamples + offset + toCopy);
    offset += toCopy;
    
    // If we have a full chunk, create and emit it
    if (accumulator_.size() >= samplesPerChunk_) {
      bool isEndOfUtterance = wasInSpeech && !isSpeech;
      AudioChunk chunk = CreateChunk(isEndOfUtterance);
      
      if (chunkReadyCb_) {
        chunkReadyCb_(chunk);
      }
      
      accumulator_.clear();
    }
  }
  
  return true;
}

bool StreamProcessor::Flush() {
  if (accumulator_.empty()) {
    return false;
  }
  
  // Create final chunk with remaining samples
  AudioChunk chunk = CreateChunk(true);
  
  if (chunkReadyCb_) {
    chunkReadyCb_(chunk);
  }
  
  accumulator_.clear();
  return true;
}

void StreamProcessor::Reset() {
  accumulator_.clear();
  sequenceNumber_ = 0;
  inSpeech_ = false;
  silenceAccumulated_ = 0;
}

AudioChunk StreamProcessor::CreateChunk(bool isEndOfUtterance) {
  AudioChunk chunk;
  chunk.sequenceNumber = sequenceNumber_++;
  chunk.isEndOfUtterance = isEndOfUtterance;
  chunk.isOpusEncoded = false;  // TODO: Add Opus encoding
  
  // Get timestamp
  auto now = std::chrono::steady_clock::now();
  auto duration = now.time_since_epoch();
  chunk.timestamp = std::chrono::duration_cast<std::chrono::microseconds>(duration).count();
  
  // Encode to PCM
  chunk.data = EncodePCM(accumulator_.data(), accumulator_.size());
  
  return chunk;
}

std::vector<uint8_t> StreamProcessor::EncodePCM(const int16_t* samples, size_t count) {
  // Encode as little-endian 16-bit PCM
  std::vector<uint8_t> data(count * 2);
  
  for (size_t i = 0; i < count; i++) {
    int16_t sample = samples[i];
    data[i * 2] = static_cast<uint8_t>(sample & 0xFF);
    data[i * 2 + 1] = static_cast<uint8_t>((sample >> 8) & 0xFF);
  }
  
  return data;
}

float StreamProcessor::CalculateRMS(const int16_t* samples, size_t count) {
  if (count == 0) return 0.0f;
  
  double sumSquares = 0.0;
  for (size_t i = 0; i < count; i++) {
    // Normalize to -1.0 to 1.0
    double sample = static_cast<double>(samples[i]) / 32768.0;
    sumSquares += sample * sample;
  }
  
  return static_cast<float>(std::sqrt(sumSquares / count));
}

void StreamProcessor::ApplyAutoGain(int16_t* samples, size_t count) {
  if (count == 0) return;
  
  // Calculate current RMS level
  float rms = CalculateRMS(samples, count);
  
  // Skip if audio is too quiet (likely silence/noise only)
  const float noiseFloor = 0.001f;  // Very quiet threshold
  if (rms < noiseFloor) {
    return;
  }
  
  // Calculate desired gain to reach target RMS
  float desiredGain = config_.targetRMS / rms;
  
  // Clamp gain to configured range
  desiredGain = std::max(config_.minGain, std::min(config_.maxGain, desiredGain));
  
  // Smooth gain changes to avoid sudden volume jumps
  // Use faster attack (quick boost) and slower release (gradual reduction)
  if (desiredGain > currentGain_) {
    // Fast attack - boost quiet audio quickly
    currentGain_ = currentGain_ + (desiredGain - currentGain_) * 0.3f;
  } else {
    // Slower release - reduce gain gradually
    currentGain_ = currentGain_ + (desiredGain - currentGain_) * smoothingFactor_;
  }
  
  // Apply gain to all samples with clipping protection
  for (size_t i = 0; i < count; i++) {
    float amplified = static_cast<float>(samples[i]) * currentGain_;
    
    // Soft clipping to prevent harsh distortion
    if (amplified > 32000.0f) {
      amplified = 32000.0f + (amplified - 32000.0f) * 0.1f;  // Gentle limiting
    } else if (amplified < -32000.0f) {
      amplified = -32000.0f + (amplified + 32000.0f) * 0.1f;
    }
    
    // Hard clip to valid int16 range
    samples[i] = static_cast<int16_t>(std::max(-32768.0f, std::min(32767.0f, amplified)));
  }
  
  // Debug logging for gain changes (only when significant)
  static float lastLoggedGain = 1.0f;
  if (std::abs(currentGain_ - lastLoggedGain) > 0.5f) {
    std::cout << "[StreamProcessor] 🔊 Auto-gain: " << currentGain_ << "x (RMS: " << rms << ")" << std::endl;
    lastLoggedGain = currentGain_;
  }
}

} // namespace centris
