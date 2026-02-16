# Quick Fix: App Not Rendering

## The Problem

Your Electron app windows (onboarding and main app) are not rendering because **the Vite dev server is not running**.

## The Solution

### Option 1: Use the Combined Dev Command (Recommended)

```bash
cd /Users/ahabscheid/Downloads/centris-ai/desktop
npm run dev
```

This starts both the Vite dev server AND Electron automatically.

### Option 2: Run Separately (If Option 1 Doesn't Work)

**Terminal 1 - Start Vite Dev Server:**

```bash
cd /Users/ahabscheid/Downloads/centris-ai/desktop
npm run dev:renderer
```

Wait until you see: `➜  Local:   http://localhost:5174/`

**Terminal 2 - Start Electron:**

```bash
cd /Users/ahabscheid/Downloads/centris-ai/desktop
npm run dev:main
```

## How It Works

- **Development Mode**: App loads from `http://localhost:5174/` (Vite dev server)
- **Production Mode**: App loads from `file://.../src/dist/index.html` (built files)

## Verification

After starting, you should see:

1. ✅ Vite dev server running on port 5174
2. ✅ Electron window opens
3. ✅ Onboarding shows (if first launch) OR pill UI shows (if onboarding complete)

## If Still Not Working

1. **Check if port 5174 is in use:**

   ```bash
   lsof -i :5174
   ```

   If something is using it, kill it: `kill -9 <PID>`

2. **Check Electron console for errors:**
   - Press `Cmd+Option+I` (macOS) to open DevTools
   - Look for network errors or failed URL loads

3. **Check main process logs:**
   - Look for "App URL:" messages
   - Should see "✅ Dev server is ready"

4. **Clear caches and restart:**
   ```bash
   npm run clear-caches
   npm run dev
   ```

## For Production Builds

If you want to test production mode:

```bash
npm run build:renderer  # Build the React app
npm start              # Start Electron with built files
```
