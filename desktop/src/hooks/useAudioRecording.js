import { useState, useEffect, useRef } from "react";
import AudioManager from "../helpers/audioManager";
import { getUnifiedAudioManager } from "../services/audioSystem";
import { getWakeWordService } from "../services/wakeWordService";
import { STORAGE_KEYS } from "../utils/constants";

export const useAudioRecording = (toast, options = {}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState("");
  // Initialize mode from localStorage (synced with Preferences)
  const [mode, setMode] = useState(() => {
    if (typeof window !== "undefined" && window.localStorage) {
      const saved = window.localStorage.getItem(STORAGE_KEYS.CENTRIS_MODE);
      return saved === "dictation" ? "dictation" : "action";
    }
    return "action";
  });
  const [audioLevel, setAudioLevel] = useState(0); // Real-time audio level (0-100)
  const [audioFrequencies, setAudioFrequencies] = useState(null); // Frequency data for waveform
  const audioManagerRef = useRef(null);

  // CRITICAL: Only primary display (index 0) should handle actual recording
  // Multiple windows trying to record causes race conditions:
  // - Double Socket.IO connections (one times out)
  // - Double native audio initialization
  // - Focus capture conflicts
  // Default to true for backwards compatibility (main window, onboarding, etc.)
  const { onToggle, onAudioLevel, isPrimaryDisplay = true } = options;

  useEffect(() => {
    // Initialize AudioManager
    audioManagerRef.current = new AudioManager();

    // UNIFIED AUDIO: Initialize the unified audio manager for recording
    // NOTE: Wake word service connection is handled by useWakeWord hook
    // This just ensures the stream is active for recording
    const initializeUnifiedAudio = async () => {
      try {
        const unifiedAudioManager = getUnifiedAudioManager();

        // Initialize the unified stream (requests mic once)
        const streamActive = await unifiedAudioManager.initialize();

        if (streamActive) {
          // Set up audio level callback for visualization
          unifiedAudioManager.setCallbacks({
            onAudioLevel: (audioData) => {
              // Only process if unified mode is active
              setAudioLevel(audioData.levelPercent || 0);
              setAudioFrequencies(audioData.frequencies);
            },
          });
        }
      } catch (err) {
        // Silent - unified audio is optional, legacy mode will be used
      }
    };

    // Initialize unified audio (only on primary display to avoid conflicts)
    if (isPrimaryDisplay) {
      initializeUnifiedAudio();
    }

    // Sync initial mode from localStorage to AudioManager (don't broadcast - just syncing)
    const initialMode = window.localStorage?.getItem(STORAGE_KEYS.CENTRIS_MODE);
    if (initialMode === "dictation" || initialMode === "action") {
      audioManagerRef.current.setMode(initialMode, false);
    }

    // Set up callbacks
    audioManagerRef.current.setCallbacks({
      onStateChange: ({ isRecording, isProcessing }) => {
        setIsRecording(isRecording);
        setIsProcessing(isProcessing);
      },
      onError: (error) => {
        toast({
          title: error.title,
          description: error.description,
          variant: "destructive",
        });
      },
      onModeChange: (newMode) => {
        setMode(newMode);
        toast({
          title: "Mode Changed",
          description: `Switched to ${newMode} mode`,
          variant: "default",
        });
      },
      onAudioLevel: (audioData) => {
        // Update audio level state for real-time visualization
        setAudioLevel(audioData.levelPercent || 0);
        setAudioFrequencies(audioData.frequencies);

        // Also call external callback if provided
        if (onAudioLevel) {
          onAudioLevel(audioData);
        }
      },
      onTranscriptionComplete: async (result) => {
        if (result.success) {
          setTranscript(result.text);

          // Handle mode switches
          if (result.modeSwitch) {
            // Mode switch handled, just show notification
            return;
          }

          // ONLY paste in dictation mode - action mode should NEVER paste
          // BUT skip if alreadyPasted is true (dictation_result handler already pasted)
          if (result.mode === "dictation" && !result.alreadyPasted) {
            await audioManagerRef.current.safePaste(result.text);
            // Show cleanup notification if text was cleaned
            if (result.originalText && result.text !== result.originalText) {
              toast({
                title: "Text Cleaned",
                description: "Removed filler words and improved formatting",
                variant: "default",
              });
            }
          }
          // In action mode, backend handles execution - no pasting here

          // Save to database in parallel (save cleaned text)
          audioManagerRef.current.saveTranscription(result.text);

          // Show notifications
          if (result.mode === "action" && result.executed) {
            toast({
              title: "Action Executed",
              description: "Task completed successfully",
              variant: "default",
            });
          }
        }
      },
    });

    // Set up hotkey listeners with debouncing
    // CRITICAL: main.js sends "start-dictation" on key DOWN and "stop-dictation" on key UP
    // This implements push-to-talk: hold key to record, release to stop
    let lastStartTime = 0;
    const DEBOUNCE_MS = 300; // 300ms debounce to prevent rapid triggers

    const handleStartDictation = () => {
      const now = Date.now();
      if (now - lastStartTime < DEBOUNCE_MS) {
        return; // Ignore rapid triggers
      }
      lastStartTime = now;

      const currentState = audioManagerRef.current?.getState();

      // CRITICAL FIX: Only PRIMARY display should start actual recording
      if (!isPrimaryDisplay) {
        return;
      }

      if (currentState && !currentState.isRecording && !currentState.isProcessing) {
        // Pause wake word detection during recording
        try {
          const wakeWordService = getWakeWordService();
          if (wakeWordService && wakeWordService.isListening) {
            wakeWordService.pause();
          }
        } catch (err) {
          // Silent - wake word is optional
        }

        audioManagerRef.current?.startRecording();
        onToggle?.();
      }
    };

    const handleStopDictation = () => {
      // CRITICAL: Always try to stop, even if state says not recording
      if (audioManagerRef.current) {
        audioManagerRef.current.stopRecording();
        onToggle?.();

        // Resume wake word detection
        try {
          const wakeWordService = getWakeWordService();
          if (wakeWordService && wakeWordService.isEnabled && wakeWordService.isPaused) {
            wakeWordService.resume();
          }
        } catch (err) {
          // Silent - wake word is optional
        }
      }
    };

    // Legacy toggle handler for backwards compatibility
    const handleToggle = () => {
      const currentState = audioManagerRef.current?.getState();

      if (currentState && !currentState.isRecording && !currentState.isProcessing) {
        audioManagerRef.current.startRecording();
      } else if (currentState && currentState.isRecording) {
        audioManagerRef.current.stopRecording();
      }
      onToggle?.();
    };

    // Set up hotkey listeners with proper cleanup
    // CRITICAL: Listen to START and STOP events (from Globe/Fn key in main.js)
    let disposeStart = null;
    let disposeStop = null;
    let disposeToggle = null;

    // Primary: Start/Stop dictation events (push-to-talk style)
    if (window.electronAPI?.onStartDictation) {
      disposeStart = window.electronAPI.onStartDictation(handleStartDictation);
    }

    if (window.electronAPI?.onStopDictation) {
      disposeStop = window.electronAPI.onStopDictation(handleStopDictation);
    }

    // Fallback: Toggle dictation (for other hotkey types)
    if (window.electronAPI?.onToggleDictation) {
      disposeToggle = window.electronAPI.onToggleDictation(handleToggle);
    }

    // Set up no-audio-detected listener with proper cleanup
    const handleNoAudioDetected = () => {
      toast({
        title: "No Audio Detected",
        description: "The recording contained no detectable audio. Please try again.",
        variant: "default",
      });
    };

    let disposeNoAudio = null;
    if (window.electronAPI?.onNoAudioDetected) {
      disposeNoAudio = window.electronAPI.onNoAudioDetected(handleNoAudioDetected);
    }

    // Listen for mode changes from other windows (via IPC)
    // This ensures the pill UI stays in sync when mode is changed in Preferences
    let disposeModeChange = null;
    if (window.electronAPI?.onModeChanged) {
      disposeModeChange = window.electronAPI.onModeChanged((data) => {
        if (data && (data.mode === "action" || data.mode === "dictation")) {
          // Update local state
          setMode(data.mode);
          // Update AudioManager (broadcast = false to avoid infinite loop)
          if (audioManagerRef.current) {
            audioManagerRef.current.setMode(data.mode, false);
          }
          // Update localStorage to stay in sync
          if (window.localStorage) {
            window.localStorage.setItem(STORAGE_KEYS.CENTRIS_MODE, data.mode);
          }
        }
      });
    }

    // Cleanup
    return () => {
      if (disposeStart && typeof disposeStart === "function") {
        disposeStart();
      }
      if (disposeStop && typeof disposeStop === "function") {
        disposeStop();
      }
      if (disposeToggle && typeof disposeToggle === "function") {
        disposeToggle();
      }
      if (disposeNoAudio && typeof disposeNoAudio === "function") {
        disposeNoAudio();
      }
      if (disposeModeChange && typeof disposeModeChange === "function") {
        disposeModeChange();
      }

      if (audioManagerRef.current) {
        audioManagerRef.current.cleanup();
        audioManagerRef.current = null;
      }
    };
    // Note: isPrimaryDisplay is derived from URL params and doesn't change during component lifecycle
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast, onToggle, isPrimaryDisplay]);

  const startRecording = async () => {
    if (audioManagerRef.current) {
      return await audioManagerRef.current.startRecording();
    }
    return false;
  };

  const stopRecording = () => {
    // CRITICAL: Force immediate state update to ensure UI responds
    setIsRecording(false);

    if (audioManagerRef.current) {
      return audioManagerRef.current.stopRecording();
    }
    return false;
  };

  const toggleListening = () => {
    if (!isRecording && !isProcessing) {
      startRecording();
    } else if (isRecording) {
      stopRecording();
    }
  };

  return {
    isRecording,
    isProcessing,
    transcript,
    mode,
    audioLevel, // Real-time audio level (0-100)
    audioFrequencies, // Frequency data array for waveform visualization
    startRecording,
    stopRecording,
    toggleListening,
  };
};
