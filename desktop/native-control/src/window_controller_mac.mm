/**
 * Centris Native Control - macOS Window Controller
 * 
 * Uses CGWindowList and NSWorkspace for window management.
 */

#include "window_controller.h"
#include "accessibility_controller.h"
#include "utils.h"

#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>

namespace centris {

/**
 * macOS Window Controller Implementation
 */
class WindowControllerMac : public WindowController {
public:
    WindowControllerMac() = default;
    ~WindowControllerMac() override { Shutdown(); }
    
    bool Initialize() override {
        if (initialized_) return true;
        initialized_ = true;
        utils::LogInfo("WindowController initialized (macOS)");
        return true;
    }
    
    void Shutdown() override {
        initialized_ = false;
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // Window Enumeration
    // ═══════════════════════════════════════════════════════════════════════
    
    std::vector<WindowInfo> GetWindows(const std::string& appName) override {
        std::vector<WindowInfo> result;
        
        // Get all windows using CGWindowList
        CFArrayRef windowList = CGWindowListCopyWindowInfo(
            kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
            kCGNullWindowID
        );
        
        if (!windowList) return result;
        
        NSRunningApplication* frontApp = [[NSWorkspace sharedWorkspace] frontmostApplication];
        pid_t frontPid = frontApp ? [frontApp processIdentifier] : 0;
        
        CFIndex count = CFArrayGetCount(windowList);
        for (CFIndex i = 0; i < count; i++) {
            CFDictionaryRef window = (CFDictionaryRef)CFArrayGetValueAtIndex(windowList, i);
            
            // Get window properties
            CFNumberRef windowIdRef = (CFNumberRef)CFDictionaryGetValue(window, kCGWindowNumber);
            CFStringRef nameRef = (CFStringRef)CFDictionaryGetValue(window, kCGWindowName);
            CFStringRef ownerRef = (CFStringRef)CFDictionaryGetValue(window, kCGWindowOwnerName);
            CFNumberRef pidRef = (CFNumberRef)CFDictionaryGetValue(window, kCGWindowOwnerPID);
            CFDictionaryRef boundsRef = (CFDictionaryRef)CFDictionaryGetValue(window, kCGWindowBounds);
            CFNumberRef layerRef = (CFNumberRef)CFDictionaryGetValue(window, kCGWindowLayer);
            
            // Filter by app name if specified
            if (!appName.empty() && ownerRef) {
                std::string ownerName = utils::CFStringToStdString(ownerRef);
                if (!utils::ContainsIgnoreCase(ownerName, appName)) {
                    continue;
                }
            }
            
            WindowInfo info;
            
            // Window ID
            if (windowIdRef) {
                int32_t windowId = 0;
                CFNumberGetValue(windowIdRef, kCFNumberSInt32Type, &windowId);
                info.id = windowId;
            }
            
            // Title
            if (nameRef) {
                info.title = utils::CFStringToStdString(nameRef);
            }
            
            // Skip windows without titles (usually system windows)
            if (info.title.empty()) continue;
            
            // Owner/App name
            if (ownerRef) {
                info.appName = utils::CFStringToStdString(ownerRef);
            }
            
            // PID
            if (pidRef) {
                int32_t pid = 0;
                CFNumberGetValue(pidRef, kCFNumberSInt32Type, &pid);
                info.appPid = pid;
                info.focused = (pid == frontPid);
            }
            
            // Bounds
            if (boundsRef) {
                CGRect rect;
                CGRectMakeWithDictionaryRepresentation(boundsRef, &rect);
                info.bounds.x = static_cast<int>(rect.origin.x);
                info.bounds.y = static_cast<int>(rect.origin.y);
                info.bounds.width = static_cast<int>(rect.size.width);
                info.bounds.height = static_cast<int>(rect.size.height);
            }
            
            // Layer
            if (layerRef) {
                int32_t layer = 0;
                CFNumberGetValue(layerRef, kCFNumberSInt32Type, &layer);
                info.layer = layer;
            }
            
            // Get bundle ID
            NSRunningApplication* app = [NSRunningApplication 
                runningApplicationWithProcessIdentifier:static_cast<pid_t>(info.appPid)];
            if (app) {
                info.appBundleId = [[app bundleIdentifier] UTF8String] ?: "";
            }
            
            result.push_back(info);
        }
        
        CFRelease(windowList);
        return result;
    }
    
    std::optional<WindowInfo> GetFrontmostWindow() override {
        NSRunningApplication* frontApp = [[NSWorkspace sharedWorkspace] frontmostApplication];
        if (!frontApp) return std::nullopt;
        
        auto windows = GetWindowsForApp([[frontApp localizedName] UTF8String]);
        if (windows.empty()) return std::nullopt;
        
        // Return first (topmost) window
        windows[0].focused = true;
        return windows[0];
    }
    
    std::optional<WindowInfo> GetWindow(int64_t windowId) override {
        auto windows = GetWindows("");
        for (const auto& window : windows) {
            if (window.id == windowId) {
                return window;
            }
        }
        return std::nullopt;
    }
    
    std::vector<WindowInfo> GetWindowsForApp(const std::string& appName) override {
        return GetWindows(appName);
    }
    
    std::optional<WindowInfo> GetWindowAtPoint(int x, int y) override {
        auto windows = GetWindows("");
        
        // Windows are in front-to-back order
        for (const auto& window : windows) {
            if (window.bounds.contains(x, y)) {
                return window;
            }
        }
        
        return std::nullopt;
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // Window Actions (via Accessibility API)
    // ═══════════════════════════════════════════════════════════════════════
    
    bool FocusWindow(int64_t windowId) override {
        auto windowOpt = GetWindow(windowId);
        if (!windowOpt) return false;
        
        const WindowInfo& window = *windowOpt;
        
        // Activate the app
        NSRunningApplication* app = [NSRunningApplication 
            runningApplicationWithProcessIdentifier:static_cast<pid_t>(window.appPid)];
        if (!app) return false;
        
        [app activateWithOptions:NSApplicationActivateIgnoringOtherApps];
        
        // Raise the window via accessibility API
        AXUIElementRef appElement = AXUIElementCreateApplication(static_cast<pid_t>(window.appPid));
        if (!appElement) return false;
        
        CFArrayRef windows = nullptr;
        AXUIElementCopyAttributeValue(appElement, kAXWindowsAttribute, (CFTypeRef*)&windows);
        
        if (windows) {
            for (CFIndex i = 0; i < CFArrayGetCount(windows); i++) {
                AXUIElementRef axWindow = (AXUIElementRef)CFArrayGetValueAtIndex(windows, i);
                
                // Get window title to match
                CFStringRef titleRef = nullptr;
                AXUIElementCopyAttributeValue(axWindow, kAXTitleAttribute, (CFTypeRef*)&titleRef);
                
                if (titleRef) {
                    std::string title = utils::CFStringToStdString(titleRef);
                    CFRelease(titleRef);
                    
                    if (title == window.title) {
                        AXUIElementPerformAction(axWindow, kAXRaiseAction);
                        break;
                    }
                }
            }
            CFRelease(windows);
        }
        
        CFRelease(appElement);
        return true;
    }
    
    bool MoveWindow(int64_t windowId, int x, int y) override {
        AXUIElementRef axWindow = GetAXWindowById(windowId);
        if (!axWindow) return false;
        
        CGPoint point = CGPointMake(x, y);
        AXValueRef positionValue = AXValueCreate(kAXValueTypeCGPoint, &point);
        
        AXError error = AXUIElementSetAttributeValue(axWindow, kAXPositionAttribute, positionValue);
        
        CFRelease(positionValue);
        CFRelease(axWindow);
        
        return error == kAXErrorSuccess;
    }
    
    bool ResizeWindow(int64_t windowId, int width, int height) override {
        AXUIElementRef axWindow = GetAXWindowById(windowId);
        if (!axWindow) return false;
        
        CGSize size = CGSizeMake(width, height);
        AXValueRef sizeValue = AXValueCreate(kAXValueTypeCGSize, &size);
        
        AXError error = AXUIElementSetAttributeValue(axWindow, kAXSizeAttribute, sizeValue);
        
        CFRelease(sizeValue);
        CFRelease(axWindow);
        
        return error == kAXErrorSuccess;
    }
    
    bool SetWindowBounds(int64_t windowId, int x, int y, int width, int height) override {
        bool moved = MoveWindow(windowId, x, y);
        bool resized = ResizeWindow(windowId, width, height);
        return moved && resized;
    }
    
    bool MinimizeWindow(int64_t windowId) override {
        AXUIElementRef axWindow = GetAXWindowById(windowId);
        if (!axWindow) return false;
        
        AXError error = AXUIElementSetAttributeValue(axWindow, kAXMinimizedAttribute, kCFBooleanTrue);
        CFRelease(axWindow);
        
        return error == kAXErrorSuccess;
    }
    
    bool MaximizeWindow(int64_t windowId) override {
        AXUIElementRef axWindow = GetAXWindowById(windowId);
        if (!axWindow) return false;
        
        // Press zoom button
        AXUIElementRef zoomButton = nullptr;
        AXUIElementCopyAttributeValue(axWindow, kAXZoomButtonAttribute, (CFTypeRef*)&zoomButton);
        
        if (zoomButton) {
            AXUIElementPerformAction(zoomButton, kAXPressAction);
            CFRelease(zoomButton);
        }
        
        CFRelease(axWindow);
        return zoomButton != nullptr;
    }
    
    bool RestoreWindow(int64_t windowId) override {
        AXUIElementRef axWindow = GetAXWindowById(windowId);
        if (!axWindow) return false;
        
        AXError error = AXUIElementSetAttributeValue(axWindow, kAXMinimizedAttribute, kCFBooleanFalse);
        CFRelease(axWindow);
        
        return error == kAXErrorSuccess;
    }
    
    bool CloseWindow(int64_t windowId) override {
        AXUIElementRef axWindow = GetAXWindowById(windowId);
        if (!axWindow) return false;
        
        AXUIElementRef closeButton = nullptr;
        AXUIElementCopyAttributeValue(axWindow, kAXCloseButtonAttribute, (CFTypeRef*)&closeButton);
        
        if (closeButton) {
            AXUIElementPerformAction(closeButton, kAXPressAction);
            CFRelease(closeButton);
        }
        
        CFRelease(axWindow);
        return closeButton != nullptr;
    }
    
    bool ToggleFullscreen(int64_t windowId) override {
        AXUIElementRef axWindow = GetAXWindowById(windowId);
        if (!axWindow) return false;
        
        AXUIElementRef fullscreenButton = nullptr;
        AXUIElementCopyAttributeValue(axWindow, kAXFullScreenButtonAttribute, (CFTypeRef*)&fullscreenButton);
        
        if (fullscreenButton) {
            AXUIElementPerformAction(fullscreenButton, kAXPressAction);
            CFRelease(fullscreenButton);
        }
        
        CFRelease(axWindow);
        return fullscreenButton != nullptr;
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // Window State
    // ═══════════════════════════════════════════════════════════════════════
    
    bool IsMinimized(int64_t windowId) override {
        AXUIElementRef axWindow = GetAXWindowById(windowId);
        if (!axWindow) return false;
        
        CFBooleanRef minimized = nullptr;
        AXUIElementCopyAttributeValue(axWindow, kAXMinimizedAttribute, (CFTypeRef*)&minimized);
        CFRelease(axWindow);
        
        bool result = minimized && CFBooleanGetValue(minimized);
        if (minimized) CFRelease(minimized);
        
        return result;
    }
    
    bool IsMaximized(int64_t windowId) override {
        // macOS doesn't have a direct "maximized" state like Windows
        // Check if window fills the screen work area
        auto windowOpt = GetWindow(windowId);
        if (!windowOpt) return false;
        
        NSScreen* screen = [NSScreen mainScreen];
        NSRect visibleFrame = [screen visibleFrame];
        
        const auto& bounds = windowOpt->bounds;
        return bounds.width >= static_cast<int>(visibleFrame.size.width) - 10 &&
               bounds.height >= static_cast<int>(visibleFrame.size.height) - 10;
    }
    
    bool IsFullscreen(int64_t windowId) override {
        AXUIElementRef axWindow = GetAXWindowById(windowId);
        if (!axWindow) return false;
        
        CFStringRef subroleRef = nullptr;
        AXUIElementCopyAttributeValue(axWindow, kAXSubroleAttribute, (CFTypeRef*)&subroleRef);
        CFRelease(axWindow);
        
        bool result = false;
        if (subroleRef) {
            std::string subrole = utils::CFStringToStdString(subroleRef);
            result = subrole == "AXFullScreenWindow";
            CFRelease(subroleRef);
        }
        
        return result;
    }
    
    bool IsFocused(int64_t windowId) override {
        auto frontWindow = GetFrontmostWindow();
        return frontWindow && frontWindow->id == windowId;
    }

private:
    bool initialized_ = false;
    
    AXUIElementRef GetAXWindowById(int64_t windowId) {
        auto windowOpt = GetWindow(windowId);
        if (!windowOpt) return nullptr;
        
        const WindowInfo& window = *windowOpt;
        
        AXUIElementRef appElement = AXUIElementCreateApplication(static_cast<pid_t>(window.appPid));
        if (!appElement) return nullptr;
        
        CFArrayRef windows = nullptr;
        AXUIElementCopyAttributeValue(appElement, kAXWindowsAttribute, (CFTypeRef*)&windows);
        CFRelease(appElement);
        
        if (!windows) return nullptr;
        
        AXUIElementRef result = nullptr;
        for (CFIndex i = 0; i < CFArrayGetCount(windows); i++) {
            AXUIElementRef axWindow = (AXUIElementRef)CFArrayGetValueAtIndex(windows, i);
            
            CFStringRef titleRef = nullptr;
            AXUIElementCopyAttributeValue(axWindow, kAXTitleAttribute, (CFTypeRef*)&titleRef);
            
            if (titleRef) {
                std::string title = utils::CFStringToStdString(titleRef);
                CFRelease(titleRef);
                
                if (title == window.title) {
                    CFRetain(axWindow);
                    result = axWindow;
                    break;
                }
            }
        }
        
        CFRelease(windows);
        return result;
    }
};

// Factory method
std::unique_ptr<WindowController> WindowController::Create() {
    return std::make_unique<WindowControllerMac>();
}

}  // namespace centris

