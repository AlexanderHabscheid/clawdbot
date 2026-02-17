/**
 * Centris Native Control - macOS Accessibility Controller
 * 
 * Uses AXUIElement API to access the accessibility tree of native applications.
 * This provides EXACT element coordinates without any vision/AI inference.
 */

#import <ApplicationServices/ApplicationServices.h>
#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>

#include "accessibility_controller.h"
#include "utils.h"
#include <unordered_map>
#include <mutex>
#include <deque>

namespace centris {

/**
 * macOS Accessibility Controller Implementation
 */
class AccessibilityControllerMac : public AccessibilityController {
public:
    AccessibilityControllerMac() = default;
    ~AccessibilityControllerMac() override {
        // During process teardown, the mutex may already be destroyed.
        // Skip cleanup — the OS reclaims all resources on exit anyway.
        initialized_ = false;
    }
    
    bool Initialize() override {
        if (initialized_) return true;
        
        // Check accessibility permission
        if (!IsAccessibilityEnabled()) {
            utils::LogWarning("Accessibility permission not granted");
        }
        
        initialized_ = true;
        utils::LogInfo("AccessibilityController initialized (macOS)");
        return true;
    }
    
    void Shutdown() override {
        ClearCache();
        initialized_ = false;
    }
    
    bool IsAccessibilityEnabled() const override {
        return AXIsProcessTrusted();
    }
    
    void RequestAccessibilityPermission() override {
        // Open System Preferences to accessibility settings
        NSDictionary* options = @{(__bridge NSString*)kAXTrustedCheckOptionPrompt: @YES};
        AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)options);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // Element Discovery
    // ═══════════════════════════════════════════════════════════════════════
    
    InteractiveSnapshot GetInteractiveSnapshot(const SnapshotOptions& options) override {
        utils::Timer timer;
        InteractiveSnapshot snapshot;
        snapshot.timestamp = utils::GetCurrentTimeMs();
        
        // Get target application
        NSRunningApplication* app = GetTargetApp(options.appName);
        if (!app) {
            utils::LogWarning("No target application found");
            return snapshot;
        }
        
        // Set app info
        snapshot.appName = [[app localizedName] UTF8String];
        snapshot.appBundleId = [[app bundleIdentifier] UTF8String];
        snapshot.appPid = [app processIdentifier];
        
        // Create accessibility element for app
        AXUIElementRef appElement = AXUIElementCreateApplication([app processIdentifier]);
        if (!appElement) {
            utils::LogError("Failed to create AXUIElement for app");
            return snapshot;
        }
        
        // Get focused window (or filter by title)
        AXUIElementRef windowElement = GetWindow(appElement, options.windowTitle);
        if (windowElement) {
            // Get window info
            snapshot.windowId = GetElementId(windowElement);
            snapshot.windowTitle = GetStringAttribute(windowElement, kAXTitleAttribute);
            snapshot.windowBounds = GetElementBounds(windowElement);
            
            // Collect elements (capped at maxElements to avoid multi-second crawls)
            int64_t nextId = 1;
            CollectElements(windowElement, snapshot.elements, nextId, 0, 
                           options.maxDepth, options.includeHidden,
                           options.includeRoles, options.excludeRoles,
                           options.maxElements);
            
            CFRelease(windowElement);
        }
        
        CFRelease(appElement);
        
        // Build index
        InteractiveSnapshotBuildIndex(snapshot);
        
        // Update cache
        {
            std::lock_guard<std::mutex> lock(cacheMutex_);
            for (const auto& element : snapshot.elements) {
                elementCache_[element.id] = element;
            }
        }
        
        snapshot.durationMs = static_cast<int>(timer.ElapsedMs());
        utils::LogDebug("Snapshot complete: " + std::to_string(snapshot.elements.size()) + 
                       " elements in " + std::to_string(snapshot.durationMs) + "ms");
        
        return snapshot;
    }
    
    std::optional<UIElement> GetElementAtPoint(int x, int y) override {
        AXUIElementRef systemWide = AXUIElementCreateSystemWide();
        AXUIElementRef element = nullptr;
        
        AXError error = AXUIElementCopyElementAtPosition(systemWide, x, y, &element);
        CFRelease(systemWide);
        
        if (error != kAXErrorSuccess || !element) {
            return std::nullopt;
        }
        
        UIElement result = ElementFromAXElement(element, nextId_++);
        CFRelease(element);
        
        return result;
    }
    
    std::optional<UIElement> GetFocusedElement() override {
        NSRunningApplication* frontApp = [[NSWorkspace sharedWorkspace] frontmostApplication];
        if (!frontApp) return std::nullopt;
        
        AXUIElementRef appElement = AXUIElementCreateApplication([frontApp processIdentifier]);
        if (!appElement) return std::nullopt;
        
        AXUIElementRef focusedElement = nullptr;
        AXUIElementCopyAttributeValue(appElement, kAXFocusedUIElementAttribute, 
                                      (CFTypeRef*)&focusedElement);
        CFRelease(appElement);
        
        if (!focusedElement) return std::nullopt;
        
        UIElement result = ElementFromAXElement(focusedElement, nextId_++);
        CFRelease(focusedElement);
        
        return result;
    }
    
    std::optional<UIElement> RefreshElement(int64_t elementId) override {
        std::lock_guard<std::mutex> lock(cacheMutex_);
        auto it = elementCache_.find(elementId);
        if (it == elementCache_.end()) return std::nullopt;
        
        AXUIElementRef element = static_cast<AXUIElementRef>(it->second.nativeHandle);
        if (!element) return std::nullopt;
        
        return ElementFromAXElement(element, elementId);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // Element Actions
    // ═══════════════════════════════════════════════════════════════════════
    
    bool PerformAction(int64_t elementId, const std::string& action) override {
        AXUIElementRef element = GetCachedNativeHandle(elementId);
        if (!element) return false;
        
        CFStringRef actionName = nullptr;
        
        if (action == "press" || action == "click") {
            actionName = kAXPressAction;
        } else if (action == "showMenu") {
            actionName = kAXShowMenuAction;
        } else if (action == "increment") {
            actionName = kAXIncrementAction;
        } else if (action == "decrement") {
            actionName = kAXDecrementAction;
        } else if (action == "confirm") {
            actionName = kAXConfirmAction;
        } else if (action == "cancel") {
            actionName = kAXCancelAction;
        } else if (action == "raise") {
            actionName = kAXRaiseAction;
        } else if (action == "pick") {
            actionName = kAXPickAction;
        } else {
            // Try custom action name
            actionName = CFStringCreateWithCString(kCFAllocatorDefault, 
                                                   ("AX" + action).c_str(), 
                                                   kCFStringEncodingUTF8);
        }
        
        if (!actionName) return false;
        
        AXError error = AXUIElementPerformAction(element, actionName);
        
        if (actionName != kAXPressAction && actionName != kAXShowMenuAction &&
            actionName != kAXIncrementAction && actionName != kAXDecrementAction &&
            actionName != kAXConfirmAction && actionName != kAXCancelAction &&
            actionName != kAXRaiseAction && actionName != kAXPickAction) {
            CFRelease(actionName);
        }
        
        return error == kAXErrorSuccess;
    }
    
    bool SetValue(int64_t elementId, const std::string& value) override {
        AXUIElementRef element = GetCachedNativeHandle(elementId);
        if (!element) return false;
        
        CFStringRef cfValue = CFStringCreateWithCString(kCFAllocatorDefault, 
                                                         value.c_str(), 
                                                         kCFStringEncodingUTF8);
        AXError error = AXUIElementSetAttributeValue(element, kAXValueAttribute, cfValue);
        CFRelease(cfValue);
        
        return error == kAXErrorSuccess;
    }
    
    bool FocusElement(int64_t elementId) override {
        AXUIElementRef element = GetCachedNativeHandle(elementId);
        if (!element) return false;
        
        AXError error = AXUIElementSetAttributeValue(element, kAXFocusedAttribute, 
                                                     kCFBooleanTrue);
        return error == kAXErrorSuccess;
    }
    
    /**
     * Insert text at cursor position - bypasses clipboard entirely!
     * This is what Wispr Flow and professional dictation tools use.
     */
    bool InsertTextAtCursor(const std::string& text) override {
        // Get the frontmost application
        NSRunningApplication* frontApp = [[NSWorkspace sharedWorkspace] frontmostApplication];
        if (!frontApp) {
            utils::LogError("InsertTextAtCursor: No frontmost application");
            return false;
        }
        
        // Get the focused UI element
        AXUIElementRef appElement = AXUIElementCreateApplication([frontApp processIdentifier]);
        if (!appElement) {
            utils::LogError("InsertTextAtCursor: Failed to create app element");
            return false;
        }
        
        AXUIElementRef focusedElement = nullptr;
        AXError error = AXUIElementCopyAttributeValue(appElement, kAXFocusedUIElementAttribute, 
                                                      (CFTypeRef*)&focusedElement);
        CFRelease(appElement);
        
        if (error != kAXErrorSuccess || !focusedElement) {
            utils::LogError("InsertTextAtCursor: No focused element found");
            return false;
        }
        
        // Check if the focused element supports text editing (has AXValue attribute)
        CFTypeRef currentValueRef = nullptr;
        error = AXUIElementCopyAttributeValue(focusedElement, kAXValueAttribute, &currentValueRef);
        
        if (error != kAXErrorSuccess) {
            // Element doesn't have a value attribute - may not be a text field
            utils::LogWarning("InsertTextAtCursor: Focused element doesn't support AXValue");
            CFRelease(focusedElement);
            return false;
        }
        
        // Get current text value
        std::string currentValue;
        if (currentValueRef && CFGetTypeID(currentValueRef) == CFStringGetTypeID()) {
            currentValue = utils::CFStringToStdString(static_cast<CFStringRef>(currentValueRef));
        }
        if (currentValueRef) CFRelease(currentValueRef);
        
        // Get selected text range (cursor position and selection length)
        CFTypeRef rangeRef = nullptr;
        error = AXUIElementCopyAttributeValue(focusedElement, kAXSelectedTextRangeAttribute, &rangeRef);
        
        CFIndex insertPos = currentValue.length(); // Default: insert at end
        CFIndex selectionLength = 0;
        
        if (error == kAXErrorSuccess && rangeRef) {
            CFRange range;
            if (AXValueGetValue(static_cast<AXValueRef>(rangeRef), kAXValueTypeCFRange, &range)) {
                insertPos = range.location;
                selectionLength = range.length;
            }
            CFRelease(rangeRef);
        }
        
        // Build new text value: text before cursor + new text + text after selection
        std::string newValue;
        
        // Handle UTF-8 properly by converting to NSString
        NSString* currentNSString = [NSString stringWithUTF8String:currentValue.c_str()];
        NSString* insertNSString = [NSString stringWithUTF8String:text.c_str()];
        
        if (currentNSString && insertNSString) {
            // Get the parts before and after the selection
            NSUInteger length = [currentNSString length];
            NSUInteger safeInsertPos = MIN((NSUInteger)insertPos, length);
            NSUInteger safeSelEnd = MIN(safeInsertPos + (NSUInteger)selectionLength, length);
            
            NSString* beforeText = [currentNSString substringToIndex:safeInsertPos];
            NSString* afterText = [currentNSString substringFromIndex:safeSelEnd];
            
            // Combine: before + new text + after
            NSString* newNSString = [NSString stringWithFormat:@"%@%@%@", 
                                     beforeText, insertNSString, afterText];
            newValue = [newNSString UTF8String];
        } else {
            // Fallback: simple concatenation
            newValue = text;
        }
        
        // Set the new value
        CFStringRef cfNewValue = CFStringCreateWithCString(kCFAllocatorDefault, 
                                                           newValue.c_str(), 
                                                           kCFStringEncodingUTF8);
        error = AXUIElementSetAttributeValue(focusedElement, kAXValueAttribute, cfNewValue);
        CFRelease(cfNewValue);
        
        if (error != kAXErrorSuccess) {
            utils::LogError("InsertTextAtCursor: Failed to set new value, error: " + std::to_string(error));
            CFRelease(focusedElement);
            return false;
        }
        
        // Update cursor position to after the inserted text
        CFIndex newCursorPos = insertPos + text.length();
        CFRange newRange = CFRangeMake(newCursorPos, 0);
        AXValueRef newRangeValue = AXValueCreate(kAXValueTypeCFRange, &newRange);
        if (newRangeValue) {
            AXUIElementSetAttributeValue(focusedElement, kAXSelectedTextRangeAttribute, newRangeValue);
            CFRelease(newRangeValue);
        }
        
        CFRelease(focusedElement);
        utils::LogInfo("InsertTextAtCursor: Successfully inserted " + std::to_string(text.length()) + " characters");
        return true;
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // Text Extraction (for Reading Mode)
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * Get currently selected text from the frontmost application.
     * Uses kAXSelectedTextAttribute from the focused element.
     */
    std::string GetSelectedText() override {
        NSRunningApplication* frontApp = [[NSWorkspace sharedWorkspace] frontmostApplication];
        if (!frontApp) {
            utils::LogWarning("GetSelectedText: No frontmost application");
            return "";
        }
        
        AXUIElementRef appElement = AXUIElementCreateApplication([frontApp processIdentifier]);
        if (!appElement) {
            utils::LogError("GetSelectedText: Failed to create app element");
            return "";
        }
        
        AXUIElementRef focusedElement = nullptr;
        AXError error = AXUIElementCopyAttributeValue(
            appElement, 
            kAXFocusedUIElementAttribute, 
            (CFTypeRef*)&focusedElement
        );
        CFRelease(appElement);
        
        if (error != kAXErrorSuccess || !focusedElement) {
            utils::LogDebug("GetSelectedText: No focused element");
            return "";
        }
        
        // Try to get selected text
        CFTypeRef selectedTextRef = nullptr;
        error = AXUIElementCopyAttributeValue(
            focusedElement, 
            kAXSelectedTextAttribute, 
            &selectedTextRef
        );
        
        std::string result;
        if (error == kAXErrorSuccess && selectedTextRef) {
            if (CFGetTypeID(selectedTextRef) == CFStringGetTypeID()) {
                result = utils::CFStringToStdString(static_cast<CFStringRef>(selectedTextRef));
            }
            CFRelease(selectedTextRef);
        }
        
        CFRelease(focusedElement);
        
        if (!result.empty()) {
            utils::LogInfo("GetSelectedText: Got " + std::to_string(result.length()) + " characters");
        }
        
        return result;
    }
    
    /**
     * Get full text content from the focused element.
     * Fallback when no text is selected.
     */
    std::string GetFocusedTextContent() override {
        NSRunningApplication* frontApp = [[NSWorkspace sharedWorkspace] frontmostApplication];
        if (!frontApp) {
            utils::LogWarning("GetFocusedTextContent: No frontmost application");
            return "";
        }
        
        AXUIElementRef appElement = AXUIElementCreateApplication([frontApp processIdentifier]);
        if (!appElement) {
            utils::LogError("GetFocusedTextContent: Failed to create app element");
            return "";
        }
        
        AXUIElementRef focusedElement = nullptr;
        AXError error = AXUIElementCopyAttributeValue(
            appElement, 
            kAXFocusedUIElementAttribute, 
            (CFTypeRef*)&focusedElement
        );
        CFRelease(appElement);
        
        if (error != kAXErrorSuccess || !focusedElement) {
            utils::LogDebug("GetFocusedTextContent: No focused element");
            return "";
        }
        
        // Get full value (entire text content)
        CFTypeRef valueRef = nullptr;
        error = AXUIElementCopyAttributeValue(
            focusedElement, 
            kAXValueAttribute, 
            &valueRef
        );
        
        std::string result;
        if (error == kAXErrorSuccess && valueRef) {
            if (CFGetTypeID(valueRef) == CFStringGetTypeID()) {
                result = utils::CFStringToStdString(static_cast<CFStringRef>(valueRef));
            }
            CFRelease(valueRef);
        }
        
        CFRelease(focusedElement);
        
        if (!result.empty()) {
            utils::LogInfo("GetFocusedTextContent: Got " + std::to_string(result.length()) + " characters");
        }
        
        return result;
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // Application Management
    // ═══════════════════════════════════════════════════════════════════════
    
    std::vector<AppInfo> GetRunningApps() override {
        std::vector<AppInfo> result;
        
        NSArray* apps = [[NSWorkspace sharedWorkspace] runningApplications];
        NSRunningApplication* frontApp = [[NSWorkspace sharedWorkspace] frontmostApplication];
        
        for (NSRunningApplication* app in apps) {
            if ([app activationPolicy] != NSApplicationActivationPolicyRegular) {
                continue;  // Skip background apps
            }
            
            AppInfo info;
            info.name = [[app localizedName] UTF8String] ?: "";
            info.bundleId = [[app bundleIdentifier] UTF8String] ?: "";
            info.pid = [app processIdentifier];
            info.focused = (app == frontApp);
            info.path = [[[app bundleURL] path] UTF8String] ?: "";
            
            result.push_back(info);
        }
        
        return result;
    }
    
    std::optional<AppInfo> GetFrontmostApp() override {
        NSRunningApplication* app = [[NSWorkspace sharedWorkspace] frontmostApplication];
        if (!app) return std::nullopt;
        
        AppInfo info;
        info.name = [[app localizedName] UTF8String] ?: "";
        info.bundleId = [[app bundleIdentifier] UTF8String] ?: "";
        info.pid = [app processIdentifier];
        info.focused = true;
        info.path = [[[app bundleURL] path] UTF8String] ?: "";
        
        return info;
    }
    
    bool ActivateApp(const std::string& appName) override {
        NSArray* apps = [[NSWorkspace sharedWorkspace] runningApplications];
        
        for (NSRunningApplication* app in apps) {
            NSString* name = [app localizedName];
            if (name && [[name lowercaseString] containsString:
                        [[NSString stringWithUTF8String:appName.c_str()] lowercaseString]]) {
                return [app activateWithOptions:NSApplicationActivateIgnoringOtherApps];
            }
        }
        
        return false;
    }
    
    bool LaunchApp(const std::string& bundleIdOrPath) override {
        NSString* identifier = [NSString stringWithUTF8String:bundleIdOrPath.c_str()];
        
        // Try as bundle ID first
        NSURL* appURL = [[NSWorkspace sharedWorkspace] URLForApplicationWithBundleIdentifier:identifier];
        
        if (!appURL) {
            // Try as path
            appURL = [NSURL fileURLWithPath:identifier];
        }
        
        if (!appURL) return false;
        
        NSError* error = nil;
        [[NSWorkspace sharedWorkspace] openApplicationAtURL:appURL
                                             configuration:[[NSWorkspaceOpenConfiguration alloc] init]
                                         completionHandler:nil];
        
        return error == nil;
    }
    
    bool QuitApp(const std::string& appName, bool force) override {
        NSArray* apps = [[NSWorkspace sharedWorkspace] runningApplications];
        
        for (NSRunningApplication* app in apps) {
            NSString* name = [app localizedName];
            if (name && [[name lowercaseString] containsString:
                        [[NSString stringWithUTF8String:appName.c_str()] lowercaseString]]) {
                if (force) {
                    return [app forceTerminate];
                } else {
                    return [app terminate];
                }
            }
        }
        
        return false;
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // Cache Management
    // ═══════════════════════════════════════════════════════════════════════
    
    std::optional<UIElement> GetCachedElement(int64_t elementId) override {
        std::lock_guard<std::mutex> lock(cacheMutex_);
        auto it = elementCache_.find(elementId);
        if (it != elementCache_.end()) {
            return it->second;
        }
        return std::nullopt;
    }
    
    void ClearCache() override {
        // Try-lock to avoid crash during process shutdown when the mutex
        // may already be destroyed.
        std::unique_lock<std::mutex> lock(cacheMutex_, std::try_to_lock);
        if (!lock.owns_lock()) return;
        
        // Release native handles
        for (auto& pair : elementCache_) {
            if (pair.second.nativeHandle) {
                CFRelease(static_cast<AXUIElementRef>(pair.second.nativeHandle));
                pair.second.nativeHandle = nullptr;
            }
        }
        elementCache_.clear();
        nextId_ = 1;
    }
    
    void* GetNativeHandle(int64_t elementId) override {
        return const_cast<void*>(static_cast<const void*>(GetCachedNativeHandle(elementId)));
    }

private:
    bool initialized_ = false;
    std::unordered_map<int64_t, UIElement> elementCache_;
    std::mutex cacheMutex_;
    int64_t nextId_ = 1;
    
    // ═══════════════════════════════════════════════════════════════════════
    // Helper Methods
    // ═══════════════════════════════════════════════════════════════════════
    
    NSRunningApplication* GetTargetApp(const std::string& appName) {
        if (appName.empty()) {
            return [[NSWorkspace sharedWorkspace] frontmostApplication];
        }
        
        NSArray* apps = [[NSWorkspace sharedWorkspace] runningApplications];
        for (NSRunningApplication* app in apps) {
            NSString* name = [app localizedName];
            if (name && [[name lowercaseString] containsString:
                        [[NSString stringWithUTF8String:appName.c_str()] lowercaseString]]) {
                return app;
            }
        }
        
        return nil;
    }
    
    AXUIElementRef GetWindow(AXUIElementRef appElement, const std::string& windowTitle) {
        // If no title specified, get focused window
        if (windowTitle.empty()) {
            AXUIElementRef focusedWindow = nullptr;
            if (AXUIElementCopyAttributeValue(appElement, kAXFocusedWindowAttribute,
                                              (CFTypeRef*)&focusedWindow) == kAXErrorSuccess) {
                return focusedWindow;
            }
        }
        
        // Get all windows
        CFArrayRef windows = nullptr;
        if (AXUIElementCopyAttributeValue(appElement, kAXWindowsAttribute,
                                          (CFTypeRef*)&windows) != kAXErrorSuccess) {
            return nullptr;
        }
        
        if (!windows || CFArrayGetCount(windows) == 0) {
            if (windows) CFRelease(windows);
            return nullptr;
        }
        
        // If title specified, search for matching window
        if (!windowTitle.empty()) {
            for (CFIndex i = 0; i < CFArrayGetCount(windows); i++) {
                AXUIElementRef window = (AXUIElementRef)CFArrayGetValueAtIndex(windows, i);
                std::string title = GetStringAttribute(window, kAXTitleAttribute);
                if (utils::ContainsIgnoreCase(title, windowTitle)) {
                    CFRetain(window);
                    CFRelease(windows);
                    return window;
                }
            }
        }
        
        // Return first window
        AXUIElementRef firstWindow = (AXUIElementRef)CFArrayGetValueAtIndex(windows, 0);
        CFRetain(firstWindow);
        CFRelease(windows);
        return firstWindow;
    }
    
    int64_t GetElementId(AXUIElementRef element) {
        // Use memory address as ID (stable for lifetime of element)
        return reinterpret_cast<int64_t>(element);
    }
    
    std::string GetStringAttribute(AXUIElementRef element, CFStringRef attribute) {
        CFTypeRef value = nullptr;
        if (AXUIElementCopyAttributeValue(element, attribute, &value) != kAXErrorSuccess) {
            return "";
        }
        
        std::string result;
        if (value && CFGetTypeID(value) == CFStringGetTypeID()) {
            result = utils::CFStringToStdString(static_cast<CFStringRef>(value));
        }
        
        if (value) CFRelease(value);
        return result;
    }
    
    bool GetBoolAttribute(AXUIElementRef element, CFStringRef attribute, bool defaultValue = false) {
        CFTypeRef value = nullptr;
        if (AXUIElementCopyAttributeValue(element, attribute, &value) != kAXErrorSuccess) {
            return defaultValue;
        }
        
        bool result = defaultValue;
        if (value && CFGetTypeID(value) == CFBooleanGetTypeID()) {
            result = CFBooleanGetValue(static_cast<CFBooleanRef>(value));
        }
        
        if (value) CFRelease(value);
        return result;
    }
    
    Bounds GetElementBounds(AXUIElementRef element) {
        Bounds bounds;
        
        // Get position
        CFTypeRef posValue = nullptr;
        if (AXUIElementCopyAttributeValue(element, kAXPositionAttribute, &posValue) == kAXErrorSuccess) {
            CGPoint pos;
            if (AXValueGetValue(static_cast<AXValueRef>(posValue), kAXValueTypeCGPoint, &pos)) {
                bounds.x = static_cast<int>(pos.x);
                bounds.y = static_cast<int>(pos.y);
            }
            CFRelease(posValue);
        }
        
        // Get size
        CFTypeRef sizeValue = nullptr;
        if (AXUIElementCopyAttributeValue(element, kAXSizeAttribute, &sizeValue) == kAXErrorSuccess) {
            CGSize size;
            if (AXValueGetValue(static_cast<AXValueRef>(sizeValue), kAXValueTypeCGSize, &size)) {
                bounds.width = static_cast<int>(size.width);
                bounds.height = static_cast<int>(size.height);
            }
            CFRelease(sizeValue);
        }
        
        return bounds;
    }
    
    std::vector<std::string> GetElementActions(AXUIElementRef element) {
        std::vector<std::string> actions;
        
        CFArrayRef actionNames = nullptr;
        if (AXUIElementCopyActionNames(element, &actionNames) == kAXErrorSuccess && actionNames) {
            for (CFIndex i = 0; i < CFArrayGetCount(actionNames); i++) {
                CFStringRef action = static_cast<CFStringRef>(CFArrayGetValueAtIndex(actionNames, i));
                std::string actionStr = utils::CFStringToStdString(action);
                // Remove "AX" prefix
                if (actionStr.substr(0, 2) == "AX") {
                    actionStr = actionStr.substr(2);
                    actionStr[0] = tolower(actionStr[0]);
                }
                actions.push_back(actionStr);
            }
            CFRelease(actionNames);
        }
        
        return actions;
    }
    
    /**
     * Extract all attributes from an AX element in a single batch IPC call.
     * Each individual AXUIElementCopyAttributeValue is a Mach IPC round-trip
     * (~0.5-1ms). Batching 10+ attributes into one call cuts per-element cost
     * from ~12ms to ~1ms.
     */
    UIElement ElementFromAXElement(AXUIElementRef element, int64_t id) {
        UIElement result;
        result.id = id;
        
        // Batch-fetch all text/bool attributes in one IPC round-trip
        CFStringRef attrNames[] = {
            kAXRoleAttribute,             // 0
            kAXTitleAttribute,            // 1
            kAXDescriptionAttribute,      // 2
            kAXValueAttribute,            // 3
            kAXEnabledAttribute,          // 4
            kAXFocusedAttribute,          // 5
            kAXSelectedAttribute,         // 6
            kAXPositionAttribute,         // 7
            kAXSizeAttribute,             // 8
        };
        constexpr CFIndex kAttrCount = 9;
        
        CFArrayRef attrArray = CFArrayCreate(
            kCFAllocatorDefault, (const void**)attrNames, kAttrCount,
            &kCFTypeArrayCallBacks);
        
        CFArrayRef values = nullptr;
        AXError batchErr = AXUIElementCopyMultipleAttributeValues(
            element, attrArray, 0, &values);
        CFRelease(attrArray);
        
        if (batchErr == kAXErrorSuccess && values &&
            CFArrayGetCount(values) == kAttrCount) {
            
            auto getString = [&](CFIndex idx) -> std::string {
                CFTypeRef v = CFArrayGetValueAtIndex(values, idx);
                if (v && CFGetTypeID(v) == CFStringGetTypeID())
                    return utils::CFStringToStdString(static_cast<CFStringRef>(v));
                return "";
            };
            auto getBool = [&](CFIndex idx, bool def) -> bool {
                CFTypeRef v = CFArrayGetValueAtIndex(values, idx);
                if (v && CFGetTypeID(v) == CFBooleanGetTypeID())
                    return CFBooleanGetValue(static_cast<CFBooleanRef>(v));
                return def;
            };
            
            // Role
            std::string role = getString(0);
            result.role = NormalizeRole(role);
            
            // Name: prefer title, fall back to description
            result.name = getString(1);
            if (result.name.empty()) result.name = getString(2);
            
            // Value
            result.value = getString(3);
            
            // State
            result.enabled = getBool(4, true);
            result.focused = getBool(5, false);
            result.selected = getBool(6, false);
            
            // Bounds from position+size (avoid separate GetElementBounds calls)
            CFTypeRef posVal = CFArrayGetValueAtIndex(values, 7);
            CFTypeRef sizeVal = CFArrayGetValueAtIndex(values, 8);
            if (posVal && CFGetTypeID(posVal) == AXValueGetTypeID()) {
                CGPoint pos;
                if (AXValueGetValue(static_cast<AXValueRef>(posVal),
                                    kAXValueTypeCGPoint, &pos)) {
                    result.bounds.x = static_cast<int>(pos.x);
                    result.bounds.y = static_cast<int>(pos.y);
                }
            }
            if (sizeVal && CFGetTypeID(sizeVal) == AXValueGetTypeID()) {
                CGSize sz;
                if (AXValueGetValue(static_cast<AXValueRef>(sizeVal),
                                    kAXValueTypeCGSize, &sz)) {
                    result.bounds.width = static_cast<int>(sz.width);
                    result.bounds.height = static_cast<int>(sz.height);
                }
            }
            
            CFRelease(values);
        } else {
            // Fallback: individual calls (should rarely happen)
            if (values) CFRelease(values);
            std::string role = GetStringAttribute(element, kAXRoleAttribute);
            result.role = NormalizeRole(role);
            result.name = GetStringAttribute(element, kAXTitleAttribute);
            if (result.name.empty())
                result.name = GetStringAttribute(element, kAXDescriptionAttribute);
            result.value = GetStringAttribute(element, kAXValueAttribute);
            result.bounds = GetElementBounds(element);
            result.enabled = GetBoolAttribute(element, kAXEnabledAttribute, true);
            result.focused = GetBoolAttribute(element, kAXFocusedAttribute, false);
            result.selected = GetBoolAttribute(element, kAXSelectedAttribute, false);
        }
        
        result.visible = result.bounds.isValid();
        
        // Skip expensive per-element actions query — defer to on-demand
        // result.actions = GetElementActions(element);
        
        // PID is local (no IPC)
        pid_t pid = 0;
        AXUIElementGetPid(element, &pid);
        result.appPid = pid;
        
        // Retain native handle for later interaction
        CFRetain(element);
        result.nativeHandle = const_cast<void*>(static_cast<const void*>(element));
        
        return result;
    }
    
    /**
     * BFS walk of the AX tree collecting interactive elements.
     * Breadth-first ensures top-level controls (toolbar buttons, tabs)
     * are collected before deep nested elements (table cells in long lists).
     * Each node = 1 batched IPC for role+children; interactive = 1 more for attrs.
     */
    void CollectElements(
        AXUIElementRef root,
        std::vector<UIElement>& elements,
        int64_t& nextId,
        int /*startDepth*/,
        int maxDepth,
        bool includeHidden,
        const std::vector<std::string>& includeRoles,
        const std::vector<std::string>& excludeRoles,
        int maxElements = 80
    ) {
        struct QueueEntry {
            AXUIElementRef element;
            int depth;
            bool owned; // whether we need to CFRelease
        };
        
        std::deque<QueueEntry> queue;
        queue.push_back({root, 0, false});
        
        while (!queue.empty()) {
            if (maxElements > 0 && static_cast<int>(elements.size()) >= maxElements) break;
            
            auto [element, depth, owned] = queue.front();
            queue.pop_front();
            
            if (maxDepth >= 0 && depth > maxDepth) {
                if (owned) CFRelease(element);
                continue;
            }
            
            // Batch-fetch role + children in one IPC call
            CFStringRef walkAttrs[] = { kAXRoleAttribute, kAXChildrenAttribute };
            CFArrayRef walkAttrArray = CFArrayCreate(
                kCFAllocatorDefault, (const void**)walkAttrs, 2,
                &kCFTypeArrayCallBacks);
            CFArrayRef walkValues = nullptr;
            AXError walkErr = AXUIElementCopyMultipleAttributeValues(
                element, walkAttrArray, 0, &walkValues);
            CFRelease(walkAttrArray);
            
            std::string normalizedRole;
            CFArrayRef children = nullptr;
            
            if (walkErr == kAXErrorSuccess && walkValues &&
                CFArrayGetCount(walkValues) >= 2) {
                CFTypeRef roleVal = CFArrayGetValueAtIndex(walkValues, 0);
                if (roleVal && CFGetTypeID(roleVal) == CFStringGetTypeID()) {
                    normalizedRole = NormalizeRole(
                        utils::CFStringToStdString(static_cast<CFStringRef>(roleVal)));
                }
                CFTypeRef childrenVal = CFArrayGetValueAtIndex(walkValues, 1);
                if (childrenVal && CFGetTypeID(childrenVal) == CFArrayGetTypeID()) {
                    children = static_cast<CFArrayRef>(childrenVal);
                    CFRetain(children);
                }
                CFRelease(walkValues);
            } else {
                if (walkValues) CFRelease(walkValues);
                std::string role = GetStringAttribute(element, kAXRoleAttribute);
                normalizedRole = NormalizeRole(role);
            }
            
            // Collect if interactive
            if (isInteractiveRole(normalizedRole)) {
                bool shouldInclude = true;
                if (!includeRoles.empty()) {
                    shouldInclude = std::find(includeRoles.begin(), includeRoles.end(), 
                                              normalizedRole) != includeRoles.end();
                }
                if (!excludeRoles.empty() && 
                    std::find(excludeRoles.begin(), excludeRoles.end(), 
                              normalizedRole) != excludeRoles.end()) {
                    shouldInclude = false;
                }
                
                if (shouldInclude) {
                    UIElement uiElement = ElementFromAXElement(element, nextId);
                    if (!includeHidden && !uiElement.visible) {
                        if (uiElement.nativeHandle)
                            CFRelease(static_cast<AXUIElementRef>(uiElement.nativeHandle));
                    } else {
                        uiElement.depth = depth;
                        nextId++;
                        elements.push_back(std::move(uiElement));
                    }
                }
            }
            
            // Enqueue children for BFS (breadth-first: siblings before depth)
            if (!children) {
                AXUIElementCopyAttributeValue(element, kAXChildrenAttribute,
                                              (CFTypeRef*)&children);
            }
            if (children) {
                CFIndex childCount = CFArrayGetCount(children);
                for (CFIndex i = 0; i < childCount; i++) {
                    if (maxElements > 0 && static_cast<int>(elements.size()) >= maxElements) break;
                    AXUIElementRef child = (AXUIElementRef)CFArrayGetValueAtIndex(children, i);
                    CFRetain(child);
                    queue.push_back({child, depth + 1, true});
                }
                CFRelease(children);
            }
            
            if (owned) CFRelease(element);
        }
        
        // Clean up remaining queued elements
        for (auto& entry : queue) {
            if (entry.owned) CFRelease(entry.element);
        }
    }
    
    AXUIElementRef GetCachedNativeHandle(int64_t elementId) {
        std::lock_guard<std::mutex> lock(cacheMutex_);
        auto it = elementCache_.find(elementId);
        if (it != elementCache_.end() && it->second.nativeHandle) {
            return static_cast<AXUIElementRef>(it->second.nativeHandle);
        }
        return nullptr;
    }
};

// Factory method
std::unique_ptr<AccessibilityController> AccessibilityController::Create() {
    return std::make_unique<AccessibilityControllerMac>();
}

}  // namespace centris

