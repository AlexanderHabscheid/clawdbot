/**
 * Centris Native Control - Node.js Addon Entry Point
 * 
 * This is the main entry point that exposes the CentrisSystemControl
 * class to JavaScript via N-API.
 */

#include <napi.h>
#include "centris_control.h"
#include "accessibility_controller.h"
#include "mouse_keyboard_controller.h"
#include "window_controller.h"
#include "screen_controller.h"
#include "utils.h"

namespace centris {

// ============================================================================
// CentrisSystemControl Implementation
// ============================================================================

CentrisSystemControl::CentrisSystemControl() = default;

CentrisSystemControl::~CentrisSystemControl() {
    Shutdown();
}

bool CentrisSystemControl::Initialize(const SystemControlConfig& config) {
    if (initialized_) return true;
    
    config_ = config;
    
    // Create platform-specific controllers
    accessibility_ = AccessibilityController::Create();
    mouseKeyboard_ = MouseKeyboardController::Create();
    windows_ = WindowController::Create();
    screen_ = ScreenController::Create();
    
    // Initialize each controller
    if (!accessibility_ || !accessibility_->Initialize()) {
        utils::LogError("Failed to initialize AccessibilityController");
        return false;
    }
    
    if (!mouseKeyboard_ || !mouseKeyboard_->Initialize()) {
        utils::LogError("Failed to initialize MouseKeyboardController");
        return false;
    }
    
    if (!windows_ || !windows_->Initialize()) {
        utils::LogError("Failed to initialize WindowController");
        return false;
    }
    
    if (!screen_ || !screen_->Initialize()) {
        utils::LogError("Failed to initialize ScreenController");
        return false;
    }
    
    if (config_.logPerformance) {
        utils::SetLogLevel(utils::LogLevel::Debug);
    }
    
    initialized_ = true;
    utils::LogInfo("CentrisSystemControl initialized successfully");
    return true;
}

void CentrisSystemControl::Shutdown() {
    if (!initialized_) return;
    
    ClearCache();
    
    if (accessibility_) accessibility_->Shutdown();
    if (mouseKeyboard_) mouseKeyboard_->Shutdown();
    if (windows_) windows_->Shutdown();
    if (screen_) screen_->Shutdown();
    
    accessibility_.reset();
    mouseKeyboard_.reset();
    windows_.reset();
    screen_.reset();
    
    initialized_ = false;
    utils::LogInfo("CentrisSystemControl shutdown");
}

// Element Discovery
InteractiveSnapshot CentrisSystemControl::GetInteractiveSnapshot(const SnapshotOptions& options) {
    if (!accessibility_) return InteractiveSnapshot{};
    
    auto snapshot = accessibility_->GetInteractiveSnapshot(options);
    
    if (config_.cacheElements) {
        UpdateCache(snapshot);
    }
    
    return snapshot;
}

std::optional<UIElement> CentrisSystemControl::FindElement(
    const std::string& appName,
    const std::string& role,
    const std::string& name
) {
    SnapshotOptions options;
    options.appName = appName;
    
    auto snapshot = GetInteractiveSnapshot(options);
    
    ElementCriteria criteria;
    criteria.role = role;
    criteria.name = name;
    
    return FindFirstElement(snapshot, criteria);
}

std::vector<UIElement> CentrisSystemControl::FindElements(
    const std::string& appName,
    const ElementCriteria& criteria
) {
    SnapshotOptions options;
    options.appName = appName;
    
    auto snapshot = GetInteractiveSnapshot(options);
    return FilterElements(snapshot, criteria);
}

std::optional<UIElement> CentrisSystemControl::GetElement(int64_t elementId) {
    std::lock_guard<std::mutex> lock(cacheMutex_);
    auto it = elementCache_.find(elementId);
    if (it != elementCache_.end()) {
        return it->second;
    }
    return std::nullopt;
}

std::optional<UIElement> CentrisSystemControl::RefreshElement(int64_t elementId) {
    if (!accessibility_) return std::nullopt;
    return accessibility_->RefreshElement(elementId);
}

// Element Actions
bool CentrisSystemControl::ClickElement(int64_t elementId, const ClickOptions& options) {
    auto elementOpt = GetElement(elementId);
    if (!elementOpt) return false;
    
    const auto& element = *elementOpt;
    
    // Use exact center coordinates from accessibility API
    int x = element.bounds.centerX();
    int y = element.bounds.centerY();
    
    return Click(x, y, options);
}

bool CentrisSystemControl::TypeIntoElement(
    int64_t elementId,
    const std::string& text,
    const TypeOptions& options
) {
    auto elementOpt = GetElement(elementId);
    if (!elementOpt) return false;
    
    // Focus the element first
    if (accessibility_) {
        accessibility_->FocusElement(elementId);
    } else {
        // Click to focus
        ClickElement(elementId);
    }
    
    // Small delay for focus
    mouseKeyboard_->Wait(50);
    
    // Clear existing text if requested
    if (options.clearFirst) {
        KeyPress("cmd+a");  // Select all
        mouseKeyboard_->Wait(20);
        KeyPress("delete");
        mouseKeyboard_->Wait(20);
    }
    
    // Type text
    Type(text, options.typeDelayMs);
    
    // Press Enter if requested
    if (options.pressEnter) {
        mouseKeyboard_->Wait(20);
        KeyPress("return");
    }
    
    return true;
}

bool CentrisSystemControl::PerformAction(int64_t elementId, const std::string& action) {
    if (!accessibility_) return false;
    return accessibility_->PerformAction(elementId, action);
}

bool CentrisSystemControl::SetValue(int64_t elementId, const std::string& value) {
    if (!accessibility_) return false;
    return accessibility_->SetValue(elementId, value);
}

bool CentrisSystemControl::InsertTextAtCursor(const std::string& text) {
    if (!accessibility_) return false;
    return accessibility_->InsertTextAtCursor(text);
}

// Mouse/Keyboard
bool CentrisSystemControl::MoveMouse(int x, int y) {
    if (!mouseKeyboard_) return false;
    return mouseKeyboard_->MoveMouse(x, y);
}

bool CentrisSystemControl::Click(int x, int y, const ClickOptions& options) {
    if (!mouseKeyboard_) return false;
    return mouseKeyboard_->ClickAt(x, y, options);
}

bool CentrisSystemControl::Drag(int fromX, int fromY, int toX, int toY) {
    if (!mouseKeyboard_) return false;
    return mouseKeyboard_->Drag(fromX, fromY, toX, toY);
}

bool CentrisSystemControl::Type(const std::string& text, int delayMs) {
    if (!mouseKeyboard_) return false;
    return mouseKeyboard_->Type(text, delayMs);
}

bool CentrisSystemControl::KeyPress(const std::string& keyCombo) {
    if (!mouseKeyboard_) return false;
    return mouseKeyboard_->KeyPress(keyCombo);
}

bool CentrisSystemControl::Scroll(const ScrollDelta& delta, int x, int y) {
    if (!mouseKeyboard_) return false;
    
    if (x >= 0 && y >= 0) {
        return mouseKeyboard_->ScrollAt(x, y, delta);
    }
    return mouseKeyboard_->Scroll(delta);
}

std::pair<int, int> CentrisSystemControl::GetMousePosition() {
    if (!mouseKeyboard_) return {0, 0};
    return mouseKeyboard_->GetMousePosition();
}

// Window Management
std::vector<WindowInfo> CentrisSystemControl::GetWindows(const std::string& appName) {
    if (!windows_) return {};
    return windows_->GetWindows(appName);
}

std::optional<WindowInfo> CentrisSystemControl::GetFrontmostWindow() {
    if (!windows_) return std::nullopt;
    return windows_->GetFrontmostWindow();
}

bool CentrisSystemControl::FocusWindow(int64_t windowId) {
    if (!windows_) return false;
    return windows_->FocusWindow(windowId);
}

bool CentrisSystemControl::ResizeWindow(int64_t windowId, int width, int height) {
    if (!windows_) return false;
    return windows_->ResizeWindow(windowId, width, height);
}

bool CentrisSystemControl::MoveWindow(int64_t windowId, int x, int y) {
    if (!windows_) return false;
    return windows_->MoveWindow(windowId, x, y);
}

bool CentrisSystemControl::MinimizeWindow(int64_t windowId) {
    if (!windows_) return false;
    return windows_->MinimizeWindow(windowId);
}

bool CentrisSystemControl::MaximizeWindow(int64_t windowId) {
    if (!windows_) return false;
    return windows_->MaximizeWindow(windowId);
}

// Application Management
std::vector<AppInfo> CentrisSystemControl::GetRunningApps() {
    if (!accessibility_) return {};
    return accessibility_->GetRunningApps();
}

std::optional<AppInfo> CentrisSystemControl::GetFrontmostApp() {
    if (!accessibility_) return std::nullopt;
    return accessibility_->GetFrontmostApp();
}

bool CentrisSystemControl::ActivateApp(const std::string& appName) {
    if (!accessibility_) return false;
    return accessibility_->ActivateApp(appName);
}

bool CentrisSystemControl::LaunchApp(const std::string& bundleIdOrPath) {
    if (!accessibility_) return false;
    return accessibility_->LaunchApp(bundleIdOrPath);
}

bool CentrisSystemControl::QuitApp(const std::string& appName, bool force) {
    if (!accessibility_) return false;
    return accessibility_->QuitApp(appName, force);
}

// Screen
std::vector<DisplayInfo> CentrisSystemControl::GetDisplays() {
    if (!screen_) return {};
    return screen_->GetDisplays();
}

DisplayInfo CentrisSystemControl::GetPrimaryDisplay() {
    if (!screen_) return DisplayInfo{};
    return screen_->GetPrimaryDisplay();
}

// Cache Management
void CentrisSystemControl::ClearCache() {
    std::lock_guard<std::mutex> lock(cacheMutex_);
    elementCache_.clear();
    lastSnapshotTime_ = 0;
}

std::unordered_map<std::string, int64_t> CentrisSystemControl::GetCacheStats() {
    std::lock_guard<std::mutex> lock(cacheMutex_);
    return {
        {"elementCount", static_cast<int64_t>(elementCache_.size())},
        {"lastSnapshotTime", lastSnapshotTime_}
    };
}

void CentrisSystemControl::UpdateCache(const InteractiveSnapshot& snapshot) {
    std::lock_guard<std::mutex> lock(cacheMutex_);
    
    // Clear old cache
    elementCache_.clear();
    
    // Add all elements
    for (const auto& element : snapshot.elements) {
        elementCache_[element.id] = element;
    }
    
    lastSnapshotTime_ = snapshot.timestamp;
}

bool CentrisSystemControl::IsCacheValid() const {
    if (!config_.cacheElements) return false;
    int64_t now = GetCurrentTimeMs();
    return (now - lastSnapshotTime_) < config_.cacheTimeoutMs;
}

int64_t CentrisSystemControl::GetCurrentTimeMs() const {
    return utils::GetCurrentTimeMs();
}

// ============================================================================
// N-API Helper Functions
// ============================================================================

// Convert UIElement to Napi::Object
Napi::Object UIElementToNapi(Napi::Env env, const UIElement& element) {
    Napi::Object obj = Napi::Object::New(env);
    
    obj.Set("id", Napi::Number::New(env, element.id));
    obj.Set("role", Napi::String::New(env, element.role));
    obj.Set("name", Napi::String::New(env, element.name));
    obj.Set("label", Napi::String::New(env, element.label));
    obj.Set("value", Napi::String::New(env, element.value));
    obj.Set("description", Napi::String::New(env, element.description));
    
    // Bounds
    Napi::Object bounds = Napi::Object::New(env);
    bounds.Set("x", Napi::Number::New(env, element.bounds.x));
    bounds.Set("y", Napi::Number::New(env, element.bounds.y));
    bounds.Set("width", Napi::Number::New(env, element.bounds.width));
    bounds.Set("height", Napi::Number::New(env, element.bounds.height));
    obj.Set("bounds", bounds);
    
    // State
    obj.Set("enabled", Napi::Boolean::New(env, element.enabled));
    obj.Set("focused", Napi::Boolean::New(env, element.focused));
    obj.Set("visible", Napi::Boolean::New(env, element.visible));
    obj.Set("selected", Napi::Boolean::New(env, element.selected));
    obj.Set("checked", Napi::Boolean::New(env, element.checked));
    obj.Set("expanded", Napi::Boolean::New(env, element.expanded));
    
    // Hierarchy
    obj.Set("parentId", Napi::Number::New(env, element.parentId));
    obj.Set("depth", Napi::Number::New(env, element.depth));
    
    Napi::Array children = Napi::Array::New(env, element.childrenIds.size());
    for (size_t i = 0; i < element.childrenIds.size(); ++i) {
        children[i] = Napi::Number::New(env, element.childrenIds[i]);
    }
    obj.Set("childrenIds", children);
    
    // Actions
    Napi::Array actions = Napi::Array::New(env, element.actions.size());
    for (size_t i = 0; i < element.actions.size(); ++i) {
        actions[i] = Napi::String::New(env, element.actions[i]);
    }
    obj.Set("actions", actions);
    
    // App context
    obj.Set("appName", Napi::String::New(env, element.appName));
    obj.Set("appBundleId", Napi::String::New(env, element.appBundleId));
    obj.Set("appPid", Napi::Number::New(env, element.appPid));
    obj.Set("windowId", Napi::Number::New(env, element.windowId));
    
    return obj;
}

// Convert InteractiveSnapshot to Napi::Object
Napi::Object SnapshotToNapi(Napi::Env env, const InteractiveSnapshot& snapshot) {
    Napi::Object obj = Napi::Object::New(env);
    
    obj.Set("timestamp", Napi::Number::New(env, snapshot.timestamp));
    obj.Set("durationMs", Napi::Number::New(env, snapshot.durationMs));
    obj.Set("appName", Napi::String::New(env, snapshot.appName));
    obj.Set("appBundleId", Napi::String::New(env, snapshot.appBundleId));
    obj.Set("appPid", Napi::Number::New(env, snapshot.appPid));
    obj.Set("windowId", Napi::Number::New(env, snapshot.windowId));
    obj.Set("windowTitle", Napi::String::New(env, snapshot.windowTitle));
    
    // Window bounds
    Napi::Object bounds = Napi::Object::New(env);
    bounds.Set("x", Napi::Number::New(env, snapshot.windowBounds.x));
    bounds.Set("y", Napi::Number::New(env, snapshot.windowBounds.y));
    bounds.Set("width", Napi::Number::New(env, snapshot.windowBounds.width));
    bounds.Set("height", Napi::Number::New(env, snapshot.windowBounds.height));
    obj.Set("windowBounds", bounds);
    
    // Elements
    Napi::Array elements = Napi::Array::New(env, snapshot.elements.size());
    for (size_t i = 0; i < snapshot.elements.size(); ++i) {
        elements[i] = UIElementToNapi(env, snapshot.elements[i]);
    }
    obj.Set("elements", elements);
    
    // Element counts
    Napi::Object counts = Napi::Object::New(env);
    for (const auto& pair : snapshot.elementCounts) {
        counts.Set(pair.first, Napi::Number::New(env, pair.second));
    }
    obj.Set("elementCounts", counts);
    
    return obj;
}

// Convert WindowInfo to Napi::Object
Napi::Object WindowInfoToNapi(Napi::Env env, const WindowInfo& window) {
    Napi::Object obj = Napi::Object::New(env);
    
    obj.Set("id", Napi::Number::New(env, window.id));
    obj.Set("title", Napi::String::New(env, window.title));
    obj.Set("appName", Napi::String::New(env, window.appName));
    obj.Set("appBundleId", Napi::String::New(env, window.appBundleId));
    obj.Set("appPid", Napi::Number::New(env, window.appPid));
    
    Napi::Object bounds = Napi::Object::New(env);
    bounds.Set("x", Napi::Number::New(env, window.bounds.x));
    bounds.Set("y", Napi::Number::New(env, window.bounds.y));
    bounds.Set("width", Napi::Number::New(env, window.bounds.width));
    bounds.Set("height", Napi::Number::New(env, window.bounds.height));
    obj.Set("bounds", bounds);
    
    obj.Set("focused", Napi::Boolean::New(env, window.focused));
    obj.Set("minimized", Napi::Boolean::New(env, window.minimized));
    
    return obj;
}

// Convert AppInfo to Napi::Object
Napi::Object AppInfoToNapi(Napi::Env env, const AppInfo& app) {
    Napi::Object obj = Napi::Object::New(env);
    
    obj.Set("name", Napi::String::New(env, app.name));
    obj.Set("bundleId", Napi::String::New(env, app.bundleId));
    obj.Set("pid", Napi::Number::New(env, app.pid));
    obj.Set("focused", Napi::Boolean::New(env, app.focused));
    obj.Set("path", Napi::String::New(env, app.path));
    
    return obj;
}

// Convert DisplayInfo to Napi::Object
Napi::Object DisplayInfoToNapi(Napi::Env env, const DisplayInfo& display) {
    Napi::Object obj = Napi::Object::New(env);
    
    obj.Set("id", Napi::Number::New(env, display.id));
    obj.Set("name", Napi::String::New(env, display.name));
    
    Napi::Object bounds = Napi::Object::New(env);
    bounds.Set("x", Napi::Number::New(env, display.bounds.x));
    bounds.Set("y", Napi::Number::New(env, display.bounds.y));
    bounds.Set("width", Napi::Number::New(env, display.bounds.width));
    bounds.Set("height", Napi::Number::New(env, display.bounds.height));
    obj.Set("bounds", bounds);
    
    Napi::Object workArea = Napi::Object::New(env);
    workArea.Set("x", Napi::Number::New(env, display.workArea.x));
    workArea.Set("y", Napi::Number::New(env, display.workArea.y));
    workArea.Set("width", Napi::Number::New(env, display.workArea.width));
    workArea.Set("height", Napi::Number::New(env, display.workArea.height));
    obj.Set("workArea", workArea);
    
    obj.Set("scaleFactor", Napi::Number::New(env, display.scaleFactor));
    obj.Set("isPrimary", Napi::Boolean::New(env, display.isPrimary));
    
    return obj;
}

// Parse ClickOptions from Napi::Object
ClickOptions ParseClickOptions(Napi::Env env, const Napi::Object& obj) {
    ClickOptions options;
    
    if (obj.Has("button")) {
        std::string button = obj.Get("button").As<Napi::String>().Utf8Value();
        options.button = StringToMouseButton(button);
    }
    if (obj.Has("clickCount")) {
        options.clickCount = obj.Get("clickCount").As<Napi::Number>().Int32Value();
    }
    if (obj.Has("modifiers")) {
        Napi::Array mods = obj.Get("modifiers").As<Napi::Array>();
        for (uint32_t i = 0; i < mods.Length(); ++i) {
            options.modifiers.push_back(mods.Get(i).As<Napi::String>().Utf8Value());
        }
    }
    if (obj.Has("moveMouseFirst")) {
        options.moveMouseFirst = obj.Get("moveMouseFirst").As<Napi::Boolean>().Value();
    }
    
    return options;
}

// ============================================================================
// N-API Module Implementation
// ============================================================================

static std::unique_ptr<CentrisSystemControl> g_control;

Napi::Value Initialize(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    SystemControlConfig config;
    
    if (info.Length() > 0 && info[0].IsObject()) {
        Napi::Object opts = info[0].As<Napi::Object>();
        
        if (opts.Has("cacheElements")) {
            config.cacheElements = opts.Get("cacheElements").As<Napi::Boolean>().Value();
        }
        if (opts.Has("cacheTimeoutMs")) {
            config.cacheTimeoutMs = opts.Get("cacheTimeoutMs").As<Napi::Number>().Int32Value();
        }
        if (opts.Has("logPerformance")) {
            config.logPerformance = opts.Get("logPerformance").As<Napi::Boolean>().Value();
        }
        if (opts.Has("moveMouseForClicks")) {
            config.moveMouseForClicks = opts.Get("moveMouseForClicks").As<Napi::Boolean>().Value();
        }
    }
    
    if (!g_control) {
        g_control = std::make_unique<CentrisSystemControl>();
    }
    
    bool result = g_control->Initialize(config);
    return Napi::Boolean::New(env, result);
}

Napi::Value Shutdown(const Napi::CallbackInfo& info) {
    if (g_control) {
        g_control->Shutdown();
        g_control.reset();
    }
    return info.Env().Undefined();
}

Napi::Value GetInteractiveSnapshot(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!g_control) {
        Napi::Error::New(env, "Not initialized").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    SnapshotOptions options;
    
    if (info.Length() > 0 && info[0].IsObject()) {
        Napi::Object opts = info[0].As<Napi::Object>();
        
        if (opts.Has("appName")) {
            options.appName = opts.Get("appName").As<Napi::String>().Utf8Value();
        }
        if (opts.Has("windowTitle")) {
            options.windowTitle = opts.Get("windowTitle").As<Napi::String>().Utf8Value();
        }
        if (opts.Has("includeHidden")) {
            options.includeHidden = opts.Get("includeHidden").As<Napi::Boolean>().Value();
        }
        if (opts.Has("maxDepth")) {
            options.maxDepth = opts.Get("maxDepth").As<Napi::Number>().Int32Value();
        }
    }
    
    auto snapshot = g_control->GetInteractiveSnapshot(options);
    return SnapshotToNapi(env, snapshot);
}

Napi::Value FindElement(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!g_control || info.Length() < 1) {
        return env.Null();
    }
    
    Napi::Object criteria = info[0].As<Napi::Object>();
    
    std::string appName = criteria.Has("appName") ? 
        criteria.Get("appName").As<Napi::String>().Utf8Value() : "";
    std::string role = criteria.Has("role") ? 
        criteria.Get("role").As<Napi::String>().Utf8Value() : "";
    std::string name = criteria.Has("name") ? 
        criteria.Get("name").As<Napi::String>().Utf8Value() : "";
    
    auto result = g_control->FindElement(appName, role, name);
    
    if (result) {
        return UIElementToNapi(env, *result);
    }
    return env.Null();
}

Napi::Value FindElements(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!g_control || info.Length() < 1) {
        return Napi::Array::New(env, 0);
    }
    
    Napi::Object opts = info[0].As<Napi::Object>();
    
    std::string appName = opts.Has("appName") ? 
        opts.Get("appName").As<Napi::String>().Utf8Value() : "";
    
    ElementCriteria criteria;
    if (opts.Has("role")) {
        criteria.role = opts.Get("role").As<Napi::String>().Utf8Value();
    }
    if (opts.Has("name")) {
        criteria.name = opts.Get("name").As<Napi::String>().Utf8Value();
    }
    
    auto elements = g_control->FindElements(appName, criteria);
    
    Napi::Array result = Napi::Array::New(env, elements.size());
    for (size_t i = 0; i < elements.size(); ++i) {
        result[i] = UIElementToNapi(env, elements[i]);
    }
    return result;
}

Napi::Value GetElementById(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!g_control || info.Length() < 1) {
        return env.Null();
    }
    
    int64_t elementId = info[0].As<Napi::Number>().Int64Value();
    auto result = g_control->GetElement(elementId);
    
    if (result) {
        return UIElementToNapi(env, *result);
    }
    return env.Null();
}

Napi::Value ClickElement(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!g_control || info.Length() < 1) {
        return Napi::Boolean::New(env, false);
    }
    
    int64_t elementId = info[0].As<Napi::Number>().Int64Value();
    
    ClickOptions options;
    if (info.Length() > 1 && info[1].IsObject()) {
        options = ParseClickOptions(env, info[1].As<Napi::Object>());
    }
    
    bool result = g_control->ClickElement(elementId, options);
    return Napi::Boolean::New(env, result);
}

Napi::Value TypeIntoElement(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!g_control || info.Length() < 2) {
        return Napi::Boolean::New(env, false);
    }
    
    int64_t elementId = info[0].As<Napi::Number>().Int64Value();
    std::string text = info[1].As<Napi::String>().Utf8Value();
    
    TypeOptions options;
    if (info.Length() > 2 && info[2].IsObject()) {
        Napi::Object opts = info[2].As<Napi::Object>();
        if (opts.Has("clearFirst")) {
            options.clearFirst = opts.Get("clearFirst").As<Napi::Boolean>().Value();
        }
        if (opts.Has("pressEnter")) {
            options.pressEnter = opts.Get("pressEnter").As<Napi::Boolean>().Value();
        }
        if (opts.Has("typeDelayMs")) {
            options.typeDelayMs = opts.Get("typeDelayMs").As<Napi::Number>().Int32Value();
        }
    }
    
    bool result = g_control->TypeIntoElement(elementId, text, options);
    return Napi::Boolean::New(env, result);
}

Napi::Value PerformAction(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!g_control || info.Length() < 2) {
        return Napi::Boolean::New(env, false);
    }
    
    int64_t elementId = info[0].As<Napi::Number>().Int64Value();
    std::string action = info[1].As<Napi::String>().Utf8Value();
    
    bool result = g_control->PerformAction(elementId, action);
    return Napi::Boolean::New(env, result);
}

Napi::Value SetValue(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!g_control || info.Length() < 2) {
        return Napi::Boolean::New(env, false);
    }
    
    int64_t elementId = info[0].As<Napi::Number>().Int64Value();
    std::string value = info[1].As<Napi::String>().Utf8Value();
    
    bool result = g_control->SetValue(elementId, value);
    return Napi::Boolean::New(env, result);
}

/**
 * Insert text at cursor position in the currently focused text field
 * This is the key function for dictation - bypasses clipboard entirely!
 */
Napi::Value InsertTextAtCursor(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!g_control || info.Length() < 1) {
        return Napi::Boolean::New(env, false);
    }
    
    std::string text = info[0].As<Napi::String>().Utf8Value();
    
    bool result = g_control->InsertTextAtCursor(text);
    return Napi::Boolean::New(env, result);
}

Napi::Value MoveMouse(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!g_control || info.Length() < 2) {
        return Napi::Boolean::New(env, false);
    }
    
    int x = info[0].As<Napi::Number>().Int32Value();
    int y = info[1].As<Napi::Number>().Int32Value();
    
    bool result = g_control->MoveMouse(x, y);
    return Napi::Boolean::New(env, result);
}

Napi::Value Click(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!g_control || info.Length() < 2) {
        return Napi::Boolean::New(env, false);
    }
    
    int x = info[0].As<Napi::Number>().Int32Value();
    int y = info[1].As<Napi::Number>().Int32Value();
    
    ClickOptions options;
    if (info.Length() > 2 && info[2].IsObject()) {
        options = ParseClickOptions(env, info[2].As<Napi::Object>());
    }
    
    bool result = g_control->Click(x, y, options);
    return Napi::Boolean::New(env, result);
}

Napi::Value Drag(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!g_control || info.Length() < 4) {
        return Napi::Boolean::New(env, false);
    }
    
    int fromX = info[0].As<Napi::Number>().Int32Value();
    int fromY = info[1].As<Napi::Number>().Int32Value();
    int toX = info[2].As<Napi::Number>().Int32Value();
    int toY = info[3].As<Napi::Number>().Int32Value();
    
    bool result = g_control->Drag(fromX, fromY, toX, toY);
    return Napi::Boolean::New(env, result);
}

Napi::Value Type(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!g_control || info.Length() < 1) {
        return Napi::Boolean::New(env, false);
    }
    
    std::string text = info[0].As<Napi::String>().Utf8Value();
    
    bool result = g_control->Type(text);
    return Napi::Boolean::New(env, result);
}

Napi::Value KeyPress(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!g_control || info.Length() < 1) {
        return Napi::Boolean::New(env, false);
    }
    
    std::string keyCombo = info[0].As<Napi::String>().Utf8Value();
    
    bool result = g_control->KeyPress(keyCombo);
    return Napi::Boolean::New(env, result);
}

Napi::Value Scroll(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!g_control || info.Length() < 1) {
        return Napi::Boolean::New(env, false);
    }
    
    Napi::Object delta = info[0].As<Napi::Object>();
    ScrollDelta scroll;
    if (delta.Has("deltaX")) {
        scroll.deltaX = delta.Get("deltaX").As<Napi::Number>().Int32Value();
    }
    if (delta.Has("deltaY")) {
        scroll.deltaY = delta.Get("deltaY").As<Napi::Number>().Int32Value();
    }
    
    bool result = g_control->Scroll(scroll);
    return Napi::Boolean::New(env, result);
}

Napi::Value GetMousePosition(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!g_control) {
        return env.Null();
    }
    
    auto [x, y] = g_control->GetMousePosition();
    
    Napi::Object result = Napi::Object::New(env);
    result.Set("x", Napi::Number::New(env, x));
    result.Set("y", Napi::Number::New(env, y));
    return result;
}

Napi::Value GetWindows(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!g_control) {
        return Napi::Array::New(env, 0);
    }
    
    std::string appName;
    if (info.Length() > 0 && info[0].IsString()) {
        appName = info[0].As<Napi::String>().Utf8Value();
    }
    
    auto windows = g_control->GetWindows(appName);
    
    Napi::Array result = Napi::Array::New(env, windows.size());
    for (size_t i = 0; i < windows.size(); ++i) {
        result[i] = WindowInfoToNapi(env, windows[i]);
    }
    return result;
}

Napi::Value GetFrontmostWindow(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!g_control) {
        return env.Null();
    }
    
    auto result = g_control->GetFrontmostWindow();
    if (result) {
        return WindowInfoToNapi(env, *result);
    }
    return env.Null();
}

Napi::Value FocusWindow(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!g_control || info.Length() < 1) {
        return Napi::Boolean::New(env, false);
    }
    
    int64_t windowId = info[0].As<Napi::Number>().Int64Value();
    bool result = g_control->FocusWindow(windowId);
    return Napi::Boolean::New(env, result);
}

Napi::Value ResizeWindow(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!g_control || info.Length() < 3) {
        return Napi::Boolean::New(env, false);
    }
    
    int64_t windowId = info[0].As<Napi::Number>().Int64Value();
    int width = info[1].As<Napi::Number>().Int32Value();
    int height = info[2].As<Napi::Number>().Int32Value();
    
    bool result = g_control->ResizeWindow(windowId, width, height);
    return Napi::Boolean::New(env, result);
}

Napi::Value MoveWindow(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!g_control || info.Length() < 3) {
        return Napi::Boolean::New(env, false);
    }
    
    int64_t windowId = info[0].As<Napi::Number>().Int64Value();
    int x = info[1].As<Napi::Number>().Int32Value();
    int y = info[2].As<Napi::Number>().Int32Value();
    
    bool result = g_control->MoveWindow(windowId, x, y);
    return Napi::Boolean::New(env, result);
}

Napi::Value GetRunningApps(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!g_control) {
        return Napi::Array::New(env, 0);
    }
    
    auto apps = g_control->GetRunningApps();
    
    Napi::Array result = Napi::Array::New(env, apps.size());
    for (size_t i = 0; i < apps.size(); ++i) {
        result[i] = AppInfoToNapi(env, apps[i]);
    }
    return result;
}

Napi::Value GetFrontmostApp(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!g_control) {
        return env.Null();
    }
    
    auto result = g_control->GetFrontmostApp();
    if (result) {
        return AppInfoToNapi(env, *result);
    }
    return env.Null();
}

Napi::Value ActivateApp(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!g_control || info.Length() < 1) {
        return Napi::Boolean::New(env, false);
    }
    
    std::string appName = info[0].As<Napi::String>().Utf8Value();
    bool result = g_control->ActivateApp(appName);
    return Napi::Boolean::New(env, result);
}

Napi::Value LaunchApp(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!g_control || info.Length() < 1) {
        return Napi::Boolean::New(env, false);
    }
    
    std::string bundleIdOrPath = info[0].As<Napi::String>().Utf8Value();
    bool result = g_control->LaunchApp(bundleIdOrPath);
    return Napi::Boolean::New(env, result);
}

Napi::Value GetDisplays(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (!g_control) {
        return Napi::Array::New(env, 0);
    }
    
    auto displays = g_control->GetDisplays();
    
    Napi::Array result = Napi::Array::New(env, displays.size());
    for (size_t i = 0; i < displays.size(); ++i) {
        result[i] = DisplayInfoToNapi(env, displays[i]);
    }
    return result;
}

// Module initialization
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    // Lifecycle
    exports.Set("initialize", Napi::Function::New(env, Initialize));
    exports.Set("shutdown", Napi::Function::New(env, Shutdown));
    
    // Element Discovery
    exports.Set("getInteractiveSnapshot", Napi::Function::New(env, GetInteractiveSnapshot));
    exports.Set("findElement", Napi::Function::New(env, FindElement));
    exports.Set("findElements", Napi::Function::New(env, FindElements));
    exports.Set("getElementById", Napi::Function::New(env, GetElementById));
    
    // Element Actions
    exports.Set("clickElement", Napi::Function::New(env, ClickElement));
    exports.Set("typeIntoElement", Napi::Function::New(env, TypeIntoElement));
    exports.Set("performAction", Napi::Function::New(env, PerformAction));
    exports.Set("setValue", Napi::Function::New(env, SetValue));
    exports.Set("insertTextAtCursor", Napi::Function::New(env, InsertTextAtCursor));
    
    // Mouse/Keyboard
    exports.Set("moveMouse", Napi::Function::New(env, MoveMouse));
    exports.Set("click", Napi::Function::New(env, Click));
    exports.Set("drag", Napi::Function::New(env, Drag));
    exports.Set("type", Napi::Function::New(env, Type));
    exports.Set("keyPress", Napi::Function::New(env, KeyPress));
    exports.Set("scroll", Napi::Function::New(env, Scroll));
    exports.Set("getMousePosition", Napi::Function::New(env, GetMousePosition));
    
    // Window Management
    exports.Set("getWindows", Napi::Function::New(env, GetWindows));
    exports.Set("getFrontmostWindow", Napi::Function::New(env, GetFrontmostWindow));
    exports.Set("focusWindow", Napi::Function::New(env, FocusWindow));
    exports.Set("resizeWindow", Napi::Function::New(env, ResizeWindow));
    exports.Set("moveWindow", Napi::Function::New(env, MoveWindow));
    
    // Application Management
    exports.Set("getRunningApps", Napi::Function::New(env, GetRunningApps));
    exports.Set("getFrontmostApp", Napi::Function::New(env, GetFrontmostApp));
    exports.Set("activateApp", Napi::Function::New(env, ActivateApp));
    exports.Set("launchApp", Napi::Function::New(env, LaunchApp));
    
    // Display
    exports.Set("getDisplays", Napi::Function::New(env, GetDisplays));
    
    return exports;
}

NODE_API_MODULE(centris_control, Init)

}  // namespace centris

