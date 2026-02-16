#ifndef CENTRIS_CONTROL_H
#define CENTRIS_CONTROL_H

#include <memory>
#include <mutex>
#include <chrono>
#include "types.h"

// Forward declarations for platform-specific controllers
namespace centris {
    class AccessibilityController;
    class MouseKeyboardController;
    class WindowController;
    class ScreenController;
}

namespace centris {

/**
 * Configuration for CentrisSystemControl
 */
struct SystemControlConfig {
    bool cacheElements = true;           // Cache element tree between calls
    int cacheTimeoutMs = 1000;           // Cache invalidation timeout (ms)
    bool logPerformance = false;         // Log timing information
    bool moveMouseForClicks = true;      // Move real mouse cursor for clicks
    int defaultClickDelay = 50;          // Default delay between click events
};

/**
 * CentrisSystemControl - Main interface for native system control
 * 
 * This class provides DOM-like access to desktop UI elements via
 * native Accessibility APIs (AXUIElement on macOS, UIAutomation on Windows).
 * 
 * Usage:
 *   CentrisSystemControl control;
 *   control.Initialize({});
 *   
 *   auto snapshot = control.GetInteractiveSnapshot();
 *   auto button = control.FindElement("Slack", "button", "Send");
 *   control.ClickElement(button->id);
 */
class CentrisSystemControl {
public:
    CentrisSystemControl();
    ~CentrisSystemControl();
    
    // ═══════════════════════════════════════════════════════════════════════
    // Lifecycle
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * Initialize the control system
     * @param config Configuration options
     * @return true if initialization successful
     */
    bool Initialize(const SystemControlConfig& config = {});
    
    /**
     * Shutdown and cleanup resources
     */
    void Shutdown();
    
    /**
     * Check if system is initialized
     */
    bool IsInitialized() const { return initialized_; }
    
    // ═══════════════════════════════════════════════════════════════════════
    // Element Discovery (Like browser's get_interactive_elements)
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * Get interactive snapshot of an application
     * @param options Filtering options (app name, window title, etc.)
     * @return Snapshot containing all interactive elements
     */
    InteractiveSnapshot GetInteractiveSnapshot(
        const SnapshotOptions& options = {}
    );
    
    /**
     * Find a single element matching criteria
     * @param appName Application name (empty = frontmost)
     * @param role Element role (button, textField, etc.)
     * @param name Element name
     * @return Element if found, nullopt otherwise
     */
    std::optional<UIElement> FindElement(
        const std::string& appName,
        const std::string& role,
        const std::string& name
    );
    
    /**
     * Find all elements matching criteria
     * @param appName Application name (empty = frontmost)
     * @param criteria Search criteria
     * @return Vector of matching elements
     */
    std::vector<UIElement> FindElements(
        const std::string& appName,
        const ElementCriteria& criteria = {}
    );
    
    /**
     * Get element by ID from cache
     * @param elementId Element ID from previous snapshot
     * @return Element if found in cache, nullopt otherwise
     */
    std::optional<UIElement> GetElement(int64_t elementId);
    
    /**
     * Refresh element data from accessibility tree
     * @param elementId Element ID to refresh
     * @return Updated element if still exists
     */
    std::optional<UIElement> RefreshElement(int64_t elementId);
    
    // ═══════════════════════════════════════════════════════════════════════
    // Element Actions (Like browser's click_node, input_text_node)
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * Click an element by ID
     * Uses EXACT coordinates from accessibility API - no miss-clicks!
     * @param elementId Element ID from snapshot
     * @param options Click options (button, modifiers, etc.)
     * @return true if click successful
     */
    bool ClickElement(int64_t elementId, const ClickOptions& options = {});
    
    /**
     * Type text into an element
     * @param elementId Element ID (should be a text field)
     * @param text Text to type
     * @param options Type options (clear first, press enter, etc.)
     * @return true if typing successful
     */
    bool TypeIntoElement(
        int64_t elementId,
        const std::string& text,
        const TypeOptions& options = {}
    );
    
    /**
     * Perform a native accessibility action on element
     * @param elementId Element ID
     * @param action Action name ("press", "showMenu", "expand", etc.)
     * @return true if action successful
     */
    bool PerformAction(int64_t elementId, const std::string& action);
    
    /**
     * Set element value directly
     * @param elementId Element ID
     * @param value New value
     * @return true if successful
     */
    bool SetValue(int64_t elementId, const std::string& value);
    
    /**
     * Insert text at cursor position in the currently focused text field
     * This bypasses the clipboard entirely - perfect for dictation!
     * 
     * @param text Text to insert
     * @return true if successful
     */
    bool InsertTextAtCursor(const std::string& text);
    
    // ═══════════════════════════════════════════════════════════════════════
    // Direct Mouse/Keyboard Control
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * Move mouse cursor to position
     * @param x X coordinate (screen pixels)
     * @param y Y coordinate (screen pixels)
     * @return true if successful
     */
    bool MoveMouse(int x, int y);
    
    /**
     * Click at coordinates
     * @param x X coordinate
     * @param y Y coordinate
     * @param options Click options
     * @return true if successful
     */
    bool Click(int x, int y, const ClickOptions& options = {});
    
    /**
     * Drag from one point to another
     * @param fromX Start X
     * @param fromY Start Y
     * @param toX End X
     * @param toY End Y
     * @return true if successful
     */
    bool Drag(int fromX, int fromY, int toX, int toY);
    
    /**
     * Type text (with current keyboard focus)
     * @param text Text to type
     * @param delayMs Delay between keystrokes (0 = instant)
     * @return true if successful
     */
    bool Type(const std::string& text, int delayMs = 0);
    
    /**
     * Press key combination
     * @param keyCombo Key combo string ("cmd+c", "ctrl+shift+n", etc.)
     * @return true if successful
     */
    bool KeyPress(const std::string& keyCombo);
    
    /**
     * Scroll at current position or specified position
     * @param delta Scroll delta (x, y)
     * @param x Optional X position (current if -1)
     * @param y Optional Y position (current if -1)
     * @return true if successful
     */
    bool Scroll(const ScrollDelta& delta, int x = -1, int y = -1);
    
    /**
     * Get current mouse position
     * @return Pair of (x, y) coordinates
     */
    std::pair<int, int> GetMousePosition();
    
    // ═══════════════════════════════════════════════════════════════════════
    // Window Management
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * Get all open windows
     * @param appName Optional: filter by app name
     * @return Vector of window info
     */
    std::vector<WindowInfo> GetWindows(const std::string& appName = "");
    
    /**
     * Get frontmost window
     * @return Window info if available
     */
    std::optional<WindowInfo> GetFrontmostWindow();
    
    /**
     * Focus (bring to front) a window
     * @param windowId Window ID
     * @return true if successful
     */
    bool FocusWindow(int64_t windowId);
    
    /**
     * Resize a window
     * @param windowId Window ID
     * @param width New width
     * @param height New height
     * @return true if successful
     */
    bool ResizeWindow(int64_t windowId, int width, int height);
    
    /**
     * Move a window
     * @param windowId Window ID
     * @param x New X position
     * @param y New Y position
     * @return true if successful
     */
    bool MoveWindow(int64_t windowId, int x, int y);
    
    /**
     * Minimize a window
     * @param windowId Window ID
     * @return true if successful
     */
    bool MinimizeWindow(int64_t windowId);
    
    /**
     * Maximize/zoom a window
     * @param windowId Window ID
     * @return true if successful
     */
    bool MaximizeWindow(int64_t windowId);
    
    // ═══════════════════════════════════════════════════════════════════════
    // Application Management
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * Get running applications
     * @return Vector of app info
     */
    std::vector<AppInfo> GetRunningApps();
    
    /**
     * Get frontmost (focused) application
     * @return App info if available
     */
    std::optional<AppInfo> GetFrontmostApp();
    
    /**
     * Activate (bring to front) an application
     * @param appName Application name
     * @return true if successful
     */
    bool ActivateApp(const std::string& appName);
    
    /**
     * Launch an application
     * @param bundleIdOrPath Bundle ID or path to application
     * @return true if launch initiated successfully
     */
    bool LaunchApp(const std::string& bundleIdOrPath);
    
    /**
     * Quit an application
     * @param appName Application name
     * @param force Force quit if true
     * @return true if successful
     */
    bool QuitApp(const std::string& appName, bool force = false);
    
    // ═══════════════════════════════════════════════════════════════════════
    // Screen/Display Information
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * Get all displays
     * @return Vector of display info
     */
    std::vector<DisplayInfo> GetDisplays();
    
    /**
     * Get primary display
     * @return Display info for primary display
     */
    DisplayInfo GetPrimaryDisplay();
    
    // ═══════════════════════════════════════════════════════════════════════
    // Cache Management
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * Clear element cache
     */
    void ClearCache();
    
    /**
     * Get cache statistics
     * @return Map of stat name to value
     */
    std::unordered_map<std::string, int64_t> GetCacheStats();

private:
    // Platform-specific controllers
    std::unique_ptr<AccessibilityController> accessibility_;
    std::unique_ptr<MouseKeyboardController> mouseKeyboard_;
    std::unique_ptr<WindowController> windows_;
    std::unique_ptr<ScreenController> screen_;
    
    // Configuration
    SystemControlConfig config_;
    bool initialized_ = false;
    
    // Element cache
    std::unordered_map<int64_t, UIElement> elementCache_;
    int64_t lastSnapshotTime_ = 0;
    std::mutex cacheMutex_;
    
    // Cache helpers
    void UpdateCache(const InteractiveSnapshot& snapshot);
    bool IsCacheValid() const;
    
    // Get current time in milliseconds
    int64_t GetCurrentTimeMs() const;
};

}  // namespace centris

#endif  // CENTRIS_CONTROL_H

