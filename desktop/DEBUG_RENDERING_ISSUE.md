# Debug: Onboarding and Main App Not Rendering

## Problem

Both onboarding and main Centris Electron app are not working and rendering.

## Root Causes Identified

### 1. **Development Mode Issue**

- App tries to load from `http://localhost:5174/`
- Vite dev server must be running on port 5174
- If dev server isn't running, window loads blank/white screen

### 2. **Production Mode Issue**

- App tries to load from `file://.../src/dist/index.html`
- Build output doesn't exist (`src/dist/` folder missing)
- Need to run `npm run build:renderer` first

### 3. **Window Creation Flow**

- `createMainWindow()` checks onboarding status
- If onboarding needed → creates onboarding window
- If onboarding complete → creates hidden main window + pill UI window
- Both need valid URL to load

## Solutions

### For Development:

```bash
# Terminal 1: Start Vite dev server
cd desktop
npm run dev:renderer

# Terminal 2: Start Electron
npm run dev:main
# OR use the combined command:
npm run dev
```

### For Production:

```bash
# Build the renderer first
cd desktop
npm run build:renderer

# Then start Electron
npm start
```

## Debugging Steps

1. **Check if dev server is running:**

   ```bash
   lsof -i :5174
   # OR
   curl http://localhost:5174
   ```

2. **Check if build exists:**

   ```bash
   ls -la src/dist/
   ```

3. **Check Electron console for errors:**
   - Open DevTools: Cmd+Option+I (macOS) or Ctrl+Shift+I
   - Look for network errors or failed URL loads

4. **Check main process logs:**
   - Look for "App URL:" log messages
   - Check for "Dev server ready" or "Dev server failed to start"

## Quick Fix

If you're in development and the window is blank:

1. **Start the dev server:**

   ```bash
   cd desktop/src
   npm run dev:renderer
   # OR from desktop root:
   cd desktop
   npm run dev:renderer
   ```

2. **Restart Electron:**

   ```bash
   npm run dev:main
   ```

3. **Or use the combined dev command:**
   ```bash
   npm run dev
   ```

## Expected Behavior

### Development:

- Window should load `http://localhost:5174/`
- React app should render
- Onboarding should show if `hasCompletedOnboarding` is false
- Pill UI should show if onboarding is complete

### Production:

- Window should load `file://.../src/dist/index.html`
- Same rendering behavior as development

## Common Issues

1. **Port 5174 already in use:**
   - Kill the process: `lsof -ti:5174 | xargs kill`
   - Or change port in `vite.config.mjs`

2. **Build output missing:**
   - Run `npm run build:renderer`
   - Check `src/dist/index.html` exists

3. **Window shows but is blank:**
   - Check DevTools console for errors
   - Check network tab for failed requests
   - Verify URL is correct in main process logs
