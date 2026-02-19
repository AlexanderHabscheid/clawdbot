"""
Centris SDK Execution Router

Routes execution requests to the optimal executor based on
capability configuration and executor availability.
"""

import logging
from typing import Optional, Any

from centris_sdk.types import ExecutionMethod
from centris_sdk.execution.types import (
    ExecutionConfig,
    ExecutionRequest,
    ExecutionPriority,
    ExecutorCapabilities,
    Executor,
)


logger = logging.getLogger("centris.execution.router")


class ExecutionRouter:
    """
    Routes execution requests to the best available executor.
    
    Selection criteria:
    1. Capability's supported methods
    2. Request's preferred/allowed methods
    3. Executor availability
    4. Priority setting (speed/reliability/cost)
    
    Example:
        router = ExecutionRouter(config)
        router.register_executor(api_executor)
        router.register_executor(browser_executor)
        
        executor = await router.select_executor(request)
    """
    
    def __init__(self, config: Optional[ExecutionConfig] = None):
        self.config = config or ExecutionConfig()
        self._executors: dict[ExecutionMethod, Executor] = {}
    
    def register_executor(self, executor: Executor) -> None:
        """Register an executor for a method."""
        self._executors[executor.method] = executor
        logger.debug(f"Registered executor: {executor.method.value}")
    
    def get_executor(self, method: ExecutionMethod) -> Optional[Executor]:
        """Get executor for a specific method."""
        return self._executors.get(method)
    
    async def select_executor(
        self,
        request: ExecutionRequest,
        capability_methods: Optional[list[ExecutionMethod]] = None,
    ) -> Optional[Executor]:
        """
        Select the best executor for a request.
        
        Args:
            request: The execution request
            capability_methods: Methods supported by the capability
            
        Returns:
            Selected executor or None if none available
        """
        # Determine candidate methods
        candidates = await self._get_candidate_methods(request, capability_methods)
        
        if not candidates:
            logger.warning(f"No candidate methods for request {request.capability_id}")
            return None
        
        # Filter by availability
        available_candidates: list[tuple[ExecutionMethod, Executor]] = []
        for method in candidates:
            executor = self._executors.get(method)
            if executor and await executor.is_available():
                available_candidates.append((method, executor))
        
        if not available_candidates:
            logger.warning(f"No available executors for request {request.capability_id}")
            return None
        
        # Select based on priority
        selected = self._select_by_priority(available_candidates)
        
        logger.debug(f"Selected executor: {selected.method.value} for {request.capability_id}")
        return selected
    
    async def _get_candidate_methods(
        self,
        request: ExecutionRequest,
        capability_methods: Optional[list[ExecutionMethod]],
    ) -> list[ExecutionMethod]:
        """Get candidate methods for execution."""
        # Start with all registered methods
        candidates = list(self._executors.keys())
        
        # Filter by capability's supported methods
        if capability_methods:
            candidates = [m for m in candidates if m in capability_methods]
        
        # Filter by request's allowed methods
        if request.allowed_methods:
            candidates = [m for m in candidates if m in request.allowed_methods]
        
        # Prioritize preferred method
        if request.preferred_method and request.preferred_method in candidates:
            # Move preferred to front
            candidates.remove(request.preferred_method)
            candidates.insert(0, request.preferred_method)
        
        return candidates
    
    def _select_by_priority(
        self,
        candidates: list[tuple[ExecutionMethod, Executor]],
    ) -> Executor:
        """Select executor based on priority setting."""
        if len(candidates) == 1:
            return candidates[0][1]
        
        priority = self.config.priority
        
        # Score each candidate
        scored: list[tuple[float, Executor]] = []
        for method, executor in candidates:
            caps = executor.capabilities
            
            if priority == ExecutionPriority.SPEED:
                # Lower latency = higher score
                score = 1000 / max(caps.avg_latency_ms, 1)
            elif priority == ExecutionPriority.RELIABILITY:
                # Higher reliability = higher score
                score = caps.reliability_score * 100
            elif priority == ExecutionPriority.COST:
                # Lower cost = higher score
                score = 1000 / max(caps.cost_per_request, 0.001)
            else:
                score = 0
            
            scored.append((score, executor))
        
        # Sort by score (descending) and return best
        scored.sort(key=lambda x: x[0], reverse=True)
        return scored[0][1]
    
    async def get_fallback_executors(
        self,
        request: ExecutionRequest,
        failed_method: ExecutionMethod,
        capability_methods: Optional[list[ExecutionMethod]] = None,
    ) -> list[Executor]:
        """
        Get fallback executors after a failure.
        
        Args:
            request: The execution request
            failed_method: The method that failed
            capability_methods: Methods supported by the capability
            
        Returns:
            List of fallback executors to try
        """
        if not self.config.fallback_enabled:
            return []
        
        # Get candidates excluding the failed method
        candidates = await self._get_candidate_methods(request, capability_methods)
        candidates = [m for m in candidates if m != failed_method]
        
        # Filter by availability
        fallbacks: list[Executor] = []
        for method in candidates:
            executor = self._executors.get(method)
            if executor and await executor.is_available():
                fallbacks.append(executor)
        
        return fallbacks
    
    def get_available_methods(self) -> list[ExecutionMethod]:
        """Get list of registered methods."""
        return list(self._executors.keys())
