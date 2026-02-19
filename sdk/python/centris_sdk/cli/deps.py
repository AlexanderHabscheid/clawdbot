"""
Centris CLI Dependency Injection System

Provides injectable dependencies for all CLI commands, enabling:
- Testability via mock dependencies
- Consistent configuration loading
- Centralized backend client management
- Pluggable logging and output
- Profile-aware state management

Inspired by Clawdbot's createDefaultDeps() pattern.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import (
    Any,
    Callable,
    Dict,
    List,
    Optional,
    Protocol,
    TYPE_CHECKING,
    TypeVar,
    runtime_checkable,
)

from centris_sdk.cli.theme import theme, symbols, COLORS_ENABLED

if TYPE_CHECKING:
    from centris_sdk.cli.profile import ProfileConfig

# Current config version for migrations
CURRENT_CONFIG_VERSION = "1.1.0"


# =============================================================================
# Runtime Environment (Clawdbot Pattern)
# =============================================================================

@runtime_checkable
class RuntimeEnv(Protocol):
    """
    Runtime environment protocol for CLI I/O operations.
    
    This is the Clawdbot-style abstraction that enables testing by
    capturing all CLI output and exit calls.
    
    Usage in commands:
        def my_command(runtime: RuntimeEnv = default_runtime):
            runtime.log("Processing...")
            runtime.success("Done!")
    
    Usage in tests:
        runtime = MockRuntime()
        my_command(runtime=runtime)
        assert "Done!" in runtime.logs
    """
    
    def log(self, message: str) -> None:
        """Log a message to stdout."""
        ...
    
    def error(self, message: str) -> None:
        """Log an error message to stderr."""
        ...
    
    def warn(self, message: str) -> None:
        """Log a warning message."""
        ...
    
    def success(self, message: str) -> None:
        """Log a success message."""
        ...
    
    def exit(self, code: int) -> None:
        """Exit with the given code."""
        ...


class DefaultRuntime:
    """
    Default runtime environment using sys.stdout/stderr.
    
    This is the production runtime that actually writes to the terminal
    and exits the process.
    """
    
    def __init__(self, use_theme: bool = True):
        self._use_theme = use_theme
    
    def log(self, message: str) -> None:
        """Log a message to stdout."""
        print(message)
    
    def error(self, message: str) -> None:
        """Log an error message to stderr."""
        if self._use_theme:
            print(f"{theme.error(symbols.CROSS)} {message}", file=sys.stderr)
        else:
            print(f"ERROR: {message}", file=sys.stderr)
    
    def warn(self, message: str) -> None:
        """Log a warning message."""
        if self._use_theme:
            print(f"{theme.warn('!')} {message}")
        else:
            print(f"WARNING: {message}")
    
    def success(self, message: str) -> None:
        """Log a success message."""
        if self._use_theme:
            print(f"{theme.success(symbols.CHECK)} {message}")
        else:
            print(f"OK: {message}")
    
    def exit(self, code: int) -> None:
        """Exit with the given code."""
        sys.exit(code)


class MockRuntime:
    """
    Mock runtime for testing CLI commands.
    
    Captures all output instead of printing, and records exit calls
    instead of actually exiting.
    
    Usage:
        runtime = MockRuntime()
        my_command(runtime=runtime)
        
        # Verify output
        assert "success" in runtime.logs
        assert runtime.exit_code == 0
        
        # Verify no errors
        assert not runtime.errors
    """
    
    def __init__(self):
        self.logs: List[str] = []
        self.errors: List[str] = []
        self.warnings: List[str] = []
        self.successes: List[str] = []
        self.exit_code: Optional[int] = None
        self._exited = False
    
    def log(self, message: str) -> None:
        """Capture log message."""
        self.logs.append(message)
    
    def error(self, message: str) -> None:
        """Capture error message."""
        self.errors.append(message)
    
    def warn(self, message: str) -> None:
        """Capture warning message."""
        self.warnings.append(message)
    
    def success(self, message: str) -> None:
        """Capture success message."""
        self.successes.append(message)
    
    def exit(self, code: int) -> None:
        """Record exit code (doesn't actually exit)."""
        self.exit_code = code
        self._exited = True
    
    @property
    def exited(self) -> bool:
        """Check if exit was called."""
        return self._exited
    
    @property
    def all_output(self) -> List[str]:
        """Get all output in order (logs, errors, warnings, successes)."""
        return self.logs + self.errors + self.warnings + self.successes
    
    def reset(self) -> None:
        """Reset all captured state."""
        self.logs.clear()
        self.errors.clear()
        self.warnings.clear()
        self.successes.clear()
        self.exit_code = None
        self._exited = False


# Global default runtime instance
default_runtime = DefaultRuntime()


# =============================================================================
# Protocols for Dependency Interfaces
# =============================================================================

@runtime_checkable
class ConsoleProtocol(Protocol):
    """Protocol for console output (allows mocking in tests)."""
    
    def print(self, *args: Any, **kwargs: Any) -> None:
        """Print to console."""
        ...
    
    def echo(self, message: str, **kwargs: Any) -> None:
        """Echo a message (click-style)."""
        ...
    
    def error(self, message: str) -> None:
        """Print an error message."""
        ...
    
    def warn(self, message: str) -> None:
        """Print a warning message."""
        ...
    
    def success(self, message: str) -> None:
        """Print a success message."""
        ...
    
    def info(self, message: str) -> None:
        """Print an info message."""
        ...


@runtime_checkable
class ConfigLoaderProtocol(Protocol):
    """Protocol for configuration loading."""
    
    def load(self) -> Dict[str, Any]:
        """Load configuration from all sources."""
        ...
    
    def get(self, key: str, default: Any = None) -> Any:
        """Get a configuration value."""
        ...
    
    def get_settings(self) -> Any:
        """Get the settings object (if available)."""
        ...


@runtime_checkable
class BackendClientProtocol(Protocol):
    """Protocol for backend API client."""
    
    async def health_check(self) -> Dict[str, Any]:
        """Check backend health."""
        ...
    
    async def get_status(self) -> Dict[str, Any]:
        """Get backend status."""
        ...
    
    def is_available(self) -> bool:
        """Check if backend is available."""
        ...


@runtime_checkable
class FileSystemProtocol(Protocol):
    """Protocol for file system operations."""
    
    def exists(self, path: Path) -> bool:
        """Check if path exists."""
        ...
    
    def read_text(self, path: Path) -> str:
        """Read text from file."""
        ...
    
    def write_text(self, path: Path, content: str) -> None:
        """Write text to file."""
        ...
    
    def mkdir(self, path: Path, parents: bool = False, exist_ok: bool = False) -> None:
        """Create directory."""
        ...


# =============================================================================
# Default Implementations
# =============================================================================

class DefaultConsole:
    """
    Default console implementation using click and theme.
    
    Provides consistent styled output across all CLI commands.
    """
    
    def __init__(self, verbose: bool = False, quiet: bool = False, json_output: bool = False):
        self.verbose = verbose
        self.quiet = quiet
        self.json_output = json_output
    
    def print(self, *args: Any, **kwargs: Any) -> None:
        """Print to stdout."""
        if not self.quiet:
            print(*args, **kwargs)
    
    def echo(self, message: str, **kwargs: Any) -> None:
        """Echo using click."""
        import click
        if not self.quiet:
            click.echo(message, **kwargs)
    
    def error(self, message: str) -> None:
        """Print styled error."""
        self.echo(f"{theme.error(symbols.CROSS)} {message}")
    
    def warn(self, message: str) -> None:
        """Print styled warning."""
        self.echo(f"{theme.warn('!')} {message}")
    
    def success(self, message: str) -> None:
        """Print styled success."""
        self.echo(f"{theme.success(symbols.CHECK)} {message}")
    
    def info(self, message: str) -> None:
        """Print styled info."""
        self.echo(f"{theme.info(symbols.BULLET)} {message}")
    
    def debug(self, message: str) -> None:
        """Print debug message (only in verbose mode)."""
        if self.verbose:
            self.echo(f"{theme.muted('DEBUG:')} {message}")
    
    def step(self, number: int, message: str) -> None:
        """Print a numbered step."""
        self.echo(f"{theme.accent(f'[{number}]')} {message}")
    
    def heading(self, text: str) -> None:
        """Print a heading."""
        self.echo(f"\n{theme.heading(text)}")
    
    def muted(self, text: str) -> None:
        """Print muted text."""
        self.echo(theme.muted(text))


class DefaultConfigLoader:
    """
    Default configuration loader.
    
    Loads configuration from:
    1. Environment variables
    2. .env files (project root, backend)
    3. Backend settings (if available)
    """
    
    def __init__(self, backend_root: Optional[Path] = None):
        self._backend_root = backend_root
        self._config: Dict[str, Any] = {}
        self._settings: Any = None
    
    def _find_backend_root(self) -> Optional[Path]:
        """Find the backend directory."""
        if self._backend_root:
            return self._backend_root
        
        candidates = [
            Path.cwd() / "backend",
            Path.cwd().parent / "backend",
            Path(__file__).resolve().parent.parent.parent.parent.parent.parent / "backend",
        ]
        
        for candidate in candidates:
            if candidate.exists() and (candidate / "main.py").exists():
                return candidate
        
        return None
    
    def load(self) -> Dict[str, Any]:
        """Load configuration from all sources."""
        # Load .env files
        try:
            from dotenv import load_dotenv
            
            backend_root = self._find_backend_root()
            if backend_root:
                project_root = backend_root.parent
                
                # Load project .env
                env_file = project_root / ".env"
                if env_file.exists():
                    load_dotenv(env_file)
                
                # Load backend .env (overrides)
                backend_env = backend_root / ".env"
                if backend_env.exists():
                    load_dotenv(backend_env, override=True)
        except ImportError:
            pass
        
        # Load backend settings if available
        try:
            backend_root = self._find_backend_root()
            if backend_root:
                project_root = backend_root.parent
                if str(project_root) not in sys.path:
                    sys.path.insert(0, str(project_root))
                
                from backend.config.settings import get_settings
                self._settings = get_settings()
                
                # Convert settings to dict
                if hasattr(self._settings, '__dict__'):
                    self._config.update({
                        k: v for k, v in self._settings.__dict__.items()
                        if not k.startswith('_')
                    })
        except ImportError:
            pass
        
        return self._config
    
    def get(self, key: str, default: Any = None) -> Any:
        """Get a configuration value."""
        # First check loaded config
        if key in self._config:
            return self._config[key]
        
        # Then check environment
        env_value = os.getenv(key.upper())
        if env_value is not None:
            return env_value
        
        return default
    
    def get_settings(self) -> Any:
        """Get the backend settings object."""
        if self._settings is None:
            self.load()
        return self._settings
    
    def get_backend_root(self) -> Optional[Path]:
        """Get the backend root directory."""
        return self._find_backend_root()


class DefaultBackendClient:
    """
    Default backend client for API interactions.
    
    Provides methods to interact with the running backend server.
    """
    
    def __init__(self, base_url: str = "http://127.0.0.1:5001"):
        self.base_url = base_url
        self._available: Optional[bool] = None
    
    async def health_check(self) -> Dict[str, Any]:
        """Check backend health."""
        try:
            import httpx
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{self.base_url}/health")
                return response.json()
        except Exception as e:
            return {"status": "error", "error": str(e)}
    
    async def get_status(self) -> Dict[str, Any]:
        """Get backend status."""
        try:
            import httpx
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{self.base_url}/api/health/full")
                return response.json()
        except Exception as e:
            return {"status": "error", "error": str(e)}
    
    def is_available(self) -> bool:
        """Check if backend is available (sync check)."""
        if self._available is not None:
            return self._available
        
        try:
            import socket
            host, port = self.base_url.replace("http://", "").replace("https://", "").split(":")
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(1)
            result = sock.connect_ex((host, int(port)))
            sock.close()
            self._available = result == 0
        except Exception:
            self._available = False
        
        return self._available


class DefaultFileSystem:
    """Default file system implementation using pathlib."""
    
    def exists(self, path: Path) -> bool:
        """Check if path exists."""
        return path.exists()
    
    def read_text(self, path: Path) -> str:
        """Read text from file."""
        return path.read_text()
    
    def write_text(self, path: Path, content: str) -> None:
        """Write text to file."""
        path.write_text(content)
    
    def mkdir(self, path: Path, parents: bool = False, exist_ok: bool = False) -> None:
        """Create directory."""
        path.mkdir(parents=parents, exist_ok=exist_ok)


# =============================================================================
# CLI Dependencies Container
# =============================================================================

@dataclass
class CLIDeps:
    """
    Container for all CLI dependencies.
    
    This class holds all the dependencies that CLI commands need.
    By using dependency injection, commands become testable and
    can be configured with different implementations.
    
    Usage:
        deps = create_default_deps()
        deps.console.success("Operation completed!")
        
        # In tests:
        mock_deps = create_mock_deps()
        command(deps=mock_deps)
    """
    
    # Core dependencies
    console: ConsoleProtocol
    config_loader: ConfigLoaderProtocol
    backend_client: BackendClientProtocol
    file_system: FileSystemProtocol
    
    # Logging
    logger: logging.Logger
    
    # Profile (for isolated environments)
    profile: Optional["ProfileConfig"] = None
    
    # Options/Flags
    verbose: bool = False
    quiet: bool = False
    json_output: bool = False
    non_interactive: bool = False  # For CI/scripting mode
    
    # Context data (populated during command execution)
    context: Dict[str, Any] = field(default_factory=dict)
    
    # Hooks (for pre/post action callbacks)
    pre_action_hooks: List[Callable[["CLIDeps", str], None]] = field(default_factory=list)
    post_action_hooks: List[Callable[["CLIDeps", str, Any], None]] = field(default_factory=list)
    
    def add_pre_action_hook(self, hook: Callable[["CLIDeps", str], None]) -> None:
        """Add a hook to run before command execution."""
        self.pre_action_hooks.append(hook)
    
    def add_post_action_hook(self, hook: Callable[["CLIDeps", str, Any], None]) -> None:
        """Add a hook to run after command execution."""
        self.post_action_hooks.append(hook)
    
    def run_pre_action_hooks(self, command_name: str) -> None:
        """Run all pre-action hooks."""
        for hook in self.pre_action_hooks:
            try:
                hook(self, command_name)
            except Exception as e:
                self.logger.warning(f"Pre-action hook failed: {e}")
    
    def run_post_action_hooks(self, command_name: str, result: Any) -> None:
        """Run all post-action hooks."""
        for hook in self.post_action_hooks:
            try:
                hook(self, command_name, result)
            except Exception as e:
                self.logger.warning(f"Post-action hook failed: {e}")
    
    @property
    def state_dir(self) -> Path:
        """Get the state directory for the current profile."""
        if self.profile:
            return self.profile.state_dir
        return Path.home() / ".centris"
    
    @property
    def config_dir(self) -> Path:
        """Get the config directory for the current profile."""
        if self.profile:
            return self.profile.config_dir
        return Path.home() / ".centris" / "config"


# =============================================================================
# Factory Functions
# =============================================================================

def create_default_deps(
    verbose: bool = False,
    quiet: bool = False,
    json_output: bool = False,
    backend_url: str = "http://127.0.0.1:5001",
    profile: Optional["ProfileConfig"] = None,
    non_interactive: bool = False,
) -> CLIDeps:
    """
    Create default CLI dependencies.
    
    This is the main factory function that creates a fully configured
    CLIDeps instance with all default implementations.
    
    Args:
        verbose: Enable verbose output
        quiet: Suppress non-essential output
        json_output: Output JSON instead of styled text
        backend_url: URL of the backend server
        profile: Profile configuration for isolated environments
        non_interactive: Disable interactive prompts (for CI/scripts)
    
    Returns:
        Configured CLIDeps instance
    
    Example:
        deps = create_default_deps(verbose=True)
        deps.console.success("Hello!")
        
        # With profile
        from centris_sdk.cli.profile import resolve_profile
        profile = resolve_profile(dev=True)
        deps = create_default_deps(profile=profile)
        
        # Non-interactive mode for CI
        deps = create_default_deps(non_interactive=True, json_output=True)
    """
    # Create logger
    logger = logging.getLogger("centris.cli")
    if verbose:
        logger.setLevel(logging.DEBUG)
    else:
        logger.setLevel(logging.INFO)
    
    # Create default implementations
    console = DefaultConsole(verbose=verbose, quiet=quiet, json_output=json_output)
    config_loader = DefaultConfigLoader()
    backend_client = DefaultBackendClient(base_url=backend_url)
    file_system = DefaultFileSystem()
    
    # Create deps container
    deps = CLIDeps(
        console=console,
        config_loader=config_loader,
        backend_client=backend_client,
        file_system=file_system,
        logger=logger,
        profile=profile,
        verbose=verbose,
        quiet=quiet,
        json_output=json_output,
        non_interactive=non_interactive,
    )
    
    # Add default hooks
    deps.add_pre_action_hook(_config_migration_check_hook)
    
    return deps


# =============================================================================
# Config Migration System
# =============================================================================

# Migration functions keyed by (from_version, to_version)
_MIGRATIONS: Dict[tuple, Callable[[CLIDeps, Path], None]] = {}


def register_migration(
    from_version: str,
    to_version: str,
) -> Callable[[Callable[[CLIDeps, Path], None]], Callable[[CLIDeps, Path], None]]:
    """
    Register a config migration function.
    
    Usage:
        @register_migration("1.0.0", "1.1.0")
        def migrate_1_0_to_1_1(deps: CLIDeps, config_dir: Path) -> None:
            # Migration logic here
            pass
    """
    def decorator(func: Callable[[CLIDeps, Path], None]) -> Callable[[CLIDeps, Path], None]:
        _MIGRATIONS[(from_version, to_version)] = func
        return func
    return decorator


def _parse_version(version: str) -> tuple:
    """Parse version string into comparable tuple."""
    try:
        parts = version.split(".")
        return tuple(int(p) for p in parts[:3])
    except (ValueError, AttributeError):
        return (0, 0, 0)


def _version_less_than(v1: str, v2: str) -> bool:
    """Compare two version strings."""
    return _parse_version(v1) < _parse_version(v2)


def _get_migration_path(from_version: str, to_version: str) -> List[tuple]:
    """
    Find migration path from one version to another.
    
    Returns list of (from, to) tuples in order.
    """
    # Build a graph of available migrations
    available = list(_MIGRATIONS.keys())
    
    # Simple greedy path finding
    path = []
    current = from_version
    
    while _version_less_than(current, to_version):
        # Find next migration from current version
        next_migration = None
        for (fv, tv) in available:
            if fv == current and _version_less_than(current, tv):
                if next_migration is None or _version_less_than(tv, next_migration[1]):
                    # Prefer smaller jumps, but any valid path works
                    pass
                next_migration = (fv, tv)
                break
        
        if next_migration is None:
            # No migration available, jump to target
            break
        
        path.append(next_migration)
        current = next_migration[1]
    
    return path


def run_config_migrations(deps: CLIDeps, config_dir: Path) -> bool:
    """
    Run any pending config migrations.
    
    Args:
        deps: CLI dependencies
        config_dir: Directory containing config files
        
    Returns:
        True if migrations were run, False if already up to date
    """
    version_file = config_dir / "version"
    
    # Get current version
    if deps.file_system.exists(version_file):
        current_version = deps.file_system.read_text(version_file).strip()
    else:
        # No version file = new installation or pre-versioning
        current_version = "0.0.0"
    
    # Check if migration needed
    if not _version_less_than(current_version, CURRENT_CONFIG_VERSION):
        deps.logger.debug(f"Config is up to date (v{current_version})")
        return False
    
    deps.logger.info(f"Migrating config from v{current_version} to v{CURRENT_CONFIG_VERSION}")
    
    # Get migration path
    path = _get_migration_path(current_version, CURRENT_CONFIG_VERSION)
    
    # Run migrations
    for from_v, to_v in path:
        if (from_v, to_v) in _MIGRATIONS:
            deps.logger.debug(f"Running migration: {from_v} -> {to_v}")
            try:
                _MIGRATIONS[(from_v, to_v)](deps, config_dir)
            except Exception as e:
                deps.logger.error(f"Migration {from_v} -> {to_v} failed: {e}")
                raise
    
    # Update version file
    deps.file_system.mkdir(config_dir, parents=True, exist_ok=True)
    deps.file_system.write_text(version_file, CURRENT_CONFIG_VERSION)
    
    deps.logger.info(f"Config migrated to v{CURRENT_CONFIG_VERSION}")
    return True


# =============================================================================
# Default Migrations
# =============================================================================

@register_migration("0.0.0", "1.0.0")
def _migrate_0_to_1(deps: CLIDeps, config_dir: Path) -> None:
    """
    Initial migration: create config structure.
    
    This handles pre-versioned installations.
    """
    # Ensure directories exist
    deps.file_system.mkdir(config_dir, parents=True, exist_ok=True)
    
    # Create default config if it doesn't exist
    config_file = config_dir / "config.json"
    if not deps.file_system.exists(config_file):
        default_config = {
            "version": "1.0.0",
            "telemetry": False,
            "backend": {
                "url": "http://127.0.0.1:5001",
            },
            "connectors": {
                "directory": str(Path.home() / ".centris" / "connectors"),
            },
        }
        deps.file_system.write_text(config_file, json.dumps(default_config, indent=2))


@register_migration("1.0.0", "1.1.0")
def _migrate_1_0_to_1_1(deps: CLIDeps, config_dir: Path) -> None:
    """
    Migration 1.0.0 -> 1.1.0: Add profile support fields.
    """
    config_file = config_dir / "config.json"
    if deps.file_system.exists(config_file):
        try:
            config = json.loads(deps.file_system.read_text(config_file))
            
            # Add new fields for 1.1.0
            if "profiles" not in config:
                config["profiles"] = {
                    "default": None,
                    "available": [],
                }
            
            if "cli" not in config:
                config["cli"] = {
                    "defaultFlags": {},
                    "aliases": {},
                }
            
            config["version"] = "1.1.0"
            deps.file_system.write_text(config_file, json.dumps(config, indent=2))
        except json.JSONDecodeError:
            deps.logger.warning("Could not parse config.json for migration")


def _config_migration_check_hook(deps: CLIDeps, command_name: str) -> None:
    """
    Pre-action hook to check for and run config migrations.
    
    This runs before every command to ensure configuration is up-to-date.
    """
    # Skip for certain commands that don't need config
    skip_commands = {"version", "help", "--help", "-h", "--version", "introspect"}
    if command_name in skip_commands:
        return
    
    try:
        # Determine config directory
        if deps.profile:
            config_dir = deps.profile.config_dir
        else:
            # Fall back to default
            config_dir = Path.home() / ".centris" / "config"
        
        # Run migrations if needed
        run_config_migrations(deps, config_dir)
        
    except Exception as e:
        # Don't fail commands due to migration issues, just log
        deps.logger.debug(f"Config migration check skipped: {e}")


# =============================================================================
# Exports
# =============================================================================

__all__ = [
    # Runtime environment (Clawdbot pattern)
    "RuntimeEnv",
    "DefaultRuntime",
    "MockRuntime",
    "default_runtime",
    # Protocols
    "ConsoleProtocol",
    "ConfigLoaderProtocol", 
    "BackendClientProtocol",
    "FileSystemProtocol",
    # Default implementations
    "DefaultConsole",
    "DefaultConfigLoader",
    "DefaultBackendClient",
    "DefaultFileSystem",
    # Main types
    "CLIDeps",
    # Factory functions
    "create_default_deps",
]
