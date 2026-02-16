# Sentris Chrome Extension - Vision Integration Guide

## Overview

The Sentris Chrome Extension now includes advanced vision capabilities that allow the AI to "see" and interact with web pages using computer vision models. This enables natural language element detection and coordinate-based clicking.

## Architecture

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│   Chrome Tab    │────────▶│ Chrome Extension │────────▶│  Sentris Backend│
│                 │         │                  │         │                 │
│  - Screenshot   │         │  - Capture       │         │  - Vision AI    │
│  - DOM          │         │  - Stream        │         │  - Analysis     │
│  - Click        │         │  - Send/Receive  │         │  - Coordinates  │
└─────────────────┘         └──────────────────┘         └─────────────────┘
```

## Vision Workflow

### 1. Basic Screenshot Capture

```python
from backend.utils.extension_bridge import ExtensionBridge

bridge = ExtensionBridge()

# Get active tab
tab = bridge.get_active_tab()
tab_id = tab['id']

# Take screenshot
screenshot = bridge.take_screenshot(tab_id)
# Returns: {'success': True, 'dataUrl': 'data:image/png;base64,...', 'timestamp': ...}
```

### 2. Full Page Screenshot

```python
# Capture full page with scroll info
full_page = bridge.take_full_page_screenshot(tab_id)
# Returns: {
#   'success': True,
#   'dataUrl': '...',
#   'pageInfo': {
#     'scrollHeight': 5000,
#     'scrollWidth': 1920,
#     'viewportHeight': 1080,
#     'viewportWidth': 1920
#   }
# }
```

### 3. Element-Specific Screenshot

```python
# Capture specific element
element_screenshot = bridge.take_element_screenshot(
    tab_id,
    selector="#submit-button"
)
# Returns: {
#   'success': True,
#   'dataUrl': '...',
#   'elementBounds': {
#     'x': 850, 'y': 200,
#     'width': 120, 'height': 40
#   }
# }
```

### 4. Real-Time Vision Streaming

```python
# Start continuous vision streaming (for real-time AI analysis)
bridge.start_vision_stream(tab_id, interval=500)  # 2 frames per second

# The extension will automatically send vision frames to backend
# Backend receives 'vision_frame' messages with:
# - tabId
# - dataUrl (screenshot)
# - timestamp

# Stop streaming when done
bridge.stop_vision_stream(tab_id)
```

### 5. Vision-Based Element Detection

```python
# Find element using natural language description
result = bridge.find_element_by_vision(
    tab_id,
    description="the blue submit button in the top right corner"
)

# Returns screenshot + description
# Backend processes this with vision AI (GPT-4V, Claude Vision, etc.)
# and returns coordinates

# Example backend processing:
from backend.utils.vision_controller import VisionController

vision = VisionController()
screenshot_data = result['screenshot']  # base64 image
description = result['description']

# Use vision AI to find element
element = vision.detect_elements(
    screenshot=screenshot_data,
    element_types=['button']
)

# Get coordinates
x, y = element[0].coordinates
```

### 6. Coordinate-Based Clicking

```python
# Click at coordinates found by vision AI
bridge.click_by_coordinates(tab_id, x=850, y=200)

# Returns: {
#   'success': True,
#   'element': 'BUTTON',
#   'changeDetected': True,
#   'coordinates': {'x': 850, 'y': 200}
# }
```

## Complete Vision Workflow Example

```python
from backend.utils.extension_bridge import ExtensionBridge
from backend.utils.vision_controller import VisionController

# Initialize
bridge = ExtensionBridge()
vision = VisionController()

# Get active tab
tab = bridge.get_active_tab()
tab_id = tab['id']

# Step 1: Take screenshot
screenshot_result = bridge.take_screenshot(tab_id)
screenshot_base64 = screenshot_result['dataUrl']

# Step 2: Use vision AI to find element
# (This would typically be done in your agent/tool)
element_description = "the login button"
vision_result = await vision.find_element_in_screenshot(
    screenshot_base64=screenshot_base64,
    element_description=element_description
)

# Step 3: Click element using coordinates
if vision_result.get('found'):
    x = vision_result['x']
    y = vision_result['y']

    click_result = bridge.click_by_coordinates(tab_id, x, y)

    if click_result['success']:
        print(f"✅ Clicked {element_description} at ({x}, {y})")
        if click_result.get('changeDetected'):
            print("✅ Page changed after click")
else:
    print(f"❌ Element not found: {element_description}")
```

## Vision Streaming for Continuous Analysis

For real-time AI monitoring and analysis:

```python
# Start streaming
bridge.start_vision_stream(tab_id, interval=1000)  # 1 FPS

# Backend receives frames automatically
# Handle in your message handler:

async def handle_vision_frame(message):
    tab_id = message['tabId']
    screenshot = message['dataUrl']
    timestamp = message['timestamp']

    # Process with vision AI
    analysis = await vision.analyze_screenshot(
        screenshot=screenshot,
        prompt="What UI elements are visible? Are there any errors or alerts?"
    )

    # Take action based on analysis
    if "error" in analysis.lower():
        # Handle error...
        pass
```

## Browser Process Monitoring

Monitor tab changes and process info:

```python
# Get process information
process_info = bridge.get_browser_process_info(tab_id)
# Returns: {
#   'success': True,
#   'processInfo': {
#     'tabId': 123,
#     'url': 'https://example.com',
#     'title': 'Example',
#     'status': 'complete',
#     'active': True,
#     ...
#   }
# }

# Monitor tab changes
bridge.monitor_tab_changes(tab_id)
# Extension will send 'tab_changed' messages automatically
```

## Window and Tab Management

```python
# Get all windows
windows = bridge.get_all_windows()
# Returns: {
#   'success': True,
#   'windows': [
#     {
#       'id': 1,
#       'focused': True,
#       'tabs': [...]
#     }
#   ]
# }

# Create new tab
new_tab = bridge.create_new_tab(url="https://example.com")
tab_id = new_tab['tab']['id']

# Close tab
bridge.close_tab(tab_id)
```

## Integration with Sentris Agent

The extension integrates seamlessly with Sentris agents:

```python
from backend.agent.tools.browser_tool import BrowserTool

# BrowserTool automatically uses ExtensionBridge when available
browser = BrowserTool()

# Agent can use vision naturally:
# "Click the submit button"
# → BrowserTool takes screenshot
# → Vision AI finds button
# → Extension clicks at coordinates
```

## Performance Considerations

- **Screenshot capture**: ~100-200ms
- **Vision AI processing**: ~500-2000ms (depends on model)
- **Coordinate clicking**: ~100-300ms
- **Total vision workflow**: ~0.7-2.5 seconds

### Optimization Tips

1. **Use vision streaming sparingly** - Only when needed for real-time monitoring
2. **Cache screenshots** - Reuse screenshots when possible
3. **Batch operations** - Process multiple elements in one vision call
4. **Use DOM when possible** - DOM is faster than vision for known selectors

## Error Handling

```python
try:
    screenshot = bridge.take_screenshot(tab_id)
    if not screenshot.get('success'):
        print(f"Error: {screenshot.get('error')}")
except Exception as e:
    print(f"Failed to take screenshot: {e}")
```

## Best Practices

1. **Always check success** - Verify operations succeeded
2. **Handle disconnections** - Extension may disconnect, implement retry logic
3. **Monitor tab changes** - Pages may navigate, check status before actions
4. **Use appropriate intervals** - Balance between responsiveness and performance
5. **Combine vision + DOM** - Use vision for discovery, DOM for known elements

## Troubleshooting

### Extension Not Connecting

- Check WebSocket server is running (port 8765)
- Verify extension is installed and enabled
- Check browser console for errors

### Screenshots Not Working

- Verify `desktopCapture` permission is granted
- Check tab is not in incognito mode (if restricted)
- Ensure tab is fully loaded

### Vision Detection Failing

- Verify screenshot is valid base64
- Check vision AI service is available
- Ensure element description is clear and specific

## Future Enhancements

- [ ] Full page screenshot stitching (scroll + combine)
- [ ] Element highlighting in browser
- [ ] Vision model selection (GPT-4V, Claude, DeepSeek)
- [ ] Cached element detection
- [ ] Multi-element detection in one call
- [ ] OCR text extraction from screenshots
