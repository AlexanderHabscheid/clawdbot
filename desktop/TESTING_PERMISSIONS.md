# Testing Permissions Locally

This guide shows you how to test microphone and accessibility permissions in development mode.

## Quick Test Checklist

- [ ] App appears in System Preferences
- [ ] Microphone permission can be granted
- [ ] Accessibility permission can be granted
- [ ] Recording works
- [ ] Playback works
- [ ] Text pasting works (accessibility test)

## Step 1: Start the App in Development Mode

```bash
cd /Users/ahabscheid/Downloads/centris-ai/desktop
npm run dev
```

## Step 2: Check System Preferences

### Microphone Permission

1. Open **System Settings** (or System Preferences on older macOS)
2. Go to **Privacy & Security** → **Microphone**
3. Look for **"Electron"** in the list (not "Centris AI" - that's only in production builds)
4. Toggle it **ON** if it's not already enabled

### Accessibility Permission

1. In **System Settings** → **Privacy & Security** → **Accessibility**
2. Look for **"Electron"** in the list
3. Toggle it **ON** if it's not already enabled
4. You may need to click the **lock icon 🔒** to make changes

**Note:** In development, the app shows as "Electron" because Electron is the runtime. In production builds, it will show as "Centris AI".

## Step 3: Test via Onboarding Flow

The onboarding includes built-in permission tests:

1. **Launch the app** - Onboarding should appear automatically
2. **Step 1: Welcome** - Click "Get Started"
3. **Step 2: Permissions & Test**
   - **Grant Microphone**: Click "Grant Access" → System dialog appears → Click "OK"
   - **Grant Accessibility**: Click "Open Settings" → Enable "Electron" → Return to app
4. **Testing Phase**:
   - **Microphone Test**: Click "Record Voice" → Speak → Click "Stop" → Click "Play Back"
   - **Voice Typing Test**: Click "Speak Now" → Speak → Text should appear in the textarea

## Step 4: Test via Browser Console (Advanced)

Open the DevTools console in the Electron app and run:

```javascript
// Check current permission status
const status = await window.electronAPI.getPermissionStatus();
console.log("Permission Status:", status);

// Test microphone (real test - actually accesses mic)
const micTest = await window.electronAPI.testMicrophonePermission();
console.log("Microphone Test:", micTest);

// Test accessibility (real test - uses AppleScript)
const accTest = await window.electronAPI.testAccessibilityPermission();
console.log("Accessibility Test:", accTest);

// Get instructions
const instructions = await window.electronAPI.getPermissionInstructions("microphone");
console.log("Instructions:", instructions);
```

## Step 5: Manual Permission Testing

### Test Microphone Recording

1. Click the microphone button in the app (or use your hotkey)
2. Speak for a few seconds
3. Release the button
4. You should see:
   - Recording indicator (red dot/pulse)
   - Transcription appears
   - Text gets pasted (if in dictation mode)

### Test Accessibility (Text Pasting)

1. Open any text editor (Notes, TextEdit, etc.)
2. Click in a text field
3. Use your hotkey (Fn key or backtick) to activate Centris
4. Speak: "Hello, this is a test"
5. Release the hotkey
6. **Expected**: Your spoken text should appear in the text field

If text doesn't appear:

- Check System Settings → Accessibility → "Electron" is enabled
- Check console for errors
- Try manually pasting: `window.electronAPI.pasteText("test")` in console

## Step 6: Verify Permissions Programmatically

### In Main Process (main.js console)

The app logs permission status. Look for:

```
[PermissionMonitor] Permission status changed: { microphone: '✅', accessibility: '✅' }
```

### In Renderer Process (Browser DevTools)

```javascript
// Check permissions
const checkPermissions = async () => {
  const mic = await window.electronAPI.checkMicrophonePermission();
  const acc = await window.electronAPI.checkAccessibilityPermission();

  console.log("Microphone:", mic.granted ? "✅ Granted" : "❌ Denied");
  console.log("Accessibility:", acc.granted ? "✅ Granted" : "❌ Denied");

  return { mic, acc };
};

checkPermissions();
```

## Step 7: Test Permission Revocation

To test how the app handles permission revocation:

1. **Revoke Microphone**:
   - System Settings → Privacy & Security → Microphone
   - Turn OFF "Electron"
   - Try recording - should show error

2. **Revoke Accessibility**:
   - System Settings → Privacy & Security → Accessibility
   - Turn OFF "Electron"
   - Try pasting text - should fail gracefully

3. **Re-grant Permissions**:
   - Turn them back ON
   - App should detect and resume working

## Common Issues & Solutions

### Issue: "Electron" doesn't appear in System Settings

**Solution:**

- The app needs to request permission first
- Try clicking "Grant Access" in onboarding
- Or run: `navigator.mediaDevices.getUserMedia({ audio: true })` in console

### Issue: Microphone test fails

**Check:**

1. System Settings → Microphone → "Electron" is ON
2. No other app is using the microphone
3. Microphone hardware is working (test in another app)
4. Console for errors: `[AudioManager]` or `[PermissionMonitor]`

### Issue: Accessibility test fails (text doesn't paste)

**Check:**

1. System Settings → Accessibility → "Electron" is ON
2. You may need to restart the app after granting
3. Try the manual test: `window.electronAPI.pasteText("test")` in console
4. Check console for: `[ClipboardManager]` errors

### Issue: Permission status shows granted but doesn't work

**Solution:**

- In dev mode, `osascript` may inherit Terminal permissions (false positive)
- Use the real tests: `testMicrophonePermission()` and `testAccessibilityPermission()`
- These actually try to use the permissions, not just check status

## Testing Checklist

Run through this checklist to verify everything works:

```
✅ App launches without errors
✅ Onboarding appears on first launch
✅ Microphone permission dialog appears when requested
✅ "Electron" appears in System Settings → Microphone
✅ "Electron" appears in System Settings → Accessibility
✅ Microphone test: Recording works
✅ Microphone test: Playback works
✅ Accessibility test: Voice typing works (text appears)
✅ Hotkey activates recording
✅ Text gets pasted into other apps
✅ Permission revocation is detected
✅ Permission re-granting works
```

## Production vs Development

| Feature              | Development | Production   |
| -------------------- | ----------- | ------------ |
| App Name in Settings | "Electron"  | "Centris AI" |
| Code Signing         | Optional    | Required     |
| Permission Prompts   | Same        | Same         |
| Testing              | Same        | Same         |

The permission behavior is identical - only the app name changes!

## Quick Test Script

Save this as `test-permissions.js` and run with `node test-permissions.js`:

```javascript
// Quick permission test script
const { systemPreferences } = require("electron");
const { spawn } = require("child_process");

async function testPermissions() {
  console.log("🔍 Testing Permissions...\n");

  // Test Microphone
  try {
    const micStatus = systemPreferences.getMediaAccessStatus("microphone");
    console.log(`🎤 Microphone: ${micStatus === "granted" ? "✅ Granted" : "❌ " + micStatus}`);
  } catch (e) {
    console.log("🎤 Microphone: ❌ Error -", e.message);
  }

  // Test Accessibility
  return new Promise((resolve) => {
    const test = spawn("osascript", [
      "-e",
      'tell application "System Events" to get name of first process',
    ]);

    test.on("close", (code) => {
      const granted = code === 0;
      console.log(`🔐 Accessibility: ${granted ? "✅ Granted" : "❌ Denied"}`);
      console.log("\n💡 Note: In dev mode, this may inherit Terminal permissions");
      resolve();
    });

    test.on("error", () => {
      console.log("🔐 Accessibility: ❌ Error");
      resolve();
    });
  });
}

testPermissions();
```

## Next Steps

Once permissions are working locally:

1. Test the full user flow (onboarding → recording → pasting)
2. Test with different hotkeys
3. Test permission revocation/re-granting
4. Build production version: `npm run build`
5. Test production build (will show as "Centris AI")
