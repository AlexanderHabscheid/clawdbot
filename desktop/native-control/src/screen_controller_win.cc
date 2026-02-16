/**
 * Centris Native Control - Windows Screen Controller
 * 
 * Uses EnumDisplayMonitors for display management.
 * This is a stub implementation - full implementation pending.
 */

#include "screen_controller.h"
#include "utils.h"

#ifdef CENTRIS_PLATFORM_WIN

#include <windows.h>
#include <vector>

namespace centris {

/**
 * Windows Screen Controller Implementation (Stub)
 */
class ScreenControllerWin : public ScreenController {
public:
    ScreenControllerWin() = default;
    ~ScreenControllerWin() override { Shutdown(); }
    
    bool Initialize() override {
        if (initialized_) return true;
        initialized_ = true;
        utils::LogInfo("ScreenController initialized (Windows)");
        return true;
    }
    
    void Shutdown() override {
        initialized_ = false;
    }
    
    std::vector<DisplayInfo> GetDisplays() override {
        std::vector<DisplayInfo> result;
        displayList_ = &result;
        
        EnumDisplayMonitors(nullptr, nullptr, MonitorEnumProc, reinterpret_cast<LPARAM>(this));
        
        displayList_ = nullptr;
        return result;
    }
    
    DisplayInfo GetPrimaryDisplay() override {
        HMONITOR primary = MonitorFromPoint({ 0, 0 }, MONITOR_DEFAULTTOPRIMARY);
        return MonitorToDisplayInfo(primary, true);
    }
    
    std::optional<DisplayInfo> GetDisplay(int64_t displayId) override {
        auto displays = GetDisplays();
        for (const auto& display : displays) {
            if (display.id == displayId) {
                return display;
            }
        }
        return std::nullopt;
    }
    
    std::optional<DisplayInfo> GetDisplayAtPoint(int x, int y) override {
        POINT point = { x, y };
        HMONITOR monitor = MonitorFromPoint(point, MONITOR_DEFAULTTONULL);
        if (!monitor) return std::nullopt;
        
        return MonitorToDisplayInfo(monitor, false);
    }
    
    std::optional<DisplayInfo> GetDisplayForWindow(int64_t windowId) override {
        HWND hwnd = reinterpret_cast<HWND>(windowId);
        if (!IsWindow(hwnd)) return std::nullopt;
        
        HMONITOR monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        return MonitorToDisplayInfo(monitor, false);
    }
    
    std::pair<int, int> LogicalToPhysical(int x, int y) override {
        // Windows DPI scaling
        auto displayOpt = GetDisplayAtPoint(x, y);
        if (!displayOpt) return {x, y};
        
        double scale = displayOpt->scaleFactor;
        return {static_cast<int>(x * scale), static_cast<int>(y * scale)};
    }
    
    std::pair<int, int> PhysicalToLogical(int x, int y) override {
        auto displayOpt = GetDisplayAtPoint(x, y);
        if (!displayOpt) return {x, y};
        
        double scale = displayOpt->scaleFactor;
        return {static_cast<int>(x / scale), static_cast<int>(y / scale)};
    }
    
    double GetScaleFactorAtPoint(int x, int y) override {
        auto displayOpt = GetDisplayAtPoint(x, y);
        return displayOpt ? displayOpt->scaleFactor : 1.0;
    }
    
    Bounds GetTotalBounds() override {
        Bounds result;
        result.x = GetSystemMetrics(SM_XVIRTUALSCREEN);
        result.y = GetSystemMetrics(SM_YVIRTUALSCREEN);
        result.width = GetSystemMetrics(SM_CXVIRTUALSCREEN);
        result.height = GetSystemMetrics(SM_CYVIRTUALSCREEN);
        return result;
    }
    
    int GetMenuBarHeight() override {
        return GetSystemMetrics(SM_CYMENU);
    }
    
    Bounds GetDockBounds() override {
        // Get taskbar bounds
        HWND taskbar = FindWindowA("Shell_TrayWnd", nullptr);
        if (!taskbar) return Bounds{};
        
        RECT rect;
        GetWindowRect(taskbar, &rect);
        
        Bounds result;
        result.x = rect.left;
        result.y = rect.top;
        result.width = rect.right - rect.left;
        result.height = rect.bottom - rect.top;
        
        return result;
    }

private:
    bool initialized_ = false;
    std::vector<DisplayInfo>* displayList_ = nullptr;
    
    static BOOL CALLBACK MonitorEnumProc(HMONITOR hMonitor, HDC hdcMonitor,
                                         LPRECT lprcMonitor, LPARAM dwData) {
        auto* self = reinterpret_cast<ScreenControllerWin*>(dwData);
        
        MONITORINFOEX mi = { sizeof(mi) };
        GetMonitorInfo(hMonitor, &mi);
        
        DisplayInfo info = self->MonitorToDisplayInfo(hMonitor, 
            (mi.dwFlags & MONITORINFOF_PRIMARY) != 0);
        
        self->displayList_->push_back(info);
        return TRUE;
    }
    
    DisplayInfo MonitorToDisplayInfo(HMONITOR monitor, bool checkPrimary) {
        DisplayInfo info;
        
        MONITORINFOEX mi = { sizeof(mi) };
        GetMonitorInfo(monitor, &mi);
        
        info.id = reinterpret_cast<int64_t>(monitor);
        info.name = mi.szDevice;
        
        // Full bounds
        info.bounds.x = mi.rcMonitor.left;
        info.bounds.y = mi.rcMonitor.top;
        info.bounds.width = mi.rcMonitor.right - mi.rcMonitor.left;
        info.bounds.height = mi.rcMonitor.bottom - mi.rcMonitor.top;
        
        // Work area (excluding taskbar)
        info.workArea.x = mi.rcWork.left;
        info.workArea.y = mi.rcWork.top;
        info.workArea.width = mi.rcWork.right - mi.rcWork.left;
        info.workArea.height = mi.rcWork.bottom - mi.rcWork.top;
        
        // Check if primary
        if (checkPrimary) {
            info.isPrimary = true;
        } else {
            info.isPrimary = (mi.dwFlags & MONITORINFOF_PRIMARY) != 0;
        }
        
        // Get DPI/scale factor
        UINT dpiX = 96, dpiY = 96;
        if (GetDpiForMonitor) {
            GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &dpiX, &dpiY);
        }
        info.scaleFactor = dpiX / 96.0;
        
        return info;
    }
    
    // Function pointer for GetDpiForMonitor (not available on older Windows)
    typedef HRESULT (WINAPI *GetDpiForMonitorFunc)(HMONITOR, UINT, UINT*, UINT*);
    static GetDpiForMonitorFunc GetDpiForMonitor;
};

ScreenControllerWin::GetDpiForMonitorFunc ScreenControllerWin::GetDpiForMonitor = nullptr;

// Factory method
std::unique_ptr<ScreenController> ScreenController::Create() {
    // Load GetDpiForMonitor dynamically (Windows 8.1+)
    HMODULE shcore = LoadLibraryA("Shcore.dll");
    if (shcore) {
        ScreenControllerWin::GetDpiForMonitor = reinterpret_cast<ScreenControllerWin::GetDpiForMonitorFunc>(
            GetProcAddress(shcore, "GetDpiForMonitor"));
    }
    
    return std::make_unique<ScreenControllerWin>();
}

}  // namespace centris

#endif  // CENTRIS_PLATFORM_WIN

