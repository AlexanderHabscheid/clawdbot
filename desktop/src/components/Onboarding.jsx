import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  Keyboard,
  Zap,
  ArrowRight,
  Mic,
  Shield,
  Check,
  Globe,
  Command,
  Play,
  Square,
  Volume2,
  RotateCcw,
  Monitor,
  Eye,
  ChevronRight,
  Chrome,
  ExternalLink,
  Loader2,
  Wifi,
  Languages,
  Search,
  ChevronDown,
  User,
} from "lucide-react";
import React, { useState, useEffect, useRef } from "react";
import { useAuth } from "../contexts/AuthContext";
import CentrisBackendService from "../services/centrisBackendService";
import {
  PERMISSION_CHECK_INTERVAL_MS,
  PERMISSION_AUTO_ADVANCE_DELAY_MS,
  DEFAULT_MACOS_HOTKEY,
  DEFAULT_OTHER_HOTKEY,
  STORAGE_KEYS,
  DEFAULT_BACKEND_URL,
} from "../utils/constants";
import {
  LANGUAGE_OPTIONS,
  getLanguageLabel,
  getLanguageByCode,
  POPULAR_LANGUAGES,
} from "../utils/languages";
import AuthStep from "./AuthStep";
import GalaxyBackground from "./GalaxyBackground";

const steps = [
  { title: "Sign In", icon: User },
  { title: "Welcome", icon: Sparkles },
  { title: "Language", icon: Languages },
  { title: "Permissions & Test", icon: Mic },
  { title: "Voice ID", icon: Shield }, // NEW: Voice enrollment step
  { title: "Advanced", icon: Monitor },
  { title: "Browser", icon: Chrome },
  { title: "Hotkey", icon: Keyboard },
  { title: "Ready", icon: Zap },
];

// Step 2: Welcome Screen (after auth)
const WelcomeStep = ({ onNext }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, x: -20 }}
    className="flex flex-col items-center text-center space-y-6 max-w-md mx-auto py-4"
  >
    <div className="relative">
      <div className="absolute -inset-4 bg-gradient-to-r from-orange-500 to-purple-600 rounded-full blur-xl opacity-30 animate-pulse" />
      <div className="relative rounded-2xl shadow-2xl overflow-hidden">
        <img src="./assets/icon.png" alt="Centris Logo" className="w-24 h-24 object-contain" />
      </div>
    </div>

    <div className="space-y-2">
      <h1 className="text-4xl font-bold tracking-tight">
        Welcome to <span className="text-gradient">Sentris OS</span>
      </h1>
      <p className="text-muted-foreground text-lg">The AI-native operating system for your Mac.</p>
    </div>

    <div className="grid grid-cols-1 gap-4 w-full">
      <div className="glass-card p-4 rounded-xl flex items-center gap-4 text-left">
        <div className="p-2 bg-orange-500/20 rounded-lg">
          <Mic className="w-6 h-6 text-orange-500" />
        </div>
        <div>
          <h3 className="font-semibold">Voice Control</h3>
          <p className="text-sm text-muted-foreground">
            Speak naturally, get instant transcription
          </p>
        </div>
      </div>
      <div className="glass-card p-4 rounded-xl flex items-center gap-4 text-left">
        <div className="p-2 bg-purple-500/20 rounded-lg">
          <Keyboard className="w-6 h-6 text-purple-500" />
        </div>
        <div>
          <h3 className="font-semibold">Global Hotkey</h3>
          <p className="text-sm text-muted-foreground">Activate from any app instantly</p>
        </div>
      </div>
    </div>

    <button
      onClick={onNext}
      className="w-full px-6 py-3 rounded-lg font-semibold bg-gradient-to-r from-orange-600 to-orange-700 hover:from-orange-500 hover:to-orange-600 text-white border-0 shadow-lg shadow-orange-900/20 flex items-center justify-center gap-2"
    >
      Get Started <ArrowRight className="w-4 h-4" />
    </button>
  </motion.div>
);

// Step 2: Language Selection
// This sets the user's language preference ONCE during onboarding
// No more auto-detecting Sinhalese on quiet audio!
const LanguageStep = ({ onNext, selectedLanguage, setSelectedLanguage }) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const searchInputRef = useRef(null);
  const backendService = useRef(new CentrisBackendService());

  // Filter languages based on search
  const filteredLanguages = LANGUAGE_OPTIONS.filter(
    (lang) =>
      lang.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      lang.value.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (lang.nativeName && lang.nativeName.toLowerCase().includes(searchQuery.toLowerCase())),
  );

  // Get popular languages (shown first when not searching)
  const popularLanguages = POPULAR_LANGUAGES.map((code) =>
    LANGUAGE_OPTIONS.find((lang) => lang.value === code),
  ).filter(Boolean);

  // Determine which languages to show
  const displayLanguages = searchQuery.trim()
    ? filteredLanguages
    : [
        ...popularLanguages,
        ...LANGUAGE_OPTIONS.filter((lang) => !POPULAR_LANGUAGES.includes(lang.value)),
      ];

  const handleLanguageSelect = async (langCode) => {
    setSelectedLanguage(langCode);

    // Save to localStorage immediately
    if (window.localStorage) {
      window.localStorage.setItem(STORAGE_KEYS.PREFERRED_LANGUAGE, langCode);
    }

    // Also save to backend for persistent storage (optional - backend may not be running during onboarding)
    try {
      await backendService.current.saveLanguagePreference(langCode);
      console.log("[Onboarding] Language preference saved:", langCode);
    } catch (error) {
      // Silently ignore - backend not running during onboarding is normal
      // localStorage has the preference, backend will sync later when running
    }
  };

  const handleContinue = async () => {
    setIsSaving(true);

    try {
      // Ensure language is saved before continuing
      await backendService.current.saveLanguagePreference(selectedLanguage);
      console.log("[Onboarding] ✅ Language confirmed:", selectedLanguage);
    } catch (error) {
      console.warn("[Onboarding] Backend save failed, using localStorage:", error);
    }

    setIsSaving(false);
    onNext();
  };

  // Get current language info for display
  const currentLanguage = getLanguageByCode(selectedLanguage);

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="flex flex-col items-center text-center space-y-6 max-w-lg mx-auto py-4"
    >
      {/* Header */}
      <div className="space-y-2">
        <div className="relative mx-auto mb-4">
          <div className="absolute -inset-3 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-full blur-lg opacity-30 animate-pulse" />
          <div className="relative bg-black/80 p-4 rounded-xl border border-white/10 shadow-xl">
            <Languages className="w-10 h-10 text-cyan-500" />
          </div>
        </div>
        <h2 className="text-2xl font-bold">Select Your Language</h2>
        <p className="text-muted-foreground">
          Choose the language you'll use when speaking to Sentris.
        </p>
      </div>

      {/* Current Selection */}
      {selectedLanguage && (
        <div className="w-full glass-card p-4 rounded-xl border border-cyan-500/30 bg-cyan-500/5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-cyan-500/20 rounded-lg">
                <Globe className="w-5 h-5 text-cyan-500" />
              </div>
              <div className="text-left">
                <p className="text-sm text-muted-foreground">Selected Language</p>
                <p className="font-semibold text-lg">
                  {currentLanguage?.label || selectedLanguage}
                </p>
                {currentLanguage?.nativeName &&
                  currentLanguage.nativeName !== currentLanguage.label && (
                    <p className="text-sm text-white/50">{currentLanguage.nativeName}</p>
                  )}
              </div>
            </div>
            <Check className="w-6 h-6 text-cyan-500" />
          </div>
        </div>
      )}

      {/* Search Input */}
      <div className="w-full relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-white/40" />
        <input
          ref={searchInputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search 50+ languages..."
          className="w-full pl-10 pr-4 py-3 text-sm border border-white/20 rounded-xl bg-black/50 text-white placeholder:text-white/40 focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 focus:outline-none"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-white/40 hover:text-white/70"
          >
            ×
          </button>
        )}
      </div>

      {/* Language Grid */}
      <div className="w-full max-h-64 overflow-y-auto rounded-xl border border-white/10 bg-black/30">
        {!searchQuery.trim() && (
          <div className="px-3 py-2 text-xs text-white/40 border-b border-white/5 sticky top-0 bg-black/80 backdrop-blur-sm">
            Popular Languages
          </div>
        )}
        <div className="grid grid-cols-2 gap-1 p-2">
          {displayLanguages.slice(0, searchQuery.trim() ? 20 : 18).map((language, index) => {
            const isPopular = POPULAR_LANGUAGES.includes(language.value);
            const isSelected = language.value === selectedLanguage;

            // Add separator after popular languages when not searching
            const showSeparator =
              !searchQuery.trim() && isPopular && index === popularLanguages.length - 1;

            return (
              <React.Fragment key={language.value}>
                <button
                  type="button"
                  onClick={() => handleLanguageSelect(language.value)}
                  className={`p-3 rounded-lg text-left transition-all ${
                    isSelected
                      ? "bg-cyan-500/20 border border-cyan-500/50 text-cyan-400"
                      : "bg-white/5 border border-transparent hover:bg-white/10 text-white/80 hover:text-white"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{language.label}</p>
                      {language.nativeName && language.nativeName !== language.label && (
                        <p className="text-xs text-white/40 truncate">{language.nativeName}</p>
                      )}
                    </div>
                    {isSelected && <Check className="w-4 h-4 text-cyan-500 flex-shrink-0 ml-2" />}
                  </div>
                </button>
                {showSeparator && (
                  <div className="col-span-2 my-2 border-t border-white/10">
                    <p className="text-xs text-white/40 pt-2 px-1">All Languages</p>
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>

        {searchQuery.trim() && filteredLanguages.length === 0 && (
          <div className="p-4 text-center text-white/50">
            No languages found for "{searchQuery}"
          </div>
        )}

        {!searchQuery.trim() && displayLanguages.length > 18 && (
          <div className="p-2 text-center border-t border-white/10">
            <button
              onClick={() => searchInputRef.current?.focus()}
              className="text-xs text-cyan-400 hover:text-cyan-300"
            >
              Search for more languages...
            </button>
          </div>
        )}
      </div>

      {/* Privacy Note */}
      <div className="w-full bg-white/5 p-3 rounded-lg text-xs text-left text-muted-foreground">
        <p className="flex items-center gap-2 mb-1">
          <Shield className="w-4 h-4 text-green-500" />
          <span className="font-medium text-white/80">Why set a language?</span>
        </p>
        <p>
          Setting your language ensures accurate transcription every time. You can change this later
          in Settings.
        </p>
      </div>

      {/* Continue Button */}
      <button
        onClick={handleContinue}
        disabled={!selectedLanguage || isSaving}
        className="w-full px-6 py-3 rounded-lg font-semibold bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white border-0 shadow-lg shadow-cyan-900/20 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isSaving ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Saving...
          </>
        ) : (
          <>
            Continue <ArrowRight className="w-4 h-4" />
          </>
        )}
      </button>
    </motion.div>
  );
};

// Step 3: Combined Permissions & Testing Step
const PermissionsAndTestStep = ({
  onNext,
  micPermissionGranted,
  accessibilityPermissionGranted,
  onRequestMicPermission,
  onRequestAccessibilityPermission,
  isDev,
  selectedHotkey,
  setSelectedHotkey,
  isMacOS,
}) => {
  // Permission states
  const [micGranted, setMicGranted] = useState(false);
  const [accessibilityGranted, setAccessibilityGranted] = useState(false);

  // Mic test states
  const [isRecording, setIsRecording] = useState(false);
  const [recordedAudio, setRecordedAudio] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [micTestPassed, setMicTestPassed] = useState(false);

  // Accessibility test states
  const [accessibilityTestText, setAccessibilityTestText] = useState("");
  const [accessibilityTestPassed, setAccessibilityTestPassed] = useState(false);
  const [isListening, setIsListening] = useState(false);

  // Refs for audio
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioPlayerRef = useRef(null);
  const streamRef = useRef(null);
  const textareaRef = useRef(null);
  const recordedAudioMimeTypeRef = useRef(null); // Store the actual MIME type from MediaRecorder

  // Test phase: 'permissions' -> 'testing'
  const [testPhase, setTestPhase] = useState("permissions");

  // Update permission states from props
  useEffect(() => {
    setMicGranted(micPermissionGranted);
  }, [micPermissionGranted]);

  useEffect(() => {
    setAccessibilityGranted(accessibilityPermissionGranted);
  }, [accessibilityPermissionGranted]);

  // When both permissions are granted, move to testing phase and create pill UI
  useEffect(() => {
    if (micGranted && accessibilityGranted && testPhase === "permissions") {
      setTimeout(async () => {
        setTestPhase("testing");

        // Create pill UI window so user can see visual feedback during testing
        // This matches the user's expectation that the pill should be visible during dictation test
        console.log("[Onboarding] Creating pill UI window for testing phase...");
        try {
          const result = await window.electronAPI?.createPillUIWindow?.();
          if (result?.success) {
            console.log("[Onboarding] ✅ Pill UI window created for testing");
          } else {
            console.log("[Onboarding] Pill UI creation result:", result);
          }
        } catch (error) {
          console.error("[Onboarding] Error creating pill UI:", error);
        }
      }, 500);
    }
  }, [micGranted, accessibilityGranted, testPhase]);

  // Grant microphone permission
  const handleGrantMicrophone = async () => {
    console.log("[Onboarding] Requesting microphone permission...");

    try {
      // First, try to use Electron's native permission request
      const electronResult = await window.electronAPI?.requestMicrophonePermission?.();
      console.log("[Onboarding] Electron permission request result:", electronResult);

      if (electronResult?.granted) {
        setMicGranted(true);
        console.log("[Onboarding] ✅ Microphone permission granted via Electron API");
        return;
      }

      // If Electron didn't grant, try getUserMedia to trigger browser prompt
      console.log("[Onboarding] Trying getUserMedia to trigger system prompt...");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setMicGranted(true);
      console.log("[Onboarding] ✅ Microphone permission granted via getUserMedia");
    } catch (err) {
      console.error("[Onboarding] Microphone permission request failed:", err);

      // Permission denied or error - open System Settings
      console.log("[Onboarding] Opening System Settings for microphone...");
      await window.electronAPI?.openSystemPreferences?.("microphone");

      // Show instructions
      alert(
        "Microphone permission required!\n\n" +
          "1. System Settings should open automatically\n" +
          "2. Go to Privacy & Security → Microphone\n" +
          '3. Find "Sentris" and enable it\n' +
          '4. Return here and click "Grant Access" again',
      );
    }
  };

  // Grant accessibility permission
  const handleGrantAccessibility = async () => {
    console.log("[Onboarding] Opening accessibility settings...");

    // Accessibility can only be granted via System Settings
    await window.electronAPI?.openSystemPreferences?.("accessibility");

    // Start polling for permission status
    let attempts = 0;
    const maxAttempts = 30; // Poll for up to 60 seconds

    const pollPermission = setInterval(async () => {
      attempts++;
      const status = await window.electronAPI?.checkAccessibilityPermission?.();
      console.log(`[Onboarding] Accessibility check attempt ${attempts}:`, status?.granted);

      if (status?.granted) {
        setAccessibilityGranted(true);
        clearInterval(pollPermission);
        console.log("[Onboarding] ✅ Accessibility permission granted!");
      } else if (attempts >= maxAttempts) {
        clearInterval(pollPermission);
        console.log("[Onboarding] Accessibility polling timed out");
      }
    }, 2000);
  };

  // Microphone test error state
  const [micTestError, setMicTestError] = useState(null);

  // ========== MICROPHONE TEST: Record and Playback ==========
  // Using the same simple approach as open-whispr
  const startRecording = async () => {
    setMicTestError(null);

    // Prevent double-click
    if (isRecording) {
      console.log("[Onboarding] Already recording, ignoring");
      return;
    }

    try {
      console.log("[Onboarding] Starting microphone recording...");
      console.log("[Onboarding] Checking navigator.mediaDevices:", !!navigator.mediaDevices);
      console.log(
        "[Onboarding] Checking getUserMedia:",
        typeof navigator.mediaDevices?.getUserMedia,
      );

      // Check if getUserMedia is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error(
          "getUserMedia is not available. This may be a browser compatibility issue.",
        );
      }

      // Simple getUserMedia call - same as open-whispr
      // The session permission handler in main.js will handle the permission request
      // Just try getUserMedia directly - if permission is needed, it will prompt
      console.log("[Onboarding] Calling getUserMedia with audio constraint...");
      console.log("[Onboarding] navigator.mediaDevices:", navigator.mediaDevices);
      console.log("[Onboarding] getUserMedia function:", navigator.mediaDevices?.getUserMedia);
      console.log("[Onboarding] Window location:", window.location.href);
      console.log("[Onboarding] Is secure context:", window.isSecureContext);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      console.log("[Onboarding] ✅ Got microphone stream");
      console.log("[Onboarding] Stream tracks:", stream.getAudioTracks().length);
      console.log("[Onboarding] Track enabled:", stream.getAudioTracks()[0]?.enabled);
      console.log("[Onboarding] Track readyState:", stream.getAudioTracks()[0]?.readyState);

      streamRef.current = stream;
      audioChunksRef.current = [];

      // Check if MediaRecorder is available
      if (!window.MediaRecorder) {
        throw new Error(
          "MediaRecorder is not available. This may be a browser compatibility issue.",
        );
      }

      // Simple MediaRecorder - no mimeType specification, let browser choose
      // Try to use a preferred format, but fallback to browser default
      let mediaRecorder;
      const preferredMimeTypes = [
        "audio/webm",
        "audio/webm;codecs=opus",
        "audio/ogg;codecs=opus",
        "audio/mp4",
      ];
      let selectedMimeType = null;

      // Find the first supported MIME type
      for (const mimeType of preferredMimeTypes) {
        if (MediaRecorder.isTypeSupported(mimeType)) {
          selectedMimeType = mimeType;
          break;
        }
      }

      if (selectedMimeType) {
        console.log("[Onboarding] Using preferred MIME type:", selectedMimeType);
        mediaRecorder = new MediaRecorder(stream, { mimeType: selectedMimeType });
      } else {
        console.log("[Onboarding] Using browser default MIME type");
        mediaRecorder = new MediaRecorder(stream);
      }

      mediaRecorderRef.current = mediaRecorder;

      // Store the actual MIME type that MediaRecorder is using (Zoom-style approach)
      const actualMimeType = mediaRecorder.mimeType || selectedMimeType || "audio/webm";
      recordedAudioMimeTypeRef.current = actualMimeType;

      console.log("[Onboarding] MediaRecorder created, state:", mediaRecorder.state);
      console.log("[Onboarding] MediaRecorder mimeType:", actualMimeType);

      mediaRecorder.ondataavailable = (event) => {
        console.log("[Onboarding] Data available:", event.data.size, "bytes");
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
          console.log("[Onboarding] Total chunks:", audioChunksRef.current.length);
        }
      };

      mediaRecorder.onstop = () => {
        console.log("[Onboarding] Recording stopped");
        console.log("[Onboarding] Total chunks collected:", audioChunksRef.current.length);

        // Create blob with the ACTUAL MIME type from MediaRecorder (Zoom-style approach)
        // This ensures the blob type matches the actual data format
        const audioBlob = new Blob(audioChunksRef.current, { type: actualMimeType });
        console.log("[Onboarding] Audio blob size:", audioBlob.size, "bytes");
        console.log("[Onboarding] Audio blob MIME type:", actualMimeType);

        if (audioBlob.size > 0) {
          const audioUrl = URL.createObjectURL(audioBlob);
          setRecordedAudio(audioUrl);
          setMicTestError(null);
          console.log("[Onboarding] ✅ Recording successful! Audio URL created:", audioUrl);
        } else {
          console.error("[Onboarding] Recording produced empty blob");
          setMicTestError("Recording produced no audio. Please speak while recording.");
        }
        setIsRecording(false);

        // Cleanup stream
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => {
            track.stop();
            console.log("[Onboarding] Stopped track:", track.label);
          });
        }
      };

      mediaRecorder.onerror = (event) => {
        console.error("[Onboarding] MediaRecorder error:", event.error);
        setMicTestError("Recording error: " + (event.error?.message || "Unknown error"));
        setIsRecording(false);
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
        }
      };

      // Start recording with timeslice to ensure data is collected
      console.log("[Onboarding] Starting MediaRecorder...");
      mediaRecorder.start(100); // Collect data every 100ms

      // Verify recording actually started
      setTimeout(() => {
        if (mediaRecorder.state === "recording") {
          console.log("[Onboarding] ✅ Recording confirmed active! State:", mediaRecorder.state);
        } else {
          console.error("[Onboarding] ❌ Recording failed to start! State:", mediaRecorder.state);
          setMicTestError("Recording failed to start. State: " + mediaRecorder.state);
          setIsRecording(false);
          if (streamRef.current) {
            streamRef.current.getTracks().forEach((track) => track.stop());
          }
        }
      }, 200);

      setIsRecording(true);
      setRecordedAudio(null);
      setMicTestPassed(false);
      console.log("[Onboarding] ✅ Recording started! State:", mediaRecorder.state);
    } catch (err) {
      console.error("[Onboarding] Failed to start recording:", err);
      console.error("[Onboarding] Error name:", err.name);
      console.error("[Onboarding] Error message:", err.message);
      console.error("[Onboarding] Error stack:", err.stack);

      // Specific error messages - same approach as open-whispr
      let errorTitle = "Recording Error";
      let errorDescription = `Failed to access microphone: ${err.message}`;

      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        errorTitle = "Microphone Access Denied";
        errorDescription =
          "Please grant microphone permission in System Settings > Privacy & Security > Microphone. Look for 'Sentris' and enable it.";
        setMicGranted(false);
      } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        errorTitle = "No Microphone Found";
        errorDescription = "No microphone was detected. Please connect a microphone and try again.";
      } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
        errorTitle = "Microphone In Use";
        errorDescription =
          "The microphone is being used by another application. Please close other apps and try again.";
      } else if (err.message.includes("getUserMedia is not available")) {
        errorTitle = "Browser Compatibility Issue";
        errorDescription =
          "Your browser doesn't support microphone access. Please use a modern browser or update Electron.";
      }

      setMicTestError(`${errorTitle}: ${errorDescription}`);
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    console.log("[Onboarding] stopRecording called");
    console.log("[Onboarding] mediaRecorderRef.current:", !!mediaRecorderRef.current);
    console.log("[Onboarding] isRecording:", isRecording);

    if (mediaRecorderRef.current) {
      console.log("[Onboarding] MediaRecorder state:", mediaRecorderRef.current.state);

      if (mediaRecorderRef.current.state === "recording") {
        console.log("[Onboarding] Stopping MediaRecorder...");
        mediaRecorderRef.current.stop();
        console.log("[Onboarding] MediaRecorder stop() called");
      } else if (mediaRecorderRef.current.state === "inactive") {
        console.log("[Onboarding] MediaRecorder already stopped");
        setIsRecording(false);
      } else {
        console.log(
          "[Onboarding] MediaRecorder in unexpected state:",
          mediaRecorderRef.current.state,
        );
        // Try to stop anyway
        try {
          mediaRecorderRef.current.stop();
        } catch (err) {
          console.error("[Onboarding] Error stopping MediaRecorder:", err);
        }
      }
    } else {
      console.warn("[Onboarding] No MediaRecorder reference available");
      setIsRecording(false);
    }
  };

  const playRecording = async () => {
    if (recordedAudio && audioPlayerRef.current) {
      try {
        console.log("[Onboarding] Starting playback of recorded audio...");
        console.log("[Onboarding] Audio URL:", recordedAudio);
        console.log("[Onboarding] Audio MIME type:", recordedAudioMimeTypeRef.current);

        // Reset the audio element (Zoom-style approach: ensure clean state)
        audioPlayerRef.current.pause();
        audioPlayerRef.current.currentTime = 0;

        // Clear any previous source
        audioPlayerRef.current.src = "";

        // Set the new source
        audioPlayerRef.current.src = recordedAudio;

        // Wait for audio to be loaded (Zoom-style: wait for canplaythrough)
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            audioPlayerRef.current.removeEventListener("canplaythrough", handleCanPlay);
            audioPlayerRef.current.removeEventListener("loadeddata", handleCanPlay);
            audioPlayerRef.current.removeEventListener("error", handleError);
            reject(new Error("Audio loading timeout"));
          }, 5000); // 5 second timeout

          const handleCanPlay = () => {
            clearTimeout(timeout);
            audioPlayerRef.current.removeEventListener("canplaythrough", handleCanPlay);
            audioPlayerRef.current.removeEventListener("loadeddata", handleCanPlay);
            audioPlayerRef.current.removeEventListener("error", handleError);
            console.log("[Onboarding] ✅ Audio loaded and ready to play");
            resolve();
          };

          const handleError = (e) => {
            clearTimeout(timeout);
            audioPlayerRef.current.removeEventListener("canplaythrough", handleCanPlay);
            audioPlayerRef.current.removeEventListener("loadeddata", handleCanPlay);
            audioPlayerRef.current.removeEventListener("error", handleError);
            const errorMsg = audioPlayerRef.current.error
              ? `Audio error: ${audioPlayerRef.current.error.code} - ${audioPlayerRef.current.error.message}`
              : "Failed to load audio";
            console.error("[Onboarding] ❌", errorMsg);
            reject(new Error(errorMsg));
          };

          // Listen for both canplaythrough (preferred) and loadeddata (fallback)
          audioPlayerRef.current.addEventListener("canplaythrough", handleCanPlay);
          audioPlayerRef.current.addEventListener("loadeddata", handleCanPlay);
          audioPlayerRef.current.addEventListener("error", handleError);

          // If already loaded, resolve immediately
          if (audioPlayerRef.current.readyState >= 2) {
            clearTimeout(timeout);
            audioPlayerRef.current.removeEventListener("canplaythrough", handleCanPlay);
            audioPlayerRef.current.removeEventListener("loadeddata", handleCanPlay);
            audioPlayerRef.current.removeEventListener("error", handleError);
            resolve();
          } else {
            // Trigger load if not already loading
            audioPlayerRef.current.load();
          }
        });

        // Play the audio (Zoom-style: use play() promise)
        console.log("[Onboarding] Playing audio...");
        await audioPlayerRef.current.play();
        setIsPlaying(true);
        console.log("[Onboarding] ✅ Audio playback started");
      } catch (err) {
        console.error("[Onboarding] Failed to play recording:", err);
        console.error("[Onboarding] Error details:", {
          name: err.name,
          message: err.message,
          stack: err.stack,
          audioSrc: recordedAudio,
          audioMimeType: recordedAudioMimeTypeRef.current,
          readyState: audioPlayerRef.current?.readyState,
          error: audioPlayerRef.current?.error,
        });

        // Set error message for user feedback
        setMicTestError(
          `Playback failed: ${err.message}. Recording was successful, but playback encountered an issue.`,
        );

        // Even if playback fails, mark the test as passed since recording worked
        // (This matches Zoom's behavior - if recording works, microphone is functional)
        setMicTestPassed(true);
      }
    } else {
      console.error("[Onboarding] Cannot play: recordedAudio or audioPlayerRef not available");
      setMicTestError("Cannot play recording: audio data not available");
    }
  };

  const handleAudioEnded = () => {
    setIsPlaying(false);
    setMicTestPassed(true);
    console.log("[Onboarding] ✅ Microphone test passed - audio played successfully");
  };

  // Also mark test as passed after a successful recording (even if playback doesn't work)
  useEffect(() => {
    if (recordedAudio && !isRecording && !micTestPassed) {
      // Give user time to play back, but mark as passed after 5 seconds
      // since successful recording is the main test
      const timer = setTimeout(() => {
        if (!micTestPassed) {
          console.log("[Onboarding] ✅ Microphone test auto-passed - recording succeeded");
          setMicTestPassed(true);
        }
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [recordedAudio, isRecording, micTestPassed]);

  // Cleanup: Revoke object URL when component unmounts or recordedAudio changes (Zoom-style cleanup)
  useEffect(() => {
    return () => {
      if (recordedAudio) {
        URL.revokeObjectURL(recordedAudio);
        console.log("[Onboarding] Cleaned up audio object URL");
      }
    };
  }, [recordedAudio]);

  const resetMicTest = () => {
    // Clean up audio URL to prevent memory leaks (Zoom-style cleanup)
    if (recordedAudio) {
      URL.revokeObjectURL(recordedAudio);
    }
    setRecordedAudio(null);
    setMicTestPassed(false);
    setMicTestError(null);
    recordedAudioMimeTypeRef.current = null;

    // Reset audio player
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      audioPlayerRef.current.currentTime = 0;
      audioPlayerRef.current.src = "";
    }
    setIsPlaying(false);
  };

  // Voice typing error state
  const [voiceTypingError, setVoiceTypingError] = useState(null);

  // Track if we're in the testing phase for voice typing
  const isInVoiceTestRef = useRef(false);
  const voiceRecorderRef = useRef(null);
  const voiceStreamRef = useRef(null);
  const voiceChunksRef = useRef([]);

  // Track if globe key is ready (accessibility granted and listener active)
  const [globeKeyReady, setGlobeKeyReady] = useState(false);

  // ========== GLOBE KEY LISTENER FOR ONBOARDING ==========
  // Listen to globe key events so the hotkey works during onboarding
  // IMPORTANT: Only respond when the Centris window is focused to avoid
  // capturing text from other apps (like Google text boxes)
  const [windowFocused, setWindowFocused] = useState(true);

  // Track window focus state
  useEffect(() => {
    const handleFocus = () => {
      console.log("[Onboarding] Window focused");
      setWindowFocused(true);
    };
    const handleBlur = () => {
      console.log("[Onboarding] Window blurred");
      setWindowFocused(false);
    };

    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);

    // Check initial focus state
    setWindowFocused(document.hasFocus());

    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  useEffect(() => {
    // Only listen when in testing phase
    if (testPhase !== "testing") {
      return;
    }

    // Verify accessibility is granted (required for globe key)
    const checkGlobeKeyStatus = async () => {
      try {
        const accessStatus = await window.electronAPI?.checkAccessibilityPermission?.();
        console.log("[Onboarding] Globe key status check - accessibility:", accessStatus?.granted);
        if (accessStatus?.granted) {
          setGlobeKeyReady(true);
          console.log("[Onboarding] ✅ Globe key should be ready (accessibility granted)");
        } else {
          setGlobeKeyReady(false);
          console.log("[Onboarding] ⚠️ Globe key may not work (accessibility not granted)");
        }
      } catch (error) {
        console.error("[Onboarding] Error checking accessibility:", error);
      }
    };
    checkGlobeKeyStatus();

    const handleStartDictation = () => {
      // CRITICAL: Only respond if the Centris window is focused
      // This prevents capturing text when user is typing in other apps (like Google)
      if (!document.hasFocus()) {
        console.log("[Onboarding] Ignoring globe key - window not focused");
        return;
      }

      // Only respond if we're on the testing phase and textarea is present
      if (testPhase === "testing" && textareaRef.current) {
        textareaRef.current.focus();
        startVoiceRecordingForGlobeKey();
      }
    };

    const handleStopDictation = () => {
      if (testPhase === "testing") {
        stopVoiceRecordingForGlobeKey();
      }
    };

    // Subscribe to dictation events
    let unsubStart, unsubStop;

    if (window.electronAPI?.onStartDictation) {
      unsubStart = window.electronAPI.onStartDictation(handleStartDictation);
    }

    if (window.electronAPI?.onStopDictation) {
      unsubStop = window.electronAPI.onStopDictation(handleStopDictation);
      console.log("[Onboarding] ✅ Subscribed to stop-dictation events");
    } else {
      console.error("[Onboarding] ❌ onStopDictation not available!");
    }

    return () => {
      // Cleanup listeners
      console.log("[Onboarding] Cleaning up globe key listeners");
      if (typeof unsubStart === "function") {
        unsubStart();
        console.log("[Onboarding] Unsubscribed from start-dictation");
      }
      if (typeof unsubStop === "function") {
        unsubStop();
        console.log("[Onboarding] Unsubscribed from stop-dictation");
      }
    };
  }, [testPhase]);

  // Start recording when globe key is pressed - using simple approach like open-whispr
  const startVoiceRecordingForGlobeKey = async () => {
    if (isInVoiceTestRef.current) {
      console.log("[Onboarding] Already recording, ignoring");
      return;
    }

    setVoiceTypingError(null);
    setIsListening(true);
    isInVoiceTestRef.current = true;
    voiceChunksRef.current = [];

    try {
      // Simple getUserMedia - same as open-whispr
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      voiceStreamRef.current = stream;

      // Simple MediaRecorder - no mimeType specification
      const mediaRecorder = new MediaRecorder(stream);
      voiceRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          voiceChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        console.log("[Onboarding] Globe key recording stopped, processing...");

        // Cleanup stream
        if (voiceStreamRef.current) {
          voiceStreamRef.current.getTracks().forEach((track) => track.stop());
          voiceStreamRef.current = null;
        }

        // Process recording
        if (voiceChunksRef.current.length > 0) {
          // Use audio/wav type like open-whispr
          const audioBlob = new Blob(voiceChunksRef.current, { type: "audio/wav" });

          // Minimum size check - need at least ~2KB for meaningful audio
          // Very short recordings (< 2KB) are likely accidental key presses
          const MIN_AUDIO_SIZE_BYTES = 2000;

          if (audioBlob.size < MIN_AUDIO_SIZE_BYTES) {
            console.log("[Onboarding] Audio too short (", audioBlob.size, "bytes), skipping");
            // Don't show error for very short recordings - just skip silently
            setIsListening(false);
            isInVoiceTestRef.current = false;
            return;
          }

          console.log("[Onboarding] Processing audio blob:", audioBlob.size, "bytes");

          try {
            const arrayBuffer = await audioBlob.arrayBuffer();
            // Use Uint8Array instead of Buffer (Buffer not available in renderer)
            const uint8Array = new Uint8Array(arrayBuffer);
            const result = await window.electronAPI?.transcribeCentrisAudio?.(uint8Array);

            if (result?.success && result?.text) {
              const transcribedText = result.text.trim();
              console.log("[Onboarding] ✅ Transcribed:", transcribedText);

              // Set the text in the textarea
              setAccessibilityTestText(transcribedText);
              if (textareaRef.current) {
                textareaRef.current.value = transcribedText;
              }
              setAccessibilityTestPassed(true);
            } else {
              // Check if it's a "too short" error and handle gracefully
              const errorMsg = result?.error || "";
              if (errorMsg.includes("too short")) {
                console.log("[Onboarding] Audio too short for transcription, skipping");
              } else {
                console.log("[Onboarding] Transcription failed:", result);
                setVoiceTypingError(
                  "Could not transcribe audio. Please speak clearly and try again.",
                );
              }
            }
          } catch (err) {
            console.error("[Onboarding] Transcription error:", err);
            // Don't show error for "too short" errors
            if (!err.message?.includes("too short")) {
              setVoiceTypingError("Transcription error: " + err.message);
            }
          }
        }

        setIsListening(false);
        isInVoiceTestRef.current = false;
      };

      mediaRecorder.start(100);
      console.log("[Onboarding] ✅ Globe key recording started");
    } catch (err) {
      console.error("[Onboarding] Failed to start globe key recording:", err);
      setIsListening(false);
      isInVoiceTestRef.current = false;

      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        setVoiceTypingError("Microphone access denied. Please grant permission first.");
      } else {
        setVoiceTypingError("Failed to start recording: " + err.message);
      }
    }
  };

  // Stop recording when globe key is released
  const stopVoiceRecordingForGlobeKey = () => {
    if (voiceRecorderRef.current && voiceRecorderRef.current.state === "recording") {
      console.log("[Onboarding] Stopping globe key recorder...");
      voiceRecorderRef.current.stop();
    }
  };

  // ========== ACCESSIBILITY TEST: Voice Typing ==========
  // This simulates the actual usage - click button OR hold globe key
  // Using simple approach like open-whispr
  const startVoiceTypingTest = async () => {
    setIsListening(true);
    setAccessibilityTestText("");
    setVoiceTypingError(null);

    // Focus the textarea
    if (textareaRef.current) {
      textareaRef.current.focus();
    }

    try {
      console.log("[Onboarding] Starting voice typing test...");

      // Simple getUserMedia - same as open-whispr
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      console.log("[Onboarding] ✅ Got microphone stream for voice typing");

      // Simple MediaRecorder - no mimeType specification
      const mediaRecorder = new MediaRecorder(stream);

      const chunks = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());

        // Use audio/wav type like open-whispr
        const audioBlob = new Blob(chunks, { type: "audio/wav" });

        if (audioBlob.size === 0) {
          setIsListening(false);
          return;
        }

        // Transcribe via Centris backend
        try {
          const arrayBuffer = await audioBlob.arrayBuffer();
          const result = await window.electronAPI?.transcribeCentrisAudio?.(arrayBuffer);

          if (result?.success && result?.text) {
            const transcribedText = result.text.trim();

            // Test accessibility by pasting into the textarea
            // This simulates the real workflow
            if (textareaRef.current) {
              textareaRef.current.focus();

              // Try to paste via accessibility API
              try {
                await window.electronAPI?.pasteText?.(transcribedText);

                // If paste worked, the text should appear in the focused element
                // Give a short delay for the paste to complete
                setTimeout(() => {
                  // If text was pasted successfully, mark as passed
                  if (textareaRef.current && textareaRef.current.value.trim().length > 0) {
                    setAccessibilityTestPassed(true);
                  } else {
                    // Fallback: just set the text directly if paste didn't work
                    setAccessibilityTestText(transcribedText);
                  }
                }, 200);
              } catch (pasteErr) {
                console.error("Paste failed:", pasteErr);
                // Just set the text directly as fallback
                setAccessibilityTestText(transcribedText);
              }
            } else {
              setAccessibilityTestText(transcribedText);
            }
          }
        } catch (err) {
          console.error("Transcription failed:", err);
        }

        setIsListening(false);
      };

      // Record for 3 seconds
      mediaRecorder.start(100);

      setTimeout(() => {
        if (mediaRecorder.state === "recording") {
          mediaRecorder.stop();
        }
      }, 3000);
    } catch (err) {
      console.error("[Onboarding] Voice typing test failed:", err);
      setIsListening(false);

      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        setVoiceTypingError("Microphone access denied. Please grant permission first.");
      } else {
        setVoiceTypingError("Failed to start voice test: " + err.message);
      }
    }
  };

  // Handle manual text input (for accessibility test)
  const handleTextareaChange = (e) => {
    setAccessibilityTestText(e.target.value);
    if (e.target.value.trim().length > 0) {
      setAccessibilityTestPassed(true);
    }
  };

  const resetAccessibilityTest = () => {
    setAccessibilityTestText("");
    setAccessibilityTestPassed(false);
    setVoiceTypingError(null);
    if (textareaRef.current) {
      textareaRef.current.value = "";
    }
  };

  // Check if both tests are passed
  const allTestsPassed = micTestPassed && accessibilityTestPassed;
  const bothPermissionsGranted = micGranted && accessibilityGranted;

  // Hotkey options for the quick select
  const hotkeyOptions = [
    ...(isMacOS ? [{ id: "GLOBE", label: "Fn/🌐 Key" }] : []),
    { id: "`", label: "Backtick (`)" },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="flex flex-col items-center text-center space-y-6 max-w-lg mx-auto py-4"
    >
      {/* Hidden audio player for playback */}
      <audio ref={audioPlayerRef} onEnded={handleAudioEnded} className="hidden" />

      {/* Header */}
      <div className="space-y-2">
        <h2 className="text-2xl font-bold">
          {testPhase === "permissions" ? "Grant Permissions" : "Test Your Setup"}
        </h2>
        <p className="text-muted-foreground">
          {testPhase === "permissions"
            ? "Centris needs microphone and accessibility access to work properly."
            : "Let's make sure everything is working correctly."}
        </p>
      </div>

      {/* PERMISSIONS PHASE */}
      {testPhase === "permissions" && (
        <div className="w-full space-y-4">
          {/* Microphone Permission Card */}
          <div
            className={`glass-card p-5 rounded-xl border transition-all ${micGranted ? "border-green-500/50 bg-green-500/5" : "border-orange-500/30"}`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className={`p-2 rounded-lg ${micGranted ? "bg-green-500/20" : "bg-orange-500/20"}`}
                >
                  <Mic className={`w-6 h-6 ${micGranted ? "text-green-500" : "text-orange-500"}`} />
                </div>
                <div className="text-left">
                  <h3 className="font-semibold">Microphone Access</h3>
                  <p className="text-sm text-muted-foreground">Required for voice commands</p>
                </div>
              </div>
              {micGranted ? (
                <Check className="w-6 h-6 text-green-500" />
              ) : (
                <button
                  onClick={handleGrantMicrophone}
                  className="px-4 py-2 rounded-lg font-medium bg-gradient-to-r from-orange-600 to-orange-700 hover:from-orange-500 hover:to-orange-600 text-white text-sm"
                >
                  Grant Access
                </button>
              )}
            </div>
          </div>

          {/* Accessibility Permission Card */}
          <div
            className={`glass-card p-5 rounded-xl border transition-all ${accessibilityGranted ? "border-green-500/50 bg-green-500/5" : "border-purple-500/30"}`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className={`p-2 rounded-lg ${accessibilityGranted ? "bg-green-500/20" : "bg-purple-500/20"}`}
                >
                  <Shield
                    className={`w-6 h-6 ${accessibilityGranted ? "text-green-500" : "text-purple-500"}`}
                  />
                </div>
                <div className="text-left">
                  <h3 className="font-semibold">Accessibility Access</h3>
                  <p className="text-sm text-muted-foreground">
                    Required to insert text & detect hotkey
                  </p>
                </div>
              </div>
              {accessibilityGranted ? (
                <Check className="w-6 h-6 text-green-500" />
              ) : (
                <button
                  onClick={handleGrantAccessibility}
                  className="px-4 py-2 rounded-lg font-medium bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600 text-white text-sm"
                >
                  Open Settings
                </button>
              )}
            </div>

            {!accessibilityGranted && (
              <div className="mt-3 text-xs text-left text-muted-foreground bg-white/5 p-3 rounded-lg space-y-2">
                <p className="font-medium text-white/80">
                  In System Settings → Privacy & Security → Accessibility:
                </p>
                <ol className="list-decimal list-inside space-y-1 ml-1">
                  <li>Click the lock icon 🔒 to make changes</li>
                  <li>
                    Find{" "}
                    <strong className="text-orange-400">
                      {isDev ? '"Electron"' : '"Sentris"'}
                    </strong>{" "}
                    in the list
                  </li>
                  <li>Toggle the switch ON to enable</li>
                </ol>
                {isDev && (
                  <p className="text-yellow-400/80 mt-2 pt-2 border-t border-white/10">
                    ⚠️ Dev mode: Look for "Electron" or your Terminal app (e.g., Terminal, iTerm)
                  </p>
                )}
                <p className="text-white/60 mt-1">
                  💡 If you don't see the app, try running it again after enabling
                </p>
              </div>
            )}
          </div>

          {/* Skip to testing if permissions already granted */}
          {bothPermissionsGranted && (
            <button
              onClick={() => setTestPhase("testing")}
              className="w-full px-6 py-3 rounded-lg font-semibold bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 text-white border-0 flex items-center justify-center gap-2"
            >
              Continue to Testing <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* TESTING PHASE */}
      {testPhase === "testing" && (
        <div className="w-full space-y-6">
          {/* MICROPHONE TEST: Record and Playback */}
          <div
            className={`glass-card p-5 rounded-xl border transition-all ${micTestPassed ? "border-green-500/50 bg-green-500/5" : "border-orange-500/30"}`}
          >
            <div className="flex items-center gap-3 mb-4">
              <div
                className={`p-2 rounded-lg ${micTestPassed ? "bg-green-500/20" : "bg-orange-500/20"}`}
              >
                <Mic
                  className={`w-5 h-5 ${micTestPassed ? "text-green-500" : "text-orange-500"}`}
                />
              </div>
              <div className="text-left flex-1">
                <h3 className="font-semibold flex items-center gap-2">
                  Microphone Test
                  {micTestPassed && <Check className="w-4 h-4 text-green-500" />}
                </h3>
                <p className="text-xs text-muted-foreground">Record your voice and hear it back</p>
              </div>
            </div>

            <div className="flex gap-2">
              {!isRecording && !recordedAudio && (
                <button
                  onClick={startRecording}
                  className="flex-1 px-4 py-3 rounded-lg font-medium bg-gradient-to-r from-orange-600 to-orange-700 hover:from-orange-500 hover:to-orange-600 text-white flex items-center justify-center gap-2"
                >
                  <Mic className="w-4 h-4" />
                  Record Voice
                </button>
              )}

              {isRecording && (
                <button
                  onClick={stopRecording}
                  className="flex-1 px-4 py-3 rounded-lg font-medium bg-red-600 hover:bg-red-500 text-white flex items-center justify-center gap-2 animate-pulse"
                >
                  <Square className="w-4 h-4" />
                  Stop Recording
                </button>
              )}

              {recordedAudio && !isRecording && (
                <>
                  <button
                    onClick={playRecording}
                    disabled={isPlaying}
                    className="flex-1 px-4 py-3 rounded-lg font-medium bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 text-white flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {isPlaying ? (
                      <>
                        <Volume2 className="w-4 h-4 animate-pulse" /> Playing...
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4" /> Play Back
                      </>
                    )}
                  </button>
                  <button
                    onClick={resetMicTest}
                    className="px-4 py-3 rounded-lg font-medium border border-white/10 hover:bg-white/5 text-white flex items-center justify-center"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>

            {micTestPassed && (
              <p className="mt-3 text-sm text-green-400">✅ Microphone is working perfectly!</p>
            )}

            {micTestError && (
              <div className="mt-3 p-3 bg-red-500/20 border border-red-500/30 rounded-lg">
                <p className="text-sm text-red-300">❌ {micTestError}</p>
                <button
                  onClick={() => window.electronAPI?.openSystemPreferences?.("microphone")}
                  className="mt-2 text-xs text-orange-400 hover:text-orange-300 underline"
                >
                  Open Microphone Settings
                </button>
              </div>
            )}
          </div>

          {/* ACCESSIBILITY TEST: Voice Typing */}
          <div
            className={`glass-card p-5 rounded-xl border transition-all ${accessibilityTestPassed ? "border-green-500/50 bg-green-500/5" : "border-purple-500/30"}`}
          >
            <div className="flex items-center gap-3 mb-4">
              <div
                className={`p-2 rounded-lg ${accessibilityTestPassed ? "bg-green-500/20" : "bg-purple-500/20"}`}
              >
                <Keyboard
                  className={`w-5 h-5 ${accessibilityTestPassed ? "text-green-500" : "text-purple-500"}`}
                />
              </div>
              <div className="text-left flex-1">
                <h3 className="font-semibold flex items-center gap-2">
                  Voice Typing Test
                  {accessibilityTestPassed && <Check className="w-4 h-4 text-green-500" />}
                </h3>
                <p className="text-xs text-muted-foreground">
                  <strong>Hold {selectedHotkey === "GLOBE" ? "Fn/🌐 key" : selectedHotkey}</strong>{" "}
                  and speak, OR click "Speak Now" button
                </p>
              </div>
            </div>

            {/* Hotkey quick-select for the test */}
            <div className="mb-3 flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Activation Key:</span>
              <div className="flex gap-1">
                {hotkeyOptions.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => {
                      setSelectedHotkey(opt.id);
                      if (window.localStorage) {
                        window.localStorage.setItem(STORAGE_KEYS.DICTATION_KEY, opt.id);
                      }
                    }}
                    className={`px-3 py-1 rounded text-xs font-medium transition-all ${
                      selectedHotkey === opt.id
                        ? "bg-purple-500/30 border-purple-500/50 border text-purple-300"
                        : "bg-white/5 border border-white/10 text-white/70 hover:bg-white/10"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Test textarea */}
            <textarea
              ref={textareaRef}
              value={accessibilityTestText}
              onChange={handleTextareaChange}
              placeholder="Your voice will appear here..."
              className="w-full h-20 p-3 rounded-lg bg-black/50 border border-white/10 text-white placeholder:text-muted-foreground resize-none focus:outline-none focus:border-purple-500/50 text-sm"
            />

            <div className="flex gap-2 mt-3">
              <button
                onClick={startVoiceTypingTest}
                disabled={isListening}
                className="flex-1 px-4 py-3 rounded-lg font-medium bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600 text-white flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isListening ? (
                  <>
                    <Mic className="w-4 h-4 animate-pulse" /> Listening (3s)...
                  </>
                ) : (
                  <>
                    <Mic className="w-4 h-4" /> Speak Now
                  </>
                )}
              </button>
              {accessibilityTestText && (
                <button
                  onClick={resetAccessibilityTest}
                  className="px-4 py-3 rounded-lg font-medium border border-white/10 hover:bg-white/5 text-white flex items-center justify-center"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              )}
            </div>

            {accessibilityTestPassed && (
              <p className="mt-3 text-sm text-green-400">
                ✅ Voice typing is working! Text was successfully inserted.
              </p>
            )}

            {voiceTypingError && (
              <div className="mt-3 p-3 bg-red-500/20 border border-red-500/30 rounded-lg">
                <p className="text-sm text-red-300">❌ {voiceTypingError}</p>
              </div>
            )}

            <div
              className={`mt-3 text-xs p-3 rounded transition-all ${
                isListening
                  ? "bg-purple-500/30 border border-purple-500/50 text-purple-200"
                  : "bg-white/5 text-muted-foreground"
              }`}
            >
              {isListening ? (
                <p className="flex items-center gap-2">
                  <Mic className="w-4 h-4 animate-pulse" />
                  <strong>
                    Recording... Release {selectedHotkey === "GLOBE" ? "Fn/🌐" : selectedHotkey}{" "}
                    when done speaking
                  </strong>
                </p>
              ) : (
                <p>
                  💡 <strong>Try it now:</strong> Hold{" "}
                  <strong>{selectedHotkey === "GLOBE" ? "Fn/🌐 key" : selectedHotkey}</strong> and
                  speak, then release. Your words will appear in the box above!
                </p>
              )}
            </div>
          </div>

          {/* Continue button */}
          <div className="flex gap-3">
            <button
              onClick={onNext}
              className={`flex-1 px-6 py-3 rounded-lg font-semibold flex items-center justify-center gap-2 transition-all ${
                allTestsPassed
                  ? "bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 text-white"
                  : "bg-gradient-to-r from-cyan-600 to-cyan-700 hover:from-cyan-500 hover:to-cyan-600 text-white"
              }`}
            >
              {allTestsPassed ? (
                <>
                  Continue <ArrowRight className="w-4 h-4" />
                </>
              ) : (
                <>
                  Continue Anyway <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>

          {!allTestsPassed && (
            <p className="text-xs text-center text-muted-foreground">
              ⚠️ Tests not completed. You can continue, but some features may not work correctly.
            </p>
          )}
        </div>
      )}
    </motion.div>
  );
};

// Step 4: Voice Enrollment (Speaker Verification)
// Train Sentris to recognize YOUR voice only - prevents others from triggering your assistant
const VoiceEnrollmentStep = ({ onNext, onSkip }) => {
  const [enrollmentPhase, setEnrollmentPhase] = useState("intro"); // 'intro' | 'recording' | 'complete'
  const [currentPhrase, setCurrentPhrase] = useState(0);
  const [samples, setSamples] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [recordingError, setRecordingError] = useState(null);
  const [enrollmentComplete, setEnrollmentComplete] = useState(false);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const streamRef = useRef(null);

  // Phrases designed to capture diverse voice characteristics
  const enrollmentPhrases = [
    "Hey Sentris, what's the weather today?",
    "The quick brown fox jumps over the lazy dog.",
    "My voice is my password, verify me.",
    "Open my calendar and schedule a meeting.",
    "Count with me: one, two, three, four, five.",
  ];

  const startRecording = async () => {
    setRecordingError(null);
    setIsRecording(true);
    audioChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Try preferred formats
      const preferredMimeTypes = ["audio/webm", "audio/webm;codecs=opus", "audio/ogg;codecs=opus"];
      let selectedMimeType = null;

      for (const mimeType of preferredMimeTypes) {
        if (MediaRecorder.isTypeSupported(mimeType)) {
          selectedMimeType = mimeType;
          break;
        }
      }

      const mediaRecorder = selectedMimeType
        ? new MediaRecorder(stream, { mimeType: selectedMimeType })
        : new MediaRecorder(stream);

      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        // Cleanup stream
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
        }

        // Process the recording
        if (audioChunksRef.current.length > 0) {
          const audioBlob = new Blob(audioChunksRef.current, {
            type: mediaRecorder.mimeType || "audio/webm",
          });
          await processRecording(audioBlob);
        }

        setIsRecording(false);
      };

      mediaRecorder.start(100);
      console.log("[VoiceEnrollment] Recording started for phrase", currentPhrase + 1);
    } catch (err) {
      console.error("[VoiceEnrollment] Recording error:", err);
      setRecordingError("Failed to access microphone. Please grant permission.");
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  };

  const processRecording = async (audioBlob) => {
    setIsProcessing(true);

    try {
      // Convert blob to base64 for API
      const arrayBuffer = await audioBlob.arrayBuffer();
      const base64Audio = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

      // Send to backend for embedding extraction
      const backendUrl = DEFAULT_BACKEND_URL || "http://127.0.0.1:5001";
      const response = await fetch(`${backendUrl}/api/voice/enrollment/sample`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audio: base64Audio,
          sample_index: currentPhrase,
        }),
      });

      if (response.ok) {
        const result = await response.json();

        if (result.success) {
          setSamples((prev) => [...prev, result.embedding_id || currentPhrase]);

          if (currentPhrase < enrollmentPhrases.length - 1) {
            setCurrentPhrase((prev) => prev + 1);
          } else {
            // All samples collected - complete enrollment
            await completeEnrollment();
          }
        } else {
          setRecordingError(result.error || "Failed to process voice sample");
        }
      } else {
        // Backend not available - store locally and continue (offline-friendly)
        console.log("[VoiceEnrollment] Backend not available, storing sample locally");
        setSamples((prev) => [...prev, `local_${currentPhrase}`]);

        if (currentPhrase < enrollmentPhrases.length - 1) {
          setCurrentPhrase((prev) => prev + 1);
        } else {
          setEnrollmentComplete(true);
          setEnrollmentPhase("complete");
        }
      }
    } catch (err) {
      console.error("[VoiceEnrollment] Processing error:", err);
      // Continue anyway - voice enrollment is optional
      setSamples((prev) => [...prev, `error_${currentPhrase}`]);

      if (currentPhrase < enrollmentPhrases.length - 1) {
        setCurrentPhrase((prev) => prev + 1);
      } else {
        setEnrollmentComplete(true);
        setEnrollmentPhase("complete");
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const completeEnrollment = async () => {
    setIsProcessing(true);

    try {
      const backendUrl = DEFAULT_BACKEND_URL || "http://127.0.0.1:5001";
      const response = await fetch(`${backendUrl}/api/voice/enrollment/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ samples_count: samples.length + 1 }),
      });

      if (response.ok) {
        const result = await response.json();
        console.log("[VoiceEnrollment] Enrollment complete:", result);
      }

      // Save to localStorage that enrollment was completed
      if (window.localStorage) {
        window.localStorage.setItem("voice_enrollment_completed", "true");
        window.localStorage.setItem("speaker_verification_enabled", "true");
      }

      setEnrollmentComplete(true);
      setEnrollmentPhase("complete");
    } catch (err) {
      console.error("[VoiceEnrollment] Complete error:", err);
      // Mark as complete anyway - this is optional
      setEnrollmentComplete(true);
      setEnrollmentPhase("complete");
    } finally {
      setIsProcessing(false);
    }
  };

  const startEnrollment = () => {
    setEnrollmentPhase("recording");
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="flex flex-col items-center text-center space-y-6 max-w-lg mx-auto py-4"
    >
      {/* Header */}
      <div className="space-y-2">
        <div className="relative mx-auto mb-4">
          <div className="absolute -inset-3 bg-gradient-to-r from-emerald-500 to-teal-600 rounded-full blur-lg opacity-30 animate-pulse" />
          <div className="relative bg-black/80 p-4 rounded-xl border border-white/10 shadow-xl">
            <Shield className="w-10 h-10 text-emerald-500" />
          </div>
        </div>
        <h2 className="text-2xl font-bold">Voice Identity</h2>
        <p className="text-muted-foreground">
          {enrollmentPhase === "intro" && "Train Sentris to recognize YOUR voice only"}
          {enrollmentPhase === "recording" &&
            `Recording sample ${currentPhrase + 1} of ${enrollmentPhrases.length}`}
          {enrollmentPhase === "complete" && "Voice enrollment complete!"}
        </p>
      </div>

      {/* INTRO PHASE */}
      {enrollmentPhase === "intro" && (
        <div className="w-full space-y-4">
          <div className="glass-card p-5 rounded-xl border border-emerald-500/30">
            <div className="space-y-4">
              <div className="flex items-start gap-3 text-left">
                <div className="p-2 bg-emerald-500/20 rounded-lg">
                  <Shield className="w-5 h-5 text-emerald-500" />
                </div>
                <div>
                  <h3 className="font-semibold text-white">Why Voice ID?</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    In open offices or shared spaces, others talking nearby could accidentally
                    trigger your assistant. Voice ID ensures only YOUR voice activates Sentris.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 text-left">
                <div className="p-2 bg-teal-500/20 rounded-lg">
                  <Mic className="w-5 h-5 text-teal-500" />
                </div>
                <div>
                  <h3 className="font-semibold text-white">How it works</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    You'll read 5 short phrases. We'll create a unique "voiceprint" that identifies
                    you - like a fingerprint, but for your voice.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 text-left">
                <div className="p-2 bg-cyan-500/20 rounded-lg">
                  <Eye className="w-5 h-5 text-cyan-500" />
                </div>
                <div>
                  <h3 className="font-semibold text-white">Privacy First</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    We only store a 768-byte numerical "fingerprint" - never your actual voice
                    recordings. All processing happens locally.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex gap-3 w-full">
            <button
              onClick={onSkip}
              className="flex-1 px-6 py-3 rounded-lg font-semibold bg-white/5 hover:bg-white/10 text-white border border-white/10"
            >
              Skip for Now
            </button>
            <button
              onClick={startEnrollment}
              className="flex-1 px-6 py-3 rounded-lg font-semibold bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white flex items-center justify-center gap-2"
            >
              Set Up Voice ID <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* RECORDING PHASE */}
      {enrollmentPhase === "recording" && (
        <div className="w-full space-y-4">
          {/* Progress */}
          <div className="flex gap-2 justify-center">
            {enrollmentPhrases.map((_, idx) => (
              <div
                key={idx}
                className={`h-2 w-8 rounded-full transition-all ${
                  idx < currentPhrase
                    ? "bg-emerald-500"
                    : idx === currentPhrase
                      ? "bg-emerald-400 animate-pulse"
                      : "bg-white/10"
                }`}
              />
            ))}
          </div>

          {/* Current Phrase Card */}
          <div className="glass-card p-6 rounded-xl border border-emerald-500/30 bg-emerald-500/5">
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Please say:</p>
              <p className="text-xl font-medium text-white">"{enrollmentPhrases[currentPhrase]}"</p>
            </div>
          </div>

          {/* Recording Controls */}
          <div className="flex justify-center">
            {!isRecording && !isProcessing && (
              <button
                onClick={startRecording}
                className="px-8 py-4 rounded-xl font-semibold bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white flex items-center gap-3"
              >
                <Mic className="w-5 h-5" />
                Start Recording
              </button>
            )}

            {isRecording && (
              <button
                onClick={stopRecording}
                className="px-8 py-4 rounded-xl font-semibold bg-red-600 hover:bg-red-500 text-white flex items-center gap-3 animate-pulse"
              >
                <Square className="w-5 h-5" />
                Stop Recording
              </button>
            )}

            {isProcessing && (
              <div className="px-8 py-4 rounded-xl bg-white/10 text-white flex items-center gap-3">
                <Loader2 className="w-5 h-5 animate-spin" />
                Processing...
              </div>
            )}
          </div>

          {recordingError && (
            <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-lg">
              <p className="text-sm text-red-300">{recordingError}</p>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            💡 Speak naturally at your normal volume. Background noise is okay.
          </p>
        </div>
      )}

      {/* COMPLETE PHASE */}
      {enrollmentPhase === "complete" && (
        <div className="w-full space-y-4">
          <div className="glass-card p-6 rounded-xl border border-green-500/50 bg-green-500/10">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-green-500/20 rounded-full">
                <Check className="w-8 h-8 text-green-500" />
              </div>
              <div className="text-left">
                <h3 className="font-semibold text-lg text-white">Voice ID Enrolled!</h3>
                <p className="text-sm text-muted-foreground">
                  Sentris will now only respond to YOUR voice. Others nearby won't accidentally
                  trigger your assistant.
                </p>
              </div>
            </div>
          </div>

          <button
            onClick={onNext}
            className="w-full px-6 py-3 rounded-lg font-semibold bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white flex items-center justify-center gap-2"
          >
            Continue <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </motion.div>
  );
};

// Step 5: Advanced Permissions (Optional)
const AdvancedPermissionsStep = ({ onNext, onSkip, isMacOS }) => {
  const [screenRecordingGranted, setScreenRecordingGranted] = useState(false);
  const [inputMonitoringGranted, setInputMonitoringGranted] = useState(false);
  const [isChecking, setIsChecking] = useState(true);

  // Check advanced permissions on mount and periodically
  useEffect(() => {
    const checkAdvancedPermissions = async () => {
      try {
        const screenStatus = await window.electronAPI?.checkScreenRecordingPermission?.();
        const inputStatus = await window.electronAPI?.checkInputMonitoringPermission?.();

        setScreenRecordingGranted(screenStatus?.granted === true);
        setInputMonitoringGranted(inputStatus?.granted === true);
        setIsChecking(false);
      } catch (error) {
        console.error("[Onboarding] Advanced permission check error:", error);
        setIsChecking(false);
      }
    };

    checkAdvancedPermissions();
    const interval = setInterval(checkAdvancedPermissions, PERMISSION_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  const requestScreenRecording = async () => {
    try {
      await window.electronAPI?.requestScreenRecordingPermission?.();
      // Recheck after request
      setTimeout(async () => {
        const status = await window.electronAPI?.checkScreenRecordingPermission?.();
        setScreenRecordingGranted(status?.granted === true);
      }, 1000);
    } catch (error) {
      console.error("[Onboarding] Screen recording request error:", error);
    }
  };

  const requestInputMonitoring = async () => {
    try {
      await window.electronAPI?.requestInputMonitoringPermission?.();
      // Recheck after request
      setTimeout(async () => {
        const status = await window.electronAPI?.checkInputMonitoringPermission?.();
        setInputMonitoringGranted(status?.granted === true);
      }, 1000);
    } catch (error) {
      console.error("[Onboarding] Input monitoring request error:", error);
    }
  };

  const bothGranted = screenRecordingGranted && inputMonitoringGranted;

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="flex flex-col items-center text-center space-y-6 max-w-lg mx-auto py-4"
    >
      <div className="space-y-2">
        <h2 className="text-2xl font-bold">Advanced Capabilities</h2>
        <p className="text-muted-foreground">
          Enable these optional permissions for enhanced AI features.
        </p>
      </div>

      <div className="w-full space-y-4">
        {/* Screen Recording Permission */}
        <div
          className={`glass-card p-5 rounded-xl border transition-all ${
            screenRecordingGranted ? "border-green-500/50 bg-green-500/5" : "border-cyan-500/30"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className={`p-2 rounded-lg ${screenRecordingGranted ? "bg-green-500/20" : "bg-cyan-500/20"}`}
              >
                <Monitor
                  className={`w-6 h-6 ${screenRecordingGranted ? "text-green-500" : "text-cyan-500"}`}
                />
              </div>
              <div className="text-left">
                <h3 className="font-semibold">Screen Recording</h3>
                <p className="text-sm text-muted-foreground">AI vision, OCR, visual context</p>
              </div>
            </div>
            {screenRecordingGranted ? (
              <Check className="w-6 h-6 text-green-500" />
            ) : (
              <button
                onClick={requestScreenRecording}
                className="px-4 py-2 rounded-lg font-medium bg-gradient-to-r from-cyan-600 to-cyan-700 hover:from-cyan-500 hover:to-cyan-600 text-white text-sm"
              >
                Enable
              </button>
            )}
          </div>
          {!screenRecordingGranted && (
            <p className="mt-3 text-xs text-left text-muted-foreground">
              Enables: Screenshot capture • OCR text extraction • Visual AI understanding • System
              audio capture
            </p>
          )}
        </div>

        {/* Input Monitoring Permission */}
        <div
          className={`glass-card p-5 rounded-xl border transition-all ${
            inputMonitoringGranted ? "border-green-500/50 bg-green-500/5" : "border-amber-500/30"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className={`p-2 rounded-lg ${inputMonitoringGranted ? "bg-green-500/20" : "bg-amber-500/20"}`}
              >
                <Keyboard
                  className={`w-6 h-6 ${inputMonitoringGranted ? "text-green-500" : "text-amber-500"}`}
                />
              </div>
              <div className="text-left">
                <h3 className="font-semibold">Input Monitoring</h3>
                <p className="text-sm text-muted-foreground">Keyboard context awareness</p>
              </div>
            </div>
            {inputMonitoringGranted ? (
              <Check className="w-6 h-6 text-green-500" />
            ) : (
              <button
                onClick={requestInputMonitoring}
                className="px-4 py-2 rounded-lg font-medium bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 text-white text-sm"
              >
                Enable
              </button>
            )}
          </div>
          {!inputMonitoringGranted && (
            <p className="mt-3 text-xs text-left text-muted-foreground">
              Enables: Typing context • Smart autocomplete suggestions • Command shortcuts detection
            </p>
          )}
        </div>

        {/* Privacy Note */}
        <div className="bg-white/5 p-4 rounded-lg text-xs text-left text-muted-foreground">
          <p className="flex items-center gap-2 font-medium text-white/80 mb-2">
            <Shield className="w-4 h-4" /> Privacy First
          </p>
          <p>
            All data is processed locally on your device. Centris never sends your screen content or
            keystrokes to external servers. You can disable these permissions anytime in System
            Settings.
          </p>
        </div>
      </div>

      <div className="w-full flex gap-3">
        <button
          onClick={onSkip}
          className="flex-1 px-6 py-3 rounded-lg font-semibold bg-white/5 hover:bg-white/10 text-white border border-white/10 flex items-center justify-center gap-2"
        >
          Skip for Now
        </button>
        <button
          onClick={onNext}
          className={`flex-1 px-6 py-3 rounded-lg font-semibold flex items-center justify-center gap-2 ${
            bothGranted
              ? "bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 text-white"
              : "bg-gradient-to-r from-cyan-600 to-cyan-700 hover:from-cyan-500 hover:to-cyan-600 text-white"
          }`}
        >
          Continue <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </motion.div>
  );
};

// Step 4: Browser Extension Installation
const BrowserExtensionStep = ({ onNext, onSkip }) => {
  const [extensionConnected, setExtensionConnected] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [checkCount, setCheckCount] = useState(0);

  // Chrome Web Store link - will be updated when published
  // For now, shows instructions for manual installation
  const CHROME_EXTENSION_URL = null; // Will be: 'https://chrome.google.com/webstore/detail/centris-ai/EXTENSION_ID'

  // Poll backend for extension connection status
  useEffect(() => {
    const checkExtensionStatus = async () => {
      try {
        const backendUrl = DEFAULT_BACKEND_URL || "http://127.0.0.1:5001";
        const response = await fetch(`${backendUrl}/api/extension/status`, {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        });

        if (response.ok) {
          const data = await response.json();
          setExtensionConnected(data.connected === true);
        }
      } catch (error) {
        console.log("[Onboarding] Extension status check failed (backend may not be ready)");
      } finally {
        setIsChecking(false);
        setCheckCount((prev) => prev + 1);
      }
    };

    // Initial check
    checkExtensionStatus();

    // Poll every 3 seconds
    const interval = setInterval(checkExtensionStatus, 3000);

    return () => clearInterval(interval);
  }, []);

  const handleInstallClick = () => {
    if (CHROME_EXTENSION_URL) {
      // Open Chrome Web Store
      window.electronAPI?.openExternal?.(CHROME_EXTENSION_URL);
    } else {
      // Show installation instructions (development mode)
      window.electronAPI?.openExternal?.(
        "https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world",
      );
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="flex flex-col items-center text-center space-y-6 max-w-lg mx-auto py-4"
    >
      <div className="space-y-2">
        <h2 className="text-2xl font-bold">Browser Control</h2>
        <p className="text-muted-foreground">
          Install the browser extension to let Centris help you browse the web.
        </p>
      </div>

      <div className="w-full space-y-4">
        {/* Extension Install Card */}
        <div
          className={`glass-card p-5 rounded-xl border transition-all ${
            extensionConnected ? "border-green-500/50 bg-green-500/5" : "border-blue-500/30"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className={`p-2 rounded-lg ${extensionConnected ? "bg-green-500/20" : "bg-blue-500/20"}`}
              >
                <Chrome
                  className={`w-6 h-6 ${extensionConnected ? "text-green-500" : "text-blue-500"}`}
                />
              </div>
              <div className="text-left">
                <h3 className="font-semibold">Centris Browser Extension</h3>
                <p className="text-sm text-muted-foreground">Control your browser with AI</p>
              </div>
            </div>
            {extensionConnected ? (
              <Check className="w-6 h-6 text-green-500" />
            ) : (
              <button
                onClick={handleInstallClick}
                className="px-4 py-2 rounded-lg font-medium bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white text-sm flex items-center gap-2"
              >
                {CHROME_EXTENSION_URL ? (
                  <>
                    Install <ExternalLink className="w-3 h-3" />
                  </>
                ) : (
                  <>Coming Soon</>
                )}
              </button>
            )}
          </div>

          {extensionConnected && (
            <div className="mt-4 pt-3 border-t border-white/10">
              <div className="flex items-center gap-2 text-green-400">
                <Wifi className="w-4 h-4" />
                <span className="text-sm font-medium">Browser Connected</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Centris can now help you navigate, search, and interact with websites.
              </p>
            </div>
          )}

          {!extensionConnected && (
            <div className="mt-4 pt-3 border-t border-white/10">
              {isChecking && checkCount < 2 ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">Checking connection...</span>
                </div>
              ) : (
                <div className="text-left text-xs text-muted-foreground space-y-2">
                  <p className="font-medium text-white/80">What you can do with browser control:</p>
                  <ul className="space-y-1 ml-1">
                    <li>• "Go to amazon.com and search for wireless headphones"</li>
                    <li>• "Book a table at a nearby Italian restaurant"</li>
                    <li>• "Fill out this form with my information"</li>
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Status indicator */}
        {!extensionConnected && checkCount > 1 && (
          <div className="bg-white/5 p-4 rounded-lg text-xs text-left text-muted-foreground">
            <p className="flex items-center gap-2 font-medium text-white/80 mb-2">
              <Chrome className="w-4 h-4" /> Don't have the extension yet?
            </p>
            <p>
              No worries! You can install it later from the Chrome Web Store. Centris works great
              for voice dictation and desktop control without the browser extension.
            </p>
          </div>
        )}
      </div>

      <div className="w-full flex gap-3">
        <button
          onClick={onSkip}
          className="flex-1 px-6 py-3 rounded-lg font-semibold bg-white/5 hover:bg-white/10 text-white border border-white/10 flex items-center justify-center gap-2"
        >
          {extensionConnected ? "Continue" : "Skip for Now"}
        </button>
        {extensionConnected && (
          <button
            onClick={onNext}
            className="flex-1 px-6 py-3 rounded-lg font-semibold bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 text-white flex items-center justify-center gap-2"
          >
            Continue <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </motion.div>
  );
};

// Step 5: Hotkey Selection
const HotkeyStep = ({ onNext, selectedHotkey, setSelectedHotkey, isMacOS }) => {
  const options = [
    ...(isMacOS
      ? [{ id: "GLOBE", label: "Fn Key (Globe)", icon: Globe, desc: "Press Fn once to activate" }]
      : []),
    { id: "`", label: "Backtick (`)", icon: Keyboard, desc: "Top-left key under Esc" },
    { id: "F1", label: "F1 Key", icon: Command, desc: "Standard function key" },
    { id: "F2", label: "F2 Key", icon: Command, desc: "Standard function key" },
    { id: "F12", label: "F12 Key", icon: Command, desc: "Standard function key" },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="flex flex-col items-center text-center space-y-6 max-w-md mx-auto py-4"
    >
      <div className="space-y-2">
        <h2 className="text-2xl font-bold">Choose Activation Key</h2>
        <p className="text-muted-foreground">Select the key you'll use to trigger Sentris.</p>
      </div>

      <div className="grid gap-3 w-full">
        {options.map((opt) => (
          <div
            key={opt.id}
            onClick={() => setSelectedHotkey(opt.id)}
            className={`
              relative p-4 rounded-xl border cursor-pointer transition-all duration-200 flex items-center gap-4 text-left
              ${
                selectedHotkey === opt.id
                  ? "bg-orange-500/10 border-orange-500/50 shadow-[0_0_15px_rgba(255,107,53,0.15)]"
                  : "bg-white/5 border-white/5 hover:bg-white/10"
              }
            `}
          >
            <div
              className={`p-2 rounded-lg ${selectedHotkey === opt.id ? "bg-orange-500/20 text-orange-500" : "bg-white/10 text-muted-foreground"}`}
            >
              <opt.icon className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <h3
                className={`font-medium ${selectedHotkey === opt.id ? "text-orange-500" : "text-foreground"}`}
              >
                {opt.label}
              </h3>
              <p className="text-xs text-muted-foreground">{opt.desc}</p>
            </div>
            {selectedHotkey === opt.id && (
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}>
                <Check className="w-5 h-5 text-orange-500" />
              </motion.div>
            )}
          </div>
        ))}
      </div>

      <button
        onClick={() => {
          if (window.localStorage) {
            window.localStorage.setItem(STORAGE_KEYS.DICTATION_KEY, selectedHotkey);
          }
          onNext();
        }}
        className="w-full px-6 py-3 rounded-lg font-semibold bg-gradient-to-r from-orange-600 to-orange-700 hover:from-orange-500 hover:to-orange-600 text-white border-0 flex items-center justify-center gap-2"
      >
        Continue
      </button>
    </motion.div>
  );
};

// Step 5: Ready Screen
const ReadyStep = ({ onComplete, selectedHotkey }) => (
  <motion.div
    initial={{ opacity: 0, scale: 0.95 }}
    animate={{ opacity: 1, scale: 1 }}
    className="flex flex-col items-center text-center space-y-8 max-w-md mx-auto"
  >
    <div className="relative">
      <div className="absolute -inset-4 bg-gradient-to-r from-green-500 to-emerald-600 rounded-full blur-xl opacity-30 animate-pulse" />
      <div className="relative bg-black/80 p-8 rounded-full border border-white/10 shadow-2xl">
        <Check className="w-16 h-16 text-green-500" />
      </div>
    </div>

    <div className="space-y-2">
      <h1 className="text-4xl font-bold tracking-tight">You're All Set!</h1>
      <p className="text-muted-foreground text-lg">Sentris is ready to help you write faster.</p>
    </div>

    <div className="glass-card p-6 rounded-xl w-full">
      <p className="text-sm text-muted-foreground mb-2">Your Activation Key</p>
      <div className="flex items-center justify-center gap-2 text-xl font-bold">
        <Globe className="w-6 h-6 text-orange-500" />
        <span>{selectedHotkey === "GLOBE" ? "Fn Key" : selectedHotkey}</span>
      </div>
    </div>

    <button
      onClick={onComplete}
      className="w-full px-6 py-3 rounded-lg font-semibold bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 text-white border-0 shadow-lg shadow-green-900/20 flex items-center justify-center gap-2"
    >
      Launch Sentris
    </button>
  </motion.div>
);

export default function Onboarding({ onComplete }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedHotkey, setSelectedHotkey] = useState(
    typeof window !== "undefined" && window.electronAPI?.getPlatform?.() === "darwin"
      ? DEFAULT_MACOS_HOTKEY
      : DEFAULT_OTHER_HOTKEY,
  );
  // Language selection - default to 'en' (English)
  const [selectedLanguage, setSelectedLanguage] = useState(() => {
    // Check if there's a saved preference
    if (typeof window !== "undefined" && window.localStorage) {
      const saved = window.localStorage.getItem(STORAGE_KEYS.PREFERRED_LANGUAGE);
      if (saved) {
        return saved;
      }
    }
    return "en"; // Default to English
  });
  const [micPermissionGranted, setMicPermissionGranted] = useState(false);
  const [accessibilityPermissionGranted, setAccessibilityPermissionGranted] = useState(false);
  const [checkingPermissions, setCheckingPermissions] = useState(true);

  const isMacOS = typeof window !== "undefined" && window.electronAPI?.getPlatform?.() === "darwin";
  // Detect dev mode - use electronAPI if available, fallback to URL check
  const isDev =
    typeof window !== "undefined" &&
    (window.electronAPI?.isDev?.() === true ||
      window.location.hostname === "localhost" ||
      window.location.port === "5173");

  // Enable scrolling on body during onboarding
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.body.style.overflow = "auto";
      return () => {
        document.body.style.overflow = "hidden";
      };
    }
  }, []);

  // Track previous permission states to detect changes
  const prevMicGrantedRef = useRef(null);
  const prevAccessibilityGrantedRef = useRef(null);

  // Check permissions on mount and periodically
  useEffect(() => {
    let cancelled = false;
    let interval = null;

    const checkPermissions = async () => {
      if (!isMacOS || cancelled) {
        if (!cancelled) {
          setMicPermissionGranted(true);
          setAccessibilityPermissionGranted(true);
          setCheckingPermissions(false);
        }
        return;
      }

      try {
        const micStatus = await window.electronAPI?.checkMicrophonePermission?.();
        const micGranted = micStatus?.granted === true && micStatus?.status === "granted";

        const accessibilityStatus = await window.electronAPI?.checkAccessibilityPermission?.();
        const accessibilityGranted = accessibilityStatus?.granted === true;

        // Only log when permission status changes (reduces console spam)
        const micChanged = prevMicGrantedRef.current !== micGranted;
        const accessibilityChanged = prevAccessibilityGrantedRef.current !== accessibilityGranted;

        if (micChanged || accessibilityChanged || prevMicGrantedRef.current === null) {
          console.log("[Onboarding] Permission status:", {
            microphone: micGranted ? "✅ granted" : "❌ denied",
            accessibility: accessibilityGranted ? "✅ granted" : "❌ denied",
          });
          prevMicGrantedRef.current = micGranted;
          prevAccessibilityGrantedRef.current = accessibilityGranted;
        }

        if (!cancelled) {
          setMicPermissionGranted(micGranted);
          setAccessibilityPermissionGranted(accessibilityGranted);
        }
      } catch (error) {
        console.error("[Onboarding] Permission check error:", error);
        if (!cancelled) {
          setMicPermissionGranted(false);
          setAccessibilityPermissionGranted(false);
        }
      } finally {
        if (!cancelled) {
          setCheckingPermissions(false);
        }
      }
    };

    checkPermissions();

    // Poll for permissions on the combined permissions step (now step 2 after language selection)
    if (isMacOS && currentStep === 2) {
      interval = setInterval(checkPermissions, PERMISSION_CHECK_INTERVAL_MS);
    }

    return () => {
      cancelled = true;
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [isMacOS, currentStep]);

  const handleRequestMicrophonePermission = async () => {
    try {
      // MVP: Better error handling with retry logic
      let attempts = 0;
      const maxAttempts = 3;

      while (attempts < maxAttempts) {
        try {
          const result = await window.electronAPI?.requestMicrophonePermission?.();
          if (result?.granted) {
            console.log("[Onboarding] ✅ Microphone permission granted");
            return;
          }

          // If not granted, open system preferences
          await window.electronAPI?.openSystemPreferences?.("microphone");

          // Wait a bit and check again
          await new Promise((resolve) => setTimeout(resolve, 1000));
          attempts++;
        } catch (error) {
          console.warn(`[Onboarding] Permission request attempt ${attempts + 1} failed:`, error);
          attempts++;

          if (attempts < maxAttempts) {
            // Retry after delay
            await new Promise((resolve) => setTimeout(resolve, 1000));
          } else {
            // Final fallback: just open system preferences
            try {
              await window.electronAPI?.openSystemPreferences?.("microphone");
            } catch (fallbackError) {
              console.error("[Onboarding] Failed to open system preferences:", fallbackError);
            }
          }
        }
      }
    } catch (error) {
      console.error("[Onboarding] Microphone permission request failed:", error);
      // Final fallback
      try {
        await window.electronAPI?.openSystemPreferences?.("microphone");
      } catch (fallbackError) {
        console.error("[Onboarding] Failed to open system preferences:", fallbackError);
      }
    }
  };

  const handleOpenAccessibilitySettings = async () => {
    try {
      // MVP: Better error handling with retry
      let attempts = 0;
      const maxAttempts = 3;

      while (attempts < maxAttempts) {
        try {
          await window.electronAPI?.openSystemPreferences?.("accessibility");
          return; // Success
        } catch (error) {
          console.warn(
            `[Onboarding] Accessibility settings open attempt ${attempts + 1} failed:`,
            error,
          );
          attempts++;

          if (attempts < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        }
      }

      console.error("[Onboarding] Failed to open accessibility settings after retries");
    } catch (error) {
      console.error("[Onboarding] Accessibility settings error:", error);
      // Silent fail - user can open settings manually
    }
  };

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleComplete();
    }
  };

  const handleComplete = async () => {
    try {
      // Save hotkey first
      await window.electronAPI?.updateHotkey?.(selectedHotkey);

      // Save to localStorage BEFORE calling onComplete
      if (window.localStorage) {
        window.localStorage.setItem(STORAGE_KEYS.DICTATION_KEY, selectedHotkey);
        window.localStorage.setItem(STORAGE_KEYS.PREFERRED_LANGUAGE, selectedLanguage);
        window.localStorage.setItem(STORAGE_KEYS.ONBOARDING_COMPLETED, "true");
      }

      // Save language preference to backend with onboarding_completed flag
      try {
        const backendService = new CentrisBackendService();
        await backendService.saveUserPreferences({
          language: selectedLanguage,
          onboarding_completed: true,
        });
        console.log("[Onboarding] ✅ Preferences saved to backend");
      } catch (backendError) {
        console.warn("[Onboarding] Backend save failed (using localStorage):", backendError);
      }

      // Also update electron-store via IPC
      await window.electronAPI?.completeOnboarding?.();
    } catch (error) {
      // Silent fail - onboarding state is saved in localStorage
    }

    // Call onComplete callback - this will trigger minimize-after-onboarding
    // which converts the window to overlay mode and shows pill UI
    onComplete();
  };

  // Add class to body when onboarding is active
  useEffect(() => {
    document.body.classList.add("onboarding-active");
    document.documentElement.style.backgroundColor = "#000000";
    document.body.style.backgroundColor = "#000000";
    document.body.style.overflow = "hidden";

    return () => {
      document.body.classList.remove("onboarding-active");
      document.documentElement.style.backgroundColor = "";
      document.body.style.backgroundColor = "";
      document.body.style.overflow = "";
    };
  }, []);

  return (
    <div
      data-onboarding="true"
      className="onboarding-container"
      style={{
        backgroundColor: "#000000",
        height: "100vh",
        width: "100vw",
        margin: 0,
        padding: 0,
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        boxSizing: "border-box",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Galaxy Background */}
      <GalaxyBackground starCount={800} speed={0.5} gridSize={40} showGrid={true} />

      {/* Scrollable content container */}
      <div
        className="w-full h-full flex items-center justify-center z-10 overflow-y-auto overflow-x-hidden"
        style={{
          padding: "1rem",
          boxSizing: "border-box",
          maxWidth: "100%",
          maxHeight: "100%",
        }}
      >
        <div className="w-full max-w-lg py-4">
          {/* Dev Mode Banner */}
          {isDev && (
            <div className="mb-4 px-4 py-2 bg-yellow-500/20 border border-yellow-500/50 rounded-lg text-yellow-400 text-xs text-center">
              ⚠️ <strong>DEV MODE</strong> - In System Settings, look for "<strong>Electron</strong>
              " (not "Sentris")
            </div>
          )}

          {/* Progress Bar - Now 9 steps (Auth + Welcome + Language + Permissions + Voice ID + Advanced + Browser + Hotkey + Ready) */}
          <div className="mb-8 flex justify-center gap-2">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
              <motion.div
                key={i}
                className={`h-1.5 rounded-full transition-all duration-500 ${
                  i <= currentStep + 1 ? "bg-orange-500" : "bg-white/10"
                }`}
                animate={{
                  width: i <= currentStep + 1 ? 24 : 6,
                }}
              />
            ))}
          </div>

          <AnimatePresence mode="wait">
            {/* Step 0: Auth (Sign In / Sign Up) */}
            {currentStep === 0 && (
              <AuthStep
                key="step-auth"
                onComplete={() => setCurrentStep(1)}
                onSkip={isDev ? handleComplete : undefined}
              />
            )}

            {/* Step 1: Welcome */}
            {currentStep === 1 && <WelcomeStep key="step1" onNext={() => setCurrentStep(2)} />}

            {/* Step 2: Language Selection */}
            {currentStep === 2 && (
              <LanguageStep
                key="step2"
                onNext={() => setCurrentStep(3)}
                selectedLanguage={selectedLanguage}
                setSelectedLanguage={setSelectedLanguage}
              />
            )}

            {/* Step 3: Combined Permissions & Testing */}
            {currentStep === 3 && (
              <PermissionsAndTestStep
                key="step3"
                onNext={() => setCurrentStep(4)}
                micPermissionGranted={micPermissionGranted}
                accessibilityPermissionGranted={accessibilityPermissionGranted}
                onRequestMicPermission={handleRequestMicrophonePermission}
                onRequestAccessibilityPermission={handleOpenAccessibilitySettings}
                isDev={isDev}
                selectedHotkey={selectedHotkey}
                setSelectedHotkey={setSelectedHotkey}
                isMacOS={isMacOS}
              />
            )}

            {/* Step 4: Voice Enrollment (Speaker Verification) */}
            {currentStep === 4 && (
              <VoiceEnrollmentStep
                key="step4"
                onNext={() => setCurrentStep(5)}
                onSkip={() => setCurrentStep(5)}
              />
            )}

            {/* Step 5: Advanced Permissions (Optional) */}
            {currentStep === 5 && (
              <AdvancedPermissionsStep
                key="step5"
                onNext={() => setCurrentStep(6)}
                onSkip={() => setCurrentStep(6)}
                isMacOS={isMacOS}
              />
            )}

            {/* Step 6: Browser Extension */}
            {currentStep === 6 && (
              <BrowserExtensionStep
                key="step6"
                onNext={() => setCurrentStep(7)}
                onSkip={() => setCurrentStep(7)}
              />
            )}

            {/* Step 7: Hotkey Selection */}
            {currentStep === 7 && (
              <HotkeyStep
                key="step7"
                onNext={() => setCurrentStep(8)}
                selectedHotkey={selectedHotkey}
                setSelectedHotkey={setSelectedHotkey}
                isMacOS={isMacOS}
              />
            )}

            {/* Step 8: Ready */}
            {currentStep === 8 && (
              <ReadyStep key="step8" onComplete={handleComplete} selectedHotkey={selectedHotkey} />
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
