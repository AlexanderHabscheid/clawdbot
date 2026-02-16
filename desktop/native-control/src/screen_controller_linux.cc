/**
 * Centris Native Control - Linux Screen Controller
 * 
 * Uses X11/Xrandr for display management.
 * This is a stub implementation - full implementation pending.
 */

#include "screen_controller.h"
#include "utils.h"

#ifdef CENTRIS_PLATFORM_LINUX

#include <X11/Xlib.h>
#include <X11/extensions/Xrandr.h>

namespace centris {

/**
 * Linux Screen Controller Implementation (Stub)
 */
class ScreenControllerLinux : public ScreenController {
public:
    ScreenControllerLinux() = default;
    ~ScreenControllerLinux() override { Shutdown(); }
    
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
        utils::LogInfo("ScreenController initialized (Linux/Xrandr)");
        return true;
    }
    
    void Shutdown() override {
        if (display_) {
            XCloseDisplay(display_);
            display_ = nullptr;
        }
        initialized_ = false;
    }
    
    std::vector<DisplayInfo> GetDisplays() override {
        std::vector<DisplayInfo> result;
        if (!display_) return result;
        
        XRRScreenResources* resources = XRRGetScreenResources(display_, root_);
        if (!resources) return result;
        
        for (int i = 0; i < resources->ncrtc; ++i) {
            XRRCrtcInfo* crtcInfo = XRRGetCrtcInfo(display_, resources, resources->crtcs[i]);
            if (!crtcInfo || crtcInfo->width == 0 || crtcInfo->height == 0) {
                if (crtcInfo) XRRFreeCrtcInfo(crtcInfo);
                continue;
            }
            
            DisplayInfo info;
            info.id = resources->crtcs[i];
            info.bounds.x = crtcInfo->x;
            info.bounds.y = crtcInfo->y;
            info.bounds.width = crtcInfo->width;
            info.bounds.height = crtcInfo->height;
            
            // Work area (same as bounds for now - TODO: subtract panels)
            info.workArea = info.bounds;
            
            // Primary is the first monitor (simplified)
            info.isPrimary = (i == 0);
            
            // Scale factor (TODO: get from XRandR or DPI)
            info.scaleFactor = 1.0;
            
            // Get output name
            if (crtcInfo->noutput > 0) {
                XRROutputInfo* outputInfo = XRRGetOutputInfo(display_, resources, crtcInfo->outputs[0]);
                if (outputInfo) {
                    info.name = outputInfo->name;
                    XRRFreeOutputInfo(outputInfo);
                }
            }
            
            result.push_back(info);
            XRRFreeCrtcInfo(crtcInfo);
        }
        
        XRRFreeScreenResources(resources);
        return result;
    }
    
    DisplayInfo GetPrimaryDisplay() override {
        auto displays = GetDisplays();
        for (const auto& display : displays) {
            if (display.isPrimary) {
                return display;
            }
        }
        
        // Fallback to first display or empty
        if (!displays.empty()) {
            return displays[0];
        }
        
        // Return default display info
        DisplayInfo info;
        if (display_) {
            info.id = 0;
            info.bounds.x = 0;
            info.bounds.y = 0;
            info.bounds.width = DisplayWidth(display_, screen_);
            info.bounds.height = DisplayHeight(display_, screen_);
            info.workArea = info.bounds;
            info.isPrimary = true;
            info.scaleFactor = 1.0;
        }
        return info;
    }
    
    std::optional<DisplayInfo> GetDisplay(int64_t displayId) override {
        auto displays = GetDisplays();
        for (const auto& display : displays) {
            if (display.id == displayId) {
                return display;
            }
        }
        return std::nullopt;
    }
    
    std::optional<DisplayInfo> GetDisplayAtPoint(int x, int y) override {
        auto displays = GetDisplays();
        for (const auto& display : displays) {
            if (display.bounds.contains(x, y)) {
                return display;
            }
        }
        return std::nullopt;
    }
    
    std::optional<DisplayInfo> GetDisplayForWindow(int64_t windowId) override {
        if (!display_) return std::nullopt;
        
        Window window = static_cast<Window>(windowId);
        
        // Get window geometry
        Window rootReturn;
        int x, y;
        unsigned int width, height, border, depth;
        if (XGetGeometry(display_, window, &rootReturn, &x, &y, 
                         &width, &height, &border, &depth)) {
            // Get screen coordinates
            int screenX, screenY;
            Window childReturn;
            XTranslateCoordinates(display_, window, root_, 0, 0, 
                                  &screenX, &screenY, &childReturn);
            
            // Find display containing window center
            int centerX = screenX + width / 2;
            int centerY = screenY + height / 2;
            
            return GetDisplayAtPoint(centerX, centerY);
        }
        
        return std::nullopt;
    }
    
    std::pair<int, int> LogicalToPhysical(int x, int y) override {
        auto displayOpt = GetDisplayAtPoint(x, y);
        if (!displayOpt) return {x, y};
        
        double scale = displayOpt->scaleFactor;
        return {static_cast<int>(x * scale), static_cast<int>(y * scale)};
    }
    
    std::pair<int, int> PhysicalToLogical(int x, int y) override {
        auto displayOpt = GetDisplayAtPoint(x, y);
        if (!displayOpt) return {x, y};
        
        double scale = displayOpt->scaleFactor;
        return {static_cast<int>(x / scale), static_cast<int>(y / scale)};
    }
    
    double GetScaleFactorAtPoint(int x, int y) override {
        auto displayOpt = GetDisplayAtPoint(x, y);
        return displayOpt ? displayOpt->scaleFactor : 1.0;
    }
    
    Bounds GetTotalBounds() override {
        Bounds result;
        auto displays = GetDisplays();
        
        if (displays.empty()) {
            if (display_) {
                result.x = 0;
                result.y = 0;
                result.width = DisplayWidth(display_, screen_);
                result.height = DisplayHeight(display_, screen_);
            }
            return result;
        }
        
        int minX = INT_MAX, minY = INT_MAX;
        int maxX = INT_MIN, maxY = INT_MIN;
        
        for (const auto& display : displays) {
            minX = std::min(minX, display.bounds.x);
            minY = std::min(minY, display.bounds.y);
            maxX = std::max(maxX, display.bounds.x + display.bounds.width);
            maxY = std::max(maxY, display.bounds.y + display.bounds.height);
        }
        
        result.x = minX;
        result.y = minY;
        result.width = maxX - minX;
        result.height = maxY - minY;
        
        return result;
    }
    
    int GetMenuBarHeight() override {
        // Linux doesn't have a global menu bar (except in some DEs like Unity)
        return 0;
    }
    
    Bounds GetDockBounds() override {
        // TODO: Detect dock/panel position from _NET_WORKAREA
        return Bounds{};
    }

private:
    bool initialized_ = false;
    Display* display_ = nullptr;
    int screen_ = 0;
    Window root_ = 0;
};

// Factory method
std::unique_ptr<ScreenController> ScreenController::Create() {
    return std::make_unique<ScreenControllerLinux>();
}

}  // namespace centris

#endif  // CENTRIS_PLATFORM_LINUX

