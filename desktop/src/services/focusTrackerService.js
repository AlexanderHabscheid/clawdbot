/**
 * FocusTrackerService - Tracks focused text elements for dictation
 *
 * This service captures the focused text element when dictation starts
 * and restores focus to that element before injecting text.
 *
 * This ensures that dictated text goes to the text box the user clicked on,
 * not wherever the cursor happens to be when transcription completes.
 *
 * Uses macOS Accessibility API to:
 * 1. Capture the focused application and UI element
 * 2. Restore focus to that element before text injection
 */

const { spawn, spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

class FocusTrackerService {
  constructor() {
    // Stored focus target info
    this.targetFocus = null;

    // Path to native focus utility
    this.focusUtilityPath = null;
    this.findFocusUtility();
  }

  /**
   * Find the native focus utility binary
   */
  findFocusUtility() {
    const candidates = new Set([
      path.join(__dirname, "..", "..", "resources", "bin", "macos-focus-tracker"),
      path.join(__dirname, "..", "..", "resources", "macos-focus-tracker"),
    ]);

    if (process.resourcesPath) {
      [
        path.join(process.resourcesPath, "macos-focus-tracker"),
        path.join(process.resourcesPath, "bin", "macos-focus-tracker"),
        path.join(process.resourcesPath, "resources", "macos-focus-tracker"),
        path.join(process.resourcesPath, "resources", "bin", "macos-focus-tracker"),
        path.join(process.resourcesPath, "app.asar.unpacked", "resources", "macos-focus-tracker"),
        path.join(
          process.resourcesPath,
          "app.asar.unpacked",
          "resources",
          "bin",
          "macos-focus-tracker",
        ),
      ].forEach((candidate) => candidates.add(candidate));
    }

    for (const candidate of candidates) {
      try {
        const stats = fs.statSync(candidate);
        if (stats.isFile()) {
          this.focusUtilityPath = candidate;
          this.safeLog("✅ Found native focus tracker:", candidate);
          return;
        }
      } catch {
        continue;
      }
    }

    this.safeLog("⚠️ Native focus tracker not found, will use AppleScript fallback");
  }

  // Safe logging method - only log in development
  safeLog(...args) {
    if (process.env.NODE_ENV === "development") {
      try {
        console.log("[FocusTracker]", ...args);
      } catch (error) {
        // Silently ignore EPIPE errors in logging
        if (error.code !== "EPIPE") {
          process.stderr.write(`Log error: ${error.message}\n`);
        }
      }
    }
  }

  /**
   * Capture the currently focused element info
   * Call this when dictation starts to remember where to inject text
   *
   * @returns {Object} Focus info including app name, window, element reference
   */
  async captureFocus() {
    this.safeLog("📍 Capturing current focus...");

    try {
      if (process.platform === "darwin") {
        return await this.captureFocusMacOS();
      } else if (process.platform === "win32") {
        return await this.captureFocusWindows();
      } else {
        return await this.captureFocusLinux();
      }
    } catch (error) {
      this.safeLog("⚠️ Failed to capture focus:", error.message);
      return null;
    }
  }

  /**
   * macOS: Capture focused element using Accessibility API
   */
  async captureFocusMacOS() {
    return new Promise((resolve, reject) => {
      // Use AppleScript to capture focus info (more reliable across apps)
      const script = `
        tell application "System Events"
          set frontApp to first application process whose frontmost is true
          set frontAppName to name of frontApp
          set frontAppBundle to bundle identifier of frontApp
          
          try
            set frontWindow to first window of frontApp
            set frontWindowName to name of frontWindow
          on error
            set frontWindowName to ""
          end try
          
          -- Get focused element info
          try
            set focusedElem to focused of frontApp
            set elemRole to role of focusedElem
            set elemDescription to description of focusedElem
          on error
            set elemRole to ""
            set elemDescription to ""
          end try
          
          return frontAppName & "|" & frontAppBundle & "|" & frontWindowName & "|" & elemRole & "|" & elemDescription
        end tell
      `;

      const proc = spawn("osascript", ["-e", script]);

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      const timeoutId = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGKILL");
        reject(new Error("Focus capture timed out"));
      }, 3000);

      proc.on("close", (code) => {
        if (timedOut) {
          return;
        }
        clearTimeout(timeoutId);

        if (code === 0 && stdout.trim()) {
          const parts = stdout.trim().split("|");
          const focusInfo = {
            platform: "darwin",
            appName: parts[0] || "",
            bundleId: parts[1] || "",
            windowName: parts[2] || "",
            elementRole: parts[3] || "",
            elementDescription: parts[4] || "",
            capturedAt: Date.now(),
          };

          this.targetFocus = focusInfo;
          this.safeLog(
            "✅ Focus captured:",
            focusInfo.appName,
            "-",
            focusInfo.windowName || "main window",
          );
          resolve(focusInfo);
        } else {
          reject(new Error(`Focus capture failed (code ${code}): ${stderr}`));
        }
      });

      proc.on("error", (error) => {
        if (timedOut) {
          return;
        }
        clearTimeout(timeoutId);
        reject(error);
      });
    });
  }

  /**
   * Windows: Capture focused element
   */
  async captureFocusWindows() {
    return new Promise((resolve, reject) => {
      const script = `
        Add-Type -AssemblyName UIAutomationClient
        $focusedElement = [System.Windows.Automation.AutomationElement]::FocusedElement
        if ($null -ne $focusedElement) {
          $processId = $focusedElement.Current.ProcessId
          $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
          $appName = if ($process) { $process.ProcessName } else { "Unknown" }
          $controlType = $focusedElement.Current.ControlType.ProgrammaticName
          $name = $focusedElement.Current.Name
          Write-Output "$appName|$controlType|$name"
        } else {
          Write-Error "No focused element"
        }
      `;

      const proc = spawn("powershell", ["-Command", script]);

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      const timeoutId = setTimeout(() => {
        timedOut = true;
        proc.kill();
        reject(new Error("Focus capture timed out"));
      }, 5000);

      proc.on("close", (code) => {
        if (timedOut) {
          return;
        }
        clearTimeout(timeoutId);

        if (code === 0 && stdout.trim()) {
          const parts = stdout.trim().split("|");
          const focusInfo = {
            platform: "win32",
            appName: parts[0] || "",
            controlType: parts[1] || "",
            elementName: parts[2] || "",
            capturedAt: Date.now(),
          };

          this.targetFocus = focusInfo;
          this.safeLog("✅ Focus captured:", focusInfo.appName);
          resolve(focusInfo);
        } else {
          reject(new Error(`Focus capture failed: ${stderr}`));
        }
      });

      proc.on("error", (error) => {
        if (timedOut) {
          return;
        }
        clearTimeout(timeoutId);
        reject(error);
      });
    });
  }

  /**
   * Linux: Capture focused element
   */
  async captureFocusLinux() {
    // Linux support - use xdotool for X11
    const isWayland =
      (process.env.XDG_SESSION_TYPE || "").toLowerCase() === "wayland" ||
      !!process.env.WAYLAND_DISPLAY;

    if (isWayland) {
      this.safeLog("⚠️ Wayland focus capture not fully supported");
      return {
        platform: "linux-wayland",
        appName: "",
        capturedAt: Date.now(),
      };
    }

    return new Promise((resolve, reject) => {
      const proc = spawn("xdotool", ["getactivewindow", "getwindowname"]);

      let stdout = "";
      let timedOut = false;

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      const timeoutId = setTimeout(() => {
        timedOut = true;
        proc.kill();
        reject(new Error("Focus capture timed out"));
      }, 2000);

      proc.on("close", (code) => {
        if (timedOut) {
          return;
        }
        clearTimeout(timeoutId);

        if (code === 0) {
          const focusInfo = {
            platform: "linux",
            windowName: stdout.trim(),
            capturedAt: Date.now(),
          };

          this.targetFocus = focusInfo;
          this.safeLog("✅ Focus captured:", focusInfo.windowName);
          resolve(focusInfo);
        } else {
          reject(new Error("Focus capture failed"));
        }
      });

      proc.on("error", (error) => {
        if (timedOut) {
          return;
        }
        clearTimeout(timeoutId);
        reject(error);
      });
    });
  }

  /**
   * Restore focus to the previously captured element
   * Call this before injecting text
   *
   * @returns {boolean} True if focus was restored successfully
   */
  async restoreFocus() {
    if (!this.targetFocus) {
      this.safeLog("⚠️ No target focus to restore");
      return false;
    }

    // Check if focus is stale (older than 2 minutes)
    const MAX_FOCUS_AGE_MS = 2 * 60 * 1000; // 2 minutes
    if (Date.now() - this.targetFocus.capturedAt > MAX_FOCUS_AGE_MS) {
      this.safeLog("⚠️ Stored focus is stale, skipping restore");
      this.targetFocus = null;
      return false;
    }

    this.safeLog("🔄 Restoring focus to:", this.targetFocus.appName || this.targetFocus.windowName);

    try {
      if (process.platform === "darwin") {
        return await this.restoreFocusMacOS();
      } else if (process.platform === "win32") {
        return await this.restoreFocusWindows();
      } else {
        return await this.restoreFocusLinux();
      }
    } catch (error) {
      this.safeLog("⚠️ Failed to restore focus:", error.message);
      return false;
    }
  }

  /**
   * macOS: Restore focus using AppleScript
   */
  async restoreFocusMacOS() {
    const focusInfo = this.targetFocus;
    if (!focusInfo || !focusInfo.appName) {
      return false;
    }

    return new Promise((resolve, reject) => {
      // Activate the app - this brings it to front and focuses it
      const script = `
        tell application "${focusInfo.appName}"
          activate
        end tell
        
        -- Small delay to let the app activate
        delay 0.05
        
        -- Return OK
        return "OK"
      `;

      const proc = spawn("osascript", ["-e", script]);

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      const timeoutId = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGKILL");
        // Timeout is OK - app might still be activated
        resolve(true);
      }, 1000);

      proc.on("close", (code) => {
        if (timedOut) {
          return;
        }
        clearTimeout(timeoutId);

        if (code === 0) {
          this.safeLog("✅ Focus restored to:", focusInfo.appName);
          resolve(true);
        } else {
          this.safeLog("⚠️ Focus restore failed:", stderr);
          resolve(false);
        }
      });

      proc.on("error", (error) => {
        if (timedOut) {
          return;
        }
        clearTimeout(timeoutId);
        resolve(false);
      });
    });
  }

  /**
   * Windows: Restore focus
   */
  async restoreFocusWindows() {
    const focusInfo = this.targetFocus;
    if (!focusInfo || !focusInfo.appName) {
      return false;
    }

    return new Promise((resolve) => {
      const script = `
        Add-Type -AssemblyName Microsoft.VisualBasic
        $processes = Get-Process -Name "${focusInfo.appName}" -ErrorAction SilentlyContinue
        if ($processes) {
          $hwnd = $processes[0].MainWindowHandle
          [Microsoft.VisualBasic.Interaction]::AppActivate($processes[0].Id)
          Write-Output "OK"
        }
      `;

      const proc = spawn("powershell", ["-Command", script]);

      let timedOut = false;

      const timeoutId = setTimeout(() => {
        timedOut = true;
        proc.kill();
        resolve(true);
      }, 2000);

      proc.on("close", (code) => {
        if (timedOut) {
          return;
        }
        clearTimeout(timeoutId);
        resolve(code === 0);
      });

      proc.on("error", () => {
        if (timedOut) {
          return;
        }
        clearTimeout(timeoutId);
        resolve(false);
      });
    });
  }

  /**
   * Linux: Restore focus using xdotool
   */
  async restoreFocusLinux() {
    const focusInfo = this.targetFocus;
    if (!focusInfo) {
      return false;
    }

    const isWayland =
      (process.env.XDG_SESSION_TYPE || "").toLowerCase() === "wayland" ||
      !!process.env.WAYLAND_DISPLAY;

    if (isWayland) {
      this.safeLog("⚠️ Cannot restore focus on Wayland");
      return false;
    }

    return new Promise((resolve) => {
      // Try to find and activate window by name
      const proc = spawn("xdotool", ["search", "--name", focusInfo.windowName, "windowactivate"]);

      let timedOut = false;

      const timeoutId = setTimeout(() => {
        timedOut = true;
        proc.kill();
        resolve(true);
      }, 1000);

      proc.on("close", (code) => {
        if (timedOut) {
          return;
        }
        clearTimeout(timeoutId);
        resolve(code === 0);
      });

      proc.on("error", () => {
        if (timedOut) {
          return;
        }
        clearTimeout(timeoutId);
        resolve(false);
      });
    });
  }

  /**
   * Clear stored focus info
   */
  clearFocus() {
    this.safeLog("🧹 Clearing stored focus");
    this.targetFocus = null;
  }

  /**
   * Get current stored focus info
   */
  getStoredFocus() {
    return this.targetFocus;
  }

  /**
   * Check if we have a valid stored focus
   */
  hasValidFocus() {
    if (!this.targetFocus) {
      return false;
    }

    const MAX_FOCUS_AGE_MS = 2 * 60 * 1000; // 2 minutes
    if (Date.now() - this.targetFocus.capturedAt > MAX_FOCUS_AGE_MS) {
      this.targetFocus = null;
      return false;
    }

    return true;
  }
}

// Singleton instance
let focusTrackerInstance = null;

/**
 * Get the focus tracker service instance
 */
function getFocusTrackerService() {
  if (!focusTrackerInstance) {
    focusTrackerInstance = new FocusTrackerService();
  }
  return focusTrackerInstance;
}

module.exports = { FocusTrackerService, getFocusTrackerService };
