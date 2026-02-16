/**
 * Centris Native Audio Module - TypeScript Definitions
 */

import { EventEmitter } from "events";

/**
 * Audio device information
 */
export interface AudioDevice {
  id: string;
  name: string;
  isDefault: boolean;
  maxChannels: number;
  defaultSampleRate: number;
}

/**
 * Audio capture configuration
 */
export interface AudioConfig {
  /** Audio input device ID (default: 'default') */
  deviceId?: string;
  /** Sample rate in Hz (default: 16000) */
  sampleRate?: number;
  /** Number of channels, 1=mono, 2=stereo (default: 1) */
  channels?: number;
  /** Enable Voice Activity Detection (default: true) */
  vadEnabled?: boolean;
  /** VAD sensitivity 0.0-1.0 (default: 0.5) */
  vadThreshold?: number;
  /** WebSocket URL for streaming transcription */
  backendUrl?: string;
  /** Authentication token for backend */
  authToken?: string;
}

/**
 * Audio capture statistics
 */
export interface AudioStats {
  totalSamples: number;
  droppedSamples: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
  bytesTransmitted: number;
  messagesReceived: number;
  avgProcessingMs: number;
}

/**
 * Transcript result
 */
export interface TranscriptResult {
  text: string;
  isFinal: boolean;
  confidence: number;
}

/**
 * Native audio capture events
 */
export interface NativeAudioCaptureEvents {
  audioLevel: (level: number) => void;
  voiceStart: () => void;
  voiceEnd: () => void;
  transcript: (result: TranscriptResult) => void;
  error: (error: string) => void;
  started: () => void;
  stopped: () => void;
  shutdown: () => void;
}

/**
 * Native Audio Capture
 *
 * Low-latency audio capture using native OS APIs (Core Audio / WASAPI / PulseAudio)
 */
export class NativeAudioCapture extends EventEmitter {
  constructor();

  /**
   * Check if native audio module is available
   */
  static isAvailable(): boolean;

  /**
   * Get available audio input devices
   */
  static getInputDevices(): AudioDevice[];

  /**
   * Get default audio input device
   */
  static getDefaultInputDevice(): AudioDevice | null;

  /**
   * Initialize the audio capture system
   * @param config Configuration options
   */
  initialize(config?: AudioConfig): Promise<boolean>;

  /**
   * Start audio capture
   */
  start(): boolean;

  /**
   * Stop audio capture
   */
  stop(): boolean;

  /**
   * Shutdown and release all resources
   */
  shutdown(): void;

  /**
   * Check if currently capturing audio
   */
  isRunning(): boolean;

  /**
   * Get capture statistics
   */
  getStats(): AudioStats;

  // Event emitter methods with typed events
  on<K extends keyof NativeAudioCaptureEvents>(
    event: K,
    listener: NativeAudioCaptureEvents[K],
  ): this;

  once<K extends keyof NativeAudioCaptureEvents>(
    event: K,
    listener: NativeAudioCaptureEvents[K],
  ): this;

  off<K extends keyof NativeAudioCaptureEvents>(
    event: K,
    listener: NativeAudioCaptureEvents[K],
  ): this;

  emit<K extends keyof NativeAudioCaptureEvents>(
    event: K,
    ...args: Parameters<NativeAudioCaptureEvents[K]>
  ): boolean;
}

/**
 * Audio level monitor for testing/debugging
 */
export class AudioLevelMonitor extends EventEmitter {
  constructor();

  /**
   * Start monitoring audio levels
   */
  start(config?: AudioConfig): Promise<boolean>;

  /**
   * Stop monitoring
   */
  stop(): void;

  on(event: "level", listener: (level: number) => void): this;
  on(event: "voiceStart", listener: () => void): this;
  on(event: "voiceEnd", listener: () => void): this;
}

/**
 * Check if native audio is available
 */
export function isAvailable(): boolean;

/**
 * Get available audio input devices
 */
export function getInputDevices(): AudioDevice[];

/**
 * Get default audio input device
 */
export function getDefaultInputDevice(): AudioDevice | null;
