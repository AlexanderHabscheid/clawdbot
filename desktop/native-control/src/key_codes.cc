/**
 * Centris Native Control - Virtual Key Code Mappings Implementation
 */

#include "key_codes.h"
#include "utils.h"
#include <algorithm>
#include <cctype>

namespace centris {

// ═══════════════════════════════════════════════════════════════════════════
// Key Name to Key Code Mappings
// ═══════════════════════════════════════════════════════════════════════════

#ifdef __APPLE__
static const std::unordered_map<std::string, uint16_t> g_keyNameToCode = {
    // Letters
    {"a", kVK_ANSI_A}, {"b", kVK_ANSI_B}, {"c", kVK_ANSI_C}, {"d", kVK_ANSI_D},
    {"e", kVK_ANSI_E}, {"f", kVK_ANSI_F}, {"g", kVK_ANSI_G}, {"h", kVK_ANSI_H},
    {"i", kVK_ANSI_I}, {"j", kVK_ANSI_J}, {"k", kVK_ANSI_K}, {"l", kVK_ANSI_L},
    {"m", kVK_ANSI_M}, {"n", kVK_ANSI_N}, {"o", kVK_ANSI_O}, {"p", kVK_ANSI_P},
    {"q", kVK_ANSI_Q}, {"r", kVK_ANSI_R}, {"s", kVK_ANSI_S}, {"t", kVK_ANSI_T},
    {"u", kVK_ANSI_U}, {"v", kVK_ANSI_V}, {"w", kVK_ANSI_W}, {"x", kVK_ANSI_X},
    {"y", kVK_ANSI_Y}, {"z", kVK_ANSI_Z},
    
    // Numbers
    {"0", kVK_ANSI_0}, {"1", kVK_ANSI_1}, {"2", kVK_ANSI_2}, {"3", kVK_ANSI_3},
    {"4", kVK_ANSI_4}, {"5", kVK_ANSI_5}, {"6", kVK_ANSI_6}, {"7", kVK_ANSI_7},
    {"8", kVK_ANSI_8}, {"9", kVK_ANSI_9},
    
    // Special keys
    {"return", kVK_Return}, {"enter", kVK_Return},
    {"tab", kVK_Tab},
    {"space", kVK_Space},
    {"delete", kVK_Delete}, {"backspace", kVK_Delete},
    {"forwarddelete", kVK_ForwardDelete}, {"del", kVK_ForwardDelete},
    {"escape", kVK_Escape}, {"esc", kVK_Escape},
    {"capslock", kVK_CapsLock},
    
    // Arrow keys
    {"left", kVK_LeftArrow}, {"leftarrow", kVK_LeftArrow},
    {"right", kVK_RightArrow}, {"rightarrow", kVK_RightArrow},
    {"up", kVK_UpArrow}, {"uparrow", kVK_UpArrow},
    {"down", kVK_DownArrow}, {"downarrow", kVK_DownArrow},
    
    // Navigation
    {"home", kVK_Home}, {"end", kVK_End},
    {"pageup", kVK_PageUp}, {"pagedown", kVK_PageDown},
    
    // Function keys
    {"f1", kVK_F1}, {"f2", kVK_F2}, {"f3", kVK_F3}, {"f4", kVK_F4},
    {"f5", kVK_F5}, {"f6", kVK_F6}, {"f7", kVK_F7}, {"f8", kVK_F8},
    {"f9", kVK_F9}, {"f10", kVK_F10}, {"f11", kVK_F11}, {"f12", kVK_F12},
    {"f13", kVK_F13}, {"f14", kVK_F14}, {"f15", kVK_F15}, {"f16", kVK_F16},
    {"f17", kVK_F17}, {"f18", kVK_F18}, {"f19", kVK_F19}, {"f20", kVK_F20},
    
    // Modifier keys (for KeyDown/KeyUp)
    {"command", kVK_Command}, {"cmd", kVK_Command},
    {"shift", kVK_Shift},
    {"option", kVK_Option}, {"alt", kVK_Option},
    {"control", kVK_Control}, {"ctrl", kVK_Control},
    {"fn", kVK_Function}, {"function", kVK_Function},
    
    // Punctuation
    {"minus", kVK_ANSI_Minus}, {"-", kVK_ANSI_Minus},
    {"equal", kVK_ANSI_Equal}, {"=", kVK_ANSI_Equal},
    {"leftbracket", kVK_ANSI_LeftBracket}, {"[", kVK_ANSI_LeftBracket},
    {"rightbracket", kVK_ANSI_RightBracket}, {"]", kVK_ANSI_RightBracket},
    {"semicolon", kVK_ANSI_Semicolon}, {";", kVK_ANSI_Semicolon},
    {"quote", kVK_ANSI_Quote}, {"'", kVK_ANSI_Quote},
    {"backslash", kVK_ANSI_Backslash}, {"\\", kVK_ANSI_Backslash},
    {"comma", kVK_ANSI_Comma}, {",", kVK_ANSI_Comma},
    {"period", kVK_ANSI_Period}, {".", kVK_ANSI_Period},
    {"slash", kVK_ANSI_Slash}, {"/", kVK_ANSI_Slash},
    {"grave", kVK_ANSI_Grave}, {"`", kVK_ANSI_Grave},
    
    // Keypad
    {"keypad0", kVK_ANSI_Keypad0}, {"keypad1", kVK_ANSI_Keypad1},
    {"keypad2", kVK_ANSI_Keypad2}, {"keypad3", kVK_ANSI_Keypad3},
    {"keypad4", kVK_ANSI_Keypad4}, {"keypad5", kVK_ANSI_Keypad5},
    {"keypad6", kVK_ANSI_Keypad6}, {"keypad7", kVK_ANSI_Keypad7},
    {"keypad8", kVK_ANSI_Keypad8}, {"keypad9", kVK_ANSI_Keypad9},
    {"keypadclear", kVK_ANSI_KeypadClear},
    {"keypadenter", kVK_ANSI_KeypadEnter},
    {"keypadplus", kVK_ANSI_KeypadPlus}, {"keypad+", kVK_ANSI_KeypadPlus},
    {"keypadminus", kVK_ANSI_KeypadMinus}, {"keypad-", kVK_ANSI_KeypadMinus},
    {"keypadmultiply", kVK_ANSI_KeypadMultiply}, {"keypad*", kVK_ANSI_KeypadMultiply},
    {"keypaddivide", kVK_ANSI_KeypadDivide}, {"keypad/", kVK_ANSI_KeypadDivide},
    {"keypaddecimal", kVK_ANSI_KeypadDecimal}, {"keypad.", kVK_ANSI_KeypadDecimal},
    {"keypadequals", kVK_ANSI_KeypadEquals}, {"keypad=", kVK_ANSI_KeypadEquals},
    
    // Media keys
    {"volumeup", kVK_VolumeUp},
    {"volumedown", kVK_VolumeDown},
    {"mute", kVK_Mute},
};

// Character to key code mapping for macOS
static const std::unordered_map<char, uint16_t> g_charToKeyCode = {
    {'a', kVK_ANSI_A}, {'b', kVK_ANSI_B}, {'c', kVK_ANSI_C}, {'d', kVK_ANSI_D},
    {'e', kVK_ANSI_E}, {'f', kVK_ANSI_F}, {'g', kVK_ANSI_G}, {'h', kVK_ANSI_H},
    {'i', kVK_ANSI_I}, {'j', kVK_ANSI_J}, {'k', kVK_ANSI_K}, {'l', kVK_ANSI_L},
    {'m', kVK_ANSI_M}, {'n', kVK_ANSI_N}, {'o', kVK_ANSI_O}, {'p', kVK_ANSI_P},
    {'q', kVK_ANSI_Q}, {'r', kVK_ANSI_R}, {'s', kVK_ANSI_S}, {'t', kVK_ANSI_T},
    {'u', kVK_ANSI_U}, {'v', kVK_ANSI_V}, {'w', kVK_ANSI_W}, {'x', kVK_ANSI_X},
    {'y', kVK_ANSI_Y}, {'z', kVK_ANSI_Z},
    {'A', kVK_ANSI_A}, {'B', kVK_ANSI_B}, {'C', kVK_ANSI_C}, {'D', kVK_ANSI_D},
    {'E', kVK_ANSI_E}, {'F', kVK_ANSI_F}, {'G', kVK_ANSI_G}, {'H', kVK_ANSI_H},
    {'I', kVK_ANSI_I}, {'J', kVK_ANSI_J}, {'K', kVK_ANSI_K}, {'L', kVK_ANSI_L},
    {'M', kVK_ANSI_M}, {'N', kVK_ANSI_N}, {'O', kVK_ANSI_O}, {'P', kVK_ANSI_P},
    {'Q', kVK_ANSI_Q}, {'R', kVK_ANSI_R}, {'S', kVK_ANSI_S}, {'T', kVK_ANSI_T},
    {'U', kVK_ANSI_U}, {'V', kVK_ANSI_V}, {'W', kVK_ANSI_W}, {'X', kVK_ANSI_X},
    {'Y', kVK_ANSI_Y}, {'Z', kVK_ANSI_Z},
    {'0', kVK_ANSI_0}, {'1', kVK_ANSI_1}, {'2', kVK_ANSI_2}, {'3', kVK_ANSI_3},
    {'4', kVK_ANSI_4}, {'5', kVK_ANSI_5}, {'6', kVK_ANSI_6}, {'7', kVK_ANSI_7},
    {'8', kVK_ANSI_8}, {'9', kVK_ANSI_9},
    {' ', kVK_Space}, {'\t', kVK_Tab}, {'\n', kVK_Return}, {'\r', kVK_Return},
    {'-', kVK_ANSI_Minus}, {'=', kVK_ANSI_Equal},
    {'[', kVK_ANSI_LeftBracket}, {']', kVK_ANSI_RightBracket},
    {';', kVK_ANSI_Semicolon}, {'\'', kVK_ANSI_Quote},
    {'\\', kVK_ANSI_Backslash}, {',', kVK_ANSI_Comma},
    {'.', kVK_ANSI_Period}, {'/', kVK_ANSI_Slash},
    {'`', kVK_ANSI_Grave},
    // Shifted characters
    {'!', kVK_ANSI_1}, {'@', kVK_ANSI_2}, {'#', kVK_ANSI_3}, {'$', kVK_ANSI_4},
    {'%', kVK_ANSI_5}, {'^', kVK_ANSI_6}, {'&', kVK_ANSI_7}, {'*', kVK_ANSI_8},
    {'(', kVK_ANSI_9}, {')', kVK_ANSI_0},
    {'_', kVK_ANSI_Minus}, {'+', kVK_ANSI_Equal},
    {'{', kVK_ANSI_LeftBracket}, {'}', kVK_ANSI_RightBracket},
    {':', kVK_ANSI_Semicolon}, {'"', kVK_ANSI_Quote},
    {'|', kVK_ANSI_Backslash}, {'<', kVK_ANSI_Comma},
    {'>', kVK_ANSI_Period}, {'?', kVK_ANSI_Slash},
    {'~', kVK_ANSI_Grave},
};
#endif

#ifdef _WIN32
// Windows key name to VK code mapping
static const std::unordered_map<std::string, uint16_t> g_keyNameToCode = {
    // Letters (VK_A = 0x41, etc.)
    {"a", 0x41}, {"b", 0x42}, {"c", 0x43}, {"d", 0x44}, {"e", 0x45},
    {"f", 0x46}, {"g", 0x47}, {"h", 0x48}, {"i", 0x49}, {"j", 0x4A},
    {"k", 0x4B}, {"l", 0x4C}, {"m", 0x4D}, {"n", 0x4E}, {"o", 0x4F},
    {"p", 0x50}, {"q", 0x51}, {"r", 0x52}, {"s", 0x53}, {"t", 0x54},
    {"u", 0x55}, {"v", 0x56}, {"w", 0x57}, {"x", 0x58}, {"y", 0x59},
    {"z", 0x5A},
    
    // Numbers
    {"0", 0x30}, {"1", 0x31}, {"2", 0x32}, {"3", 0x33}, {"4", 0x34},
    {"5", 0x35}, {"6", 0x36}, {"7", 0x37}, {"8", 0x38}, {"9", 0x39},
    
    // Special keys
    {"return", 0x0D}, {"enter", 0x0D},
    {"tab", 0x09},
    {"space", 0x20},
    {"backspace", 0x08}, {"delete", 0x08},
    {"del", 0x2E}, {"forwarddelete", 0x2E},
    {"escape", 0x1B}, {"esc", 0x1B},
    {"capslock", 0x14},
    
    // Arrow keys
    {"left", 0x25}, {"leftarrow", 0x25},
    {"up", 0x26}, {"uparrow", 0x26},
    {"right", 0x27}, {"rightarrow", 0x27},
    {"down", 0x28}, {"downarrow", 0x28},
    
    // Navigation
    {"home", 0x24}, {"end", 0x23},
    {"pageup", 0x21}, {"pagedown", 0x22},
    {"insert", 0x2D},
    
    // Function keys
    {"f1", 0x70}, {"f2", 0x71}, {"f3", 0x72}, {"f4", 0x73},
    {"f5", 0x74}, {"f6", 0x75}, {"f7", 0x76}, {"f8", 0x77},
    {"f9", 0x78}, {"f10", 0x79}, {"f11", 0x7A}, {"f12", 0x7B},
    
    // Modifier keys
    {"shift", 0x10}, {"ctrl", 0xA2}, {"control", 0xA2},
    {"alt", 0xA4}, {"option", 0xA4},
    {"win", 0x5B}, {"meta", 0x5B}, {"cmd", 0x5B}, {"command", 0x5B},
};

static const std::unordered_map<char, uint16_t> g_charToKeyCode = {
    {'a', 0x41}, {'b', 0x42}, {'c', 0x43}, {'d', 0x44}, {'e', 0x45},
    {'f', 0x46}, {'g', 0x47}, {'h', 0x48}, {'i', 0x49}, {'j', 0x4A},
    {'k', 0x4B}, {'l', 0x4C}, {'m', 0x4D}, {'n', 0x4E}, {'o', 0x4F},
    {'p', 0x50}, {'q', 0x51}, {'r', 0x52}, {'s', 0x53}, {'t', 0x54},
    {'u', 0x55}, {'v', 0x56}, {'w', 0x57}, {'x', 0x58}, {'y', 0x59},
    {'z', 0x5A},
    {'A', 0x41}, {'B', 0x42}, {'C', 0x43}, {'D', 0x44}, {'E', 0x45},
    {'F', 0x46}, {'G', 0x47}, {'H', 0x48}, {'I', 0x49}, {'J', 0x4A},
    {'K', 0x4B}, {'L', 0x4C}, {'M', 0x4D}, {'N', 0x4E}, {'O', 0x4F},
    {'P', 0x50}, {'Q', 0x51}, {'R', 0x52}, {'S', 0x53}, {'T', 0x54},
    {'U', 0x55}, {'V', 0x56}, {'W', 0x57}, {'X', 0x58}, {'Y', 0x59},
    {'Z', 0x5A},
    {'0', 0x30}, {'1', 0x31}, {'2', 0x32}, {'3', 0x33}, {'4', 0x34},
    {'5', 0x35}, {'6', 0x36}, {'7', 0x37}, {'8', 0x38}, {'9', 0x39},
    {' ', 0x20}, {'\t', 0x09}, {'\n', 0x0D}, {'\r', 0x0D},
};
#endif

#ifdef __linux__
// Linux X11 key codes - using XK_* constants conceptually
static const std::unordered_map<std::string, uint16_t> g_keyNameToCode = {
    // Letters (XK_a = 0x61, etc.)
    {"a", 0x61}, {"b", 0x62}, {"c", 0x63}, {"d", 0x64}, {"e", 0x65},
    {"f", 0x66}, {"g", 0x67}, {"h", 0x68}, {"i", 0x69}, {"j", 0x6a},
    {"k", 0x6b}, {"l", 0x6c}, {"m", 0x6d}, {"n", 0x6e}, {"o", 0x6f},
    {"p", 0x70}, {"q", 0x71}, {"r", 0x72}, {"s", 0x73}, {"t", 0x74},
    {"u", 0x75}, {"v", 0x76}, {"w", 0x77}, {"x", 0x78}, {"y", 0x79},
    {"z", 0x7a},
    
    // Special keys
    {"return", 0xff0d}, {"enter", 0xff0d},
    {"tab", 0xff09},
    {"space", 0x20},
    {"backspace", 0xff08}, {"delete", 0xff08},
    {"escape", 0xff1b}, {"esc", 0xff1b},
    
    // Arrow keys
    {"left", 0xff51}, {"up", 0xff52}, {"right", 0xff53}, {"down", 0xff54},
    
    // Modifier keys
    {"shift", 0xffe1}, {"ctrl", 0xffe3}, {"control", 0xffe3},
    {"alt", 0xffe9}, {"meta", 0xffe7}, {"super", 0xffeb},
};

static const std::unordered_map<char, uint16_t> g_charToKeyCode = {
    {'a', 0x61}, {'b', 0x62}, {'c', 0x63}, {'d', 0x64}, {'e', 0x65},
    {'f', 0x66}, {'g', 0x67}, {'h', 0x68}, {'i', 0x69}, {'j', 0x6a},
    {'k', 0x6b}, {'l', 0x6c}, {'m', 0x6d}, {'n', 0x6e}, {'o', 0x6f},
    {'p', 0x70}, {'q', 0x71}, {'r', 0x72}, {'s', 0x73}, {'t', 0x74},
    {'u', 0x75}, {'v', 0x76}, {'w', 0x77}, {'x', 0x78}, {'y', 0x79},
    {'z', 0x7a},
    {' ', 0x20}, {'\t', 0xff09}, {'\n', 0xff0d}, {'\r', 0xff0d},
};
#endif

// ═══════════════════════════════════════════════════════════════════════════
// Implementation
// ═══════════════════════════════════════════════════════════════════════════

KeyCombo ParseKeyCombo(const std::string& combo) {
    KeyCombo result;
    result.keyName = combo;
    
    // Split by + to get modifiers and key
    std::vector<std::string> parts = utils::Split(combo, '+');
    if (parts.empty()) return result;
    
    // Last part is the key, rest are modifiers
    std::string keyPart = utils::Trim(parts.back());
    
    // Parse modifiers
    for (size_t i = 0; i < parts.size() - 1; ++i) {
        std::string mod = utils::ToLower(utils::Trim(parts[i]));
        if (mod == "cmd" || mod == "command" || mod == "meta" || mod == "win") {
            result.modifiers |= ModMeta;
        } else if (mod == "ctrl" || mod == "control") {
            result.modifiers |= ModCtrl;
        } else if (mod == "alt" || mod == "option" || mod == "opt") {
            result.modifiers |= ModAlt;
        } else if (mod == "shift") {
            result.modifiers |= ModShift;
        } else if (mod == "fn" || mod == "function") {
            result.modifiers |= ModFn;
        }
    }
    
    // Parse key
    std::string keyLower = utils::ToLower(keyPart);
    
    // Check if it's a single character
    if (keyPart.length() == 1) {
        result.character = keyPart[0];
        result.keyCode = CharToKeyCode(result.character);
        if (CharNeedsShift(result.character)) {
            result.modifiers |= ModShift;
        }
    } else {
        // Look up key name
        result.keyCode = KeyNameToKeyCode(keyLower);
    }
    
    return result;
}

uint16_t CharToKeyCode(char c) {
    auto it = g_charToKeyCode.find(c);
    if (it != g_charToKeyCode.end()) {
        return it->second;
    }
    return 0;
}

bool CharNeedsShift(char c) {
    // Uppercase letters
    if (c >= 'A' && c <= 'Z') return true;
    
    // Shifted punctuation (US keyboard layout)
    static const std::string shiftedChars = "!@#$%^&*()_+{}|:\"<>?~";
    return shiftedChars.find(c) != std::string::npos;
}

uint16_t KeyNameToKeyCode(const std::string& keyName) {
    std::string lower = utils::ToLower(keyName);
    auto it = g_keyNameToCode.find(lower);
    if (it != g_keyNameToCode.end()) {
        return it->second;
    }
    return 0;
}

std::string KeyCodeToKeyName(uint16_t keyCode) {
    for (const auto& pair : g_keyNameToCode) {
        if (pair.second == keyCode) {
            return pair.first;
        }
    }
    return "";
}

uint32_t ModifierNamesToFlags(const std::vector<std::string>& modifiers) {
    uint32_t flags = ModNone;
    for (const auto& mod : modifiers) {
        std::string lower = utils::ToLower(mod);
        if (lower == "cmd" || lower == "command" || lower == "meta" || lower == "win") {
            flags |= ModMeta;
        } else if (lower == "ctrl" || lower == "control") {
            flags |= ModCtrl;
        } else if (lower == "alt" || lower == "option" || lower == "opt") {
            flags |= ModAlt;
        } else if (lower == "shift") {
            flags |= ModShift;
        } else if (lower == "fn" || lower == "function") {
            flags |= ModFn;
        }
    }
    return flags;
}

std::vector<std::string> ModifierFlagsToNames(uint32_t flags) {
    std::vector<std::string> names;
    if (flags & ModMeta) names.push_back("cmd");
    if (flags & ModCtrl) names.push_back("ctrl");
    if (flags & ModAlt) names.push_back("alt");
    if (flags & ModShift) names.push_back("shift");
    if (flags & ModFn) names.push_back("fn");
    return names;
}

}  // namespace centris

