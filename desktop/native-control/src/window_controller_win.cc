/**
 * Centris Native Control - Windows Window Controller
 * 
 * Uses Win32 API for window management.
 * This is a stub implementation - full implementation pending.
 */

#include "window_controller.h"
#include "utils.h"

#ifdef CENTRIS_PLATFORM_WIN

#include <windows.h>
#include <vector>

namespace centris {

/**
 * Windows Window Controller Implementation (Stub)
 */
class WindowControllerWin : public WindowController {
public:
    WindowControllerWin() = default;
    ~WindowControllerWin() override { Shutdown(); }
    
    bool Initialize() override {
        if (initialized_) return true;
        initialized_ = true;
        utils::LogInfo("WindowController initialized (Windows)");
        return true;
    }
    
    void Shutdown() override {
        initialized_ = false;
    }
    
    std::vector<WindowInfo> GetWindows(const std::string& appName) override {
        std::vector<WindowInfo> result;
        windowList_ = &result;
        filterAppName_ = appName;
        
        EnumWindows(EnumWindowsProc, reinterpret_cast<LPARAM>(this));
        
        windowList_ = nullptr;
        return result;
    }
    
    std::optional<WindowInfo> GetFrontmostWindow() override {
        HWND hwnd = GetForegroundWindow();
        if (!hwnd) return std::nullopt;
        return WindowInfoFromHWND(hwnd);
    }
    
    std::optional<WindowInfo> GetWindow(int64_t windowId) override {
        HWND hwnd = reinterpret_cast<HWND>(windowId);
        if (!IsWindow(hwnd)) return std::nullopt;
        return WindowInfoFromHWND(hwnd);
    }
    
    std::vector<WindowInfo> GetWindowsForApp(const std::string& appName) override {
        return GetWindows(appName);
    }
    
    std::optional<WindowInfo> GetWindowAtPoint(int x, int y) override {
        POINT point = { x, y };
        HWND hwnd = WindowFromPoint(point);
        if (!hwnd) return std::nullopt;
        
        // Get top-level window
        while (HWND parent = GetParent(hwnd)) {
            hwnd = parent;
        }
        
        return WindowInfoFromHWND(hwnd);
    }
    
    bool FocusWindow(int64_t windowId) override {
        HWND hwnd = reinterpret_cast<HWND>(windowId);
        if (!IsWindow(hwnd)) return false;
        
        // Restore if minimized
        if (IsIconic(hwnd)) {
            ShowWindow(hwnd, SW_RESTORE);
        }
        
        return SetForegroundWindow(hwnd) != 0;
    }
    
    bool MoveWindow(int64_t windowId, int x, int y) override {
        HWND hwnd = reinterpret_cast<HWND>(windowId);
        if (!IsWindow(hwnd)) return false;
        
        RECT rect;
        GetWindowRect(hwnd, &rect);
        int width = rect.right - rect.left;
        int height = rect.bottom - rect.top;
        
        return ::MoveWindow(hwnd, x, y, width, height, TRUE) != 0;
    }
    
    bool ResizeWindow(int64_t windowId, int width, int height) override {
        HWND hwnd = reinterpret_cast<HWND>(windowId);
        if (!IsWindow(hwnd)) return false;
        
        RECT rect;
        GetWindowRect(hwnd, &rect);
        
        return ::MoveWindow(hwnd, rect.left, rect.top, width, height, TRUE) != 0;
    }
    
    bool SetWindowBounds(int64_t windowId, int x, int y, int width, int height) override {
        HWND hwnd = reinterpret_cast<HWND>(windowId);
        if (!IsWindow(hwnd)) return false;
        
        return ::MoveWindow(hwnd, x, y, width, height, TRUE) != 0;
    }
    
    bool MinimizeWindow(int64_t windowId) override {
        HWND hwnd = reinterpret_cast<HWND>(windowId);
        if (!IsWindow(hwnd)) return false;
        
        return ShowWindow(hwnd, SW_MINIMIZE) != 0;
    }
    
    bool MaximizeWindow(int64_t windowId) override {
        HWND hwnd = reinterpret_cast<HWND>(windowId);
        if (!IsWindow(hwnd)) return false;
        
        return ShowWindow(hwnd, SW_MAXIMIZE) != 0;
    }
    
    bool RestoreWindow(int64_t windowId) override {
        HWND hwnd = reinterpret_cast<HWND>(windowId);
        if (!IsWindow(hwnd)) return false;
        
        return ShowWindow(hwnd, SW_RESTORE) != 0;
    }
    
    bool CloseWindow(int64_t windowId) override {
        HWND hwnd = reinterpret_cast<HWND>(windowId);
        if (!IsWindow(hwnd)) return false;
        
        return PostMessage(hwnd, WM_CLOSE, 0, 0) != 0;
    }
    
    bool ToggleFullscreen(int64_t windowId) override {
        // Windows doesn't have a native fullscreen toggle
        // This would need custom implementation
        return false;
    }
    
    bool IsMinimized(int64_t windowId) override {
        HWND hwnd = reinterpret_cast<HWND>(windowId);
        return IsIconic(hwnd) != 0;
    }
    
    bool IsMaximized(int64_t windowId) override {
        HWND hwnd = reinterpret_cast<HWND>(windowId);
        return IsZoomed(hwnd) != 0;
    }
    
    bool IsFullscreen(int64_t windowId) override {
        HWND hwnd = reinterpret_cast<HWND>(windowId);
        if (!IsWindow(hwnd)) return false;
        
        RECT windowRect;
        GetWindowRect(hwnd, &windowRect);
        
        HMONITOR monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        MONITORINFO mi = { sizeof(mi) };
        GetMonitorInfo(monitor, &mi);
        
        return windowRect.left == mi.rcMonitor.left &&
               windowRect.top == mi.rcMonitor.top &&
               windowRect.right == mi.rcMonitor.right &&
               windowRect.bottom == mi.rcMonitor.bottom;
    }
    
    bool IsFocused(int64_t windowId) override {
        HWND hwnd = reinterpret_cast<HWND>(windowId);
        return hwnd == GetForegroundWindow();
    }

private:
    bool initialized_ = false;
    std::vector<WindowInfo>* windowList_ = nullptr;
    std::string filterAppName_;
    
    static BOOL CALLBACK EnumWindowsProc(HWND hwnd, LPARAM lParam) {
        auto* self = reinterpret_cast<WindowControllerWin*>(lParam);
        
        if (!IsWindowVisible(hwnd)) return TRUE;
        
        // Get window title
        char title[256];
        GetWindowTextA(hwnd, title, sizeof(title));
        if (strlen(title) == 0) return TRUE;
        
        // Get process name
        DWORD pid;
        GetWindowThreadProcessId(hwnd, &pid);
        
        HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
        char processName[MAX_PATH] = "";
        if (process) {
            DWORD size = MAX_PATH;
            QueryFullProcessImageNameA(process, 0, processName, &size);
            CloseHandle(process);
        }
        
        // Filter by app name if specified
        if (!self->filterAppName_.empty()) {
            if (!utils::ContainsIgnoreCase(processName, self->filterAppName_) &&
                !utils::ContainsIgnoreCase(title, self->filterAppName_)) {
                return TRUE;
            }
        }
        
        WindowInfo info = self->WindowInfoFromHWND(hwnd);
        self->windowList_->push_back(info);
        
        return TRUE;
    }
    
    WindowInfo WindowInfoFromHWND(HWND hwnd) {
        WindowInfo info;
        info.id = reinterpret_cast<int64_t>(hwnd);
        
        // Get title
        char title[256];
        GetWindowTextA(hwnd, title, sizeof(title));
        info.title = title;
        
        // Get bounds
        RECT rect;
        GetWindowRect(hwnd, &rect);
        info.bounds.x = rect.left;
        info.bounds.y = rect.top;
        info.bounds.width = rect.right - rect.left;
        info.bounds.height = rect.bottom - rect.top;
        
        // Get process info
        DWORD pid;
        GetWindowThreadProcessId(hwnd, &pid);
        info.appPid = pid;
        
        HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
        if (process) {
            char processName[MAX_PATH];
            DWORD size = MAX_PATH;
            if (QueryFullProcessImageNameA(process, 0, processName, &size)) {
                // Extract filename from path
                char* filename = strrchr(processName, '\\');
                info.appName = filename ? filename + 1 : processName;
            }
            CloseHandle(process);
        }
        
        info.focused = (hwnd == GetForegroundWindow());
        info.minimized = IsIconic(hwnd) != 0;
        
        return info;
    }
};

// Factory method
std::unique_ptr<WindowController> WindowController::Create() {
    return std::make_unique<WindowControllerWin>();
}

}  // namespace centris

#endif  // CENTRIS_PLATFORM_WIN

