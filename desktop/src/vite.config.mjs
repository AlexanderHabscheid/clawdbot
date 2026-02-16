import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "./", // Use relative paths for file:// protocol in Electron
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  server: {
    port: 5174,
    open: false, // Don't open browser - Electron will handle window creation
    strictPort: true, // Fail if port is already in use
  },
  build: {
    outDir: "dist",
    assetsDir: "assets",
    rollupOptions: {
      external: [
        "electron",
        "fs",
        "path",
        "child_process",
        "https",
        "http",
        "crypto",
        "os",
        "stream",
        "util",
        "zlib",
        "tar",
        "unzipper",
        "@aws-sdk/client-s3",
      ],
    },
  },
});
