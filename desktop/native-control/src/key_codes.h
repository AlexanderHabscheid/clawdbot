/**
 * Centris Native Control - Virtual Key Code Mappings
 * 
 * Cross-platform key code definitions and conversion utilities.
 */

#ifndef CENTRIS_KEY_CODES_H
#define CENTRIS_KEY_CODES_H

#include <string>
#include <unordered_map>
#include <vector>
#include <cstdint>

namespace centris {

// ═══════════════════════════════════════════════════════════════════════════
// Key Modifier Flags
// ═══════════════════════════════════════════════════════════════════════════

enum KeyModifier : uint32_t {
    ModNone  = 0,
    ModShift = 1 << 0,
    ModCtrl  = 1 << 1,
    ModAlt   = 1 << 2,  // Option on macOS
    ModMeta  = 1 << 3,  // Command on macOS, Windows key on Windows
    ModFn    = 1 << 4,  // Function key
};

// ═══════════════════════════════════════════════════════════════════════════
// Platform-specific Virtual Key Codes
// ═══════════════════════════════════════════════════════════════════════════

#ifdef __APPLE__
// macOS Virtual Key Codes (from Carbon/HIToolbox/Events.h)
enum MacKeyCode : uint16_t {
    kVK_ANSI_A         = 0x00,
    kVK_ANSI_S         = 0x01,
    kVK_ANSI_D         = 0x02,
    kVK_ANSI_F         = 0x03,
    kVK_ANSI_H         = 0x04,
    kVK_ANSI_G         = 0x05,
    kVK_ANSI_Z         = 0x06,
    kVK_ANSI_X         = 0x07,
    kVK_ANSI_C         = 0x08,
    kVK_ANSI_V         = 0x09,
    kVK_ANSI_B         = 0x0B,
    kVK_ANSI_Q         = 0x0C,
    kVK_ANSI_W         = 0x0D,
    kVK_ANSI_E         = 0x0E,
    kVK_ANSI_R         = 0x0F,
    kVK_ANSI_Y         = 0x10,
    kVK_ANSI_T         = 0x11,
    kVK_ANSI_1         = 0x12,
    kVK_ANSI_2         = 0x13,
    kVK_ANSI_3         = 0x14,
    kVK_ANSI_4         = 0x15,
    kVK_ANSI_6         = 0x16,
    kVK_ANSI_5         = 0x17,
    kVK_ANSI_Equal     = 0x18,
    kVK_ANSI_9         = 0x19,
    kVK_ANSI_7         = 0x1A,
    kVK_ANSI_Minus     = 0x1B,
    kVK_ANSI_8         = 0x1C,
    kVK_ANSI_0         = 0x1D,
    kVK_ANSI_RightBracket = 0x1E,
    kVK_ANSI_O         = 0x1F,
    kVK_ANSI_U         = 0x20,
    kVK_ANSI_LeftBracket = 0x21,
    kVK_ANSI_I         = 0x22,
    kVK_ANSI_P         = 0x23,
    kVK_ANSI_L         = 0x25,
    kVK_ANSI_J         = 0x26,
    kVK_ANSI_Quote     = 0x27,
    kVK_ANSI_K         = 0x28,
    kVK_ANSI_Semicolon = 0x29,
    kVK_ANSI_Backslash = 0x2A,
    kVK_ANSI_Comma     = 0x2B,
    kVK_ANSI_Slash     = 0x2C,
    kVK_ANSI_N         = 0x2D,
    kVK_ANSI_M         = 0x2E,
    kVK_ANSI_Period    = 0x2F,
    kVK_ANSI_Grave     = 0x32,
    kVK_ANSI_KeypadDecimal = 0x41,
    kVK_ANSI_KeypadMultiply = 0x43,
    kVK_ANSI_KeypadPlus = 0x45,
    kVK_ANSI_KeypadClear = 0x47,
    kVK_ANSI_KeypadDivide = 0x4B,
    kVK_ANSI_KeypadEnter = 0x4C,
    kVK_ANSI_KeypadMinus = 0x4E,
    kVK_ANSI_KeypadEquals = 0x51,
    kVK_ANSI_Keypad0   = 0x52,
    kVK_ANSI_Keypad1   = 0x53,
    kVK_ANSI_Keypad2   = 0x54,
    kVK_ANSI_Keypad3   = 0x55,
    kVK_ANSI_Keypad4   = 0x56,
    kVK_ANSI_Keypad5   = 0x57,
    kVK_ANSI_Keypad6   = 0x58,
    kVK_ANSI_Keypad7   = 0x59,
    kVK_ANSI_Keypad8   = 0x5B,
    kVK_ANSI_Keypad9   = 0x5C,
    
    // Special keys
    kVK_Return         = 0x24,
    kVK_Tab            = 0x30,
    kVK_Space          = 0x31,
    kVK_Delete         = 0x33,  // Backspace
    kVK_Escape         = 0x35,
    kVK_Command        = 0x37,
    kVK_Shift          = 0x38,
    kVK_CapsLock       = 0x39,
    kVK_Option         = 0x3A,
    kVK_Control        = 0x3B,
    kVK_RightCommand   = 0x36,
    kVK_RightShift     = 0x3C,
    kVK_RightOption    = 0x3D,
    kVK_RightControl   = 0x3E,
    kVK_Function       = 0x3F,
    kVK_F17            = 0x40,
    kVK_VolumeUp       = 0x48,
    kVK_VolumeDown     = 0x49,
    kVK_Mute           = 0x4A,
    kVK_F18            = 0x4F,
    kVK_F19            = 0x50,
    kVK_F20            = 0x5A,
    kVK_F5             = 0x60,
    kVK_F6             = 0x61,
    kVK_F7             = 0x62,
    kVK_F3             = 0x63,
    kVK_F8             = 0x64,
    kVK_F9             = 0x65,
    kVK_F11            = 0x67,
    kVK_F13            = 0x69,
    kVK_F16            = 0x6A,
    kVK_F14            = 0x6B,
    kVK_F10            = 0x6D,
    kVK_F12            = 0x6F,
    kVK_F15            = 0x71,
    kVK_Help           = 0x72,
    kVK_Home           = 0x73,
    kVK_PageUp         = 0x74,
    kVK_ForwardDelete  = 0x75,  // Delete (forward)
    kVK_F4             = 0x76,
    kVK_End            = 0x77,
    kVK_F2             = 0x78,
    kVK_PageDown       = 0x79,
    kVK_F1             = 0x7A,
    kVK_LeftArrow      = 0x7B,
    kVK_RightArrow     = 0x7C,
    kVK_DownArrow      = 0x7D,
    kVK_UpArrow        = 0x7E,
};
#endif

#ifdef _WIN32
// Windows Virtual Key Codes are defined in <windows.h>
// We reference them here for documentation
#endif

// ═══════════════════════════════════════════════════════════════════════════
// Key Conversion Utilities
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parsed key combination
 */
struct KeyCombo {
    uint32_t modifiers = ModNone;  // KeyModifier flags
    uint16_t keyCode = 0;          // Platform-specific key code
    char character = 0;            // Character if applicable
    std::string keyName;           // Original key name
};

/**
 * Parse a key combination string
 * Examples: "cmd+c", "ctrl+shift+n", "Return", "F5"
 * @param combo Key combo string
 * @return Parsed KeyCombo
 */
KeyCombo ParseKeyCombo(const std::string& combo);

/**
 * Get platform key code from character
 * @param c Character
 * @return Platform-specific key code
 */
uint16_t CharToKeyCode(char c);

/**
 * Check if character requires Shift modifier
 * @param c Character
 * @return true if Shift is needed
 */
bool CharNeedsShift(char c);

/**
 * Get key code from key name
 * @param keyName Key name (e.g., "Return", "F5", "Space")
 * @return Platform-specific key code, or 0 if not found
 */
uint16_t KeyNameToKeyCode(const std::string& keyName);

/**
 * Get key name from key code
 * @param keyCode Platform-specific key code
 * @return Key name, or empty string if unknown
 */
std::string KeyCodeToKeyName(uint16_t keyCode);

/**
 * Get modifier flags from modifier names
 * @param modifiers Vector of modifier names ("cmd", "ctrl", "alt", "shift")
 * @return Combined KeyModifier flags
 */
uint32_t ModifierNamesToFlags(const std::vector<std::string>& modifiers);

/**
 * Get modifier names from flags
 * @param flags KeyModifier flags
 * @return Vector of modifier names
 */
std::vector<std::string> ModifierFlagsToNames(uint32_t flags);

}  // namespace centris

#endif  // CENTRIS_KEY_CODES_H

