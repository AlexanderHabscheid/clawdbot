/**
 * macOS Text Inserter using Accessibility API
 * 
 * This utility inserts text directly into the focused text field
 * WITHOUT using the system clipboard. This is how Wispr Flow works.
 * 
 * Usage: macos-text-inserter "text to insert"
 * 
 * The text is inserted at the current cursor position using the
 * Accessibility API's kAXSelectedTextAttribute, which replaces the
 * current selection (or inserts at cursor if no selection).
 * 
 * Requires Accessibility permissions in System Settings.
 */

#import <Foundation/Foundation.h>
#import <ApplicationServices/ApplicationServices.h>
#import <Carbon/Carbon.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/**
 * Check if we have accessibility permissions
 */
static BOOL checkAccessibilityPermissions(void) {
    // Create options dictionary - don't prompt, just check
    NSDictionary *options = @{(__bridge id)kAXTrustedCheckOptionPrompt: @NO};
    Boolean trusted = AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)options);
    return trusted;
}

/**
 * Get the currently focused UI element (text field)
 */
static AXUIElementRef getFocusedElement(void) {
    // Get system-wide accessibility element
    AXUIElementRef systemWide = AXUIElementCreateSystemWide();
    if (!systemWide) {
        fprintf(stderr, "ERROR: Could not create system-wide element\n");
        return NULL;
    }
    
    // Get the focused UI element
    AXUIElementRef focusedElement = NULL;
    AXError error = AXUIElementCopyAttributeValue(
        systemWide,
        kAXFocusedUIElementAttribute,
        (CFTypeRef *)&focusedElement
    );
    
    CFRelease(systemWide);
    
    if (error != kAXErrorSuccess) {
        fprintf(stderr, "ERROR: Could not get focused element (error: %d)\n", error);
        return NULL;
    }
    
    return focusedElement;
}

/**
 * Insert text at the cursor position in the focused element
 * This uses kAXSelectedTextAttribute which replaces the current selection
 * (or inserts at cursor if nothing is selected)
 */
static BOOL insertTextAtCursor(AXUIElementRef element, NSString *text) {
    // Try setting the selected text (this inserts at cursor position)
    AXError error = AXUIElementSetAttributeValue(
        element,
        kAXSelectedTextAttribute,
        (__bridge CFTypeRef)text
    );
    
    if (error == kAXErrorSuccess) {
        return YES;
    }
    
    // If kAXSelectedTextAttribute fails, try alternative approaches
    fprintf(stderr, "WARNING: kAXSelectedTextAttribute failed (error: %d), trying fallback\n", error);
    
    // Fallback 1: Try to get current value and selection range, then modify
    CFTypeRef currentValue = NULL;
    CFTypeRef selectionRange = NULL;
    
    AXError getValueError = AXUIElementCopyAttributeValue(element, kAXValueAttribute, &currentValue);
    AXError getRangeError = AXUIElementCopyAttributeValue(element, kAXSelectedTextRangeAttribute, &selectionRange);
    
    if (getValueError == kAXErrorSuccess && currentValue && 
        CFGetTypeID(currentValue) == CFStringGetTypeID()) {
        
        NSString *currentString = (__bridge NSString *)currentValue;
        NSMutableString *newString = [currentString mutableCopy];
        
        // Get insertion point
        CFRange range = {0, 0};
        if (getRangeError == kAXErrorSuccess && selectionRange) {
            AXValueGetValue(selectionRange, kAXValueCFRangeType, &range);
        } else {
            // If no selection range, append at end
            range.location = [currentString length];
            range.length = 0;
        }
        
        // Insert text at the range
        if (range.location <= [newString length]) {
            NSRange nsRange = NSMakeRange(range.location, range.length);
            [newString replaceCharactersInRange:nsRange withString:text];
            
            // Set the new value
            error = AXUIElementSetAttributeValue(element, kAXValueAttribute, (__bridge CFTypeRef)newString);
            
            if (error == kAXErrorSuccess) {
                // Move cursor to end of inserted text
                CFRange newSelection = {range.location + [text length], 0};
                AXValueRef newSelectionValue = AXValueCreate(kAXValueCFRangeType, &newSelection);
                if (newSelectionValue) {
                    AXUIElementSetAttributeValue(element, kAXSelectedTextRangeAttribute, newSelectionValue);
                    CFRelease(newSelectionValue);
                }
                
                if (currentValue) CFRelease(currentValue);
                if (selectionRange) CFRelease(selectionRange);
                return YES;
            }
        }
    }
    
    if (currentValue) CFRelease(currentValue);
    if (selectionRange) CFRelease(selectionRange);
    
    fprintf(stderr, "ERROR: Could not insert text (error: %d)\n", error);
    return NO;
}

/**
 * Print usage information
 */
static void printUsage(const char* programName) {
    fprintf(stderr, "Usage: %s <text>\n", programName);
    fprintf(stderr, "\nInserts text at the cursor position in the focused text field.\n");
    fprintf(stderr, "Uses macOS Accessibility API - does NOT use clipboard.\n");
    fprintf(stderr, "\nRequires Accessibility permissions in System Settings.\n");
}

int main(int argc, char* argv[]) {
    @autoreleasepool {
        // Check arguments
        if (argc < 2) {
            printUsage(argv[0]);
            return 1;
        }
        
        // Check accessibility permissions
        if (!checkAccessibilityPermissions()) {
            fprintf(stderr, "ERROR: Accessibility permissions required.\n");
            fprintf(stderr, "Please enable this app in System Settings > Privacy & Security > Accessibility\n");
            return 2;
        }
        
        // Build the text string from arguments (join with spaces)
        NSMutableArray *args = [NSMutableArray array];
        for (int i = 1; i < argc; i++) {
            [args addObject:[NSString stringWithUTF8String:argv[i]]];
        }
        NSString *text = [args componentsJoinedByString:@" "];
        
        // Get the focused element
        AXUIElementRef focusedElement = getFocusedElement();
        if (!focusedElement) {
            fprintf(stderr, "ERROR: No focused element found. Make sure cursor is in a text field.\n");
            return 4;
        }
        
        // Insert the text
        BOOL success = insertTextAtCursor(focusedElement, text);
        
        // Cleanup
        CFRelease(focusedElement);
        
        if (success) {
            printf("OK\n");
            return 0;
        } else {
            return 5;
        }
    }
}
