# Native Messaging Troubleshooting Guide

## Overview

If you see logs indicating that Native Messaging connection failed and the extension falls back to WebSocket, this guide will help you diagnose and fix the issue.

## Common Error Patterns

### 1. "Native Messaging disconnected" immediately after connection attempt

This indicates the native host manifest is either:

- Not installed
- Incorrectly configured
- The host script cannot be executed

### 2. "Native port became null during setup"

This means Chrome couldn't start the native host process, usually because:

- Host script path is incorrect
- Host script is not executable
- Python3 is not available
- Host script has syntax errors

## Diagnostic Checklist

### Step 1: Check if Native Host Manifest is Installed

**macOS:**

```bash
ls -la ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.centris.host.json
```

**Expected:** File should exist and be readable

**If missing:** Run the installer:

```bash
cd extension
./install_native_host.sh
```

### Step 2: Verify Manifest Contents

Check the manifest file:

```bash
cat ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.centris.host.json
```

**Required fields:**

- `name`: Must be `"com.centris.host"`
- `path`: Must point to `/usr/local/bin/centris_host.py` (or correct path)
- `allowed_origins`: Must include your extension ID (not `EXTENSION_ID_PLACEHOLDER`)

**Example correct manifest:**

```json
{
  "name": "com.centris.host",
  "description": "Centris AI Native Messaging Host",
  "path": "/usr/local/bin/centris_host.py",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://abcdefghijklmnopqrstuvwxyz123456/"]
}
```

### Step 3: Check Extension ID Match

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode"
3. Find your extension and copy its ID
4. Verify it matches the ID in the manifest file

**If mismatch:** Update the manifest:

```bash
# Edit the manifest
nano ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.centris.host.json

# Replace EXTENSION_ID_PLACEHOLDER with your actual extension ID
```

### Step 4: Verify Host Script Exists and is Executable

```bash
ls -l /usr/local/bin/centris_host.py
```

**Expected output:**

```
-rwxr-xr-x  1 root  wheel  <size> <date> /usr/local/bin/centris_host.py
```

**If missing:** Copy it:

```bash
sudo cp extension/native-host/centris_host.py /usr/local/bin/
sudo chmod +x /usr/local/bin/centris_host.py
```

**If not executable:** Fix permissions:

```bash
sudo chmod +x /usr/local/bin/centris_host.py
```

### Step 5: Test Python3 Availability

The host script requires Python 3:

```bash
which python3
python3 --version
```

**Expected:** Should show Python 3.x path and version

**If missing:** Install Python 3:

```bash
# macOS (using Homebrew)
brew install python3

# Or download from python.org
```

### Step 6: Test Host Script Manually

Try running the host script directly:

```bash
/usr/local/bin/centris_host.py
```

**Expected:** Script should start and wait for input (will appear to hang, which is normal)

**If error:** Check for syntax errors:

```bash
python3 -m py_compile /usr/local/bin/centris_host.py
```

### Step 7: Check Chrome Console for Detailed Errors

1. Open Chrome DevTools (F12)
2. Go to Console tab
3. Look for error messages from the extension
4. Check for `chrome.runtime.lastError` messages

Common Chrome error messages:

- `"Specified native messaging host not found"` → Manifest not installed or wrong name
- `"Access to the specified native messaging host is forbidden"` → Extension ID mismatch
- `"Failed to start native messaging host"` → Script path incorrect or not executable
- `"Native host has exited"` → Script crashed (check Python errors)

### Step 8: Check System Logs (macOS)

Native host errors may appear in system logs:

```bash
# Check Console.app or use log command
log show --predicate 'process == "centris_host.py"' --last 5m
```

## Quick Fix Script

Run this diagnostic script to check all requirements:

```bash
#!/bin/bash
echo "=== Native Messaging Diagnostic ==="
echo

# Check manifest
MANIFEST="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.centris.host.json"
if [ -f "$MANIFEST" ]; then
    echo "✓ Manifest exists"
    cat "$MANIFEST" | grep -q "EXTENSION_ID_PLACEHOLDER" && echo "⚠ Extension ID is placeholder!" || echo "✓ Extension ID configured"
else
    echo "✗ Manifest missing"
fi

# Check host script
if [ -f "/usr/local/bin/centris_host.py" ]; then
    echo "✓ Host script exists"
    [ -x "/usr/local/bin/centris_host.py" ] && echo "✓ Host script is executable" || echo "✗ Host script not executable"
else
    echo "✗ Host script missing"
fi

# Check Python
if command -v python3 &> /dev/null; then
    echo "✓ Python3 available: $(python3 --version)"
else
    echo "✗ Python3 not found"
fi

# Check script syntax
if python3 -m py_compile /usr/local/bin/centris_host.py 2>/dev/null; then
    echo "✓ Host script syntax valid"
else
    echo "✗ Host script has syntax errors"
fi
```

## Common Solutions

### Solution 1: Reinstall Native Host

```bash
cd extension
./install_native_host.sh
```

When prompted, enter your extension ID from `chrome://extensions/`

### Solution 2: Fix Extension ID

1. Get your extension ID from `chrome://extensions/`
2. Edit the manifest:
   ```bash
   nano ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.centris.host.json
   ```
3. Replace `EXTENSION_ID_PLACEHOLDER` with your actual extension ID
4. Reload the extension in Chrome

### Solution 3: Fix Host Script Permissions

```bash
sudo chmod +x /usr/local/bin/centris_host.py
```

### Solution 4: Verify Python3 Shebang

The host script uses `#!/usr/bin/env python3`. Verify this works:

```bash
/usr/bin/env python3 --version
```

If this fails, you may need to update the shebang in the script to use a full path.

## Browser-Specific Notes

### Chrome

Manifest location: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`

### Chromium

Manifest location: `~/Library/Application Support/Chromium/NativeMessagingHosts/`

### Brave

Manifest location: `~/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/`

**Note:** The installer script installs manifests for all browsers automatically.

## Still Not Working?

If Native Messaging still fails after checking all items:

1. **Check extension logs** - Look at the detailed error messages in Chrome console
2. **Test host script manually** - Run it directly to see if it starts
3. **Check system logs** - Look for Python errors or permission issues
4. **Verify Chrome version** - Native Messaging requires Chrome 26+ (should be fine on modern Chrome)

The extension will automatically fall back to WebSocket, so functionality should still work, just with slightly higher latency.

## Expected Behavior When Working

When Native Messaging is working correctly, you should see:

```
✅ Native Messaging handshake sent
✅ Native host ready
✅ Native Messaging handshake acknowledged
```

Instead of:

```
⚠️ Native Messaging disconnected
📡 Falling back to WebSocket connection
```
