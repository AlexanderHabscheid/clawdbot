"""
Mock Browser Bridge for Testing

Provides a mock implementation of the BrowserBridge interface
that records all operations and can simulate page state.

Usage:
    from centris_sdk.testing import MockBrowserBridge
    
    bridge = MockBrowserBridge()
    bridge.set_page_state("https://mail.google.com", {...})
    
    # Your connector code uses the bridge normally
    result = await bridge.click_node('[gh="cm"]')
    
    # Verify operations
    assert bridge.operations[0]['action'] == 'click_node'
"""

import asyncio
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional
from datetime import datetime


@dataclass
class BrowserOperation:
    """Record of a browser operation."""
    action: str
    args: Dict[str, Any]
    timestamp: str
    result: Any = None
    error: Optional[str] = None


@dataclass
class PageState:
    """Simulated page state."""
    url: str
    title: str = ""
    content: str = ""
    elements: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    
    # Simulate element existence for selectors
    def has_element(self, selector: str) -> bool:
        return selector in self.elements


class MockBrowserBridge:
    """
    Mock implementation of the Centris BrowserBridge.
    
    This allows connectors to be tested locally without
    a running browser or Centris backend.
    
    Features:
    - Records all operations for verification
    - Simulates page state transitions
    - Supports custom response handlers
    - Configurable delays for realistic testing
    """
    
    def __init__(
        self,
        initial_url: str = "https://example.com",
        simulate_delays: bool = False,
        delay_ms: int = 100,
    ):
        """Initialize mock browser bridge.
        
        Args:
            initial_url: Starting URL for the mock browser
            simulate_delays: Whether to add delays to operations
            delay_ms: Delay in milliseconds per operation
        """
        self.simulate_delays = simulate_delays
        self.delay_ms = delay_ms
        
        # Current state
        self._current_url = initial_url
        self._current_title = "Mock Page"
        self._tabs: List[Dict[str, str]] = [
            {"id": "tab-1", "url": initial_url, "title": "Mock Page"}
        ]
        self._active_tab = "tab-1"
        
        # Page states (URL -> PageState)
        self._page_states: Dict[str, PageState] = {}
        
        # Operation log
        self.operations: List[BrowserOperation] = []
        
        # Custom handlers for specific operations
        self._handlers: Dict[str, Callable] = {}
        
        # Configuration for test scenarios
        self._fail_on_selector: Dict[str, str] = {}  # selector -> error message
        self._element_values: Dict[str, str] = {}  # selector -> value
    
    async def _delay(self) -> None:
        """Add simulated delay if enabled."""
        if self.simulate_delays:
            await asyncio.sleep(self.delay_ms / 1000)
    
    def _record(self, action: str, **kwargs) -> BrowserOperation:
        """Record an operation."""
        op = BrowserOperation(
            action=action,
            args=kwargs,
            timestamp=datetime.utcnow().isoformat(),
        )
        self.operations.append(op)
        return op
    
    # =========================================================================
    # TEST SETUP METHODS
    # =========================================================================
    
    def set_page_state(self, url: str, state: PageState) -> None:
        """Set the simulated state for a URL.
        
        Args:
            url: URL pattern to match
            state: Page state to simulate
        """
        self._page_states[url] = state
    
    def add_element(self, selector: str, properties: Optional[Dict[str, Any]] = None) -> None:
        """Add a simulated element.
        
        Args:
            selector: CSS selector for the element
            properties: Element properties (text, value, etc.)
        """
        # Add to current page state
        url = self._current_url
        if url not in self._page_states:
            self._page_states[url] = PageState(url=url)
        self._page_states[url].elements[selector] = properties or {}
    
    def fail_on_selector(self, selector: str, error: str) -> None:
        """Configure a selector to fail when interacted with.
        
        Args:
            selector: CSS selector that should fail
            error: Error message to return
        """
        self._fail_on_selector[selector] = error
    
    def set_element_value(self, selector: str, value: str) -> None:
        """Set the value that will be returned for an element.
        
        Args:
            selector: CSS selector
            value: Value to return
        """
        self._element_values[selector] = value
    
    def set_handler(self, action: str, handler: Callable) -> None:
        """Set a custom handler for an action.
        
        Args:
            action: Action name (click_node, input_text_node, etc.)
            handler: Async function to call instead of default
        """
        self._handlers[action] = handler
    
    def reset(self) -> None:
        """Reset all state and operation history."""
        self.operations.clear()
        self._fail_on_selector.clear()
        self._element_values.clear()
        self._page_states.clear()
    
    def get_operations(self, action: Optional[str] = None) -> List[BrowserOperation]:
        """Get recorded operations, optionally filtered by action."""
        if action:
            return [op for op in self.operations if op.action == action]
        return list(self.operations)
    
    # =========================================================================
    # BROWSER BRIDGE API
    # =========================================================================
    
    async def navigate_browser(self, url: str) -> Dict[str, Any]:
        """Navigate to a URL."""
        await self._delay()
        op = self._record("navigate_browser", url=url)
        
        if "navigate_browser" in self._handlers:
            result = await self._handlers["navigate_browser"](url)
            op.result = result
            return result
        
        self._current_url = url
        
        # Update tab
        for tab in self._tabs:
            if tab["id"] == self._active_tab:
                tab["url"] = url
                if url in self._page_states:
                    tab["title"] = self._page_states[url].title
                break
        
        op.result = {"success": True, "url": url}
        return op.result
    
    async def get_active_tab(self) -> Dict[str, str]:
        """Get the active tab info."""
        await self._delay()
        op = self._record("get_active_tab")
        
        for tab in self._tabs:
            if tab["id"] == self._active_tab:
                op.result = tab
                return tab
        
        op.result = {"url": self._current_url, "title": self._current_title}
        return op.result
    
    async def get_all_tabs(self) -> List[Dict[str, str]]:
        """Get all open tabs."""
        await self._delay()
        op = self._record("get_all_tabs")
        op.result = self._tabs
        return self._tabs
    
    async def click_node(self, selector: str) -> Dict[str, Any]:
        """Click an element by selector."""
        await self._delay()
        op = self._record("click_node", selector=selector)
        
        # Check for configured failures
        if selector in self._fail_on_selector:
            op.error = self._fail_on_selector[selector]
            return {"success": False, "error": op.error}
        
        if "click_node" in self._handlers:
            result = await self._handlers["click_node"](selector)
            op.result = result
            return result
        
        op.result = {"success": True, "selector": selector}
        return op.result
    
    async def input_text_node(self, selector: str, text: str) -> Dict[str, Any]:
        """Input text into an element."""
        await self._delay()
        op = self._record("input_text_node", selector=selector, text=text)
        
        # Check for configured failures
        if selector in self._fail_on_selector:
            op.error = self._fail_on_selector[selector]
            return {"success": False, "error": op.error}
        
        if "input_text_node" in self._handlers:
            result = await self._handlers["input_text_node"](selector, text)
            op.result = result
            return result
        
        # Store the value
        self._element_values[selector] = text
        
        op.result = {"success": True, "selector": selector, "text": text}
        return op.result
    
    async def type_text(self, text: str) -> Dict[str, Any]:
        """Type text at current focus."""
        await self._delay()
        op = self._record("type_text", text=text)
        op.result = {"success": True, "text": text}
        return op.result
    
    async def press_key(self, key: str) -> Dict[str, Any]:
        """Press a keyboard key."""
        await self._delay()
        op = self._record("press_key", key=key)
        op.result = {"success": True, "key": key}
        return op.result
    
    async def wait(self, ms: int) -> Dict[str, Any]:
        """Wait for specified milliseconds."""
        if self.simulate_delays:
            await asyncio.sleep(ms / 1000)
        op = self._record("wait", ms=ms)
        op.result = {"success": True, "waited_ms": ms}
        return op.result
    
    async def wait_for_selector(
        self, 
        selector: str, 
        timeout: int = 5000
    ) -> Dict[str, Any]:
        """Wait for a selector to appear."""
        await self._delay()
        op = self._record("wait_for_selector", selector=selector, timeout=timeout)
        
        # Check if element is configured to fail
        if selector in self._fail_on_selector:
            op.error = f"Timeout waiting for selector: {selector}"
            return {"success": False, "error": op.error}
        
        op.result = {"success": True, "selector": selector}
        return op.result
    
    async def wait_for_navigation(self, timeout: int = 5000) -> Dict[str, Any]:
        """Wait for navigation to complete."""
        await self._delay()
        op = self._record("wait_for_navigation", timeout=timeout)
        op.result = {"success": True, "url": self._current_url}
        return op.result
    
    async def get_page_content(self) -> str:
        """Get page text content."""
        await self._delay()
        op = self._record("get_page_content")
        
        # Return page state content if available
        if self._current_url in self._page_states:
            content = self._page_states[self._current_url].content
            op.result = content
            return content
        
        op.result = f"Mock content for {self._current_url}"
        return op.result
    
    async def get_interactive_snapshot(self) -> Dict[str, Any]:
        """Get accessibility tree snapshot."""
        await self._delay()
        op = self._record("get_interactive_snapshot")
        
        # Return elements from page state
        elements = []
        if self._current_url in self._page_states:
            for selector, props in self._page_states[self._current_url].elements.items():
                elements.append({
                    "selector": selector,
                    "role": props.get("role", "button"),
                    "text": props.get("text", ""),
                    "value": props.get("value", ""),
                })
        
        op.result = {"elements": elements, "url": self._current_url}
        return op.result
    
    async def scroll_page(self, direction: str = "down", amount: int = 300) -> Dict[str, Any]:
        """Scroll the page."""
        await self._delay()
        op = self._record("scroll_page", direction=direction, amount=amount)
        op.result = {"success": True, "direction": direction, "amount": amount}
        return op.result
    
    async def take_screenshot(self) -> Dict[str, Any]:
        """Take a screenshot (returns mock data)."""
        await self._delay()
        op = self._record("take_screenshot")
        op.result = {
            "success": True,
            "data": "mock_screenshot_base64_data",
            "format": "png",
        }
        return op.result
    
    async def fill_form(self, form_data: Dict[str, str]) -> Dict[str, Any]:
        """Fill a form with multiple fields."""
        await self._delay()
        op = self._record("fill_form", form_data=form_data)
        
        # Store all values
        for selector, value in form_data.items():
            self._element_values[selector] = value
        
        op.result = {"success": True, "fields": len(form_data)}
        return op.result
    
    async def select_option(self, selector: str, value: str) -> Dict[str, Any]:
        """Select an option from a dropdown."""
        await self._delay()
        op = self._record("select_option", selector=selector, value=value)
        self._element_values[selector] = value
        op.result = {"success": True, "selector": selector, "value": value}
        return op.result
    
    async def get_element_text(self, selector: str) -> Optional[str]:
        """Get text content of an element."""
        await self._delay()
        op = self._record("get_element_text", selector=selector)
        
        # Check page state
        if self._current_url in self._page_states:
            elements = self._page_states[self._current_url].elements
            if selector in elements:
                text = elements[selector].get("text", "")
                op.result = text
                return text
        
        op.result = self._element_values.get(selector)
        return op.result
    
    async def get_element_value(self, selector: str) -> Optional[str]:
        """Get value of an input element."""
        await self._delay()
        op = self._record("get_element_value", selector=selector)
        value = self._element_values.get(selector)
        op.result = value
        return value
