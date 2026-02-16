# Real Browser Vision Architecture

## Overview

Sentris AI can now **"see" your real Chrome tabs** with all your **authenticated sessions, cookies, and profiles**. The desktop overlay sits on top of all browser tabs and displays what the AI is viewing in real-time.

## Architecture Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    User's Real Chrome Browser                │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Tab 1: Gmail (logged in)                            │   │
│  │  Tab 2: GitHub (authenticated)                       │   │
│  │  Tab 3: Twitter (signed in)                         │   │
│  │  ...                                                  │   │
│  └──────────────────────────────────────────────────────┘   │
│                      ▲                                        │
│                      │ Chrome Extension APIs                 │
│                      │ (cookies, localStorage, sessions)    │
│                      │                                        │
┌──────────────────────┴──────────────────────────────────────┐
│              Sentris Chrome Extension                        │
│  • Captures screenshots of real tabs                        │
│  • Accesses cookies and session data                        │
│  • Monitors tab changes                                     │
│  • Sends vision frames via WebSocket                        │
└──────────────────────┬──────────────────────────────────────┘
                       │ WebSocket (port 8765)
                       │
┌──────────────────────▼──────────────────────────────────────┐
│            Python Backend (Extension Bridge)                │
│  • Receives vision frames                                    │
│  • Processes with vision AI                                 │
│  • Sends commands back to extension                         │
│  • Bridges to desktop overlay                               │
└──────────────────────┬──────────────────────────────────────┘
                       │ WebSocket/HTTP
                       │
┌──────────────────────▼──────────────────────────────────────┐
│         Desktop Overlay (Electron/Tauri)                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  BrowserVisionOverlay Component                     │   │
│  │  • Shows what AI sees                                │   │
│  │  • Displays tab context                              │   │
│  │  • Real-time vision streaming                         │   │
│  │  • Always on top                                      │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

## Key Features

### 1. Real User Sessions

- ✅ **Access to authenticated tabs** - AI sees your logged-in Gmail, GitHub, etc.
- ✅ **Cookie access** - Extension can read cookies (with permission)
- ✅ **Local storage** - Access to localStorage and sessionStorage
- ✅ **Profile information** - Knows which tabs are authenticated

### 2. Vision Streaming

- ✅ **Real-time screenshots** - Continuous vision frames (configurable FPS)
- ✅ **Tab context included** - Each frame includes URL, title, profile info
- ✅ **Change detection** - Monitors tab changes automatically

### 3. Desktop Overlay

- ✅ **Always on top** - Sits above all browser tabs
- ✅ **Visual feedback** - Shows what the AI is currently viewing
- ✅ **Tab selection** - User can see all tabs and select which to monitor
- ✅ **Session indicators** - Shows which tabs are authenticated

## How It Works

### Step 1: Extension Installation

1. User installs Sentris Chrome Extension
2. Extension requests permissions:
   - `tabs` - Tab management
   - `cookies` - Cookie access (for session detection)
   - `desktopCapture` - Screenshot capture
   - `scripting` - DOM access

### Step 2: Connection

1. Extension connects to backend via WebSocket (port 8765)
2. Backend starts WebSocket server
3. Desktop overlay connects to backend
4. All components are now connected

### Step 3: Vision Capture

```javascript
// Extension captures screenshot
const screenshot = await chrome.tabs.captureVisibleTab(windowId, {
  format: "png",
  quality: 100,
});

// Gets tab context (profile, cookies, etc.)
const profileInfo = await getProfileInfo(tabId);

// Sends to backend
sendToDesktopApp({
  type: "vision_frame",
  tabId: tabId,
  dataUrl: screenshot,
  tabContext: {
    url: tab.url,
    title: tab.title,
    profile: profileInfo, // Includes authentication state
  },
});
```

### Step 4: Desktop Display

```typescript
// Desktop overlay receives vision frame
function handleVisionFrame(frame: VisionFrame) {
  // Display screenshot
  setCurrentFrame(frame);

  // Show tab context
  showTabInfo(frame.tabContext);

  // Indicate authentication status
  if (frame.tabContext.profile.isAuthenticated) {
    showAuthenticatedIndicator();
  }
}
```

## API Reference

### Extension → Backend Messages

#### `vision_frame`

Sent continuously when vision streaming is active.

```json
{
  "type": "vision_frame",
  "tabId": 123,
  "dataUrl": "data:image/png;base64,...",
  "timestamp": 1234567890,
  "tabContext": {
    "tabId": 123,
    "url": "https://gmail.com",
    "title": "Gmail",
    "windowId": 456,
    "profile": {
      "domain": "gmail.com",
      "cookiesCount": 15,
      "isAuthenticated": true,
      "cookies": [...]
    }
  }
}
```

#### `tab_changed`

Sent when a tab's URL, title, or status changes.

```json
{
  "type": "tab_changed",
  "tabId": 123,
  "changeInfo": {
    "url": "https://gmail.com/inbox",
    "title": "Inbox - Gmail"
  },
  "tab": {
    "id": 123,
    "url": "https://gmail.com/inbox",
    "title": "Inbox - Gmail",
    "status": "complete"
  }
}
```

### Backend → Extension Commands

#### `start_vision_stream`

Start continuous vision streaming for a tab.

```json
{
  "type": "start_vision_stream",
  "tabId": 123,
  "interval": 1000,
  "id": "request-123"
}
```

#### `get_tab_context`

Get full tab context including profile and session info.

```json
{
  "type": "get_tab_context",
  "tabId": 123,
  "id": "request-456"
}
```

#### `get_all_profiles`

Get all tabs with their profile/session information.

```json
{
  "type": "get_all_profiles",
  "id": "request-789"
}
```

## Python Usage

```python
from backend.utils.extension_bridge import ExtensionBridge

bridge = ExtensionBridge()

# Get all tabs with their profiles
profiles = bridge.get_all_profiles()
for profile in profiles['profiles']:
    print(f"Tab: {profile['title']}")
    print(f"  URL: {profile['url']}")
    print(f"  Authenticated: {profile['profile']['isAuthenticated']}")
    print(f"  Cookies: {profile['profile']['cookiesCount']}")

# Get specific tab context
tab_context = bridge.get_tab_context(tab_id=123)
print(f"Tab is authenticated: {tab_context['profile']['isAuthenticated']}")

# Start vision streaming
bridge.start_vision_stream(tab_id=123, interval=1000)

# Vision frames will be received automatically
# Handle in message handler:
# async def handle_vision_frame(message):
#     screenshot = message['dataUrl']
#     tab_context = message['tabContext']
#     # Process with vision AI...
```

## Desktop Overlay Usage

```typescript
import BrowserVisionOverlay from './components/BrowserVisionOverlay';

function App() {
  const [showVision, setShowVision] = useState(false);

  return (
    <>
      <button onClick={() => setShowVision(true)}>
        Show AI Vision
      </button>

      {showVision && (
        <BrowserVisionOverlay
          visible={showVision}
          onClose={() => setShowVision(false)}
        />
      )}
    </>
  );
}
```

## Security & Privacy

### What the Extension Can Access

- ✅ **Screenshots** - Visual content of tabs
- ✅ **Tab metadata** - URL, title, status
- ✅ **Cookie names** - (not values, unless explicitly granted)
- ✅ **Storage keys** - Count of localStorage/sessionStorage items
- ✅ **Domain information** - Hostname of tabs

### What the Extension Cannot Access

- ❌ **Cookie values** - Without explicit user permission
- ❌ **Password fields** - Browser security prevents this
- ❌ **Incognito tabs** - Extension cannot access incognito mode
- ❌ **Other browser data** - Only what's explicitly granted

### User Control

- User must explicitly install extension
- Extension requests permissions at install time
- User can revoke permissions anytime
- Desktop overlay is opt-in (user opens it)

## Use Cases

### 1. AI Assistant with Real Sessions

```
User: "Check my Gmail inbox"
AI: Takes screenshot of Gmail tab (user is logged in)
AI: Reads emails using vision + DOM
AI: Responds with email summary
```

### 2. Multi-Tab Monitoring

```
User: "Monitor all my social media tabs"
AI: Starts vision streaming for Twitter, Facebook, LinkedIn
AI: Shows updates in desktop overlay
AI: Alerts user of important notifications
```

### 3. Authenticated Web Automation

```
User: "Post to Twitter"
AI: Finds Twitter tab (authenticated)
AI: Takes screenshot, finds compose button
AI: Clicks compose, types message, posts
```

## Benefits Over Headless Browsers

| Feature             | Headless Browser          | Real Browser Extension         |
| ------------------- | ------------------------- | ------------------------------ |
| **Sessions**        | ❌ No real sessions       | ✅ Real authenticated sessions |
| **Cookies**         | ❌ Empty/new cookies      | ✅ User's actual cookies       |
| **Local Storage**   | ❌ Empty                  | ✅ User's saved data           |
| **User Experience** | ❌ Hidden from user       | ✅ User sees what AI sees      |
| **Performance**     | ⚠️ Extra browser instance | ✅ Uses existing browser       |
| **Setup**           | ❌ Complex                | ✅ Simple extension install    |

## Future Enhancements

- [ ] **Element highlighting** - Show which elements AI is focusing on
- [ ] **Action visualization** - Show AI's clicks/typing in real-time
- [ ] **Multi-tab view** - Display multiple tabs simultaneously
- [ ] **Vision history** - Scroll through past vision frames
- [ ] **AI annotations** - Overlay AI's understanding on screenshot
- [ ] **Privacy filters** - Blur sensitive content automatically

## Troubleshooting

### Extension Not Connecting

- Check WebSocket server is running (port 8765)
- Verify extension is installed and enabled
- Check browser console for errors

### No Vision Frames

- Ensure vision streaming is started
- Check tab is not in incognito mode
- Verify `desktopCapture` permission is granted

### Desktop Overlay Not Showing

- Check desktop app is running
- Verify WebSocket connection to backend
- Check React component is mounted

### Missing Profile Information

- Ensure `cookies` permission is granted
- Some tabs may not be accessible (chrome:// pages)
- Incognito tabs cannot be accessed
