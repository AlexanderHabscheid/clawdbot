# Centris Native Control Module

Native system control module for Centris AI - provides DOM-like access to desktop UI via Accessibility APIs.

## What This Does

**The Problem**: Vision-based UI automation (screenshot → AI → coordinates) is slow (~2 seconds) and inaccurate (~85%).

**The Solution**: Use native Accessibility APIs to get **exact element coordinates** instantly (<10ms).

| Approach                 | Get Elements | Accuracy | Latency     |
| ------------------------ | ------------ | -------- | ----------- |
| Vision (Screenshot + AI) | 500-2000ms   | ~85%     | High        |
| **Native Accessibility** | <10ms        | **100%** | **Minimal** |

## How It Works

Every OS has an Accessibility API that exposes UI elements with exact positions:

- **macOS**: AXUIElement (Accessibility.framework)
- **Windows**: UIAutomation (UIAutomation.h)
- **Linux**: AT-SPI (libatspi)

This module wraps these APIs to provide a browser-like DOM experience for desktop apps.

## Features

- 🎯 **Exact Coordinates**: Get pixel-perfect element positions from the OS
- ⚡ **Instant Discovery**: <10ms to find all interactive elements
- 🖱️ **Real Mouse Control**: Move the user's actual mouse cursor
- ⌨️ **Keyboard Input**: Type with real keyboard events
- 🪟 **Window Management**: List, focus, resize, move windows
- 📱 **Multi-App Support**: Works with any native application

## Quick Example

```javascript
const { nativeControl } = require("centris-native-control");

// Get all interactive elements from Slack (instant!)
const snapshot = await nativeControl.getInteractiveSnapshot({
  appName: "Slack",
});

// Find the Send button
const sendButton = snapshot.elements.find((el) => el.role === "button" && el.name === "Send");

// Click at EXACT center (no miss-clicks!)
await nativeControl.clickElement(sendButton.id);
```

## Installation

```bash
# Install dependencies
npm install

# Build native module
npm run build
```

## Permissions

### macOS

1. System Preferences → Security & Privacy → Privacy → Accessibility
2. Add your app (Electron/Terminal) to the list

### Windows

No special permissions required.

### Linux

AT-SPI should be enabled by default for accessibility.

## API Overview

### Element Discovery

- `getInteractiveSnapshot(options)` - Get all interactive elements
- `findElement(criteria)` - Find single element
- `findElements(criteria)` - Find all matching elements

### Element Actions

- `clickElement(id, options)` - Click element at exact center
- `typeIntoElement(id, text)` - Type into element
- `performAction(id, action)` - Native accessibility action

### Mouse/Keyboard

- `moveMouse(x, y)` - Move cursor
- `click(x, y, options)` - Click at coordinates
- `type(text)` - Type with keyboard
- `keyPress(combo)` - Press key combination

### Window Management

- `getWindows()` - List all windows
- `focusWindow(id)` - Focus window
- `resizeWindow(id, w, h)` - Resize window

See [ARCHITECTURE.md](./ARCHITECTURE.md) for full API documentation.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Native Control Module                     │
│                                                              │
│  ┌──────────────────┐  ┌──────────────────┐                 │
│  │  Accessibility   │  │  Mouse/Keyboard  │                 │
│  │  Controller      │  │  Controller      │                 │
│  │  (AXUIElement)   │  │  (CGEvent)       │                 │
│  └──────────────────┘  └──────────────────┘                 │
│                                                              │
│  ┌──────────────────┐  ┌──────────────────┐                 │
│  │  Window          │  │  Screen          │                 │
│  │  Controller      │  │  Controller      │                 │
│  └──────────────────┘  └──────────────────┘                 │
└─────────────────────────────────────────────────────────────┘
```

## Comparison to Browser Extension

| Aspect      | Chrome Extension        | Native Control     |
| ----------- | ----------------------- | ------------------ |
| Target      | Web pages               | Native apps        |
| API         | DOM / Chrome APIs       | Accessibility APIs |
| Elements    | HTML elements           | UI elements        |
| Coordinates | getBoundingClientRect() | AXPosition/AXSize  |
| Actions     | click(), focus()        | AXPress, CGEvent   |

## Development

```bash
# Build
npm run build

# Run tests
npm test

# Clean build
npm run clean && npm run rebuild
```

## License

MIT
