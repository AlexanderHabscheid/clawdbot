"""
Centris SDK Execution Engine

Provides multi-method execution capabilities for connectors.

Execution Methods:
- API: Direct HTTP/REST API calls
- Browser: Browser automation via Playwright
- Desktop: Desktop automation via native APIs

The ExecutionRouter automatically selects the best method based on
capability configuration and availability.

Example:
    from centris_sdk.execution import ExecutionEngine, ExecutionRouter
    
    # Create engine
    engine = ExecutionEngine()
    
    # Execute with automatic method selection
    result = await engine.execute(
        capability=send_message_cap,
        params={"message": "Hello"},
        context={"access_token": "..."},
    )
"""

from centris_sdk.execution.types import (
    ExecutionConfig,
    ExecutionRequest,
    ExecutionResponse,
    ExecutorCapabilities,
)
from centris_sdk.execution.router import ExecutionRouter
from centris_sdk.execution.engine import ExecutionEngine
from centris_sdk.execution.executors.api import APIExecutor
from centris_sdk.execution.executors.browser import BrowserExecutor
from centris_sdk.execution.executors.desktop import DesktopExecutor

__all__ = [
    # Core
    "ExecutionEngine",
    "ExecutionRouter",
    # Executors
    "APIExecutor",
    "BrowserExecutor",
    "DesktopExecutor",
    # Types
    "ExecutionConfig",
    "ExecutionRequest",
    "ExecutionResponse",
    "ExecutorCapabilities",
]
