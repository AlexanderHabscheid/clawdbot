/**
 * Centris Native Control - Linux Window Controller
 * 
 * Uses X11 for window management.
 * This is a stub implementation - full implementation pending.
 */

#include "window_controller.h"
#include "utils.h"

#ifdef CENTRIS_PLATFORM_LINUX

#include <X11/Xlib.h>
#include <X11/Xatom.h>
#include <X11/Xutil.h>

namespace centris {

/**
 * Linux Window Controller Implementation (Stub)
 */
class WindowControllerLinux : public WindowController {
public:
    WindowControllerLinux() = default;
    ~WindowControllerLinux() override { Shutdown(); }
    
    bool Initialize() override {
        if (initialized_) return true;
        
        display_ = XOpenDisplay(nullptr);
        if (!display_) {
            utils::LogError("Failed to open X display");
            return false;
        }
        
        screen_ = DefaultScreen(display_);
        root_ = RootWindow(display_, screen_);
        
        initialized_ = true;
        utils::LogInfo("WindowController initialized (Linux/X11)");
        return true;
    }
    
    void Shutdown() override {
        if (display_) {
            XCloseDisplay(display_);
            display_ = nullptr;
        }
        initialized_ = false;
    }
    
    std::vector<WindowInfo> GetWindows(const std::string& appName) override {
        std::vector<WindowInfo> result;
        if (!display_) return result;
        
        // Get _NET_CLIENT_LIST to enumerate windows
        Atom netClientList = XInternAtom(display_, "_NET_CLIENT_LIST", False);
        Atom actualType;
        int actualFormat;
        unsigned long numItems, bytesAfter;
        unsigned char* data = nullptr;
        
        if (XGetWindowProperty(display_, root_, netClientList, 0, ~0L, False,
                               XA_WINDOW, &actualType, &actualFormat, &numItems,
                               &bytesAfter, &data) == Success && data) {
            Window* windows = reinterpret_cast<Window*>(data);
            
            for (unsigned long i = 0; i < numItems; ++i) {
                auto infoOpt = GetWindowInfo(windows[i]);
                if (infoOpt) {
                    if (appName.empty() || 
                        utils::ContainsIgnoreCase(infoOpt->appName, appName) ||
                        utils::ContainsIgnoreCase(infoOpt->title, appName)) {
                        result.push_back(*infoOpt);
                    }
                }
            }
            
            XFree(data);
        }
        
        return result;
    }
    
    std::optional<WindowInfo> GetFrontmostWindow() override {
        if (!display_) return std::nullopt;
        
        // Get _NET_ACTIVE_WINDOW
        Atom netActiveWindow = XInternAtom(display_, "_NET_ACTIVE_WINDOW", False);
        Atom actualType;
        int actualFormat;
        unsigned long numItems, bytesAfter;
        unsigned char* data = nullptr;
        
        if (XGetWindowProperty(display_, root_, netActiveWindow, 0, 1, False,
                               XA_WINDOW, &actualType, &actualFormat, &numItems,
                               &bytesAfter, &data) == Success && data && numItems > 0) {
            Window activeWindow = *reinterpret_cast<Window*>(data);
            XFree(data);
            return GetWindowInfo(activeWindow);
        }
        
        return std::nullopt;
    }
    
    std::optional<WindowInfo> GetWindow(int64_t windowId) override {
        return GetWindowInfo(static_cast<Window>(windowId));
    }
    
    std::vector<WindowInfo> GetWindowsForApp(const std::string& appName) override {
        return GetWindows(appName);
    }
    
    std::optional<WindowInfo> GetWindowAtPoint(int x, int y) override {
        if (!display_) return std::nullopt;
        
        Window child;
        int destX, destY;
        
        if (XTranslateCoordinates(display_, root_, root_, x, y, 
                                   &destX, &destY, &child) && child != None) {
            return GetWindowInfo(child);
        }
        
        return std::nullopt;
    }
    
    bool FocusWindow(int64_t windowId) override {
        if (!display_) return false;
        
        Window window = static_cast<Window>(windowId);
        
        // Use _NET_ACTIVE_WINDOW to properly activate window
        XEvent event = {};
        event.xclient.type = ClientMessage;
        event.xclient.window = window;
        event.xclient.message_type = XInternAtom(display_, "_NET_ACTIVE_WINDOW", False);
        event.xclient.format = 32;
        event.xclient.data.l[0] = 1;  // Source indication
        event.xclient.data.l[1] = CurrentTime;
        
        XSendEvent(display_, root_, False,
                   SubstructureRedirectMask | SubstructureNotifyMask, &event);
        XFlush(display_);
        
        return true;
    }
    
    bool MoveWindow(int64_t windowId, int x, int y) override {
        if (!display_) return false;
        
        XMoveWindow(display_, static_cast<Window>(windowId), x, y);
        XFlush(display_);
        
        return true;
    }
    
    bool ResizeWindow(int64_t windowId, int width, int height) override {
        if (!display_) return false;
        
        XResizeWindow(display_, static_cast<Window>(windowId), width, height);
        XFlush(display_);
        
        return true;
    }
    
    bool SetWindowBounds(int64_t windowId, int x, int y, int width, int height) override {
        if (!display_) return false;
        
        XMoveResizeWindow(display_, static_cast<Window>(windowId), x, y, width, height);
        XFlush(display_);
        
        return true;
    }
    
    bool MinimizeWindow(int64_t windowId) override {
        if (!display_) return false;
        
        XIconifyWindow(display_, static_cast<Window>(windowId), screen_);
        XFlush(display_);
        
        return true;
    }
    
    bool MaximizeWindow(int64_t windowId) override {
        if (!display_) return false;
        
        // Use _NET_WM_STATE to maximize
        SendWindowStateEvent(static_cast<Window>(windowId), "_NET_WM_STATE_MAXIMIZED_VERT", true);
        SendWindowStateEvent(static_cast<Window>(windowId), "_NET_WM_STATE_MAXIMIZED_HORZ", true);
        
        return true;
    }
    
    bool RestoreWindow(int64_t windowId) override {
        if (!display_) return false;
        
        // Map window (unminimize)
        XMapWindow(display_, static_cast<Window>(windowId));
        
        // Remove maximized state
        SendWindowStateEvent(static_cast<Window>(windowId), "_NET_WM_STATE_MAXIMIZED_VERT", false);
        SendWindowStateEvent(static_cast<Window>(windowId), "_NET_WM_STATE_MAXIMIZED_HORZ", false);
        
        XFlush(display_);
        
        return true;
    }
    
    bool CloseWindow(int64_t windowId) override {
        if (!display_) return false;
        
        // Send WM_DELETE_WINDOW message
        XEvent event = {};
        event.xclient.type = ClientMessage;
        event.xclient.window = static_cast<Window>(windowId);
        event.xclient.message_type = XInternAtom(display_, "WM_PROTOCOLS", False);
        event.xclient.format = 32;
        event.xclient.data.l[0] = XInternAtom(display_, "WM_DELETE_WINDOW", False);
        event.xclient.data.l[1] = CurrentTime;
        
        XSendEvent(display_, static_cast<Window>(windowId), False, NoEventMask, &event);
        XFlush(display_);
        
        return true;
    }
    
    bool ToggleFullscreen(int64_t windowId) override {
        if (!display_) return false;
        
        // Toggle _NET_WM_STATE_FULLSCREEN
        XEvent event = {};
        event.xclient.type = ClientMessage;
        event.xclient.window = static_cast<Window>(windowId);
        event.xclient.message_type = XInternAtom(display_, "_NET_WM_STATE", False);
        event.xclient.format = 32;
        event.xclient.data.l[0] = 2;  // Toggle
        event.xclient.data.l[1] = XInternAtom(display_, "_NET_WM_STATE_FULLSCREEN", False);
        
        XSendEvent(display_, root_, False,
                   SubstructureRedirectMask | SubstructureNotifyMask, &event);
        XFlush(display_);
        
        return true;
    }
    
    bool IsMinimized(int64_t windowId) override {
        if (!display_) return false;
        
        // Check WM_STATE property
        Atom wmState = XInternAtom(display_, "WM_STATE", False);
        Atom actualType;
        int actualFormat;
        unsigned long numItems, bytesAfter;
        unsigned char* data = nullptr;
        
        if (XGetWindowProperty(display_, static_cast<Window>(windowId), wmState,
                               0, 2, False, wmState, &actualType, &actualFormat,
                               &numItems, &bytesAfter, &data) == Success && data) {
            long state = *reinterpret_cast<long*>(data);
            XFree(data);
            return state == 3;  // IconicState
        }
        
        return false;
    }
    
    bool IsMaximized(int64_t windowId) override {
        return HasWindowState(static_cast<Window>(windowId), "_NET_WM_STATE_MAXIMIZED_VERT") &&
               HasWindowState(static_cast<Window>(windowId), "_NET_WM_STATE_MAXIMIZED_HORZ");
    }
    
    bool IsFullscreen(int64_t windowId) override {
        return HasWindowState(static_cast<Window>(windowId), "_NET_WM_STATE_FULLSCREEN");
    }
    
    bool IsFocused(int64_t windowId) override {
        auto frontOpt = GetFrontmostWindow();
        return frontOpt && frontOpt->id == windowId;
    }

private:
    bool initialized_ = false;
    Display* display_ = nullptr;
    int screen_ = 0;
    Window root_ = 0;
    
    std::optional<WindowInfo> GetWindowInfo(Window window) {
        if (!display_ || window == None) return std::nullopt;
        
        WindowInfo info;
        info.id = window;
        
        // Get window name
        char* name = nullptr;
        if (XFetchName(display_, window, &name) && name) {
            info.title = name;
            XFree(name);
        }
        
        // Skip windows without titles
        if (info.title.empty()) return std::nullopt;
        
        // Get window geometry
        Window rootReturn;
        int x, y;
        unsigned int width, height, border, depth;
        if (XGetGeometry(display_, window, &rootReturn, &x, &y, 
                         &width, &height, &border, &depth)) {
            // Convert to screen coordinates
            int screenX, screenY;
            Window childReturn;
            XTranslateCoordinates(display_, window, root_, 0, 0, 
                                  &screenX, &screenY, &childReturn);
            
            info.bounds.x = screenX;
            info.bounds.y = screenY;
            info.bounds.width = width;
            info.bounds.height = height;
        }
        
        // Get WM_CLASS for app name
        XClassHint classHint;
        if (XGetClassHint(display_, window, &classHint)) {
            if (classHint.res_name) {
                info.appName = classHint.res_name;
                XFree(classHint.res_name);
            }
            if (classHint.res_class) {
                XFree(classHint.res_class);
            }
        }
        
        // Get PID
        Atom netWmPid = XInternAtom(display_, "_NET_WM_PID", False);
        Atom actualType;
        int actualFormat;
        unsigned long numItems, bytesAfter;
        unsigned char* data = nullptr;
        
        if (XGetWindowProperty(display_, window, netWmPid, 0, 1, False,
                               XA_CARDINAL, &actualType, &actualFormat, &numItems,
                               &bytesAfter, &data) == Success && data) {
            info.appPid = *reinterpret_cast<unsigned long*>(data);
            XFree(data);
        }
        
        info.minimized = IsMinimized(window);
        
        auto frontOpt = GetFrontmostWindow();
        info.focused = frontOpt && frontOpt->id == window;
        
        return info;
    }
    
    void SendWindowStateEvent(Window window, const char* stateName, bool add) {
        XEvent event = {};
        event.xclient.type = ClientMessage;
        event.xclient.window = window;
        event.xclient.message_type = XInternAtom(display_, "_NET_WM_STATE", False);
        event.xclient.format = 32;
        event.xclient.data.l[0] = add ? 1 : 0;  // Add or remove
        event.xclient.data.l[1] = XInternAtom(display_, stateName, False);
        
        XSendEvent(display_, root_, False,
                   SubstructureRedirectMask | SubstructureNotifyMask, &event);
    }
    
    bool HasWindowState(Window window, const char* stateName) {
        Atom netWmState = XInternAtom(display_, "_NET_WM_STATE", False);
        Atom stateAtom = XInternAtom(display_, stateName, False);
        
        Atom actualType;
        int actualFormat;
        unsigned long numItems, bytesAfter;
        unsigned char* data = nullptr;
        
        if (XGetWindowProperty(display_, window, netWmState, 0, ~0L, False,
                               XA_ATOM, &actualType, &actualFormat, &numItems,
                               &bytesAfter, &data) == Success && data) {
            Atom* atoms = reinterpret_cast<Atom*>(data);
            for (unsigned long i = 0; i < numItems; ++i) {
                if (atoms[i] == stateAtom) {
                    XFree(data);
                    return true;
                }
            }
            XFree(data);
        }
        
        return false;
    }
};

// Factory method
std::unique_ptr<WindowController> WindowController::Create() {
    return std::make_unique<WindowControllerLinux>();
}

}  // namespace centris

#endif  // CENTRIS_PLATFORM_LINUX

