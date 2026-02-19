"""
Centris SDK MCP Gateway

The core gateway that aggregates connectors and provides a unified MCP interface.
"""

import asyncio
import logging
from typing import Any, Optional
from datetime import datetime
from dataclasses import dataclass, field

from centris_sdk.gateway.types import (
    GatewayConfig,
    ConnectorStatus,
    ConnectorState,
    ToolCall,
    ToolResult,
    MCPToolSchema,
    MCPServer,
    A2AAgentCard,
    Middleware,
)


logger = logging.getLogger("centris.gateway")


@dataclass
class RegisteredConnector:
    """A connector registered with the gateway."""
    
    connector: Any  # CentrisConnector or CentrisPluginConnector
    status: ConnectorStatus
    registered_at: datetime = field(default_factory=datetime.utcnow)


class MCPGateway:
    """
    MCP Gateway that aggregates multiple connectors.
    
    Provides:
    - Unified tool registry across all connectors
    - Tool execution routing
    - Health monitoring
    - A2A agent card generation
    
    Example:
        gateway = MCPGateway()
        gateway.add_connector(slack_connector)
        gateway.add_connector(github_connector)
        
        # Get all tools
        tools = gateway.get_tools()
        
        # Execute a tool
        result = await gateway.execute(ToolCall(
            tool_id="slack.send_message",
            params={"channel": "#general", "message": "Hello"}
        ))
    """
    
    def __init__(
        self,
        config: Optional[GatewayConfig] = None,
        name: str = "Centris Gateway",
        version: str = "1.0.0",
    ):
        self.config = config or GatewayConfig()
        self.name = name
        self.version = version
        
        self._connectors: dict[str, RegisteredConnector] = {}
        self._middleware: list[Middleware] = []
        self._tool_cache: Optional[list[MCPToolSchema]] = None
        self._lock = asyncio.Lock()
    
    def add_connector(self, connector: Any) -> None:
        """
        Add a connector to the gateway.
        
        Args:
            connector: A CentrisConnector or CentrisPluginConnector instance
        """
        connector_id = connector.id
        
        # Create status
        status = ConnectorStatus(
            id=connector_id,
            name=connector.name,
            version=getattr(connector, "version", "1.0.0") or getattr(connector.card, "version", "1.0.0"),
            state=ConnectorState.ACTIVE,
            tool_count=len(connector.capabilities) if hasattr(connector, "capabilities") else len(connector.get_tools()),
        )
        
        self._connectors[connector_id] = RegisteredConnector(
            connector=connector,
            status=status,
        )
        
        # Invalidate tool cache
        self._tool_cache = None
        
        logger.info(f"Added connector: {connector_id} ({status.tool_count} tools)")
    
    def remove_connector(self, connector_id: str) -> bool:
        """
        Remove a connector from the gateway.
        
        Args:
            connector_id: ID of the connector to remove
            
        Returns:
            True if removed, False if not found
        """
        if connector_id in self._connectors:
            del self._connectors[connector_id]
            self._tool_cache = None
            logger.info(f"Removed connector: {connector_id}")
            return True
        return False
    
    def get_connector(self, connector_id: str) -> Optional[Any]:
        """Get a connector by ID."""
        registered = self._connectors.get(connector_id)
        return registered.connector if registered else None
    
    def get_connector_status(self, connector_id: str) -> Optional[ConnectorStatus]:
        """Get status for a connector."""
        registered = self._connectors.get(connector_id)
        return registered.status if registered else None
    
    def list_connectors(self) -> list[ConnectorStatus]:
        """List all registered connectors with their status."""
        return [r.status for r in self._connectors.values()]
    
    def get_tools(self) -> list[MCPToolSchema]:
        """
        Get all tools from all connectors.
        
        Tool names are prefixed with connector ID for uniqueness:
        e.g., "slack.send_message", "github.create_issue"
        """
        if self._tool_cache is not None:
            return self._tool_cache
        
        tools: list[MCPToolSchema] = []
        
        for connector_id, registered in self._connectors.items():
            connector = registered.connector
            
            # Get capabilities/tools from connector
            if hasattr(connector, "capabilities"):
                capabilities = connector.capabilities
            elif hasattr(connector, "get_tools"):
                capabilities = connector.get_tools()
            else:
                continue
            
            for cap in capabilities:
                # Build prefixed tool name
                tool_name = f"{connector_id}.{cap.id if hasattr(cap, 'id') else cap.name}"
                
                tools.append(MCPToolSchema(
                    name=tool_name,
                    description=cap.description,
                    inputSchema=cap.input_schema if hasattr(cap, "input_schema") else cap.parameters,
                ))
        
        self._tool_cache = tools
        return tools
    
    def add_middleware(self, middleware: Middleware) -> None:
        """
        Add middleware to the execution pipeline.
        
        Middleware can intercept and modify tool calls and results.
        
        Args:
            middleware: Async function (call, next_handler) -> result
        """
        self._middleware.append(middleware)
    
    async def execute(self, call: ToolCall) -> ToolResult:
        """
        Execute a tool call.
        
        Args:
            call: The tool call to execute
            
        Returns:
            ToolResult with success status and content
        """
        # Parse tool ID: "connector_id.capability_id"
        parts = call.tool_id.split(".", 1)
        if len(parts) != 2:
            return ToolResult(
                success=False,
                content=[{"type": "text", "text": f"Invalid tool ID format: {call.tool_id}"}],
                call_id=call.call_id,
                error="INVALID_TOOL_ID",
            )
        
        connector_id, capability_id = parts
        
        # Get connector
        registered = self._connectors.get(connector_id)
        if not registered:
            return ToolResult(
                success=False,
                content=[{"type": "text", "text": f"Connector not found: {connector_id}"}],
                call_id=call.call_id,
                error="CONNECTOR_NOT_FOUND",
            )
        
        connector = registered.connector
        
        # Build execution handler
        async def execute_handler(c: ToolCall) -> ToolResult:
            try:
                result = await connector.execute(capability_id, c.params, c.context)
                
                # Update last used
                registered.status.last_used = datetime.utcnow()
                
                # Convert to ToolResult
                if result.success:
                    content = [{"type": "text", "text": str(result.data)}]
                    if hasattr(result, "data") and isinstance(result.data, dict):
                        import json
                        content = [{"type": "text", "text": json.dumps(result.data, indent=2)}]
                    
                    return ToolResult(
                        success=True,
                        content=content,
                        call_id=c.call_id,
                        metadata={"latency_ms": result.metadata.latency_ms if result.metadata else 0},
                    )
                else:
                    return ToolResult(
                        success=False,
                        content=[{"type": "text", "text": result.error.message if result.error else "Unknown error"}],
                        call_id=c.call_id,
                        error=result.error.code if result.error else "UNKNOWN_ERROR",
                    )
            except Exception as e:
                logger.error(f"Execution error for {call.tool_id}: {e}")
                registered.status.state = ConnectorState.ERROR
                registered.status.error_message = str(e)
                
                return ToolResult(
                    success=False,
                    content=[{"type": "text", "text": f"Execution error: {e}"}],
                    call_id=c.call_id,
                    error="EXECUTION_ERROR",
                )
        
        # Apply middleware chain
        handler = execute_handler
        for middleware in reversed(self._middleware):
            prev_handler = handler
            handler = lambda c, m=middleware, h=prev_handler: m(c, h)
        
        return await handler(call)
    
    def to_mcp_server(self) -> MCPServer:
        """Export as MCP server schema."""
        return MCPServer(
            name=self.name,
            version=self.version,
            tools=self.get_tools(),
        )
    
    def to_agent_card(self, base_url: str = "http://localhost:8000") -> A2AAgentCard:
        """
        Generate A2A-compatible agent card.
        
        Args:
            base_url: Base URL where the gateway is hosted
        """
        tools = self.get_tools()
        
        return A2AAgentCard(
            name=self.name,
            description=f"Centris Gateway with {len(tools)} tools from {len(self._connectors)} connectors",
            url=base_url,
            version=self.version,
            capabilities=["tools", "streaming"],
            skills=[
                {
                    "id": tool.name,
                    "name": tool.name,
                    "description": tool.description,
                }
                for tool in tools
            ],
        )
    
    async def health_check(self) -> dict[str, Any]:
        """
        Run health check on all connectors.
        
        Returns:
            Health status dict
        """
        return {
            "status": "healthy",
            "gateway": self.name,
            "version": self.version,
            "connectors": {
                cid: {
                    "state": r.status.state.value,
                    "tool_count": r.status.tool_count,
                    "last_used": r.status.last_used.isoformat() if r.status.last_used else None,
                }
                for cid, r in self._connectors.items()
            },
            "total_tools": len(self.get_tools()),
        }
