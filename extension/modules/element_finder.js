/**
 * Element Finder Module for Centris Chrome Extension
 *
 * LLM-free element finding strategies:
 * - Smart click (find by text, role, attributes)
 * - Click by stable hash
 * - Find element by vision (coordinates)
 */

// ═══════════════════════════════════════════════════════════════════════════════
// SMART CLICK - Find element without exact selector
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Smart click - find and click element by text, role, or attributes
 * without needing an exact selector
 *
 * @param {number} tabId - Tab ID
 * @param {Object} criteria - { text?, role?, ariaLabel?, type? }
 * @returns {Promise<Object>} - Result object
 */
async function smartClick(tabId, criteria) {
  if (typeof ensureVisualizationsInjected === "function") {
    await ensureVisualizationsInjected(tabId);
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (criteria) => {
      const { text, role, ariaLabel, type, tagName } = criteria;

      // Score elements by match quality
      function scoreElement(el) {
        let score = 0;

        // Text match (highest priority)
        if (text) {
          const elText = (el.textContent || "").toLowerCase().trim();
          const normalizedText = text.toLowerCase().trim();

          if (elText === normalizedText) {
            score += 100;
          } else if (elText.includes(normalizedText)) {
            score += 50;
          }
        }

        // Aria-label match
        if (ariaLabel) {
          const elAriaLabel = (el.getAttribute("aria-label") || "").toLowerCase();
          if (elAriaLabel === ariaLabel.toLowerCase()) {
            score += 90;
          } else if (elAriaLabel.includes(ariaLabel.toLowerCase())) {
            score += 40;
          }
        }

        // Role match
        if (role && el.getAttribute("role") === role) {
          score += 30;
        }

        // Type match (for inputs)
        if (type && el.type === type) {
          score += 20;
        }

        // Tag match
        if (tagName && el.tagName.toLowerCase() === tagName.toLowerCase()) {
          score += 10;
        }

        return score;
      }

      // Find all potential matches
      const candidates = [];
      const allElements = document.querySelectorAll("*");

      for (const el of allElements) {
        const score = scoreElement(el);
        if (score > 0) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            candidates.push({ el, score, rect });
          }
        }
      }

      if (candidates.length === 0) {
        return { success: false, error: "No matching elements found", criteria };
      }

      // Sort by score and pick best
      candidates.sort((a, b) => b.score - a.score);
      const best = candidates[0];

      // Show visual feedback
      if (window.centrisHighlightElement) {
        window.centrisHighlightElement(
          best.rect.left,
          best.rect.top,
          best.rect.width,
          best.rect.height,
        );
      }
      if (window.centrisShowClick) {
        window.centrisShowClick(
          best.rect.left + best.rect.width / 2,
          best.rect.top + best.rect.height / 2,
        );
      }

      // Click the element
      best.el.scrollIntoView({ behavior: "instant", block: "center" });
      best.el.click();

      return {
        success: true,
        clicked: true,
        score: best.score,
        element: {
          tagName: best.el.tagName,
          text: (best.el.textContent || "").substring(0, 50),
        },
        alternativeCount: candidates.length - 1,
      };
    },
    args: [criteria],
  });

  return results[0]?.result || { success: false, error: "Smart click failed" };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLICK BY STABLE HASH
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Find and click element by its stable hash
 * Useful when nodeId might be stale but hash remains valid
 *
 * @param {number} tabId - Tab ID
 * @param {string} stableHash - The stable hash from a previous snapshot
 * @param {string} tagName - Original tag name for narrowing search
 * @returns {Promise<Object>} - Result object
 */
async function clickByStableHash(tabId, stableHash, tagName = "*") {
  if (typeof ensureVisualizationsInjected === "function") {
    await ensureVisualizationsInjected(tabId);
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (stableHash, tagName) => {
      // Recreate hash computation
      function computeElementHash(element) {
        const components = [];
        components.push(element.tagName?.toLowerCase() || "unknown");
        if (element.id) {
          components.push(`id:${element.id}`);
        }

        const stableAttrs = ["name", "data-testid", "role", "type", "href", "aria-label"];
        for (const attr of stableAttrs) {
          const value = element.getAttribute(attr);
          if (value) {
            components.push(`${attr}:${value.substring(0, 50)}`);
          }
        }

        if (element.className && typeof element.className === "string") {
          const classes = element.className
            .split(/\s+/)
            .filter((c) => c && c.length > 1 && c.length < 40)
            .filter((c) => !/^(is-|has-|ng-|v-|js-|css-)/.test(c))
            .toSorted()
            .slice(0, 5);
          if (classes.length > 0) {
            components.push(`cls:${classes.join(".")}`);
          }
        }

        const fingerprint = components.join("|");
        let hash = 0;
        for (let i = 0; i < fingerprint.length; i++) {
          hash = (hash << 5) - hash + fingerprint.charCodeAt(i);
          hash = hash & hash;
        }
        return Math.abs(hash).toString(36);
      }

      // Search for matching element
      const elements = document.querySelectorAll(tagName);

      for (const el of elements) {
        if (computeElementHash(el) === stableHash) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            // Visual feedback
            if (window.centrisHighlightElement) {
              window.centrisHighlightElement(rect.left, rect.top, rect.width, rect.height);
            }
            if (window.centrisShowClick) {
              window.centrisShowClick(rect.left + rect.width / 2, rect.top + rect.height / 2);
            }

            el.scrollIntoView({ behavior: "instant", block: "center" });
            el.click();

            return {
              success: true,
              clicked: true,
              method: "stableHash",
            };
          }
        }
      }

      return { success: false, error: "No element found with matching stable hash" };
    },
    args: [stableHash, tagName],
  });

  return results[0]?.result || { success: false, error: "Click by stable hash failed" };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLICK BY COORDINATES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Click at specific coordinates
 *
 * @param {number} tabId - Tab ID
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @returns {Promise<Object>} - Result object
 */
async function clickByCoordinates(tabId, x, y) {
  if (typeof ensureVisualizationsInjected === "function") {
    await ensureVisualizationsInjected(tabId);
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (x, y) => {
      const element = document.elementFromPoint(x, y);

      if (!element || element.tagName === "HTML" || element.tagName === "BODY") {
        return { success: false, error: "No clickable element at coordinates" };
      }

      // Visual feedback
      if (window.centrisShowClick) {
        window.centrisShowClick(x, y);
      }

      element.click();

      return {
        success: true,
        clicked: true,
        coordinates: { x, y },
        element: {
          tagName: element.tagName,
          id: element.id,
          text: (element.textContent || "").substring(0, 50),
        },
      };
    },
    args: [x, y],
  });

  return results[0]?.result || { success: false, error: "Click by coordinates failed" };
}

// ═══════════════════════════════════════════════════════════════════════════════
// FIND ELEMENT BY TEXT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Find element containing specific text
 *
 * @param {number} tabId - Tab ID
 * @param {string} text - Text to search for
 * @returns {Promise<Object>} - Result with element info
 */
async function findElementByText(tabId, text) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (text) => {
      const normalizedText = text.toLowerCase().trim();
      const matches = [];

      const allElements = document.querySelectorAll("*");

      for (const el of allElements) {
        const elText = (el.textContent || "").toLowerCase().trim();

        if (elText.includes(normalizedText)) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            matches.push({
              tagName: el.tagName.toLowerCase(),
              id: el.id || null,
              text: elText.substring(0, 100),
              exactMatch: elText === normalizedText,
              bounds: {
                x: Math.round(rect.left),
                y: Math.round(rect.top),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              },
            });
          }
        }
      }

      // Sort exact matches first
      matches.sort((a, b) => (b.exactMatch ? 1 : 0) - (a.exactMatch ? 1 : 0));

      return {
        success: true,
        found: matches.length > 0,
        count: matches.length,
        elements: matches.slice(0, 10),
      };
    },
    args: [text],
  });

  return results[0]?.result || { success: false, error: "Find by text failed" };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

if (typeof globalThis !== "undefined") {
  globalThis.smartClick = smartClick;
  globalThis.clickByStableHash = clickByStableHash;
  globalThis.clickByCoordinates = clickByCoordinates;
  globalThis.findElementByText = findElementByText;
}
