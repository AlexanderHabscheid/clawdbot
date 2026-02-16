# Centris Native Messaging Host

This directory contains the Native Messaging host for fast Chrome extension ↔ Backend communication.

## What is Native Messaging?

Native Messaging is a Chrome API that allows extensions to communicate with native applications via stdio pipes. This is faster than WebSocket because:

- **Direct pipes** instead of TCP/IP stack
- **Chrome-managed** connection lifecycle
- **No network overhead** - pure IPC

## Performance Comparison

| Method           | Overhead | Latency             |
| ---------------- | -------- | ------------------- |
| WebSocket        | ~5-10ms  | ~50ms per action    |
| Native Messaging | ~1-2ms   | ~35-40ms per action |

## Files

- `centris_host.py` - The native messaging host script
- `com.centris.host.json` - Host manifest (registered with Chrome)

## Installation

### Automatic (Recommended)

Run the installer script from the extension directory:

```bash
# macOS/Linux
./install_native_host.sh

# Windows (from PowerShell as Admin)
.\install_native_host.bat
```

### Manual Installation

#### macOS

1. Copy host script to a permanent location:

   ```bash
   sudo cp centris_host.py /usr/local/bin/
   sudo chmod +x /usr/local/bin/centris_host.py
   ```

2. Create the manifest directory:

   ```bash
   mkdir -p ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/
   ```

3. Copy and update manifest:

   ```bash
   cp com.centris.host.json ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/
   # Edit the manifest to set the correct path and extension ID
   ```

4. Update the manifest with:
   - Correct path to `centris_host.py`
   - Your extension's ID (from `chrome://extensions`)

#### Windows

1. Copy host script to a permanent location (e.g., `C:\Program Files\Centris\`)

2. Create registry key:

   ```
   HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\com.centris.host
   ```

3. Set default value to path of manifest JSON

#### Linux

1. Copy host script:

   ```bash
   sudo cp centris_host.py /usr/local/bin/
   sudo chmod +x /usr/local/bin/centris_host.py
   ```

2. Copy manifest:
   ```bash
   mkdir -p ~/.config/google-chrome/NativeMessagingHosts/
   cp com.centris.host.json ~/.config/google-chrome/NativeMessagingHosts/
   ```

## Verifying Installation

1. Open Chrome
2. Go to `chrome://extensions/`
3. Find "Sentris AI Browser Control"
4. Open the extension popup
5. Check connection status - should show "Native Messaging"

## Troubleshooting

### Extension can't connect to native host

1. **Check manifest path**: Ensure the path in `com.centris.host.json` is correct
2. **Check permissions**: Host script must be executable (`chmod +x`)
3. **Check extension ID**: The `allowed_origins` must match your extension ID
4. **Check Chrome logs**: Look at `chrome://extensions/` for error messages

### Native host starts but disconnects

1. **Check host logs**: The host logs to stderr, visible in Chrome's extension logs
2. **Check backend connection**: Ensure the backend is running on port 8766
3. **Check for Python errors**: Run the host manually to see any import errors

### Falling back to WebSocket

If Native Messaging fails, the extension automatically falls back to WebSocket (port 8765).
This is logged in the extension console.

## Development

To test the host manually:

```bash
# Send a test message (the 4-byte length prefix + JSON)
echo -ne '\x1b\x00\x00\x00{"type":"extension_ready"}' | python3 centris_host.py
```

## Security

- Only the extension with the matching ID in `allowed_origins` can connect
- No network ports are exposed
- Chrome enforces the connection security
