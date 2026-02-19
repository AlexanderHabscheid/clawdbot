"""
Centris SDK Gateway Module

Provides an embeddable MCP Gateway for Python applications.

The Gateway aggregates multiple connectors and exposes them through
a unified MCP (Model Context Protocol) interface.

Example:
    from centris_sdk.gateway import MCPGateway, GatewayServer
    
    # Create gateway
    gateway = MCPGateway()
    
    # Add connectors
    gateway.add_connector(my_connector)
    gateway.add_connector(another_connector)
    
    # Start server
    server = GatewayServer(gateway)
    server.run(port=8000)
"""

from centris_sdk.gateway.gateway import MCPGateway
from centris_sdk.gateway.server import GatewayServer
from centris_sdk.gateway.types import (
    GatewayConfig,
    ConnectorStatus,
    ToolCall,
    ToolResult,
    MCPToolSchema,
)

__all__ = [
    "MCPGateway",
    "GatewayServer",
    "GatewayConfig",
    "ConnectorStatus",
    "ToolCall",
    "ToolResult",
    "MCPToolSchema",
]
