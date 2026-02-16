# Quick Start: Testing Native Messaging in Development

## 🚀 TL;DR - Zero-Friction Testing (3 Steps)

### Step 1: Start Backend

```bash
python -m backend.main
```

### Step 2: Start Desktop App

```bash
cd desktop
npm run dev
```

✅ **Automatically installs Native Messaging host** (no action needed!)

### Step 3: Load Extension in Chrome

1. Go to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" → Select `extension` folder
4. **Done!** Extension auto-connects

### Extension ID Auto-Update (Automatic!)

- Extension sends ID to backend on first connect
- Backend saves it to `~/.centris/extension_id.txt`
- Desktop app auto-updates manifests within 30-60 seconds
- Extension reloads → Now uses Native Messaging!

**No manual steps needed** - it all happens automatically! 🎉

### Optional: Manual Installation (For Immediate Native Messaging)

If you want Native Messaging immediately (without waiting for auto-update):

```bash
cd extension
./install_native_host.sh
# Enter your extension ID when prompted
```

Then reload extension → Uses Native Messaging immediately!

**Note:** This is optional - auto-update works fine, just takes 30-60 seconds.

## Verify It's Working

### Check Extension Console

Open Chrome DevTools (F12) → Console tab, look for:

**✅ Success (Native Messaging):**

```
✅ Native Messaging handshake sent
✅ Native host ready
✅ Native Messaging handshake acknowledged
```

**⚠️ Fallback (WebSocket - still works, just slower):**

```
⚠️ Native Messaging disconnected
📡 Falling back to WebSocket connection
✅ WebSocket connection OPENED
```

## Quick Test Script

Run this to verify your setup:

```bash
cd extension
./test_native_messaging_setup.sh
```

This checks:

- ✓ Host script exists
- ✓ Manifest installed
- ✓ Python3 available
- ✓ Extension files present

## Common Issues

### "Native host not found"

→ Run: `./install_native_host.sh`

### "Extension ID mismatch"

→ Update manifest with your extension ID from `chrome://extensions/`

### "Permission denied"

→ The app will automatically use user directory (this is fine!)

## Development vs Production

| Feature              | Development               | Production                |
| -------------------- | ------------------------- | ------------------------- |
| **Installation**     | Automatic when app starts | Automatic when app starts |
| **Host script path** | `extension/native-host/`  | Bundled in app resources  |
| **Extension ID**     | Manual or auto-update     | Auto-update               |
| **Testing**          | Manual reload extension   | Automatic                 |

## Full Documentation

See `DEVELOPMENT_TESTING.md` for detailed testing guide.
