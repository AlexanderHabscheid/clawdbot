"""
Centris SDK Gateway Types

Type definitions for the MCP Gateway.
"""

from dataclasses import dataclass, field
from typing import Any, Optional, Callable, Awaitable
from enum import Enum
from datetime import datetime


class ConnectorState(str, Enum):
    """State of a connector in the gateway."""
    ACTIVE = "active"
    INACTIVE = "inactive"
    ERROR = "error"
    LOADING = "loading"


@dataclass
class GatewayConfig:
    """Configuration for the MCP Gateway."""
    
    # Server settings
    host: str = "127.0.0.1"
    port: int = 8000
    
    # Discovery settings
    auto_discover: bool = True
    discovery_paths: list[str] = field(default_factory=list)
    
    # Security settings
    require_auth: bool = False
    api_keys: list[str] = field(default_factory=list)
    cors_origins: list[str] = field(default_factory=lambda: ["*"])
    
    # Performance settings
    max_concurrent_requests: int = 100
    request_timeout: float = 30.0
    
    # Logging
    log_level: str = "INFO"
    log_requests: bool = True


@dataclass
class ConnectorStatus:
    """Status information for a connector."""
    
    id: str
    name: str
    version: str
    state: ConnectorState
    tool_count: int
    last_used: Optional[datetime] = None
    error_message: Optional[str] = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class ToolCall:
    """Represents a tool call request."""
    
    tool_id: str  # Full ID: connector_id.capability_id
    params: dict[str, Any]
    call_id: Optional[str] = None
    context: dict[str, Any] = field(default_factory=dict)


@dataclass
class ToolResult:
    """Result from a tool execution."""
    
    success: bool
    content: list[dict[str, Any]]
    call_id: Optional[str] = None
    error: Optional[str] = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class MCPToolSchema:
    """MCP-compatible tool schema."""
    
    name: str
    description: str
    inputSchema: dict[str, Any]
    
    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "inputSchema": self.inputSchema,
        }


@dataclass
class MCPServer:
    """Represents an MCP server configuration."""
    
    name: str
    version: str
    tools: list[MCPToolSchema]
    
    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "version": self.version,
            "tools": [t.to_dict() for t in self.tools],
        }


@dataclass
class A2AAgentCard:
    """A2A (Agent-to-Agent) compatible agent card."""
    
    name: str
    description: str
    url: str
    version: str = "1.0.0"
    provider: Optional[str] = None
    documentationUrl: Optional[str] = None
    capabilities: list[str] = field(default_factory=list)
    authentication: Optional[dict[str, Any]] = None
    defaultInputModes: list[str] = field(default_factory=lambda: ["text"])
    defaultOutputModes: list[str] = field(default_factory=lambda: ["text"])
    skills: list[dict[str, Any]] = field(default_factory=list)
    
    def to_dict(self) -> dict[str, Any]:
        result = {
            "name": self.name,
            "description": self.description,
            "url": self.url,
            "version": self.version,
            "defaultInputModes": self.defaultInputModes,
            "defaultOutputModes": self.defaultOutputModes,
            "capabilities": self.capabilities,
        }
        
        if self.provider:
            result["provider"] = self.provider
        if self.documentationUrl:
            result["documentationUrl"] = self.documentationUrl
        if self.authentication:
            result["authentication"] = self.authentication
        if self.skills:
            result["skills"] = self.skills
        
        return result


# Type aliases
ToolHandler = Callable[[ToolCall], Awaitable[ToolResult]]
Middleware = Callable[[ToolCall, ToolHandler], Awaitable[ToolResult]]
