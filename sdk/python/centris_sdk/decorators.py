"""
Centris SDK Decorators

Convenience decorators for building connectors.
"""

from typing import Any, Callable, Optional, Awaitable, TypeVar
from functools import wraps

from centris_sdk.types import ExecutionMethod

F = TypeVar("F", bound=Callable[..., Any])


def capability(
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
) -> Callable[[F], F]:
    """
    Standalone decorator for marking a function as a capability.

    This stores metadata on the function for later registration.
    Use with CentrisConnector.register_handler() or auto-discovery.

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

    Example:
        @capability(
            id="send_message",
            name="Send Message",
            description="Send a message",
            input_schema={"type": "object", "properties": {...}},
        )
        async def send_message(params, context):
            return {"ok": True}
    """

    def decorator(func: F) -> F:
        # Store metadata on the function
        func._centris_capability = {  # type: ignore
            "id": id,
            "name": name,
            "description": description,
            "input_schema": input_schema,
            "output_schema": output_schema or {"type": "object"},
            "examples": examples or [],
            "tags": tags or [],
            "requires_confirmation": requires_confirmation,
            "execution_methods": execution_methods or [ExecutionMethod.API],
            "rate_limit": rate_limit,
        }
        return func

    return decorator


def context_provider(func: F) -> F:
    """
    Mark a function as a context provider.

    The context provider returns current application state
    that can be used by the AI for better understanding.

    Example:
        @context_provider
        def get_current_state():
            return {
                "current_channel": "#general",
                "user_status": "online",
            }
    """
    func._centris_context_provider = True  # type: ignore
    return func


def requires_auth(auth_types: Optional[list[str]] = None) -> Callable[[F], F]:
    """
    Mark a capability as requiring authentication.

    Args:
        auth_types: List of required auth types (e.g., ["oauth2"])

    Example:
        @requires_auth(["oauth2"])
        async def protected_action(params, context):
            return {"ok": True}
    """

    def decorator(func: F) -> F:
        func._centris_requires_auth = auth_types or ["oauth2"]  # type: ignore
        return func

    return decorator


def rate_limited(calls_per_minute: int) -> Callable[[F], F]:
    """
    Apply rate limiting to a capability.

    Args:
        calls_per_minute: Maximum calls allowed per minute

    Example:
        @rate_limited(10)
        async def limited_action(params, context):
            return {"ok": True}
    """

    def decorator(func: F) -> F:
        func._centris_rate_limit = calls_per_minute  # type: ignore
        return func

    return decorator


def confirmation_required(
    message: Optional[str] = None,
) -> Callable[[F], F]:
    """
    Require human confirmation before executing.

    Args:
        message: Custom confirmation message

    Example:
        @confirmation_required("Are you sure you want to delete?")
        async def delete_item(params, context):
            return {"deleted": True}
    """

    def decorator(func: F) -> F:
        func._centris_requires_confirmation = True  # type: ignore
        func._centris_confirmation_message = message  # type: ignore
        return func

    return decorator
