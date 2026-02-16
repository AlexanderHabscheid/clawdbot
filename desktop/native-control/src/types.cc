/**
 * Centris Native Control - Type Utilities Implementation
 * 
 * Serialization and utility functions for core data types.
 */

#include "types.h"
#include "utils.h"
#include <sstream>

namespace centris {

// ═══════════════════════════════════════════════════════════════════════════
// UIElement Utilities
// ═══════════════════════════════════════════════════════════════════════════

std::string UIElementToString(const UIElement& element) {
    std::ostringstream ss;
    ss << "UIElement{id=" << element.id
       << ", role=\"" << element.role << "\""
       << ", name=\"" << element.name << "\""
       << ", bounds=(" << element.bounds.x << "," << element.bounds.y
       << "," << element.bounds.width << "," << element.bounds.height << ")"
       << ", enabled=" << (element.enabled ? "true" : "false")
       << ", focused=" << (element.focused ? "true" : "false")
       << "}";
    return ss.str();
}

bool UIElementMatchesCriteria(const UIElement& element, const ElementCriteria& criteria) {
    // Check role
    if (!criteria.role.empty() && element.role != criteria.role) {
        return false;
    }
    
    // Check name
    if (!criteria.name.empty()) {
        if (criteria.nameExact) {
            if (element.name != criteria.name) return false;
        } else {
            if (!utils::ContainsIgnoreCase(element.name, criteria.name)) return false;
        }
    }
    
    // Check label
    if (!criteria.label.empty()) {
        if (!utils::ContainsIgnoreCase(element.label, criteria.label)) return false;
    }
    
    // Check value
    if (!criteria.value.empty()) {
        if (!utils::ContainsIgnoreCase(element.value, criteria.value)) return false;
    }
    
    // Check enabled state
    if (criteria.enabled && !element.enabled) return false;
    
    // Check visible state
    if (criteria.visible && !element.visible) return false;
    
    return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// InteractiveSnapshot Utilities
// ═══════════════════════════════════════════════════════════════════════════

void InteractiveSnapshotBuildIndex(InteractiveSnapshot& snapshot) {
    snapshot.idToIndex.clear();
    snapshot.elementCounts.clear();
    
    for (size_t i = 0; i < snapshot.elements.size(); ++i) {
        const auto& element = snapshot.elements[i];
        snapshot.idToIndex[element.id] = i;
        snapshot.elementCounts[element.role]++;
    }
}

std::vector<UIElement> FilterElements(
    const InteractiveSnapshot& snapshot,
    const ElementCriteria& criteria
) {
    std::vector<UIElement> result;
    for (const auto& element : snapshot.elements) {
        if (UIElementMatchesCriteria(element, criteria)) {
            result.push_back(element);
        }
    }
    return result;
}

std::optional<UIElement> FindFirstElement(
    const InteractiveSnapshot& snapshot,
    const ElementCriteria& criteria
) {
    for (const auto& element : snapshot.elements) {
        if (UIElementMatchesCriteria(element, criteria)) {
            return element;
        }
    }
    return std::nullopt;
}

// ═══════════════════════════════════════════════════════════════════════════
// Role Utilities
// ═══════════════════════════════════════════════════════════════════════════

// Standard role name mapping (platform-specific to normalized)
static const std::unordered_map<std::string, std::string> g_roleNormalization = {
    // macOS roles
    {"AXButton", Role::Button},
    {"AXTextField", Role::TextField},
    {"AXTextArea", Role::TextArea},
    {"AXCheckBox", Role::CheckBox},
    {"AXRadioButton", Role::RadioButton},
    {"AXComboBox", Role::ComboBox},
    {"AXPopUpButton", Role::PopUpButton},
    {"AXSlider", Role::Slider},
    {"AXMenu", Role::Menu},
    {"AXMenuItem", Role::MenuItem},
    {"AXMenuBar", Role::MenuBar},
    {"AXToolbar", Role::Toolbar},
    {"AXTab", Role::Tab},
    {"AXTabGroup", Role::TabGroup},
    {"AXList", Role::List},
    {"AXCell", Role::Cell},
    {"AXRow", Role::Row},
    {"AXTable", Role::Table},
    {"AXOutline", Role::Tree},
    {"AXOutlineRow", Role::TreeItem},
    {"AXScrollArea", Role::ScrollArea},
    {"AXScrollBar", Role::ScrollBar},
    {"AXImage", Role::Image},
    {"AXLink", Role::Link},
    {"AXStaticText", Role::StaticText},
    {"AXGroup", Role::Group},
    {"AXWindow", Role::Window},
    {"AXSheet", Role::Sheet},
    {"AXDialog", Role::Dialog},
    
    // Windows UIAutomation control types
    {"Button", Role::Button},
    {"Edit", Role::TextField},
    {"Document", Role::TextArea},
    {"CheckBox", Role::CheckBox},
    {"RadioButton", Role::RadioButton},
    {"ComboBox", Role::ComboBox},
    {"Slider", Role::Slider},
    {"Menu", Role::Menu},
    {"MenuItem", Role::MenuItem},
    {"MenuBar", Role::MenuBar},
    {"ToolBar", Role::Toolbar},
    {"Tab", Role::Tab},
    {"TabItem", Role::Tab},
    {"List", Role::List},
    {"ListItem", Role::Cell},
    {"DataGrid", Role::Table},
    {"DataItem", Role::Row},
    {"Tree", Role::Tree},
    {"TreeItem", Role::TreeItem},
    {"ScrollBar", Role::ScrollBar},
    {"Image", Role::Image},
    {"Hyperlink", Role::Link},
    {"Text", Role::StaticText},
    {"Group", Role::Group},
    {"Window", Role::Window},
    {"Pane", Role::Group},
};

std::string NormalizeRole(const std::string& platformRole) {
    auto it = g_roleNormalization.find(platformRole);
    if (it != g_roleNormalization.end()) {
        return it->second;
    }
    
    // If not found, try lowercase version
    std::string lower = utils::ToLower(platformRole);
    
    // Remove AX prefix if present
    if (utils::StartsWith(lower, "ax")) {
        lower = lower.substr(2);
    }
    
    // Check common roles
    if (lower == "button") return Role::Button;
    if (lower == "textfield" || lower == "text field" || lower == "edit") return Role::TextField;
    if (lower == "textarea" || lower == "text area") return Role::TextArea;
    if (lower == "checkbox" || lower == "check box") return Role::CheckBox;
    if (lower == "radiobutton" || lower == "radio button") return Role::RadioButton;
    if (lower == "combobox" || lower == "combo box") return Role::ComboBox;
    if (lower == "slider") return Role::Slider;
    if (lower == "menu") return Role::Menu;
    if (lower == "menuitem" || lower == "menu item") return Role::MenuItem;
    if (lower == "link" || lower == "hyperlink") return Role::Link;
    if (lower == "image" || lower == "img") return Role::Image;
    if (lower == "statictext" || lower == "static text" || lower == "label") return Role::StaticText;
    if (lower == "group" || lower == "pane") return Role::Group;
    if (lower == "window") return Role::Window;
    if (lower == "dialog") return Role::Dialog;
    
    return Role::Unknown;
}

// ═══════════════════════════════════════════════════════════════════════════
// MouseButton Utilities
// ═══════════════════════════════════════════════════════════════════════════

MouseButton StringToMouseButton(const std::string& str) {
    std::string lower = utils::ToLower(str);
    if (lower == "right") return MouseButton::Right;
    if (lower == "middle") return MouseButton::Middle;
    return MouseButton::Left;
}

std::string MouseButtonToString(MouseButton button) {
    switch (button) {
        case MouseButton::Right: return "right";
        case MouseButton::Middle: return "middle";
        default: return "left";
    }
}

}  // namespace centris

