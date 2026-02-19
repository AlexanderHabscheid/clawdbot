"""
Centris CLI Runtime Abstraction

Provides a RuntimeProtocol for testability - exactly like Clawdbot.

The runtime abstraction allows:
1. Mocking console output in tests
2. Mocking sys.exit in tests
3. Capturing output for verification
4. Custom logging/error handling

Usage:
    from centris_sdk.cli.runtime import default_runtime, RuntimeProtocol
    
    # In commands
    def my_command(runtime: RuntimeProtocol = default_runtime):
        runtime.log("Processing...")
        if error:
            runtime.error("Failed!")
            runtime.exit(1)
    
    # In tests
    mock_runtime = MockRuntime()
    my_command(runtime=mock_runtime)
    assert "Processing" in mock_runtime.logs
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from typing import Any, Callable, List, NoReturn, Optional, Protocol, TextIO, runtime_checkable

import click

from centris_sdk.cli.theme import theme, symbols


# =============================================================================
# Runtime Protocol
# =============================================================================

@runtime_checkable
class RuntimeProtocol(Protocol):
    """
    Protocol defining the runtime interface.
    
    Commands should depend on this protocol, not concrete implementations.
    This enables testing by injecting mock runtimes.
    """
    
    def log(self, *args: Any, **kwargs: Any) -> None:
        """Log a message to stdout."""
        ...
    
    def error(self, *args: Any, **kwargs: Any) -> None:
        """Log an error message to stderr."""
        ...
    
    def exit(self, code: int) -> NoReturn:
        """Exit with the given code."""
        ...


# =============================================================================
# Default Runtime Implementation
# =============================================================================

class DefaultRuntime:
    """
    Default runtime implementation using real stdout/stderr/exit.
    
    This is the production runtime used by CLI commands.
    """
    
    def __init__(
        self,
        stdout: Optional[TextIO] = None,
        stderr: Optional[TextIO] = None,
    ):
        self._stdout = stdout or sys.stdout
        self._stderr = stderr or sys.stderr
    
    def log(self, *args: Any, **kwargs: Any) -> None:
        """Print to stdout."""
        print(*args, file=self._stdout, **kwargs)
    
    def error(self, *args: Any, **kwargs: Any) -> None:
        """Print to stderr."""
        print(*args, file=self._stderr, **kwargs)
    
    def exit(self, code: int) -> NoReturn:
        """Exit with code."""
        sys.exit(code)


# Singleton default runtime
default_runtime = DefaultRuntime()


# =============================================================================
# Mock Runtime for Testing
# =============================================================================

@dataclass
class MockRuntime:
    """
    Mock runtime for testing CLI commands.
    
    Captures all output and exit calls instead of performing them.
    
    Usage:
        runtime = MockRuntime()
        my_command(runtime=runtime)
        
        assert "Success" in runtime.logs
        assert runtime.exit_code == 0
    """
    
    logs: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)
    exit_code: Optional[int] = None
    
    def log(self, *args: Any, **kwargs: Any) -> None:
        """Capture log message."""
        message = " ".join(str(arg) for arg in args)
        self.logs.append(message)
    
    def error(self, *args: Any, **kwargs: Any) -> None:
        """Capture error message."""
        message = " ".join(str(arg) for arg in args)
        self.errors.append(message)
    
    def exit(self, code: int) -> NoReturn:
        """Capture exit code (raises MockExitError instead of exiting)."""
        self.exit_code = code
        raise MockExitError(code)
    
    def clear(self) -> None:
        """Clear all captured output."""
        self.logs.clear()
        self.errors.clear()
        self.exit_code = None
    
    @property
    def all_output(self) -> str:
        """Get all output (logs + errors) as a single string."""
        return "\n".join(self.logs + self.errors)
    
    def assert_logged(self, substring: str) -> None:
        """Assert that a substring appears in logs."""
        assert any(substring in log for log in self.logs), \
            f"Expected '{substring}' in logs, got: {self.logs}"
    
    def assert_error(self, substring: str) -> None:
        """Assert that a substring appears in errors."""
        assert any(substring in err for err in self.errors), \
            f"Expected '{substring}' in errors, got: {self.errors}"
    
    def assert_exited(self, code: int) -> None:
        """Assert that exit was called with the given code."""
        assert self.exit_code == code, \
            f"Expected exit code {code}, got {self.exit_code}"


class MockExitError(Exception):
    """
    Exception raised by MockRuntime.exit() instead of actually exiting.
    
    This allows tests to catch and verify exit behavior.
    """
    
    def __init__(self, code: int):
        self.code = code
        super().__init__(f"MockRuntime.exit({code})")


# =============================================================================
# Styled Runtime
# =============================================================================

class StyledRuntime:
    """
    Runtime with styled output using the theme.
    
    Wraps another runtime and adds styling.
    """
    
    def __init__(self, inner: RuntimeProtocol = default_runtime):
        self._inner = inner
    
    def log(self, *args: Any, **kwargs: Any) -> None:
        """Log with default styling."""
        self._inner.log(*args, **kwargs)
    
    def error(self, *args: Any, **kwargs: Any) -> None:
        """Log error with red styling."""
        message = " ".join(str(arg) for arg in args)
        self._inner.error(f"{theme.error(symbols.CROSS)} {message}")
    
    def exit(self, code: int) -> NoReturn:
        """Exit with code."""
        self._inner.exit(code)
    
    def success(self, message: str) -> None:
        """Log success message."""
        self._inner.log(f"{theme.success(symbols.CHECK)} {message}")
    
    def warn(self, message: str) -> None:
        """Log warning message."""
        self._inner.log(f"{theme.warn('!')} {message}")
    
    def info(self, message: str) -> None:
        """Log info message."""
        self._inner.log(f"{theme.info(symbols.BULLET)} {message}")
    
    def debug(self, message: str) -> None:
        """Log debug message (muted)."""
        self._inner.log(theme.muted(f"DEBUG: {message}"))


# Styled default runtime
styled_runtime = StyledRuntime(default_runtime)


# =============================================================================
# Exports
# =============================================================================

__all__ = [
    # Protocol
    "RuntimeProtocol",
    # Implementations
    "DefaultRuntime",
    "MockRuntime",
    "StyledRuntime",
    # Instances
    "default_runtime",
    "styled_runtime",
    # Testing helpers
    "MockExitError",
]
