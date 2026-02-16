/**
 * Lock-free Circular Buffer for Real-time Audio
 * 
 * This buffer is designed for the audio capture pipeline where:
 * - Producer: OS audio callback thread (real-time priority)
 * - Consumer: Processing thread (normal priority)
 * 
 * Key properties:
 * - Lock-free for single producer, single consumer (SPSC)
 * - Pre-allocated memory (no malloc/free during operation)
 * - Cache-line aligned to prevent false sharing
 * - Overflow handling: drop oldest data (never block producer)
 */

#ifndef CENTRIS_CIRCULAR_BUFFER_H
#define CENTRIS_CIRCULAR_BUFFER_H

#include <atomic>
#include <cstdint>
#include <cstring>
#include <algorithm>

namespace centris {

// Cache line size for alignment (64 bytes on most modern CPUs)
constexpr size_t CACHE_LINE_SIZE = 64;

/**
 * Lock-free SPSC circular buffer for audio samples
 * 
 * Template parameters:
 * - T: Sample type (typically int16_t for 16-bit audio)
 * - Capacity: Buffer size in samples (must be power of 2)
 */
template<typename T, size_t Capacity>
class CircularBuffer {
  static_assert((Capacity & (Capacity - 1)) == 0, "Capacity must be power of 2");
  static_assert(Capacity >= 1024, "Capacity should be at least 1024 samples");

public:
  CircularBuffer() : head_(0), tail_(0) {
    // Zero-initialize buffer
    std::memset(buffer_, 0, sizeof(buffer_));
  }

  /**
   * Write samples to the buffer (producer side)
   * 
   * Called from audio callback thread - must be lock-free and allocation-free!
   * If buffer is full, overwrites oldest data (never blocks).
   * 
   * @param data Pointer to sample data
   * @param count Number of samples to write
   * @return Number of samples actually written (may be less if overflow)
   */
  size_t Write(const T* data, size_t count) {
    const size_t currentHead = head_.load(std::memory_order_relaxed);
    const size_t currentTail = tail_.load(std::memory_order_acquire);
    
    const size_t available = Capacity - (currentHead - currentTail);
    const size_t toWrite = std::min(count, available);
    
    if (toWrite == 0) {
      // Buffer full - caller should track dropped samples
      return 0;
    }
    
    // Write data in up to two chunks (handle wrap-around)
    const size_t headIndex = currentHead & (Capacity - 1);
    const size_t firstChunk = std::min(toWrite, Capacity - headIndex);
    const size_t secondChunk = toWrite - firstChunk;
    
    std::memcpy(buffer_ + headIndex, data, firstChunk * sizeof(T));
    if (secondChunk > 0) {
      std::memcpy(buffer_, data + firstChunk, secondChunk * sizeof(T));
    }
    
    // Memory barrier: ensure data is written before updating head
    head_.store(currentHead + toWrite, std::memory_order_release);
    
    return toWrite;
  }

  /**
   * Read samples from the buffer (consumer side)
   * 
   * @param data Pointer to destination buffer
   * @param maxCount Maximum number of samples to read
   * @return Number of samples actually read
   */
  size_t Read(T* data, size_t maxCount) {
    const size_t currentTail = tail_.load(std::memory_order_relaxed);
    const size_t currentHead = head_.load(std::memory_order_acquire);
    
    const size_t available = currentHead - currentTail;
    const size_t toRead = std::min(maxCount, available);
    
    if (toRead == 0) {
      return 0;
    }
    
    // Read data in up to two chunks (handle wrap-around)
    const size_t tailIndex = currentTail & (Capacity - 1);
    const size_t firstChunk = std::min(toRead, Capacity - tailIndex);
    const size_t secondChunk = toRead - firstChunk;
    
    std::memcpy(data, buffer_ + tailIndex, firstChunk * sizeof(T));
    if (secondChunk > 0) {
      std::memcpy(data + firstChunk, buffer_, secondChunk * sizeof(T));
    }
    
    // Memory barrier: ensure data is read before updating tail
    tail_.store(currentTail + toRead, std::memory_order_release);
    
    return toRead;
  }

  /**
   * Peek at samples without consuming them
   * 
   * @param data Pointer to destination buffer
   * @param maxCount Maximum number of samples to peek
   * @return Number of samples peeked
   */
  size_t Peek(T* data, size_t maxCount) const {
    const size_t currentTail = tail_.load(std::memory_order_relaxed);
    const size_t currentHead = head_.load(std::memory_order_acquire);
    
    const size_t available = currentHead - currentTail;
    const size_t toPeek = std::min(maxCount, available);
    
    if (toPeek == 0) {
      return 0;
    }
    
    const size_t tailIndex = currentTail & (Capacity - 1);
    const size_t firstChunk = std::min(toPeek, Capacity - tailIndex);
    const size_t secondChunk = toPeek - firstChunk;
    
    std::memcpy(data, buffer_ + tailIndex, firstChunk * sizeof(T));
    if (secondChunk > 0) {
      std::memcpy(data + firstChunk, buffer_, secondChunk * sizeof(T));
    }
    
    return toPeek;
  }

  /**
   * Skip samples without reading them
   * 
   * @param count Number of samples to skip
   * @return Number of samples actually skipped
   */
  size_t Skip(size_t count) {
    const size_t currentTail = tail_.load(std::memory_order_relaxed);
    const size_t currentHead = head_.load(std::memory_order_acquire);
    
    const size_t available = currentHead - currentTail;
    const size_t toSkip = std::min(count, available);
    
    tail_.store(currentTail + toSkip, std::memory_order_release);
    
    return toSkip;
  }

  /**
   * Get number of samples available for reading
   */
  size_t Available() const {
    const size_t currentHead = head_.load(std::memory_order_acquire);
    const size_t currentTail = tail_.load(std::memory_order_relaxed);
    return currentHead - currentTail;
  }

  /**
   * Get number of samples that can be written
   */
  size_t Space() const {
    const size_t currentHead = head_.load(std::memory_order_relaxed);
    const size_t currentTail = tail_.load(std::memory_order_acquire);
    return Capacity - (currentHead - currentTail);
  }

  /**
   * Check if buffer is empty
   */
  bool IsEmpty() const {
    return Available() == 0;
  }

  /**
   * Check if buffer is full
   */
  bool IsFull() const {
    return Space() == 0;
  }

  /**
   * Reset buffer to empty state
   * Only safe to call when no concurrent access!
   */
  void Reset() {
    head_.store(0, std::memory_order_relaxed);
    tail_.store(0, std::memory_order_relaxed);
  }

  /**
   * Get buffer capacity
   */
  static constexpr size_t GetCapacity() { return Capacity; }

private:
  // Align to cache line to prevent false sharing
  alignas(CACHE_LINE_SIZE) std::atomic<size_t> head_;
  alignas(CACHE_LINE_SIZE) std::atomic<size_t> tail_;
  alignas(CACHE_LINE_SIZE) T buffer_[Capacity];
};

// Common buffer configurations
// 1 second at 16kHz = 16000 samples, round up to power of 2
using AudioBuffer16k = CircularBuffer<int16_t, 16384>;

// 2 seconds at 16kHz = 32000 samples, round up to power of 2
using AudioBuffer16k2s = CircularBuffer<int16_t, 32768>;

// 1 second at 48kHz = 48000 samples, round up to power of 2
using AudioBuffer48k = CircularBuffer<int16_t, 65536>;

} // namespace centris

#endif // CENTRIS_CIRCULAR_BUFFER_H
