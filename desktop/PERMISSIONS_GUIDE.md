# Centris AI Permissions Guide

## Overview

Centris AI requires two macOS permissions to function properly:

1. **Microphone Access** - For voice recording and transcription
2. **Accessibility Access** - For keyboard shortcuts (Globe/Fn key) and text insertion

## ⭐ Recommended Development Workflow

### Use `npm run dev:app` for Proper Permissions

Instead of `npm run dev` (which inherits permissions from your terminal/IDE), use:

```bash
# Build and run the .app bundle with proper permissions
npm run dev:app

# Or with auto-rebuild on file changes
npm run dev:app:watch
```

This builds the actual `.app` bundle and runs it directly, giving Centris AI its own permissions entry in System Settings.

| Command                 | Description                 | Permissions                       |
| ----------------------- | --------------------------- | --------------------------------- |
| `npm run dev`           | Fast hot-reload development | Inherited from Terminal/Cursor ❌ |
| `npm run dev:app`       | Build and run .app bundle   | Proper "Centris AI" ✅            |
| `npm run dev:app:watch` | Auto-rebuild on changes     | Proper "Centris AI" ✅            |
| `npm run build`         | Full production build       | Proper "Centris AI" ✅            |

### First Time Setup

1. Run `npm run dev:app`
2. Open **System Settings > Privacy & Security > Microphone**
3. Enable **"Centris AI"** (it will now appear in the list!)
4. Open **System Settings > Privacy & Security > Accessibility**
5. Enable **"Centris AI"**
6. Restart the app

---

## Understanding Development vs Production Permissions

### 🚨 Why `npm run dev` Has Permission Issues

When running `npm run dev` (i.e., `electron .`), macOS associates permissions with the **parent process** that launched the app, NOT with "Centris AI" itself.

This means:

- If you launch from **Cursor IDE**, permissions appear under "Cursor"
- If you launch from **Terminal.app**, permissions appear under "Terminal"
- If you launch from **iTerm**, permissions appear under "iTerm"

**This is expected macOS behavior** - the TCC database tracks permissions by bundle identifier, and the Electron binary doesn't have its own bundle ID when run directly.

### ✅ Why `npm run dev:app` Works

The `dev:app` script:

1. Builds the renderer (Vite)
2. Packages the app into a `.app` bundle using `electron-builder --dir`
3. Runs the `.app` directly with `open -a`

Because it's a proper `.app` bundle with:

- Bundle identifier: `com.centris.app`
- Proper `Info.plist` with usage descriptions
- macOS recognizes it as "Centris AI"

### ✅ Production Mode Behavior

When the app is built and installed (`npm run build` → install DMG), permissions correctly appear as "Centris AI" because:

- The app has a proper bundle identifier (`com.centris.app`)
- The app is code-signed with entitlements
- macOS TCC database tracks the app by its bundle ID

## Legacy: Granting Permissions in `npm run dev` Mode

### Step 1: Identify Your Launch App

Check which app launched Centris AI:

- **Cursor IDE**: Look for "Cursor" in permission lists
- **VS Code Terminal**: Look for "Code" or "Terminal"
- **iTerm2**: Look for "iTerm"
- **Terminal.app**: Look for "Terminal"

### Step 2: Grant Microphone Permission

1. Open **System Settings** (or System Preferences on older macOS)
2. Go to **Privacy & Security** → **Microphone**
3. Find your launch app (e.g., "Cursor", "Terminal")
4. Toggle the switch to **ON**
5. Restart Centris AI

### Step 3: Grant Accessibility Permission

1. Open **System Settings** → **Privacy & Security** → **Accessibility**
2. Click the **lock icon** 🔒 and enter your password
3. Find your launch app (e.g., "Cursor", "Terminal", or "Electron")
4. Check the box to enable
5. Restart Centris AI

## Testing Permissions

Centris AI includes built-in permission testing. Use these in the app or console:

```javascript
// In browser console (DevTools)

// Check permission status
await window.electronAPI.getPermissionStatus();

// Get app identity info
await window.electronAPI.getAppIdentity();

// Run full audio test
await window.electronAPI.runFullAudioTest();

// Test microphone recording (2 second test)
await window.electronAPI.testMicrophoneRecording(2);

// Test audio playback
await window.electronAPI.testAudioPlayback();

// Get troubleshooting instructions
await window.electronAPI.getPermissionTroubleshooting();
```

## Troubleshooting

### "Microphone permission denied" in dev mode

1. Check which app you used to launch (Cursor, Terminal, etc.)
2. Grant microphone permission to THAT app
3. Restart Centris AI

### "Accessibility not working" in dev mode

1. Grant accessibility to your terminal/IDE app
2. Also try granting to "Electron" if it appears in the list
3. **Important**: You may need to REMOVE and RE-ADD the app to the accessibility list
4. Restart Centris AI

### Recording test fails but permission shows "granted"

This can happen when:

1. Permission status is cached - restart the app
2. The permission was granted to a different app
3. Audio recording tools are missing (install with `brew install sox ffmpeg`)

### Globe/Fn key doesn't trigger recording

1. Verify accessibility permission is granted
2. Check that the hotkey is set to "GLOBE" in preferences
3. Try pressing and HOLDING the Fn/Globe key
4. Restart Centris AI after granting accessibility

## Building for Proper Permissions

To test with proper "Centris AI" permissions:

```bash
# Build the app
npm run build

# The built app will be in dist/
# Install from: dist/Centris AI-*.dmg
```

After installation:

1. Open the installed "Centris AI.app" (from Applications)
2. It will request permissions as "Centris AI"
3. Grant permissions normally

## Permission Entitlements

The built app includes these entitlements (see `build/entitlements.mac.plist`):

```xml
<!-- Microphone access -->
<key>com.apple.security.device.audio-input</key>
<true/>

<!-- Apple Events for accessibility -->
<key>com.apple.security.automation.apple-events</key>
<true/>

<!-- Network access for backend -->
<key>com.apple.security.network.client</key>
<true/>
```

## Required Audio Tools

For full microphone testing functionality, install:

```bash
brew install sox ffmpeg
```

These are used for:

- `sox` / `rec`: Audio recording tests
- `ffmpeg`: Fallback recording and device listing
- `afplay`: Audio playback (built into macOS)

## API Reference

### Permission APIs (preload.js)

| API                                | Description                           |
| ---------------------------------- | ------------------------------------- |
| `checkMicrophonePermission()`      | Check microphone permission status    |
| `requestMicrophonePermission()`    | Request microphone permission         |
| `checkAccessibilityPermission()`   | Check accessibility permission status |
| `requestAccessibilityPermission()` | Open accessibility settings           |
| `getPermissionStatus()`            | Get all permission statuses           |
| `forcePermissionCheck()`           | Force recheck of all permissions      |
| `testMicrophonePermission()`       | Test microphone with Electron API     |
| `testAccessibilityPermission()`    | Test accessibility with osascript     |

### Audio Testing APIs (preload.js)

| API                                 | Description                      |
| ----------------------------------- | -------------------------------- |
| `getAudioInputDevices()`            | List available microphones       |
| `testMicrophoneRecording(duration)` | Record audio for X seconds       |
| `testAudioPlayback()`               | Play back test recording         |
| `playSystemSound()`                 | Play a system sound              |
| `runFullAudioTest()`                | Run comprehensive audio test     |
| `getPermissionTroubleshooting()`    | Get troubleshooting instructions |
| `getAppIdentity()`                  | Get app identity info            |

## File Locations

- **Permission Service**: `src/services/permissionService.js`
- **Audio Test Service**: `src/services/audioTestService.js`
- **Permission Monitor**: `src/helpers/permissionMonitor.js`
- **IPC Handlers**: `src/helpers/ipcHandlers.js`
- **Entitlements**: `build/entitlements.mac.plist`
