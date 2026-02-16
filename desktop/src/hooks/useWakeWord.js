import { useState, useEffect, useRef, useCallback } from "react";
import { getWakeWordService } from "../services/wakeWordService";

/**
 * Hook for wake word detection ("Hey Centris")
 *
 * SIMPLIFIED: Uses Web Speech API which actually transcribes audio
 * and checks for the wake phrase. Much more reliable than energy-based detection.
 *
 * @param {Object} options
 * @param {boolean} options.enabled - Whether wake word detection is enabled
 * @param {Function} options.onWakeWordDetected - Callback when wake word is detected
 * @param {Function} options.onError - Callback for errors
 * @param {boolean} options.pauseWhileRecording - Whether to pause during recording (default: true)
 * @param {boolean} options.isRecording - Current recording state (to pause wake word)
 * @param {boolean} options.isProcessing - Current processing state (to pause wake word)
 */
export function useWakeWord(options = {}) {
  const {
    enabled = false,
    onWakeWordDetected,
    onError,
    pauseWhileRecording = true,
    isRecording = false,
    isProcessing = false,
  } = options;

  const [isListening, setIsListening] = useState(false);
  const [isAvailable, setIsAvailable] = useState(false);
  const [lastDetection, setLastDetection] = useState(null);
  const serviceRef = useRef(null);
  const isInitializedRef = useRef(false);

  // Initialize service
  useEffect(() => {
    // Skip if already initialized (handles React StrictMode double-mount)
    if (isInitializedRef.current && serviceRef.current) {
      return;
    }

    const service = getWakeWordService();
    serviceRef.current = service;
    isInitializedRef.current = true;

    // Set up callbacks
    service.setCallbacks({
      onWakeWordDetected: (data) => {
        console.log("[useWakeWord] 🎯 Wake word detected:", data);
        setLastDetection(data);
        onWakeWordDetected?.(data);
      },
      onError: (error) => {
        console.error("[useWakeWord] ❌ Error:", error);
        onError?.(error);
      },
      onStatusChange: (status) => {
        console.log("[useWakeWord] 📊 Status change:", status);
        setIsListening(status.isListening);
      },
    });

    // Check availability (Web Speech API)
    setIsAvailable(service.speechRecognitionAvailable);
    console.log("[useWakeWord] 📊 Wake word available:", service.speechRecognitionAvailable);

    // Cleanup on unmount
    return () => {
      if (serviceRef.current?.isListening) {
        console.log("[useWakeWord] ⏹️ Stopping wake word on unmount");
        serviceRef.current.stop();
      }
    };
  }, []); // Only run once on mount

  // Update callbacks when they change
  useEffect(() => {
    if (serviceRef.current) {
      serviceRef.current.setCallbacks({
        onWakeWordDetected: (data) => {
          console.log("[useWakeWord] 🎯 Wake word detected:", data);
          setLastDetection(data);
          onWakeWordDetected?.(data);
        },
        onError: (error) => {
          console.error("[useWakeWord] ❌ Error:", error);
          onError?.(error);
        },
        onStatusChange: (status) => {
          console.log("[useWakeWord] 📊 Status change:", status);
          setIsListening(status.isListening);
        },
      });
    }
  }, [onWakeWordDetected, onError]);

  // Start/stop based on enabled prop
  useEffect(() => {
    if (!serviceRef.current || !isAvailable) {
      return;
    }

    if (enabled) {
      console.log("[useWakeWord] 🎤 Starting wake word detection...");
      const result = serviceRef.current.start();
      console.log("[useWakeWord] Start result:", result);
    } else {
      console.log("[useWakeWord] 🛑 Stopping wake word detection...");
      serviceRef.current.stop();
    }
  }, [enabled, isAvailable]);

  // Pause/resume based on recording/processing state
  useEffect(() => {
    if (!serviceRef.current || !enabled || !pauseWhileRecording) {
      return;
    }

    if (isRecording || isProcessing) {
      // Pause wake word detection while recording/processing
      console.log("[useWakeWord] Pausing during recording/processing");
      serviceRef.current.pause();
    } else {
      // Resume wake word detection after recording/processing
      console.log("[useWakeWord] Resuming after recording/processing");
      // Small delay to avoid immediate re-trigger
      setTimeout(() => {
        serviceRef.current?.resume();
      }, 500);
    }
  }, [enabled, pauseWhileRecording, isRecording, isProcessing]);

  // Manual controls
  const start = useCallback(() => {
    if (serviceRef.current) {
      return serviceRef.current.start();
    }
    return { success: false, error: "Service not initialized" };
  }, []);

  const stop = useCallback(() => {
    if (serviceRef.current) {
      return serviceRef.current.stop();
    }
    return { success: false, error: "Service not initialized" };
  }, []);

  const getStatus = useCallback(() => {
    if (serviceRef.current) {
      return serviceRef.current.getStatus();
    }
    return {
      isAvailable: false,
      isEnabled: false,
      isListening: false,
      wakePhrases: [],
    };
  }, []);

  return {
    isListening,
    isAvailable,
    lastDetection,
    start,
    stop,
    getStatus,
  };
}

export default useWakeWord;
