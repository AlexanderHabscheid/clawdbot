const { clipboard } = require("electron");
const { spawn, spawnSync } = require("child_process");

// Try to load native-control module for direct text insertion
let nativeControl = null;
let nativeInsertAvailable = false;

try {
  nativeControl = require("../../native-control/lib");
  nativeInsertAvailable = typeof nativeControl.insertTextAtCursor === "function";
  if (nativeInsertAvailable) {
    console.log("[ClipboardManager] ✅ Native insertTextAtCursor available - bypassing clipboard!");
  }
} catch (err) {
  console.log("[ClipboardManager] Native control not available, using clipboard fallback");
}

/**
 * ClipboardManager - Text Injection for Dictation
 *
 * Two approaches (in order of preference):
 *
 * 1. NATIVE INSERT (preferred) - Uses macOS Accessibility API to insert text
 *    directly into the focused text field. NO CLIPBOARD USAGE AT ALL!
 *    This is the Wispr Flow / professional dictation approach.
 *
 * 2. CLIPBOARD FALLBACK - If native fails, uses clipboard + Cmd+V.
 *    Simple and reliable but uses clipboard.
 */
class ClipboardManager {
  constructor() {
    this.isOperationInProgress = false;
  }

  // Safe logging method - only log in development
  safeLog(...args) {
    if (process.env.NODE_ENV === "development") {
      try {
        console.log(...args);
      } catch (error) {
        if (error.code !== "EPIPE") {
          process.stderr.write(`Log error: ${error.message}\n`);
        }
      }
    }
  }

  /**
   * Sleep helper
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Primary paste method
   * Tries native insert first (no clipboard), falls back to clipboard paste
   */
  async pasteText(text, options = {}) {
    // Try native insertion first (bypasses clipboard entirely)
    if (nativeInsertAvailable) {
      try {
        const success = await this.insertTextNative(text);
        if (success) {
          return;
        }
        this.safeLog("⚠️ Native insert returned false, trying clipboard fallback");
      } catch (err) {
        this.safeLog("⚠️ Native insert failed:", err.message);
      }
    }

    // Fallback to clipboard-based paste
    return await this.pasteTextViaClipboard(text);
  }

  /**
   * Alias for backwards compatibility
   */
  async injectTextDirectly(text) {
    return await this.pasteText(text);
  }

  /**
   * Native text insertion using Accessibility API
   * This is the preferred method - bypasses clipboard entirely!
   */
  async insertTextNative(text) {
    if (!nativeControl || !nativeInsertAvailable) {
      throw new Error("Native insert not available");
    }

    this.safeLog(
      "📝 Using native insertTextAtCursor (no clipboard):",
      text.substring(0, 50) + "...",
    );

    // Ensure native-control is initialized
    try {
      await nativeControl.initialize();
    } catch (e) {
      // May already be initialized, ignore
    }

    const result = await nativeControl.insertTextAtCursor(text);

    if (result) {
      this.safeLog("✅ Text inserted via Accessibility API (clipboard untouched!)");
    }

    return result;
  }

  /**
   * Clipboard-based paste (fallback)
   * 1. Copy text to clipboard
   * 2. Simulate Cmd+V (or Ctrl+V)
   */
  async pasteTextViaClipboard(text) {
    // Wait for any in-progress operation
    while (this.isOperationInProgress) {
      await this.sleep(50);
    }

    this.isOperationInProgress = true;

    try {
      this.safeLog("📋 Using clipboard fallback:", text.substring(0, 50) + "...");

      // Copy our text to clipboard
      clipboard.writeText(text);

      // Small delay to ensure clipboard is ready
      await this.sleep(30);

      // Platform-specific paste
      if (process.platform === "darwin") {
        await this.pasteMacOS();
      } else if (process.platform === "win32") {
        await this.pasteWindows();
      } else {
        await this.pasteLinux();
      }

      this.safeLog("✅ Text pasted via clipboard");
    } catch (error) {
      this.safeLog("❌ Clipboard paste failed:", error.message);
      throw error;
    } finally {
      this.isOperationInProgress = false;
    }
  }

  /**
   * macOS: Simulate Cmd+V using AppleScript
   */
  async pasteMacOS() {
    return new Promise((resolve, reject) => {
      const pasteProcess = spawn("osascript", [
        "-e",
        'tell application "System Events" to keystroke "v" using command down',
      ]);

      let errorOutput = "";
      let hasTimedOut = false;

      pasteProcess.stderr.on("data", (data) => {
        errorOutput += data.toString();
      });

      pasteProcess.on("close", (code) => {
        if (hasTimedOut) {
          return;
        }
        clearTimeout(timeoutId);
        pasteProcess.removeAllListeners();

        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Paste failed (code ${code}): ${errorOutput}`));
        }
      });

      pasteProcess.on("error", (error) => {
        if (hasTimedOut) {
          return;
        }
        clearTimeout(timeoutId);
        pasteProcess.removeAllListeners();
        reject(new Error(`Paste command failed: ${error.message}`));
      });

      const timeoutId = setTimeout(() => {
        hasTimedOut = true;
        pasteProcess.kill("SIGKILL");
        pasteProcess.removeAllListeners();
        reject(new Error("Paste operation timed out"));
      }, 3000);
    });
  }

  /**
   * Windows: Simulate Ctrl+V using PowerShell
   */
  async pasteWindows() {
    return new Promise((resolve, reject) => {
      const pasteProcess = spawn("powershell", [
        "-Command",
        'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("^v")',
      ]);

      let hasTimedOut = false;

      pasteProcess.on("close", (code) => {
        if (hasTimedOut) {
          return;
        }
        clearTimeout(timeoutId);

        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Windows paste failed with code ${code}`));
        }
      });

      pasteProcess.on("error", (error) => {
        if (hasTimedOut) {
          return;
        }
        clearTimeout(timeoutId);
        reject(new Error(`Windows paste failed: ${error.message}`));
      });

      const timeoutId = setTimeout(() => {
        hasTimedOut = true;
        pasteProcess.kill();
        reject(new Error("Windows paste timed out"));
      }, 3000);
    });
  }

  /**
   * Linux: Simulate Ctrl+V using xdotool/wtype/ydotool
   */
  async pasteLinux() {
    const commandExists = (cmd) => {
      try {
        const res = spawnSync("sh", ["-c", `command -v ${cmd}`], { stdio: "ignore" });
        return res.status === 0;
      } catch {
        return false;
      }
    };

    const isWayland =
      (process.env.XDG_SESSION_TYPE || "").toLowerCase() === "wayland" ||
      !!process.env.WAYLAND_DISPLAY;

    // Paste tools (Ctrl+V simulation)
    const candidates = isWayland
      ? [
          { cmd: "wtype", args: ["-M", "ctrl", "-p", "v", "-m", "ctrl"] },
          { cmd: "ydotool", args: ["key", "29:1", "47:1", "47:0", "29:0"] },
          { cmd: "xdotool", args: ["key", "ctrl+v"] },
        ]
      : [{ cmd: "xdotool", args: ["key", "ctrl+v"] }];

    const available = candidates.filter((c) => commandExists(c.cmd));

    if (available.length === 0) {
      const toolNames = isWayland ? "wtype, ydotool, or xdotool" : "xdotool";
      throw new Error(`No paste tool found. Please install ${toolNames}.`);
    }

    const pasteWith = (tool) =>
      new Promise((resolve, reject) => {
        const proc = spawn(tool.cmd, tool.args);
        let timedOut = false;

        const timeoutId = setTimeout(() => {
          timedOut = true;
          try {
            proc.kill("SIGKILL");
          } catch {}
          reject(new Error(`${tool.cmd} timed out`));
        }, 2000);

        proc.on("close", (code) => {
          if (timedOut) {
            return;
          }
          clearTimeout(timeoutId);

          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`${tool.cmd} failed with code ${code}`));
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

    for (const tool of available) {
      try {
        await pasteWith(tool);
        this.safeLog(`✅ Pasted using ${tool.cmd}`);
        return;
      } catch (error) {
        this.safeLog(`⚠️ ${tool.cmd} failed:`, error.message);
      }
    }

    throw new Error("All Linux paste tools failed");
  }

  /**
   * Check accessibility permissions (macOS only)
   */
  async checkAccessibilityPermissions() {
    if (process.platform !== "darwin") {
      return true;
    }

    return new Promise((resolve) => {
      const testProcess = spawn("osascript", [
        "-e",
        'tell application "System Events" to get name of first process',
      ]);

      testProcess.on("close", (code) => {
        resolve(code === 0);
      });

      testProcess.on("error", () => {
        resolve(false);
      });
    });
  }

  async readClipboard() {
    return clipboard.readText();
  }

  async writeClipboard(text) {
    clipboard.writeText(text);
    return { success: true };
  }

  // Backwards compatibility methods
  setDirectInjectionEnabled(enabled) {
    this.safeLog(`🔧 Direct injection setting: ${enabled ? "enabled" : "disabled"}`);
  }

  getSettings() {
    return {
      nativeInsertAvailable: nativeInsertAvailable,
      method: nativeInsertAvailable ? "native-accessibility-api" : "clipboard-paste",
    };
  }

  async testDirectInjection(testText = "Hello from Centris AI!") {
    try {
      if (nativeInsertAvailable) {
        const success = await this.insertTextNative(testText);
        return { success, method: "native-accessibility-api" };
      } else {
        await this.pasteTextViaClipboard(testText);
        return { success: true, method: "clipboard-paste" };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = ClipboardManager;
