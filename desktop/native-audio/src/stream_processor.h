/**
 * Stream Processor
 * 
 * Processes audio from the circular buffer and prepares it for streaming:
 * - Reads from circular buffer
 * - Runs VAD
 * - Encodes to Opus (optional)
 * - Chunks for streaming
 */

#ifndef CENTRIS_STREAM_PROCESSOR_H
#define CENTRIS_STREAM_PROCESSOR_H

#include <cstdint>
#include <vector>
#include <functional>
#include <atomic>

namespace centris {

// Forward declarations
class VADProcessor;

/**
 * Stream processor configuration
 */
struct StreamConfig {
  int sampleRate = 16000;
  int channels = 1;
  int bitsPerSample = 16;
  int chunkDurationMs = 100;  // Duration of each chunk sent to backend
  bool useOpus = false;       // Use Opus encoding (requires libopus)
  int opusBitrate = 24000;    // Opus bitrate in bps
  
  // Audio gain settings for whispered/quiet speech
  bool autoGainControl = true;   // Enable automatic gain control
  float targetRMS = 0.15f;       // Target RMS level (0.0 - 1.0) for normalization
  float maxGain = 6.0f;          // Maximum gain multiplier (6x = ~15.5 dB)
  float minGain = 1.0f;          // Minimum gain (no attenuation)
};

/**
 * Audio chunk ready for streaming
 */
struct AudioChunk {
  std::vector<uint8_t> data;
  uint32_t sequenceNumber;
  uint64_t timestamp;
  bool isEndOfUtterance;
  bool isOpusEncoded;
};

/**
 * Stream Processor
 */
class StreamProcessor {
public:
  StreamProcessor();
  ~StreamProcessor();

  /**
   * Initialize the processor
   */
  bool Initialize(const StreamConfig& config);

  /**
   * Process samples from buffer
   * 
   * @param samples Audio samples
   * @param count Number of samples
   * @param isSpeech Whether VAD detected speech
   * @return Chunk if ready to send, empty optional otherwise
   */
  bool Process(const int16_t* samples, size_t count, bool isSpeech);

  /**
   * Force flush any buffered audio (e.g., at end of utterance)
   */
  bool Flush();

  /**
   * Reset state
   */
  void Reset();

  // Callback for when a chunk is ready
  using ChunkReadyCallback = std::function<void(const AudioChunk& chunk)>;
  void SetChunkReadyCallback(ChunkReadyCallback cb) { chunkReadyCb_ = cb; }

private:
  /**
   * Create a chunk from accumulated samples
   */
  AudioChunk CreateChunk(bool isEndOfUtterance);

  /**
   * Encode samples to PCM bytes (little-endian)
   */
  std::vector<uint8_t> EncodePCM(const int16_t* samples, size_t count);

  /**
   * Calculate RMS level of audio samples (0.0 - 1.0)
   */
  float CalculateRMS(const int16_t* samples, size_t count);
  
  /**
   * Apply automatic gain control to boost quiet audio
   */
  void ApplyAutoGain(int16_t* samples, size_t count);

  StreamConfig config_;
  
  // Accumulator for samples
  std::vector<int16_t> accumulator_;
  size_t samplesPerChunk_ = 0;
  
  // Sequence tracking
  uint32_t sequenceNumber_ = 0;
  
  // Speech state
  bool inSpeech_ = false;
  int silenceAccumulated_ = 0;
  
  // Auto gain control state
  float currentGain_ = 1.0f;       // Current gain level (smoothed)
  float smoothingFactor_ = 0.1f;   // Gain smoothing factor (lower = smoother)
  
  // Callback
  ChunkReadyCallback chunkReadyCb_;
};

} // namespace centris

#endif // CENTRIS_STREAM_PROCESSOR_H
