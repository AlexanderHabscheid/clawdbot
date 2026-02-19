"""
Centris SDK Capability Definition

Defines the structure and behavior of connector capabilities.
"""

from dataclasses import dataclass, field
from typing import Any, Callable, Optional, Awaitable

from centris_sdk.types import ExecutionMethod


@dataclass
class Capability:
    """Defines a single capability/action a connector can perform."""

    # Identity
    id: str
    name: str
    description: str

    # Schema definitions
    input_schema: dict[str, Any]
    output_schema: dict[str, Any] = field(default_factory=lambda: {"type": "object"})

    # Execution configuration
    execution_methods: list[ExecutionMethod] = field(
        default_factory=lambda: [ExecutionMethod.API]
    )

    # AI assistance
    examples: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)

    # Constraints
    requires_auth: bool = True
    requires_confirmation: bool = False
    rate_limit: Optional[int] = None  # Max calls per minute

    # Metadata
    version: str = "1.0.0"
    deprecated: bool = False
    deprecated_message: Optional[str] = None

    # Handler (set by decorator)
    handler: Optional[Callable[..., Awaitable[dict[str, Any]]]] = field(
        default=None, repr=False
    )

    def to_mcp_tool(self, connector_id: str) -> dict[str, Any]:
        """Convert to MCP tool format."""
        return {
            "name": f"{connector_id}.{self.id}",
            "description": self.description,
            "inputSchema": self.input_schema,
        }

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary representation."""
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "input_schema": self.input_schema,
            "output_schema": self.output_schema,
            "execution_methods": [m.value for m in self.execution_methods],
            "examples": self.examples,
            "tags": self.tags,
            "requires_auth": self.requires_auth,
            "requires_confirmation": self.requires_confirmation,
            "rate_limit": self.rate_limit,
            "version": self.version,
            "deprecated": self.deprecated,
            "deprecated_message": self.deprecated_message,
        }


def create_capability(
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
) -> Capability:
    """Factory function to create a capability."""
    return Capability(
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
    )
