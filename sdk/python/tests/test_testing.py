"""
Tests for the testing module (test harness).

Small, focused tests following Clawdbot patterns.
"""

import pytest
import tempfile
from pathlib import Path

from centris_sdk.testing.mock_browser import MockBrowserBridge, BrowserOperation
from centris_sdk.testing.test_harness import ConnectorTestHarness, TestResult


class TestBrowserOperation:
    """Tests for BrowserOperation dataclass."""
    
    def test_creates_operation(self):
        op = BrowserOperation(
            action="click_node",
            args={"selector": "button.submit"},
            timestamp="2024-01-01T00:00:00",
        )
        assert op.action == "click_node"
        assert op.args["selector"] == "button.submit"
    
    def test_operation_with_result(self):
        op = BrowserOperation(
            action="navigate_browser",
            args={"url": "https://example.com"},
            timestamp="2024-01-01T00:00:00",
            result={"success": True},
        )
        assert op.result["success"] is True


class TestMockBrowserBridge:
    """Tests for MockBrowserBridge."""
    
    @pytest.mark.asyncio
    async def test_navigate_records_operation(self):
        browser = MockBrowserBridge()
        await browser.navigate_browser("https://example.com")
        
        assert len(browser.operations) == 1
        assert browser.operations[0].action == "navigate_browser"
        assert browser.operations[0].args["url"] == "https://example.com"
    
    @pytest.mark.asyncio
    async def test_click_node_records_operation(self):
        browser = MockBrowserBridge()
        await browser.click_node(selector="button.submit")
        
        assert len(browser.operations) == 1
        assert browser.operations[0].action == "click_node"
    
    @pytest.mark.asyncio
    async def test_input_text_records_operation(self):
        browser = MockBrowserBridge()
        await browser.input_text_node(selector="input.email", text="test@example.com")
        
        assert len(browser.operations) == 1
        op = browser.operations[0]
        assert op.action == "input_text_node"
        assert op.args["text"] == "test@example.com"
    
    @pytest.mark.asyncio
    async def test_type_text_records_operation(self):
        browser = MockBrowserBridge()
        await browser.type_text("Hello, World!")
        
        assert len(browser.operations) == 1
        assert browser.operations[0].action == "type_text"
    
    @pytest.mark.asyncio
    async def test_press_key_records_operation(self):
        browser = MockBrowserBridge()
        await browser.press_key("Enter")
        
        assert len(browser.operations) == 1
        assert browser.operations[0].args["key"] == "Enter"
    
    @pytest.mark.asyncio
    async def test_scroll_page_records_operation(self):
        browser = MockBrowserBridge()
        await browser.scroll_page(direction="down", amount=100)
        
        assert len(browser.operations) == 1
        assert browser.operations[0].action == "scroll_page"
    
    def test_reset_clears_operations(self):
        browser = MockBrowserBridge()
        browser.operations.append(BrowserOperation(action="test", args={}, timestamp="2024-01-01T00:00:00"))
        
        browser.reset()
        
        assert len(browser.operations) == 0
    
    def test_get_operations_filters_by_action(self):
        browser = MockBrowserBridge()
        browser.operations.append(BrowserOperation(action="click_node", args={}, timestamp="2024-01-01T00:00:00"))
        browser.operations.append(BrowserOperation(action="navigate_browser", args={}, timestamp="2024-01-01T00:00:00"))
        browser.operations.append(BrowserOperation(action="click_node", args={}, timestamp="2024-01-01T00:00:00"))
        
        clicks = browser.get_operations("click_node")
        
        assert len(clicks) == 2


class TestConnectorTestHarness:
    """Tests for ConnectorTestHarness."""
    
    def test_creates_with_mock_browser(self):
        harness = ConnectorTestHarness()
        
        assert harness.browser is not None
        assert isinstance(harness.browser, MockBrowserBridge)
    
    def test_reset_clears_browser_operations(self):
        harness = ConnectorTestHarness()
        harness.browser.operations.append(
            BrowserOperation(action="test", args={}, timestamp="2024-01-01T00:00:00")
        )
        
        harness.reset()
        
        assert len(harness.browser.operations) == 0
    
    def test_tool_names_empty_without_connector(self):
        harness = ConnectorTestHarness()
        
        assert harness.tool_names == []
    
    def test_connector_property_raises_without_load(self):
        harness = ConnectorTestHarness()
        
        with pytest.raises(RuntimeError):
            _ = harness.connector


class TestHarnessAssertions:
    """Tests for test harness assertion methods."""
    
    def test_assert_clicked_passes(self):
        harness = ConnectorTestHarness()
        harness.browser.operations.append(
            BrowserOperation(action="click_node", args={"selector": "button.submit"}, timestamp="2024-01-01T00:00:00")
        )
        
        harness.assert_clicked("button.submit")  # Should not raise
    
    def test_assert_clicked_fails(self):
        harness = ConnectorTestHarness()
        
        with pytest.raises(AssertionError):
            harness.assert_clicked("button.submit")
    
    def test_assert_not_clicked_passes(self):
        harness = ConnectorTestHarness()
        
        harness.assert_not_clicked("button.submit")  # Should not raise
    
    def test_assert_not_clicked_fails(self):
        harness = ConnectorTestHarness()
        harness.browser.operations.append(
            BrowserOperation(action="click_node", args={"selector": "button.submit"}, timestamp="2024-01-01T00:00:00")
        )
        
        with pytest.raises(AssertionError):
            harness.assert_not_clicked("button.submit")
    
    def test_assert_typed_passes(self):
        harness = ConnectorTestHarness()
        harness.browser.operations.append(
            BrowserOperation(
                action="input_text_node",
                args={"selector": "input.email", "text": "test@example.com"},
                timestamp="2024-01-01T00:00:00",
            )
        )
        
        harness.assert_typed("input.email", "test@example.com")  # Should not raise
    
    def test_assert_typed_fails_wrong_text(self):
        harness = ConnectorTestHarness()
        harness.browser.operations.append(
            BrowserOperation(
                action="input_text_node",
                args={"selector": "input.email", "text": "wrong@example.com"},
                timestamp="2024-01-01T00:00:00",
            )
        )
        
        with pytest.raises(AssertionError):
            harness.assert_typed("input.email", "test@example.com")
    
    def test_assert_navigated_passes(self):
        harness = ConnectorTestHarness()
        harness.browser.operations.append(
            BrowserOperation(action="navigate_browser", args={"url": "https://example.com/page"}, timestamp="2024-01-01T00:00:00")
        )
        
        harness.assert_navigated("example.com")  # Partial match
    
    def test_assert_navigated_fails(self):
        harness = ConnectorTestHarness()
        
        with pytest.raises(AssertionError):
            harness.assert_navigated("example.com")
    
    def test_assert_operation_count_passes(self):
        harness = ConnectorTestHarness()
        harness.browser.operations.append(BrowserOperation(action="click_node", args={}, timestamp="2024-01-01T00:00:00"))
        harness.browser.operations.append(BrowserOperation(action="click_node", args={}, timestamp="2024-01-01T00:00:00"))
        
        harness.assert_operation_count("click_node", 2)  # Should not raise
    
    def test_assert_operation_count_fails(self):
        harness = ConnectorTestHarness()
        harness.browser.operations.append(BrowserOperation(action="click_node", args={}, timestamp="2024-01-01T00:00:00"))
        
        with pytest.raises(AssertionError):
            harness.assert_operation_count("click_node", 3)
    
    def test_assert_key_pressed_passes(self):
        harness = ConnectorTestHarness()
        harness.browser.operations.append(
            BrowserOperation(action="press_key", args={"key": "Enter"}, timestamp="2024-01-01T00:00:00")
        )
        
        harness.assert_key_pressed("Enter")  # Should not raise
    
    def test_assert_key_pressed_fails(self):
        harness = ConnectorTestHarness()
        
        with pytest.raises(AssertionError):
            harness.assert_key_pressed("Enter")


class TestTestResult:
    """Tests for TestResult dataclass."""
    
    def test_creates_successful_result(self):
        result = TestResult(
            success=True,
            result={"data": "test"},
            error=None,
            operations=[],
            duration_ms=10.5,
        )
        
        assert result.success is True
        assert result.error is None
    
    def test_creates_failed_result(self):
        result = TestResult(
            success=False,
            result=None,
            error="Something went wrong",
            operations=[],
            duration_ms=5.0,
        )
        
        assert result.success is False
        assert result.error == "Something went wrong"
