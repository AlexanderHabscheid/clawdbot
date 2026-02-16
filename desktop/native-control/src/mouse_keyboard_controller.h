/**
 * Centris Native Control - Mouse/Keyboard Controller Interface
 * 
 * Platform-agnostic interface for mouse and keyboard input simulation.
 * Implementations:
 *   - macOS: CGEvent (mouse_keyboard_controller_mac.cc)
 *   - Windows: SendInput (mouse_keyboard_controller_win.cc)
 *   - Linux: XTest (mouse_keyboard_controller_linux.cc)
 */

#ifndef CENTRIS_MOUSE_KEYBOARD_CONTROLLER_H
#define CENTRIS_MOUSE_KEYBOARD_CONTROLLER_H

#include "types.h"
#include <memory>
#include <string>
#include <vector>

namespace centris {

/**
 * MouseKeyboardController - Abstract interface for input simulation
 * 
 * This provides real mouse cursor movement and keyboard input,
 * visible to the user and indistinguishable from physical input.
 */
class MouseKeyboardController {
public:
    virtual ~MouseKeyboardController() = default;
    
    /**
     * Factory method to create platform-specific implementation
     */
    static std::unique_ptr<MouseKeyboardController> Create();
    
    // ═══════════════════════════════════════════════════════════════════════
    // Lifecycle
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * Initialize the input subsystem
     * @return true if successful
     */
    virtual bool Initialize() = 0;
    
    /**
     * Shutdown and cleanup
     */
    virtual void Shutdown() = 0;
    
    // ═══════════════════════════════════════════════════════════════════════
    // Mouse Control
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * Get current mouse cursor position
     * @return Pair of (x, y) screen coordinates
     */
    virtual std::pair<int, int> GetMousePosition() = 0;
    
    /**
     * Move mouse cursor to position
     * @param x Screen X coordinate
     * @param y Screen Y coordinate
     * @return true if successful
     */
    virtual bool MoveMouse(int x, int y) = 0;
    
    /**
     * Move mouse cursor smoothly (animated)
     * @param x Target X coordinate
     * @param y Target Y coordinate
     * @param durationMs Animation duration in milliseconds
     * @return true if successful
     */
    virtual bool MoveMouseSmooth(int x, int y, int durationMs = 100) = 0;
    
    /**
     * Click at current cursor position
     * @param options Click options (button, click count, modifiers)
     * @return true if successful
     */
    virtual bool Click(const ClickOptions& options = {}) = 0;
    
    /**
     * Click at specified position
     * @param x Screen X coordinate
     * @param y Screen Y coordinate
     * @param options Click options
     * @return true if successful
     */
    virtual bool ClickAt(int x, int y, const ClickOptions& options = {}) = 0;
    
    /**
     * Press mouse button down (without releasing)
     * @param button Mouse button
     * @return true if successful
     */
    virtual bool MouseDown(MouseButton button = MouseButton::Left) = 0;
    
    /**
     * Release mouse button
     * @param button Mouse button
     * @return true if successful
     */
    virtual bool MouseUp(MouseButton button = MouseButton::Left) = 0;
    
    /**
     * Drag from current position to target
     * @param toX Target X coordinate
     * @param toY Target Y coordinate
     * @param button Mouse button to hold during drag
     * @return true if successful
     */
    virtual bool DragTo(int toX, int toY, MouseButton button = MouseButton::Left) = 0;
    
    /**
     * Drag from one position to another
     * @param fromX Start X coordinate
     * @param fromY Start Y coordinate
     * @param toX End X coordinate
     * @param toY End Y coordinate
     * @param button Mouse button to hold during drag
     * @return true if successful
     */
    virtual bool Drag(int fromX, int fromY, int toX, int toY, 
                      MouseButton button = MouseButton::Left) = 0;
    
    /**
     * Scroll at current position
     * @param delta Scroll delta (x for horizontal, y for vertical)
     * @return true if successful
     */
    virtual bool Scroll(const ScrollDelta& delta) = 0;
    
    /**
     * Scroll at specified position
     * @param x Screen X coordinate
     * @param y Screen Y coordinate
     * @param delta Scroll delta
     * @return true if successful
     */
    virtual bool ScrollAt(int x, int y, const ScrollDelta& delta) = 0;
    
    // ═══════════════════════════════════════════════════════════════════════
    // Keyboard Control
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * Type a string of text
     * @param text Text to type
     * @param delayMs Delay between keystrokes (0 = instant)
     * @return true if successful
     */
    virtual bool Type(const std::string& text, int delayMs = 0) = 0;
    
    /**
     * Press a key combination
     * @param keyCombo Key combo string (e.g., "cmd+c", "ctrl+shift+n", "Return")
     * @return true if successful
     */
    virtual bool KeyPress(const std::string& keyCombo) = 0;
    
    /**
     * Press a key down (without releasing)
     * @param key Key name
     * @return true if successful
     */
    virtual bool KeyDown(const std::string& key) = 0;
    
    /**
     * Release a key
     * @param key Key name
     * @return true if successful
     */
    virtual bool KeyUp(const std::string& key) = 0;
    
    /**
     * Press modifier keys (cmd, ctrl, alt, shift)
     * @param modifiers List of modifier names
     * @return true if successful
     */
    virtual bool ModifiersDown(const std::vector<std::string>& modifiers) = 0;
    
    /**
     * Release modifier keys
     * @param modifiers List of modifier names
     * @return true if successful
     */
    virtual bool ModifiersUp(const std::vector<std::string>& modifiers) = 0;
    
    // ═══════════════════════════════════════════════════════════════════════
    // Utilities
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * Wait for specified duration
     * @param ms Duration in milliseconds
     */
    virtual void Wait(int ms) = 0;

protected:
    MouseKeyboardController() = default;
};

}  // namespace centris

#endif  // CENTRIS_MOUSE_KEYBOARD_CONTROLLER_H

