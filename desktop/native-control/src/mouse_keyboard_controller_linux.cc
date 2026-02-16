/**
 * Centris Native Control - Linux Mouse/Keyboard Controller
 * 
 * Uses XTest extension for input simulation.
 * This is a stub implementation - full implementation pending.
 */

#include "mouse_keyboard_controller.h"
#include "key_codes.h"
#include "utils.h"

#ifdef CENTRIS_PLATFORM_LINUX

#include <X11/Xlib.h>
#include <X11/extensions/XTest.h>
#include <X11/keysym.h>

namespace centris {

/**
 * Linux Mouse/Keyboard Controller Implementation (Stub)
 */
class MouseKeyboardControllerLinux : public MouseKeyboardController {
public:
    MouseKeyboardControllerLinux() = default;
    ~MouseKeyboardControllerLinux() override { Shutdown(); }
    
    bool Initialize() override {
        if (initialized_) return true;
        
        display_ = XOpenDisplay(nullptr);
        if (!display_) {
            utils::LogError("Failed to open X display");
            return false;
        }
        
        // Check if XTest is available
        int eventBase, errorBase;
        int majorVersion, minorVersion;
        if (!XTestQueryExtension(display_, &eventBase, &errorBase, 
                                  &majorVersion, &minorVersion)) {
            utils::LogError("XTest extension not available");
            XCloseDisplay(display_);
            display_ = nullptr;
            return false;
        }
        
        screen_ = DefaultScreen(display_);
        root_ = RootWindow(display_, screen_);
        
        initialized_ = true;
        utils::LogInfo("MouseKeyboardController initialized (Linux/XTest)");
        return true;
    }
    
    void Shutdown() override {
        if (display_) {
            XCloseDisplay(display_);
            display_ = nullptr;
        }
        initialized_ = false;
    }
    
    std::pair<int, int> GetMousePosition() override {
        if (!display_) return {0, 0};
        
        Window rootReturn, childReturn;
        int rootX, rootY, winX, winY;
        unsigned int mask;
        
        XQueryPointer(display_, root_, &rootReturn, &childReturn,
                      &rootX, &rootY, &winX, &winY, &mask);
        
        return {rootX, rootY};
    }
    
    bool MoveMouse(int x, int y) override {
        if (!display_) return false;
        
        XTestFakeMotionEvent(display_, screen_, x, y, CurrentTime);
        XFlush(display_);
        
        return true;
    }
    
    bool MoveMouseSmooth(int x, int y, int durationMs) override {
        auto [startX, startY] = GetMousePosition();
        
        int steps = std::max(1, durationMs / 16);
        int delayMs = durationMs / steps;
        
        for (int i = 1; i <= steps; ++i) {
            float t = static_cast<float>(i) / steps;
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
        if (!display_) return false;
        
        if (options.moveMouseFirst) {
            MoveMouse(x, y);
            Wait(10);
        }
        
        unsigned int button = Button1;  // Left
        if (options.button == MouseButton::Right) button = Button3;
        if (options.button == MouseButton::Middle) button = Button2;
        
        for (int i = 0; i < options.clickCount; ++i) {
            if (i > 0) Wait(options.delayBetweenClicks);
            
            XTestFakeButtonEvent(display_, button, True, CurrentTime);
            XFlush(display_);
            Wait(50);
            XTestFakeButtonEvent(display_, button, False, CurrentTime);
            XFlush(display_);
        }
        
        return true;
    }
    
    bool MouseDown(MouseButton button) override {
        if (!display_) return false;
        
        unsigned int xButton = Button1;
        if (button == MouseButton::Right) xButton = Button3;
        if (button == MouseButton::Middle) xButton = Button2;
        
        XTestFakeButtonEvent(display_, xButton, True, CurrentTime);
        XFlush(display_);
        
        return true;
    }
    
    bool MouseUp(MouseButton button) override {
        if (!display_) return false;
        
        unsigned int xButton = Button1;
        if (button == MouseButton::Right) xButton = Button3;
        if (button == MouseButton::Middle) xButton = Button2;
        
        XTestFakeButtonEvent(display_, xButton, False, CurrentTime);
        XFlush(display_);
        
        return true;
    }
    
    bool DragTo(int toX, int toY, MouseButton button) override {
        auto [fromX, fromY] = GetMousePosition();
        return Drag(fromX, fromY, toX, toY, button);
    }
    
    bool Drag(int fromX, int fromY, int toX, int toY, MouseButton button) override {
        MoveMouse(fromX, fromY);
        Wait(50);
        MouseDown(button);
        Wait(50);
        MoveMouseSmooth(toX, toY, 200);
        MouseUp(button);
        return true;
    }
    
    bool Scroll(const ScrollDelta& delta) override {
        if (!display_) return false;
        
        // Button 4 = scroll up, Button 5 = scroll down
        unsigned int button = (delta.deltaY > 0) ? Button5 : Button4;
        int clicks = std::abs(delta.deltaY) / 10;  // Convert to scroll clicks
        
        for (int i = 0; i < clicks; ++i) {
            XTestFakeButtonEvent(display_, button, True, CurrentTime);
            XTestFakeButtonEvent(display_, button, False, CurrentTime);
        }
        
        XFlush(display_);
        return true;
    }
    
    bool ScrollAt(int x, int y, const ScrollDelta& delta) override {
        MoveMouse(x, y);
        Wait(10);
        return Scroll(delta);
    }
    
    bool Type(const std::string& text, int delayMs) override {
        if (!display_) return false;
        
        for (char c : text) {
            KeySym keysym = c;
            KeyCode keycode = XKeysymToKeycode(display_, keysym);
            
            if (keycode == 0) continue;
            
            bool needsShift = CharNeedsShift(c);
            
            if (needsShift) {
                XTestFakeKeyEvent(display_, XKeysymToKeycode(display_, XK_Shift_L), 
                                  True, CurrentTime);
            }
            
            XTestFakeKeyEvent(display_, keycode, True, CurrentTime);
            XTestFakeKeyEvent(display_, keycode, False, CurrentTime);
            
            if (needsShift) {
                XTestFakeKeyEvent(display_, XKeysymToKeycode(display_, XK_Shift_L), 
                                  False, CurrentTime);
            }
            
            XFlush(display_);
            
            if (delayMs > 0) Wait(delayMs);
        }
        
        return true;
    }
    
    bool KeyPress(const std::string& keyCombo) override {
        if (!display_) return false;
        
        KeyCombo combo = ParseKeyCombo(keyCombo);
        
        // Press modifiers
        if (combo.modifiers & ModMeta) {
            XTestFakeKeyEvent(display_, XKeysymToKeycode(display_, XK_Super_L), 
                              True, CurrentTime);
        }
        if (combo.modifiers & ModCtrl) {
            XTestFakeKeyEvent(display_, XKeysymToKeycode(display_, XK_Control_L), 
                              True, CurrentTime);
        }
        if (combo.modifiers & ModAlt) {
            XTestFakeKeyEvent(display_, XKeysymToKeycode(display_, XK_Alt_L), 
                              True, CurrentTime);
        }
        if (combo.modifiers & ModShift) {
            XTestFakeKeyEvent(display_, XKeysymToKeycode(display_, XK_Shift_L), 
                              True, CurrentTime);
        }
        
        // Press key
        if (combo.keyCode != 0) {
            KeyCode keycode = XKeysymToKeycode(display_, combo.keyCode);
            if (keycode != 0) {
                XTestFakeKeyEvent(display_, keycode, True, CurrentTime);
                XTestFakeKeyEvent(display_, keycode, False, CurrentTime);
            }
        }
        
        // Release modifiers
        if (combo.modifiers & ModShift) {
            XTestFakeKeyEvent(display_, XKeysymToKeycode(display_, XK_Shift_L), 
                              False, CurrentTime);
        }
        if (combo.modifiers & ModAlt) {
            XTestFakeKeyEvent(display_, XKeysymToKeycode(display_, XK_Alt_L), 
                              False, CurrentTime);
        }
        if (combo.modifiers & ModCtrl) {
            XTestFakeKeyEvent(display_, XKeysymToKeycode(display_, XK_Control_L), 
                              False, CurrentTime);
        }
        if (combo.modifiers & ModMeta) {
            XTestFakeKeyEvent(display_, XKeysymToKeycode(display_, XK_Super_L), 
                              False, CurrentTime);
        }
        
        XFlush(display_);
        return true;
    }
    
    bool KeyDown(const std::string& key) override {
        if (!display_) return false;
        
        KeySym keysym = XStringToKeysym(key.c_str());
        if (keysym == NoSymbol) return false;
        
        KeyCode keycode = XKeysymToKeycode(display_, keysym);
        if (keycode == 0) return false;
        
        XTestFakeKeyEvent(display_, keycode, True, CurrentTime);
        XFlush(display_);
        
        return true;
    }
    
    bool KeyUp(const std::string& key) override {
        if (!display_) return false;
        
        KeySym keysym = XStringToKeysym(key.c_str());
        if (keysym == NoSymbol) return false;
        
        KeyCode keycode = XKeysymToKeycode(display_, keysym);
        if (keycode == 0) return false;
        
        XTestFakeKeyEvent(display_, keycode, False, CurrentTime);
        XFlush(display_);
        
        return true;
    }
    
    bool ModifiersDown(const std::vector<std::string>& modifiers) override {
        for (const auto& mod : modifiers) {
            KeyDown(mod);
        }
        return true;
    }
    
    bool ModifiersUp(const std::vector<std::string>& modifiers) override {
        for (const auto& mod : modifiers) {
            KeyUp(mod);
        }
        return true;
    }
    
    void Wait(int ms) override {
        utils::SleepMs(ms);
    }

private:
    bool initialized_ = false;
    Display* display_ = nullptr;
    int screen_ = 0;
    Window root_ = 0;
};

// Factory method
std::unique_ptr<MouseKeyboardController> MouseKeyboardController::Create() {
    return std::make_unique<MouseKeyboardControllerLinux>();
}

}  // namespace centris

#endif  // CENTRIS_PLATFORM_LINUX

