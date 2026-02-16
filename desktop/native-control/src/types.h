#ifndef CENTRIS_CONTROL_TYPES_H
#define CENTRIS_CONTROL_TYPES_H

#include <string>
#include <vector>
#include <unordered_map>
#include <optional>
#include <cstdint>

namespace centris {

/**
 * Bounding rectangle for UI elements
 * All coordinates are in screen pixels
 */
struct Bounds {
    int x = 0;       // Left edge (screen X)
    int y = 0;       // Top edge (screen Y)
    int width = 0;   // Width in pixels
    int height = 0;  // Height in pixels
    
    // Computed center coordinates
    int centerX() const { return x + width / 2; }
    int centerY() const { return y + height / 2; }
    
    // Check if point is inside bounds
    bool contains(int px, int py) const {
        return px >= x && px < x + width && py >= y && py < y + height;
    }
    
    // Check if bounds are valid (non-zero size)
    bool isValid() const { return width > 0 && height > 0; }
};

/**
 * UI Element - The "DOM Node" for desktop applications
 * Represents an interactive element discovered via Accessibility APIs
 */
struct UIElement {
    // ═══════════════════════════════════════════════════════════════════════
    // Identity
    // ═══════════════════════════════════════════════════════════════════════
    
    int64_t id = 0;              // Unique element ID (for referencing in actions)
    
    // ═══════════════════════════════════════════════════════════════════════
    // Type & Labels
    // ═══════════════════════════════════════════════════════════════════════
    
    std::string role;            // Element type: "button", "textField", "checkbox",
                                 // "menu", "menuItem", "staticText", "image",
                                 // "group", "window", "toolbar", "list", "cell", etc.
    
    std::string name;            // Primary label: "Submit", "Cancel", "File", "Edit"
    std::string label;           // Accessibility label (may differ from name)
    std::string value;           // Current value (for inputs, sliders, etc.)
    std::string description;     // Accessibility description/help text
    std::string placeholder;     // Placeholder text (for inputs)
    
    // ═══════════════════════════════════════════════════════════════════════
    // Position & Size (EXACT COORDINATES - the key advantage!)
    // ═══════════════════════════════════════════════════════════════════════
    
    Bounds bounds;               // Exact screen position and size
    
    // ═══════════════════════════════════════════════════════════════════════
    // State
    // ═══════════════════════════════════════════════════════════════════════
    
    bool enabled = true;         // Can be interacted with
    bool focused = false;        // Currently has keyboard focus
    bool visible = true;         // Visible on screen (not hidden/scrolled away)
    bool selected = false;       // Currently selected (for list items, tabs)
    bool checked = false;        // For checkboxes, radio buttons
    bool expanded = false;       // For expandable items (menus, trees)
    
    // ═══════════════════════════════════════════════════════════════════════
    // Hierarchy
    // ═══════════════════════════════════════════════════════════════════════
    
    int64_t parentId = 0;                    // Parent element ID (0 for root)
    std::vector<int64_t> childrenIds;        // Child element IDs
    int depth = 0;                           // Depth in tree (0 = window)
    
    // ═══════════════════════════════════════════════════════════════════════
    // Actions
    // ═══════════════════════════════════════════════════════════════════════
    
    std::vector<std::string> actions;        // Available actions: "press", "select",
                                             // "setValue", "showMenu", "expand", "scroll"
    
    // ═══════════════════════════════════════════════════════════════════════
    // Application Context
    // ═══════════════════════════════════════════════════════════════════════
    
    std::string appName;         // "Slack", "Finder", "Google Chrome"
    std::string appBundleId;     // "com.tinyspeck.slackmacgap" (macOS)
    int64_t appPid = 0;          // Process ID
    int64_t windowId = 0;        // Window this element belongs to
    
    // ═══════════════════════════════════════════════════════════════════════
    // Platform-Specific
    // ═══════════════════════════════════════════════════════════════════════
    
    void* nativeHandle = nullptr;  // Platform-specific handle (AXUIElementRef, etc.)
                                   // For performing actions on cached elements
};

/**
 * Interactive Snapshot - Like browser's getInteractiveSnapshot()
 * Contains all interactive elements from an app/window
 */
struct InteractiveSnapshot {
    // ═══════════════════════════════════════════════════════════════════════
    // Metadata
    // ═══════════════════════════════════════════════════════════════════════
    
    int64_t timestamp = 0;       // Unix timestamp (ms) when snapshot was taken
    int durationMs = 0;          // How long the snapshot took to generate
    
    // ═══════════════════════════════════════════════════════════════════════
    // Application Context
    // ═══════════════════════════════════════════════════════════════════════
    
    std::string appName;         // "Slack"
    std::string appBundleId;     // "com.tinyspeck.slackmacgap"
    int64_t appPid = 0;          // Process ID
    
    // ═══════════════════════════════════════════════════════════════════════
    // Window Context
    // ═══════════════════════════════════════════════════════════════════════
    
    int64_t windowId = 0;        // Window ID
    std::string windowTitle;     // "Slack - #general"
    Bounds windowBounds;         // Window position and size
    
    // ═══════════════════════════════════════════════════════════════════════
    // Elements
    // ═══════════════════════════════════════════════════════════════════════
    
    std::vector<UIElement> elements;         // All interactive elements (flattened)
    
    // ═══════════════════════════════════════════════════════════════════════
    // Statistics
    // ═══════════════════════════════════════════════════════════════════════
    
    std::unordered_map<std::string, int> elementCounts;  // Count by role type
    
    // ═══════════════════════════════════════════════════════════════════════
    // Quick Lookup
    // ═══════════════════════════════════════════════════════════════════════
    
    std::unordered_map<int64_t, size_t> idToIndex;  // id → index in elements
    
    // Get element by ID
    const UIElement* getElementById(int64_t id) const {
        auto it = idToIndex.find(id);
        if (it != idToIndex.end() && it->second < elements.size()) {
            return &elements[it->second];
        }
        return nullptr;
    }
};

/**
 * Window Info
 */
struct WindowInfo {
    int64_t id = 0;
    std::string title;
    std::string appName;
    std::string appBundleId;
    int64_t appPid = 0;
    Bounds bounds;
    bool focused = false;
    bool minimized = false;
    int layer = 0;  // Window layer/level
};

/**
 * Application Info
 */
struct AppInfo {
    std::string name;
    std::string bundleId;  // macOS bundle ID / Windows AppUserModelID
    int64_t pid = 0;
    bool focused = false;
    std::string path;      // Path to executable
};

/**
 * Display Info
 */
struct DisplayInfo {
    int64_t id = 0;
    Bounds bounds;         // Display bounds
    Bounds workArea;       // Usable area (excluding dock/taskbar)
    double scaleFactor = 1.0;  // Retina/HiDPI scale
    bool isPrimary = false;
    std::string name;      // Display name if available
};

/**
 * Mouse Button
 */
enum class MouseButton {
    Left,
    Right,
    Middle
};

/**
 * Click Options
 */
struct ClickOptions {
    MouseButton button = MouseButton::Left;
    int clickCount = 1;                      // 1 = single, 2 = double, 3 = triple
    std::vector<std::string> modifiers;      // "cmd", "ctrl", "alt", "shift"
    bool moveMouseFirst = true;              // Move real mouse cursor first
    int delayBeforeClick = 0;                // Delay in ms before clicking
    int delayBetweenClicks = 50;             // Delay in ms between double/triple clicks
};

/**
 * Type Options
 */
struct TypeOptions {
    bool clearFirst = true;    // Clear existing text before typing
    bool pressEnter = false;   // Press Enter after typing
    int typeDelayMs = 0;       // Delay between keystrokes (0 = instant)
};

/**
 * Scroll Direction
 */
struct ScrollDelta {
    int deltaX = 0;  // Horizontal scroll (positive = right)
    int deltaY = 0;  // Vertical scroll (positive = down)
};

/**
 * Snapshot Options
 */
struct SnapshotOptions {
    std::string appName;       // Filter by app name (empty = frontmost)
    std::string windowTitle;   // Filter by window title
    bool includeHidden = false;   // Include hidden/offscreen elements
    int maxDepth = -1;            // Max tree depth (-1 = unlimited)
    std::vector<std::string> includeRoles;  // Only include these roles (empty = all)
    std::vector<std::string> excludeRoles;  // Exclude these roles
};

/**
 * Element Search Criteria
 */
struct ElementCriteria {
    std::string role;         // Element role (button, textField, etc.)
    std::string name;         // Element name (exact or partial match)
    std::string label;        // Accessibility label
    std::string value;        // Current value
    bool nameExact = false;   // Require exact name match
    bool enabled = true;      // Only enabled elements
    bool visible = true;      // Only visible elements
};

// ═══════════════════════════════════════════════════════════════════════════
// Role Constants (Common accessibility roles)
// ═══════════════════════════════════════════════════════════════════════════

namespace Role {
    constexpr const char* Button = "button";
    constexpr const char* TextField = "textField";
    constexpr const char* TextArea = "textArea";
    constexpr const char* CheckBox = "checkBox";
    constexpr const char* RadioButton = "radioButton";
    constexpr const char* ComboBox = "comboBox";
    constexpr const char* PopUpButton = "popUpButton";
    constexpr const char* Slider = "slider";
    constexpr const char* Menu = "menu";
    constexpr const char* MenuItem = "menuItem";
    constexpr const char* MenuBar = "menuBar";
    constexpr const char* Toolbar = "toolbar";
    constexpr const char* ToolbarButton = "toolbarButton";
    constexpr const char* Tab = "tab";
    constexpr const char* TabGroup = "tabGroup";
    constexpr const char* List = "list";
    constexpr const char* Cell = "cell";
    constexpr const char* Row = "row";
    constexpr const char* Table = "table";
    constexpr const char* Tree = "outline";
    constexpr const char* TreeItem = "outlineRow";
    constexpr const char* ScrollArea = "scrollArea";
    constexpr const char* ScrollBar = "scrollBar";
    constexpr const char* Image = "image";
    constexpr const char* Link = "link";
    constexpr const char* StaticText = "staticText";
    constexpr const char* Group = "group";
    constexpr const char* Window = "window";
    constexpr const char* Sheet = "sheet";
    constexpr const char* Dialog = "dialog";
    constexpr const char* Unknown = "unknown";
}

// ═══════════════════════════════════════════════════════════════════════════
// Action Constants (Accessibility actions)
// ═══════════════════════════════════════════════════════════════════════════

namespace Action {
    constexpr const char* Press = "press";           // Click/activate
    constexpr const char* Increment = "increment";   // Slider +
    constexpr const char* Decrement = "decrement";   // Slider -
    constexpr const char* Confirm = "confirm";       // Confirm dialog
    constexpr const char* Cancel = "cancel";         // Cancel dialog
    constexpr const char* ShowMenu = "showMenu";     // Show context menu
    constexpr const char* Pick = "pick";             // Pick item
    constexpr const char* Raise = "raise";           // Bring to front
    constexpr const char* ShowAlternate = "showAlternateUI";
    constexpr const char* ShowDefault = "showDefaultUI";
}

// ═══════════════════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════════════════

// Check if role is considered "interactive"
inline bool isInteractiveRole(const std::string& role) {
    static const std::unordered_map<std::string, bool> interactiveRoles = {
        {Role::Button, true},
        {Role::TextField, true},
        {Role::TextArea, true},
        {Role::CheckBox, true},
        {Role::RadioButton, true},
        {Role::ComboBox, true},
        {Role::PopUpButton, true},
        {Role::Slider, true},
        {Role::MenuItem, true},
        {Role::ToolbarButton, true},
        {Role::Tab, true},
        {Role::Cell, true},
        {Role::Row, true},
        {Role::TreeItem, true},
        {Role::Link, true},
    };
    return interactiveRoles.count(role) > 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// Utility Functions (defined in types.cc)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convert UIElement to debug string
 */
std::string UIElementToString(const UIElement& element);

/**
 * Check if element matches criteria
 */
bool UIElementMatchesCriteria(const UIElement& element, const ElementCriteria& criteria);

/**
 * Build element index for snapshot
 */
void InteractiveSnapshotBuildIndex(InteractiveSnapshot& snapshot);

/**
 * Filter elements by criteria
 */
std::vector<UIElement> FilterElements(
    const InteractiveSnapshot& snapshot,
    const ElementCriteria& criteria
);

/**
 * Find first matching element
 */
std::optional<UIElement> FindFirstElement(
    const InteractiveSnapshot& snapshot,
    const ElementCriteria& criteria
);

/**
 * Normalize platform-specific role to standard role
 */
std::string NormalizeRole(const std::string& platformRole);

/**
 * Convert string to MouseButton enum
 */
MouseButton StringToMouseButton(const std::string& str);

/**
 * Convert MouseButton enum to string
 */
std::string MouseButtonToString(MouseButton button);

}  // namespace centris

#endif  // CENTRIS_CONTROL_TYPES_H

