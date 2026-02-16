import { ChevronDown, Search, X, Check } from "lucide-react";
import React, { useState, useRef, useEffect } from "react";
import { LANGUAGE_OPTIONS, getLanguageLabel, getLanguageByCode } from "../../utils/languages";

interface LanguageSelectorProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  /** Use dark theme (for onboarding) */
  dark?: boolean;
  /** Show native language name alongside English name */
  showNativeName?: boolean;
}

export default function LanguageSelector({
  value,
  onChange,
  className = "",
  dark = false,
  showNativeName = true,
}: LanguageSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filteredLanguages = LANGUAGE_OPTIONS.filter(
    (lang) =>
      lang.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      lang.value.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (lang.nativeName && lang.nativeName.toLowerCase().includes(searchQuery.toLowerCase())),
  );

  // Get current language info
  const currentLanguage = getLanguageByCode(value);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [searchQuery]);

  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (isOpen && listRef.current) {
      const highlightedElement = listRef.current.children[highlightedIndex] as HTMLElement;
      if (highlightedElement) {
        highlightedElement.scrollIntoView({ block: "nearest" });
      }
    }
  }, [highlightedIndex, isOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchQuery("");
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightedIndex((prev) => (prev < filteredLanguages.length - 1 ? prev + 1 : 0));
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : filteredLanguages.length - 1));
        break;
      case "Enter":
        e.preventDefault();
        if (filteredLanguages[highlightedIndex]) {
          handleSelect(filteredLanguages[highlightedIndex].value);
        }
        break;
      case "Escape":
        e.preventDefault();
        setIsOpen(false);
        setSearchQuery("");
        break;
    }
  };

  const handleSelect = (languageValue: string) => {
    onChange(languageValue);
    setIsOpen(false);
    setSearchQuery("");
  };

  const clearSearch = () => {
    setSearchQuery("");
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  };

  // Dark theme classes (for onboarding)
  const buttonClasses = dark
    ? `w-full flex items-center justify-between px-4 py-3 border border-white/20 rounded-xl bg-black/50 text-left text-white hover:border-orange-500/50 focus:border-orange-500 focus:ring-1 focus:ring-orange-500/50 focus:outline-none transition-all ${
        isOpen ? "border-orange-500 ring-1 ring-orange-500/50" : ""
      }`
    : `w-full flex items-center justify-between px-3 py-2 border border-gray-300 rounded-md bg-white text-left hover:border-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none transition-colors ${
        isOpen ? "border-blue-500 ring-1 ring-blue-500" : ""
      }`;

  const dropdownClasses = dark
    ? "absolute z-50 w-full mt-2 bg-black/95 backdrop-blur-xl border border-white/20 rounded-xl shadow-2xl max-h-80 overflow-hidden"
    : "absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-hidden";

  const searchWrapperClasses = dark
    ? "p-3 border-b border-white/10"
    : "p-2 border-b border-gray-200";

  const searchInputClasses = dark
    ? "w-full pl-9 pr-8 py-2.5 text-sm border border-white/20 rounded-lg bg-white/5 text-white placeholder:text-white/40 focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/50 focus:outline-none"
    : "w-full pl-9 pr-8 py-2 text-sm border border-gray-300 rounded-md focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none";

  const iconClasses = dark ? "text-white/40" : "text-gray-400";

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={handleKeyDown}
        className={buttonClasses}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <div className="flex flex-col items-start">
          <span className="truncate font-medium">{getLanguageLabel(value)}</span>
          {showNativeName &&
            currentLanguage?.nativeName &&
            currentLanguage.nativeName !== currentLanguage.label && (
              <span className={`text-xs ${dark ? "text-white/50" : "text-gray-500"}`}>
                {currentLanguage.nativeName}
              </span>
            )}
        </div>
        <ChevronDown
          className={`w-5 h-5 ${iconClasses} transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isOpen && (
        <div className={dropdownClasses}>
          {/* Search input */}
          <div className={searchWrapperClasses}>
            <div className="relative">
              <Search
                className={`absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 ${iconClasses}`}
              />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search languages..."
                className={searchInputClasses}
              />
              {searchQuery && (
                <button
                  onClick={clearSearch}
                  className={`absolute right-3 top-1/2 transform -translate-y-1/2 ${iconClasses} hover:text-white/70`}
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Language list */}
          <div className={`overflow-y-auto ${dark ? "max-h-64" : "max-h-48"}`} ref={listRef}>
            {filteredLanguages.length === 0 ? (
              <div className={`px-4 py-3 text-sm ${dark ? "text-white/50" : "text-gray-500"}`}>
                No languages found
              </div>
            ) : (
              <div role="listbox">
                {filteredLanguages.map((language, index) => {
                  const isSelected = language.value === value;
                  const isHighlighted = index === highlightedIndex;

                  // Dark theme item classes
                  const itemClasses = dark
                    ? `w-full px-4 py-3 text-left flex items-center justify-between transition-colors ${
                        isSelected
                          ? "bg-orange-500/20 text-orange-400"
                          : isHighlighted
                            ? "bg-white/10 text-white"
                            : "text-white/80 hover:bg-white/5"
                      }`
                    : `w-full px-3 py-2 text-left text-sm hover:bg-gray-100 focus:bg-gray-100 focus:outline-none ${
                        isSelected ? "bg-blue-50 text-blue-700" : ""
                      } ${isHighlighted ? "bg-gray-100" : ""}`;

                  return (
                    <button
                      key={language.value}
                      type="button"
                      onClick={() => handleSelect(language.value)}
                      className={itemClasses}
                      role="option"
                      aria-selected={isSelected}
                    >
                      <div className="flex flex-col items-start">
                        <span className="font-medium">{language.label}</span>
                        {showNativeName &&
                          language.nativeName &&
                          language.nativeName !== language.label && (
                            <span className={`text-xs ${dark ? "text-white/40" : "text-gray-500"}`}>
                              {language.nativeName}
                            </span>
                          )}
                      </div>
                      {isSelected && (
                        <Check
                          className={`w-4 h-4 ${dark ? "text-orange-500" : "text-blue-500"}`}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
