/**
 * Language options for Centris AI
 * Used in onboarding for manual language selection
 * Language codes match Whisper's supported languages
 */

export interface LanguageOption {
  value: string; // ISO 639-1 language code
  label: string; // Display name
  nativeName?: string; // Name in native language
}

/**
 * Supported languages for transcription
 * Organized by region for easier browsing
 */
export const LANGUAGE_OPTIONS: LanguageOption[] = [
  // Major World Languages (most commonly used - shown first)
  { value: "en", label: "English", nativeName: "English" },
  { value: "es", label: "Spanish", nativeName: "Español" },
  { value: "fr", label: "French", nativeName: "Français" },
  { value: "de", label: "German", nativeName: "Deutsch" },
  { value: "it", label: "Italian", nativeName: "Italiano" },
  { value: "pt", label: "Portuguese", nativeName: "Português" },
  { value: "nl", label: "Dutch", nativeName: "Nederlands" },
  { value: "ru", label: "Russian", nativeName: "Русский" },
  { value: "zh", label: "Chinese (Mandarin)", nativeName: "中文" },
  { value: "ja", label: "Japanese", nativeName: "日本語" },
  { value: "ko", label: "Korean", nativeName: "한국어" },
  { value: "ar", label: "Arabic", nativeName: "العربية" },
  { value: "hi", label: "Hindi", nativeName: "हिन्दी" },
  { value: "bn", label: "Bengali", nativeName: "বাংলা" },
  { value: "tr", label: "Turkish", nativeName: "Türkçe" },
  { value: "vi", label: "Vietnamese", nativeName: "Tiếng Việt" },
  { value: "th", label: "Thai", nativeName: "ไทย" },
  { value: "id", label: "Indonesian", nativeName: "Bahasa Indonesia" },

  // European Languages
  { value: "pl", label: "Polish", nativeName: "Polski" },
  { value: "uk", label: "Ukrainian", nativeName: "Українська" },
  { value: "cs", label: "Czech", nativeName: "Čeština" },
  { value: "ro", label: "Romanian", nativeName: "Română" },
  { value: "hu", label: "Hungarian", nativeName: "Magyar" },
  { value: "el", label: "Greek", nativeName: "Ελληνικά" },
  { value: "sv", label: "Swedish", nativeName: "Svenska" },
  { value: "da", label: "Danish", nativeName: "Dansk" },
  { value: "no", label: "Norwegian", nativeName: "Norsk" },
  { value: "fi", label: "Finnish", nativeName: "Suomi" },
  { value: "bg", label: "Bulgarian", nativeName: "Български" },
  { value: "hr", label: "Croatian", nativeName: "Hrvatski" },
  { value: "sk", label: "Slovak", nativeName: "Slovenčina" },
  { value: "sl", label: "Slovenian", nativeName: "Slovenščina" },
  { value: "sr", label: "Serbian", nativeName: "Српски" },
  { value: "lt", label: "Lithuanian", nativeName: "Lietuvių" },
  { value: "lv", label: "Latvian", nativeName: "Latviešu" },
  { value: "et", label: "Estonian", nativeName: "Eesti" },
  { value: "ca", label: "Catalan", nativeName: "Català" },
  { value: "eu", label: "Basque", nativeName: "Euskara" },
  { value: "gl", label: "Galician", nativeName: "Galego" },
  { value: "is", label: "Icelandic", nativeName: "Íslenska" },
  { value: "cy", label: "Welsh", nativeName: "Cymraeg" },
  { value: "ga", label: "Irish", nativeName: "Gaeilge" },
  { value: "mt", label: "Maltese", nativeName: "Malti" },

  // Asian Languages
  { value: "ms", label: "Malay", nativeName: "Bahasa Melayu" },
  { value: "tl", label: "Filipino (Tagalog)", nativeName: "Tagalog" },
  { value: "ta", label: "Tamil", nativeName: "தமிழ்" },
  { value: "te", label: "Telugu", nativeName: "తెలుగు" },
  { value: "kn", label: "Kannada", nativeName: "ಕನ್ನಡ" },
  { value: "ml", label: "Malayalam", nativeName: "മലയാളം" },
  { value: "mr", label: "Marathi", nativeName: "मराठी" },
  { value: "gu", label: "Gujarati", nativeName: "ગુજરાતી" },
  { value: "pa", label: "Punjabi", nativeName: "ਪੰਜਾਬੀ" },
  { value: "ne", label: "Nepali", nativeName: "नेपाली" },
  { value: "si", label: "Sinhala", nativeName: "සිංහල" },
  { value: "my", label: "Burmese (Myanmar)", nativeName: "မြန်မာ" },
  { value: "km", label: "Khmer", nativeName: "ភាសាខ្មែរ" },
  { value: "lo", label: "Lao", nativeName: "ລາວ" },

  // Middle Eastern & African Languages
  { value: "he", label: "Hebrew", nativeName: "עברית" },
  { value: "fa", label: "Persian (Farsi)", nativeName: "فارسی" },
  { value: "ur", label: "Urdu", nativeName: "اردو" },
  { value: "sw", label: "Swahili", nativeName: "Kiswahili" },
  { value: "am", label: "Amharic", nativeName: "አማርኛ" },
  { value: "af", label: "Afrikaans", nativeName: "Afrikaans" },

  // Central Asian Languages
  { value: "az", label: "Azerbaijani", nativeName: "Azərbaycan" },
  { value: "ka", label: "Georgian", nativeName: "ქართული" },
  { value: "hy", label: "Armenian", nativeName: "Հայերdelays" },
  { value: "kk", label: "Kazakh", nativeName: "Қазақ" },
  { value: "uz", label: "Uzbek", nativeName: "Oʻzbek" },
  { value: "mn", label: "Mongolian", nativeName: "Монгол" },
];

/**
 * Get language label by code
 */
export function getLanguageLabel(code: string): string {
  const language = LANGUAGE_OPTIONS.find((lang) => lang.value === code);
  return language?.label || code.toUpperCase();
}

/**
 * Get language by code
 */
export function getLanguageByCode(code: string): LanguageOption | undefined {
  return LANGUAGE_OPTIONS.find((lang) => lang.value === code);
}

/**
 * Popular languages shown at top of selector
 * (Most commonly used for voice assistants)
 */
export const POPULAR_LANGUAGES = ["en", "es", "fr", "de", "zh", "ja", "ko", "pt", "ar", "hi"];

/**
 * Get popular languages as LanguageOption array
 */
export function getPopularLanguages(): LanguageOption[] {
  return POPULAR_LANGUAGES.map((code) =>
    LANGUAGE_OPTIONS.find((lang) => lang.value === code),
  ).filter((lang): lang is LanguageOption => lang !== undefined);
}

/**
 * Search languages by name or code
 */
export function searchLanguages(query: string): LanguageOption[] {
  const lowerQuery = query.toLowerCase();
  return LANGUAGE_OPTIONS.filter(
    (lang) =>
      lang.label.toLowerCase().includes(lowerQuery) ||
      lang.value.toLowerCase().includes(lowerQuery) ||
      (lang.nativeName && lang.nativeName.toLowerCase().includes(lowerQuery)),
  );
}
