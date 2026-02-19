"""
Connector Test Harness

Provides a complete testing environment for Centris connectors,
including mock browser bridge, execution context, and assertions.

Usage:
    from centris_sdk.testing import ConnectorTestHarness
    
    async def test_gmail_send():
        harness = ConnectorTestHarness()
        harness.load_connector("./connectors/gmail")
        
        # Set up test state
        harness.browser.set_page_state("https://mail.google.com", ...)
        
        # Execute tool
        result = await harness.execute("gmail_send_email", {
            "to": "test@example.com",
            "subject": "Test",
            "body": "Hello"
        })
        
        # Verify
        assert result["success"]
        harness.assert_clicked('[gh="cm"]')
"""

import sys
import asyncio
import importlib.util
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from .mock_browser import MockBrowserBridge, BrowserOperation


@dataclass
class TestResult:
    """Result of a test execution."""
    success: bool
    result: Any
    error: Optional[str]
    operations: List[BrowserOperation]
    duration_ms: float


class ConnectorTestHarness:
    """
    Complete test harness for Centris connectors.
    
    Provides:
    - Mock browser bridge with configurable state
    - Connector loading and execution
    - Operation recording and assertions
    - Test isolation (each test gets fresh state)
    """
    
    def __init__(
        self,
        connector_path: Optional[str] = None,
        simulate_delays: bool = False,
    ):
        """Initialize test harness.
        
        Args:
            connector_path: Path to connector directory
            simulate_delays: Whether to simulate realistic delays
        """
        # Mock browser bridge
        self.browser = MockBrowserBridge(simulate_delays=simulate_delays)
        
        # Execution context
        self.context: Dict[str, Any] = {
            "browser_bridge": self.browser,
        }
        
        # Loaded connector
        self._connector: Optional[Any] = None
        self._tools: Dict[str, Callable] = {}
        
        # Test state
        self._test_results: List[TestResult] = []
        
        # Load connector if path provided
        if connector_path:
            self.load_connector(connector_path)
    
    def load_connector(self, path: str) -> None:
        """Load a connector from path.
        
        Args:
            path: Path to connector directory or file
        """
        connector_path = Path(path).resolve()
        
        # Find connector.py
        if connector_path.is_file():
            connector_py = connector_path
            connector_path = connector_path.parent
        else:
            connector_py = connector_path / "connector.py"
        
        if not connector_py.exists():
            raise FileNotFoundError(f"connector.py not found at {connector_py}")
        
        # Add to path temporarily
        sys.path.insert(0, str(connector_path))
        
        try:
            # Load module
            spec = importlib.util.spec_from_file_location("connector", connector_py)
            if spec is None or spec.loader is None:
                raise ImportError("Cannot load connector module")
            
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            
            # Get connector
            if hasattr(module, "connector"):
                self._connector = module.connector
            elif hasattr(module, "plugin"):
                self._connector = module.plugin
            else:
                raise AttributeError("No 'connector' export found")
            
            # Extract tools from connector API
            if hasattr(self._connector, "api"):
                api = self._connector.api
                if hasattr(api, "get_tools"):
                    tools = api.get_tools(None)
                    for tool in tools:
                        self._tools[tool.name] = tool.execute
            
            # Also check for capabilities
            if hasattr(self._connector, "capabilities"):
                for cap in self._connector.capabilities:
                    if hasattr(self._connector, "_handlers"):
                        handler = self._connector._handlers.get(cap.id)
                        if handler:
                            self._tools[cap.id] = handler
                            
        finally:
            sys.path.remove(str(connector_path))
    
    @property
    def connector(self) -> Any:
        """Get the loaded connector."""
        if self._connector is None:
            raise RuntimeError("No connector loaded. Call load_connector() first.")
        return self._connector
    
    @property
    def tool_names(self) -> List[str]:
        """Get names of available tools."""
        return list(self._tools.keys())
    
    def reset(self) -> None:
        """Reset test state between tests."""
        self.browser.reset()
        self._test_results.clear()
    
    async def execute(
        self,
        tool_name: str,
        params: Dict[str, Any],
        context: Optional[Dict[str, Any]] = None,
    ) -> TestResult:
        """Execute a connector tool.
        
        Args:
            tool_name: Name of the tool to execute
            params: Tool parameters
            context: Additional context (merged with default)
            
        Returns:
            TestResult with execution details
        """
        import time
        
        if tool_name not in self._tools:
            raise ValueError(f"Tool '{tool_name}' not found. Available: {self.tool_names}")
        
        # Merge context
        exec_context = {**self.context}
        if context:
            exec_context.update(context)
        
        # Record start time
        start_time = time.time()
        start_ops = len(self.browser.operations)
        
        try:
            # Execute tool
            execute_fn = self._tools[tool_name]
            result = await execute_fn(
                f"test_{tool_name}",
                params,
                exec_context,
            )
            
            duration_ms = (time.time() - start_time) * 1000
            
            # Get operations from this execution
            new_ops = self.browser.operations[start_ops:]
            
            test_result = TestResult(
                success=result.get("success", True) if isinstance(result, dict) else True,
                result=result,
                error=result.get("error") if isinstance(result, dict) else None,
                operations=new_ops,
                duration_ms=duration_ms,
            )
            
        except Exception as e:
            duration_ms = (time.time() - start_time) * 1000
            new_ops = self.browser.operations[start_ops:]
            
            test_result = TestResult(
                success=False,
                result=None,
                error=str(e),
                operations=new_ops,
                duration_ms=duration_ms,
            )
        
        self._test_results.append(test_result)
        return test_result
    
    # =========================================================================
    # ASSERTIONS
    # =========================================================================
    
    def assert_clicked(self, selector: str, msg: Optional[str] = None) -> None:
        """Assert that a selector was clicked.
        
        Args:
            selector: CSS selector to check
            msg: Optional assertion message
        """
        clicks = self.browser.get_operations("click_node")
        clicked_selectors = [op.args.get("selector") for op in clicks]
        
        if selector not in clicked_selectors:
            raise AssertionError(
                msg or f"Expected click on '{selector}'. Clicked: {clicked_selectors}"
            )
    
    def assert_not_clicked(self, selector: str, msg: Optional[str] = None) -> None:
        """Assert that a selector was NOT clicked."""
        clicks = self.browser.get_operations("click_node")
        clicked_selectors = [op.args.get("selector") for op in clicks]
        
        if selector in clicked_selectors:
            raise AssertionError(
                msg or f"Expected no click on '{selector}', but it was clicked"
            )
    
    def assert_typed(self, selector: str, text: str, msg: Optional[str] = None) -> None:
        """Assert that text was typed into a selector.
        
        Args:
            selector: CSS selector to check
            text: Expected text
            msg: Optional assertion message
        """
        inputs = self.browser.get_operations("input_text_node")
        
        for op in inputs:
            if op.args.get("selector") == selector:
                if op.args.get("text") == text:
                    return
                raise AssertionError(
                    msg or f"Expected '{text}' in '{selector}', got '{op.args.get('text')}'"
                )
        
        raise AssertionError(
            msg or f"No input found for selector '{selector}'"
        )
    
    def assert_navigated(self, url: str, msg: Optional[str] = None) -> None:
        """Assert that navigation occurred to a URL.
        
        Args:
            url: Expected URL (can be partial match)
            msg: Optional assertion message
        """
        navigations = self.browser.get_operations("navigate_browser")
        navigated_urls = [op.args.get("url") for op in navigations]
        
        for nav_url in navigated_urls:
            if url in nav_url:
                return
        
        raise AssertionError(
            msg or f"Expected navigation to '{url}'. Navigated to: {navigated_urls}"
        )
    
    def assert_operation_count(self, action: str, expected: int, msg: Optional[str] = None) -> None:
        """Assert the number of times an operation was performed.
        
        Args:
            action: Operation action name
            expected: Expected count
            msg: Optional assertion message
        """
        ops = self.browser.get_operations(action)
        actual = len(ops)
        
        if actual != expected:
            raise AssertionError(
                msg or f"Expected {expected} '{action}' operations, got {actual}"
            )
    
    def assert_key_pressed(self, key: str, msg: Optional[str] = None) -> None:
        """Assert that a key was pressed.
        
        Args:
            key: Expected key (e.g., "Enter", "Tab")
            msg: Optional assertion message
        """
        presses = self.browser.get_operations("press_key")
        pressed_keys = [op.args.get("key") for op in presses]
        
        if key not in pressed_keys:
            raise AssertionError(
                msg or f"Expected key press '{key}'. Pressed: {pressed_keys}"
            )
    
    def print_operations(self) -> None:
        """Print all recorded operations (for debugging)."""
        for i, op in enumerate(self.browser.operations):
            print(f"{i+1}. {op.action}({', '.join(f'{k}={v!r}' for k, v in op.args.items())})")
