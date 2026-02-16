/**
 * ScreenCaptureService - Screen Recording and OCR for AI Vision
 *
 * Captures screen content for AI understanding and analysis.
 * Requires "Screen Recording" permission in System Settings.
 *
 * Use cases:
 * - Provide visual context to AI models
 * - OCR text from any application
 * - Track user workflow for automation
 * - Capture screenshots for debugging
 * - Enable visual grounding for UI interaction
 *
 * Features:
 * - Single screenshot capture
 * - Continuous screen recording
 * - Region-specific capture
 * - Multi-display support
 * - Automatic OCR processing
 */

const { desktopCapturer, screen, BrowserWindow } = require("electron");
const { spawn, exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const EventEmitter = require("events");
const loggerModule = require("../utils/logger");
const logger = loggerModule.default || loggerModule;

class ScreenCaptureService extends EventEmitter {
  constructor() {
    super();
    this.isCapturing = false;
    this.captureInterval = null;
    this.platform = process.platform;
    this.tempDir = path.join(require("os").tmpdir(), "centris-screen-capture");

    // Capture settings
    this.captureQuality = "medium"; // low, medium, high
    this.captureFormat = "png"; // png, jpeg
    this.captureIntervalMs = 1000; // For continuous capture

    // Ensure temp directory exists
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * Check if screen capture is available
   */
  async checkAvailability() {
    if (this.platform !== "darwin") {
      // On non-macOS, screen capture is typically available without explicit permission
      return { available: true, reason: "Non-macOS platform" };
    }

    try {
      const permissions = require("node-mac-permissions");
      const status = permissions.getAuthStatus("screen");

      return {
        available: status === "authorized",
        status: status,
        canRequest: status === "not-determined",
      };
    } catch (error) {
      logger.error("[ScreenCapture] Error checking availability:", error);
      return { available: false, error: error.message };
    }
  }

  /**
   * Capture a single screenshot
   * @param {Object} options - Capture options
   * @param {string} options.source - 'screen', 'window', or specific source ID
   * @param {Object} options.region - { x, y, width, height } for partial capture
   * @param {number} options.displayId - Specific display to capture (multi-monitor)
   * @param {boolean} options.includeOCR - Run OCR on the captured image
   * @param {string} options.quality - 'low', 'medium', 'high'
   */
  async captureScreen(options = {}) {
    if (this.platform !== "darwin") {
      return await this._captureWithElectron(options);
    }

    // Check permission first
    const availability = await this.checkAvailability();
    if (!availability.available) {
      logger.warn("[ScreenCapture] Screen recording permission not granted");
      return {
        success: false,
        error: "Screen recording permission required",
        needsPermission: true,
        status: availability.status,
      };
    }

    logger.log("[ScreenCapture] Capturing screen...", options);

    try {
      // Use native screencapture command on macOS (more reliable)
      const result = await this._captureWithNative(options);

      // Run OCR if requested
      if (options.includeOCR && result.success) {
        result.ocr = await this._runOCR(result.imagePath);
      }

      return result;
    } catch (error) {
      logger.error("[ScreenCapture] Capture failed:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Start continuous screen capture
   * @param {Object} options - Capture options
   * @param {number} options.intervalMs - Interval between captures (default: 1000ms)
   * @param {boolean} options.emitToRenderer - Send frames to renderer process
   */
  async startCapture(options = {}) {
    if (this.isCapturing) {
      return { success: true, message: "Already capturing" };
    }

    // Check permission
    const availability = await this.checkAvailability();
    if (!availability.available) {
      return {
        success: false,
        error: "Screen recording permission required",
        needsPermission: true,
      };
    }

    const intervalMs = options.intervalMs || this.captureIntervalMs;
    const emitToRenderer = options.emitToRenderer;

    logger.log("[ScreenCapture] Starting continuous capture...", { intervalMs });

    this.isCapturing = true;
    this.captureInterval = setInterval(async () => {
      try {
        const result = await this.captureScreen({
          ...options,
          includeOCR: false, // Don't OCR every frame
        });

        if (result.success && emitToRenderer) {
          this._broadcastToWindows("screen-capture-frame", {
            timestamp: Date.now(),
            imagePath: result.imagePath,
            // Don't send full image data in events - too large
            // Renderer should read file if needed
          });
        }

        this.emit("frame", result);
      } catch (error) {
        logger.error("[ScreenCapture] Continuous capture error:", error);
      }
    }, intervalMs);

    this.emit("started");
    return { success: true, intervalMs };
  }

  /**
   * Stop continuous screen capture
   */
  stopCapture() {
    if (!this.isCapturing) {
      return { success: true, message: "Not capturing" };
    }

    logger.log("[ScreenCapture] Stopping continuous capture...");

    if (this.captureInterval) {
      clearInterval(this.captureInterval);
      this.captureInterval = null;
    }

    this.isCapturing = false;
    this.emit("stopped");

    return { success: true };
  }

  /**
   * Get current capture status
   */
  getStatus() {
    return {
      isCapturing: this.isCapturing,
      platform: this.platform,
      captureQuality: this.captureQuality,
      captureIntervalMs: this.captureIntervalMs,
    };
  }

  /**
   * Get all available capture sources (screens and windows)
   */
  async getSources(types = ["screen", "window"]) {
    try {
      const sources = await desktopCapturer.getSources({
        types,
        thumbnailSize: { width: 150, height: 150 },
      });

      return sources.map((source) => ({
        id: source.id,
        name: source.name,
        displayId: source.display_id,
        thumbnail: source.thumbnail?.toDataURL(),
      }));
    } catch (error) {
      logger.error("[ScreenCapture] Error getting sources:", error);
      return [];
    }
  }

  /**
   * Get all displays (multi-monitor support)
   */
  getDisplays() {
    const displays = screen.getAllDisplays();
    const primaryDisplay = screen.getPrimaryDisplay();

    return displays.map((display, index) => ({
      id: display.id,
      index,
      bounds: display.bounds,
      workArea: display.workArea,
      scaleFactor: display.scaleFactor,
      isPrimary: display.id === primaryDisplay.id,
    }));
  }

  /**
   * Capture using macOS native screencapture command
   */
  async _captureWithNative(options = {}) {
    return new Promise((resolve) => {
      const timestamp = Date.now();
      const filename = `capture_${timestamp}.${this.captureFormat}`;
      const imagePath = path.join(this.tempDir, filename);

      // Build screencapture arguments
      const args = ["-x"]; // No sound

      if (options.region) {
        // Region capture: -R x,y,width,height
        const { x, y, width, height } = options.region;
        args.push("-R", `${x},${y},${width},${height}`);
      } else if (options.displayId) {
        // Specific display: -D displayId
        args.push("-D", String(options.displayId));
      }

      // Format
      if (this.captureFormat === "jpeg") {
        args.push("-t", "jpg");
      } else {
        args.push("-t", "png");
      }

      // Output file
      args.push(imagePath);

      logger.log("[ScreenCapture] Running screencapture:", args.join(" "));

      const process = spawn("screencapture", args);

      process.on("error", (error) => {
        resolve({ success: false, error: error.message });
      });

      process.on("close", (code) => {
        if (code === 0 && fs.existsSync(imagePath)) {
          // Get file size and dimensions
          const stats = fs.statSync(imagePath);

          resolve({
            success: true,
            imagePath,
            filename,
            fileSize: stats.size,
            timestamp,
            format: this.captureFormat,
          });
        } else {
          resolve({
            success: false,
            error: `screencapture exited with code ${code}`,
          });
        }
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        process.kill();
        resolve({ success: false, error: "Capture timeout" });
      }, 5000);
    });
  }

  /**
   * Capture using Electron's desktopCapturer (fallback)
   */
  async _captureWithElectron(options = {}) {
    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 1920, height: 1080 },
      });

      if (sources.length === 0) {
        return { success: false, error: "No capture sources available" };
      }

      // Get the requested source or default to first screen
      let source = sources[0];
      if (options.source) {
        const found = sources.find((s) => s.id === options.source || s.name === options.source);
        if (found) {
          source = found;
        }
      }

      const timestamp = Date.now();
      const filename = `capture_${timestamp}.png`;
      const imagePath = path.join(this.tempDir, filename);

      // Save thumbnail as image
      const dataUrl = source.thumbnail.toDataURL();
      const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
      fs.writeFileSync(imagePath, base64Data, "base64");

      return {
        success: true,
        imagePath,
        filename,
        timestamp,
        format: "png",
        source: source.name,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Run OCR on captured image
   * Uses macOS Vision framework via shortcuts/AppleScript
   */
  async _runOCR(imagePath) {
    if (this.platform !== "darwin") {
      return { success: false, error: "OCR only available on macOS" };
    }

    return new Promise((resolve) => {
      // Use AppleScript with Vision framework for OCR
      // This requires macOS 10.15+ (Catalina) or later
      const script = `
        use framework "Vision"
        use framework "Foundation"
        
        on run argv
          set imagePath to item 1 of argv
          set imageURL to current application's NSURL's fileURLWithPath:imagePath
          
          set imageSource to current application's CGImageSourceCreateWithURL(imageURL, missing value)
          if imageSource is missing value then
            return "ERROR: Could not load image"
          end if
          
          set theImage to current application's CGImageSourceCreateImageAtIndex(imageSource, 0, missing value)
          if theImage is missing value then
            return "ERROR: Could not create image"
          end if
          
          set requestHandler to current application's VNImageRequestHandler's alloc()'s initWithCGImage:theImage options:(current application's NSDictionary's dictionary())
          
          set textRequest to current application's VNRecognizeTextRequest's alloc()'s init()
          textRequest's setRecognitionLevel:(current application's VNRequestTextRecognitionLevelAccurate)
          
          set {theResult, theError} to requestHandler's performRequests:{textRequest} |error|:(reference)
          
          if theError is not missing value then
            return "ERROR: " & (theError's localizedDescription() as text)
          end if
          
          set observations to textRequest's results()
          set recognizedText to ""
          
          repeat with observation in observations
            set recognizedText to recognizedText & (observation's topCandidates:1's firstObject()'s |string|() as text) & linefeed
          end repeat
          
          return recognizedText
        end run
      `;

      exec(
        `osascript -e '${script.replace(/'/g, "'\\''")}' "${imagePath}"`,
        { timeout: 10000 },
        (error, stdout, stderr) => {
          if (error) {
            logger.error("[ScreenCapture] OCR error:", stderr || error.message);
            resolve({ success: false, error: stderr || error.message });
            return;
          }

          const text = stdout.trim();
          if (text.startsWith("ERROR:")) {
            resolve({ success: false, error: text });
          } else {
            resolve({
              success: true,
              text,
              wordCount: text.split(/\s+/).filter((w) => w).length,
            });
          }
        },
      );
    });
  }

  /**
   * Broadcast event to all renderer windows
   */
  _broadcastToWindows(channel, data) {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, data);
      }
    });
  }

  /**
   * Clean up old capture files
   * @param {number} maxAgeMs - Maximum age of files to keep (default: 1 hour)
   */
  cleanupOldCaptures(maxAgeMs = 3600000) {
    try {
      const files = fs.readdirSync(this.tempDir);
      const now = Date.now();
      let cleaned = 0;

      for (const file of files) {
        const filePath = path.join(this.tempDir, file);
        const stats = fs.statSync(filePath);

        if (now - stats.mtimeMs > maxAgeMs) {
          fs.unlinkSync(filePath);
          cleaned++;
        }
      }

      logger.log(`[ScreenCapture] Cleaned up ${cleaned} old capture files`);
      return { success: true, cleaned };
    } catch (error) {
      logger.error("[ScreenCapture] Cleanup error:", error);
      return { success: false, error: error.message };
    }
  }
}

// Singleton instance
let screenCaptureInstance = null;

/**
 * Get the screen capture service instance
 */
function getScreenCaptureService() {
  if (!screenCaptureInstance) {
    screenCaptureInstance = new ScreenCaptureService();
  }
  return screenCaptureInstance;
}

module.exports = { ScreenCaptureService, getScreenCaptureService };
