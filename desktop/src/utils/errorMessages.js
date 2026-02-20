/**
 * Standardized error messages for consistent user-facing error handling
 */

export const ErrorMessages = {
  // Recording Errors
  RECORDING_ERROR: {
    title: "Recording Error",
    description: "Failed to start recording. Please check your microphone settings and try again.",
  },
  MICROPHONE_ACCESS_DENIED: {
    title: "Microphone Access Denied",
    description: "Please grant microphone permission in your system settings and try again.",
  },
  NO_MICROPHONE_FOUND: {
    title: "No Microphone Found",
    description: "No microphone was detected. Please connect a microphone and try again.",
  },
  MICROPHONE_IN_USE: {
    title: "Microphone In Use",
    description:
      "The microphone is being used by another application. Please close other apps and try again.",
  },

  // Transcription Errors
  TRANSCRIPTION_ERROR: {
    title: "Transcription Error",
    description: "Failed to transcribe audio. Please try again.",
  },
  TRANSCRIPTION_FAILED: {
    title: "Transcription Failed",
    description: "Unable to process your audio. Please check your connection and try again.",
  },
  BACKEND_UNAVAILABLE: {
    title: "Service Unavailable",
    description: "The transcription service is not available. Check that the gateway is reachable.",
  },
  AUDIO_TOO_LARGE: {
    title: "Audio File Too Large",
    description: "The audio file exceeds the maximum size of 10MB. Please record a shorter clip.",
  },
  AUDIO_TOO_SHORT: {
    title: "Audio Too Short",
    description: "The recording is too short to process. Please record for at least 0.15 seconds.",
  },

  // Paste Errors
  PASTE_ERROR: {
    title: "Paste Error",
    description: "Failed to paste text. Please check accessibility permissions.",
  },

  // Window Errors
  WINDOW_ERROR: {
    title: "Window Error",
    description: "An error occurred with the application window. Please restart the app.",
  },
  WINDOW_CONVERSION_ERROR: {
    title: "Setup Error",
    description: "Failed to complete setup. Please restart the app.",
  },

  // Permission Errors
  PERMISSION_ERROR: {
    title: "Permission Required",
    description: "This feature requires additional permissions. Please check your system settings.",
  },

  // General Errors
  UNEXPECTED_ERROR: {
    title: "Unexpected Error",
    description: "An unexpected error occurred. Please try again or restart the application.",
  },
  NETWORK_ERROR: {
    title: "Network Error",
    description: "Unable to connect to the service. Please check your internet connection.",
  },
};

/**
 * Format error message consistently
 */
export function formatError(error, defaultMessage = ErrorMessages.UNEXPECTED_ERROR) {
  if (typeof error === "string") {
    return {
      title: defaultMessage.title,
      description: error,
    };
  }

  if (error && error.title && error.description) {
    return error;
  }

  if (error && error.message) {
    return {
      title: defaultMessage.title,
      description: error.message,
    };
  }

  return defaultMessage;
}
