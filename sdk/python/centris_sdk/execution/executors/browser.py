"""
Centris SDK Browser Executor

Bridge-only browser executor.
Centris browser automation runs against the real-browser bridge runtime.
"""

import logging
import time
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

    This executor is intentionally bridge-only. Legacy local Playwright execution
    was removed to keep behavior aligned with Centris runtime.
    """
    
    def __init__(self, config: Optional[ExecutionConfig] = None):
        self.config = config or ExecutionConfig()
        self._available = True
    
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
            supports_screenshots=False,
            avg_latency_ms=500,
            reliability_score=0.95,
            cost_per_request=0.0,
        )
    
    async def is_available(self) -> bool:
        """Check if browser execution is available."""
        return True
    
    async def setup(self) -> None:
        """Bridge executor setup (no-op)."""
        self._available = True
    
    async def teardown(self) -> None:
        """Bridge executor teardown (no-op)."""
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

        return ExecutionResponse(
            success=False,
            error=(
                "Browser bridge is required. Legacy local Playwright execution "
                "has been removed from the Python SDK."
            ),
            error_code="BROWSER_BRIDGE_REQUIRED",
            method_used=self.method,
            latency_ms=(time.time() - start_time) * 1000,
        )

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
        target = step.get("target")
        ref = step.get("ref")
        selector = step.get("selector")
        node_id = step.get("nodeId")
        value = step.get("value", "")

        if isinstance(value, str) and value.startswith("{{") and value.endswith("}}"):
            param_name = value[2:-2].strip()
            value = params.get(param_name, value)

        step_target = node_id if node_id is not None else target
        if step_target is None:
            step_target = ref if ref is not None else selector

        if action == "click":
            await self._bridge_click(bridge, step_target)
        elif action == "navigate":
            await bridge.navigate_browser(str(value))
        elif action == "fill" or action == "type":
            if step_target is None:
                await bridge.type_text(str(value))
            else:
                await self._bridge_type(bridge, step_target, str(value))
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

    async def _bridge_click(self, bridge: Any, target: Any) -> None:
        if target is None:
            raise ValueError("click action requires nodeId/target/ref")

        # Prefer explicit node-id style when available.
        if isinstance(target, int):
            try:
                await bridge.click_node(node_id=target)
                return
            except TypeError:
                pass

        await bridge.click_node(str(target))

    async def _bridge_type(self, bridge: Any, target: Any, text: str) -> None:
        if target is None:
            raise ValueError("type action requires nodeId/target/ref when not using global type")

        if isinstance(target, int):
            try:
                await bridge.input_text_node(node_id=target, text=text)
                return
            except TypeError:
                pass

        await bridge.input_text_node(str(target), text)
