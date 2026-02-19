"""
Centris SDK Execution Engine

The main execution engine that coordinates executors and handles
retry logic, fallbacks, and error handling.
"""

import asyncio
import logging
import time
from typing import Optional, Any

from centris_sdk.types import ExecutionMethod
from centris_sdk.execution.types import (
    ExecutionConfig,
    ExecutionRequest,
    ExecutionResponse,
    Executor,
)
from centris_sdk.execution.router import ExecutionRouter
from centris_sdk.execution.executors.api import APIExecutor
from centris_sdk.execution.executors.browser import BrowserExecutor
from centris_sdk.execution.executors.desktop import DesktopExecutor


logger = logging.getLogger("centris.execution.engine")


class ExecutionEngine:
    """
    Main execution engine for Centris connectors.
    
    Features:
    - Multi-method execution (API, Browser, Desktop)
    - Automatic method selection
    - Retry with exponential backoff
    - Fallback to alternative methods
    - Error handling and recovery
    
    Example:
        engine = ExecutionEngine()
        
        result = await engine.execute(
            connector_id="slack",
            capability_id="send_message",
            params={"channel": "#general", "message": "Hello"},
            context={"access_token": "xoxb-..."},
        )
        
        if result.success:
            print(f"Sent message: {result.data}")
        else:
            print(f"Error: {result.error}")
    """
    
    def __init__(
        self,
        config: Optional[ExecutionConfig] = None,
        auto_setup: bool = True,
    ):
        self.config = config or ExecutionConfig()
        self.router = ExecutionRouter(self.config)
        self._setup_complete = False
        
        if auto_setup:
            # Register default executors
            self.router.register_executor(APIExecutor(self.config))
            self.router.register_executor(BrowserExecutor(self.config))
            self.router.register_executor(DesktopExecutor(self.config))
    
    def register_executor(self, executor: Executor) -> None:
        """Register a custom executor."""
        self.router.register_executor(executor)
    
    async def setup(self) -> None:
        """Initialize all executors."""
        if self._setup_complete:
            return
        
        for method in self.router.get_available_methods():
            executor = self.router.get_executor(method)
            if executor:
                try:
                    await executor.setup()
                except Exception as e:
                    logger.warning(f"Failed to setup {method.value} executor: {e}")
        
        self._setup_complete = True
    
    async def teardown(self) -> None:
        """Clean up all executors."""
        for method in self.router.get_available_methods():
            executor = self.router.get_executor(method)
            if executor:
                try:
                    await executor.teardown()
                except Exception as e:
                    logger.warning(f"Failed to teardown {method.value} executor: {e}")
        
        self._setup_complete = False
    
    async def execute(
        self,
        connector_id: str,
        capability_id: str,
        params: dict[str, Any],
        context: Optional[dict[str, Any]] = None,
        capability: Optional[Any] = None,
        preferred_method: Optional[ExecutionMethod] = None,
        timeout: Optional[float] = None,
    ) -> ExecutionResponse:
        """
        Execute a capability.
        
        Args:
            connector_id: ID of the connector
            capability_id: ID of the capability to execute
            params: Input parameters
            context: Execution context (auth tokens, etc.)
            capability: Optional capability reference for method hints
            preferred_method: Preferred execution method
            timeout: Custom timeout
            
        Returns:
            ExecutionResponse with result or error
        """
        await self.setup()
        
        # Build request
        request = ExecutionRequest(
            connector_id=connector_id,
            capability_id=capability_id,
            params=params,
            context=context or {},
            preferred_method=preferred_method,
            timeout=timeout or self.config.default_timeout,
            capability=capability,
        )
        
        # Get capability methods if available
        capability_methods = None
        if capability and hasattr(capability, "execution_methods"):
            capability_methods = capability.execution_methods
        
        # Select executor
        executor = await self.router.select_executor(request, capability_methods)
        if not executor:
            return ExecutionResponse(
                success=False,
                error="No available executor for this capability",
                error_code="NO_EXECUTOR",
                request_id=request.request_id,
            )
        
        # Execute with retry
        return await self._execute_with_retry(
            request,
            executor,
            capability_methods,
        )
    
    async def _execute_with_retry(
        self,
        request: ExecutionRequest,
        executor: Executor,
        capability_methods: Optional[list[ExecutionMethod]],
    ) -> ExecutionResponse:
        """Execute with retry and fallback logic."""
        last_error: Optional[str] = None
        retry_count = 0
        fallback_used = False
        
        current_executor = executor
        tried_methods: set[ExecutionMethod] = set()
        
        while retry_count <= self.config.max_retries:
            tried_methods.add(current_executor.method)
            
            start_time = time.time()
            
            try:
                # Execute with timeout
                response = await asyncio.wait_for(
                    current_executor.execute(request),
                    timeout=request.timeout or self.config.default_timeout,
                )
                
                response.retry_count = retry_count
                response.fallback_used = fallback_used
                response.request_id = request.request_id
                
                if response.success:
                    return response
                
                # Execution failed but no exception
                last_error = response.error or "Unknown error"
                
            except asyncio.TimeoutError:
                last_error = f"Execution timed out after {request.timeout}s"
                logger.warning(f"Timeout executing {request.capability_id}: {last_error}")
                
            except Exception as e:
                last_error = str(e)
                logger.error(f"Error executing {request.capability_id}: {e}")
            
            latency_ms = (time.time() - start_time) * 1000
            
            # Try fallback
            if self.config.fallback_enabled:
                fallback_executors = await self.router.get_fallback_executors(
                    request,
                    current_executor.method,
                    capability_methods,
                )
                
                # Filter out already tried methods
                fallback_executors = [
                    e for e in fallback_executors
                    if e.method not in tried_methods
                ]
                
                if fallback_executors:
                    current_executor = fallback_executors[0]
                    fallback_used = True
                    logger.info(f"Falling back to {current_executor.method.value} for {request.capability_id}")
                    continue
            
            # No fallback, retry with same executor
            retry_count += 1
            if retry_count <= self.config.max_retries:
                delay = self.config.retry_delay * (self.config.retry_backoff ** (retry_count - 1))
                logger.info(f"Retrying {request.capability_id} in {delay}s (attempt {retry_count})")
                await asyncio.sleep(delay)
        
        # All retries exhausted
        return ExecutionResponse(
            success=False,
            error=last_error or "Execution failed after all retries",
            error_code="MAX_RETRIES_EXCEEDED",
            method_used=current_executor.method,
            retry_count=retry_count,
            fallback_used=fallback_used,
            request_id=request.request_id,
        )
    
    async def execute_batch(
        self,
        requests: list[dict[str, Any]],
        concurrency: int = 5,
    ) -> list[ExecutionResponse]:
        """
        Execute multiple requests concurrently.
        
        Args:
            requests: List of request dicts with connector_id, capability_id, params
            concurrency: Maximum concurrent executions
            
        Returns:
            List of responses in same order as requests
        """
        semaphore = asyncio.Semaphore(concurrency)
        
        async def execute_one(req: dict[str, Any]) -> ExecutionResponse:
            async with semaphore:
                return await self.execute(**req)
        
        tasks = [execute_one(req) for req in requests]
        return await asyncio.gather(*tasks)
