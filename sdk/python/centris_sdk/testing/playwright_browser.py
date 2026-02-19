"""
Playwright Browser Bridge for Real Browser Testing

Provides a real browser implementation for testing connectors
against actual web pages. Verifies selectors exist and provides
actionable error messages when they don't.

NO SCREENSHOTS - Centris uses DOM/accessibility tree, not vision.

Usage:
    centris test . --browser          # Headless by default
    centris test . --browser --headed # See the browser
    
    # In code:
    async with PlaywrightBrowserBridge() as browser:
        result = await browser.click_node('[gh="cm"]')
        if not result["success"]:
            print(result["error"])   # Actionable error
            print(result["hint"])    # How to fix it
            print(result["found"])   # What elements were found

Inspired by Clawdbot's actionable error patterns.
"""

import asyncio
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

# Playwright is optional - installed with centris-sdk[browser]
try:
    from playwright.async_api import (
        async_playwright,
        Browser,
        BrowserContext,
        Page,
        Playwright,
        TimeoutError as PlaywrightTimeout,
        Error as PlaywrightError,
    )
    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    PLAYWRIGHT_AVAILABLE = False
    Browser = None
    BrowserContext = None
    Page = None
    Playwright = None
    PlaywrightTimeout = Exception
    PlaywrightError = Exception


@dataclass
class BrowserOperation:
    """Record of a browser operation with result details."""
    action: str
    args: Dict[str, Any]
    timestamp: str
    success: bool = True
    result: Any = None
    error: Optional[str] = None
    hint: Optional[str] = None
    duration_ms: float = 0


@dataclass  
class SelectorDiagnostic:
    """Diagnostic info when a selector fails."""
    selector: str
    found_count: int
    similar_selectors: List[str] = field(default_factory=list)
    page_url: str = ""
    suggestion: str = ""


class PlaywrightBrowserBridge:
    """
    Real browser testing bridge using Playwright.
    
    Actually executes browser operations and provides actionable
    errors when selectors don't exist or fail.
    
    Key differences from MockBrowserBridge:
    - Actually runs in a real browser
    - Verifies selectors exist
    - Provides diagnostic info on failure
    - Helps developers fix their connectors
    
    Example:
        async with PlaywrightBrowserBridge(headless=True) as browser:
            # This actually navigates
            await browser.navigate_browser("https://mail.google.com")
            
            # This actually clicks - and FAILS if selector doesn't exist
            result = await browser.click_node('[gh="cm"]')
            
            if not result["success"]:
                # Actionable error with suggestions
                print(f"Error: {result['error']}")
                print(f"Hint: {result['hint']}")
                print(f"Similar elements found: {result.get('similar')}")
    """
    
    def __init__(
        self,
        headless: bool = True,
        timeout_ms: int = 10000,
        slow_mo: int = 0,
    ):
        """
        Initialize Playwright browser bridge.
        
        Args:
            headless: Run browser without UI (default True)
            timeout_ms: Default timeout for operations (default 10s)
            slow_mo: Slow down operations by this many ms (for debugging)
        """
        if not PLAYWRIGHT_AVAILABLE:
            raise ImportError(
                "Playwright not installed. Install with:\n"
                "  pip install centris-sdk[browser]\n"
                "  playwright install chromium"
            )
        
        self.headless = headless
        self.timeout_ms = timeout_ms
        self.slow_mo = slow_mo
        
        self._playwright: Optional[Playwright] = None
        self._browser: Optional[Browser] = None
        self._context: Optional[BrowserContext] = None
        self._page: Optional[Page] = None
        
        # Operation log
        self.operations: List[BrowserOperation] = []
        
        # Current state
        self._current_url = ""
    
    async def __aenter__(self) -> "PlaywrightBrowserBridge":
        """Start browser on context enter."""
        await self._start()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Close browser on context exit."""
        await self._close()
    
    async def _start(self) -> None:
        """Launch browser and create page."""
        self._playwright = await async_playwright().start()
        self._browser = await self._playwright.chromium.launch(
            headless=self.headless,
            slow_mo=self.slow_mo,
        )
        self._context = await self._browser.new_context(
            viewport={"width": 1280, "height": 720},
        )
        self._page = await self._context.new_page()
    
    async def _close(self) -> None:
        """Close browser and cleanup."""
        if self._context:
            await self._context.close()
        if self._browser:
            await self._browser.close()
        if self._playwright:
            await self._playwright.stop()
    
    def _record(
        self,
        action: str,
        success: bool = True,
        result: Any = None,
        error: Optional[str] = None,
        hint: Optional[str] = None,
        duration_ms: float = 0,
        **kwargs,
    ) -> BrowserOperation:
        """Record an operation."""
        op = BrowserOperation(
            action=action,
            args=kwargs,
            timestamp=datetime.utcnow().isoformat(),
            success=success,
            result=result,
            error=error,
            hint=hint,
            duration_ms=duration_ms,
        )
        self.operations.append(op)
        return op
    
    # =========================================================================
    # SELECTOR DIAGNOSTICS - The Key to Actionable Errors
    # =========================================================================
    
    async def _diagnose_selector(self, selector: str) -> SelectorDiagnostic:
        """
        Diagnose why a selector failed.
        
        Returns actionable information about what went wrong
        and how to fix it.
        """
        if not self._page:
            return SelectorDiagnostic(selector=selector, found_count=0)
        
        diagnostic = SelectorDiagnostic(
            selector=selector,
            found_count=0,
            page_url=self._page.url,
        )
        
        # Try to find similar selectors
        try:
            # Extract the key parts of the selector
            similar = await self._find_similar_elements(selector)
            diagnostic.similar_selectors = similar[:5]  # Top 5
            
            # Generate suggestion based on what we found
            diagnostic.suggestion = self._generate_suggestion(selector, similar)
            
        except Exception:
            pass
        
        return diagnostic
    
    async def _find_similar_elements(self, selector: str) -> List[str]:
        """
        Find elements similar to the failed selector.
        
        This helps developers understand what's actually on the page.
        """
        if not self._page:
            return []
        
        similar = []
        
        # Extract attribute patterns from selector
        # e.g., '[aria-label="Send"]' -> look for aria-label attributes
        
        # Try data-testid variations
        if "data-testid" in selector:
            testids = await self._page.evaluate("""
                () => Array.from(document.querySelectorAll('[data-testid]'))
                    .slice(0, 10)
                    .map(el => `[data-testid="${el.getAttribute('data-testid')}"]`)
            """)
            similar.extend(testids)
        
        # Try aria-label variations  
        if "aria-label" in selector:
            labels = await self._page.evaluate("""
                () => Array.from(document.querySelectorAll('[aria-label]'))
                    .slice(0, 10)
                    .map(el => `[aria-label="${el.getAttribute('aria-label')}"]`)
            """)
            similar.extend(labels)
        
        # Try class-based if it's a class selector
        if selector.startswith("."):
            class_name = selector.split(".")[1].split("[")[0].split(":")[0]
            classes = await self._page.evaluate(f"""
                () => Array.from(document.querySelectorAll('[class*="{class_name}"]'))
                    .slice(0, 10)
                    .map(el => `.${el.className.split(' ').filter(c => c.includes("{class_name}"))[0] || el.className.split(' ')[0]}`)
            """)
            similar.extend(classes)
        
        # Try tag + attribute combos for generic selectors
        if "[" in selector and not selector.startswith("["):
            tag = selector.split("[")[0]
            if tag:
                elements = await self._page.evaluate(f"""
                    () => Array.from(document.querySelectorAll('{tag}'))
                        .slice(0, 10)
                        .map(el => {{
                            const attrs = [];
                            if (el.id) attrs.push(`#{el.id}`);
                            if (el.className) attrs.push(`.${el.className.split(' ')[0]}`);
                            if (el.getAttribute('aria-label')) attrs.push(`[aria-label="${el.getAttribute('aria-label')}"]`);
                            if (el.getAttribute('data-testid')) attrs.push(`[data-testid="${el.getAttribute('data-testid')}"]`);
                            return `{tag}` + (attrs[0] || '');
                        }})
                """)
                similar.extend(elements)
        
        # Deduplicate and filter empties
        return list(dict.fromkeys(s for s in similar if s and s != selector))
    
    def _generate_suggestion(self, selector: str, similar: List[str]) -> str:
        """Generate an actionable suggestion based on findings."""
        if not similar:
            return (
                f"No elements found matching '{selector}'. "
                f"The page structure may have changed. "
                f"Use browser DevTools (F12) to find the current selector."
            )
        
        # Check if any similar selector is very close
        for s in similar:
            if self._selector_similarity(selector, s) > 0.8:
                return (
                    f"Selector '{selector}' not found, but found similar: '{s}'. "
                    f"Try updating your selector to match."
                )
        
        return (
            f"Selector '{selector}' not found. "
            f"Found {len(similar)} similar elements on page. "
            f"First few: {', '.join(similar[:3])}"
        )
    
    def _selector_similarity(self, s1: str, s2: str) -> float:
        """Simple similarity score between two selectors."""
        # Extract the core value (e.g., aria-label value)
        def extract_value(s):
            match = re.search(r'["\']([^"\']+)["\']', s)
            return match.group(1).lower() if match else s.lower()
        
        v1, v2 = extract_value(s1), extract_value(s2)
        
        # Levenshtein-ish similarity
        if v1 == v2:
            return 1.0
        if v1 in v2 or v2 in v1:
            return 0.8
        
        common = len(set(v1) & set(v2))
        total = len(set(v1) | set(v2))
        return common / total if total > 0 else 0.0
    
    def _format_error(
        self,
        action: str,
        selector: str,
        diagnostic: SelectorDiagnostic,
        original_error: str,
    ) -> Tuple[str, str]:
        """
        Format an actionable error message.
        
        Returns (error_message, hint).
        """
        error = f"Failed to {action} selector '{selector}'"
        
        if "timeout" in original_error.lower():
            error += " (element not found within timeout)"
        
        hint = diagnostic.suggestion
        if not hint:
            hint = (
                f"Selector '{selector}' not found on {diagnostic.page_url}. "
                f"Open the page in Chrome DevTools (F12), right-click the element, "
                f"and select 'Copy > Copy selector' to get the current selector."
            )
        
        return error, hint
    
    # =========================================================================
    # BROWSER BRIDGE API - Same interface as Centris uses
    # =========================================================================
    
    async def navigate_browser(self, url: str) -> Dict[str, Any]:
        """Navigate to a URL."""
        if not self._page:
            return {"success": False, "error": "Browser not started"}
        
        start = asyncio.get_event_loop().time()
        
        try:
            await self._page.goto(url, wait_until="domcontentloaded", timeout=self.timeout_ms)
            self._current_url = url
            duration = (asyncio.get_event_loop().time() - start) * 1000
            
            self._record("navigate_browser", url=url, success=True, duration_ms=duration)
            return {"success": True, "url": url}
            
        except PlaywrightTimeout:
            duration = (asyncio.get_event_loop().time() - start) * 1000
            error = f"Navigation to {url} timed out after {self.timeout_ms}ms"
            hint = "Check if the URL is correct and the site is accessible"
            
            self._record("navigate_browser", url=url, success=False, error=error, hint=hint, duration_ms=duration)
            return {"success": False, "error": error, "hint": hint}
            
        except Exception as e:
            duration = (asyncio.get_event_loop().time() - start) * 1000
            error = f"Navigation failed: {str(e)}"
            
            self._record("navigate_browser", url=url, success=False, error=error, duration_ms=duration)
            return {"success": False, "error": error}
    
    async def get_active_tab(self) -> Dict[str, str]:
        """Get the active tab info."""
        if not self._page:
            return {"url": "", "title": ""}
        
        self._record("get_active_tab", success=True)
        return {
            "url": self._page.url,
            "title": await self._page.title(),
        }
    
    async def click_node(self, selector: str) -> Dict[str, Any]:
        """
        Click an element by selector.
        
        Returns actionable error if selector not found.
        """
        if not self._page:
            return {"success": False, "error": "Browser not started"}
        
        start = asyncio.get_event_loop().time()
        
        try:
            await self._page.click(selector, timeout=self.timeout_ms)
            duration = (asyncio.get_event_loop().time() - start) * 1000
            
            self._record("click_node", selector=selector, success=True, duration_ms=duration)
            return {"success": True, "selector": selector}
            
        except (PlaywrightTimeout, PlaywrightError) as e:
            duration = (asyncio.get_event_loop().time() - start) * 1000
            
            # Diagnose the failure
            diagnostic = await self._diagnose_selector(selector)
            error, hint = self._format_error("click", selector, diagnostic, str(e))
            
            result = {
                "success": False,
                "error": error,
                "hint": hint,
                "selector": selector,
                "page_url": diagnostic.page_url,
            }
            
            if diagnostic.similar_selectors:
                result["similar"] = diagnostic.similar_selectors
            
            self._record(
                "click_node",
                selector=selector,
                success=False,
                error=error,
                hint=hint,
                duration_ms=duration,
            )
            return result
    
    async def input_text_node(self, selector: str, text: str) -> Dict[str, Any]:
        """
        Input text into an element.
        
        Returns actionable error if selector not found.
        """
        if not self._page:
            return {"success": False, "error": "Browser not started"}
        
        start = asyncio.get_event_loop().time()
        
        try:
            await self._page.fill(selector, text, timeout=self.timeout_ms)
            duration = (asyncio.get_event_loop().time() - start) * 1000
            
            self._record("input_text_node", selector=selector, text=text, success=True, duration_ms=duration)
            return {"success": True, "selector": selector, "text": text}
            
        except (PlaywrightTimeout, PlaywrightError) as e:
            duration = (asyncio.get_event_loop().time() - start) * 1000
            
            diagnostic = await self._diagnose_selector(selector)
            error, hint = self._format_error("type into", selector, diagnostic, str(e))
            
            result = {
                "success": False,
                "error": error,
                "hint": hint,
                "selector": selector,
            }
            
            if diagnostic.similar_selectors:
                result["similar"] = diagnostic.similar_selectors
            
            self._record(
                "input_text_node",
                selector=selector,
                text=text,
                success=False,
                error=error,
                hint=hint,
                duration_ms=duration,
            )
            return result
    
    async def type_text(self, text: str) -> Dict[str, Any]:
        """Type text at current focus."""
        if not self._page:
            return {"success": False, "error": "Browser not started"}
        
        start = asyncio.get_event_loop().time()
        
        try:
            await self._page.keyboard.type(text)
            duration = (asyncio.get_event_loop().time() - start) * 1000
            
            self._record("type_text", text=text, success=True, duration_ms=duration)
            return {"success": True, "text": text}
            
        except Exception as e:
            duration = (asyncio.get_event_loop().time() - start) * 1000
            error = f"Failed to type text: {str(e)}"
            
            self._record("type_text", text=text, success=False, error=error, duration_ms=duration)
            return {"success": False, "error": error}
    
    async def press_key(self, key: str) -> Dict[str, Any]:
        """Press a keyboard key."""
        if not self._page:
            return {"success": False, "error": "Browser not started"}
        
        start = asyncio.get_event_loop().time()
        
        try:
            await self._page.keyboard.press(key)
            duration = (asyncio.get_event_loop().time() - start) * 1000
            
            self._record("press_key", key=key, success=True, duration_ms=duration)
            return {"success": True, "key": key}
            
        except Exception as e:
            duration = (asyncio.get_event_loop().time() - start) * 1000
            error = f"Failed to press key '{key}': {str(e)}"
            hint = f"Valid keys include: Enter, Tab, Escape, ArrowDown, etc."
            
            self._record("press_key", key=key, success=False, error=error, hint=hint, duration_ms=duration)
            return {"success": False, "error": error, "hint": hint}
    
    async def wait(self, ms: int) -> Dict[str, Any]:
        """Wait for specified milliseconds."""
        await asyncio.sleep(ms / 1000)
        self._record("wait", ms=ms, success=True, duration_ms=ms)
        return {"success": True, "waited_ms": ms}
    
    async def wait_for_selector(self, selector: str, timeout: int = 5000) -> Dict[str, Any]:
        """Wait for a selector to appear."""
        if not self._page:
            return {"success": False, "error": "Browser not started"}
        
        start = asyncio.get_event_loop().time()
        
        try:
            await self._page.wait_for_selector(selector, timeout=timeout)
            duration = (asyncio.get_event_loop().time() - start) * 1000
            
            self._record("wait_for_selector", selector=selector, timeout=timeout, success=True, duration_ms=duration)
            return {"success": True, "selector": selector}
            
        except (PlaywrightTimeout, PlaywrightError) as e:
            duration = (asyncio.get_event_loop().time() - start) * 1000
            
            diagnostic = await self._diagnose_selector(selector)
            error = f"Timeout waiting for selector '{selector}' after {timeout}ms"
            hint = diagnostic.suggestion
            
            result = {
                "success": False,
                "error": error,
                "hint": hint,
                "selector": selector,
            }
            
            if diagnostic.similar_selectors:
                result["similar"] = diagnostic.similar_selectors
            
            self._record(
                "wait_for_selector",
                selector=selector,
                timeout=timeout,
                success=False,
                error=error,
                hint=hint,
                duration_ms=duration,
            )
            return result
    
    async def get_page_content(self) -> str:
        """Get page text content (not HTML)."""
        if not self._page:
            return ""
        
        content = await self._page.evaluate("() => document.body.innerText")
        self._record("get_page_content", success=True)
        return content
    
    async def get_interactive_snapshot(self) -> Dict[str, Any]:
        """
        Get accessibility tree snapshot.
        
        This is what Centris actually uses - not screenshots.
        Returns interactive elements with their roles and labels.
        """
        if not self._page:
            return {"elements": [], "url": ""}
        
        # Get interactive elements via accessibility tree
        elements = await self._page.evaluate("""
            () => {
                const interactive = [];
                const walker = document.createTreeWalker(
                    document.body,
                    NodeFilter.SHOW_ELEMENT,
                    null,
                    false
                );
                
                while (walker.nextNode()) {
                    const el = walker.currentNode;
                    const tag = el.tagName.toLowerCase();
                    const role = el.getAttribute('role') || tag;
                    
                    // Check if interactive
                    const isInteractive = (
                        ['a', 'button', 'input', 'select', 'textarea'].includes(tag) ||
                        el.getAttribute('onclick') ||
                        el.getAttribute('role') === 'button' ||
                        el.getAttribute('tabindex') !== null ||
                        el.getAttribute('contenteditable') === 'true'
                    );
                    
                    if (isInteractive) {
                        const item = {
                            tag: tag,
                            role: role,
                            text: el.innerText?.substring(0, 100) || '',
                            ariaLabel: el.getAttribute('aria-label') || '',
                            placeholder: el.getAttribute('placeholder') || '',
                            value: el.value || '',
                            id: el.id || '',
                            testId: el.getAttribute('data-testid') || '',
                        };
                        
                        // Generate a selector hint
                        if (el.id) {
                            item.selector = `#${el.id}`;
                        } else if (item.testId) {
                            item.selector = `[data-testid="${item.testId}"]`;
                        } else if (item.ariaLabel) {
                            item.selector = `[aria-label="${item.ariaLabel}"]`;
                        } else if (el.className) {
                            item.selector = `.${el.className.split(' ')[0]}`;
                        }
                        
                        interactive.push(item);
                    }
                }
                
                return interactive.slice(0, 100);  // Limit to 100 elements
            }
        """)
        
        self._record("get_interactive_snapshot", success=True)
        return {
            "elements": elements,
            "url": self._page.url,
            "element_count": len(elements),
        }
    
    async def scroll_page(self, direction: str = "down", amount: int = 300) -> Dict[str, Any]:
        """Scroll the page."""
        if not self._page:
            return {"success": False, "error": "Browser not started"}
        
        delta = amount if direction == "down" else -amount
        
        await self._page.mouse.wheel(0, delta)
        self._record("scroll_page", direction=direction, amount=amount, success=True)
        return {"success": True, "direction": direction, "amount": amount}
    
    # =========================================================================
    # TEST HELPERS
    # =========================================================================
    
    def get_operations(self, action: Optional[str] = None) -> List[BrowserOperation]:
        """Get recorded operations, optionally filtered by action."""
        if action:
            return [op for op in self.operations if op.action == action]
        return list(self.operations)
    
    def get_failed_operations(self) -> List[BrowserOperation]:
        """Get all failed operations with their errors."""
        return [op for op in self.operations if not op.success]
    
    def reset(self) -> None:
        """Reset operation history."""
        self.operations.clear()
    
    def summary(self) -> Dict[str, Any]:
        """Get a summary of all operations."""
        total = len(self.operations)
        failed = len(self.get_failed_operations())
        
        return {
            "total_operations": total,
            "successful": total - failed,
            "failed": failed,
            "operations": [
                {
                    "action": op.action,
                    "success": op.success,
                    "duration_ms": op.duration_ms,
                    "error": op.error,
                    "hint": op.hint,
                }
                for op in self.operations
            ],
        }


# =============================================================================
# CONVENIENCE FUNCTIONS
# =============================================================================

async def create_browser(
    headless: bool = True,
    timeout_ms: int = 10000,
) -> PlaywrightBrowserBridge:
    """
    Create and start a browser bridge.
    
    Usage:
        browser = await create_browser()
        try:
            await browser.navigate_browser("https://example.com")
            await browser.click_node("button")
        finally:
            await browser._close()
    
    Or use as context manager:
        async with PlaywrightBrowserBridge() as browser:
            await browser.navigate_browser("https://example.com")
    """
    bridge = PlaywrightBrowserBridge(headless=headless, timeout_ms=timeout_ms)
    await bridge._start()
    return bridge


def is_playwright_available() -> bool:
    """Check if Playwright is installed and available."""
    return PLAYWRIGHT_AVAILABLE


__all__ = [
    "PlaywrightBrowserBridge",
    "BrowserOperation",
    "SelectorDiagnostic",
    "create_browser",
    "is_playwright_available",
]
