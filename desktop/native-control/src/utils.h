/**
 * Centris Native Control - Common Utilities
 * 
 * Shared utility functions for the native control module.
 */

#ifndef CENTRIS_CONTROL_UTILS_H
#define CENTRIS_CONTROL_UTILS_H

#include <string>
#include <vector>
#include <chrono>
#include <cstdint>

#ifdef __APPLE__
#include <CoreFoundation/CoreFoundation.h>
#endif

namespace centris {
namespace utils {

// ═══════════════════════════════════════════════════════════════════════════
// Time Utilities
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get current time in milliseconds since epoch
 */
inline int64_t GetCurrentTimeMs() {
    auto now = std::chrono::system_clock::now();
    auto duration = now.time_since_epoch();
    return std::chrono::duration_cast<std::chrono::milliseconds>(duration).count();
}

/**
 * Sleep for specified milliseconds
 */
void SleepMs(int ms);

// ═══════════════════════════════════════════════════════════════════════════
// String Utilities
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convert string to lowercase
 */
std::string ToLower(const std::string& str);

/**
 * Convert string to uppercase
 */
std::string ToUpper(const std::string& str);

/**
 * Trim whitespace from both ends of string
 */
std::string Trim(const std::string& str);

/**
 * Split string by delimiter
 */
std::vector<std::string> Split(const std::string& str, char delimiter);

/**
 * Join strings with delimiter
 */
std::string Join(const std::vector<std::string>& strings, const std::string& delimiter);

/**
 * Check if string starts with prefix
 */
bool StartsWith(const std::string& str, const std::string& prefix);

/**
 * Check if string ends with suffix
 */
bool EndsWith(const std::string& str, const std::string& suffix);

/**
 * Check if string contains substring (case-insensitive)
 */
bool ContainsIgnoreCase(const std::string& str, const std::string& substr);

// ═══════════════════════════════════════════════════════════════════════════
// Platform-Specific String Conversions
// ═══════════════════════════════════════════════════════════════════════════

#ifdef __APPLE__
/**
 * Convert CFStringRef to std::string
 */
std::string CFStringToStdString(CFStringRef cfStr);

/**
 * Convert std::string to CFStringRef (caller must CFRelease)
 */
CFStringRef StdStringToCFString(const std::string& str);
#endif

#ifdef _WIN32
/**
 * Convert wide string to UTF-8
 */
std::string WideToUtf8(const wchar_t* wstr);

/**
 * Convert UTF-8 to wide string
 */
std::wstring Utf8ToWide(const std::string& str);

/**
 * Convert BSTR to std::string
 */
std::string BstrToStdString(BSTR bstr);
#endif

// ═══════════════════════════════════════════════════════════════════════════
// Logging Utilities
// ═══════════════════════════════════════════════════════════════════════════

enum class LogLevel {
    Debug,
    Info,
    Warning,
    Error
};

/**
 * Log a message
 */
void Log(LogLevel level, const std::string& message);

/**
 * Log debug message
 */
inline void LogDebug(const std::string& message) { Log(LogLevel::Debug, message); }

/**
 * Log info message
 */
inline void LogInfo(const std::string& message) { Log(LogLevel::Info, message); }

/**
 * Log warning message
 */
inline void LogWarning(const std::string& message) { Log(LogLevel::Warning, message); }

/**
 * Log error message
 */
inline void LogError(const std::string& message) { Log(LogLevel::Error, message); }

/**
 * Set minimum log level (default: Info)
 */
void SetLogLevel(LogLevel level);

/**
 * Enable/disable logging (default: enabled)
 */
void SetLoggingEnabled(bool enabled);

// ═══════════════════════════════════════════════════════════════════════════
// Performance Utilities
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Simple timer for measuring operation duration
 */
class Timer {
public:
    Timer() : start_(std::chrono::high_resolution_clock::now()) {}
    
    /**
     * Get elapsed time in milliseconds
     */
    double ElapsedMs() const {
        auto now = std::chrono::high_resolution_clock::now();
        return std::chrono::duration<double, std::milli>(now - start_).count();
    }
    
    /**
     * Reset timer
     */
    void Reset() {
        start_ = std::chrono::high_resolution_clock::now();
    }

private:
    std::chrono::time_point<std::chrono::high_resolution_clock> start_;
};

}  // namespace utils
}  // namespace centris

#endif  // CENTRIS_CONTROL_UTILS_H

