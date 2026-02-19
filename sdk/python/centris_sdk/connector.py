"""
Centris SDK Connector Base Class

The main class for building Centris connectors.

SDK Standard: Modular Structure
==============================
ALL connectors must use modular structure:

    my-connector/
    ├── __init__.py           # Package exports
    ├── connector.py          # Thin coordinator (routes to services)
    ├── connector.json        # Manifest
    ├── base.py               # Shared base class and utilities
    └── services/             # Implementation modules
        ├── __init__.py       # Service registry
        ├── service1.py       # Service module (<300 lines, <5 tools)
        └── service2.py       # Another service module

Rules enforced by `centris validate`:
- services/ directory is REQUIRED
- Max 500 lines per file (warning at 300)
- Max 5 tools per file
- base.py recommended for shared code

Create a new connector: `centris init my-connector`
"""

from typing import Any, Callable, Optional, Awaitable
import asyncio
import time
import json

from centris_sdk.types import (
    ExecutionMethod,
    AuthScheme,
    ExecutionContext,
    ExecutionResult,
    ErrorDetails,
    ResponseMetadata,
    ConnectorCard,
    UIMapping,
    OAuthConfig,
)
from centris_sdk.capability import Capability


class CentrisConnector:
    """
    Base class for all Centris connectors.
    Handles registration, capability exposure, and execution routing.

    Example:
        slack = CentrisConnector(
            connector_id="slack",
            name="Slack",
            description="Send messages and manage Slack workspaces",
            auth_schemes=[AuthScheme.OAUTH2],
        )

        @slack.capability(
            id="send_message",
            name="Send Message",
            description="Send a message to a Slack channel",
            input_schema={
                "type": "object",
                "properties": {
                    "channel": {"type": "string"},
                    "message": {"type": "string"},
                },
                "required": ["channel", "message"],
            },
        )
        async def send_message(params: dict, context: dict) -> dict:
            return {"ok": True}
    """

    def __init__(
        self,
        connector_id: str,
        name: str,
        description: str,
        version: str = "1.0.0",
        provider: str = "",
        auth_schemes: Optional[list[AuthScheme]] = None,
        oauth_config: Optional[OAuthConfig] = None,
        categories: Optional[list[str]] = None,
        tags: Optional[list[str]] = None,
        icon_url: Optional[str] = None,
        documentation_url: Optional[str] = None,
    ):
        self.card = ConnectorCard(
            id=connector_id,
            name=name,
            description=description,
            version=version,
            provider=provider,
            auth_schemes=auth_schemes or [AuthScheme.OAUTH2],
            oauth_config=oauth_config,
            categories=categories or [],
            tags=tags or [],
            icon_url=icon_url,
            documentation_url=documentation_url,
        )
        self._handlers: dict[str, Callable[..., Awaitable[dict[str, Any]]]] = {}
        self._context_provider: Optional[Callable[[], dict[str, Any]]] = None
        self._ui_mappings: list[UIMapping] = []

    @property
    def id(self) -> str:
        """Get the connector ID."""
        return self.card.id

    @property
    def name(self) -> str:
        """Get the connector name."""
        return self.card.name

    @property
    def capabilities(self) -> list[Capability]:
        """Get all registered capabilities."""
        return self.card.capabilities

    def capability(
        self,
        id: str,
        name: str,
        description: str,
        input_schema: dict[str, Any],
        output_schema: Optional[dict[str, Any]] = None,
        examples: Optional[list[str]] = None,
        tags: Optional[list[str]] = None,
        requires_confirmation: bool = False,
        execution_methods: Optional[list[ExecutionMethod]] = None,
        rate_limit: Optional[int] = None,
    ) -> Callable[[Callable[..., Awaitable[dict[str, Any]]]], Callable[..., Awaitable[dict[str, Any]]]]:
        """
        Decorator to register a capability handler.

        Args:
            id: Unique identifier for this capability
            name: Human-readable name
            description: Description for AI context
            input_schema: JSON Schema for input parameters
            output_schema: JSON Schema for output (optional)
            examples: Example phrases that trigger this capability
            tags: Categorization tags
            requires_confirmation: Whether to require human confirmation
            execution_methods: Supported execution methods
            rate_limit: Maximum calls per minute

        Returns:
            Decorated function
        """

        def decorator(
            func: Callable[..., Awaitable[dict[str, Any]]]
        ) -> Callable[..., Awaitable[dict[str, Any]]]:
            cap = Capability(
                id=id,
                name=name,
                description=description,
                input_schema=input_schema,
                output_schema=output_schema or {"type": "object"},
                examples=examples or [],
                tags=tags or [],
                requires_confirmation=requires_confirmation,
                execution_methods=execution_methods or [ExecutionMethod.API],
                rate_limit=rate_limit,
                handler=func,
            )
            self.card.capabilities.append(cap)
            self._handlers[id] = func
            return func

        return decorator

    def context_provider(
        self, func: Callable[[], dict[str, Any]]
    ) -> Callable[[], dict[str, Any]]:
        """
        Decorator to register a context provider function.

        The context provider returns current application state
        that can be used by the AI for better understanding.
        """
        self._context_provider = func
        return func

    def map_ui_element(
        self,
        selector: str,
        semantic_role: str,
        action: str,
        context: Optional[list[str]] = None,
    ) -> None:
        """
        Map a UI element to a semantic action for browser automation.

        Args:
            selector: CSS selector for the element
            semantic_role: Semantic role (e.g., "send_button")
            action: Action type (e.g., "click", "type")
            context: Additional context information
        """
        self._ui_mappings.append(
            UIMapping(
                selector=selector,
                semantic_role=semantic_role,
                action=action,
                context=context or [],
            )
        )

    async def execute(
        self,
        capability_id: str,
        params: dict[str, Any],
        context: Optional[ExecutionContext] = None,
    ) -> ExecutionResult[Any]:
        """
        Execute a capability with given parameters.

        Args:
            capability_id: ID of the capability to execute
            params: Input parameters
            context: Execution context with auth info

        Returns:
            ExecutionResult with success status and data or error
        """
        if capability_id not in self._handlers:
            return ExecutionResult(
                success=False,
                error=ErrorDetails(
                    code="UNKNOWN_CAPABILITY",
                    message=f"Capability '{capability_id}' not found",
                ),
            )

        handler = self._handlers[capability_id]
        start_time = time.time()

        try:
            # Convert ExecutionContext to dict for handler
            context_dict = {}
            if context:
                context_dict = {
                    "user_id": context.user_id,
                    "session_id": context.session_id,
                    "access_token": context.access_token,
                    "refresh_token": context.refresh_token,
                    "preferences": context.preferences,
                    "metadata": context.metadata,
                }

            data = await handler(params, context_dict)
            latency_ms = int((time.time() - start_time) * 1000)

            return ExecutionResult(
                success=True,
                data=data,
                metadata=ResponseMetadata(
                    execution_method=ExecutionMethod.API,
                    latency_ms=latency_ms,
                    retry_count=0,
                ),
            )
        except Exception as e:
            latency_ms = int((time.time() - start_time) * 1000)
            return ExecutionResult(
                success=False,
                error=ErrorDetails(
                    code="EXECUTION_ERROR",
                    message=str(e),
                    retryable=False,
                ),
                metadata=ResponseMetadata(
                    execution_method=ExecutionMethod.API,
                    latency_ms=latency_ms,
                    retry_count=0,
                ),
            )

    def get_context(self) -> dict[str, Any]:
        """Get current application context."""
        if self._context_provider:
            return self._context_provider()
        return {}

    def get_ui_mappings(self) -> list[UIMapping]:
        """Get UI element mappings for browser automation."""
        return self._ui_mappings

    def get_capability(self, capability_id: str) -> Optional[Capability]:
        """Get a capability by ID."""
        for cap in self.card.capabilities:
            if cap.id == capability_id:
                return cap
        return None

    def to_mcp_schema(self) -> dict[str, Any]:
        """Export as MCP-compatible tool schema."""
        return self.card.to_mcp_schema()

    def to_agent_card(self) -> dict[str, Any]:
        """Export as A2A-compatible AgentCard."""
        return self.card.to_agent_card()

    def export_schema(self) -> dict[str, Any]:
        """Export connector schema for registration."""
        return {
            "connector_card": {
                "id": self.card.id,
                "name": self.card.name,
                "description": self.card.description,
                "version": self.card.version,
                "provider": self.card.provider,
                "auth_schemes": [s.value for s in self.card.auth_schemes],
                "categories": self.card.categories,
                "tags": self.card.tags,
            },
            "capabilities": [cap.to_dict() for cap in self.card.capabilities],
            "ui_mappings": [
                {
                    "selector": m.selector,
                    "semantic_role": m.semantic_role,
                    "action": m.action,
                    "context": m.context,
                }
                for m in self._ui_mappings
            ],
        }

    async def serve(self, port: int = 8000) -> None:
        """
        Start the connector server.

        This is a placeholder - actual implementation would use
        FastMCP or a custom HTTP server.
        """
        print(f"Connector {self.card.name} listening on port {port}")
        print(f"MCP schema: http://localhost:{port}/mcp/tools")
        print(f"Agent card: http://localhost:{port}/.well-known/agent.json")
        # Keep running
        while True:
            await asyncio.sleep(1)
