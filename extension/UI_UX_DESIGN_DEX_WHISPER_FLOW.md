# Centris Chrome Extension UI/UX Design: Dex-Style Context-Aware (No Sidebar)

## Vision

**Centris Chrome Extension = Dex Context-Aware (No Sidebar) + Whisper Flow Voice Activation**

**IMPORTANT**: We do NOT want a sidebar. The Chrome extension should:

- Work invisibly, integrated into browser (like Dex context-awareness)
- Be context-aware - understands what's on screen
- Receive LLM tool calls from backend, execute browser actions
- **No UI** - Context is used by LLM, not displayed to user

**Desktop Swift App**:

- **Thin line overlay** (2-4px, top of screen, always-on-top)
- **Hold-to-activate** voice (Whisper Flow style)
- Minimal visual feedback when listening

---

## Design Inspiration

### ThirdLayer Dex UI/UX

- **Context-aware assistance** - Understands what's on screen
- **Integrated into browser** - Not a separate popup, but part of the browsing experience
- **Adaptive UI/UX** - Customizes based on user behavior
- **Cross-app memory** - Remembers context across tabs
- **Real-time suggestions** - Proactive help without being intrusive

### Whisper Flow Voice Interface

- **Floating voice button** - Always accessible, doesn't block content
- **Voice-first interaction** - Primary input method is voice
- **Minimal UI** - Clean, unobtrusive design
- **Visual feedback** - Shows when listening, processing, responding
- **Always-on-top** - Accessible from any tab/page

---

## Centris Extension UI/UX Design

### Core Components

#### 1. Floating Voice Button (Primary Interface)

```
┌─────────────────────────────────────────┐
│                                         │
│  [Web Page Content]                    │
│                                         │
│                              ┌──────┐  │
│                              │  🎤  │  │ ← Floating Voice Button
│                              └──────┘  │   (Always visible, bottom-right)
│                                         │
└─────────────────────────────────────────┘
```

**Design Specs:**

- **Position**: Bottom-right corner (or customizable)
- **Size**: 56x56px (minimum touch target)
- **Style**: Circular, floating, with subtle shadow
- **Icon**: Microphone icon (animated when listening)
- **Behavior**:
  - Click/tap to start voice input
  - Hold for continuous listening
  - Visual feedback (pulse, color change) when active
  - Minimizes to small dot when not in use

#### 2. Voice Interface Overlay (When Active)

```
┌─────────────────────────────────────────┐
│                                         │
│  [Web Page Content]                    │
│                                         │
│  ┌─────────────────────────────────┐  │
│  │ 🎤 Listening...                  │  │ ← Voice Input Overlay
│  │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │  │   (Appears when voice active)
│  │                                   │  │
│  │ "Check my Gmail inbox"            │  │
│  │                                   │  │
│  │ [Cancel]  [Send]                  │  │
│  └─────────────────────────────────┘  │
│                                         │
└─────────────────────────────────────────┘
```

**Design Specs:**

- **Position**: Bottom-center or floating near voice button
- **Size**: Responsive, adapts to content
- **Style**: Card-based, rounded corners, backdrop blur
- **Features**:
  - Real-time transcription display
  - Visual waveform when listening
  - Cancel/Send buttons
  - Auto-sends on pause (configurable)

#### 3. Context-Aware (No Sidebar - Like Dex)

```
┌─────────────────────────────────────────┐
│ [Page]  │  ┌──────────────────────┐   │
│         │  │ Centris AI            │   │
│         │  │ ────────────────────  │   │
│         │  │                       │   │
│         │  │ 🎤 Voice Input         │   │ ← Sidebar Panel
│         │  │                       │   │   (Opens on demand)
│         │  │ 💬 Chat History       │   │
│         │  │                       │   │
│         │  │ 📋 Context:           │   │
│         │  │ • Gmail inbox         │   │
│         │  │ • 5 unread emails    │   │
│         │  └──────────────────────┘   │
└─────────────────────────────────────────┘
```

**Design Specs:**

- **NO SIDEBAR** - Extension works invisibly
- **Context-aware**: Extension reads page DOM/content
- **LLM uses context**: Backend LLM receives context, makes decisions
- **No UI**: Context is used by LLM, not displayed to user

#### 4. Inline Suggestions (Dex-Style)

```
┌─────────────────────────────────────────┐
│                                         │
│  [Gmail Inbox]                         │
│                                         │
│  ┌─────────────────────────────────┐  │
│  │ 💡 Centris suggests:            │  │ ← Contextual Suggestions
│  │ "Reply to urgent emails?"       │  │   (Appears when relevant)
│  │ [Yes] [No]                      │  │
│  └─────────────────────────────────┘  │
│                                         │
└─────────────────────────────────────────┘
```

**Design Specs:**

- **Position**: Contextual (near relevant content)
- **Style**: Subtle card, non-intrusive
- **Behavior**:
  - Appears when AI detects relevant actions
  - Can be dismissed
  - One-click actions

---

## Implementation Architecture

### Chrome Extension Structure

```
extension/
├── manifest.json (with side_panel permission)
├── background.js
├── content.js
├── sidepanel/
│   ├── sidepanel.html
│   ├── sidepanel.js
│   └── sidepanel.css
├── floating-voice/
│   ├── floating-voice.html
│   ├── floating-voice.js
│   └── floating-voice.css
├── content-overlay/
│   ├── overlay.js (injected into pages)
│   └── overlay.css
└── assets/
    ├── icons/
    └── styles/
```

### Key Features

#### 1. Floating Voice Button (Content Script)

- Injected into every page
- Positioned absolutely (bottom-right)
- Always visible, doesn't interfere with page
- Communicates with background script for voice processing

#### 2. Side Panel (Chrome Side Panel API)

- Uses `chrome.sidePanel` API
- Opens on extension icon click
- Contains full chat interface
- Context-aware suggestions

#### 3. Voice Processing Flow

```
User clicks voice button
  ↓
Content script → Background script
  ↓
Background script → Backend (WebSocket)
  ↓
Backend processes voice → Returns response
  ↓
Background script → Content script
  ↓
Display response in overlay/sidebar
```

---

## UI/UX Principles

### 1. Voice-First (Whisper Flow Style)

- **Primary interaction**: Voice input
- **Secondary**: Text input in sidebar
- **Tertiary**: Quick action buttons

### 2. Context-Aware (Dex Style)

- **Understands page content**: Reads DOM, understands context
- **Proactive suggestions**: Offers help when relevant
- **Cross-tab memory**: Remembers context across tabs

### 3. Non-Intrusive

- **Floating button**: Small, unobtrusive
- **Minimal overlay**: Only appears when needed
- **Sidebar**: Opens on demand, doesn't block content

### 4. Visual Feedback

- **Listening state**: Animated microphone, waveform
- **Processing state**: Loading indicator
- **Response state**: Smooth animations, clear display

---

## Design Mockups

### Floating Voice Button States

**Idle State:**

```
┌──────┐
│  🎤  │  (Small, subtle, bottom-right)
└──────┘
```

**Listening State:**

```
┌──────┐
│  🎤  │  (Pulsing, larger, green)
│  ═══ │  (Waveform animation)
└──────┘
```

**Processing State:**

```
┌──────┐
│  ⏳  │  (Spinner, blue)
└──────┘
```

### Voice Overlay States

**Listening:**

```
┌─────────────────────────────┐
│ 🎤 Listening...             │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                             │
│ "Check my Gmail..."         │
│                             │
│ [Cancel]                    │
└─────────────────────────────┘
```

**Processing:**

```
┌─────────────────────────────┐
│ ⏳ Processing...             │
│                             │
│ "Check my Gmail inbox"      │
│                             │
│ [Cancel]                    │
└─────────────────────────────┘
```

**Response:**

```
┌─────────────────────────────┐
│ ✅ Done                      │
│                             │
│ You have 5 unread emails:   │
│ • Email from John (urgent)   │
│ • Email from Sarah           │
│ • ...                        │
│                             │
│ [🎤 Ask more] [Close]       │
└─────────────────────────────┘
```

---

## Technical Implementation

### 1. Manifest.json Updates

```json
{
  "manifest_version": 3,
  "name": "Centris AI",
  "permissions": ["tabs", "activeTab", "scripting", "sidePanel", "storage"],
  "side_panel": {
    "default_path": "sidepanel/sidepanel.html"
  },
  "action": {
    "default_icon": "assets/icons/icon.png",
    "default_title": "Centris AI"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js", "floating-voice/floating-voice.js"],
      "css": ["floating-voice/floating-voice.css"]
    }
  ]
}
```

### 2. Floating Voice Button (content.js)

```javascript
// Create floating voice button
const voiceButton = document.createElement("div");
voiceButton.id = "centris-voice-button";
voiceButton.innerHTML = "🎤";
voiceButton.className = "centris-floating-voice";
document.body.appendChild(voiceButton);

// Voice button click handler
voiceButton.addEventListener("click", () => {
  startVoiceInput();
});

// Start voice input
async function startVoiceInput() {
  // Show listening overlay
  showVoiceOverlay();

  // Request microphone access
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  // Send audio to background script
  chrome.runtime.sendMessage({
    type: "voice_input_start",
    stream: stream,
  });
}
```

### 3. Side Panel (sidepanel.html)

```html
<!DOCTYPE html>
<html>
  <head>
    <title>Centris AI</title>
    <link rel="stylesheet" href="sidepanel.css" />
  </head>
  <body>
    <div class="centris-sidebar">
      <div class="header">
        <h2>Centris AI</h2>
        <button id="voice-btn">🎤</button>
      </div>

      <div class="context-section">
        <h3>Current Context</h3>
        <div id="page-context"></div>
      </div>

      <div class="chat-section">
        <div id="chat-history"></div>
        <div class="input-area">
          <button id="voice-input">🎤</button>
          <input type="text" id="text-input" placeholder="Ask Centris..." />
          <button id="send-btn">Send</button>
        </div>
      </div>

      <div class="suggestions-section">
        <h3>Suggestions</h3>
        <div id="suggestions"></div>
      </div>
    </div>

    <script src="sidepanel.js"></script>
  </body>
</html>
```

---

## User Flow

### Flow 1: Voice Command

```
1. User browsing Gmail
2. Sees floating voice button (bottom-right)
3. Clicks voice button
4. Voice overlay appears: "Listening..."
5. User says: "Check my inbox"
6. Overlay shows: "Check my inbox" (transcription)
7. Processing indicator
8. Response overlay: "You have 5 unread emails..."
9. User can ask follow-up or close
```

### Flow 2: Sidebar Chat

```
1. User clicks extension icon
2. Side panel opens (right side)
3. Shows current page context
4. User types or clicks voice button
5. Chat interface with history
6. Context-aware suggestions
```

### Flow 3: Contextual Suggestions

```
1. User on Gmail inbox page
2. Centris detects: "5 unread emails"
3. Suggests: "Reply to urgent emails?"
4. User clicks suggestion
5. Centris executes action
6. Shows result in overlay
```

---

## Comparison: Current vs. New Design

### Current Design (popup.html)

- ❌ Traditional extension popup
- ❌ Requires clicking extension icon
- ❌ Not always accessible
- ❌ No voice-first interface
- ❌ Not context-aware

### New Design (Dex + Whisper Flow)

- ✅ Floating voice button (always accessible)
- ✅ Voice-first interaction
- ✅ Context-aware sidebar
- ✅ Inline suggestions
- ✅ Seamless browser integration
- ✅ Non-intrusive design

---

## Next Steps

1. **Design floating voice button component**
   - HTML/CSS for floating button
   - Animation states (idle, listening, processing)
   - Positioning and styling

2. **Implement voice input flow**
   - Microphone access
   - Audio streaming to backend
   - Transcription display
   - Response handling

3. **Create side panel interface**
   - Side panel HTML/CSS/JS
   - Chat interface
   - Context display
   - Suggestions panel

4. **Add contextual suggestions**
   - Page content analysis
   - Suggestion generation
   - Inline display

5. **Integrate with backend**
   - WebSocket connection
   - Voice processing
   - Response display

---

## Conclusion

**Centris Chrome Extension UI/UX = Dex Context-Aware + Whisper Flow Voice-First**

This design provides:

- **Always-accessible voice interface** (Whisper Flow style)
- **Context-aware assistance** (Dex style)
- **Seamless browser integration** (non-intrusive)
- **Full conversational computer control** (Centris AI brain)

The extension becomes a **natural part of the browsing experience**, not a separate tool that users have to remember to use.
