# Wispr Flow Implementation Guide

This document explains how Centris AI recreates the Wispr Flow experience with its signature "Pill UI" floating interface.

## Overview

Wispr Flow is a desktop application that provides:

- **Floating Pill UI**: A translucent, glassmorphism pill that appears at the bottom-center of the screen
- **Global Hotkey**: Hold Fn key (or Fn+Space) to activate voice recording
- **Fast Transcription**: <700ms latency from speech to text
- **AI Refinement**: LLM cleans up raw transcripts (removes filler words, fixes grammar)
- **Text Injection**: Automatically pastes refined text into any active application

## Architecture

### 1. Window Management (Electron)

The app uses **two separate windows**:

#### Main Window (Hidden)

- **Purpose**: IPC communication and hotkey handling
- **Visibility**: Hidden off-screen (1x1px at -2000, -2000)
- **Why**: Needed for Electron IPC but shouldn't be visible to users

#### Pill UI Window (Visible)

- **Purpose**: Display the floating pill interface
- **Configuration**:
  ```javascript
  {
    frame: false,              // No window borders
    transparent: true,         // Fully transparent background
    alwaysOnTop: true,         // Stays above all apps
    skipTaskbar: true,         // Hidden from Dock/Taskbar
    type: 'panel',             // macOS panel type for overlay behavior
    visibleOnAllWorkspaces: true, // Works across Spaces
    backgroundColor: '#00000000'  // Fully transparent
  }
  ```

**Key Settings**:

- `setIgnoreMouseEvents(true, { forward: true })`: Click-through for transparent areas, but allows clicks on pill UI elements
- `setAlwaysOnTop(true, "floating", 1)`: Ensures pill stays above everything
- `setVisibleOnAllWorkspaces(true)`: Works across macOS Spaces and fullscreen apps

### 2. Pill UI Component (`WisprPill.tsx`)

The pill component features:

#### Visual Design (Glassmorphism)

```css
background: rgba(25, 25, 25, 0.7)  /* Dark translucent */
backdrop-filter: blur(15px)         /* Blurs content behind */
border: 1px solid rgba(255,255,255,0.1)  /* Subtle edge */
border-radius: 9999px              /* Perfect pill shape */
shadow: 0 10px 30px rgba(0,0,0,0.5)  /* Floating effect */
```

#### Three States

1. **Idle State**
   - Shows: "Hold 'Fn' to speak"
   - Compact width
   - Settings button (optional)

2. **Listening State**
   - Purple accent color (`bg-purple-600`)
   - Pulse animation around microphone icon
   - Audio waveform visualization (5 animated bars)
   - Shows "Flowing..." text
   - Displays live transcript (if available)
   - Expands width to accommodate text

3. **Processing State**
   - Purple accent (`bg-purple-500`)
   - Spinning loader icon
   - Shows "Refining text..." message
   - Medium width

#### Audio Waveform Visualization

Animated bars that respond to audio input:

```tsx
<AudioWaveform isActive={isListening} />
```

- 5 bars with random heights (4-16px)
- Updates every 150ms during recording
- Provides visual feedback that audio is being captured

### 3. Audio Recording Pipeline

#### Capture (`audioManager.js`)

```javascript
// Wispr Flow style: Optimal audio settings
const stream = await navigator.mediaDevices.getUserMedia({
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    sampleRate: 16000, // Optimal for speech recognition
  },
});

// MediaRecorder with optimal codec
const mediaRecorder = new MediaRecorder(stream, {
  mimeType: "audio/webm;codecs=opus",
  audioBitsPerSecond: 16000,
});

// Start with 100ms intervals for live visualization
mediaRecorder.start(100);
```

#### Transcription Flow

1. **Record**: MediaRecorder captures audio in 100ms chunks
2. **Stop**: User releases Fn key → recording stops
3. **Transcribe**: Audio sent to Centris backend (Whisper-based)
4. **Refine**: LLM cleans up transcript (removes "um", "uh", fixes grammar)
5. **Inject**: Text pasted into active application via clipboard + Cmd+V

### 4. AI Text Refinement

The `cleanupDictationText()` function uses the backend to refine raw transcripts:

**System Prompt** (implied):

> "You are a text refiner. Remove filler words (um, ah), fix grammar, and resolve self-corrections. Output ONLY the final intended message."

**Example**:

- **Raw**: "Uh, hey, can we meet at 3... actually let's make it 4 PM on Tuesday."
- **Refined**: "Can we meet at 4 PM on Tuesday?"

**Implementation**:

```javascript
const cleanedText = await this.cleanupDictationText(transcribedText);
await this.safePaste(cleanedText);
```

### 5. Text Injection (`clipboard.js`)

Wispr Flow style: Uses clipboard + keyboard simulation

#### macOS

```javascript
// 1. Copy to clipboard
clipboard.writeText(text);

// 2. Simulate Cmd+V
spawn("osascript", ["-e", 'tell application "System Events" to keystroke "v" using command down']);
```

#### Windows

```powershell
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait("^v")
```

#### Linux

- Uses `xdotool` (X11) or `wtype`/`ydotool` (Wayland)

**Requirements**:

- **macOS**: Accessibility permissions (System Settings → Privacy & Security → Accessibility)
- **Windows**: No special permissions needed
- **Linux**: Install `xdotool` or `wtype`/`ydotool`

### 6. Global Hotkey Detection

#### macOS: Fn Key Detection

Uses native binary (`macos-fn-space-listener`) compiled from C:

```c
// Uses CGEventTap to detect Fn key globally
CGEventMask eventMask = CGEventMaskBit(kCGEventKeyDown) |
                        CGEventMaskBit(kCGEventKeyUp);
CGEventTapRef eventTap = CGEventTapCreate(
  kCGSessionEventTap,
  kCGHeadInsertEventTap,
  kCGEventTapOptionDefault,
  eventMask,
  eventCallback,
  NULL
);
```

**Compilation**:

```bash
npm run compile:fn-space
```

**Permissions**: Requires Accessibility permissions

#### Alternative: Globe Key (Fn alone)

Also supports macOS Globe key (Fn alone) via `globeKeyManager.js`:

- Uses IOKit framework
- Detects Fn key press/release globally
- Works even when app is not focused

### 7. Window Positioning

The pill is positioned **above the macOS Dock**:

```javascript
// Calculate dock height
const dockHeight = bounds.height - workArea.height - workArea.y;
const pillBottomPosition = dockHeight + PILL_UI_BOTTOM_MARGIN; // +20px margin

// Position pill
<div style={{ bottom: `${pillBottomPosition}px` }}>
  <WisprPill />
</div>;
```

**Result**: Pill appears at bottom-center, floating above the dock

## User Flow

1. **User holds Fn key** → Global hotkey detected
2. **Pill UI appears** → Transitions from idle to listening state
3. **Audio captured** → MediaRecorder starts, waveform animates
4. **User releases Fn** → Recording stops, transitions to processing
5. **Transcription** → Audio sent to backend (Whisper)
6. **Refinement** → LLM cleans up transcript
7. **Injection** → Text pasted into active app (Slack, Notes, VS Code, etc.)
8. **Pill returns to idle** → Auto-collapses after 2 seconds

## Performance Optimizations

### Latency Reduction

1. **Streaming Audio**: 100ms chunks for faster processing
2. **Backend Optimization**: Centris backend uses optimized Whisper models
3. **LLM Selection**: GPT-4o-mini for fast refinement (220+ WPM)
4. **Parallel Processing**: Transcription and refinement can overlap

### Target: <700ms End-to-End

- Audio capture: ~100ms
- Transcription: ~300-400ms
- Refinement: ~100-200ms
- Injection: ~50ms

**Total**: ~550-750ms (meets Wispr Flow target)

## Key Differences from Browser Extensions

| Feature            | Browser Extension        | Desktop App (Wispr Flow) |
| ------------------ | ------------------------ | ------------------------ |
| **Global Hotkey**  | ❌ Only works in browser | ✅ Works system-wide     |
| **Floating UI**    | ❌ Limited to browser    | ✅ Floats over all apps  |
| **Text Injection** | ❌ Only in browser tabs  | ✅ Works in any app      |
| **Transparency**   | ❌ Limited               | ✅ Full glassmorphism    |
| **Always On Top**  | ❌ No                    | ✅ Yes                   |

## Testing Checklist

- [ ] Pill appears at bottom-center above dock
- [ ] Transparent background with glassmorphism effect
- [ ] Fn key detection works globally (even when app not focused)
- [ ] Audio waveform animates during recording
- [ ] Transcript displays during listening
- [ ] Text refinement removes filler words
- [ ] Text pastes into Slack, Notes, VS Code, Chrome, etc.
- [ ] Pill auto-collapses after processing
- [ ] Works across macOS Spaces
- [ ] Works in fullscreen apps

## Future Enhancements

1. **Live Streaming Transcription**: Show partial transcripts as user speaks
2. **Multiple Language Support**: Auto-detect and refine in different languages
3. **Custom Hotkeys**: Allow users to configure their own hotkey
4. **Voice Commands**: "Centris, switch to dictation mode" voice activation
5. **History**: Show recent transcriptions in pill UI
6. **Settings Panel**: Quick access to settings from pill UI

## Troubleshooting

### Pill doesn't appear

- Check window positioning calculation
- Verify `pillUIWindow` is created and shown
- Check console for errors

### Hotkey doesn't work

- Verify Accessibility permissions are granted
- Check if `macos-fn-space-listener` binary exists and is executable
- Try recompiling: `npm run compile:fn-space`

### Text doesn't paste

- Check Accessibility permissions (macOS)
- Verify clipboard manager has proper permissions
- Test with manual Cmd+V after text is copied

### Audio not recording

- Check microphone permissions
- Verify MediaRecorder is supported
- Check browser console for errors

## Conclusion

This implementation recreates the Wispr Flow experience with:

- ✅ Floating pill UI with glassmorphism
- ✅ Global hotkey detection (Fn key)
- ✅ Fast transcription pipeline
- ✅ AI text refinement
- ✅ System-wide text injection
- ✅ Professional animations and UX

The app behaves exactly like Wispr Flow: a minimal, non-intrusive floating interface that works across all applications.
