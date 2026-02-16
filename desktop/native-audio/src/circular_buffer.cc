/**
 * Circular Buffer Implementation
 * 
 * Most of the implementation is in the header file as template code.
 * This file contains any non-template utility functions.
 */

#include "circular_buffer.h"

namespace centris {

// Template instantiations for common buffer types
// This ensures the linker can find the implementations

template class CircularBuffer<int16_t, 16384>;   // 1 second at 16kHz
template class CircularBuffer<int16_t, 32768>;   // 2 seconds at 16kHz
template class CircularBuffer<int16_t, 65536>;   // 1 second at 48kHz

} // namespace centris
