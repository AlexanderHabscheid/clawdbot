/**
 * Centris Native Control - Window Controller Interface
 * 
 * Platform-agnostic interface for window management.
 * Implementations:
 *   - macOS: CGWindowList/NSWindow (window_controller_mac.cc)
 *   - Windows: Win32 API (window_controller_win.cc)
 *   - Linux: X11/Wayland (window_controller_linux.cc)
 */

#ifndef CENTRIS_WINDOW_CONTROLLER_H
#define CENTRIS_WINDOW_CONTROLLER_H

#include "types.h"
#include <memory>
#include <string>
#include <vector>

namespace centris {

/**
 * WindowController - Abstract interface for window management
 */
class WindowController {
public:
    virtual ~WindowController() = default;
    
    /**
     * Factory method to create platform-specific implementation
     */
    static std::unique_ptr<WindowController> Create();
    
    // ═══════════════════════════════════════════════════════════════════════
    // Lifecycle
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * Initialize the window subsystem
     * @return true if successful
     */
    virtual bool Initialize() = 0;
    
    /**
     * Shutdown and cleanup
     */
    virtual void Shutdown() = 0;
    
    // ═══════════════════════════════════════════════════════════════════════
    // Window Enumeration
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * Get all visible windows
     * @param appName Optional: filter by app name
     * @return Vector of window info
     */
    virtual std::vector<WindowInfo> GetWindows(const std::string& appName = "") = 0;
    
    /**
     * Get the frontmost (focused) window
     * @return Window info, or nullopt if none
     */
    virtual std::optional<WindowInfo> GetFrontmostWindow() = 0;
    
    /**
     * Get window by ID
     * @param windowId Window ID
     * @return Window info, or nullopt if not found
     */
    virtual std::optional<WindowInfo> GetWindow(int64_t windowId) = 0;
    
    /**
     * Get windows for a specific application
     * @param appName Application name
     * @return Vector of window info
     */
    virtual std::vector<WindowInfo> GetWindowsForApp(const std::string& appName) = 0;
    
    /**
     * Get window at screen position
     * @param x Screen X coordinate
     * @param y Screen Y coordinate
     * @return Window info, or nullopt if none at position
     */
    virtual std::optional<WindowInfo> GetWindowAtPoint(int x, int y) = 0;
    
    // ═══════════════════════════════════════════════════════════════════════
    // Window Actions
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * Focus (bring to front) a window
     * @param windowId Window ID
     * @return true if successful
     */
    virtual bool FocusWindow(int64_t windowId) = 0;
    
    /**
     * Move a window to a new position
     * @param windowId Window ID
     * @param x New X position
     * @param y New Y position
     * @return true if successful
     */
    virtual bool MoveWindow(int64_t windowId, int x, int y) = 0;
    
    /**
     * Resize a window
     * @param windowId Window ID
     * @param width New width
     * @param height New height
     * @return true if successful
     */
    virtual bool ResizeWindow(int64_t windowId, int width, int height) = 0;
    
    /**
     * Move and resize a window
     * @param windowId Window ID
     * @param x New X position
     * @param y New Y position
     * @param width New width
     * @param height New height
     * @return true if successful
     */
    virtual bool SetWindowBounds(int64_t windowId, int x, int y, int width, int height) = 0;
    
    /**
     * Minimize a window
     * @param windowId Window ID
     * @return true if successful
     */
    virtual bool MinimizeWindow(int64_t windowId) = 0;
    
    /**
     * Maximize/zoom a window
     * @param windowId Window ID
     * @return true if successful
     */
    virtual bool MaximizeWindow(int64_t windowId) = 0;
    
    /**
     * Restore a minimized window
     * @param windowId Window ID
     * @return true if successful
     */
    virtual bool RestoreWindow(int64_t windowId) = 0;
    
    /**
     * Close a window
     * @param windowId Window ID
     * @return true if successful
     */
    virtual bool CloseWindow(int64_t windowId) = 0;
    
    /**
     * Toggle fullscreen mode for a window
     * @param windowId Window ID
     * @return true if successful
     */
    virtual bool ToggleFullscreen(int64_t windowId) = 0;
    
    // ═══════════════════════════════════════════════════════════════════════
    // Window State
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * Check if window is minimized
     * @param windowId Window ID
     * @return true if minimized
     */
    virtual bool IsMinimized(int64_t windowId) = 0;
    
    /**
     * Check if window is maximized/zoomed
     * @param windowId Window ID
     * @return true if maximized
     */
    virtual bool IsMaximized(int64_t windowId) = 0;
    
    /**
     * Check if window is fullscreen
     * @param windowId Window ID
     * @return true if fullscreen
     */
    virtual bool IsFullscreen(int64_t windowId) = 0;
    
    /**
     * Check if window is focused
     * @param windowId Window ID
     * @return true if focused
     */
    virtual bool IsFocused(int64_t windowId) = 0;

protected:
    WindowController() = default;
};

}  // namespace centris

#endif  // CENTRIS_WINDOW_CONTROLLER_H

