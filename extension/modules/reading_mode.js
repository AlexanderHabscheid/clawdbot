/**
 * Reading Mode Module for Centris Chrome Extension
 *
 * Extracts readable content from web pages for TTS or summarization:
 * - Article content extraction
 * - Selected text
 * - PDF detection
 */

// ═══════════════════════════════════════════════════════════════════════════════
// CONTENT EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get readable content from the current page
 *
 * @param {number} tabId - Tab ID
 * @param {Object} options - { maxLength, includeImages }
 * @returns {Promise<Object>} - Result with extracted content
 */
async function getReadableContent(tabId, options = {}) {
  const { maxLength = 50000, includeImages = false } = options;

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (maxLength, includeImages) => {
        // FEB 2026 REWRITE: innerText-first strategy.
        //
        // The old approach tried semantic selectors (article, [role="main"], etc.)
        // and a recursive extractText() walker. This COMPLETELY FAILS on SPAs like
        // Gmail, Outlook, Reddit, etc. that use deeply nested non-semantic divs.
        // The old code only fell back to innerText when text < 200 chars, but Gmail
        // produced ~221 chars of nav chrome, so the fallback never triggered.
        //
        // New strategy:
        // 1. ALWAYS get document.body.innerText (captures exactly what's visible)
        // 2. Try semantic selectors as an UPGRADE (articles have cleaner text)
        // 3. Use whichever produces more content

        // Step 1: Get visible text via innerText (works on ALL sites)
        const bodyText = (document.body?.innerText || "").trim();

        // Step 2: Try semantic extraction as potential upgrade
        let semanticText = "";
        const selectors = [
          "article",
          '[role="main"]',
          "main",
          ".article",
          ".post-content",
          ".entry-content",
        ];

        for (const selector of selectors) {
          const el = document.querySelector(selector);
          if (el) {
            const candidate = (el.innerText || "").trim();
            // Only use semantic if it has substantial content (not just a nav wrapper)
            if (candidate.length > 500 && candidate.length > semanticText.length) {
              semanticText = candidate;
            }
          }
        }

        // Step 3: Pick the best result
        // Prefer semantic text if it's substantial (articles, blog posts)
        // Otherwise use bodyText (SPAs, email clients, dashboards)
        let text =
          semanticText.length > bodyText.length * 0.3 && semanticText.length > 500
            ? semanticText
            : bodyText;

        // Clean up excessive whitespace
        text = text.replace(/\n{3,}/g, "\n\n").trim();

        // Truncate if needed
        if (text.length > maxLength) {
          text = text.substring(0, maxLength) + "...\n\n[Content truncated]";
        }

        return {
          success: true,
          title: document.title,
          url: window.location.href,
          text: text, // Backend expects 'text'
          content: text, // Keep 'content' for backward compat
          contentLength: text.length,
          truncated: text.length >= maxLength,
          method: semanticText.length > 500 ? "semantic" : "innerText",
        };
      },
      args: [maxLength, includeImages],
    });

    return results[0]?.result || { success: false, error: "Failed to extract content" };
  } catch (e) {
    return { success: false, error: `Content extraction failed: ${e.message}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SELECTED TEXT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get currently selected text on the page
 *
 * @param {number} tabId - Tab ID
 * @returns {Promise<Object>} - Result with selected text
 */
async function getSelectedText(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const selection = window.getSelection();
        const text = selection?.toString()?.trim() || "";

        return {
          success: true,
          hasSelection: text.length > 0,
          text: text,
          length: text.length,
        };
      },
    });

    return results[0]?.result || { success: false, error: "Failed to get selection" };
  } catch (e) {
    return { success: false, error: `Get selection failed: ${e.message}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAGE INFO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get basic page information
 *
 * @param {number} tabId - Tab ID
 * @returns {Promise<Object>} - Result with page info
 */
async function getPageInfo(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Detect page type
        function detectPageType() {
          const url = window.location.href;

          if (url.endsWith(".pdf") || document.contentType === "application/pdf") {
            return "pdf";
          }
          if (document.querySelector("article")) {
            return "article";
          }
          if (document.querySelector("form")) {
            return "form";
          }
          if (document.querySelectorAll("table").length > 2) {
            return "data";
          }
          if (
            document.querySelector('[role="search"]') ||
            document.querySelector('input[type="search"]')
          ) {
            return "search";
          }
          return "general";
        }

        return {
          success: true,
          url: window.location.href,
          title: document.title,
          pageType: detectPageType(),
          contentType: document.contentType,
          language: document.documentElement.lang || "en",
          hasImages: document.images.length > 0,
          hasForms: document.forms.length > 0,
          hasVideos: document.querySelectorAll("video").length > 0,
          textLength: document.body?.textContent?.length || 0,
        };
      },
    });

    return results[0]?.result || { success: false, error: "Failed to get page info" };
  } catch (e) {
    return { success: false, error: `Get page info failed: ${e.message}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

if (typeof globalThis !== "undefined") {
  globalThis.getReadableContent = getReadableContent;
  globalThis.getSelectedText = getSelectedText;
  globalThis.getPageInfo = getPageInfo;
}
