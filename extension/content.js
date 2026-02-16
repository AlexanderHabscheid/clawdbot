// Centris AI Browser Control Extension - Content Script
// Injected into web pages for DOM access, visual feedback, and Reading Mode text extraction

console.log("[Centris Extension] Content script loaded");

// ============================================
// SPA DOM CHANGE DETECTION
// Detects major DOM changes in SPAs like Gmail to invalidate snapshot cache
// ============================================

let lastDomChangeTime = 0;
const DOM_CHANGE_DEBOUNCE_MS = 500;

/**
 * Set up MutationObserver to detect significant DOM changes in SPAs
 * This helps the backend know when to invalidate cached snapshots
 */
function setupDomChangeDetection() {
  const observer = new MutationObserver((mutations) => {
    const now = Date.now();

    // Debounce rapid changes
    if (now - lastDomChangeTime < DOM_CHANGE_DEBOUNCE_MS) {
      return;
    }

    // Check if this is a significant DOM change
    let addedNodes = 0;
    let removedNodes = 0;

    for (const mutation of mutations) {
      if (mutation.type === "childList") {
        addedNodes += mutation.addedNodes.length;
        removedNodes += mutation.removedNodes.length;
      }
    }

    // Significant change = more than 10 nodes added/removed
    const isSignificant = addedNodes > 10 || removedNodes > 10;

    if (isSignificant) {
      lastDomChangeTime = now;
      console.log("[Centris] Significant DOM change detected:", { addedNodes, removedNodes });

      // Notify background script to invalidate snapshot cache
      // FEB 2026 FIX: Wrap in try-catch to handle "Extension context invalidated" error
      // This happens when the extension is reloaded while content scripts are still running
      try {
        if (chrome.runtime?.id) {
          // Check extension context is still valid
          chrome.runtime
            .sendMessage({
              type: "centris_dom_changed",
              addedNodes,
              removedNodes,
              url: window.location.href,
              timestamp: now,
            })
            .catch(() => {
              // Background script may not be listening - that's ok
            });
        }
      } catch (e) {
        // Extension context invalidated - content script will be reloaded
        // Disconnect observer to prevent further errors
        observer.disconnect();
      }
    }
  });

  // Observe the document body for changes
  if (document.body) {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  } else {
    // Wait for body to be ready
    document.addEventListener("DOMContentLoaded", () => {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
    });
  }

  // Also detect SPA navigation via History API
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function (...args) {
    originalPushState.apply(this, args);
    notifyNavigation("pushState");
  };

  history.replaceState = function (...args) {
    originalReplaceState.apply(this, args);
    notifyNavigation("replaceState");
  };

  window.addEventListener("popstate", () => notifyNavigation("popstate"));
  window.addEventListener("hashchange", () => notifyNavigation("hashchange"));
}

function notifyNavigation(type) {
  console.log("[Centris] SPA navigation detected:", type, window.location.href);
  // FEB 2026 FIX: Wrap in try-catch to handle "Extension context invalidated" error
  try {
    if (chrome.runtime?.id) {
      // Check extension context is still valid
      chrome.runtime
        .sendMessage({
          type: "centris_spa_navigation",
          navigationMethod: type,
          url: window.location.href,
          timestamp: Date.now(),
        })
        .catch(() => {});
    }
  } catch (e) {
    // Extension context invalidated - ignore
  }
}

// Initialize DOM change detection
setupDomChangeDetection();

// ============================================
// SMART WAIT - Wait for DOM to stabilize
// Used by backend after click/navigate to ensure page is ready
// ============================================

/**
 * Wait for DOM to stabilize (no mutations for N ms)
 * This is MUCH smarter than static delays!
 *
 * @param {number} stableMs - How long DOM must be stable (default 100ms)
 * @param {number} timeoutMs - Max wait time (default 3000ms)
 * @returns {Promise<{stable: boolean, mutations: number, waitedMs: number}>}
 */
window.centrisWaitForDomStable = function (stableMs = 100, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let mutationCount = 0;
    let lastMutationTime = Date.now();
    let checkInterval = null;
    let observer = null;

    // Create a fresh observer for this wait
    observer = new MutationObserver((mutations) => {
      mutationCount += mutations.length;
      lastMutationTime = Date.now();

      // Log significant changes
      let addedNodes = 0;
      let removedNodes = 0;
      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          addedNodes += mutation.addedNodes.length;
          removedNodes += mutation.removedNodes.length;
        }
      }

      if (addedNodes > 5 || removedNodes > 5) {
        console.log("[Centris SmartWait] DOM changing:", { addedNodes, removedNodes });
      }
    });

    // Start observing
    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
    }

    // Check if DOM is stable
    checkInterval = setInterval(() => {
      const now = Date.now();
      const elapsed = now - startTime;
      const timeSinceLastMutation = now - lastMutationTime;

      // DOM is stable if no mutations for stableMs
      if (timeSinceLastMutation >= stableMs) {
        cleanup();
        console.log(
          `[Centris SmartWait] DOM stable after ${elapsed}ms (${mutationCount} mutations)`,
        );
        resolve({
          stable: true,
          mutations: mutationCount,
          waitedMs: elapsed,
        });
        return;
      }

      // Timeout - return anyway
      if (elapsed >= timeoutMs) {
        cleanup();
        console.log(
          `[Centris SmartWait] Timeout after ${elapsed}ms (${mutationCount} mutations still happening)`,
        );
        resolve({
          stable: false,
          mutations: mutationCount,
          waitedMs: elapsed,
          timeout: true,
        });
        return;
      }
    }, 20); // Check every 20ms

    function cleanup() {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (checkInterval) {
        clearInterval(checkInterval);
        checkInterval = null;
      }
    }
  });
};

/**
 * Wait for specific condition (element appears, text changes, etc.)
 * Even smarter than DOM stable - waits for specific signal
 *
 * @param {string} condition - 'element_exists' | 'element_visible' | 'text_changed'
 * @param {string} selector - CSS selector or text to match
 * @param {number} timeoutMs - Max wait time
 * @returns {Promise<{found: boolean, waitedMs: number}>}
 */
window.centrisWaitForCondition = function (condition, selector, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const startTime = Date.now();

    const checkCondition = () => {
      const elapsed = Date.now() - startTime;

      let found = false;
      switch (condition) {
        case "element_exists":
          found = !!document.querySelector(selector);
          break;
        case "element_visible":
          const el = document.querySelector(selector);
          if (el) {
            const rect = el.getBoundingClientRect();
            found = rect.width > 0 && rect.height > 0;
          }
          break;
        case "url_contains":
          found = window.location.href.includes(selector);
          break;
        case "url_changed":
          // selector is the old URL
          found = window.location.href !== selector;
          break;
      }

      if (found) {
        console.log(`[Centris SmartWait] Condition '${condition}' met after ${elapsed}ms`);
        resolve({ found: true, waitedMs: elapsed });
        return true;
      }

      if (elapsed >= timeoutMs) {
        console.log(`[Centris SmartWait] Condition '${condition}' timeout after ${elapsed}ms`);
        resolve({ found: false, waitedMs: elapsed, timeout: true });
        return true;
      }

      return false;
    };

    // Check immediately
    if (checkCondition()) {
      return;
    }

    // Then poll
    const interval = setInterval(() => {
      if (checkCondition()) {
        clearInterval(interval);
      }
    }, 50);
  });
};

// ============================================
// READING MODE - Text Extraction for TTS
// ============================================

/**
 * Extract readable content from the current page.
 * Uses Readability-like algorithm to find main content.
 * Priority: Selected text > Article content > Email body > Page content
 *
 * IMPORTANT: This extracts ACTUAL TEXT content, not UI elements!
 * The goal is to get clean, readable text that can be spoken via TTS.
 */
function extractReadableContent() {
  // Priority 1: Selected text (user explicitly selected what they want read)
  const selection = window.getSelection().toString().trim();
  if (selection && selection.length > 10) {
    console.log("[Centris Reading] Found selected text:", selection.length, "chars");
    return {
      type: "selection",
      text: cleanTextForReading(selection),
      title: document.title,
      source: "selection",
      wordCount: countWords(selection),
    };
  }

  // Priority 2: Gmail email body
  if (window.location.hostname.includes("mail.google.com")) {
    const emailBody = document.querySelector(".a3s.aiL"); // Gmail email body class
    if (emailBody) {
      console.log("[Centris Reading] Found Gmail email body");
      const cleanedText = cleanTextForReading(emailBody.innerText);
      return {
        type: "email",
        text: cleanedText,
        title: getEmailSubject(),
        source: "gmail",
        wordCount: countWords(cleanedText),
      };
    }
  }

  // Priority 3: Outlook email body
  if (window.location.hostname.includes("outlook")) {
    const emailBody =
      document.querySelector('[aria-label="Message body"]') ||
      document.querySelector(".allowTextSelection");
    if (emailBody) {
      console.log("[Centris Reading] Found Outlook email body");
      const cleanedText = cleanTextForReading(emailBody.innerText);
      return {
        type: "email",
        text: cleanedText,
        title: getEmailSubject(),
        source: "outlook",
        wordCount: countWords(cleanedText),
      };
    }
  }

  // Priority 4: PDF viewer detection
  if (isPDFPage()) {
    console.log("[Centris Reading] Detected PDF page - will need backend extraction");
    return {
      type: "pdf",
      text: "", // Backend will handle PDF extraction
      title: document.title,
      source: "pdf",
      url: window.location.href,
      needsBackendExtraction: true,
    };
  }

  // Priority 5: Article content (using comprehensive selectors)
  const articleSelectors = [
    // Semantic HTML5
    "article",
    '[role="main"]',
    "main",
    // Common article classes
    ".article-content",
    ".article-body",
    ".article__content",
    ".article__body",
    ".post-content",
    ".post-body",
    ".entry-content",
    ".content-body",
    "#article-body",
    ".story-body",
    ".story-content",
    ".blog-content",
    ".article-text",
    ".body-content",
    // News sites
    '[data-testid="article-body"]',
    '[data-component="text-block"]',
    ".text-block",
    // Medium
    ".postArticle-content",
    // Substack
    ".post-content",
    ".body",
    // Reddit
    ".Post__content",
    '[data-test-id="post-content"]',
    // Documentation sites
    ".markdown-body",
    ".documentation-content",
    ".doc-content",
    // Generic content containers
    "#content",
    ".content",
    "#main-content",
    ".main-content",
  ];

  for (const selector of articleSelectors) {
    const element = document.querySelector(selector);
    if (element) {
      const text = extractTextFromElement(element);
      if (text && text.length > 200) {
        console.log(
          "[Centris Reading] Found article content via:",
          selector,
          `(${text.length} chars)`,
        );
        return {
          type: "article",
          text: text,
          title: getArticleTitle() || document.title,
          source: "article",
          selector: selector,
          wordCount: countWords(text),
        };
      }
    }
  }

  // Priority 6: Readability.js extraction (best for complex pages)
  if (typeof Readability !== "undefined") {
    try {
      const documentClone = document.cloneNode(true);
      const reader = new Readability(documentClone);
      const article = reader.parse();
      if (article && article.textContent && article.textContent.length > 200) {
        console.log("[Centris Reading] Extracted via Readability.js");
        const cleanedText = cleanTextForReading(article.textContent);
        return {
          type: "article",
          text: cleanedText,
          title: article.title || document.title,
          source: "readability",
          byline: article.byline,
          excerpt: article.excerpt,
          wordCount: countWords(cleanedText),
        };
      }
    } catch (e) {
      console.warn("[Centris Reading] Readability.js failed:", e);
    }
  }

  // Priority 7: Smart body extraction (avoid UI elements)
  console.log("[Centris Reading] Using smart body extraction");
  const bodyText = extractSmartBodyText();
  return {
    type: "page",
    text: bodyText,
    title: document.title,
    source: "body",
    wordCount: countWords(bodyText),
  };
}

/**
 * Check if current page is displaying a PDF
 */
function isPDFPage() {
  // Chrome's built-in PDF viewer
  if (document.querySelector('embed[type="application/pdf"]')) {
    return true;
  }
  if (document.querySelector('embed[src*=".pdf"]')) {
    return true;
  }
  // URL ends with .pdf
  if (window.location.pathname.toLowerCase().endsWith(".pdf")) {
    return true;
  }
  // PDF.js viewer
  if (document.getElementById("viewerContainer") && document.querySelector(".pdfViewer")) {
    return true;
  }
  return false;
}

/**
 * Extract text from an element, filtering out UI noise
 */
function extractTextFromElement(element) {
  if (!element) {
    return "";
  }

  // Clone to avoid modifying the DOM
  const clone = element.cloneNode(true);

  // Remove UI elements that shouldn't be read
  const uiSelectors = [
    "nav",
    "header",
    "footer",
    "aside",
    '[role="navigation"]',
    '[role="banner"]',
    '[role="complementary"]',
    ".nav",
    ".navigation",
    ".menu",
    ".sidebar",
    ".widget",
    ".advertisement",
    ".ad",
    ".ads",
    ".ad-container",
    ".social-share",
    ".share-buttons",
    ".sharing",
    ".comments",
    ".comment-section",
    "#comments",
    ".related-posts",
    ".related-articles",
    ".newsletter",
    ".subscribe",
    ".subscription",
    ".popup",
    ".modal",
    ".overlay",
    "script",
    "style",
    "noscript",
    "iframe",
    "button",
    "input",
    "select",
    "textarea",
    "[hidden]",
    '[aria-hidden="true"]',
    ".hidden",
    ".invisible",
    ".sr-only",
    ".breadcrumb",
    ".breadcrumbs",
    ".pagination",
    ".pager",
    ".tags",
    ".tag-list",
    ".categories",
    ".author-bio",
    ".author-info",
    ".table-of-contents",
    ".toc",
    "figure figcaption", // Keep figures but remove captions for cleaner reading
  ];

  uiSelectors.forEach((selector) => {
    clone.querySelectorAll(selector).forEach((el) => el.remove());
  });

  // Get text and clean it
  return cleanTextForReading(clone.innerText);
}

/**
 * Smart body text extraction - finds the most content-rich area
 */
function extractSmartBodyText() {
  // Find all potential content containers
  const candidates = [];
  const allElements = document.querySelectorAll("div, section, article, main");

  allElements.forEach((el) => {
    // Skip small elements
    if (el.innerText.length < 200) {
      return;
    }

    // Skip UI-heavy elements
    const className = el.className.toLowerCase();
    const id = (el.id || "").toLowerCase();
    if (/nav|menu|sidebar|footer|header|ad|comment|share|social/.test(className + id)) {
      return;
    }

    // Score based on paragraph density and text length
    const paragraphs = el.querySelectorAll("p");
    const textLength = el.innerText.length;
    const paragraphText = Array.from(paragraphs).reduce((sum, p) => sum + p.innerText.length, 0);
    const paragraphDensity = paragraphText / textLength;

    // Higher score = more likely to be main content
    const score = paragraphDensity * textLength;

    if (score > 500) {
      candidates.push({ element: el, score });
    }
  });

  // Sort by score and get the best candidate
  candidates.sort((a, b) => b.score - a.score);

  if (candidates.length > 0) {
    return extractTextFromElement(candidates[0].element);
  }

  // Fallback to body with aggressive cleaning
  return cleanTextForReading(document.body.innerText);
}

/**
 * Get article title from various sources
 */
function getArticleTitle() {
  // Try h1 first
  const h1 = document.querySelector("h1");
  if (h1 && h1.innerText.trim().length > 5) {
    return h1.innerText.trim();
  }

  // Try meta tags
  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle) {
    return ogTitle.content;
  }

  const twitterTitle = document.querySelector('meta[name="twitter:title"]');
  if (twitterTitle) {
    return twitterTitle.content;
  }

  // Fall back to document title (cleaned)
  let title = document.title;
  // Remove common suffixes like " - Site Name" or " | Site Name"
  title = title.replace(/\s*[-|]\s*[^-|]+$/, "").trim();
  return title;
}

/**
 * Count words in text
 */
function countWords(text) {
  if (!text) {
    return 0;
  }
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

/**
 * Clean extracted text for TTS playback
 * This is CRITICAL for good reading mode - we want clean, natural text.
 */
function cleanTextForReading(text) {
  if (!text) {
    return "";
  }

  let cleaned = text
    // Normalize line endings
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")

    // Remove excessive whitespace
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")

    // Remove common UI text patterns (entire lines)
    .replace(
      /^(Skip to|Jump to|Menu|Navigation|Search|Sign in|Log in|Log out|Subscribe|Advertisement|Loading|Share|Comment|Reply|Back to top|Close|Dismiss|Accept|Decline|Next|Previous|Page \d+).*$/gim,
      "",
    )

    // Remove "Read more" type links
    .replace(
      /^(Read more|Continue reading|See more|Show more|View all|Load more|Expand|Collapse|Click here|Learn more|Find out more).*$/gim,
      "",
    )

    // Remove social sharing prompts
    .replace(
      /^(Share on|Share via|Tweet|Pin it|Share this|Follow us|Like us|Join us|Connect with us).*$/gim,
      "",
    )

    // Remove cookie/privacy notices
    .replace(
      /^(We use cookies|This site uses cookies|Accept cookies|Privacy policy|Cookie policy|By continuing|Accept all|Reject all).*$/gim,
      "",
    )

    // Remove newsletter/subscription prompts
    .replace(
      /^(Subscribe to|Sign up for|Get our newsletter|Enter your email|Join our mailing list).*$/gim,
      "",
    )

    // Remove timestamps and dates at start of lines (often UI noise)
    .replace(/^\d{1,2}:\d{2}\s*(AM|PM|am|pm)?\s*$/gim, "")

    // Remove "Posted on", "Updated", etc.
    .replace(
      /^(Posted|Published|Updated|Written|By|Author|Source|Credit|Photo|Image|Video|Audio):/gim,
      "",
    )

    // Remove URLs (including markdown-style links)
    .replace(/https?:\/\/[^\s)]+/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // [text](url) -> text
    // Remove email addresses
    .replace(/[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}/g, "")

    // Remove phone numbers (various formats)
    .replace(/(\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, "")

    // Remove social media handles
    .replace(/@[\w]+/g, "")

    // Remove hashtags
    .replace(/#[\w]+/g, "")

    // Remove common footer text
    .replace(/^(Copyright|All rights reserved|Terms of service|Privacy|Disclaimer).*$/gim, "")

    // Remove single-word lines that are likely UI elements
    .replace(
      /^(Home|About|Contact|Help|FAQ|Support|Settings|Profile|Account|Cart|Checkout|Login|Logout|Register|Signup)$/gim,
      "",
    )

    // Remove bullet points and list markers at start of paragraphs (keep content)
    .replace(/^[\s]*[-*•●○◦▪▸►][\s]+/gm, "")
    .replace(/^[\s]*\d+[.)]\s+/gm, "")

    // Clean up quotes and special characters for TTS
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .replace(/…/g, "...")
    .replace(/–/g, "-")
    .replace(/—/g, " - ")

    // Remove multiple periods (like "...")
    .replace(/\.{3,}/g, "...")

    // Remove lines that are just punctuation or symbols
    .replace(/^[\s\-_=*#~|]+$/gm, "")

    // Remove empty parentheses and brackets
    .replace(/\(\s*\)/g, "")
    .replace(/\[\s*\]/g, "")

    // Remove image alt text patterns
    .replace(/\[Image:.*?\]/gi, "")
    .replace(/\[Photo:.*?\]/gi, "")

    // Final whitespace cleanup
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s+|\s+$/g, "")
    .replace(/\n\s+\n/g, "\n\n");

  // Remove very short paragraphs (likely UI remnants)
  const paragraphs = cleaned.split("\n\n");
  const filteredParagraphs = paragraphs.filter((p) => {
    const trimmed = p.trim();
    // Keep paragraphs with at least 20 chars or multiple words
    return trimmed.length >= 20 || trimmed.split(/\s+/).length >= 4;
  });

  return filteredParagraphs.join("\n\n").trim();
}

/**
 * Get email subject for context
 */
function getEmailSubject() {
  // Gmail subject
  const gmailSubject = document.querySelector("h2.hP");
  if (gmailSubject) {
    return gmailSubject.innerText;
  }

  // Outlook subject
  const outlookSubject =
    document.querySelector('[aria-label="Subject"]') ||
    document.querySelector('.allowTextSelection[role="heading"]');
  if (outlookSubject) {
    return outlookSubject.innerText;
  }

  // Yahoo Mail subject
  const yahooSubject = document.querySelector('[data-test-id="message-subject"]');
  if (yahooSubject) {
    return yahooSubject.innerText;
  }

  return document.title;
}

/**
 * Get specific text element by coordinates (for "read from here")
 */
function getTextAtPosition(x, y) {
  const element = document.elementFromPoint(x, y);
  if (!element) {
    return null;
  }

  // Get the closest text container
  const textContainer = element.closest(
    "p, div, span, li, td, h1, h2, h3, h4, h5, h6, article, section",
  );
  if (textContainer) {
    return {
      text: textContainer.innerText,
      element: textContainer.tagName.toLowerCase(),
    };
  }

  return {
    text: element.innerText,
    element: element.tagName.toLowerCase(),
  };
}

/**
 * Get text content from a specific section (paragraph, heading, etc.)
 */
function getTextFromSection(sectionType) {
  const sections = {
    "first-paragraph": () => document.querySelector("p")?.innerText,
    headings: () =>
      Array.from(document.querySelectorAll("h1, h2, h3"))
        .map((h) => h.innerText)
        .join("\n\n"),
    lists: () =>
      Array.from(document.querySelectorAll("ul, ol"))
        .map((l) => l.innerText)
        .join("\n\n"),
  };

  const getter = sections[sectionType];
  return getter ? getter() : null;
}

// =============================================================================
// BROWSEROSS-STYLE VISUAL FEEDBACK SYSTEM
// Shows the user what actions are happening in real-time
// =============================================================================

// Inject styles for visual feedback (only once)
function injectCentrisStyles() {
  if (document.querySelector("#centris-visual-styles")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "centris-visual-styles";
  style.textContent = `
    /* Animated cursor indicator */
    @keyframes centris-ripple {
      0% { transform: translate(-50%, -50%) scale(0.3); opacity: 0.7; }
      100% { transform: translate(-50%, -50%) scale(2.5); opacity: 0; }
    }
    
    @keyframes centris-pulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.2); opacity: 0.8; }
    }
    
    @keyframes centris-typing-cursor {
      0%, 100% { opacity: 1; }
      50% { opacity: 0; }
    }
    
    @keyframes centris-highlight-fade {
      0% { box-shadow: 0 0 0 3px rgba(252, 102, 26, 0.8), 0 0 20px rgba(252, 102, 26, 0.4); }
      100% { box-shadow: 0 0 0 3px rgba(252, 102, 26, 0), 0 0 20px rgba(252, 102, 26, 0); }
    }
    
    .centris-cursor-indicator {
      position: fixed;
      pointer-events: none;
      z-index: 999999;
      transition: transform 250ms cubic-bezier(.2,.7,.2,1);
    }
    
    .centris-cursor {
      width: 0;
      height: 0;
      border-style: solid;
      border-width: 0 8px 16px 8px;
      border-color: transparent transparent #FC661A transparent;
      filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3)) drop-shadow(0 0 6px rgba(252,102,26,0.5));
    }
    
    .centris-ripple {
      position: absolute;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(252,102,26,0.6) 0%, rgba(252,102,26,0) 70%);
      left: 4px;
      top: 16px;
      animation: centris-ripple 600ms ease-out forwards;
    }
    
    .centris-element-highlight {
      position: fixed;
      pointer-events: none;
      z-index: 999998;
      border-radius: 4px;
      background: rgba(252, 102, 26, 0.1);
      box-shadow: 0 0 0 3px rgba(252, 102, 26, 0.8), 0 0 20px rgba(252, 102, 26, 0.4);
      animation: centris-highlight-fade 2s ease-out forwards;
    }
    
    .centris-typing-indicator {
      position: fixed;
      pointer-events: none;
      z-index: 999999;
      background: rgba(252, 102, 26, 0.9);
      color: white;
      padding: 4px 10px;
      border-radius: 4px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 12px;
      font-weight: 500;
      box-shadow: 0 2px 10px rgba(0,0,0,0.2);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    
    .centris-typing-indicator::after {
      content: '|';
      animation: centris-typing-cursor 0.8s infinite;
    }
    
    .centris-action-toast {
      position: fixed;
      bottom: 80px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.85);
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      font-weight: 500;
      z-index: 999999;
      pointer-events: none;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      display: flex;
      align-items: center;
      gap: 10px;
      opacity: 0;
      animation: centris-toast-in 0.3s ease-out forwards;
    }
    
    @keyframes centris-toast-in {
      0% { opacity: 0; transform: translateX(-50%) translateY(20px); }
      100% { opacity: 1; transform: translateX(-50%) translateY(0); }
    }
    
    @keyframes centris-toast-out {
      0% { opacity: 1; transform: translateX(-50%) translateY(0); }
      100% { opacity: 0; transform: translateX(-50%) translateY(-10px); }
    }
  `;
  document.head.appendChild(style);
}

// Show animated cursor moving to click location (BrowserOS-style)
window.centrisShowClick = function (x, y, startX = null, startY = null) {
  injectCentrisStyles();

  // Remove existing indicators
  document.querySelectorAll(".centris-cursor-indicator").forEach((e) => e.remove());

  // Create cursor container
  const container = document.createElement("div");
  container.className = "centris-cursor-indicator";

  // Start position (center of viewport if not specified)
  const fromX = startX !== null ? startX : window.innerWidth / 2;
  const fromY = startY !== null ? startY : window.innerHeight / 2;

  container.style.left = "0";
  container.style.top = "0";
  container.style.transform = `translate(${fromX}px, ${fromY}px)`;

  // Create cursor triangle
  const cursor = document.createElement("div");
  cursor.className = "centris-cursor";
  container.appendChild(cursor);

  document.body.appendChild(container);

  // Animate to target position
  requestAnimationFrame(() => {
    container.style.transform = `translate(${x}px, ${y}px)`;
  });

  // After cursor arrives, show ripple
  setTimeout(() => {
    const ripple = document.createElement("div");
    ripple.className = "centris-ripple";
    container.appendChild(ripple);

    // Fade out and remove after animation
    setTimeout(() => {
      container.style.transition = "opacity 300ms ease-out";
      container.style.opacity = "0";
      setTimeout(() => container.remove(), 350);
    }, 500);
  }, 250);
};

// Highlight an element being interacted with
window.centrisHighlightElement = function (x, y, width, height) {
  injectCentrisStyles();

  // Remove existing highlights
  document.querySelectorAll(".centris-element-highlight").forEach((e) => e.remove());

  const highlight = document.createElement("div");
  highlight.className = "centris-element-highlight";
  highlight.style.left = `${x}px`;
  highlight.style.top = `${y}px`;
  highlight.style.width = `${width}px`;
  highlight.style.height = `${height}px`;

  document.body.appendChild(highlight);

  // Remove after animation
  setTimeout(() => highlight.remove(), 2000);
};

// Show typing indicator
window.centrisShowTyping = function (x, y, text) {
  injectCentrisStyles();

  // Remove existing typing indicators
  document.querySelectorAll(".centris-typing-indicator").forEach((e) => e.remove());

  const indicator = document.createElement("div");
  indicator.className = "centris-typing-indicator";
  indicator.style.left = `${x + 10}px`;
  indicator.style.top = `${y - 30}px`;

  // Show truncated text preview
  const displayText = text.length > 30 ? text.substring(0, 30) + "..." : text;
  indicator.textContent = `Typing: "${displayText}"`;

  document.body.appendChild(indicator);

  // Remove after typing would be complete
  const typingDuration = Math.min(text.length * 50, 2000);
  setTimeout(() => {
    indicator.style.transition = "opacity 300ms";
    indicator.style.opacity = "0";
    setTimeout(() => indicator.remove(), 300);
  }, typingDuration);
};

// Show action toast at bottom of screen
window.centrisShowActionToast = function (message, icon = "⚡") {
  injectCentrisStyles();

  // Remove existing toasts
  document.querySelectorAll(".centris-action-toast").forEach((e) => e.remove());

  const toast = document.createElement("div");
  toast.className = "centris-action-toast";
  toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;

  document.body.appendChild(toast);

  // Fade out and remove
  setTimeout(() => {
    toast.style.animation = "centris-toast-out 0.3s ease-in forwards";
    setTimeout(() => toast.remove(), 300);
  }, 2000);
};

// Clean up all visual indicators
window.centrisClearVisuals = function () {
  document.querySelectorAll(".centris-cursor-indicator").forEach((e) => e.remove());
  document.querySelectorAll(".centris-element-highlight").forEach((e) => e.remove());
  document.querySelectorAll(".centris-typing-indicator").forEach((e) => e.remove());
  document.querySelectorAll(".centris-action-toast").forEach((e) => e.remove());
};

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Ping handler for checking if content script is loaded
  if (message.type === "ping") {
    sendResponse({ pong: true, url: window.location.href });
    return true;
  }

  if (message.type === "get_dom_info") {
    sendResponse({
      url: window.location.href,
      title: document.title,
      readyState: document.readyState,
    });
  }

  // =========================================
  // READING MODE - Text Extraction Messages
  // =========================================

  if (message.action === "getReadableContent" || message.type === "centris_get_readable_content") {
    try {
      const content = extractReadableContent();
      console.log(
        "[Centris Reading] Extracted content:",
        content.type,
        content.text.length,
        "chars",
      );
      sendResponse({
        success: true,
        ...content,
      });
    } catch (error) {
      console.error("[Centris Reading] Extraction error:", error);
      sendResponse({
        success: false,
        error: error.message,
      });
    }
    return true;
  }

  if (message.type === "centris_get_selected_text") {
    const selection = window.getSelection().toString().trim();
    sendResponse({
      success: !!selection,
      text: selection,
      length: selection.length,
    });
    return true;
  }

  if (message.type === "centris_get_text_at_position") {
    const result = getTextAtPosition(message.x, message.y);
    sendResponse({
      success: !!result,
      ...result,
    });
    return true;
  }

  if (message.type === "centris_get_section_text") {
    const text = getTextFromSection(message.sectionType);
    sendResponse({
      success: !!text,
      text: text,
    });
    return true;
  }

  // Visual feedback commands from background.js
  if (message.type === "centris_show_click") {
    window.centrisShowClick(message.x, message.y, message.startX, message.startY);
    sendResponse({ success: true });
  }

  if (message.type === "centris_highlight_element") {
    window.centrisHighlightElement(message.x, message.y, message.width, message.height);
    sendResponse({ success: true });
  }

  if (message.type === "centris_show_typing") {
    window.centrisShowTyping(message.x, message.y, message.text);
    sendResponse({ success: true });
  }

  if (message.type === "centris_show_toast") {
    window.centrisShowActionToast(message.message, message.icon);
    sendResponse({ success: true });
  }

  if (message.type === "centris_clear_visuals") {
    window.centrisClearVisuals();
    sendResponse({ success: true });
  }

  // Reading mode visual feedback
  if (message.type === "centris_show_reading_indicator") {
    showReadingIndicator(message.title, message.progress);
    sendResponse({ success: true });
  }

  if (message.type === "centris_hide_reading_indicator") {
    hideReadingIndicator();
    sendResponse({ success: true });
  }

  // ═══════════════════════════════════════════════════════════════════
  // SMART WAIT COMMANDS - Replace static delays with condition-based waits
  // ═══════════════════════════════════════════════════════════════════

  if (message.type === "centris_wait_for_dom_stable") {
    const stableMs = message.stableMs || 100;
    const timeoutMs = message.timeoutMs || 3000;

    window.centrisWaitForDomStable(stableMs, timeoutMs).then((result) => {
      sendResponse(result);
    });
    return true; // Async response
  }

  if (message.type === "centris_wait_for_condition") {
    const { condition, selector, timeoutMs } = message;

    window.centrisWaitForCondition(condition, selector, timeoutMs || 3000).then((result) => {
      sendResponse(result);
    });
    return true; // Async response
  }

  // ═══════════════════════════════════════════════════════════════════
  // ELEMENT OVERLAY VISUALIZATION - Show what AI sees
  // ═══════════════════════════════════════════════════════════════════

  if (message.type === "centris_show_elements_overlay") {
    window.centrisShowElementsOverlay(message.elements || []);
    sendResponse({ success: true, count: (message.elements || []).length });
    return true;
  }

  if (message.type === "centris_hide_elements_overlay") {
    window.centrisHideElementsOverlay();
    sendResponse({ success: true });
    return true;
  }

  if (message.type === "centris_toggle_elements_overlay") {
    window.centrisToggleElementsOverlay(message.elements || []);
    sendResponse({ success: true, visible: elementsOverlayVisible });
    return true;
  }

  return true; // Keep message channel open for async response
});

// ============================================
// READING MODE - Visual Indicators
// ============================================

let readingIndicatorElement = null;

/**
 * Show reading mode indicator on the page
 */
function showReadingIndicator(title = "Reading...", progress = 0) {
  injectCentrisStyles();
  hideReadingIndicator(); // Remove existing

  const indicator = document.createElement("div");
  indicator.id = "centris-reading-indicator";
  indicator.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: rgba(0, 0, 0, 0.85);
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    z-index: 999999;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 200px;
  `;

  indicator.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px;">
      <span style="font-size: 18px;">📖</span>
      <span style="font-weight: 500;">${title}</span>
    </div>
    <div style="background: rgba(255,255,255,0.2); border-radius: 4px; height: 4px; overflow: hidden;">
      <div id="centris-reading-progress" style="
        background: #FC661A;
        height: 100%;
        width: ${progress}%;
        transition: width 0.3s ease;
      "></div>
    </div>
    <div style="font-size: 12px; opacity: 0.7;">
      Say "pause", "stop", or "faster" to control
    </div>
  `;

  document.body.appendChild(indicator);
  readingIndicatorElement = indicator;
}

/**
 * Update reading progress
 */
function updateReadingProgress(progress) {
  const progressBar = document.getElementById("centris-reading-progress");
  if (progressBar) {
    progressBar.style.width = `${progress}%`;
  }
}

/**
 * Hide reading indicator
 */
function hideReadingIndicator() {
  if (readingIndicatorElement) {
    readingIndicatorElement.remove();
    readingIndicatorElement = null;
  }
  const existing = document.getElementById("centris-reading-indicator");
  if (existing) {
    existing.remove();
  }
}

// ============================================
// INTERACTIVE ELEMENT VISUALIZATION
// Shows exactly what the AI sees on the page
// ============================================

let elementsOverlayVisible = false;
let elementsOverlayContainer = null;

/**
 * Inject styles for element visualization
 */
function injectElementOverlayStyles() {
  if (document.querySelector("#centris-element-overlay-styles")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "centris-element-overlay-styles";
  style.textContent = `
    .centris-elements-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 999990;
    }
    
    .centris-element-box {
      position: absolute;
      border: 2px solid;
      border-radius: 3px;
      pointer-events: none;
      box-sizing: border-box;
    }
    
    .centris-element-box.type-clickable {
      border-color: rgba(34, 197, 94, 0.8);
      background: rgba(34, 197, 94, 0.1);
    }
    
    .centris-element-box.type-typeable {
      border-color: rgba(59, 130, 246, 0.8);
      background: rgba(59, 130, 246, 0.1);
    }
    
    .centris-element-box.type-selectable {
      border-color: rgba(168, 85, 247, 0.8);
      background: rgba(168, 85, 247, 0.1);
    }
    
    .centris-element-box.type-other {
      border-color: rgba(156, 163, 175, 0.8);
      background: rgba(156, 163, 175, 0.1);
    }
    
    .centris-element-label {
      position: absolute;
      top: -18px;
      left: -2px;
      background: rgba(0, 0, 0, 0.85);
      color: white;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
      font-size: 10px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 3px 3px 0 0;
      white-space: nowrap;
      max-width: 250px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    
    .centris-element-label.type-clickable {
      background: rgba(34, 197, 94, 0.9);
    }
    
    .centris-element-label.type-typeable {
      background: rgba(59, 130, 246, 0.9);
    }
    
    .centris-element-label.type-selectable {
      background: rgba(168, 85, 247, 0.9);
    }
    
    .centris-element-id {
      position: absolute;
      bottom: -16px;
      right: -2px;
      background: rgba(0, 0, 0, 0.9);
      color: #FC661A;
      font-family: monospace;
      font-size: 9px;
      font-weight: bold;
      padding: 1px 4px;
      border-radius: 0 0 3px 3px;
    }
    
    .centris-elements-legend {
      position: fixed;
      top: 10px;
      right: 10px;
      background: rgba(0, 0, 0, 0.9);
      color: white;
      padding: 12px 16px;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 12px;
      z-index: 999999;
      pointer-events: auto;
      box-shadow: 0 4px 20px rgba(0,0,0,0.4);
      min-width: 180px;
    }
    
    .centris-elements-legend h3 {
      margin: 0 0 10px 0;
      font-size: 14px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .centris-elements-legend .legend-item {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 6px 0;
    }
    
    .centris-elements-legend .legend-color {
      width: 14px;
      height: 14px;
      border-radius: 3px;
      border: 2px solid;
    }
    
    .centris-elements-legend .legend-color.clickable {
      border-color: #22c55e;
      background: rgba(34, 197, 94, 0.3);
    }
    
    .centris-elements-legend .legend-color.typeable {
      border-color: #3b82f6;
      background: rgba(59, 130, 246, 0.3);
    }
    
    .centris-elements-legend .legend-color.selectable {
      border-color: #a855f7;
      background: rgba(168, 85, 247, 0.3);
    }
    
    .centris-elements-legend .close-btn {
      position: absolute;
      top: 8px;
      right: 8px;
      background: transparent;
      border: none;
      color: rgba(255,255,255,0.6);
      font-size: 18px;
      cursor: pointer;
      padding: 2px 6px;
      line-height: 1;
    }
    
    .centris-elements-legend .close-btn:hover {
      color: white;
    }
    
    .centris-elements-legend .stats {
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid rgba(255,255,255,0.2);
      font-size: 11px;
      color: rgba(255,255,255,0.7);
    }
  `;
  document.head.appendChild(style);
}

/**
 * Show interactive elements overlay on the page
 * @param {Array} elements - Array of element objects with bounds, type, name, id
 *
 * NOTE: This function and its styles are also duplicated in:
 * - modules/visuals.js (VISUAL_STYLES constant, showNodeHighlights function)
 * - popup.js (showElementsOverlayInPage function)
 *
 * This duplication is INTENTIONAL because:
 * 1. Content scripts run in isolated context and cannot import background modules
 * 2. popup.js needs self-contained injection for restricted pages
 *
 * If modifying visual styles, update all three locations for consistency.
 */
window.centrisShowElementsOverlay = function (elements) {
  injectElementOverlayStyles();

  // Remove existing overlay
  window.centrisHideElementsOverlay();

  // Type abbreviation expansion
  const typeExpand = {
    cl: "clickable",
    ty: "typeable",
    se: "selectable",
    ot: "other",
  };

  // Create container
  const container = document.createElement("div");
  container.className = "centris-elements-overlay";
  container.id = "centris-elements-overlay";

  // Stats counters
  let stats = { clickable: 0, typeable: 0, selectable: 0, other: 0 };

  // Create element boxes
  elements.forEach((el, idx) => {
    // Handle both abbreviated and full formats
    const bounds = el.b || el.bounds || {};
    const x = bounds.x || 0;
    const y = bounds.y || 0;
    const width = bounds.w || bounds.width || 0;
    const height = bounds.h || bounds.height || 0;

    // Skip elements with no valid bounds
    if (width < 5 || height < 5) {
      return;
    }

    const nodeId = el.id || el.nodeId || "?";
    const name = el.n || el.name || el.ariaLabel || "";
    const rawType = el.t || el.type || "other";
    const type = typeExpand[rawType] || rawType;
    const role = el.r || el.role || "";

    // Update stats
    if (stats[type] !== undefined) {
      stats[type]++;
    } else {
      stats.other++;
    }

    // Create element box
    const box = document.createElement("div");
    box.className = `centris-element-box type-${type}`;
    box.style.left = `${x}px`;
    box.style.top = `${y}px`;
    box.style.width = `${width}px`;
    box.style.height = `${height}px`;

    // Create label (name/role)
    const label = document.createElement("div");
    label.className = `centris-element-label type-${type}`;
    const displayName = name.length > 35 ? name.substring(0, 35) + "..." : name;
    label.textContent = `#${idx + 1}: ${displayName || role || type}`;
    box.appendChild(label);

    // Create ID badge
    const idBadge = document.createElement("div");
    idBadge.className = "centris-element-id";
    idBadge.textContent = `id:${nodeId}`;
    box.appendChild(idBadge);

    container.appendChild(box);
  });

  // Create legend
  const legend = document.createElement("div");
  legend.className = "centris-elements-legend";
  legend.innerHTML = `
    <button class="close-btn" id="centris-close-overlay">×</button>
    <h3>🔍 AI Element View</h3>
    <div class="legend-item">
      <div class="legend-color clickable"></div>
      <span>Clickable (${stats.clickable})</span>
    </div>
    <div class="legend-item">
      <div class="legend-color typeable"></div>
      <span>Typeable (${stats.typeable})</span>
    </div>
    <div class="legend-item">
      <div class="legend-color selectable"></div>
      <span>Selectable (${stats.selectable})</span>
    </div>
    <div class="stats">
      Total: ${elements.length} elements<br>
      Visible: ${stats.clickable + stats.typeable + stats.selectable + stats.other}
    </div>
  `;
  container.appendChild(legend);

  // Add close handler
  document.body.appendChild(container);

  // Make close button work
  const closeBtn = document.getElementById("centris-close-overlay");
  if (closeBtn) {
    closeBtn.style.pointerEvents = "auto";
    closeBtn.addEventListener("click", () => {
      window.centrisHideElementsOverlay();
    });
  }

  elementsOverlayContainer = container;
  elementsOverlayVisible = true;

  console.log("[Centris] Elements overlay shown:", elements.length, "elements");
};

/**
 * Hide elements overlay
 */
window.centrisHideElementsOverlay = function () {
  if (elementsOverlayContainer) {
    elementsOverlayContainer.remove();
    elementsOverlayContainer = null;
  }
  const existing = document.getElementById("centris-elements-overlay");
  if (existing) {
    existing.remove();
  }
  elementsOverlayVisible = false;
};

/**
 * Toggle elements overlay
 */
window.centrisToggleElementsOverlay = function (elements) {
  if (elementsOverlayVisible) {
    window.centrisHideElementsOverlay();
  } else {
    window.centrisShowElementsOverlay(elements);
  }
};
