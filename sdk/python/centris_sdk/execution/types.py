"""
Centris SDK Execution Types

Type definitions for the execution engine.
"""

from dataclasses import dataclass, field
from typing import Any, Optional, Protocol
from enum import Enum

from centris_sdk.types import ExecutionMethod


class ExecutionPriority(str, Enum):
    """Priority for execution method selection."""
    SPEED = "speed"        # Prefer fastest method
    RELIABILITY = "reliability"  # Prefer most reliable
    COST = "cost"          # Prefer cheapest


@dataclass
class ExecutionConfig:
    """Configuration for the execution engine."""
    
    # Timeout settings
    default_timeout: float = 30.0
    api_timeout: float = 30.0
    browser_timeout: float = 60.0
    desktop_timeout: float = 60.0
    
    # Retry settings
    max_retries: int = 3
    retry_delay: float = 1.0
    retry_backoff: float = 2.0
    
    # Method selection
    priority: ExecutionPriority = ExecutionPriority.RELIABILITY
    fallback_enabled: bool = True
    
    # Browser settings
    browser_headless: bool = True
    browser_slow_mo: int = 0
    
    # Desktop settings
    desktop_screenshot_on_error: bool = True
    
    # Caching
    cache_enabled: bool = False
    cache_ttl: int = 300


@dataclass
class ExecutionRequest:
    """Request for capability execution."""
    
    capability_id: str
    connector_id: str
    params: dict[str, Any]
    context: dict[str, Any] = field(default_factory=dict)
    
    # Method hints
    preferred_method: Optional[ExecutionMethod] = None
    allowed_methods: Optional[list[ExecutionMethod]] = None
    
    # Request metadata
    request_id: Optional[str] = None
    timeout: Optional[float] = None
    
    # Capability reference (set by engine)
    capability: Optional[Any] = None


@dataclass
class ExecutionResponse:
    """Response from capability execution."""
    
    success: bool
    data: Any = None
    error: Optional[str] = None
    error_code: Optional[str] = None
    
    # Execution metadata
    method_used: Optional[ExecutionMethod] = None
    latency_ms: float = 0
    retry_count: int = 0
    
    # Debug info
    request_id: Optional[str] = None
    fallback_used: bool = False
    screenshot: Optional[str] = None  # Base64 for browser/desktop


@dataclass
class ExecutorCapabilities:
    """Capabilities of an executor."""
    
    method: ExecutionMethod
    available: bool
    
    # What the executor can do
    supports_auth: bool = True
    supports_streaming: bool = False
    supports_file_upload: bool = False
    supports_screenshots: bool = False
    
    # Performance characteristics
    avg_latency_ms: float = 0
    reliability_score: float = 1.0  # 0-1
    cost_per_request: float = 0


class Executor(Protocol):
    """Protocol for execution method implementations."""
    
    @property
    def method(self) -> ExecutionMethod: ...
    
    @property
    def capabilities(self) -> ExecutorCapabilities: ...
    
    async def execute(self, request: ExecutionRequest) -> ExecutionResponse: ...
    
    async def is_available(self) -> bool: ...
    
    async def setup(self) -> None: ...
    
    async def teardown(self) -> None: ...
