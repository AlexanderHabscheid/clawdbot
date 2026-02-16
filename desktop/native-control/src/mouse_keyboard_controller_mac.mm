/**
 * Centris Native Control - macOS Mouse/Keyboard Controller
 * 
 * Uses CGEvent API for mouse and keyboard input simulation.
 * Events are posted to the system event tap and are indistinguishable
 * from physical input.
 */

#include "mouse_keyboard_controller.h"
#include "key_codes.h"
#include "utils.h"

#include <ApplicationServices/ApplicationServices.h>
#include <Carbon/Carbon.h>

namespace centris {

/**
 * macOS Mouse/Keyboard Controller Implementation
 */
class MouseKeyboardControllerMac : public MouseKeyboardController {
public:
    MouseKeyboardControllerMac() = default;
    ~MouseKeyboardControllerMac() override { Shutdown(); }
    
    bool Initialize() override {
        if (initialized_) return true;
        initialized_ = true;
        utils::LogInfo("MouseKeyboardController initialized (macOS)");
        return true;
    }
    
    void Shutdown() override {
        initialized_ = false;
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // Mouse Control
    // ═══════════════════════════════════════════════════════════════════════
    
    std::pair<int, int> GetMousePosition() override {
        CGEventRef event = CGEventCreate(nullptr);
        CGPoint point = CGEventGetLocation(event);
        CFRelease(event);
        return {static_cast<int>(point.x), static_cast<int>(point.y)};
    }
    
    bool MoveMouse(int x, int y) override {
        CGPoint point = CGPointMake(x, y);
        CGEventRef event = CGEventCreateMouseEvent(
            nullptr, kCGEventMouseMoved, point, kCGMouseButtonLeft
        );
        
        if (!event) return false;
        
        CGEventPost(kCGHIDEventTap, event);
        CFRelease(event);
        
        return true;
    }
    
    bool MoveMouseSmooth(int x, int y, int durationMs) override {
        auto [startX, startY] = GetMousePosition();
        
        int steps = std::max(1, durationMs / 16);  // ~60 FPS
        int delayMs = durationMs / steps;
        
        for (int i = 1; i <= steps; ++i) {
            float t = static_cast<float>(i) / steps;
            // Ease in-out
            t = t < 0.5f ? 2 * t * t : 1 - std::pow(-2 * t + 2, 2) / 2;
            
            int currentX = startX + static_cast<int>((x - startX) * t);
            int currentY = startY + static_cast<int>((y - startY) * t);
            
            MoveMouse(currentX, currentY);
            Wait(delayMs);
        }
        
        return true;
    }
    
    bool Click(const ClickOptions& options) override {
        auto [x, y] = GetMousePosition();
        return ClickAt(x, y, options);
    }
    
    bool ClickAt(int x, int y, const ClickOptions& options) override {
        CGPoint point = CGPointMake(x, y);
        
        // Move mouse first if requested
        if (options.moveMouseFirst) {
            MoveMouse(x, y);
            Wait(10);  // Brief pause for visual feedback
        }
        
        // Determine button
        CGMouseButton button = kCGMouseButtonLeft;
        CGEventType downType = kCGEventLeftMouseDown;
        CGEventType upType = kCGEventLeftMouseUp;
        
        switch (options.button) {
            case MouseButton::Right:
                button = kCGMouseButtonRight;
                downType = kCGEventRightMouseDown;
                upType = kCGEventRightMouseUp;
                break;
            case MouseButton::Middle:
                button = kCGMouseButtonCenter;
                downType = kCGEventOtherMouseDown;
                upType = kCGEventOtherMouseUp;
                break;
            default:
                break;
        }
        
        // Press modifiers
        PressModifiers(options.modifiers, true);
        
        if (options.delayBeforeClick > 0) {
            Wait(options.delayBeforeClick);
        }
        
        // Perform clicks
        for (int i = 0; i < options.clickCount; ++i) {
            if (i > 0) {
                Wait(options.delayBetweenClicks);
            }
            
            // Mouse down
            CGEventRef downEvent = CGEventCreateMouseEvent(nullptr, downType, point, button);
            if (downEvent) {
                CGEventSetIntegerValueField(downEvent, kCGMouseEventClickState, i + 1);
                CGEventPost(kCGHIDEventTap, downEvent);
                CFRelease(downEvent);
            }
            
            Wait(50);  // Brief hold
            
            // Mouse up
            CGEventRef upEvent = CGEventCreateMouseEvent(nullptr, upType, point, button);
            if (upEvent) {
                CGEventSetIntegerValueField(upEvent, kCGMouseEventClickState, i + 1);
                CGEventPost(kCGHIDEventTap, upEvent);
                CFRelease(upEvent);
            }
        }
        
        // Release modifiers
        PressModifiers(options.modifiers, false);
        
        return true;
    }
    
    bool MouseDown(MouseButton button) override {
        auto [x, y] = GetMousePosition();
        CGPoint point = CGPointMake(x, y);
        
        CGMouseButton cgButton = kCGMouseButtonLeft;
        CGEventType eventType = kCGEventLeftMouseDown;
        
        switch (button) {
            case MouseButton::Right:
                cgButton = kCGMouseButtonRight;
                eventType = kCGEventRightMouseDown;
                break;
            case MouseButton::Middle:
                cgButton = kCGMouseButtonCenter;
                eventType = kCGEventOtherMouseDown;
                break;
            default:
                break;
        }
        
        CGEventRef event = CGEventCreateMouseEvent(nullptr, eventType, point, cgButton);
        if (!event) return false;
        
        CGEventPost(kCGHIDEventTap, event);
        CFRelease(event);
        
        return true;
    }
    
    bool MouseUp(MouseButton button) override {
        auto [x, y] = GetMousePosition();
        CGPoint point = CGPointMake(x, y);
        
        CGMouseButton cgButton = kCGMouseButtonLeft;
        CGEventType eventType = kCGEventLeftMouseUp;
        
        switch (button) {
            case MouseButton::Right:
                cgButton = kCGMouseButtonRight;
                eventType = kCGEventRightMouseUp;
                break;
            case MouseButton::Middle:
                cgButton = kCGMouseButtonCenter;
                eventType = kCGEventOtherMouseUp;
                break;
            default:
                break;
        }
        
        CGEventRef event = CGEventCreateMouseEvent(nullptr, eventType, point, cgButton);
        if (!event) return false;
        
        CGEventPost(kCGHIDEventTap, event);
        CFRelease(event);
        
        return true;
    }
    
    bool DragTo(int toX, int toY, MouseButton button) override {
        auto [fromX, fromY] = GetMousePosition();
        return Drag(fromX, fromY, toX, toY, button);
    }
    
    bool Drag(int fromX, int fromY, int toX, int toY, MouseButton button) override {
        // Move to start position
        MoveMouse(fromX, fromY);
        Wait(50);
        
        // Mouse down
        MouseDown(button);
        Wait(50);
        
        // Drag (smooth movement)
        int steps = std::max(10, static_cast<int>(std::sqrt(
            std::pow(toX - fromX, 2) + std::pow(toY - fromY, 2)
        ) / 10));
        
        CGEventType dragType = kCGEventLeftMouseDragged;
        if (button == MouseButton::Right) {
            dragType = kCGEventRightMouseDragged;
        } else if (button == MouseButton::Middle) {
            dragType = kCGEventOtherMouseDragged;
        }
        
        CGMouseButton cgButton = kCGMouseButtonLeft;
        if (button == MouseButton::Right) cgButton = kCGMouseButtonRight;
        if (button == MouseButton::Middle) cgButton = kCGMouseButtonCenter;
        
        for (int i = 1; i <= steps; ++i) {
            float t = static_cast<float>(i) / steps;
            int x = fromX + static_cast<int>((toX - fromX) * t);
            int y = fromY + static_cast<int>((toY - fromY) * t);
            
            CGPoint point = CGPointMake(x, y);
            CGEventRef event = CGEventCreateMouseEvent(nullptr, dragType, point, cgButton);
            if (event) {
                CGEventPost(kCGHIDEventTap, event);
                CFRelease(event);
            }
            
            Wait(16);  // ~60 FPS
        }
        
        // Mouse up
        MouseUp(button);
        
        return true;
    }
    
    bool Scroll(const ScrollDelta& delta) override {
        CGEventRef event = CGEventCreateScrollWheelEvent(
            nullptr, kCGScrollEventUnitPixel, 2, -delta.deltaY, -delta.deltaX
        );
        
        if (!event) return false;
        
        CGEventPost(kCGHIDEventTap, event);
        CFRelease(event);
        
        return true;
    }
    
    bool ScrollAt(int x, int y, const ScrollDelta& delta) override {
        MoveMouse(x, y);
        Wait(10);
        return Scroll(delta);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // Keyboard Control
    // ═══════════════════════════════════════════════════════════════════════
    
    bool Type(const std::string& text, int delayMs) override {
        for (char c : text) {
            uint16_t keyCode = CharToKeyCode(c);
            if (keyCode == 0) continue;
            
            bool needsShift = CharNeedsShift(c);
            
            // Press shift if needed
            if (needsShift) {
                PostKeyEvent(kVK_Shift, true);
            }
            
            // Key down
            PostKeyEvent(keyCode, true);
            
            // Key up
            PostKeyEvent(keyCode, false);
            
            // Release shift
            if (needsShift) {
                PostKeyEvent(kVK_Shift, false);
            }
            
            if (delayMs > 0) {
                Wait(delayMs);
            }
        }
        
        return true;
    }
    
    bool KeyPress(const std::string& keyCombo) override {
        KeyCombo combo = ParseKeyCombo(keyCombo);
        
        // Press modifiers
        if (combo.modifiers & ModMeta) PostKeyEvent(kVK_Command, true);
        if (combo.modifiers & ModCtrl) PostKeyEvent(kVK_Control, true);
        if (combo.modifiers & ModAlt) PostKeyEvent(kVK_Option, true);
        if (combo.modifiers & ModShift) PostKeyEvent(kVK_Shift, true);
        if (combo.modifiers & ModFn) PostKeyEvent(kVK_Function, true);
        
        // Press key
        if (combo.keyCode != 0) {
            PostKeyEvent(combo.keyCode, true);
            PostKeyEvent(combo.keyCode, false);
        }
        
        // Release modifiers (reverse order)
        if (combo.modifiers & ModFn) PostKeyEvent(kVK_Function, false);
        if (combo.modifiers & ModShift) PostKeyEvent(kVK_Shift, false);
        if (combo.modifiers & ModAlt) PostKeyEvent(kVK_Option, false);
        if (combo.modifiers & ModCtrl) PostKeyEvent(kVK_Control, false);
        if (combo.modifiers & ModMeta) PostKeyEvent(kVK_Command, false);
        
        return true;
    }
    
    bool KeyDown(const std::string& key) override {
        uint16_t keyCode = KeyNameToKeyCode(utils::ToLower(key));
        if (keyCode == 0) return false;
        return PostKeyEvent(keyCode, true);
    }
    
    bool KeyUp(const std::string& key) override {
        uint16_t keyCode = KeyNameToKeyCode(utils::ToLower(key));
        if (keyCode == 0) return false;
        return PostKeyEvent(keyCode, false);
    }
    
    bool ModifiersDown(const std::vector<std::string>& modifiers) override {
        for (const auto& mod : modifiers) {
            std::string lower = utils::ToLower(mod);
            if (lower == "cmd" || lower == "command" || lower == "meta") {
                PostKeyEvent(kVK_Command, true);
            } else if (lower == "ctrl" || lower == "control") {
                PostKeyEvent(kVK_Control, true);
            } else if (lower == "alt" || lower == "option") {
                PostKeyEvent(kVK_Option, true);
            } else if (lower == "shift") {
                PostKeyEvent(kVK_Shift, true);
            } else if (lower == "fn" || lower == "function") {
                PostKeyEvent(kVK_Function, true);
            }
        }
        return true;
    }
    
    bool ModifiersUp(const std::vector<std::string>& modifiers) override {
        for (const auto& mod : modifiers) {
            std::string lower = utils::ToLower(mod);
            if (lower == "cmd" || lower == "command" || lower == "meta") {
                PostKeyEvent(kVK_Command, false);
            } else if (lower == "ctrl" || lower == "control") {
                PostKeyEvent(kVK_Control, false);
            } else if (lower == "alt" || lower == "option") {
                PostKeyEvent(kVK_Option, false);
            } else if (lower == "shift") {
                PostKeyEvent(kVK_Shift, false);
            } else if (lower == "fn" || lower == "function") {
                PostKeyEvent(kVK_Function, false);
            }
        }
        return true;
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // Utilities
    // ═══════════════════════════════════════════════════════════════════════
    
    void Wait(int ms) override {
        utils::SleepMs(ms);
    }

private:
    bool initialized_ = false;
    
    bool PostKeyEvent(uint16_t keyCode, bool keyDown) {
        CGEventRef event = CGEventCreateKeyboardEvent(nullptr, keyCode, keyDown);
        if (!event) return false;
        
        CGEventPost(kCGHIDEventTap, event);
        CFRelease(event);
        
        return true;
    }
    
    void PressModifiers(const std::vector<std::string>& modifiers, bool down) {
        for (const auto& mod : modifiers) {
            std::string lower = utils::ToLower(mod);
            if (lower == "cmd" || lower == "command" || lower == "meta") {
                PostKeyEvent(kVK_Command, down);
            } else if (lower == "ctrl" || lower == "control") {
                PostKeyEvent(kVK_Control, down);
            } else if (lower == "alt" || lower == "option") {
                PostKeyEvent(kVK_Option, down);
            } else if (lower == "shift") {
                PostKeyEvent(kVK_Shift, down);
            } else if (lower == "fn" || lower == "function") {
                PostKeyEvent(kVK_Function, down);
            }
        }
    }
};

// Factory method
std::unique_ptr<MouseKeyboardController> MouseKeyboardController::Create() {
    return std::make_unique<MouseKeyboardControllerMac>();
}

}  // namespace centris

