/**
 * Centris Native Control - Accessibility Controller Interface
 * 
 * Platform-agnostic interface for accessing the accessibility tree.
 * Implementations:
 *   - macOS: AXUIElement (accessibility_controller_mac.mm)
 *   - Windows: UIAutomation (accessibility_controller_win.cc)
 *   - Linux: AT-SPI (accessibility_controller_linux.cc)
 */

#ifndef CENTRIS_ACCESSIBILITY_CONTROLLER_H
#define CENTRIS_ACCESSIBILITY_CONTROLLER_H

#include "types.h"
#include <memory>
#include <functional>

namespace centris {

/**
 * AccessibilityController - Abstract interface for accessibility tree access
 * 
 * This provides DOM-like access to native application UI elements.
 * Unlike vision-based approaches, this gives EXACT coordinates from the OS.
 */
class AccessibilityController {
public:
    virtual ~AccessibilityController() = default;
    
    /**
     * Factory method to create platform-specific implementation
     */
    static std::unique_ptr<AccessibilityController> Create();
    
    // ═══════════════════════════════════════════════════════════════════════
    // Lifecycle
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * Initialize the accessibility subsystem
     * @return true if successful
     */
    virtual bool Initialize() = 0;
    
    /**
     * Shutdown and cleanup
     */
    virtual void Shutdown() = 0;
    
    /**
     * Check if accessibility access is enabled
     * (User must grant permission on macOS)
     */
    virtual bool IsAccessibilityEnabled() const = 0;
    
    /**
     * Request accessibility permission from user (macOS)
     * Opens system preferences dialog
     */
    virtual void RequestAccessibilityPermission() = 0;
    
    // ═══════════════════════════════════════════════════════════════════════
    // Element Discovery
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * Get interactive snapshot of an application
     * @param options Filtering options
     * @return Snapshot containing all interactive elements
     */
    virtual InteractiveSnapshot GetInteractiveSnapshot(
        const SnapshotOptions& options = {}
    ) = 0;
    
    /**
     * Get the accessibility element at a screen point
     * @param x Screen X coordinate
     * @param y Screen Y coordinate
     * @return Element at point, or nullopt if none
     */
    virtual std::optional<UIElement> GetElementAtPoint(int x, int y) = 0;
    
    /**
     * Get the currently focused element
     * @return Focused element, or nullopt if none
     */
    virtual std::optional<UIElement> GetFocusedElement() = 0;
    
    /**
     * Refresh element data (get current state from accessibility tree)
     * @param elementId Element ID to refresh
     * @return Updated element, or nullopt if no longer exists
     */
    virtual std::optional<UIElement> RefreshElement(int64_t elementId) = 0;
    
    // ═══════════════════════════════════════════════════════════════════════
    // Element Actions (Native Accessibility Actions)
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * Perform a native accessibility action on an element
     * @param elementId Element ID
     * @param action Action name ("press", "showMenu", "expand", etc.)
     * @return true if successful
     */
    virtual bool PerformAction(int64_t elementId, const std::string& action) = 0;
    
    /**
     * Set element value (for text fields, sliders, etc.)
     * @param elementId Element ID
     * @param value New value
     * @return true if successful
     */
    virtual bool SetValue(int64_t elementId, const std::string& value) = 0;
    
    /**
     * Focus an element
     * @param elementId Element ID
     * @return true if successful
     */
    virtual bool FocusElement(int64_t elementId) = 0;
    
    /**
     * Insert text at the cursor position of the currently focused element
     * This is the key function for dictation - bypasses clipboard entirely!
     * 
     * Flow:
     * 1. Gets focused element via kAXFocusedUIElementAttribute
     * 2. Gets current selection range via kAXSelectedTextRangeAttribute
     * 3. Gets current value via kAXValueAttribute
     * 4. Inserts new text at cursor position (replacing any selection)
     * 5. Sets new value via kAXValueAttribute
     * 
     * @param text Text to insert
     * @return true if successful
     */
    virtual bool InsertTextAtCursor(const std::string& text) = 0;
    
    // ═══════════════════════════════════════════════════════════════════════
    // Text Extraction (for Reading Mode)
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * Get currently selected text from the frontmost application.
     * Uses kAXSelectedTextAttribute from the focused element.
     * This is the key function for Reading Mode - extracts text to read aloud.
     * 
     * @return Selected text, or empty string if none
     */
    virtual std::string GetSelectedText() = 0;
    
    /**
     * Get full text content from the focused element.
     * Uses kAXValueAttribute to get the entire text content.
     * Fallback when no text is selected.
     * 
     * @return Focused element's text content, or empty string if none
     */
    virtual std::string GetFocusedTextContent() = 0;
    
    // ═══════════════════════════════════════════════════════════════════════
    // Application Management
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * Get list of running applications
     * @return Vector of app info
     */
    virtual std::vector<AppInfo> GetRunningApps() = 0;
    
    /**
     * Get the frontmost (focused) application
     * @return App info, or nullopt if none
     */
    virtual std::optional<AppInfo> GetFrontmostApp() = 0;
    
    /**
     * Activate (bring to front) an application
     * @param appName Application name
     * @return true if successful
     */
    virtual bool ActivateApp(const std::string& appName) = 0;
    
    /**
     * Launch an application
     * @param bundleIdOrPath Bundle ID or path
     * @return true if launch initiated
     */
    virtual bool LaunchApp(const std::string& bundleIdOrPath) = 0;
    
    /**
     * Quit an application
     * @param appName Application name
     * @param force Force quit if true
     * @return true if successful
     */
    virtual bool QuitApp(const std::string& appName, bool force = false) = 0;
    
    // ═══════════════════════════════════════════════════════════════════════
    // Cache Management
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * Get element from cache by ID
     * @param elementId Element ID
     * @return Cached element, or nullopt if not found
     */
    virtual std::optional<UIElement> GetCachedElement(int64_t elementId) = 0;
    
    /**
     * Clear element cache
     */
    virtual void ClearCache() = 0;
    
    /**
     * Get native handle for element (platform-specific)
     * Used for performing actions on cached elements
     * @param elementId Element ID
     * @return Native handle (AXUIElementRef on macOS, IUIAutomationElement* on Windows)
     */
    virtual void* GetNativeHandle(int64_t elementId) = 0;

protected:
    AccessibilityController() = default;
};

}  // namespace centris

#endif  // CENTRIS_ACCESSIBILITY_CONTROLLER_H

