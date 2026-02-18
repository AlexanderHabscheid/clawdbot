/**
 * Dictation text cleanup utility.
 *
 * Cleans up raw speech-to-text output for pasting into documents.
 * Handles common Deepgram quirks: double spaces, stutter words,
 * sentence casing, trailing fragments.
 */

/**
 * Clean up raw dictation transcript for pasting.
 * - Normalize whitespace
 * - Capitalize first letter of sentences
 * - Remove trailing incomplete fragments
 * - Fix common STT artifacts
 */
export function cleanupDictationText(text: string): string {
  if (!text?.trim()) {
    return "";
  }

  let cleaned = text;

  // Normalize whitespace: collapse multiple spaces, trim
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  // Remove common STT stutter artifacts ("I I want" → "I want")
  cleaned = cleaned.replace(/\b(\w+)\s+\1\b/gi, "$1");

  // Capitalize first letter
  cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);

  // Capitalize after sentence-ending punctuation
  cleaned = cleaned.replace(/([.!?])\s+([a-z])/g, (_match, punct: string, letter: string) => {
    return `${punct} ${letter.toUpperCase()}`;
  });

  // Remove trailing incomplete fragments (word without punctuation at end)
  // Only if the text has other complete sentences
  if (/[.!?]/.test(cleaned) && !/[.!?,;:]$/.test(cleaned)) {
    const lastPunctIdx = Math.max(
      cleaned.lastIndexOf("."),
      cleaned.lastIndexOf("!"),
      cleaned.lastIndexOf("?"),
    );
    if (lastPunctIdx > cleaned.length * 0.7) {
      cleaned = cleaned.slice(0, lastPunctIdx + 1);
    }
  }

  // Add period at end if missing and text looks like a complete sentence
  if (cleaned.length > 10 && !/[.!?]$/.test(cleaned)) {
    cleaned += ".";
  }

  return cleaned;
}
