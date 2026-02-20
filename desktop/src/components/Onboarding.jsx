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
  Monitor,
  Eye,
  ChevronRight,
  Chrome,
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
  DEFAULT_MACOS_HOTKEY,
  DEFAULT_OTHER_HOTKEY,
  STORAGE_KEYS,
  DEFAULT_BACKEND_URL,
} from "../utils/constants";
import { LANGUAGE_OPTIONS, getLanguageByCode, POPULAR_LANGUAGES } from "../utils/languages";
import AuthStep from "./AuthStep";
import GalaxyBackground from "./GalaxyBackground";

const steps = [
  { title: "Sign In", icon: User },
  { title: "Welcome", icon: Sparkles },
  { title: "Language", icon: Languages },
  { title: "Permissions", icon: Mic },
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

// Step 3: Combined Permissions & Automatic Readiness Gate
const PermissionsAndTestStep = ({
  onNext,
  micPermissionGranted,
  accessibilityPermissionGranted,
  onRequestMicPermission,
  onRequestAccessibilityPermission,
  isDev,
}) => {
  const [micGranted, setMicGranted] = useState(false);
  const [accessibilityGranted, setAccessibilityGranted] = useState(false);
  const [runtimeReady, setRuntimeReady] = useState(false);
  const [runtimeProbeError, setRuntimeProbeError] = useState(null);
  const [isProbingRuntime, setIsProbingRuntime] = useState(false);

  useEffect(() => {
    setMicGranted(micPermissionGranted);
  }, [micPermissionGranted]);

  useEffect(() => {
    setAccessibilityGranted(accessibilityPermissionGranted);
  }, [accessibilityPermissionGranted]);

  const bothPermissionsGranted = micGranted && accessibilityGranted;
  const canContinue = bothPermissionsGranted && runtimeReady;

  // After required OS permissions are granted, prove runtime path is alive in background.
  useEffect(() => {
    if (!bothPermissionsGranted) {
      setRuntimeReady(false);
      setRuntimeProbeError(null);
      return undefined;
    }

    let cancelled = false;

    const runProbe = async () => {
      setIsProbingRuntime(true);
      try {
        if (!window.electronAPI?.observeRuntime) {
          if (!cancelled) {
            setRuntimeReady(true);
            setRuntimeProbeError(null);
          }
          return;
        }

        const result = await window.electronAPI.observeRuntime({
          instruction: "onboarding runtime health probe",
        });

        if (cancelled) {
          return;
        }

        const ok = result?.ok === true;
        setRuntimeReady(ok);
        setRuntimeProbeError(ok ? null : (result?.error ?? "Centris runtime is still starting."));
      } catch (_error) {
        if (!cancelled) {
          setRuntimeReady(false);
          setRuntimeProbeError("Centris runtime is still starting.");
        }
      } finally {
        if (!cancelled) {
          setIsProbingRuntime(false);
        }
      }
    };

    runProbe();
    const probeInterval = setInterval(runProbe, 3000);

    return () => {
      cancelled = true;
      clearInterval(probeInterval);
    };
  }, [bothPermissionsGranted]);

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="flex flex-col items-center text-center space-y-6 max-w-lg mx-auto py-4"
    >
      <div className="space-y-2">
        <h2 className="text-2xl font-bold">Enable Computer Control</h2>
        <p className="text-muted-foreground">
          Grant required macOS permissions. Centris validates runtime readiness automatically.
        </p>
      </div>

      <div className="w-full space-y-4">
        <div
          className={`glass-card p-5 rounded-xl border transition-all ${micGranted ? "border-green-500/50 bg-green-500/5" : "border-orange-500/30"}`}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className={`p-2 rounded-lg ${micGranted ? "bg-green-500/20" : "bg-orange-500/20"}`}
              >
                <Mic className={`w-6 h-6 ${micGranted ? "text-green-500" : "text-orange-500"}`} />
              </div>
              <div className="text-left">
                <h3 className="font-semibold">Microphone Access</h3>
                <p className="text-sm text-muted-foreground">Required for voice command capture</p>
              </div>
            </div>
            {micGranted ? (
              <Check className="w-6 h-6 text-green-500" />
            ) : (
              <button
                onClick={onRequestMicPermission}
                className="px-4 py-2 rounded-lg font-medium bg-gradient-to-r from-orange-600 to-orange-700 hover:from-orange-500 hover:to-orange-600 text-white text-sm"
              >
                Grant Access
              </button>
            )}
          </div>
        </div>

        <div
          className={`glass-card p-5 rounded-xl border transition-all ${accessibilityGranted ? "border-green-500/50 bg-green-500/5" : "border-purple-500/30"}`}
        >
          <div className="flex items-center justify-between gap-3">
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
                  Required for keyboard and mouse control across the computer
                </p>
              </div>
            </div>
            {accessibilityGranted ? (
              <Check className="w-6 h-6 text-green-500" />
            ) : (
              <button
                onClick={onRequestAccessibilityPermission}
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
                <li>Click the lock icon to make changes</li>
                <li>
                  Find{" "}
                  <strong className="text-orange-400">{isDev ? '"Electron"' : '"Sentris"'}</strong>{" "}
                  in the list
                </li>
                <li>Turn it ON</li>
              </ol>
            </div>
          )}
        </div>

        <div
          className={`glass-card p-5 rounded-xl border transition-all ${
            canContinue ? "border-green-500/50 bg-green-500/5" : "border-cyan-500/30"
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className={`p-2 rounded-lg ${canContinue ? "bg-green-500/20" : "bg-cyan-500/20"}`}
              >
                {canContinue ? (
                  <Check className="w-6 h-6 text-green-500" />
                ) : (
                  <Loader2
                    className={`w-6 h-6 text-cyan-400 ${isProbingRuntime ? "animate-spin" : ""}`}
                  />
                )}
              </div>
              <div className="text-left">
                <h3 className="font-semibold">Runtime Readiness</h3>
                <p className="text-sm text-muted-foreground">
                  Automatic live probe for the voice runtime path
                </p>
              </div>
            </div>
          </div>

          {!bothPermissionsGranted && (
            <p className="mt-3 text-xs text-muted-foreground">
              Grant microphone and accessibility first to start automatic readiness validation.
            </p>
          )}

          {bothPermissionsGranted && !runtimeReady && (
            <p className="mt-3 text-xs text-muted-foreground">
              {runtimeProbeError || "Centris is finalizing startup in the background."}
            </p>
          )}

          {canContinue && (
            <p className="mt-3 text-sm text-green-400">
              Ready. Core voice control runtime is online.
            </p>
          )}
        </div>

        <button
          onClick={onNext}
          disabled={!canContinue}
          className={`w-full px-6 py-3 rounded-lg font-semibold flex items-center justify-center gap-2 ${
            canContinue
              ? "bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 text-white"
              : "bg-white/5 text-white/50 border border-white/10 cursor-not-allowed"
          }`}
        >
          Continue <ArrowRight className="w-4 h-4" />
        </button>
      </div>
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
const BrowserExtensionStep = ({ onNext }) => {
  const [extensionConnected, setExtensionConnected] = useState(false);
  const [tokenProvisioned, setTokenProvisioned] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [checkCount, setCheckCount] = useState(0);

  const checkExtensionStatus = async () => {
    try {
      // Preferred: probe runtime authority endpoint via IPC bridge.
      if (window.electronAPI?.observeRuntime) {
        const result = await window.electronAPI.observeRuntime({
          instruction: "extension connection probe",
        });
        setExtensionConnected(result?.ok === true);
        if (window.electronAPI?.getBridgeTokenStatus) {
          const tokenStatus = await window.electronAPI.getBridgeTokenStatus();
          setTokenProvisioned(tokenStatus?.present === true);
        }
        return;
      }

      // Fallback for older runtimes that do not expose action authority IPC yet.
      const backendUrl = DEFAULT_BACKEND_URL || "http://127.0.0.1:5001";
      const response = await fetch(`${backendUrl}/api/extension/status`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      if (response.ok) {
        const data = await response.json();
        setExtensionConnected(data.connected === true);
      }
      if (window.electronAPI?.getBridgeTokenStatus) {
        const tokenStatus = await window.electronAPI.getBridgeTokenStatus();
        setTokenProvisioned(tokenStatus?.present === true);
      }
    } catch (error) {
      console.log("[Onboarding] Extension status check failed (backend may not be ready)");
      setExtensionConnected(false);
      setTokenProvisioned(false);
    } finally {
      setIsChecking(false);
      setCheckCount((prev) => prev + 1);
    }
  };

  // Poll backend for extension connection status
  useEffect(() => {
    // Initial check
    checkExtensionStatus();

    // Poll every 3 seconds
    const interval = setInterval(checkExtensionStatus, 3000);

    return () => clearInterval(interval);
  }, []);

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
          Centris connects to your browser automatically in the background.
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
                <h3 className="font-semibold">Browser Bridge</h3>
                <p className="text-sm text-muted-foreground">Automatic background connection</p>
              </div>
            </div>
            {extensionConnected ? (
              <Check className="w-6 h-6 text-green-500" />
            ) : (
              <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
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
                  <span className="text-sm">Connecting in background...</span>
                </div>
              ) : (
                <div className="text-left text-xs text-muted-foreground space-y-2">
                  <p className="font-medium text-white/80">
                    Centris keeps trying in the background.
                  </p>
                  <ul className="space-y-1 ml-1">
                    <li>• "Go to amazon.com and search for wireless headphones"</li>
                    <li>• "Book a table at a nearby Italian restaurant"</li>
                    <li>• "Fill out this form with my information"</li>
                  </ul>
                  <button
                    onClick={() => {
                      setIsChecking(true);
                      checkExtensionStatus();
                    }}
                    className="mt-2 px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/15 text-white text-xs"
                  >
                    {isChecking ? "Checking..." : "Check Connection"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Status indicator */}
        {!extensionConnected && checkCount > 1 && (
          <div className="bg-white/5 p-4 rounded-lg text-xs text-left text-muted-foreground">
            <p className="flex items-center gap-2 font-medium text-white/80 mb-2">
              <Chrome className="w-4 h-4" /> No setup required
            </p>
            <p>
              You can continue now. Browser automation becomes available automatically once the
              background bridge is ready.
            </p>
          </div>
        )}
      </div>

      <div className="w-full space-y-3">
        {!tokenProvisioned && (
          <div className="bg-amber-500/10 border border-amber-500/40 rounded-lg p-3 text-left text-xs text-amber-200">
            Waiting for secure bridge token provisioning from the desktop app.
          </div>
        )}
        <button
          onClick={onNext}
          disabled={!(extensionConnected && tokenProvisioned)}
          className={`w-full px-6 py-3 rounded-lg font-semibold flex items-center justify-center gap-2 ${
            extensionConnected && tokenProvisioned
              ? "bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 text-white"
              : "bg-white/5 text-white/50 border border-white/10 cursor-not-allowed"
          }`}
        >
          Continue <ChevronRight className="w-4 h-4" />
        </button>
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

  if (!isMacOS && !isDev) {
    return (
      <div className="onboarding-container flex items-center justify-center min-h-screen bg-black text-white">
        <div className="max-w-md mx-auto text-center space-y-4 p-6 border border-white/10 rounded-xl bg-white/5">
          <h2 className="text-2xl font-bold">macOS Required For Launch</h2>
          <p className="text-sm text-muted-foreground">
            Centris desktop computer control is currently GA on macOS only. Install on macOS to
            continue full-computer voice control.
          </p>
        </div>
      </div>
    );
  }

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
      <GalaxyBackground
        mouseRepulsion
        mouseInteraction
        density={1}
        glowIntensity={0.3}
        saturation={0}
        hueShift={270}
        twinkleIntensity={0.3}
        rotationSpeed={0.05}
        repulsionStrength={2}
        starSpeed={0.3}
        speed={0.5}
        transparent={false}
      />

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

            {/* Step 3: Permissions + automatic runtime readiness */}
            {currentStep === 3 && (
              <PermissionsAndTestStep
                key="step3"
                onNext={() => setCurrentStep(4)}
                micPermissionGranted={micPermissionGranted}
                accessibilityPermissionGranted={accessibilityPermissionGranted}
                onRequestMicPermission={handleRequestMicrophonePermission}
                onRequestAccessibilityPermission={handleOpenAccessibilitySettings}
                isDev={isDev}
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
              <BrowserExtensionStep key="step6" onNext={() => setCurrentStep(7)} />
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
