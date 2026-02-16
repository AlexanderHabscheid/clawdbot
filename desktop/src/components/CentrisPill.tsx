import React, { useEffect, useState } from "react";

interface DisplayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DisplayInfo {
  id: number;
  index: number;
  bounds: DisplayBounds;
  workArea: DisplayBounds;
  scaleFactor: number;
  isPrimary: boolean;
}

interface CentrisPillProps {
  status: "idle" | "listening" | "processing";
  transcript?: string;
  bottomPosition?: number; // Position from bottom in pixels
  verticalCenter?: boolean; // Whether to center vertically (default: false - position at bottom)
  currentDisplayBounds?: DisplayBounds; // Single display bounds (legacy)
  allDisplays?: DisplayInfo[]; // ALL displays - multi-monitor style (legacy - now each window is per-display)
  audioLevel?: number; // Real-time audio level (0-100) for visualization
  audioFrequencies?: Uint8Array | null; // Frequency data array for waveform visualization
  mode?: "action" | "dictation"; // Current operating mode
}

const CentrisPill: React.FC<CentrisPillProps> = ({
  status,
  bottomPosition = 85, // Position from bottom in pixels
  verticalCenter = false, // Default to bottom positioning
  currentDisplayBounds, // Single display (legacy)
  allDisplays, // All displays (legacy - now each window handles one display)
  audioLevel = 0, // Real-time audio level (0-100)
  audioFrequencies = null, // Frequency data for waveform
  mode = "action", // Default to action mode
}) => {
  const isListening = status === "listening";
  const isProcessing = status === "processing";
  const isExpanded = isListening || isProcessing;

  // Track actual viewport height for proper positioning
  // This fixes the vertical alignment issue where display.bounds.height doesn't match actual viewport
  const [viewportHeight, setViewportHeight] = useState(window.innerHeight);

  // Update viewport height on resize
  useEffect(() => {
    const handleResize = () => {
      setViewportHeight(window.innerHeight);
    };

    window.addEventListener("resize", handleResize);
    // Initial measurement
    setViewportHeight(window.innerHeight);

    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Check URL params to see if this window is for a specific display
  // Each pill window now gets its own URL with display info
  const [displayParams, setDisplayParams] = useState<{
    displayIndex: number;
    displayX: number;
    displayY: number;
    displayWidth: number;
    displayHeight: number;
  } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const displayIndex = params.get("displayIndex");
    if (displayIndex !== null) {
      setDisplayParams({
        displayIndex: parseInt(displayIndex),
        displayX: parseInt(params.get("displayX") || "0"),
        displayY: parseInt(params.get("displayY") || "0"),
        displayWidth: parseInt(params.get("displayWidth") || "1920"),
        displayHeight: parseInt(params.get("displayHeight") || "1080"),
      });
    }
  }, []);

  // If we have display params, this window is dedicated to a single display
  // Otherwise, use the legacy multi-display rendering
  const isSingleDisplayMode = displayParams !== null;

  // Waveform visualization - uses REAL audio data from AnalyserNode
  // When audioFrequencies is available, use real data; otherwise show subtle breathing
  const [waveformHeights, setWaveformHeights] = useState([30, 50, 70, 50, 30]);

  useEffect(() => {
    if (!isListening) {
      // Reset to baseline when not listening
      setWaveformHeights([30, 50, 70, 50, 30]);
      return;
    }

    // If we have real frequency data, use it for accurate waveform visualization
    if (audioFrequencies && audioFrequencies.length > 0) {
      // Extract 5 bars from frequency data (sample evenly across the array)
      const barCount = 5;
      const samplesPerBar = Math.floor(audioFrequencies.length / barCount);
      const heights = [];

      for (let i = 0; i < barCount; i++) {
        const startIdx = i * samplesPerBar;
        const endIdx = Math.min(startIdx + samplesPerBar, audioFrequencies.length);

        // Calculate average frequency for this bar
        let sum = 0;
        for (let j = startIdx; j < endIdx; j++) {
          sum += audioFrequencies[j];
        }
        const avg = sum / (endIdx - startIdx);

        // Convert to height (0-255 -> 20-100% of max height)
        // Use audioLevel as a multiplier for overall responsiveness
        const normalized = (avg / 255) * (audioLevel / 100);
        const height = Math.max(20, Math.min(100, 20 + normalized * 80)); // 20-100% range
        heights.push(height);
      }

      setWaveformHeights(heights);
      return;
    }

    // Fallback: When no real audio data, show subtle breathing animation
    // This indicates the system is ready but NOT actively receiving audio
    let phase = 0;
    const interval = setInterval(() => {
      phase += 0.15;
      // Gentle sine wave for subtle "breathing" effect - NOT random
      const breathFactor = 0.9 + Math.sin(phase) * 0.1; // 0.8 to 1.0 range (very subtle)
      setWaveformHeights([
        30 * breathFactor,
        50 * breathFactor,
        70 * breathFactor,
        50 * breathFactor,
        30 * breathFactor,
      ]);
    }, 100);

    return () => clearInterval(interval);
  }, [isListening, audioFrequencies, audioLevel]);

  // Styles for the pill container - using inline styles as fallback for transparent windows
  const idleStyle: React.CSSProperties = {
    width: "100px",
    height: "6px", // Thicker for better visibility
    borderRadius: "9999px",
    background: "linear-gradient(90deg, rgba(168, 85, 247, 0.9), rgba(255, 107, 53, 0.9))", // Purple to orange gradient - more opaque
    boxShadow:
      "0 0 15px rgba(168, 85, 247, 0.5), 0 0 30px rgba(255, 107, 53, 0.4), 0 2px 8px rgba(0, 0, 0, 0.5)", // Stronger glow + shadow
    transition: "all 0.3s ease-out",
  };

  // Mode-based colors
  const actionColor = { r: 255, g: 107, b: 53 }; // Orange #ff6b35
  const dictationColor = { r: 155, g: 89, b: 182 }; // Purple #9b59b6
  const modeColor = mode === "action" ? actionColor : dictationColor;

  const expandedStyle: React.CSSProperties = {
    width: "100px",
    height: "36px",
    borderRadius: "9999px",
    background: isListening
      ? `rgba(${modeColor.r}, ${modeColor.g}, ${modeColor.b}, 0.15)` // Tint based on mode
      : "rgba(168, 85, 247, 0.2)", // Purple tint when processing
    backdropFilter: "blur(24px)",
    WebkitBackdropFilter: "blur(24px)",
    border: isListening
      ? `1px solid rgba(${modeColor.r}, ${modeColor.g}, ${modeColor.b}, 0.5)`
      : "1px solid rgba(168, 85, 247, 0.5)",
    boxShadow: isListening
      ? `0 0 20px rgba(${modeColor.r}, ${modeColor.g}, ${modeColor.b}, 0.3), 0 4px 16px rgba(0, 0, 0, 0.3)`
      : "0 0 20px rgba(168, 85, 247, 0.3), 0 4px 16px rgba(0, 0, 0, 0.3)",
    transition: "all 0.3s ease-out",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };

  // Calculate position for a pill on a specific display
  // Note: displayBounds are in screen coordinates, but we need window-relative coordinates
  // The window spans all monitors starting at (minX, minY), so we need to offset
  const getPillPositionForDisplay = (displayBounds: DisplayBounds, displayIndex: number) => {
    // Calculate window offset from all displays (window starts at minimum x/y of all displays)
    let windowOffsetX = 0;
    let windowOffsetY = 0;
    if (allDisplays && allDisplays.length > 0) {
      windowOffsetX = Math.min(...allDisplays.map((d) => d.bounds.x));
      windowOffsetY = Math.min(...allDisplays.map((d) => d.bounds.y));
    } else if (currentDisplayBounds) {
      windowOffsetX = currentDisplayBounds.x;
      windowOffsetY = currentDisplayBounds.y;
    }

    // Convert screen coordinates to window-relative coordinates
    const windowRelativeX = displayBounds.x - windowOffsetX;
    const windowRelativeY = displayBounds.y - windowOffsetY;

    let position: React.CSSProperties;

    if (verticalCenter) {
      position = {
        position: "fixed" as const,
        left: windowRelativeX + displayBounds.width / 2,
        top: windowRelativeY + displayBounds.height / 2,
        transform: "translate(-50%, -50%)",
      };
    } else {
      // Position at bottom (above dock) with full centering transform
      // Calculate top position so pill center is at bottomPosition from bottom
      const centerYFromBottom = bottomPosition;
      const centerYFromTop = displayBounds.height - centerYFromBottom;
      position = {
        position: "fixed" as const,
        left: windowRelativeX + displayBounds.width / 2,
        top: windowRelativeY + centerYFromTop,
        transform: "translate(-50%, -50%)", // Center horizontally and vertically
      };
    }

    // Log position for debugging with actual values
    console.log(
      `[CentrisPill] Display ${displayIndex + 1} position: left=${position.left}px, top=${position.top}px (display: ${displayBounds.width}x${displayBounds.height} at ${displayBounds.x},${displayBounds.y})`,
    );

    return position;
  };

  // Determine which displays to render pills on
  // Multi-monitor style: show pill on ALL monitors simultaneously
  const displaysToRender =
    allDisplays && allDisplays.length > 0
      ? allDisplays
      : currentDisplayBounds
        ? [
            {
              id: 0,
              index: 0,
              bounds: currentDisplayBounds,
              workArea: currentDisplayBounds,
              scaleFactor: 1,
              isPrimary: true,
            },
          ]
        : null;

  // Single pill content component (reused for each display)
  const PillContent = () => (
    <>
      {/* Expanded content - mode indicator + waveform when listening, spinner when processing */}
      {isExpanded && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            height: "100%",
            padding: "0 12px",
            width: "100%",
          }}
        >
          {/* Mode indicator - Left side */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "16px",
              flexShrink: 0,
            }}
          >
            {mode === "action" ? (
              // Lightning bolt for action mode
              <svg width="12" height="12" viewBox="0 0 24 24" fill="white" stroke="none">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
              </svg>
            ) : (
              // Pencil icon for dictation mode
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 20h9"></path>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
              </svg>
            )}
          </div>

          {/* Waveform visualization when listening - Center */}
          {isListening && (
            <div
              style={{
                display: "flex",
                gap: "3px",
                alignItems: "center",
                height: "24px",
                flex: 1,
                justifyContent: "center",
              }}
            >
              {waveformHeights.map((height, i) => (
                <div
                  key={i}
                  style={{
                    width: "3px",
                    height: `${height}%`,
                    background:
                      mode === "action"
                        ? "linear-gradient(to top, #ff6b35, #f7931e)" // Orange gradient for action
                        : "linear-gradient(to top, #9b59b6, #8e44ad)", // Purple gradient for dictation
                    borderRadius: "9999px",
                    animation: "pulse 0.6s ease-in-out infinite",
                    animationDelay: `${i * 0.1}s`,
                  }}
                />
              ))}
            </div>
          )}

          {/* Processing spinner */}
          {isProcessing && (
            <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
              <div
                style={{
                  width: "20px",
                  height: "20px",
                  border: "2px solid rgba(168, 85, 247, 0.3)",
                  borderTop: "2px solid rgba(168, 85, 247, 0.9)",
                  borderRadius: "50%",
                  animation: "spin 1s linear infinite",
                }}
              />
            </div>
          )}

          {/* Right spacer for balance */}
          <div style={{ width: "16px", flexShrink: 0 }} />
        </div>
      )}
    </>
  );

  // SINGLE DISPLAY MODE: This window is dedicated to one display - just render one centered pill
  // FIX: Use actual viewport height (window.innerHeight) instead of display bounds
  // This ensures proper vertical centering regardless of menu bar/dock configuration
  if (isSingleDisplayMode) {
    // Use actual viewport height for positioning, not display bounds
    // This fixes the vertical alignment issue where display.bounds.height includes
    // areas that aren't part of the actual window viewport (like menu bar space)
    const actualHeight = viewportHeight;

    let topPosition: number;
    if (verticalCenter) {
      // Center vertically in the middle of the actual viewport
      topPosition = actualHeight / 2;
    } else {
      // Position above dock: bottomPosition is distance from bottom of VIEWPORT
      // Using actual viewport height ensures correct positioning
      topPosition = actualHeight - bottomPosition;
    }

    return (
      <div
        style={{
          background: "transparent",
          width: "100vw",
          height: "100vh",
          position: "fixed",
          top: 0,
          left: 0,
          pointerEvents: "none",
          zIndex: 99999,
        }}
      >
        {/* Single pill centered horizontally, positioned at bottom or center vertically */}
        {/* Using transform: translate(-50%, -50%) to center both horizontally and vertically */}
        {/* The topPosition represents where the CENTER of the pill should be */}
        {/* This ensures the pill stays centered even when its height changes */}
        <div
          style={{
            position: "fixed",
            left: "50%",
            top: topPosition,
            transform: "translate(-50%, -50%)",
            zIndex: 99999,
            // Ensure the transform origin is at the center for proper centering
            transformOrigin: "center center",
          }}
        >
          <div style={isExpanded ? expandedStyle : idleStyle}>
            <PillContent />
          </div>
        </div>

        {/* CSS Keyframes for animations */}
        <style>{`
          @keyframes pulse {
            0%, 100% { opacity: 1; transform: scaleY(1); }
            50% { opacity: 0.7; transform: scaleY(0.7); }
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  // LEGACY MODE: Multi-display rendering in one window (kept for backwards compatibility)
  return (
    <div
      style={{
        background: "transparent",
        width: "100vw",
        height: "100vh",
        position: "fixed",
        top: 0,
        left: 0,
        pointerEvents: "none",
        zIndex: 99999,
      }}
    >
      {/* Render a pill on EACH display */}
      {displaysToRender ? (
        displaysToRender.map((display, index) => {
          const pillPosition = getPillPositionForDisplay(display.bounds, index);
          return (
            <div
              key={display.id}
              style={{
                ...pillPosition,
                zIndex: 99999,
              }}
            >
              {/* Pill visual - thin line when idle, expanded when active */}
              <div style={isExpanded ? expandedStyle : idleStyle}>
                <PillContent />
              </div>
            </div>
          );
        })
      ) : (
        /* Fallback: single pill at viewport center */
        <div
          style={{
            position: "fixed",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 99999,
          }}
        >
          {/* Thin line (collapsed state) or expanded pill */}
          <div style={isExpanded ? expandedStyle : idleStyle}>
            <PillContent />
          </div>
        </div>
      )}

      {/* CSS Keyframes for animations */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scaleY(1); }
          50% { opacity: 0.7; transform: scaleY(0.7); }
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default CentrisPill;
