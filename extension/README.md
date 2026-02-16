# Sentris AI Chrome Extension

This Chrome extension enables Sentris AI to control your browser with **vision capabilities** and real browser process control. It provides full control over browser tabs, windows, and processes, with advanced vision-based element detection.

## 🎯 Key Features

### Vision Capabilities

- **Real-time screenshot streaming** - Continuous vision frames for AI analysis
- **Full page screenshots** - Capture entire scrollable pages
- **Element-specific screenshots** - Capture individual UI elements
- **Vision-based element detection** - Find elements using natural language descriptions
- **Coordinate-based clicking** - Click elements found by vision models

### Browser Process Control

- **Tab management** - Create, close, switch tabs
- **Window management** - Control multiple browser windows
- **Process monitoring** - Track tab status, memory, and performance
- **Change detection** - Monitor URL, title, and status changes

### Traditional Browser Control

- DOM element interaction (click, type, scroll)
- JavaScript execution
- Accessibility tree access
- Page content extraction

## 📦 Installation

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `extension/` folder from this repository
5. Extension is now installed!

## 🔌 How It Works

1. **Extension connects to desktop app** via WebSocket (port 8765)
2. **Desktop app sends commands** (vision, browser control, etc.)
3. **Extension executes commands** using Chrome Extension APIs
4. **Results sent back** to desktop app (screenshots, element data, etc.)

## 📡 Communication

- **WebSocket**: `ws://localhost:8765`
- **Protocol**: JSON messages
- **Commands**: See `background.js` for available commands

## 🧪 Testing

1. Install extension
2. Start Sentris desktop app (it will start WebSocket server)
3. Extension should automatically connect
4. Check extension popup to see connection status

## 🛠️ Development

- `manifest.json` - Extension configuration
- `background.js` - Main extension logic, handles commands
- `content.js` - Injected into web pages for DOM access
- `popup.html/js` - Extension popup UI

## 📚 API Reference

See `backend/utils/extension_bridge.py` for Python API.

### Vision Commands

```python
# Take screenshot
screenshot = bridge.take_screenshot(tab_id)

# Take full page screenshot (with scroll info)
full_page = bridge.take_full_page_screenshot(tab_id)

# Take element screenshot
element = bridge.take_element_screenshot(tab_id, selector="#button")

# Start vision streaming (real-time frames)
bridge.start_vision_stream(tab_id, interval=1000)  # 1 frame per second

# Stop vision streaming
bridge.stop_vision_stream(tab_id)

# Find element using vision AI
result = bridge.find_element_by_vision(tab_id, "the blue submit button")

# Click at coordinates (from vision detection)
bridge.click_by_coordinates(tab_id, x=850, y=200)
```

### Browser Control Commands

```python
# Tab management
bridge.create_new_tab(url="https://example.com")
bridge.close_tab(tab_id)
bridge.get_active_tab()
bridge.get_all_tabs()

# Window management
windows = bridge.get_all_windows()

# Process monitoring
info = bridge.get_browser_process_info(tab_id)
bridge.monitor_tab_changes(tab_id)

# Traditional browser control
bridge.navigate(tab_id, url)
bridge.click_element(tab_id, selector)
bridge.type_text(tab_id, selector, text)
bridge.execute_javascript(tab_id, code)
bridge.get_page_content(tab_id)
bridge.get_accessibility_tree(tab_id)
bridge.get_interactive_elements(tab_id)
```

## 🎨 Vision Integration Example

```python
from backend.utils.extension_bridge import ExtensionBridge

bridge = ExtensionBridge()

# Get active tab
tab = bridge.get_active_tab()
tab_id = tab['id']

# Start vision streaming
bridge.start_vision_stream(tab_id, interval=500)  # 2 FPS

# Take screenshot for vision analysis
screenshot = bridge.take_screenshot(tab_id)

# Find element using vision AI (sends to backend)
result = bridge.find_element_by_vision(
    tab_id,
    "the login button in the top right corner"
)

# Click element found by vision
if result.get('found'):
    bridge.click_by_coordinates(
        tab_id,
        x=result['x'],
        y=result['y']
    )
```

## 🔒 Permissions

The extension requires these permissions:

- `tabs` - Tab management and identification
- `activeTab` - Access active tab for voice commands
- `scripting` - Execute content scripts for browser automation
- `storage` - Save user preferences and connection state
- `windows` - Window management for multi-window support
- `nativeMessaging` - Communicate with Centris desktop app
- `debugger` - Chrome DevTools Protocol for visual highlights
- `alarms` - Keep service worker alive for persistent connection

## 🚀 Version History

### v2.0.0 - Vision & Process Control

- Added vision streaming capabilities
- Enhanced screenshot functions
- Browser process monitoring
- Window and tab management
- Coordinate-based clicking

### v1.0.0 - Initial Release

- Basic browser control
- DOM interaction
- Accessibility tree access
