/**
 * React Hook for TTS Playback
 *
 * Provides easy integration for playing voice responses from the backend.
 * Uses the unified AudioSystem under the hood.
 *
 * @example
 * const { playVoice, stopVoice, isPlaying } = useTTSPlayback();
 *
 * // Play a voice response
 * await playVoice('blob:http://localhost/voice-response-123');
 *
 * // Stop playback
 * stopVoice();
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { getAudioSystem } from "../services/audioSystem";

export const useTTSPlayback = (options = {}) => {
  const { onPlaybackStart, onPlaybackEnd, onError } = options;

  const [isPlaying, setIsPlaying] = useState(false);
  const [queueLength, setQueueLength] = useState(0);
  const [volume, setVolumeState] = useState(1.0);
  const audioSystemRef = useRef(null);

  useEffect(() => {
    // Get the singleton audio system
    audioSystemRef.current = getAudioSystem();

    // Set up TTS callbacks
    audioSystemRef.current.tts.setCallbacks({
      onPlaybackStart: () => {
        setIsPlaying(true);
        onPlaybackStart?.();
      },
      onPlaybackEnd: () => {
        setIsPlaying(false);
        onPlaybackEnd?.();
      },
      onPlaybackError: (error) => {
        setIsPlaying(false);
        onError?.(error);
      },
      onQueueChange: (length) => {
        setQueueLength(length);
      },
    });

    // Cleanup on unmount
    return () => {
      // Don't cleanup the singleton - other components may use it
    };
  }, [onPlaybackStart, onPlaybackEnd, onError]);

  /**
   * Play a voice response from blob URL
   */
  const playVoice = useCallback(async (blobUrl, playOptions = {}) => {
    if (!audioSystemRef.current) {
      console.error("[useTTSPlayback] Audio system not initialized");
      return false;
    }

    return audioSystemRef.current.playVoiceResponse(blobUrl, playOptions);
  }, []);

  /**
   * Stop current voice playback
   */
  const stopVoice = useCallback(() => {
    if (audioSystemRef.current) {
      audioSystemRef.current.stopVoice();
    }
  }, []);

  /**
   * Pause current playback
   */
  const pauseVoice = useCallback(() => {
    if (audioSystemRef.current) {
      audioSystemRef.current.tts.pause();
    }
  }, []);

  /**
   * Resume paused playback
   */
  const resumeVoice = useCallback(() => {
    if (audioSystemRef.current) {
      audioSystemRef.current.tts.resume();
    }
  }, []);

  /**
   * Set playback volume
   */
  const setVolume = useCallback((level) => {
    if (audioSystemRef.current) {
      audioSystemRef.current.tts.setVolume(level);
      setVolumeState(level);
    }
  }, []);

  /**
   * Clear the playback queue
   */
  const clearQueue = useCallback(() => {
    if (audioSystemRef.current) {
      audioSystemRef.current.tts.clearQueue();
    }
  }, []);

  /**
   * Get full playback state
   */
  const getState = useCallback(() => {
    if (audioSystemRef.current) {
      return audioSystemRef.current.tts.getState();
    }
    return { isPlaying: false, queueLength: 0, volume: 1.0 };
  }, []);

  return {
    // State
    isPlaying,
    queueLength,
    volume,

    // Actions
    playVoice,
    stopVoice,
    pauseVoice,
    resumeVoice,
    setVolume,
    clearQueue,
    getState,
  };
};

export default useTTSPlayback;
