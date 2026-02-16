#include <ApplicationServices/ApplicationServices.h>
#include <Carbon/Carbon.h>
#include <stdio.h>
#include <unistd.h>

// CGEventTap callback - this is what Wispr Flow uses
static CGEventRef eventTapCallback(CGEventTapProxy proxy, CGEventType type, CGEventRef event, void *refcon) {
    // Only process key down events
    if (type != kCGEventKeyDown) {
        return event;
    }

    // Get the key code (Space = 49)
    CGKeyCode keyCode = (CGKeyCode)CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode);
    
    // Get modifier flags - check for Fn modifier
    CGEventFlags flags = CGEventGetFlags(event);
    
    // Check if Fn modifier is active (kCGEventFlagMaskSecondaryFn = 0x00000800)
    // This is the key difference - we detect Space + Fn modifier, not Fn alone
    bool fnPressed = (flags & kCGEventFlagMaskSecondaryFn) != 0;
    
    // Space key code is 49
    if (keyCode == 49 && fnPressed) {
        // Fn+Space detected - trigger action
        printf("FN_SPACE_DOWN\n");
        fflush(stdout);
    }
    
    // Return the event so system continues processing it
    return event;
}

int main(int argc, char* argv[]) {
    // Check for accessibility permissions
    // CGEventTap requires accessibility permissions
    CGEventMask eventMask = CGEventMaskBit(kCGEventKeyDown);
    
    // Create event tap
    CFMachPortRef eventTap = CGEventTapCreate(
        kCGHIDEventTap,           // Tap at HID level (before system processes it)
        kCGHeadInsertEventTap,    // Insert at head of event list
        kCGEventTapOptionDefault, // Default options
        eventMask,                // Only listen for key down events
        eventTapCallback,         // Callback function
        NULL                      // User data
    );
    
    if (!eventTap) {
        fprintf(stderr, "Failed to create event tap. This requires Accessibility permissions.\n");
        fprintf(stderr, "Please enable Centris AI in System Settings > Privacy & Security > Accessibility.\n");
        return 1;
    }
    
    // Check if accessibility is enabled
    if (!CGEventTapIsEnabled(eventTap)) {
        fprintf(stderr, "Event tap is not enabled. Accessibility permissions required.\n");
        fprintf(stderr, "Please enable Centris AI in System Settings > Privacy & Security > Accessibility.\n");
        CFRelease(eventTap);
        return 1;
    }
    
    // Create run loop source
    CFRunLoopSourceRef runLoopSource = CFMachPortCreateRunLoopSource(
        kCFAllocatorDefault,
        eventTap,
        0
    );
    
    if (!runLoopSource) {
        fprintf(stderr, "Failed to create run loop source\n");
        CFRelease(eventTap);
        return 1;
    }
    
    // Add to run loop
    CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, kCFRunLoopDefaultMode);
    
    // Enable the event tap
    CGEventTapEnable(eventTap, true);
    
    // Run the event loop
    CFRunLoopRun();
    
    // Cleanup (should never reach here)
    CFRunLoopRemoveSource(CFRunLoopGetCurrent(), runLoopSource, kCFRunLoopDefaultMode);
    CFRelease(runLoopSource);
    CFRelease(eventTap);
    
    return 0;
}
