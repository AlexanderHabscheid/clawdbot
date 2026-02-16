# Windows Text Inserter using UI Automation
# 
# This script inserts text directly into the focused text field
# WITHOUT using the system clipboard, using Windows UI Automation.
#
# Usage: powershell -ExecutionPolicy Bypass -File windows-text-inserter.ps1 "text to insert"
#
# Requires: .NET Framework (built into Windows)

param(
    [Parameter(Mandatory=$true, Position=0)]
    [string]$Text
)

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

function Insert-TextViaUIAutomation {
    param([string]$TextToInsert)
    
    try {
        # Get the focused element using UI Automation
        $focusedElement = [System.Windows.Automation.AutomationElement]::FocusedElement
        
        if ($null -eq $focusedElement) {
            Write-Error "ERROR: No focused element found"
            return $false
        }
        
        # Try ValuePattern first (best method - directly sets value)
        $valuePattern = $null
        $supportsValue = $focusedElement.TryGetCurrentPattern(
            [System.Windows.Automation.ValuePattern]::Pattern,
            [ref]$valuePattern
        )
        
        if ($supportsValue -and $null -ne $valuePattern) {
            # Check if the field is read-only
            if (-not $valuePattern.Current.IsReadOnly) {
                # Get current value and cursor position if possible
                $currentValue = $valuePattern.Current.Value
                
                # Try to get selection/insertion point via TextPattern
                $textPattern = $null
                $supportsText = $focusedElement.TryGetCurrentPattern(
                    [System.Windows.Automation.TextPattern]::Pattern,
                    [ref]$textPattern
                )
                
                if ($supportsText -and $null -ne $textPattern) {
                    # Get selection range
                    $selection = $textPattern.GetSelection()
                    if ($selection.Length -gt 0) {
                        # Has selection - would need to replace it
                        # For simplicity, append to current value
                        $valuePattern.SetValue($currentValue + $TextToInsert)
                        Write-Output "OK"
                        return $true
                    }
                }
                
                # Simple case: append to current value
                # Note: This doesn't insert at cursor, but appends
                # For cursor-position insertion, we fall back to SendKeys
                $valuePattern.SetValue($currentValue + $TextToInsert)
                Write-Output "OK"
                return $true
            }
        }
        
        # Fallback: Use SendKeys to type the text
        # This simulates keystrokes and inserts at cursor position
        Write-Host "Using SendKeys fallback..." -ForegroundColor Yellow
        
        # Escape special characters for SendKeys
        $escapedText = $TextToInsert -replace '([+^%~(){}])', '{$1}'
        $escapedText = $escapedText -replace '\[', '{[}'
        $escapedText = $escapedText -replace '\]', '{]}'
        
        [System.Windows.Forms.SendKeys]::SendWait($escapedText)
        Write-Output "OK"
        return $true
        
    } catch {
        Write-Error "ERROR: $($_.Exception.Message)"
        return $false
    }
}

# Main execution
$result = Insert-TextViaUIAutomation -TextToInsert $Text

if (-not $result) {
    exit 1
}
exit 0
