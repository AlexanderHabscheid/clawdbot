/**
 * Centris Native Control - Screen Controller Interface
 * 
 * Platform-agnostic interface for display/screen management.
 * Implementations:
 *   - macOS: NSScreen/CGDisplay (screen_controller_mac.cc)
 *   - Windows: EnumDisplayMonitors (screen_controller_win.cc)
 *   - Linux: Xrandr (screen_controller_linux.cc)
 */

#ifndef CENTRIS_SCREEN_CONTROLLER_H
#define CENTRIS_SCREEN_CONTROLLER_H

#include "types.h"
#include <memory>
#include <vector>

namespace centris {

/**
 * ScreenController - Abstract interface for screen/display management
 */
class ScreenController {
public:
    virtual ~ScreenController() = default;
    
    /**
     * Factory method to create platform-specific implementation
     */
    static std::unique_ptr<ScreenController> Create();
    
    // ═══════════════════════════════════════════════════════════════════════
    // Lifecycle
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * Initialize the screen subsystem
     * @return true if successful
     */
    virtual bool Initialize() = 0;
    
    /**
     * Shutdown and cleanup
     */
    virtual void Shutdown() = 0;
    
    // ═══════════════════════════════════════════════════════════════════════
    // Display Enumeration
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * Get all displays
     * @return Vector of display info
     */
    virtual std::vector<DisplayInfo> GetDisplays() = 0;
    
    /**
     * Get the primary display
     * @return Primary display info
     */
    virtual DisplayInfo GetPrimaryDisplay() = 0;
    
    /**
     * Get display by ID
     * @param displayId Display ID
     * @return Display info, or nullopt if not found
     */
    virtual std::optional<DisplayInfo> GetDisplay(int64_t displayId) = 0;
    
    /**
     * Get display containing a point
     * @param x Screen X coordinate
     * @param y Screen Y coordinate
     * @return Display info, or nullopt if point is not on any display
     */
    virtual std::optional<DisplayInfo> GetDisplayAtPoint(int x, int y) = 0;
    
    /**
     * Get display containing a window
     * @param windowId Window ID
     * @return Display info, or nullopt if window not found
     */
    virtual std::optional<DisplayInfo> GetDisplayForWindow(int64_t windowId) = 0;
    
    // ═══════════════════════════════════════════════════════════════════════
    // Coordinate Conversion
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * Convert logical coordinates to physical pixels
     * (For Retina/HiDPI displays)
     * @param x Logical X
     * @param y Logical Y
     * @return Pair of physical (x, y) coordinates
     */
    virtual std::pair<int, int> LogicalToPhysical(int x, int y) = 0;
    
    /**
     * Convert physical pixels to logical coordinates
     * @param x Physical X
     * @param y Physical Y
     * @return Pair of logical (x, y) coordinates
     */
    virtual std::pair<int, int> PhysicalToLogical(int x, int y) = 0;
    
    /**
     * Get scale factor at a point
     * @param x Screen X coordinate
     * @param y Screen Y coordinate
     * @return Scale factor (1.0 for standard, 2.0 for Retina)
     */
    virtual double GetScaleFactorAtPoint(int x, int y) = 0;
    
    // ═══════════════════════════════════════════════════════════════════════
    // Screen Bounds
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * Get total bounds covering all displays
     * @return Bounds encompassing all displays
     */
    virtual Bounds GetTotalBounds() = 0;
    
    /**
     * Get menubar height (macOS)
     * @return Menubar height in pixels (0 on non-macOS)
     */
    virtual int GetMenuBarHeight() = 0;
    
    /**
     * Get dock/taskbar bounds
     * @return Dock/taskbar bounds
     */
    virtual Bounds GetDockBounds() = 0;

protected:
    ScreenController() = default;
};

}  // namespace centris

#endif  // CENTRIS_SCREEN_CONTROLLER_H

