"""
Centris SDK Desktop Executor

Executes capabilities via desktop automation using native APIs.
"""

import logging
import time
import base64
import platform
import subprocess
from typing import Any, Optional

from centris_sdk.types import ExecutionMethod
from centris_sdk.execution.types import (
    ExecutionConfig,
    ExecutionRequest,
    ExecutionResponse,
    ExecutorCapabilities,
)


logger = logging.getLogger("centris.execution.desktop")


class DesktopExecutor:
    """
    Executor for desktop automation.
    
    Features:
    - Native UI automation (AppleScript on macOS, UI Automation on Windows)
    - PyAutoGUI for cross-platform automation
    - Screenshot capture
    - Keyboard and mouse control
    
    Example:
        executor = DesktopExecutor(config)
        
        response = await executor.execute(ExecutionRequest(
            connector_id="desktop",
            capability_id="open_app",
            params={"app_name": "Safari"},
        ))
    """
    
    def __init__(self, config: Optional[ExecutionConfig] = None):
        self.config = config or ExecutionConfig()
        self._system = platform.system()
        self._pyautogui = None
        self._available = False
    
    @property
    def method(self) -> ExecutionMethod:
        return ExecutionMethod.DESKTOP
    
    @property
    def capabilities(self) -> ExecutorCapabilities:
        return ExecutorCapabilities(
            method=ExecutionMethod.DESKTOP,
            available=self._available,
            supports_auth=False,
            supports_streaming=False,
            supports_file_upload=False,
            supports_screenshots=True,
            avg_latency_ms=500,
            reliability_score=0.80,
            cost_per_request=0,
        )
    
    async def is_available(self) -> bool:
        """Check if desktop execution is available."""
        if self._available:
            return True
        
        # Check for pyautogui
        try:
            import pyautogui
            return True
        except ImportError:
            pass
        
        # macOS always has AppleScript
        if self._system == "Darwin":
            return True
        
        return False
    
    async def setup(self) -> None:
        """Initialize desktop automation."""
        try:
            import pyautogui
            pyautogui.FAILSAFE = True
            pyautogui.PAUSE = 0.1
            self._pyautogui = pyautogui
            self._available = True
            logger.info("Desktop executor initialized with pyautogui")
        except ImportError:
            logger.warning("pyautogui not installed. Some features may be limited.")
            # Still available on macOS via AppleScript
            if self._system == "Darwin":
                self._available = True
            else:
                self._available = False
    
    async def teardown(self) -> None:
        """Clean up desktop automation resources."""
        self._pyautogui = None
    
    async def execute(self, request: ExecutionRequest) -> ExecutionResponse:
        """
        Execute a capability via desktop automation.
        
        The capability or params should specify:
        - action: Type of action (open_app, click, type, screenshot, etc.)
        - Plus action-specific parameters
        """
        start_time = time.time()
        
        if not self._available:
            await self.setup()
        
        if not self._available:
            return ExecutionResponse(
                success=False,
                error="Desktop automation not available",
                error_code="DESKTOP_NOT_AVAILABLE",
                method_used=self.method,
            )
        
        screenshot = None
        
        try:
            # Get action from params or capability
            action = request.params.get("action", "")
            
            if not action:
                capability = request.capability
                if capability and hasattr(capability, "desktop_config"):
                    desktop_config = capability.desktop_config or {}
                    action = desktop_config.get("action", "")
            
            if not action:
                return ExecutionResponse(
                    success=False,
                    error="No action specified for desktop automation",
                    error_code="NO_ACTION",
                    method_used=self.method,
                )
            
            # Execute action
            result = await self._execute_action(action, request.params)
            
            # Take screenshot if requested
            if request.params.get("capture_screenshot", False):
                screenshot = await self._capture_screenshot()
            
            latency_ms = (time.time() - start_time) * 1000
            
            return ExecutionResponse(
                success=True,
                data=result,
                method_used=self.method,
                latency_ms=latency_ms,
                screenshot=screenshot,
            )
        
        except Exception as e:
            logger.error(f"Desktop execution error: {e}")
            
            # Try to capture screenshot on error
            if self.config.desktop_screenshot_on_error:
                try:
                    screenshot = await self._capture_screenshot()
                except Exception:
                    pass
            
            return ExecutionResponse(
                success=False,
                error=str(e),
                error_code="DESKTOP_ERROR",
                method_used=self.method,
                latency_ms=(time.time() - start_time) * 1000,
                screenshot=screenshot,
            )
    
    async def _execute_action(
        self,
        action: str,
        params: dict[str, Any],
    ) -> Any:
        """Execute a desktop action."""
        
        if action == "open_app":
            return await self._open_app(params.get("app_name", ""))
        
        elif action == "close_app":
            return await self._close_app(params.get("app_name", ""))
        
        elif action == "click":
            return await self._click(
                params.get("x"),
                params.get("y"),
                params.get("button", "left"),
            )
        
        elif action == "double_click":
            return await self._double_click(
                params.get("x"),
                params.get("y"),
            )
        
        elif action == "type":
            return await self._type_text(
                params.get("text", ""),
                params.get("interval", 0.05),
            )
        
        elif action == "hotkey":
            return await self._hotkey(params.get("keys", []))
        
        elif action == "screenshot":
            return {"screenshot": await self._capture_screenshot()}
        
        elif action == "move":
            return await self._move_mouse(
                params.get("x"),
                params.get("y"),
                params.get("duration", 0.5),
            )
        
        elif action == "scroll":
            return await self._scroll(
                params.get("amount", 0),
                params.get("x"),
                params.get("y"),
            )
        
        elif action == "applescript" and self._system == "Darwin":
            return await self._run_applescript(params.get("script", ""))
        
        else:
            raise ValueError(f"Unknown desktop action: {action}")
    
    async def _open_app(self, app_name: str) -> dict[str, Any]:
        """Open an application."""
        if self._system == "Darwin":
            script = f'tell application "{app_name}" to activate'
            await self._run_applescript(script)
        elif self._pyautogui:
            # Use keyboard shortcut on other platforms
            if self._system == "Windows":
                self._pyautogui.press("win")
                self._pyautogui.typewrite(app_name, interval=0.05)
                self._pyautogui.press("enter")
            else:
                # Linux - try xdg-open
                subprocess.run(["xdg-open", app_name], capture_output=True)
        
        return {"opened": app_name}
    
    async def _close_app(self, app_name: str) -> dict[str, Any]:
        """Close an application."""
        if self._system == "Darwin":
            script = f'tell application "{app_name}" to quit'
            await self._run_applescript(script)
        elif self._pyautogui:
            # Use Alt+F4 on Windows/Linux
            self._pyautogui.hotkey("alt", "F4")
        
        return {"closed": app_name}
    
    async def _click(
        self,
        x: Optional[int],
        y: Optional[int],
        button: str,
    ) -> dict[str, Any]:
        """Click at coordinates."""
        if not self._pyautogui:
            raise RuntimeError("pyautogui not available for click action")
        
        if x is not None and y is not None:
            self._pyautogui.click(x, y, button=button)
        else:
            self._pyautogui.click(button=button)
        
        return {"clicked": {"x": x, "y": y, "button": button}}
    
    async def _double_click(
        self,
        x: Optional[int],
        y: Optional[int],
    ) -> dict[str, Any]:
        """Double-click at coordinates."""
        if not self._pyautogui:
            raise RuntimeError("pyautogui not available for double_click action")
        
        if x is not None and y is not None:
            self._pyautogui.doubleClick(x, y)
        else:
            self._pyautogui.doubleClick()
        
        return {"double_clicked": {"x": x, "y": y}}
    
    async def _type_text(
        self,
        text: str,
        interval: float,
    ) -> dict[str, Any]:
        """Type text."""
        if self._pyautogui:
            self._pyautogui.typewrite(text, interval=interval)
        elif self._system == "Darwin":
            # Use AppleScript for typing
            escaped = text.replace('"', '\\"')
            script = f'tell application "System Events" to keystroke "{escaped}"'
            await self._run_applescript(script)
        
        return {"typed": text}
    
    async def _hotkey(self, keys: list[str]) -> dict[str, Any]:
        """Press a keyboard shortcut."""
        if not self._pyautogui:
            raise RuntimeError("pyautogui not available for hotkey action")
        
        self._pyautogui.hotkey(*keys)
        return {"hotkey": keys}
    
    async def _move_mouse(
        self,
        x: Optional[int],
        y: Optional[int],
        duration: float,
    ) -> dict[str, Any]:
        """Move mouse to coordinates."""
        if not self._pyautogui:
            raise RuntimeError("pyautogui not available for move action")
        
        if x is not None and y is not None:
            self._pyautogui.moveTo(x, y, duration=duration)
        
        return {"moved": {"x": x, "y": y}}
    
    async def _scroll(
        self,
        amount: int,
        x: Optional[int],
        y: Optional[int],
    ) -> dict[str, Any]:
        """Scroll at position."""
        if not self._pyautogui:
            raise RuntimeError("pyautogui not available for scroll action")
        
        if x is not None and y is not None:
            self._pyautogui.scroll(amount, x, y)
        else:
            self._pyautogui.scroll(amount)
        
        return {"scrolled": amount}
    
    async def _run_applescript(self, script: str) -> str:
        """Run an AppleScript (macOS only)."""
        if self._system != "Darwin":
            raise RuntimeError("AppleScript is only available on macOS")
        
        result = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True,
            text=True,
        )
        
        if result.returncode != 0:
            raise RuntimeError(f"AppleScript error: {result.stderr}")
        
        return result.stdout.strip()
    
    async def _capture_screenshot(self) -> str:
        """Capture a screenshot and return as base64."""
        if self._pyautogui:
            import io
            screenshot = self._pyautogui.screenshot()
            buffer = io.BytesIO()
            screenshot.save(buffer, format="PNG")
            return base64.b64encode(buffer.getvalue()).decode()
        
        elif self._system == "Darwin":
            # Use screencapture on macOS
            import tempfile
            import os
            
            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
                temp_path = f.name
            
            try:
                subprocess.run(["screencapture", "-x", temp_path], check=True)
                with open(temp_path, "rb") as f:
                    return base64.b64encode(f.read()).decode()
            finally:
                if os.path.exists(temp_path):
                    os.remove(temp_path)
        
        raise RuntimeError("Screenshot not available")
