"""
Centris CLI Testing Utilities

Provides mock dependencies and testing helpers for CLI command tests.

Usage:
    from centris_sdk.cli.testing import create_mock_deps, MockConsole
    
    def test_my_command():
        deps = create_mock_deps()
        result = my_command(deps=deps)
        
        assert "success" in deps.console.messages
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple
from unittest.mock import MagicMock

from centris_sdk.cli.deps import (
    CLIDeps,
    ConsoleProtocol,
    ConfigLoaderProtocol,
    BackendClientProtocol,
    FileSystemProtocol,
)


# =============================================================================
# Mock Console
# =============================================================================

@dataclass
class MockConsole:
    """
    Mock console that captures all output for testing.
    
    Example:
        console = MockConsole()
        console.success("Done!")
        
        assert console.has_message("Done!")
        assert console.success_messages == ["Done!"]
    """
    
    # Captured messages by type
    messages: List[Tuple[str, str]] = field(default_factory=list)
    error_messages: List[str] = field(default_factory=list)
    warn_messages: List[str] = field(default_factory=list)
    success_messages: List[str] = field(default_factory=list)
    info_messages: List[str] = field(default_factory=list)
    debug_messages: List[str] = field(default_factory=list)
    
    # All raw output
    output: List[str] = field(default_factory=list)
    
    # Configuration
    verbose: bool = False
    quiet: bool = False
    json_output: bool = False
    
    def print(self, *args: Any, **kwargs: Any) -> None:
        """Capture print output."""
        message = " ".join(str(a) for a in args)
        self.output.append(message)
        self.messages.append(("print", message))
    
    def echo(self, message: str, **kwargs: Any) -> None:
        """Capture echo output."""
        self.output.append(message)
        self.messages.append(("echo", message))
    
    def error(self, message: str) -> None:
        """Capture error message."""
        self.error_messages.append(message)
        self.messages.append(("error", message))
        self.output.append(f"[ERROR] {message}")
    
    def warn(self, message: str) -> None:
        """Capture warning message."""
        self.warn_messages.append(message)
        self.messages.append(("warn", message))
        self.output.append(f"[WARN] {message}")
    
    def success(self, message: str) -> None:
        """Capture success message."""
        self.success_messages.append(message)
        self.messages.append(("success", message))
        self.output.append(f"[SUCCESS] {message}")
    
    def info(self, message: str) -> None:
        """Capture info message."""
        self.info_messages.append(message)
        self.messages.append(("info", message))
        self.output.append(f"[INFO] {message}")
    
    def debug(self, message: str) -> None:
        """Capture debug message."""
        if self.verbose:
            self.debug_messages.append(message)
            self.messages.append(("debug", message))
            self.output.append(f"[DEBUG] {message}")
    
    def step(self, number: int, message: str) -> None:
        """Capture step message."""
        self.messages.append(("step", f"[{number}] {message}"))
        self.output.append(f"[{number}] {message}")
    
    def heading(self, text: str) -> None:
        """Capture heading."""
        self.messages.append(("heading", text))
        self.output.append(f"\n=== {text} ===")
    
    def muted(self, text: str) -> None:
        """Capture muted text."""
        self.messages.append(("muted", text))
        self.output.append(text)
    
    # Helper methods for testing
    
    def has_message(self, text: str) -> bool:
        """Check if any message contains the given text."""
        return any(text in msg for _, msg in self.messages)
    
    def has_error(self, text: str) -> bool:
        """Check if any error contains the given text."""
        return any(text in msg for msg in self.error_messages)
    
    def has_success(self, text: str) -> bool:
        """Check if any success message contains the given text."""
        return any(text in msg for msg in self.success_messages)
    
    def get_output(self) -> str:
        """Get all output as a single string."""
        return "\n".join(self.output)
    
    def clear(self) -> None:
        """Clear all captured output."""
        self.messages.clear()
        self.error_messages.clear()
        self.warn_messages.clear()
        self.success_messages.clear()
        self.info_messages.clear()
        self.debug_messages.clear()
        self.output.clear()


# =============================================================================
# Mock Config Loader
# =============================================================================

@dataclass
class MockConfigLoader:
    """
    Mock config loader with predefined values.
    
    Example:
        config = MockConfigLoader(config_data={"api_key": "test123"})
        assert config.get("api_key") == "test123"
    """
    
    config_data: Dict[str, Any] = field(default_factory=dict)
    backend_root: Optional[Path] = None
    settings: Any = None
    
    # Track method calls for verification
    load_called: bool = False
    get_calls: List[Tuple[str, Any]] = field(default_factory=list)
    
    def load(self) -> Dict[str, Any]:
        """Return mock config data."""
        self.load_called = True
        return self.config_data
    
    def get(self, key: str, default: Any = None) -> Any:
        """Get a mock config value."""
        self.get_calls.append((key, default))
        return self.config_data.get(key, default)
    
    def get_settings(self) -> Any:
        """Return mock settings object."""
        return self.settings
    
    def get_backend_root(self) -> Optional[Path]:
        """Return mock backend root."""
        return self.backend_root
    
    def set_value(self, key: str, value: Any) -> None:
        """Helper to set a config value for testing."""
        self.config_data[key] = value


# =============================================================================
# Mock Backend Client
# =============================================================================

@dataclass
class MockBackendClient:
    """
    Mock backend client for testing.
    
    Example:
        client = MockBackendClient(available=True)
        client.set_health_response({"status": "healthy"})
        
        result = await client.health_check()
        assert result["status"] == "healthy"
    """
    
    available: bool = True
    health_response: Dict[str, Any] = field(default_factory=lambda: {"status": "healthy"})
    status_response: Dict[str, Any] = field(default_factory=lambda: {"status": "running"})
    
    # Track method calls
    health_check_calls: int = 0
    status_calls: int = 0
    
    async def health_check(self) -> Dict[str, Any]:
        """Return mock health response."""
        self.health_check_calls += 1
        if not self.available:
            return {"status": "error", "error": "Backend unavailable"}
        return self.health_response
    
    async def get_status(self) -> Dict[str, Any]:
        """Return mock status response."""
        self.status_calls += 1
        if not self.available:
            return {"status": "error", "error": "Backend unavailable"}
        return self.status_response
    
    def is_available(self) -> bool:
        """Return mock availability."""
        return self.available
    
    # Helper methods for testing
    
    def set_health_response(self, response: Dict[str, Any]) -> None:
        """Set the health check response."""
        self.health_response = response
    
    def set_status_response(self, response: Dict[str, Any]) -> None:
        """Set the status response."""
        self.status_response = response
    
    def set_available(self, available: bool) -> None:
        """Set availability."""
        self.available = available


# =============================================================================
# Mock File System
# =============================================================================

@dataclass
class MockFileSystem:
    """
    In-memory mock file system for testing.
    
    Example:
        fs = MockFileSystem()
        fs.add_file(Path("/test/file.txt"), "content")
        
        assert fs.exists(Path("/test/file.txt"))
        assert fs.read_text(Path("/test/file.txt")) == "content"
    """
    
    files: Dict[str, str] = field(default_factory=dict)
    directories: List[str] = field(default_factory=list)
    
    # Track operations
    read_calls: List[Path] = field(default_factory=list)
    write_calls: List[Tuple[Path, str]] = field(default_factory=list)
    mkdir_calls: List[Tuple[Path, bool, bool]] = field(default_factory=list)
    
    def exists(self, path: Path) -> bool:
        """Check if mock path exists."""
        str_path = str(path)
        return str_path in self.files or str_path in self.directories
    
    def read_text(self, path: Path) -> str:
        """Read from mock file."""
        self.read_calls.append(path)
        str_path = str(path)
        if str_path not in self.files:
            raise FileNotFoundError(f"Mock file not found: {path}")
        return self.files[str_path]
    
    def write_text(self, path: Path, content: str) -> None:
        """Write to mock file."""
        self.write_calls.append((path, content))
        self.files[str(path)] = content
    
    def mkdir(self, path: Path, parents: bool = False, exist_ok: bool = False) -> None:
        """Create mock directory."""
        self.mkdir_calls.append((path, parents, exist_ok))
        str_path = str(path)
        if str_path in self.directories and not exist_ok:
            raise FileExistsError(f"Directory exists: {path}")
        self.directories.append(str_path)
    
    # Helper methods for testing
    
    def add_file(self, path: Path, content: str) -> None:
        """Add a file to the mock filesystem."""
        self.files[str(path)] = content
    
    def add_directory(self, path: Path) -> None:
        """Add a directory to the mock filesystem."""
        self.directories.append(str(path))
    
    def clear(self) -> None:
        """Clear all mock files and directories."""
        self.files.clear()
        self.directories.clear()
        self.read_calls.clear()
        self.write_calls.clear()
        self.mkdir_calls.clear()


# =============================================================================
# Factory Functions
# =============================================================================

def create_mock_deps(
    verbose: bool = False,
    quiet: bool = False,
    json_output: bool = False,
    backend_available: bool = True,
    config_data: Optional[Dict[str, Any]] = None,
) -> CLIDeps:
    """
    Create mock CLI dependencies for testing.
    
    Args:
        verbose: Enable verbose mode
        quiet: Enable quiet mode
        json_output: Enable JSON output mode
        backend_available: Whether mock backend is available
        config_data: Initial configuration data
    
    Returns:
        CLIDeps instance with all mock implementations
    
    Example:
        def test_doctor_command():
            deps = create_mock_deps(backend_available=False)
            
            result = doctor_command(deps=deps)
            
            assert deps.console.has_error("Backend unavailable")
    """
    # Create mock logger
    logger = logging.getLogger("centris.cli.test")
    logger.setLevel(logging.DEBUG if verbose else logging.WARNING)
    
    # Create mock implementations
    console = MockConsole(verbose=verbose, quiet=quiet, json_output=json_output)
    config_loader = MockConfigLoader(config_data=config_data or {})
    backend_client = MockBackendClient(available=backend_available)
    file_system = MockFileSystem()
    
    # Create deps
    deps = CLIDeps(
        console=console,
        config_loader=config_loader,
        backend_client=backend_client,
        file_system=file_system,
        logger=logger,
        verbose=verbose,
        quiet=quiet,
        json_output=json_output,
    )
    
    return deps


def create_isolated_deps(
    temp_dir: Path,
    verbose: bool = False,
) -> CLIDeps:
    """
    Create deps with isolated file system for integration tests.
    
    Uses a real temp directory but isolated from the actual system.
    
    Args:
        temp_dir: Temporary directory for test files
        verbose: Enable verbose output
    
    Returns:
        CLIDeps with isolated but real implementations
    """
    from centris_sdk.cli.deps import (
        DefaultConsole,
        DefaultBackendClient,
        DefaultFileSystem,
    )
    
    logger = logging.getLogger("centris.cli.test")
    
    # Use real file system but isolated config
    config_loader = MockConfigLoader(backend_root=temp_dir / "backend")
    
    deps = CLIDeps(
        console=DefaultConsole(verbose=verbose),
        config_loader=config_loader,
        backend_client=DefaultBackendClient(),
        file_system=DefaultFileSystem(),
        logger=logger,
        verbose=verbose,
    )
    
    return deps


# =============================================================================
# Test Fixtures and Helpers
# =============================================================================

class CLITestCase:
    """
    Base class for CLI command tests.
    
    Provides common setup and helper methods.
    
    Example:
        class TestDoctorCommand(CLITestCase):
            def test_healthy_backend(self):
                self.deps.backend_client.set_available(True)
                result = doctor_command(deps=self.deps)
                self.assert_success("healthy")
    """
    
    def setup_method(self) -> None:
        """Set up test fixtures."""
        self.deps = create_mock_deps()
        self.console: MockConsole = self.deps.console  # type: ignore
        self.config: MockConfigLoader = self.deps.config_loader  # type: ignore
        self.backend: MockBackendClient = self.deps.backend_client  # type: ignore
        self.fs: MockFileSystem = self.deps.file_system  # type: ignore
    
    def teardown_method(self) -> None:
        """Clean up after test."""
        self.console.clear()
        self.fs.clear()
    
    def assert_success(self, message: str) -> None:
        """Assert a success message was printed."""
        assert self.console.has_success(message), (
            f"Expected success message containing '{message}'\n"
            f"Got: {self.console.success_messages}"
        )
    
    def assert_error(self, message: str) -> None:
        """Assert an error message was printed."""
        assert self.console.has_error(message), (
            f"Expected error message containing '{message}'\n"
            f"Got: {self.console.error_messages}"
        )
    
    def assert_output_contains(self, text: str) -> None:
        """Assert output contains given text."""
        output = self.console.get_output()
        assert text in output, (
            f"Expected output to contain '{text}'\n"
            f"Got:\n{output}"
        )
    
    def assert_no_errors(self) -> None:
        """Assert no errors were printed."""
        assert not self.console.error_messages, (
            f"Expected no errors, got: {self.console.error_messages}"
        )


# =============================================================================
# Click Testing Helpers
# =============================================================================

def invoke_command(
    command: Callable,
    args: Optional[List[str]] = None,
    deps: Optional[CLIDeps] = None,
    **kwargs: Any,
) -> Any:
    """
    Invoke a Click command with mock dependencies.
    
    Args:
        command: The Click command function
        args: Command line arguments
        deps: Dependencies (creates mock if not provided)
        **kwargs: Additional arguments to pass to command
    
    Returns:
        Command result
    
    Example:
        result = invoke_command(doctor_command, ["--verbose"])
        assert result.exit_code == 0
    """
    import click
    from click.testing import CliRunner
    
    if deps is None:
        deps = create_mock_deps()
    
    runner = CliRunner()
    
    # Create a wrapper that injects deps
    @click.command()
    @click.pass_context
    def wrapper(ctx: click.Context) -> None:
        ctx.obj = ctx.obj or {}
        ctx.obj["deps"] = deps
        ctx.invoke(command, **kwargs)
    
    result = runner.invoke(wrapper, args or [])
    return result


# =============================================================================
# Exports
# =============================================================================

__all__ = [
    # Mock classes
    "MockConsole",
    "MockConfigLoader",
    "MockBackendClient",
    "MockFileSystem",
    # Factory functions
    "create_mock_deps",
    "create_isolated_deps",
    # Testing helpers
    "CLITestCase",
    "invoke_command",
]
