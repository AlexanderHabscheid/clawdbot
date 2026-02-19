"""
Centris SDK Browser Executor

Legacy Playwright browser executor (opt-in).
Centris production browser automation uses the real-browser bridge runtime.
"""

import logging
import time
import base64
import os
from typing import Any, Optional

from centris_sdk.types import ExecutionMethod
from centris_sdk.execution.types import (
    ExecutionConfig,
    ExecutionRequest,
    ExecutionResponse,
    ExecutorCapabilities,
)


logger = logging.getLogger("centris.execution.browser")


class BrowserExecutor:
    """
    Executor for browser automation.
    
    Features:
    - Playwright-based browser automation
    - Support for Chromium, Firefox, WebKit
    - Screenshot capture
    - Cookie/session management
    
    Example:
        executor = BrowserExecutor(config)
        await executor.setup()
        
        response = await executor.execute(ExecutionRequest(
            connector_id="web",
            capability_id="fill_form",
            params={"url": "https://example.com", "fields": {...}},
        ))
    """
    
    def __init__(self, config: Optional[ExecutionConfig] = None):
        self.config = config or ExecutionConfig()
        self._legacy_enabled = os.environ.get("CENTRIS_PY_BROWSER_LEGACY", "").lower() in (
            "1",
            "true",
            "yes",
        )
        self._playwright = None
        self._browser = None
        self._context = None
        self._available = False
    
    @property
    def method(self) -> ExecutionMethod:
        return ExecutionMethod.BROWSER
    
    @property
    def capabilities(self) -> ExecutorCapabilities:
        return ExecutorCapabilities(
            method=ExecutionMethod.BROWSER,
            available=self._available,
            supports_auth=True,
            supports_streaming=False,
            supports_file_upload=True,
            supports_screenshots=True,
            avg_latency_ms=2000,
            reliability_score=0.85,
            cost_per_request=0.01,
        )
    
    async def is_available(self) -> bool:
        """Check if browser execution is available."""
        if not self._legacy_enabled:
            return False
        if self._browser is not None:
            return True
        
        try:
            from playwright.async_api import async_playwright
            return True
        except ImportError:
            return False
    
    async def setup(self) -> None:
        """Initialize Playwright and browser."""
        if not self._legacy_enabled:
            self._available = False
            return
        try:
            from playwright.async_api import async_playwright
            
            self._playwright = await async_playwright().start()
            self._browser = await self._playwright.chromium.launch(
                headless=self.config.browser_headless,
                slow_mo=self.config.browser_slow_mo,
            )
            self._context = await self._browser.new_context(
                viewport={"width": 1280, "height": 720},
                user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            )
            self._available = True
            logger.info("Browser executor initialized")
        except ImportError:
            logger.warning("Playwright not installed. Install with: pip install playwright && playwright install")
            self._available = False
        except Exception as e:
            logger.error(f"Failed to initialize browser: {e}")
            self._available = False
    
    async def teardown(self) -> None:
        """Clean up browser resources."""
        if self._context:
            await self._context.close()
            self._context = None
        
        if self._browser:
            await self._browser.close()
            self._browser = None
        
        if self._playwright:
            await self._playwright.stop()
            self._playwright = None
        
        self._available = False
    
    async def execute(self, request: ExecutionRequest) -> ExecutionResponse:
        """
        Execute a capability via browser automation.
        
        The capability should have browser_config with:
        - url: Page to navigate to
        - steps: List of automation steps
        - extract: Data to extract from page
        """
        start_time = time.time()

        browser_bridge = request.context.get("browser_bridge")
        if browser_bridge is not None:
            try:
                return await self._execute_with_bridge(request, browser_bridge, start_time)
            except Exception as e:
                logger.error(f"Bridge browser execution error: {e}")
                return ExecutionResponse(
                    success=False,
                    error=str(e),
                    error_code="BROWSER_BRIDGE_ERROR",
                    method_used=self.method,
                    latency_ms=(time.time() - start_time) * 1000,
                )

        if not self._legacy_enabled:
            return ExecutionResponse(
                success=False,
                error=(
                    "Python BrowserExecutor legacy Playwright mode is disabled. "
                    "Use the Centris real-browser bridge runtime or set "
                    "CENTRIS_PY_BROWSER_LEGACY=1 for legacy local automation."
                ),
                error_code="BROWSER_EXECUTOR_DISABLED",
                method_used=self.method,
                latency_ms=(time.time() - start_time) * 1000,
            )
        
        if not self._available:
            await self.setup()
        
        if not self._browser or not self._context:
            return ExecutionResponse(
                success=False,
                error="Browser not available",
                error_code="BROWSER_NOT_AVAILABLE",
                method_used=self.method,
                latency_ms=(time.time() - start_time) * 1000,
            )
        
        page = None
        screenshot = None
        
        try:
            # Create new page
            page = await self._context.new_page()
            
            # Get browser config from capability or params
            capability = request.capability
            browser_config = {}
            
            if capability and hasattr(capability, "browser_config"):
                browser_config = capability.browser_config or {}
            
            # Merge with params
            url = request.params.get("url") or browser_config.get("url")
            steps = request.params.get("steps") or browser_config.get("steps", [])
            extract = request.params.get("extract") or browser_config.get("extract")
            
            if not url:
                return ExecutionResponse(
                    success=False,
                    error="No URL specified for browser automation",
                    error_code="NO_URL",
                    method_used=self.method,
                )
            
            # Navigate to URL
            await page.goto(url, wait_until="networkidle")
            
            # Execute steps
            for step in steps:
                await self._execute_step(page, step, request.params)
            
            # Extract data
            result = {}
            if extract:
                result = await self._extract_data(page, extract)
            
            # Take screenshot on success
            screenshot_bytes = await page.screenshot()
            screenshot = base64.b64encode(screenshot_bytes).decode()
            
            latency_ms = (time.time() - start_time) * 1000
            
            return ExecutionResponse(
                success=True,
                data=result,
                method_used=self.method,
                latency_ms=latency_ms,
                screenshot=screenshot,
            )
        
        except Exception as e:
            logger.error(f"Browser execution error: {e}")
            
            # Try to capture screenshot on error
            if page and self.config.desktop_screenshot_on_error:
                try:
                    screenshot_bytes = await page.screenshot()
                    screenshot = base64.b64encode(screenshot_bytes).decode()
                except Exception:
                    pass
            
            return ExecutionResponse(
                success=False,
                error=str(e),
                error_code="BROWSER_ERROR",
                method_used=self.method,
                latency_ms=(time.time() - start_time) * 1000,
                screenshot=screenshot,
            )
        
        finally:
            if page:
                await page.close()

    async def _execute_with_bridge(
        self,
        request: ExecutionRequest,
        bridge: Any,
        start_time: float,
    ) -> ExecutionResponse:
        """Execute browser actions against the runtime browser bridge.

        This is the default non-legacy path used by Centris runtime.
        """
        capability = request.capability
        browser_config: dict[str, Any] = {}
        if capability and hasattr(capability, "browser_config"):
            browser_config = capability.browser_config or {}

        url = request.params.get("url") or browser_config.get("url")
        steps = request.params.get("steps") or browser_config.get("steps", [])

        if url:
            await bridge.navigate_browser(str(url))

        for step in steps:
            await self._execute_bridge_step(bridge, step, request.params)

        result_data: dict[str, Any] = {}
        extract = request.params.get("extract") or browser_config.get("extract")
        if extract:
            # Runtime bridge exposes content, not arbitrary JS extraction.
            result_data["content"] = await bridge.get_page_content()

        return ExecutionResponse(
            success=True,
            data=result_data,
            method_used=self.method,
            latency_ms=(time.time() - start_time) * 1000,
        )

    async def _execute_bridge_step(
        self,
        bridge: Any,
        step: dict[str, Any],
        params: dict[str, Any],
    ) -> None:
        """Execute one browser step against BrowserBridge."""
        action = step.get("action", "")
        selector = step.get("selector", "")
        value = step.get("value", "")

        if isinstance(value, str) and value.startswith("{{") and value.endswith("}}"):
            param_name = value[2:-2].strip()
            value = params.get(param_name, value)

        if action == "click":
            await bridge.click_node(selector)
        elif action == "navigate":
            await bridge.navigate_browser(str(value))
        elif action == "fill" or action == "type":
            await bridge.input_text_node(selector, str(value))
        elif action == "press":
            await bridge.press_key(str(value))
        elif action == "wait":
            timeout_ms = int(value) if value else 1000
            await bridge.wait(timeout_ms)
        elif action == "scroll":
            amount = int(value) if value else 500
            direction = "down" if amount >= 0 else "up"
            await bridge.scroll_page(direction, abs(amount))
        else:
            logger.warning(f"Unknown bridge browser action: {action}")
    
    async def _execute_step(
        self,
        page: Any,
        step: dict[str, Any],
        params: dict[str, Any],
    ) -> None:
        """Execute a single automation step."""
        action = step.get("action", "")
        selector = step.get("selector", "")
        value = step.get("value", "")
        
        # Substitute params in value
        if isinstance(value, str) and value.startswith("{{") and value.endswith("}}"):
            param_name = value[2:-2].strip()
            value = params.get(param_name, value)
        
        if action == "click":
            await page.click(selector)
        
        elif action == "fill" or action == "type":
            await page.fill(selector, str(value))
        
        elif action == "select":
            await page.select_option(selector, value)
        
        elif action == "check":
            await page.check(selector)
        
        elif action == "uncheck":
            await page.uncheck(selector)
        
        elif action == "wait":
            if selector:
                await page.wait_for_selector(selector)
            else:
                await page.wait_for_timeout(int(value) if value else 1000)
        
        elif action == "press":
            await page.press(selector or "body", value)
        
        elif action == "scroll":
            await page.evaluate(f"window.scrollTo(0, {value})")
        
        elif action == "screenshot":
            # Screenshots handled separately
            pass
        
        else:
            logger.warning(f"Unknown browser action: {action}")
    
    async def _extract_data(
        self,
        page: Any,
        extract: dict[str, Any],
    ) -> dict[str, Any]:
        """Extract data from the page."""
        result = {}
        
        for key, config in extract.items():
            selector = config.get("selector", "")
            attr = config.get("attribute", "textContent")
            multiple = config.get("multiple", False)
            
            try:
                if multiple:
                    elements = await page.query_selector_all(selector)
                    values = []
                    for el in elements:
                        if attr == "textContent":
                            values.append(await el.text_content())
                        else:
                            values.append(await el.get_attribute(attr))
                    result[key] = values
                else:
                    element = await page.query_selector(selector)
                    if element:
                        if attr == "textContent":
                            result[key] = await element.text_content()
                        else:
                            result[key] = await element.get_attribute(attr)
            except Exception as e:
                logger.warning(f"Failed to extract {key}: {e}")
                result[key] = None
        
        return result
