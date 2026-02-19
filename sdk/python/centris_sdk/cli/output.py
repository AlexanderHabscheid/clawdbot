"""
Centris CLI Output System

Provides consistent output handling for:
- JSON mode (--json flag)
- Non-interactive mode (--non-interactive flag or CI detection)
- Styled text output (default TTY mode)

Inspired by Clawdbot's output patterns.

Usage:
    from centris_sdk.cli.output import OutputMode, create_output
    
    # In a command
    output = create_output(json_output=ctx.obj.get("json_output", False))
    output.success("Operation completed", data={"count": 42})
    
    # The output will be styled text or JSON depending on mode
"""

from __future__ import annotations

import json
import os
import sys
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum, auto
from typing import Any, Dict, List, Optional, Protocol, Union

from centris_sdk.cli.theme import theme, symbols, COLORS_ENABLED


# =============================================================================
# Environment Detection
# =============================================================================

def is_ci_environment() -> bool:
    """
    Detect if running in a CI/CD environment.
    
    Checks common CI environment variables.
    """
    ci_vars = [
        "CI",
        "CONTINUOUS_INTEGRATION",
        "GITHUB_ACTIONS",
        "GITLAB_CI",
        "CIRCLECI",
        "TRAVIS",
        "JENKINS_URL",
        "BUILDKITE",
        "TEAMCITY_VERSION",
        "TF_BUILD",  # Azure Pipelines
    ]
    
    for var in ci_vars:
        if os.environ.get(var):
            return True
    
    return False


def is_interactive() -> bool:
    """
    Detect if running in an interactive environment.
    
    Returns False if:
    - stdin is not a TTY
    - Running in CI
    - TERM is "dumb"
    - NO_TTY or CENTRIS_NON_INTERACTIVE is set
    """
    # Explicit non-interactive flag
    if os.environ.get("CENTRIS_NON_INTERACTIVE") or os.environ.get("NO_TTY"):
        return False
    
    # CI environment
    if is_ci_environment():
        return False
    
    # Dumb terminal
    if os.environ.get("TERM") == "dumb":
        return False
    
    # Check stdin is a TTY
    return sys.stdin.isatty()


def should_use_json() -> bool:
    """Check if JSON output should be used by default."""
    return os.environ.get("CENTRIS_JSON_OUTPUT", "").lower() in ("1", "true", "yes")


# =============================================================================
# Output Mode
# =============================================================================

class OutputMode(Enum):
    """Output mode for CLI commands."""
    
    TEXT = auto()      # Styled text output (default for TTY)
    JSON = auto()      # JSON output (for scripts/CI)
    PLAIN = auto()     # Plain text without colors (non-interactive)


@dataclass
class OutputConfig:
    """Configuration for output behavior."""
    
    mode: OutputMode = OutputMode.TEXT
    interactive: bool = True
    verbose: bool = False
    quiet: bool = False
    
    # Stream configuration
    stdout: Any = field(default_factory=lambda: sys.stdout)
    stderr: Any = field(default_factory=lambda: sys.stderr)
    
    @classmethod
    def detect(
        cls,
        json_output: bool = False,
        non_interactive: Optional[bool] = None,
        verbose: bool = False,
        quiet: bool = False,
    ) -> "OutputConfig":
        """
        Auto-detect output configuration.
        
        Args:
            json_output: Force JSON output
            non_interactive: Force non-interactive mode (auto-detect if None)
            verbose: Enable verbose output
            quiet: Suppress non-essential output
        
        Returns:
            OutputConfig with detected settings
        """
        # Determine mode
        if json_output or should_use_json():
            mode = OutputMode.JSON
        elif non_interactive is True or (non_interactive is None and not is_interactive()):
            mode = OutputMode.PLAIN
        else:
            mode = OutputMode.TEXT
        
        # Determine interactivity
        if non_interactive is not None:
            interactive = not non_interactive
        else:
            interactive = is_interactive()
        
        return cls(
            mode=mode,
            interactive=interactive,
            verbose=verbose,
            quiet=quiet,
        )


# =============================================================================
# Output Protocol
# =============================================================================

class OutputProtocol(Protocol):
    """Protocol for output handlers."""
    
    def print(self, message: str) -> None:
        """Print a message."""
        ...
    
    def success(self, message: str, data: Optional[Dict[str, Any]] = None) -> None:
        """Print a success message."""
        ...
    
    def error(self, message: str, data: Optional[Dict[str, Any]] = None) -> None:
        """Print an error message."""
        ...
    
    def warn(self, message: str, data: Optional[Dict[str, Any]] = None) -> None:
        """Print a warning message."""
        ...
    
    def info(self, message: str, data: Optional[Dict[str, Any]] = None) -> None:
        """Print an info message."""
        ...
    
    def result(self, data: Any) -> None:
        """Output a result (for scripting)."""
        ...


# =============================================================================
# Output Handlers
# =============================================================================

class BaseOutput(ABC):
    """Base class for output handlers."""
    
    def __init__(self, config: OutputConfig):
        self.config = config
    
    @abstractmethod
    def print(self, message: str) -> None:
        """Print a message."""
        ...
    
    @abstractmethod
    def success(self, message: str, data: Optional[Dict[str, Any]] = None) -> None:
        """Print a success message."""
        ...
    
    @abstractmethod
    def error(self, message: str, data: Optional[Dict[str, Any]] = None) -> None:
        """Print an error message."""
        ...
    
    @abstractmethod
    def warn(self, message: str, data: Optional[Dict[str, Any]] = None) -> None:
        """Print a warning message."""
        ...
    
    @abstractmethod
    def info(self, message: str, data: Optional[Dict[str, Any]] = None) -> None:
        """Print an info message."""
        ...
    
    @abstractmethod
    def result(self, data: Any) -> None:
        """Output a result (for scripting)."""
        ...
    
    def debug(self, message: str) -> None:
        """Print a debug message (only in verbose mode)."""
        if self.config.verbose:
            self.print(f"DEBUG: {message}")


class TextOutput(BaseOutput):
    """Styled text output for interactive terminals."""
    
    def print(self, message: str) -> None:
        """Print a message."""
        if not self.config.quiet:
            print(message, file=self.config.stdout)
    
    def success(self, message: str, data: Optional[Dict[str, Any]] = None) -> None:
        """Print a success message with checkmark."""
        self.print(f"{theme.success(symbols.CHECK)} {message}")
    
    def error(self, message: str, data: Optional[Dict[str, Any]] = None) -> None:
        """Print an error message with cross."""
        print(f"{theme.error(symbols.CROSS)} {message}", file=self.config.stderr)
    
    def warn(self, message: str, data: Optional[Dict[str, Any]] = None) -> None:
        """Print a warning message."""
        self.print(f"{theme.warn('!')} {message}")
    
    def info(self, message: str, data: Optional[Dict[str, Any]] = None) -> None:
        """Print an info message."""
        self.print(f"{theme.info(symbols.BULLET)} {message}")
    
    def result(self, data: Any) -> None:
        """Output a result - for text mode, pretty print."""
        if isinstance(data, dict):
            for key, value in data.items():
                self.print(f"  {theme.muted(key + ':')} {value}")
        elif isinstance(data, list):
            for item in data:
                self.print(f"  {symbols.BULLET} {item}")
        else:
            self.print(str(data))
    
    def heading(self, text: str) -> None:
        """Print a section heading."""
        self.print(f"\n{theme.heading(text)}")
    
    def step(self, number: int, message: str) -> None:
        """Print a numbered step."""
        self.print(f"{theme.accent(f'[{number}]')} {message}")
    
    def table(self, headers: List[str], rows: List[List[str]]) -> None:
        """Print a simple table."""
        # Calculate column widths
        widths = [len(h) for h in headers]
        for row in rows:
            for i, cell in enumerate(row):
                widths[i] = max(widths[i], len(str(cell)))
        
        # Print header
        header_line = " | ".join(h.ljust(widths[i]) for i, h in enumerate(headers))
        self.print(theme.heading(header_line))
        self.print(theme.muted("-" * len(header_line)))
        
        # Print rows
        for row in rows:
            row_line = " | ".join(str(cell).ljust(widths[i]) for i, cell in enumerate(row))
            self.print(row_line)


class PlainOutput(BaseOutput):
    """Plain text output without colors (non-interactive mode)."""
    
    def print(self, message: str) -> None:
        """Print a message."""
        if not self.config.quiet:
            print(message, file=self.config.stdout)
    
    def success(self, message: str, data: Optional[Dict[str, Any]] = None) -> None:
        """Print a success message."""
        self.print(f"[OK] {message}")
    
    def error(self, message: str, data: Optional[Dict[str, Any]] = None) -> None:
        """Print an error message."""
        print(f"[ERROR] {message}", file=self.config.stderr)
    
    def warn(self, message: str, data: Optional[Dict[str, Any]] = None) -> None:
        """Print a warning message."""
        self.print(f"[WARN] {message}")
    
    def info(self, message: str, data: Optional[Dict[str, Any]] = None) -> None:
        """Print an info message."""
        self.print(f"[INFO] {message}")
    
    def result(self, data: Any) -> None:
        """Output a result."""
        if isinstance(data, dict):
            for key, value in data.items():
                self.print(f"  {key}: {value}")
        elif isinstance(data, list):
            for item in data:
                self.print(f"  - {item}")
        else:
            self.print(str(data))


class JsonOutput(BaseOutput):
    """JSON output for scripts and CI integration."""
    
    def __init__(self, config: OutputConfig):
        super().__init__(config)
        self._buffer: List[Dict[str, Any]] = []
        self._final_result: Optional[Any] = None
    
    def _emit(self, obj: Dict[str, Any]) -> None:
        """Emit a JSON object."""
        print(json.dumps(obj), file=self.config.stdout)
    
    def print(self, message: str) -> None:
        """Print a message as JSON."""
        if not self.config.quiet:
            self._emit({"type": "message", "text": message})
    
    def success(self, message: str, data: Optional[Dict[str, Any]] = None) -> None:
        """Emit a success event."""
        obj: Dict[str, Any] = {"type": "success", "message": message}
        if data:
            obj["data"] = data
        self._emit(obj)
    
    def error(self, message: str, data: Optional[Dict[str, Any]] = None) -> None:
        """Emit an error event."""
        obj: Dict[str, Any] = {"type": "error", "message": message}
        if data:
            obj["data"] = data
        self._emit(obj)
    
    def warn(self, message: str, data: Optional[Dict[str, Any]] = None) -> None:
        """Emit a warning event."""
        obj: Dict[str, Any] = {"type": "warning", "message": message}
        if data:
            obj["data"] = data
        self._emit(obj)
    
    def info(self, message: str, data: Optional[Dict[str, Any]] = None) -> None:
        """Emit an info event."""
        obj: Dict[str, Any] = {"type": "info", "message": message}
        if data:
            obj["data"] = data
        self._emit(obj)
    
    def result(self, data: Any) -> None:
        """Output the final result."""
        self._emit({"type": "result", "data": data})


# =============================================================================
# Result Builder (for commands that need to accumulate results)
# =============================================================================

@dataclass
class CommandResult:
    """
    Structured result from a CLI command.
    
    Use this to build results that work well with both JSON and text output.
    
    Example:
        result = CommandResult()
        result.add_check("Config valid", passed=True)
        result.add_check("API key", passed=False, message="Missing")
        
        if output.config.mode == OutputMode.JSON:
            output.result(result.to_dict())
        else:
            result.render_text(output)
    """
    
    success: bool = True
    message: Optional[str] = None
    data: Dict[str, Any] = field(default_factory=dict)
    checks: List[Dict[str, Any]] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)
    
    def add_check(
        self,
        name: str,
        passed: bool,
        message: Optional[str] = None,
        **kwargs: Any,
    ) -> None:
        """Add a check result."""
        check = {"name": name, "passed": passed}
        if message:
            check["message"] = message
        check.update(kwargs)
        self.checks.append(check)
        
        if not passed:
            self.success = False
    
    def add_warning(self, message: str) -> None:
        """Add a warning."""
        self.warnings.append(message)
    
    def add_error(self, message: str) -> None:
        """Add an error."""
        self.errors.append(message)
        self.success = False
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON output."""
        result: Dict[str, Any] = {
            "success": self.success,
            "timestamp": datetime.utcnow().isoformat(),
        }
        
        if self.message:
            result["message"] = self.message
        if self.data:
            result["data"] = self.data
        if self.checks:
            result["checks"] = self.checks
        if self.warnings:
            result["warnings"] = self.warnings
        if self.errors:
            result["errors"] = self.errors
        
        return result
    
    def render_text(self, output: BaseOutput) -> None:
        """Render as styled text."""
        # Show checks
        for check in self.checks:
            if check["passed"]:
                output.success(check["name"])
            else:
                msg = check.get("message", "")
                output.error(f"{check['name']}: {msg}" if msg else check["name"])
        
        # Show warnings
        for warning in self.warnings:
            output.warn(warning)
        
        # Show errors
        for error in self.errors:
            output.error(error)
        
        # Show summary message
        if self.message:
            if self.success:
                output.success(self.message)
            else:
                output.error(self.message)


# =============================================================================
# Factory Functions
# =============================================================================

def create_output(
    json_output: bool = False,
    non_interactive: Optional[bool] = None,
    verbose: bool = False,
    quiet: bool = False,
) -> BaseOutput:
    """
    Create an output handler based on configuration.
    
    Args:
        json_output: Force JSON output mode
        non_interactive: Force non-interactive mode (auto-detect if None)
        verbose: Enable verbose output
        quiet: Suppress non-essential output
    
    Returns:
        Appropriate output handler (TextOutput, PlainOutput, or JsonOutput)
    
    Example:
        output = create_output(json_output=True)
        output.success("Done", data={"count": 42})
        # Outputs: {"type": "success", "message": "Done", "data": {"count": 42}}
    """
    config = OutputConfig.detect(
        json_output=json_output,
        non_interactive=non_interactive,
        verbose=verbose,
        quiet=quiet,
    )
    
    if config.mode == OutputMode.JSON:
        return JsonOutput(config)
    elif config.mode == OutputMode.PLAIN:
        return PlainOutput(config)
    else:
        return TextOutput(config)


def create_output_from_ctx(ctx: Any) -> BaseOutput:
    """
    Create output handler from Click context.
    
    Args:
        ctx: Click context with obj containing flags
    
    Returns:
        Appropriate output handler
    """
    obj = ctx.obj or {}
    return create_output(
        json_output=obj.get("json_output", False),
        non_interactive=obj.get("non_interactive"),
        verbose=obj.get("verbose", False),
        quiet=obj.get("quiet", False),
    )


# =============================================================================
# Exports
# =============================================================================

__all__ = [
    # Detection
    "is_ci_environment",
    "is_interactive",
    "should_use_json",
    # Types
    "OutputMode",
    "OutputConfig",
    "OutputProtocol",
    # Output handlers
    "BaseOutput",
    "TextOutput",
    "PlainOutput",
    "JsonOutput",
    # Result builder
    "CommandResult",
    # Factory
    "create_output",
    "create_output_from_ctx",
]
