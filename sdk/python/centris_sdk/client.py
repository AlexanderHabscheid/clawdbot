"""Centris Python Client - One method, infinite power.

Usage:
    from centris import Centris
    
    centris = Centris(api_key="ck_live_xxx")
    result = centris.do("Open Gmail and read my first 3 emails")
    print(result.text)

That's it. The entire Centris platform in one method.

API Versioning:
    # Pin to a specific API version for stability
    centris = Centris(api_key="ck_live_xxx", api_version="2026-01-30")
    
    # Handle deprecation warnings
    centris.on_deprecation(lambda endpoint, sunset, alt: 
        print(f"Warning: {endpoint} deprecated, use {alt}")
    )

Advanced usage:
    # Async execution (for long tasks)
    task = centris.do("Research AI trends", async_mode=True)
    result = centris.wait(task.task_id)
    
    # Check usage
    usage = centris.usage()
    print(f"Tasks remaining: {usage.tasks_remaining}")
    
    # Context (e.g., current browser URL)
    result = centris.do(
        "Click the submit button",
        context={"browser": {"url": "https://example.com/form"}}
    )

See Also:
    - docs/api/API_MIGRATION_GUIDE.md - Version negotiation and deprecation
    - docs/api/API_CHANGELOG.md - Version history
"""

import logging
import os
import time
import warnings
from dataclasses import dataclass, field
from typing import Optional, Dict, Any, List, Callable

import httpx

logger = logging.getLogger(__name__)

# Default API version (set to current stable)
DEFAULT_API_VERSION = "2026-01-30"


@dataclass
class CentrisResult:
    """Result from a Centris command."""
    task_id: str
    status: str  # "completed", "failed", "queued", "running"
    text: str  # The result text
    actions: List[Dict[str, Any]]  # Actions performed
    error: Optional[str] = None
    usage: Optional[Dict[str, Any]] = None
    # Version metadata from response headers
    api_version: Optional[str] = None
    api_version_warning: Optional[str] = None
    deprecation_info: Optional[Dict[str, str]] = None
    
    @property
    def success(self) -> bool:
        return self.status == "completed"
    
    @property
    def is_deprecated(self) -> bool:
        """Check if this endpoint is deprecated."""
        return self.deprecation_info is not None
    
    def __str__(self) -> str:
        return self.text if self.success else f"Error: {self.error}"


# Type alias for deprecation callback
DeprecationCallback = Callable[[str, Optional[str], Optional[str]], None]


@dataclass
class CentrisUsage:
    """Usage information."""
    tier: str
    tasks_remaining: int
    monthly_limit: int
    daily_bonus: int
    tasks_used_today: int
    period_ends: Optional[str] = None


class CentrisError(Exception):
    """Base exception for Centris errors."""
    
    def __init__(self, message: str, code: Optional[str] = None, task_id: Optional[str] = None):
        super().__init__(message)
        self.code = code
        self.task_id = task_id


class AuthenticationError(CentrisError):
    """API key is invalid or missing."""
    pass


class RateLimitError(CentrisError):
    """Task limit exceeded."""
    pass


class Centris:
    """Centris API client.
    
    The simplest way to use Centris programmatically:
    
        centris = Centris(api_key="ck_live_xxx")
        result = centris.do("Open Gmail")
        
    That's it.
    
    API Versioning:
        # Pin to a specific version for stability
        centris = Centris(api_key="ck_live_xxx", api_version="2026-01-30")
        
        # Handle deprecation warnings
        centris.on_deprecation(lambda endpoint, sunset, alt: 
            print(f"Warning: {endpoint} deprecated, use {alt}")
        )
    
    Local-First Execution:
        # Run entirely on your computer (no API server needed)
        centris = Centris(local=True)
        result = centris.do("Open Gmail")
    """
    
    DEFAULT_URL = "https://api.centris.ai"
    LOCAL_URL = "http://localhost:7777"
    
    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        timeout: float = 120.0,
        local: bool = False,
        api_version: Optional[str] = None,
    ):
        """Initialize Centris client.
        
        Args:
            api_key: Your Centris API key (or set CENTRIS_API_KEY env var)
            base_url: API base URL (defaults to https://api.centris.ai)
            timeout: Request timeout in seconds
            local: If True, run locally without API server (local-first mode)
            api_version: API version to use (YYYY-MM-DD format, or set CENTRIS_API_VERSION env var)
                        If not specified, uses the current stable version.
                        Pin this for production stability.
        """
        self.api_key = api_key or os.environ.get("CENTRIS_API_KEY")
        if not self.api_key:
            # Try local development
            self.api_key = "ck_test_local"
        
        self.local = local or os.environ.get("CENTRIS_LOCAL", "").lower() == "true"
        self.timeout = timeout
        self._client = None
        
        # API versioning
        self.api_version = api_version or os.environ.get("CENTRIS_API_VERSION") or DEFAULT_API_VERSION
        self._deprecation_callbacks: List[DeprecationCallback] = []
        
        # Determine base URL (only if not local mode)
        if not self.local:
            if base_url:
                self.base_url = base_url.rstrip("/")
            elif os.environ.get("CENTRIS_API_URL"):
                self.base_url = os.environ["CENTRIS_API_URL"].rstrip("/")
            else:
                # Check if local server is running, fallback to cloud
                self.base_url = self._detect_base_url()
            
            self._client = httpx.Client(timeout=timeout)
        else:
            self.base_url = None
    
    def _detect_base_url(self) -> str:
        """Detect if local or cloud API should be used."""
        try:
            # Quick check if local server is running
            response = httpx.get(f"{self.LOCAL_URL}/health", timeout=1.0)
            if response.status_code == 200:
                return self.LOCAL_URL
        except:
            pass
        return self.DEFAULT_URL
    
    def _headers(self) -> Dict[str, str]:
        """Get request headers including API version."""
        return {
            "X-Centris-Key": self.api_key,
            "Content-Type": "application/json",
            "Accept-Version": self.api_version,
        }
    
    def _parse_version_headers(self, response: httpx.Response) -> Dict[str, Any]:
        """Parse version-related headers from response.
        
        Returns dict with:
            - api_version: The actual version used
            - api_version_warning: Warning if version mismatch
            - deprecation_info: Deprecation details if endpoint is deprecated
        """
        result = {
            "api_version": response.headers.get("X-API-Version"),
            "api_version_warning": response.headers.get("X-API-Version-Warning"),
            "deprecation_info": None,
        }
        
        # Check for deprecation
        if response.headers.get("Deprecation") == "true":
            result["deprecation_info"] = {
                "deprecated": True,
                "sunset": response.headers.get("Sunset"),
                "link": response.headers.get("Link"),
            }
            
            # Extract alternative endpoint from Link header
            link_header = response.headers.get("Link", "")
            if 'rel="successor-version"' in link_header:
                # Parse: </api/v1/do>; rel="successor-version"
                for part in link_header.split(","):
                    if 'rel="successor-version"' in part:
                        alt = part.split(";")[0].strip().strip("<>")
                        result["deprecation_info"]["alternative"] = alt
                        break
            
            # Fire deprecation callbacks
            self._fire_deprecation_callbacks(
                endpoint=response.request.url.path if response.request else "unknown",
                sunset=response.headers.get("Sunset"),
                alternative=result["deprecation_info"].get("alternative"),
            )
        
        # Log version warnings
        if result["api_version_warning"]:
            logger.warning(f"API Version Warning: {result['api_version_warning']}")
        
        return result
    
    def _fire_deprecation_callbacks(
        self,
        endpoint: str,
        sunset: Optional[str],
        alternative: Optional[str],
    ) -> None:
        """Fire registered deprecation callbacks."""
        # Always emit Python warning
        warnings.warn(
            f"Centris API endpoint '{endpoint}' is deprecated. "
            f"Sunset: {sunset or 'unknown'}. "
            f"Alternative: {alternative or 'see migration docs'}",
            DeprecationWarning,
            stacklevel=4,
        )
        
        # Fire registered callbacks
        for callback in self._deprecation_callbacks:
            try:
                callback(endpoint, sunset, alternative)
            except Exception as e:
                logger.warning(f"Deprecation callback error: {e}")
    
    def on_deprecation(self, callback: DeprecationCallback) -> "Centris":
        """Register a callback for deprecation warnings.
        
        The callback receives (endpoint, sunset_date, alternative_endpoint).
        
        Args:
            callback: Function called when a deprecated endpoint is used
            
        Returns:
            self (for chaining)
            
        Example:
            centris.on_deprecation(lambda ep, sun, alt: 
                print(f"Warning: {ep} deprecated, use {alt}")
            )
        """
        self._deprecation_callbacks.append(callback)
        return self
    
    def get_version_info(self) -> Dict[str, Any]:
        """Get API version information from the server.
        
        Returns:
            Dict with current_version, minimum_supported_version, deprecations, etc.
            
        Example:
            info = centris.get_version_info()
            print(f"Current version: {info['current_version']}")
        """
        if self.local:
            return {
                "current_version": self.api_version,
                "local_mode": True,
            }
        
        response = self._client.get(
            f"{self.base_url}/api/version",
            headers=self._headers(),
        )
        return response.json()
    
    def do(
        self,
        command: str,
        async_mode: bool = False,
        context: Optional[Dict[str, Any]] = None,
    ) -> CentrisResult:
        """Execute a command.
        
        Args:
            command: What you want Centris to do (natural language)
            async_mode: If True, returns immediately with task_id for polling
            context: Optional context (browser URL, system info, etc.)
            
        Returns:
            CentrisResult with the response (includes API version metadata)
            
        Raises:
            AuthenticationError: Invalid API key
            RateLimitError: Task limit exceeded
            CentrisError: Other errors (including VERSION_NOT_SUPPORTED)
            
        Example:
            result = centris.do("Open Gmail and read my first email")
            print(result.text)
            
            # Check if endpoint is deprecated
            if result.is_deprecated:
                print(f"Warning: endpoint deprecated, sunset: {result.deprecation_info['sunset']}")
        """
        # Local-first execution (no API server needed)
        if self.local:
            return self._execute_local(command, context)
        
        # API execution
        response = self._client.post(
            f"{self.base_url}/api/v1/do",
            headers=self._headers(),
            json={
                "command": command,
                "async": async_mode,
                "context": context or {},
            },
        )
        
        data = response.json()
        
        # Parse version headers (may fire deprecation callbacks)
        version_info = self._parse_version_headers(response)
        
        # Handle errors
        if response.status_code == 400 and data.get("code") == "VERSION_NOT_SUPPORTED":
            raise CentrisError(
                data.get("error", "API version not supported"),
                code="VERSION_NOT_SUPPORTED",
                task_id=data.get("task_id"),
            )
        
        if response.status_code == 401:
            raise AuthenticationError(
                data.get("error", "Authentication failed"),
                code="AUTH_FAILED",
                task_id=data.get("task_id"),
            )
        
        if response.status_code == 429:
            raise RateLimitError(
                data.get("error", "Rate limit exceeded"),
                code="RATE_LIMIT_EXCEEDED",
                task_id=data.get("task_id"),
            )
        
        if data.get("status") == "failed":
            raise CentrisError(
                data.get("error", "Command failed"),
                code=data.get("code"),
                task_id=data.get("task_id"),
            )
        
        return CentrisResult(
            task_id=data.get("task_id", ""),
            status=data.get("status", "completed"),
            text=data.get("result", ""),
            actions=data.get("actions", []),
            usage=data.get("usage"),
            api_version=version_info.get("api_version"),
            api_version_warning=version_info.get("api_version_warning"),
            deprecation_info=version_info.get("deprecation_info"),
        )
    
    def _execute_local(self, command: str, context: Optional[Dict[str, Any]] = None) -> CentrisResult:
        """Execute command locally without API server.
        
        This is local-first execution - the entire Centris system runs
        on your computer without needing a backend server.
        """
        import asyncio
        import uuid
        
        task_id = f"ctask_{uuid.uuid4().hex[:12]}"
        
        try:
            # Import backend modules directly
            from backend.infra.command_executor import execute_command
            
            # Run in event loop
            try:
                loop = asyncio.get_event_loop()
            except RuntimeError:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
            
            result = loop.run_until_complete(
                execute_command(
                    command=command,
                    user_id="local_user",
                    source="sdk_local",
                    context=context,
                )
            )
            
            if result.success:
                return CentrisResult(
                    task_id=task_id,
                    status="completed",
                    text=result.response,
                    actions=result.actions,
                    usage={"llm_calls": result.llm_calls},
                )
            else:
                raise CentrisError(
                    result.error or "Local execution failed",
                    code=result.error_code,
                    task_id=task_id,
                )
                
        except ImportError as e:
            raise CentrisError(
                f"Backend not available for local execution: {e}. "
                "Install centris-sdk[all] or run with local=False to use API.",
                code="IMPORT_ERROR",
                task_id=task_id,
            )
    
    def wait(
        self,
        task_id: str,
        poll_interval: float = 2.0,
        timeout: Optional[float] = None,
    ) -> CentrisResult:
        """Wait for an async task to complete.
        
        Args:
            task_id: Task ID from async do() call
            poll_interval: Seconds between status checks
            timeout: Max seconds to wait (None = use client timeout)
            
        Returns:
            CentrisResult when task completes (includes API version metadata)
        """
        timeout = timeout or self.timeout
        start = time.time()
        
        while time.time() - start < timeout:
            response = self._client.get(
                f"{self.base_url}/api/v1/task/{task_id}",
                headers=self._headers(),
            )
            
            data = response.json()
            status = data.get("status")
            
            # Parse version headers
            version_info = self._parse_version_headers(response)
            
            if status == "completed":
                return CentrisResult(
                    task_id=task_id,
                    status="completed",
                    text=data.get("result", ""),
                    actions=data.get("actions", []),
                    api_version=version_info.get("api_version"),
                    api_version_warning=version_info.get("api_version_warning"),
                    deprecation_info=version_info.get("deprecation_info"),
                )
            
            if status == "failed":
                raise CentrisError(
                    data.get("error", "Task failed"),
                    code=data.get("code"),
                    task_id=task_id,
                )
            
            time.sleep(poll_interval)
        
        raise CentrisError(
            f"Task {task_id} timed out after {timeout}s",
            code="TIMEOUT",
            task_id=task_id,
        )
    
    def usage(self) -> CentrisUsage:
        """Get current usage and limits.
        
        Returns:
            CentrisUsage with tier, remaining tasks, etc.
        """
        response = self._client.get(
            f"{self.base_url}/api/v1/usage",
            headers=self._headers(),
        )
        
        if response.status_code == 401:
            raise AuthenticationError("Invalid API key")
        
        data = response.json()
        
        return CentrisUsage(
            tier=data.get("tier", "free"),
            tasks_remaining=data.get("tasks_remaining", 0),
            monthly_limit=data.get("monthly_limit", 0),
            daily_bonus=data.get("daily_bonus", 0),
            tasks_used_today=data.get("tasks_used_today", 0),
            period_ends=data.get("period_ends"),
        )
    
    def __enter__(self):
        return self
    
    def __exit__(self, *args):
        self._client.close()
    
    def close(self):
        """Close the HTTP client."""
        self._client.close()


# Convenience function for one-off usage
def do(command: str, api_key: Optional[str] = None, **kwargs) -> CentrisResult:
    """Execute a command without creating a client.
    
    Args:
        command: What you want Centris to do
        api_key: Optional API key (or set CENTRIS_API_KEY env var)
        **kwargs: Additional arguments passed to Centris.do()
        
    Returns:
        CentrisResult
        
    Example:
        from centris import do
        result = do("Open Gmail")
    """
    with Centris(api_key=api_key) as client:
        return client.do(command, **kwargs)
