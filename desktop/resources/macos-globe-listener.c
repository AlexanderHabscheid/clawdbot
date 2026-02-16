#include <IOKit/IOKitLib.h>
#include <IOKit/hid/IOHIDManager.h>
#include <CoreFoundation/CoreFoundation.h>
#include <stdio.h>
#include <unistd.h>
#include <stdlib.h>

// Globe/Fn key usage page and usage ID for Apple Silicon Macs
// Uses Apple Vendor Top Case Page (0xFF) with KeyboardFn usage (0x03)
// Reference: https://github.com/qmk/qmk_firmware/issues/2179
#define GLOBE_KEY_USAGE_PAGE 0xFF  // AppleVendorTopCase
#define GLOBE_KEY_USAGE 0x03       // KeyboardFn

static IOHIDManagerRef g_hidManager = NULL;

static void handleGlobeKeyDown(void) {
    printf("FN_DOWN\n");
    fflush(stdout);
}

static void handleGlobeKeyUp(void) {
    printf("FN_UP\n");
    fflush(stdout);
}

static void handleHIDValueCallback(void* context, IOReturn result, void* sender, IOHIDValueRef value) {
    if (result != kIOReturnSuccess) {
        return;
    }

    IOHIDElementRef element = IOHIDValueGetElement(value);
    uint32_t usagePage = IOHIDElementGetUsagePage(element);
    uint32_t usage = IOHIDElementGetUsage(element);

    // Check if this is the Globe key
    if (usagePage == GLOBE_KEY_USAGE_PAGE && usage == GLOBE_KEY_USAGE) {
        CFIndex intValue = IOHIDValueGetIntegerValue(value);
        if (intValue == 1) {
            handleGlobeKeyDown();
        } else if (intValue == 0) {
            handleGlobeKeyUp();
        }
    }
}

// Alternative approach: Open each device individually without seizing all HID
static bool tryOpenDevicesIndividually(void) {
    g_hidManager = IOHIDManagerCreate(kCFAllocatorDefault, kIOHIDOptionsTypeNone);
    if (!g_hidManager) {
        return false;
    }

    // Set matching to keyboard devices only (more restrictive)
    CFMutableDictionaryRef matchingDict = CFDictionaryCreateMutable(
        kCFAllocatorDefault, 0,
        &kCFTypeDictionaryKeyCallBacks,
        &kCFTypeDictionaryValueCallBacks
    );
    
    // Match keyboard devices specifically
    int usagePage = kHIDPage_GenericDesktop;
    int usage = kHIDUsage_GD_Keyboard;
    CFNumberRef usagePageRef = CFNumberCreate(kCFAllocatorDefault, kCFNumberIntType, &usagePage);
    CFNumberRef usageRef = CFNumberCreate(kCFAllocatorDefault, kCFNumberIntType, &usage);
    CFDictionarySetValue(matchingDict, CFSTR(kIOHIDDeviceUsagePageKey), usagePageRef);
    CFDictionarySetValue(matchingDict, CFSTR(kIOHIDDeviceUsageKey), usageRef);
    CFRelease(usagePageRef);
    CFRelease(usageRef);

    IOHIDManagerSetDeviceMatching(g_hidManager, matchingDict);
    CFRelease(matchingDict);

    // Schedule BEFORE opening - this can help with permissions on some macOS versions
    IOHIDManagerScheduleWithRunLoop(g_hidManager, CFRunLoopGetCurrent(), kCFRunLoopDefaultMode);
    
    // Register callback BEFORE opening
    IOHIDManagerRegisterInputValueCallback(g_hidManager, handleHIDValueCallback, NULL);

    // Try opening with no options (non-exclusive)
    IOReturn ret = IOHIDManagerOpen(g_hidManager, kIOHIDOptionsTypeNone);
    if (ret != kIOReturnSuccess) {
        return false;
    }

    return true;
}

// Fallback: Try opening the manager normally
static bool tryOpenManagerNormally(void) {
    g_hidManager = IOHIDManagerCreate(kCFAllocatorDefault, kIOHIDOptionsTypeNone);
    if (!g_hidManager) {
        fprintf(stderr, "Failed to create HID manager\n");
        return false;
    }

    // Match all devices first
    IOHIDManagerSetDeviceMatching(g_hidManager, NULL);

    // Try to open
    IOReturn ret = IOHIDManagerOpen(g_hidManager, kIOHIDOptionsTypeNone);
    if (ret != kIOReturnSuccess) {
        CFRelease(g_hidManager);
        g_hidManager = NULL;
        return false;
    }

    // Schedule with run loop
    IOHIDManagerScheduleWithRunLoop(g_hidManager, CFRunLoopGetCurrent(), kCFRunLoopDefaultMode);

    // Register callback
    IOHIDManagerRegisterInputValueCallback(g_hidManager, handleHIDValueCallback, NULL);

    return true;
}

static void setupDeviceCallbacks(void) {
    if (!g_hidManager) return;
    
    CFSetRef deviceSet = IOHIDManagerCopyDevices(g_hidManager);
    if (!deviceSet) return;
    
    CFIndex deviceCount = CFSetGetCount(deviceSet);
    if (deviceCount == 0) {
        CFRelease(deviceSet);
        return;
    }
    
    IOHIDDeviceRef* devices = (IOHIDDeviceRef*)malloc(sizeof(IOHIDDeviceRef) * deviceCount);
    CFSetGetValues(deviceSet, (const void**)devices);

    for (CFIndex i = 0; i < deviceCount; i++) {
        IOHIDDeviceRef device = devices[i];
        
        // Create matching dictionary for Globe key element
        CFMutableDictionaryRef elementMatchingDict = CFDictionaryCreateMutable(
            kCFAllocatorDefault,
            0,
            &kCFTypeDictionaryKeyCallBacks,
            &kCFTypeDictionaryValueCallBacks
        );
        
        int usagePageValue = GLOBE_KEY_USAGE_PAGE;
        int usageValue = GLOBE_KEY_USAGE;
        CFNumberRef usagePageRef = CFNumberCreate(kCFAllocatorDefault, kCFNumberIntType, &usagePageValue);
        CFNumberRef usageRef = CFNumberCreate(kCFAllocatorDefault, kCFNumberIntType, &usageValue);
        
        CFDictionarySetValue(elementMatchingDict, CFSTR(kIOHIDElementUsagePageKey), usagePageRef);
        CFDictionarySetValue(elementMatchingDict, CFSTR(kIOHIDElementUsageKey), usageRef);
        
        CFRelease(usagePageRef);
        CFRelease(usageRef);
        
        // Get matching elements
        CFArrayRef elements = IOHIDDeviceCopyMatchingElements(device, elementMatchingDict, kIOHIDOptionsTypeNone);
        if (elements && CFArrayGetCount(elements) > 0) {
            // Found Globe key element, register for value changes on this device
            IOHIDDeviceRegisterInputValueCallback(device, handleHIDValueCallback, NULL);
        }
        
        if (elements) CFRelease(elements);
        CFRelease(elementMatchingDict);
    }
    
    free(devices);
    CFRelease(deviceSet);
}

int main(int argc, char* argv[]) {
    bool success = false;
    
    // Try approach 1: Open devices individually (more compatible with macOS Tahoe)
    success = tryOpenDevicesIndividually();
    
    if (!success) {
        // Try approach 2: Normal manager open
        success = tryOpenManagerNormally();
    }
    
    if (!success) {
        fprintf(stderr, "Failed to open HID manager (error code: -536870201). This may require accessibility permissions.\n");
        fprintf(stderr, "Please add Centris AI to System Settings > Privacy & Security > Input Monitoring.\n");
        return 1;
    }

    // Set up device-specific callbacks
    setupDeviceCallbacks();

    // Success message goes to stdout, not stderr
    // stderr is reserved for errors only
    printf("STARTED\n");
    fflush(stdout);
    
    // Run the event loop
    CFRunLoopRun();

    // Cleanup (should never reach here)
    if (g_hidManager) {
        IOHIDManagerUnscheduleFromRunLoop(g_hidManager, CFRunLoopGetCurrent(), kCFRunLoopDefaultMode);
        IOHIDManagerClose(g_hidManager, kIOHIDOptionsTypeNone);
        CFRelease(g_hidManager);
    }

    return 0;
}
