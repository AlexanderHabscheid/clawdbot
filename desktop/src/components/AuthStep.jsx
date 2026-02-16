import { motion, AnimatePresence } from "framer-motion";
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  Loader2,
  AlertCircle,
  CheckCircle,
} from "lucide-react";
/**
 * AuthStep - Authentication step for Sentris OS onboarding
 *
 * Matches sentris.io design language:
 * - Dark background with purple/orange gradient blurs
 * - Orange primary buttons (#FF6B4A)
 * - Clean, modern typography
 * - Glass-effect cards
 *
 * Supports:
 * - Sign in with Google (OAuth)
 * - Sign in with Email/Password
 * - Sign up with Email/Password
 */
import React, { useState, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";

// Google icon component
const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5">
    <path
      fill="#4285F4"
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
    />
    <path
      fill="#34A853"
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
    />
    <path
      fill="#FBBC05"
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
    />
    <path
      fill="#EA4335"
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
    />
  </svg>
);

export default function AuthStep({ onComplete, onSkip }) {
  const { signIn, signUp, signInWithOAuth, loading, error, clearError, isAuthenticated, user } =
    useAuth();

  const [mode, setMode] = useState("signin"); // 'signin' | 'signup'
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [isOAuthPending, setIsOAuthPending] = useState(false);

  // Watch for successful OAuth completion
  useEffect(() => {
    if (isOAuthPending && isAuthenticated && user) {
      console.log("[AuthStep] ✅ OAuth completed successfully!");
      setIsOAuthPending(false);
      onComplete();
    }
  }, [isOAuthPending, isAuthenticated, user, onComplete]);

  // Reset OAuth pending state when loading ends (either success or failure)
  useEffect(() => {
    if (isOAuthPending && !loading && error) {
      console.log("[AuthStep] ❌ OAuth failed:", error);
      setIsOAuthPending(false);
      setLocalError(error);
    }
  }, [isOAuthPending, loading, error]);

  // Validate form
  const validateForm = () => {
    if (!email || !email.includes("@")) {
      setLocalError("Please enter a valid email address");
      return false;
    }
    if (!password || password.length < 6) {
      setLocalError("Password must be at least 6 characters");
      return false;
    }
    if (mode === "signup" && password !== confirmPassword) {
      setLocalError("Passwords do not match");
      return false;
    }
    return true;
  };

  // Handle email/password submit
  const handleSubmit = async (e) => {
    e.preventDefault();
    setLocalError(null);
    clearError();

    if (!validateForm()) {
      return;
    }

    const result =
      mode === "signin" ? await signIn(email, password) : await signUp(email, password);

    if (result.success) {
      if (result.requiresConfirmation) {
        setSuccessMessage("Check your email to confirm your account");
      } else {
        onComplete();
      }
    } else {
      setLocalError(result.error);
    }
  };

  // Handle Google OAuth
  const handleGoogleSignIn = async () => {
    setLocalError(null);
    clearError();
    setIsOAuthPending(true);

    const result = await signInWithOAuth("google");

    if (result.success && result.pending) {
      // OAuth flow started - waiting for deep link callback
      // Keep loading state, user will be redirected
    } else if (result.success) {
      onComplete();
    } else {
      setLocalError(result.error);
      setIsOAuthPending(false);
    }
  };

  // Switch between signin and signup
  const toggleMode = () => {
    setMode(mode === "signin" ? "signup" : "signin");
    setLocalError(null);
    setSuccessMessage(null);
    clearError();
  };

  const displayError = localError || error;
  const isLoading = loading || isOAuthPending;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="flex flex-col items-center text-center space-y-6 max-w-md mx-auto py-4"
    >
      {/* Logo and Header */}
      <div className="relative">
        <div className="absolute -inset-4 bg-gradient-to-r from-orange-500 to-purple-600 rounded-full blur-xl opacity-30 animate-pulse" />
        <div className="relative rounded-2xl shadow-2xl overflow-hidden">
          <img src="./assets/icon.png" alt="Centris Logo" className="w-24 h-24 object-contain" />
        </div>
      </div>

      <div className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight">
          <span className="text-gradient">Sentris OS</span>
        </h1>
        <p className="text-muted-foreground text-lg">
          {mode === "signin" ? "Welcome back" : "Create your account"}
        </p>
      </div>

      {/* OAuth Buttons */}
      <div className="w-full space-y-3">
        <button
          onClick={handleGoogleSignIn}
          disabled={isLoading}
          className="w-full px-6 py-3.5 rounded-xl font-medium bg-black/60 border border-white/20 text-white hover:bg-black/80 hover:border-white/30 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 transition-all shadow-lg backdrop-blur-sm"
        >
          {isOAuthPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <GoogleIcon />}
          <span>{isOAuthPending ? "Waiting for browser..." : "Continue with Google"}</span>
        </button>
      </div>

      {/* Divider */}
      <div className="w-full flex items-center gap-4">
        <div className="flex-1 h-px bg-white/10" />
        <span className="text-xs text-muted-foreground uppercase tracking-wider">or</span>
        <div className="flex-1 h-px bg-white/10" />
      </div>

      {/* Email/Password Form */}
      <form onSubmit={handleSubmit} className="w-full space-y-4">
        {/* Email Input */}
        <div className="relative">
          <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email address"
            disabled={isLoading}
            className="w-full pl-12 pr-4 py-3.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/40 focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/50 focus:outline-none disabled:opacity-50 transition-all"
          />
        </div>

        {/* Password Input */}
        <div className="relative">
          <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
          <input
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            disabled={isLoading}
            className="w-full pl-12 pr-12 py-3.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/40 focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/50 focus:outline-none disabled:opacity-50 transition-all"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
          >
            {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
          </button>
        </div>

        {/* Confirm Password (signup only) */}
        <AnimatePresence>
          {mode === "signup" && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="relative overflow-hidden"
            >
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
              <input
                type={showPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm password"
                disabled={isLoading}
                className="w-full pl-12 pr-4 py-3.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/40 focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/50 focus:outline-none disabled:opacity-50 transition-all"
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error Message */}
        <AnimatePresence>
          {displayError && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex items-center gap-2 p-3 rounded-lg bg-red-500/20 border border-red-500/30 text-red-300 text-sm"
            >
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{displayError}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Success Message */}
        <AnimatePresence>
          {successMessage && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex items-center gap-2 p-3 rounded-lg bg-green-500/20 border border-green-500/30 text-green-300 text-sm"
            >
              <CheckCircle className="w-4 h-4 flex-shrink-0" />
              <span>{successMessage}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isLoading}
          className="w-full px-6 py-3.5 rounded-xl font-semibold bg-gradient-to-r from-orange-600 to-orange-700 hover:from-orange-500 hover:to-orange-600 text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-orange-900/30 transition-all"
        >
          {loading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <>
              {mode === "signin" ? "Sign In" : "Create Account"}
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </form>

      {/* Toggle Mode */}
      <p className="text-sm text-muted-foreground">
        {mode === "signin" ? (
          <>
            Don't have an account?{" "}
            <button
              onClick={toggleMode}
              disabled={isLoading}
              className="text-orange-400 hover:text-orange-300 font-medium disabled:opacity-50"
            >
              Sign up
            </button>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <button
              onClick={toggleMode}
              disabled={isLoading}
              className="text-orange-400 hover:text-orange-300 font-medium disabled:opacity-50"
            >
              Sign in
            </button>
          </>
        )}
      </p>

      {/* Skip for now (optional - for development/testing) */}
      {onSkip && (
        <button
          onClick={onSkip}
          disabled={isLoading}
          className="text-xs text-white/30 hover:text-white/50 transition-colors"
        >
          Skip for now (demo mode)
        </button>
      )}
    </motion.div>
  );
}
