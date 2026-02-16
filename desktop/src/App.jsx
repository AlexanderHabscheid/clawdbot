import { motion, AnimatePresence } from "framer-motion";
import { Settings, X, Edit3, Zap, Loader2 } from "lucide-react";
import React, { useState, useEffect, useMemo, useCallback } from "react";
import "./index.css";
import CentrisPill from "./components/CentrisPill";
import ControlPanel from "./components/ControlPanel";
import Dashboard from "./components/Dashboard";
import Onboarding from "./components/Onboarding";
import Preferences from "./components/Preferences";
import { useToast } from "./components/ui/Toast";
import { useAudioRecording } from "./hooks/useAudioRecording";
import { useWakeWord } from "./hooks/useWakeWord";
import {
  DEFAULT_DOCK_HEIGHT,
  PILL_UI_BOTTOM_MARGIN,
  AUTO_COLLAPSE_DELAY_MS,
  DEBOUNCE_MS,
  STORAGE_KEYS,
  PILL_EXPANDED_HEIGHT,
} from "./utils/constants";

export default function App() {
  // Note: Debug logs removed to reduce noise in console

  // Ensure we're running in Electron, not browser
  useEffect(() => {
    if (typeof window !== "undefined" && !window.electronAPI) {
      alert("This application must be run in Electron. Please use the Electron app.");
      return;
    }
  }, []);

  // Check if this is the control panel window or pill UI window
  const [isControlPanel, setIsControlPanel] = useState(false);
  const [isPillUI, setIsPillUI] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);
  const [isCheckingOnboarding, setIsCheckingOnboarding] = useState(true);
  const [platform, setPlatform] = useState("darwin");
  const [wakeWordEnabled, setWakeWordEnabled] = useState(() => {
    // Check localStorage for wake word preference
    // Default: true - Both Globe key AND "Hey Centris" work together
    const saved = window.localStorage?.getItem("wake_word_enabled");
    return saved !== "false"; // Default ON unless explicitly disabled
  });
  const { toast } = useToast();

  // CRITICAL: Read URL params immediately (not in useEffect) so they're available for hooks
  // This prevents race conditions where hooks are called before params are read
  const urlParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const initialDisplayIndex = useMemo(
    () => parseInt(urlParams.get("displayIndex") || "0", 10),
    [urlParams],
  );
  const initialIsPill = useMemo(() => urlParams.get("pill") === "true", [urlParams]);
  const initialIsPanel = useMemo(() => urlParams.get("panel") === "true", [urlParams]);

  // CRITICAL: isPrimaryDisplay must be available immediately for useAudioRecording
  // Only primary display (index 0) should handle actual audio recording
  // Secondary displays just show UI state visually
  const isPrimaryDisplay = initialDisplayIndex === 0;

  // Track display index for multi-monitor wake word coordination
  const [displayIndex, setDisplayIndex] = useState(initialDisplayIndex);

  // Check URL params to determine window type
  useEffect(() => {
    setIsControlPanel(initialIsPanel);
    setIsPillUI(initialIsPill);
    setDisplayIndex(initialDisplayIndex);

    // Log which window this is for debugging
    if (initialIsPill) {
      console.log(
        `[App] 🖥️ Pill window initialized for display ${initialDisplayIndex}${isPrimaryDisplay ? " (primary - wake word enabled)" : " (secondary - wake word disabled)"}`,
      );
    }
  }, [initialIsPanel, initialIsPill, initialDisplayIndex, isPrimaryDisplay]);

  // Get platform from electronAPI
  useEffect(() => {
    if (window.electronAPI?.getPlatform) {
      setPlatform(window.electronAPI.getPlatform());
    }
  }, []);

  // Listen for localStorage changes (for wake word setting sync between windows)
  useEffect(() => {
    const handleStorageChange = (event) => {
      if (event.key === "wake_word_enabled") {
        const newValue = event.newValue === "true";
        console.log("[App] 🔄 Wake word setting changed:", newValue);
        setWakeWordEnabled(newValue);
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  // Calculate dock height and position pill above it (memoized)
  // MUST be declared before any early returns to follow Rules of Hooks
  const [dockHeight, setDockHeight] = useState(DEFAULT_DOCK_HEIGHT);

  // Multi-monitor support: track current display bounds (legacy)
  const [currentDisplayBounds, setCurrentDisplayBounds] = useState(null);

  // Multi-monitor support: track ALL displays (Wispr Flow style)
  const [allDisplays, setAllDisplays] = useState([]);

  // Use audio recording hook (only for pill UI)
  // CRITICAL: Pass isPrimaryDisplay to prevent race conditions on multi-monitor setups
  // Only the primary display (index 0) should actually record audio
  // Secondary displays just show the UI state visually
  const {
    isRecording,
    isProcessing,
    transcript,
    mode,
    audioLevel,
    audioFrequencies,
    startRecording,
    stopRecording,
  } = useAudioRecording(toast, { isPrimaryDisplay });

  // Wake word detection - "Hey Centris" hands-free activation
  // Only active in pill UI mode when wake word is enabled
  const handleWakeWordDetected = useCallback(
    (data) => {
      console.log("[App] 🎯 Wake word detected! Starting dictation...", data);
      if (!isRecording && !isProcessing) {
        // Show a subtle notification that wake word was heard
        toast({
          title: "Hey Centris!",
          description: "I'm listening...",
          variant: "default",
        });
        setIsExpanded(true);
        startRecording();
      }
    },
    [isRecording, isProcessing, startRecording, toast],
  );

  const handleWakeWordError = useCallback(
    (error) => {
      // Only show critical errors to user, not network issues
      // Network unavailable is expected - wake word is optional
      if (error.code === "PERMISSION_DENIED") {
        toast({
          title: "Microphone Required",
          description: "Enable microphone access for 'Hey Centris' detection",
          variant: "destructive",
        });
      }
      // NETWORK_UNAVAILABLE is handled silently - Globe key still works
    },
    [toast],
  );

  // Wake word detection hook
  // isPrimaryDisplay is already defined above based on initialDisplayIndex
  const { isListening: isWakeWordListening, isAvailable: isWakeWordAvailable } = useWakeWord({
    enabled:
      isPillUI && isPrimaryDisplay && wakeWordEnabled && !showOnboarding && !isCheckingOnboarding,
    onWakeWordDetected: handleWakeWordDetected,
    onError: handleWakeWordError,
    pauseWhileRecording: true,
    isRecording,
    isProcessing,
  });

  // Determine UI state
  const isListening = isRecording;
  const isActive = isExpanded || isListening || isProcessing;
  const status = isListening ? "listening" : isProcessing ? "processing" : "idle";

  // Check onboarding status on mount
  useEffect(() => {
    const checkOnboarding = async () => {
      try {
        // Don't show onboarding/preferences if this is control panel or pill UI
        const params = new URLSearchParams(window.location.search);
        const isPanel = params.get("panel") === "true";
        const isPill = params.get("pill") === "true";

        if (isPanel || isPill) {
          setIsCheckingOnboarding(false);
          return;
        }

        const completed =
          window.localStorage?.getItem(STORAGE_KEYS.ONBOARDING_COMPLETED) === "true";
        const preferencesCompleted =
          window.localStorage?.getItem("preferences_completed") === "true";

        // Show onboarding if not completed
        // Show preferences if onboarding done but preferences not done
        if (!completed) {
          setShowOnboarding(true);
        } else if (!preferencesCompleted) {
          setShowPreferences(true);
          // Create pill UI window (like Wispr Flow)
          setTimeout(() => {
            window.electronAPI?.createPillUIWindow?.().catch(console.error);
          }, 500);
        }
      } catch (error) {
        console.error("[App] Error checking onboarding:", error);
        setShowOnboarding(true);
      } finally {
        setIsCheckingOnboarding(false);
      }
    };

    checkOnboarding();
  }, []);

  const handleOnboardingComplete = async () => {
    // Ensure localStorage is set FIRST
    if (window.localStorage) {
      window.localStorage.setItem(STORAGE_KEYS.ONBOARDING_COMPLETED, "true");
    }

    // Set both states together to avoid race condition
    setShowPreferences(true);
    setShowOnboarding(false);

    // Create pill UI window in background (non-blocking)
    window.electronAPI?.createPillUIWindow?.().catch(console.error);
  };

  const handlePreferencesComplete = async () => {
    // Mark preferences as completed
    if (window.localStorage) {
      window.localStorage.setItem("preferences_completed", "true");
    }
    // Transition to Dashboard after preferences complete
    setShowPreferences(false);
  };

  // CRITICAL: Set up dictation handlers for pill UI only
  // We use refs to avoid re-registering handlers on every state change
  // This prevents race conditions where events are missed during re-registration
  const isRecordingRef = React.useRef(isRecording);
  const isProcessingRef = React.useRef(isProcessing);

  // Keep refs up to date
  React.useEffect(() => {
    isRecordingRef.current = isRecording;
    isProcessingRef.current = isProcessing;
  }, [isRecording, isProcessing]);

  // NOTE: Recording logic is handled by useAudioRecording hook
  // This useEffect ONLY manages UI state (expand/collapse) to avoid duplicate recording calls
  useEffect(() => {
    // Set up UI handlers for pill UI only
    if (!isPillUI) {
      return;
    }

    const handleStartUI = () => {
      console.log("[App] 🎤 Globe DOWN - expanding pill UI");
      // Only expand UI - recording is handled by useAudioRecording hook
      if (!isRecordingRef.current && !isProcessingRef.current) {
        setIsExpanded(true);
      }
    };

    const handleStopUI = () => {
      // CRITICAL: Only manage UI collapse - recording stop is handled by useAudioRecording
      console.log("[App] 🛑 Globe UP - collapsing pill UI");

      // Always collapse the pill UI on key release
      setIsExpanded(false);

      // FAILSAFE: Add a small delay and force state reset
      // This ensures UI closes even if there are timing issues with state updates
      setTimeout(() => {
        setIsExpanded(false);
      }, 50);
    };

    console.log("[App] 📡 Registering pill UI state handlers");
    const disposeStart = window.electronAPI?.onStartDictation?.(handleStartUI);
    const disposeStop = window.electronAPI?.onStopDictation?.(handleStopUI);

    // Keep toggle for backwards compatibility
    const disposeToggle = window.electronAPI?.onToggleDictation?.(() => {
      if (!isRecordingRef.current && !isProcessingRef.current) {
        handleStartUI();
      } else if (isRecordingRef.current) {
        handleStopUI();
      }
    });

    return () => {
      console.log("[App] 🧹 Unregistering pill UI state handlers");
      disposeStart?.();
      disposeStop?.();
      disposeToggle?.();
    };
  }, [isPillUI]); // Stable dependency - no functions that change on re-render

  // CRITICAL: Pill UI is ALWAYS click-through - it's purely a visual indicator
  // Interaction happens through hotkey/voice commands, not clicking on the pill
  // Users can always use their computer normally, even when pill is listening/processing
  // The pill just shows status and listens in the background
  useEffect(() => {
    if (!isPillUI) {
      return;
    }

    // Always keep click-through enabled - pill is visual only
    window.electronAPI?.setPillUIInteractivity?.(false).catch(console.error);
  }, [isPillUI]);

  // Auto-collapse after processing completes (only for pill UI)
  useEffect(() => {
    if (!isPillUI) {
      return;
    }

    if (!isProcessing && !isRecording && isExpanded) {
      const timer = setTimeout(() => {
        setIsExpanded(false);
      }, AUTO_COLLAPSE_DELAY_MS);
      return () => clearTimeout(timer);
    }
  }, [isPillUI, isProcessing, isRecording, isExpanded]);

  // Calculate dock height and track display for multi-monitor support
  useEffect(() => {
    // Only calculate for pill UI
    if (!isPillUI) {
      return;
    }

    let cancelled = false;
    let displayUpdateInterval = null;

    const calculateDockPosition = async () => {
      if (window.electronAPI?.getScreenInfo) {
        try {
          const screenInfo = await window.electronAPI.getScreenInfo();
          if (!cancelled) {
            setDockHeight(screenInfo.dockHeight || DEFAULT_DOCK_HEIGHT);
          }
        } catch (error) {
          if (!cancelled) {
            setDockHeight(DEFAULT_DOCK_HEIGHT);
          }
        }
      }
    };

    // Multi-monitor: Track cursor position and update display bounds
    const updateDisplayBounds = async () => {
      if (window.electronAPI?.getCursorDisplayInfo) {
        try {
          const displayInfo = await window.electronAPI.getCursorDisplayInfo();
          if (!cancelled && displayInfo.currentDisplay) {
            setCurrentDisplayBounds(displayInfo.currentDisplay.bounds);
          }
        } catch (error) {
          // Silently ignore errors
        }
      }
    };

    // Update ALL displays for multi-monitor pill rendering
    const updateAllDisplays = async () => {
      if (window.electronAPI?.getCursorDisplayInfo) {
        try {
          const displayInfo = await window.electronAPI.getCursorDisplayInfo();
          if (!cancelled && displayInfo.allDisplays) {
            setAllDisplays(displayInfo.allDisplays);
          }
        } catch (error) {
          // Silently ignore errors
        }
      }
    };

    if (!showOnboarding && !isCheckingOnboarding) {
      calculateDockPosition();
      updateDisplayBounds();
      updateAllDisplays();

      // Update display info periodically (every 1 second) for multi-monitor
      displayUpdateInterval = setInterval(() => {
        updateDisplayBounds();
        updateAllDisplays();
      }, 1000);
    }

    return () => {
      cancelled = true;
      if (displayUpdateInterval) {
        clearInterval(displayUpdateInterval);
      }
    };
  }, [isPillUI, showOnboarding, isCheckingOnboarding]);

  // Memoize pill position calculation (only for pill UI)
  // Position pill so its BOTTOM EDGE is 20px above the dock
  const pillBottomPosition = useMemo(() => {
    if (!isPillUI) {
      return 0;
    }
    // center = dockHeight + 20 + (pillHeight/2) = dockHeight + 38
    const halfExpandedHeight = PILL_EXPANDED_HEIGHT / 2; // 18px
    return dockHeight + PILL_UI_BOTTOM_MARGIN + halfExpandedHeight;
  }, [isPillUI, dockHeight]);

  // Show onboarding if needed
  if (isCheckingOnboarding) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <div className="text-purple-400">Loading...</div>
      </div>
    );
  }

  if (showOnboarding) {
    return <Onboarding onComplete={handleOnboardingComplete} />;
  }

  // If this is the control panel window, render ControlPanel (separate window)
  if (isControlPanel) {
    return <ControlPanel />;
  }

  // If this is NOT the pill UI window, render main Dashboard app
  if (!isPillUI) {
    // Show Preferences for initial setup (if onboarding done but preferences not)
    if (showPreferences) {
      return <Preferences onComplete={handlePreferencesComplete} />;
    }
    // Show the main Dashboard app (with integrated settings)
    return <Dashboard />;
  }

  // Pill UI rendering - purely visual indicator, always click-through
  return (
    <div
      className="min-h-screen flex items-end justify-center"
      style={{
        background: "transparent",
        backgroundColor: "transparent",
        width: "100vw",
        height: "100vh",
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        // CRITICAL: Always allow clicks to pass through - pill is visual only
        // Users interact via hotkey/voice, not by clicking the pill
        pointerEvents: "none",
        zIndex: 9999,
        display: "block",
        visibility: "visible",
      }}
    >
      {/* The Pill UI - Visual status indicator for conversational computer */}
      {/* Always click-through - interaction via hotkey/voice commands */}
      {/* Idle: thin gray line */}
      {/* Active: expanded pill with waveform (listening/processing) */}
      {/* WISPR FLOW STYLE: Pill appears on ALL monitors simultaneously */}
      <CentrisPill
        status={status}
        transcript={transcript}
        bottomPosition={pillBottomPosition}
        verticalCenter={false}
        currentDisplayBounds={currentDisplayBounds}
        allDisplays={allDisplays}
        audioLevel={audioLevel}
        audioFrequencies={audioFrequencies}
        mode={mode}
      />
    </div>
  );
}
