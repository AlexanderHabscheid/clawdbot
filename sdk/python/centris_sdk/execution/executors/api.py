"""
Centris SDK API Executor

Executes capabilities via direct HTTP/REST API calls.
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


logger = logging.getLogger("centris.execution.api")


class APIExecutor:
    """
    Executor for direct API calls.
    
    Features:
    - HTTP/REST API execution
    - OAuth2 and API key authentication
    - Request/response transformation
    - Rate limiting support
    
    Example:
        executor = APIExecutor(config)
        
        response = await executor.execute(ExecutionRequest(
            connector_id="slack",
            capability_id="send_message",
            params={"channel": "#general", "message": "Hello"},
            context={"access_token": "xoxb-..."},
        ))
    """
    
    def __init__(self, config: Optional[ExecutionConfig] = None):
        self.config = config or ExecutionConfig()
        self._client = None
        self._available = True
    
    @property
    def method(self) -> ExecutionMethod:
        return ExecutionMethod.API
    
    @property
    def capabilities(self) -> ExecutorCapabilities:
        return ExecutorCapabilities(
            method=ExecutionMethod.API,
            available=self._available,
            supports_auth=True,
            supports_streaming=True,
            supports_file_upload=True,
            supports_screenshots=False,
            avg_latency_ms=200,
            reliability_score=0.95,
            cost_per_request=0.001,
        )
    
    async def is_available(self) -> bool:
        """Check if API execution is available."""
        return self._available
    
    async def setup(self) -> None:
        """Initialize the HTTP client."""
        try:
            import httpx
            self._client = httpx.AsyncClient(
                timeout=self.config.api_timeout,
                follow_redirects=True,
            )
            self._available = True
        except ImportError:
            logger.warning("httpx not installed, API executor will use capability handlers directly")
            self._available = True  # Still available, just uses direct execution
    
    async def teardown(self) -> None:
        """Clean up the HTTP client."""
        if self._client:
            await self._client.aclose()
            self._client = None
    
    async def execute(self, request: ExecutionRequest) -> ExecutionResponse:
        """
        Execute a capability via API.
        
        If the capability has an API configuration, makes HTTP requests.
        Otherwise, calls the capability handler directly.
        """
        start_time = time.time()
        
        try:
            # Check if capability has API config
            capability = request.capability
            
            if capability and hasattr(capability, "api_config") and capability.api_config:
                # Execute via HTTP
                return await self._execute_http(request, capability.api_config)
            elif capability and hasattr(capability, "handler") and capability.handler:
                # Execute handler directly
                return await self._execute_handler(request, capability.handler)
            else:
                # No execution method available
                return ExecutionResponse(
                    success=False,
                    error="Capability has no API configuration or handler",
                    error_code="NO_API_CONFIG",
                    method_used=self.method,
                    latency_ms=(time.time() - start_time) * 1000,
                )
        
        except Exception as e:
            logger.error(f"API execution error: {e}")
            return ExecutionResponse(
                success=False,
                error=str(e),
                error_code="API_ERROR",
                method_used=self.method,
                latency_ms=(time.time() - start_time) * 1000,
            )
    
    async def _execute_http(
        self,
        request: ExecutionRequest,
        api_config: dict[str, Any],
    ) -> ExecutionResponse:
        """Execute via HTTP request."""
        start_time = time.time()
        
        if not self._client:
            await self.setup()
        
        if not self._client:
            return ExecutionResponse(
                success=False,
                error="HTTP client not available",
                error_code="NO_HTTP_CLIENT",
                method_used=self.method,
            )
        
        # Build request
        method = api_config.get("method", "POST").upper()
        url = api_config.get("url", "")
        headers = api_config.get("headers", {}).copy()
        
        # Add auth from context
        if "access_token" in request.context:
            headers["Authorization"] = f"Bearer {request.context['access_token']}"
        elif "api_key" in request.context:
            headers["X-API-Key"] = request.context["api_key"]
        
        # Prepare body
        body = request.params
        if api_config.get("transform_request"):
            # Apply request transformation
            transform = api_config["transform_request"]
            if callable(transform):
                body = transform(body)
        
        # Make request
        try:
            if method in ("GET", "HEAD", "OPTIONS"):
                response = await self._client.request(method, url, headers=headers, params=body)
            else:
                response = await self._client.request(method, url, headers=headers, json=body)
            
            latency_ms = (time.time() - start_time) * 1000
            
            # Parse response
            if response.status_code >= 200 and response.status_code < 300:
                try:
                    data = response.json()
                except Exception:
                    data = {"text": response.text}
                
                # Apply response transformation
                if api_config.get("transform_response"):
                    transform = api_config["transform_response"]
                    if callable(transform):
                        data = transform(data)
                
                return ExecutionResponse(
                    success=True,
                    data=data,
                    method_used=self.method,
                    latency_ms=latency_ms,
                )
            else:
                return ExecutionResponse(
                    success=False,
                    error=f"HTTP {response.status_code}: {response.text[:200]}",
                    error_code=f"HTTP_{response.status_code}",
                    method_used=self.method,
                    latency_ms=latency_ms,
                )
        
        except Exception as e:
            return ExecutionResponse(
                success=False,
                error=str(e),
                error_code="HTTP_ERROR",
                method_used=self.method,
                latency_ms=(time.time() - start_time) * 1000,
            )
    
    async def _execute_handler(
        self,
        request: ExecutionRequest,
        handler: Any,
    ) -> ExecutionResponse:
        """Execute capability handler directly."""
        start_time = time.time()
        
        try:
            # Build context dict
            context = {
                "user_id": request.context.get("user_id"),
                "session_id": request.context.get("session_id"),
                "access_token": request.context.get("access_token"),
                "api_key": request.context.get("api_key"),
            }
            
            # Call handler
            result = await handler(request.params, context)
            
            latency_ms = (time.time() - start_time) * 1000
            
            return ExecutionResponse(
                success=True,
                data=result,
                method_used=self.method,
                latency_ms=latency_ms,
            )
        
        except Exception as e:
            return ExecutionResponse(
                success=False,
                error=str(e),
                error_code="HANDLER_ERROR",
                method_used=self.method,
                latency_ms=(time.time() - start_time) * 1000,
            )
