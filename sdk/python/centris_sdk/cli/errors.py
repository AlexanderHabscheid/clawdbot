"""
Centris CLI Error Handling

SINGLE ERROR PATTERN: All CLI errors go through CentrisCLIError.

This module provides:
1. A unified error hierarchy for all CLI operations
2. Consistent error formatting and exit codes
3. Helper functions for common error patterns

Inspired by Clawdbot's consistent error handling pattern.

Usage:
    from centris_sdk.cli.errors import CentrisCLIError, handle_cli_error
    
    # Raise errors consistently
    raise CentrisCLIError("Something failed", exit_code=1)
    
    # Or use the context manager
    with cli_error_handler():
        risky_operation()
"""

from __future__ import annotations

import sys
import traceback
from contextlib import contextmanager
from dataclasses import dataclass, field
from enum import IntEnum
from typing import Any, Callable, Dict, Generator, NoReturn, Optional, Type, TypeVar

import click

from centris_sdk.cli.theme import theme, symbols


# =============================================================================
# Exit Codes (following Unix conventions)
# =============================================================================

class ExitCode(IntEnum):
    """Standard exit codes for CLI operations."""
    
    SUCCESS = 0
    GENERAL_ERROR = 1
    USAGE_ERROR = 2
    CONFIG_ERROR = 3
    NETWORK_ERROR = 4
    AUTH_ERROR = 5
    NOT_FOUND = 6
    PERMISSION_ERROR = 7
    TIMEOUT_ERROR = 8
    VALIDATION_ERROR = 9
    CANCELLED = 130  # Ctrl+C


# =============================================================================
# Error Classes
# =============================================================================

@dataclass
class CentrisCLIError(Exception):
    """
    Base exception for all CLI errors.
    
    SINGLE ERROR PATTERN: Use this for ALL CLI errors.
    
    Attributes:
        message: Human-readable error message
        exit_code: Exit code to use (default: 1)
        details: Optional dict with additional context
        hint: Optional hint for how to fix the error
        show_traceback: Whether to show traceback (default: False)
    
    Examples:
        # Simple error
        raise CentrisCLIError("File not found")
        
        # With exit code
        raise CentrisCLIError("Auth failed", exit_code=ExitCode.AUTH_ERROR)
        
        # With hint
        raise CentrisCLIError(
            "Backend not running",
            hint="Run 'centris start' to start the backend"
        )
    """
    
    message: str
    exit_code: int = ExitCode.GENERAL_ERROR
    details: Dict[str, Any] = field(default_factory=dict)
    hint: Optional[str] = None
    show_traceback: bool = False
    
    def __str__(self) -> str:
        return self.message
    
    def format(self, verbose: bool = False) -> str:
        """
        Format the error for display.
        
        Args:
            verbose: Include details and traceback
            
        Returns:
            Formatted error string
        """
        lines = [f"{theme.error(symbols.CROSS)} {self.message}"]
        
        if self.hint:
            lines.append(f"  {theme.muted('Hint:')} {self.hint}")
        
        if verbose and self.details:
            lines.append(f"  {theme.muted('Details:')}")
            for key, value in self.details.items():
                lines.append(f"    {theme.muted(key + ':')} {value}")
        
        return "\n".join(lines)


# =============================================================================
# Specialized Errors (all inherit from CentrisCLIError)
# =============================================================================

class ConfigurationError(CentrisCLIError):
    """Error in CLI or backend configuration."""
    
    def __init__(
        self,
        message: str,
        config_key: Optional[str] = None,
        **kwargs: Any,
    ):
        details = kwargs.pop("details", {})
        if config_key:
            details["config_key"] = config_key
        
        super().__init__(
            message=message,
            exit_code=ExitCode.CONFIG_ERROR,
            details=details,
            **kwargs,
        )


class NetworkError(CentrisCLIError):
    """Error communicating with backend or external services."""
    
    def __init__(
        self,
        message: str,
        url: Optional[str] = None,
        **kwargs: Any,
    ):
        details = kwargs.pop("details", {})
        if url:
            details["url"] = url
        
        hint = kwargs.pop("hint", None)
        if hint is None and url:
            hint = "Check that the backend is running and accessible"
        
        super().__init__(
            message=message,
            exit_code=ExitCode.NETWORK_ERROR,
            details=details,
            hint=hint,
            **kwargs,
        )


class AuthenticationError(CentrisCLIError):
    """Authentication or authorization failure."""
    
    def __init__(self, message: str, **kwargs: Any):
        hint = kwargs.pop("hint", None)
        if hint is None:
            hint = "Run 'centris login' to authenticate"
        
        super().__init__(
            message=message,
            exit_code=ExitCode.AUTH_ERROR,
            hint=hint,
            **kwargs,
        )


class ValidationError(CentrisCLIError):
    """Validation failure (schema, input, etc.)."""
    
    def __init__(
        self,
        message: str,
        field: Optional[str] = None,
        **kwargs: Any,
    ):
        details = kwargs.pop("details", {})
        if field:
            details["field"] = field
        
        super().__init__(
            message=message,
            exit_code=ExitCode.VALIDATION_ERROR,
            details=details,
            **kwargs,
        )


class NotFoundError(CentrisCLIError):
    """Resource not found (file, connector, etc.)."""
    
    def __init__(
        self,
        message: str,
        resource_type: Optional[str] = None,
        resource_id: Optional[str] = None,
        **kwargs: Any,
    ):
        details = kwargs.pop("details", {})
        if resource_type:
            details["type"] = resource_type
        if resource_id:
            details["id"] = resource_id
        
        super().__init__(
            message=message,
            exit_code=ExitCode.NOT_FOUND,
            details=details,
            **kwargs,
        )


class TimeoutError(CentrisCLIError):
    """Operation timed out."""
    
    def __init__(
        self,
        message: str,
        timeout_seconds: Optional[float] = None,
        **kwargs: Any,
    ):
        details = kwargs.pop("details", {})
        if timeout_seconds:
            details["timeout_seconds"] = timeout_seconds
        
        super().__init__(
            message=message,
            exit_code=ExitCode.TIMEOUT_ERROR,
            details=details,
            **kwargs,
        )


class CancelledError(CentrisCLIError):
    """Operation was cancelled by user."""
    
    def __init__(self, message: str = "Operation cancelled", **kwargs: Any):
        super().__init__(
            message=message,
            exit_code=ExitCode.CANCELLED,
            **kwargs,
        )


# =============================================================================
# Error Handling Functions
# =============================================================================

def handle_cli_error(
    error: Exception,
    verbose: bool = False,
    exit_on_error: bool = True,
) -> Optional[int]:
    """
    Handle any exception in CLI context.
    
    SINGLE ERROR HANDLER: All CLI exceptions should go through here.
    
    Args:
        error: The exception to handle
        verbose: Show additional details
        exit_on_error: Whether to call sys.exit (default: True)
        
    Returns:
        Exit code (if exit_on_error is False)
    
    Example:
        try:
            risky_operation()
        except Exception as e:
            handle_cli_error(e)
    """
    # Convert to CentrisCLIError if needed
    if isinstance(error, CentrisCLIError):
        cli_error = error
    elif isinstance(error, click.ClickException):
        cli_error = CentrisCLIError(
            message=error.format_message(),
            exit_code=error.exit_code,
        )
    elif isinstance(error, KeyboardInterrupt):
        cli_error = CancelledError("Aborted")
    else:
        cli_error = CentrisCLIError(
            message=str(error),
            exit_code=ExitCode.GENERAL_ERROR,
            show_traceback=verbose,
        )
    
    # Print formatted error
    click.echo(cli_error.format(verbose=verbose), err=True)
    
    # Show traceback if requested
    if verbose and cli_error.show_traceback:
        click.echo(f"\n{theme.muted('Traceback:')}", err=True)
        traceback.print_exc()
    
    if exit_on_error:
        sys.exit(cli_error.exit_code)
    
    return cli_error.exit_code


@contextmanager
def cli_error_handler(
    verbose: bool = False,
    exit_on_error: bool = True,
) -> Generator[None, None, None]:
    """
    Context manager for consistent error handling.
    
    Usage:
        with cli_error_handler():
            risky_operation()
    
    Args:
        verbose: Show additional details
        exit_on_error: Whether to exit on error
    """
    try:
        yield
    except Exception as e:
        handle_cli_error(e, verbose=verbose, exit_on_error=exit_on_error)


def ensure(
    condition: bool,
    message: str,
    error_class: Type[CentrisCLIError] = CentrisCLIError,
    **kwargs: Any,
) -> None:
    """
    Assert a condition, raising CentrisCLIError if false.
    
    Example:
        ensure(path.exists(), f"File not found: {path}")
        ensure(response.ok, "API request failed", error_class=NetworkError)
    """
    if not condition:
        raise error_class(message=message, **kwargs)


def fail(
    message: str,
    error_class: Type[CentrisCLIError] = CentrisCLIError,
    **kwargs: Any,
) -> NoReturn:
    """
    Immediately fail with an error.
    
    Example:
        fail("This should never happen")
        fail("Auth required", error_class=AuthenticationError)
    """
    raise error_class(message=message, **kwargs)


# =============================================================================
# Decorator for Commands
# =============================================================================

T = TypeVar("T", bound=Callable[..., Any])


def with_error_handling(verbose: bool = False) -> Callable[[T], T]:
    """
    Decorator to add consistent error handling to CLI commands.
    
    Usage:
        @click.command()
        @with_error_handling()
        def my_command():
            risky_operation()
    """
    def decorator(func: T) -> T:
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            with cli_error_handler(verbose=verbose):
                return func(*args, **kwargs)
        
        # Preserve function metadata
        wrapper.__name__ = func.__name__
        wrapper.__doc__ = func.__doc__
        
        return wrapper  # type: ignore
    
    return decorator


# =============================================================================
# Exports
# =============================================================================

__all__ = [
    # Exit codes
    "ExitCode",
    # Error classes
    "CentrisCLIError",
    "ConfigurationError",
    "NetworkError",
    "AuthenticationError",
    "ValidationError",
    "NotFoundError",
    "TimeoutError",
    "CancelledError",
    # Functions
    "handle_cli_error",
    "cli_error_handler",
    "ensure",
    "fail",
    "with_error_handling",
]
