import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { ToastProvider } from "./components/ui/Toast.tsx";
import { AuthProvider } from "./contexts/AuthContext.jsx";
import "./index.css";

// Error Boundary Component
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Log error for debugging (only in development)
    if (process.env.NODE_ENV === "development") {
      console.error("Error caught by boundary:", error, errorInfo);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: "40px",
            fontFamily: "system-ui",
            textAlign: "center",
            background: "#000",
            color: "#fff",
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div>
            <h1 style={{ color: "#ff6b35", marginBottom: "20px" }}>⚠️ Application Error</h1>
            <p style={{ fontSize: "18px", marginBottom: "10px" }}>
              Something went wrong. Please restart the application.
            </p>
            {process.env.NODE_ENV === "development" && this.state.error && (
              <details style={{ marginTop: "20px", textAlign: "left", maxWidth: "600px" }}>
                <summary style={{ cursor: "pointer", color: "#888" }}>Error Details</summary>
                <pre
                  style={{
                    background: "#1a1a1a",
                    padding: "10px",
                    borderRadius: "4px",
                    overflow: "auto",
                    fontSize: "12px",
                  }}
                >
                  {this.state.error.toString()}
                  {this.state.error.stack}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Function to initialize React app
const initializeReact = () => {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("🔵 [main.jsx] initializeReact() CALLED");
  console.log("═══════════════════════════════════════════════════════════");
  try {
    console.log("[main.jsx] 🔄 Starting React app initialization...");
    const rootElement = document.getElementById("root");
    if (!rootElement) {
      console.error("[main.jsx] ❌ Root element not found!");
      throw new Error("Root element not found!");
    }
    console.log("[main.jsx] ✅ Root element found:", rootElement);
    console.log("[main.jsx] 🔄 Creating React root...");

    const root = ReactDOM.createRoot(rootElement);
    console.log("[main.jsx] ✅ React root created");
    console.log("[main.jsx] 🔄 Rendering app...");

    root.render(
      <React.StrictMode>
        <ErrorBoundary>
          <AuthProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </AuthProvider>
        </ErrorBoundary>
      </React.StrictMode>,
    );

    console.log("[main.jsx] ✅ React app rendered successfully!");
    console.log("[main.jsx] 📍 Current URL:", window.location.href);
    console.log("[main.jsx] 📍 electronAPI available:", !!window.electronAPI);
    console.log("═══════════════════════════════════════════════════════════");
  } catch (error) {
    console.error("═══════════════════════════════════════════════════════════");
    console.error("[main.jsx] ❌ ERROR loading app!");
    console.error("[main.jsx] Error message:", error.message);
    console.error("[main.jsx] Error stack:", error.stack);
    console.error("═══════════════════════════════════════════════════════════");
    document.body.innerHTML = `
      <div style="padding: 20px; font-family: system-ui; color: red; background: #000; min-height: 100vh; display: flex; align-items: center; justify-content: center;">
        <div>
          <h1>Error Loading App</h1>
          <p>${error.message}</p>
          <pre style="margin-top: 20px; font-size: 12px; color: #888;">${error.stack}</pre>
        </div>
      </div>
    `;
  }
};

// Ensure we're running in Electron
console.log("═══════════════════════════════════════════════════════════");
console.log("🔵 [main.jsx] Script loaded");
console.log("═══════════════════════════════════════════════════════════");
console.log("[main.jsx] 📍 Current URL:", window.location.href);
console.log("[main.jsx] 📍 electronAPI available:", !!window.electronAPI);
console.log("[main.jsx] 📍 document.readyState:", document.readyState);

// CRITICAL: Don't block rendering if electronAPI isn't immediately available
// It might load after the preload script executes
if (typeof window !== "undefined" && !window.electronAPI) {
  console.warn("[main.jsx] ⚠️ electronAPI not available yet, waiting for preload...");
  // Wait a bit for preload to execute (preload runs before this script)
  let attempts = 0;
  const checkElectronAPI = setInterval(() => {
    attempts++;
    if (window.electronAPI) {
      console.log(`[main.jsx] ✅ electronAPI now available (after ${attempts * 100}ms)`);
      clearInterval(checkElectronAPI);
      initializeReact();
    } else if (attempts > 50) {
      // After 5 seconds, show error but still try to render
      console.error("[main.jsx] ❌ electronAPI still not available after 5 seconds");
      console.error("[main.jsx] ⚠️ Rendering anyway - some features may not work");
      clearInterval(checkElectronAPI);
      // Still try to render - some features might work
      initializeReact();
    } else if (attempts % 10 === 0) {
      // Log every second
      console.log(`[main.jsx] ⏳ Still waiting for electronAPI... (${attempts * 100}ms)`);
    }
  }, 100);
} else {
  // electronAPI is available, initialize immediately
  console.log("[main.jsx] ✅ electronAPI available immediately, initializing React...");
  initializeReact();
}
