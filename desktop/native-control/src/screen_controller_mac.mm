/**
 * Centris Native Control - macOS Screen Controller
 * 
 * Uses NSScreen and CGDisplay for display management.
 */

#include "screen_controller.h"
#include "utils.h"

#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>

namespace centris {

/**
 * macOS Screen Controller Implementation
 */
class ScreenControllerMac : public ScreenController {
public:
    ScreenControllerMac() = default;
    ~ScreenControllerMac() override { Shutdown(); }
    
    bool Initialize() override {
        if (initialized_) return true;
        initialized_ = true;
        utils::LogInfo("ScreenController initialized (macOS)");
        return true;
    }
    
    void Shutdown() override {
        initialized_ = false;
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // Display Enumeration
    // ═══════════════════════════════════════════════════════════════════════
    
    std::vector<DisplayInfo> GetDisplays() override {
        std::vector<DisplayInfo> result;
        
        NSArray* screens = [NSScreen screens];
        NSScreen* mainScreen = [NSScreen mainScreen];
        
        for (NSScreen* screen in screens) {
            DisplayInfo info = ScreenToDisplayInfo(screen, screen == mainScreen);
            result.push_back(info);
        }
        
        return result;
    }
    
    DisplayInfo GetPrimaryDisplay() override {
        NSScreen* mainScreen = [NSScreen mainScreen];
        return ScreenToDisplayInfo(mainScreen, true);
    }
    
    std::optional<DisplayInfo> GetDisplay(int64_t displayId) override {
        CGDirectDisplayID cgDisplayId = static_cast<CGDirectDisplayID>(displayId);
        
        NSArray* screens = [NSScreen screens];
        for (NSScreen* screen in screens) {
            NSDictionary* description = [screen deviceDescription];
            NSNumber* screenNumber = [description objectForKey:@"NSScreenNumber"];
            
            if (screenNumber && [screenNumber unsignedIntValue] == cgDisplayId) {
                return ScreenToDisplayInfo(screen, screen == [NSScreen mainScreen]);
            }
        }
        
        return std::nullopt;
    }
    
    std::optional<DisplayInfo> GetDisplayAtPoint(int x, int y) override {
        NSPoint point = NSMakePoint(x, y);
        
        NSArray* screens = [NSScreen screens];
        for (NSScreen* screen in screens) {
            NSRect frame = [screen frame];
            // NSScreen uses bottom-left origin, convert
            NSRect flipped = frame;
            flipped.origin.y = [[NSScreen screens][0] frame].size.height - frame.origin.y - frame.size.height;
            
            if (NSPointInRect(point, flipped) || NSPointInRect(NSMakePoint(x, frame.origin.y + frame.size.height - y), frame)) {
                return ScreenToDisplayInfo(screen, screen == [NSScreen mainScreen]);
            }
        }
        
        return std::nullopt;
    }
    
    std::optional<DisplayInfo> GetDisplayForWindow(int64_t windowId) override {
        // Get window bounds from CGWindowList
        CGWindowID windowIds[] = { static_cast<CGWindowID>(windowId) };
        CFArrayRef windowIdArray = CFArrayCreate(nullptr, (const void**)windowIds, 1, nullptr);
        
        CFArrayRef windowList = CGWindowListCreateDescriptionFromArray(windowIdArray);
        CFRelease(windowIdArray);
        
        if (!windowList || CFArrayGetCount(windowList) == 0) {
            if (windowList) CFRelease(windowList);
            return std::nullopt;
        }
        
        CFDictionaryRef window = (CFDictionaryRef)CFArrayGetValueAtIndex(windowList, 0);
        CFDictionaryRef boundsDict = (CFDictionaryRef)CFDictionaryGetValue(window, kCGWindowBounds);
        
        CGRect windowRect;
        CGRectMakeWithDictionaryRepresentation(boundsDict, &windowRect);
        CFRelease(windowList);
        
        // Find screen containing window center
        int centerX = static_cast<int>(windowRect.origin.x + windowRect.size.width / 2);
        int centerY = static_cast<int>(windowRect.origin.y + windowRect.size.height / 2);
        
        return GetDisplayAtPoint(centerX, centerY);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // Coordinate Conversion
    // ═══════════════════════════════════════════════════════════════════════
    
    std::pair<int, int> LogicalToPhysical(int x, int y) override {
        // Find display containing point
        auto displayOpt = GetDisplayAtPoint(x, y);
        if (!displayOpt) {
            return {x, y};  // No conversion if not on any display
        }
        
        double scale = displayOpt->scaleFactor;
        return {static_cast<int>(x * scale), static_cast<int>(y * scale)};
    }
    
    std::pair<int, int> PhysicalToLogical(int x, int y) override {
        // This is approximate - we'd need to know which display the physical coords are on
        NSScreen* mainScreen = [NSScreen mainScreen];
        double scale = [mainScreen backingScaleFactor];
        return {static_cast<int>(x / scale), static_cast<int>(y / scale)};
    }
    
    double GetScaleFactorAtPoint(int x, int y) override {
        auto displayOpt = GetDisplayAtPoint(x, y);
        if (!displayOpt) {
            return 1.0;
        }
        return displayOpt->scaleFactor;
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // Screen Bounds
    // ═══════════════════════════════════════════════════════════════════════
    
    Bounds GetTotalBounds() override {
        Bounds result;
        int minX = INT_MAX, minY = INT_MAX;
        int maxX = INT_MIN, maxY = INT_MIN;
        
        NSArray* screens = [NSScreen screens];
        for (NSScreen* screen in screens) {
            NSRect frame = [screen frame];
            
            // Convert from Cocoa coordinates (bottom-left origin) to screen coordinates (top-left origin)
            NSRect mainFrame = [[NSScreen screens][0] frame];
            int screenY = static_cast<int>(mainFrame.size.height - frame.origin.y - frame.size.height);
            
            int x = static_cast<int>(frame.origin.x);
            int y = screenY;
            int width = static_cast<int>(frame.size.width);
            int height = static_cast<int>(frame.size.height);
            
            minX = std::min(minX, x);
            minY = std::min(minY, y);
            maxX = std::max(maxX, x + width);
            maxY = std::max(maxY, y + height);
        }
        
        result.x = minX;
        result.y = minY;
        result.width = maxX - minX;
        result.height = maxY - minY;
        
        return result;
    }
    
    int GetMenuBarHeight() override {
        return static_cast<int>([[NSApplication sharedApplication] mainMenu].menuBarHeight);
    }
    
    Bounds GetDockBounds() override {
        Bounds result;
        
        // Get the visible frame vs full frame to determine dock position and size
        NSScreen* mainScreen = [NSScreen mainScreen];
        NSRect fullFrame = [mainScreen frame];
        NSRect visibleFrame = [mainScreen visibleFrame];
        
        // Dock at bottom (most common)
        if (visibleFrame.origin.y > fullFrame.origin.y) {
            result.x = 0;
            result.y = static_cast<int>(fullFrame.size.height - (visibleFrame.origin.y - fullFrame.origin.y));
            result.width = static_cast<int>(fullFrame.size.width);
            result.height = static_cast<int>(visibleFrame.origin.y - fullFrame.origin.y);
        }
        // Dock on left
        else if (visibleFrame.origin.x > fullFrame.origin.x) {
            result.x = 0;
            result.y = 0;
            result.width = static_cast<int>(visibleFrame.origin.x - fullFrame.origin.x);
            result.height = static_cast<int>(fullFrame.size.height);
        }
        // Dock on right
        else if (visibleFrame.size.width < fullFrame.size.width) {
            result.x = static_cast<int>(visibleFrame.size.width);
            result.y = 0;
            result.width = static_cast<int>(fullFrame.size.width - visibleFrame.size.width);
            result.height = static_cast<int>(fullFrame.size.height);
        }
        
        return result;
    }

private:
    bool initialized_ = false;
    
    DisplayInfo ScreenToDisplayInfo(NSScreen* screen, bool isPrimary) {
        DisplayInfo info;
        
        // Get display ID
        NSDictionary* description = [screen deviceDescription];
        NSNumber* screenNumber = [description objectForKey:@"NSScreenNumber"];
        info.id = screenNumber ? [screenNumber longLongValue] : 0;
        
        // Get name
        if (@available(macOS 10.15, *)) {
            info.name = [[screen localizedName] UTF8String];
        } else {
            info.name = "Display " + std::to_string(info.id);
        }
        
        // Get frame (full bounds)
        NSRect frame = [screen frame];
        
        // Convert from Cocoa coordinates (bottom-left origin) to screen coordinates (top-left origin)
        NSRect mainFrame = [[NSScreen screens][0] frame];
        int screenY = static_cast<int>(mainFrame.size.height - frame.origin.y - frame.size.height);
        
        info.bounds.x = static_cast<int>(frame.origin.x);
        info.bounds.y = screenY;
        info.bounds.width = static_cast<int>(frame.size.width);
        info.bounds.height = static_cast<int>(frame.size.height);
        
        // Get visible frame (work area, excluding dock/menu bar)
        NSRect visibleFrame = [screen visibleFrame];
        int visibleY = static_cast<int>(mainFrame.size.height - visibleFrame.origin.y - visibleFrame.size.height);
        
        info.workArea.x = static_cast<int>(visibleFrame.origin.x);
        info.workArea.y = visibleY;
        info.workArea.width = static_cast<int>(visibleFrame.size.width);
        info.workArea.height = static_cast<int>(visibleFrame.size.height);
        
        // Get scale factor
        info.scaleFactor = [screen backingScaleFactor];
        
        // Is primary
        info.isPrimary = isPrimary;
        
        return info;
    }
};

// Factory method
std::unique_ptr<ScreenController> ScreenController::Create() {
    return std::make_unique<ScreenControllerMac>();
}

}  // namespace centris

