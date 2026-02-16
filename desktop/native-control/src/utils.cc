/**
 * Centris Native Control - Common Utilities Implementation
 */

#include "utils.h"
#include <algorithm>
#include <sstream>
#include <iostream>
#include <thread>
#include <mutex>

#ifdef __APPLE__
#include <CoreFoundation/CoreFoundation.h>
#endif

#ifdef _WIN32
#include <windows.h>
#endif

namespace centris {
namespace utils {

// ═══════════════════════════════════════════════════════════════════════════
// Time Utilities
// ═══════════════════════════════════════════════════════════════════════════

void SleepMs(int ms) {
    std::this_thread::sleep_for(std::chrono::milliseconds(ms));
}

// ═══════════════════════════════════════════════════════════════════════════
// String Utilities
// ═══════════════════════════════════════════════════════════════════════════

std::string ToLower(const std::string& str) {
    std::string result = str;
    std::transform(result.begin(), result.end(), result.begin(), ::tolower);
    return result;
}

std::string ToUpper(const std::string& str) {
    std::string result = str;
    std::transform(result.begin(), result.end(), result.begin(), ::toupper);
    return result;
}

std::string Trim(const std::string& str) {
    size_t start = str.find_first_not_of(" \t\n\r\f\v");
    if (start == std::string::npos) return "";
    size_t end = str.find_last_not_of(" \t\n\r\f\v");
    return str.substr(start, end - start + 1);
}

std::vector<std::string> Split(const std::string& str, char delimiter) {
    std::vector<std::string> result;
    std::stringstream ss(str);
    std::string item;
    while (std::getline(ss, item, delimiter)) {
        result.push_back(item);
    }
    return result;
}

std::string Join(const std::vector<std::string>& strings, const std::string& delimiter) {
    std::string result;
    for (size_t i = 0; i < strings.size(); ++i) {
        if (i > 0) result += delimiter;
        result += strings[i];
    }
    return result;
}

bool StartsWith(const std::string& str, const std::string& prefix) {
    if (prefix.size() > str.size()) return false;
    return str.compare(0, prefix.size(), prefix) == 0;
}

bool EndsWith(const std::string& str, const std::string& suffix) {
    if (suffix.size() > str.size()) return false;
    return str.compare(str.size() - suffix.size(), suffix.size(), suffix) == 0;
}

bool ContainsIgnoreCase(const std::string& str, const std::string& substr) {
    std::string strLower = ToLower(str);
    std::string substrLower = ToLower(substr);
    return strLower.find(substrLower) != std::string::npos;
}

// ═══════════════════════════════════════════════════════════════════════════
// Platform-Specific String Conversions
// ═══════════════════════════════════════════════════════════════════════════

#ifdef __APPLE__
std::string CFStringToStdString(CFStringRef cfStr) {
    if (cfStr == nullptr) return "";
    
    CFIndex length = CFStringGetLength(cfStr);
    CFIndex maxSize = CFStringGetMaximumSizeForEncoding(length, kCFStringEncodingUTF8) + 1;
    
    std::string result(maxSize, '\0');
    if (CFStringGetCString(cfStr, &result[0], maxSize, kCFStringEncodingUTF8)) {
        result.resize(strlen(result.c_str()));
        return result;
    }
    
    return "";
}

CFStringRef StdStringToCFString(const std::string& str) {
    return CFStringCreateWithCString(kCFAllocatorDefault, str.c_str(), kCFStringEncodingUTF8);
}
#endif

#ifdef _WIN32
std::string WideToUtf8(const wchar_t* wstr) {
    if (wstr == nullptr || *wstr == L'\0') return "";
    
    int size = WideCharToMultiByte(CP_UTF8, 0, wstr, -1, nullptr, 0, nullptr, nullptr);
    if (size <= 0) return "";
    
    std::string result(size - 1, '\0');
    WideCharToMultiByte(CP_UTF8, 0, wstr, -1, &result[0], size, nullptr, nullptr);
    return result;
}

std::wstring Utf8ToWide(const std::string& str) {
    if (str.empty()) return L"";
    
    int size = MultiByteToWideChar(CP_UTF8, 0, str.c_str(), -1, nullptr, 0);
    if (size <= 0) return L"";
    
    std::wstring result(size - 1, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, str.c_str(), -1, &result[0], size);
    return result;
}

std::string BstrToStdString(BSTR bstr) {
    if (bstr == nullptr) return "";
    return WideToUtf8(bstr);
}
#endif

// ═══════════════════════════════════════════════════════════════════════════
// Logging Utilities
// ═══════════════════════════════════════════════════════════════════════════

static LogLevel g_minLogLevel = LogLevel::Info;
static bool g_loggingEnabled = true;
static std::mutex g_logMutex;

void Log(LogLevel level, const std::string& message) {
    if (!g_loggingEnabled || level < g_minLogLevel) return;
    
    std::lock_guard<std::mutex> lock(g_logMutex);
    
    const char* levelStr = "";
    switch (level) {
        case LogLevel::Debug:   levelStr = "DEBUG"; break;
        case LogLevel::Info:    levelStr = "INFO"; break;
        case LogLevel::Warning: levelStr = "WARN"; break;
        case LogLevel::Error:   levelStr = "ERROR"; break;
    }
    
    std::cerr << "[CentrisControl:" << levelStr << "] " << message << std::endl;
}

void SetLogLevel(LogLevel level) {
    g_minLogLevel = level;
}

void SetLoggingEnabled(bool enabled) {
    g_loggingEnabled = enabled;
}

}  // namespace utils
}  // namespace centris

