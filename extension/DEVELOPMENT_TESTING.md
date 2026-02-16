# Native Messaging Development Testing Guide

## Overview

This guide explains how to test Native Messaging in development mode before deploying to production.

## How It Works in Development

### Automatic Installation (Electron App)

When you run the Electron app in development mode:

1. **App detects development mode** → Uses `extension/native-host/centris_host.py` directly
2. **Automatically installs** → Copies host script and creates manifests
3. **Uses placeholder extension ID** → Updates when extension connects

**Path detection:**

- **Development**: `desktop/../extension/native-host/centris_host.py`
- **Production**: `process.resourcesPath/native-host/centris_host.py`

### Manual Installation (For Testing)

You can also manually install using the provided script:

```bash
cd extension
./install_native_host.sh
```

## Step-by-Step Testing Process

### Step 1: Start the Backend

```bash
# Terminal 1: Start backend
cd backend
python -m backend.main
```

**Expected output:**

```
[ExtensionBridge] Starting WebSocket server on ws://localhost:8765
[ExtensionBridge] WebSocket server started
```

### Step 2: Start the Electron Desktop App

```bash
# Terminal 2: Start desktop app
cd desktop
npm run dev
```

**Check logs for:**

```
[NativeMessagingInstaller] Starting native host installation...
[NativeMessagingInstaller] ✓ Host script installed to: /usr/local/bin/centris_host.py
[NativeMessagingInstaller] ✓ Native host installed successfully
```

**If you see permission errors:**

```
[NativeMessagingInstaller] Cannot write to /usr/local/bin (requires sudo)
[NativeMessagingInstaller] Using user directory instead...
[NativeMessagingInstaller] ✓ Host script installed to user directory: ~/Library/Application Support/Centris/centris_host.py
```

This is fine! The app will use the user directory.

### Step 3: Load the Extension in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `extension` directory
5. **Copy the Extension ID** (you'll need this)

**Extension ID location:**

- It's shown under the extension name
- Format: `abcdefghijklmnopqrstuvwxyz123456`

### Step 4: Update Extension ID in Manifest (If Needed)

If the installer used a placeholder, update it:

**macOS:**

```bash
# Edit the manifest
nano ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.centris.host.json
```

Replace `EXTENSION_ID_PLACEHOLDER` with your actual extension ID:

```json
{
  "name": "com.centris.host",
  "description": "Centris AI Native Messaging Host",
  "path": "/usr/local/bin/centris_host.py",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://YOUR_ACTUAL_EXTENSION_ID_HERE/"]
}
```

**Or use the manual installer:**

```bash
cd extension
./install_native_host.sh
# When prompted, paste your extension ID
```

### Step 5: Reload the Extension

1. Go to `chrome://extensions/`
2. Click the reload button on your extension
3. Open Chrome DevTools (F12) → Console tab
4. Look for connection logs

### Step 6: Check Connection Logs

**In Chrome Console (Extension logs):**

**Success (Native Messaging):**

```
[Sentris Extension] 🔌 Attempting Native Messaging connection...
[Sentris Extension] ✅ Native Messaging handshake sent
[Sentris Extension] ✅ Native host ready
[Sentris Extension] ✅ Native Messaging handshake acknowledged
```

**Fallback (WebSocket):**

```
[Sentris Extension] 🔌 Attempting Native Messaging connection...
[Sentris Extension] ⚠️ Native Messaging disconnected
[Sentris Extension] 📡 Falling back to WebSocket connection
[Sentris Extension] ✅ WebSocket connection OPENED
```

**If you see errors:**

```
[Sentris Extension] ❌ Native Messaging connection failed immediately
{
  error: "Specified native messaging host not found",
  diagnosis: {
    issue: "Native host manifest not installed",
    solution: "Run install_native_host.sh to install the manifest"
  }
}
```

### Step 7: Verify Native Messaging is Working

**Check extension logs for:**

- `✅ Native Messaging handshake sent` (not WebSocket)
- `✅ Native host ready`
- Communication method should be `native_messaging` (not `websocket`)

**Test a command:**

- Open the extension popup
- Try a browser control command
- Check logs - should show `📤 Sent via Native Messaging` (not WebSocket)

## Troubleshooting Development Issues

### Issue 1: "Native host not found"

**Cause:** Manifest not installed or wrong path

**Fix:**

```bash
# Check if manifest exists
ls -la ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.centris.host.json

# If missing, run installer
cd extension
./install_native_host.sh
```

### Issue 2: "Extension ID mismatch"

**Cause:** Manifest has wrong extension ID

**Fix:**

1. Get extension ID from `chrome://extensions/`
2. Update manifest:
   ```bash
   nano ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.centris.host.json
   ```
3. Replace extension ID in `allowed_origins`
4. Reload extension

### Issue 3: "Host script not executable"

**Cause:** Permissions issue

**Fix:**

```bash
# Check permissions
ls -l /usr/local/bin/centris_host.py

# Fix if needed
chmod +x /usr/local/bin/centris_host.py

# Or if in user directory
chmod +x ~/Library/Application\ Support/Centris/centris_host.py
```

### Issue 4: "Python3 not found"

**Cause:** Python not in PATH

**Fix:**

```bash
# Check Python
which python3
python3 --version

# If missing, install Python 3
# macOS: brew install python3
# Or download from python.org
```

### Issue 5: Desktop app can't find host script in development

**Cause:** Path resolution issue

**Fix:** Check that `extension/native-host/centris_host.py` exists:

```bash
ls -la extension/native-host/centris_host.py
```

If missing, the app will log:

```
[NativeMessagingInstaller] Bundled host not found at: ...
```

## Quick Test Script

Create a test script to verify everything is set up:

```bash
#!/bin/bash
# test_native_messaging.sh

echo "=== Native Messaging Development Test ==="
echo

# Check host script
if [ -f "extension/native-host/centris_host.py" ]; then
    echo "✓ Host script exists in extension directory"
else
    echo "✗ Host script missing: extension/native-host/centris_host.py"
fi

# Check if installed
if [ -f "/usr/local/bin/centris_host.py" ]; then
    echo "✓ Host script installed to /usr/local/bin"
elif [ -f "$HOME/Library/Application Support/Centris/centris_host.py" ]; then
    echo "✓ Host script installed to user directory"
else
    echo "⚠ Host script not installed (will be installed by Electron app)"
fi

# Check manifest
MANIFEST="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.centris.host.json"
if [ -f "$MANIFEST" ]; then
    echo "✓ Manifest exists"

    # Check for placeholder
    if grep -q "EXTENSION_ID_PLACEHOLDER" "$MANIFEST"; then
        echo "⚠ Manifest has placeholder ID (will auto-update when extension connects)"
    else
        echo "✓ Manifest has extension ID configured"
    fi
else
    echo "✗ Manifest missing (will be created by Electron app)"
fi

# Check Python
if command -v python3 &> /dev/null; then
    echo "✓ Python3 available: $(python3 --version)"
else
    echo "✗ Python3 not found"
fi

echo
echo "=== Test Complete ==="
```

## Development Workflow

### First Time Setup

1. **Start backend** → `python -m backend.main`
2. **Start desktop app** → `npm run dev` (installs Native Messaging automatically)
3. **Load extension** → Chrome → Load unpacked → Select `extension` folder
4. **Get extension ID** → Copy from `chrome://extensions/`
5. **Update manifest** → Run `./install_native_host.sh` with your extension ID
6. **Reload extension** → Should connect via Native Messaging

### Daily Development

1. **Start backend** → `python -m backend.main`
2. **Start desktop app** → `npm run dev`
3. **Reload extension** → Should auto-connect (Native Messaging if installed, WebSocket otherwise)

### Testing Changes

1. **Modify extension code** → Reload extension in Chrome
2. **Modify backend code** → Restart backend
3. **Modify desktop app** → Restart Electron app
4. **Modify host script** → Reinstall: `./install_native_host.sh`

## Verifying Native Messaging vs WebSocket

**Check extension console logs:**

**Native Messaging (fast):**

```
✅ Using Native Messaging (fastest mode)
📤 Sent via Native Messaging
📥 Native message received
```

**WebSocket (fallback):**

```
📡 Falling back to WebSocket connection
📤 Sent via WebSocket
```

**Check connection status:**

- Open extension popup
- Look for connection status indicator
- Should show "Native Messaging" if working

## Common Development Scenarios

### Scenario 1: Testing with Placeholder ID

1. Desktop app installs with placeholder
2. Extension connects via WebSocket (because ID doesn't match)
3. Backend saves extension ID
4. Desktop app detects ID and updates manifests
5. Extension reloads → Now uses Native Messaging

**Timeline:** ~30 seconds for auto-update

### Scenario 2: Manual Installation

1. Run `./install_native_host.sh` with extension ID
2. Extension connects immediately via Native Messaging
3. No waiting for auto-update

**Timeline:** Immediate

### Scenario 3: Permission Issues

1. Desktop app tries `/usr/local/bin` → Fails (needs sudo)
2. Falls back to user directory
3. Creates manifest with user directory path
4. Extension connects via Native Messaging

**Timeline:** Automatic, no user action needed

## Debugging Tips

### Enable Verbose Logging

**Extension:**

- Already logs everything to console
- Open Chrome DevTools → Console
- Filter by "Sentris Extension"

**Desktop App:**

- Check terminal where you ran `npm run dev`
- Look for `[NativeMessagingInstaller]` logs

**Backend:**

- Check terminal where you ran backend
- Look for `[ExtensionBridge]` logs

### Test Host Script Manually

```bash
# Test if host script works
/usr/local/bin/centris_host.py

# Should start and wait for input (will appear to hang - this is normal)
# Press Ctrl+C to exit
```

### Check Manifest Contents

```bash
# View manifest
cat ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.centris.host.json

# Should show:
# - Correct path to host script
# - Correct extension ID (or placeholder)
```

## Next Steps

Once testing is successful:

1. ✅ Native Messaging works in development
2. ✅ Extension ID auto-updates work
3. ✅ Fallback to WebSocket works
4. ✅ Ready for production deployment

The same automatic installation will work in production - users won't need to do anything!
