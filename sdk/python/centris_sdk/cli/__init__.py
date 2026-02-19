"""
Centris SDK CLI

Command-line interface for voice-controlled computer automation.

QUICK START:
    pip install centris-sdk
    centris onboard                   # Interactive setup wizard
    centris start                     # Start the backend server
    centris doctor                    # Check installation health

Backend Management:
    centris start            - Start the Centris backend server
    centris stop             - Stop the backend server gracefully
    centris status           - Show server status and health
    centris doctor           - Diagnose installation issues
    centris config show      - Show current configuration
    centris onboard          - Interactive setup wizard

Connector Development:
    centris init <id>        - Initialize a new connector project
    centris validate [path]  - Validate connector schema
    centris test [path]      - Test connector capabilities
    centris serve [path]     - Start local dev server with playground

Publishing & Distribution:
    centris publish [path]   - Publish to registry (auto-login)
    centris package [path]   - Create distributable .connector file

Discovery & Installation:
    centris search <query>   - Search registry for connectors
    centris list             - List installed/available connectors
    centris install <id>     - Install connector from registry
    centris update           - Update installed connectors

Authentication (optional):
    centris login            - Login via browser
    centris logout           - Clear credentials
    centris whoami           - Show auth status
"""

from centris_sdk.cli.main import (
    cli,
    main,
    get_deps,
    register_pre_action_hook,
    register_post_action_hook,
)
from centris_sdk.cli.version import (
    SDK_VERSION,
    get_sdk_version,
    CONFIG_VERSION,
)
from centris_sdk.cli.deps import (
    CLIDeps,
    create_default_deps,
    ConsoleProtocol,
    ConfigLoaderProtocol,
    BackendClientProtocol,
    FileSystemProtocol,
    DefaultConsole,
    DefaultConfigLoader,
    DefaultBackendClient,
    DefaultFileSystem,
)
from centris_sdk.cli.output import (
    create_output,
    OutputMode,
    OutputConfig,
    TextOutput,
    PlainOutput,
    JsonOutput,
    CommandResult,
    is_interactive,
    is_ci_environment,
)
from centris_sdk.cli.progress import (
    Spinner,
    ProgressBar,
    with_progress,
    spinner,
    progress,
)

__all__ = [
    # Main entry points
    "cli",
    "main",
    "get_deps",
    # Version
    "SDK_VERSION",
    "get_sdk_version",
    "CONFIG_VERSION",
    # Hooks
    "register_pre_action_hook",
    "register_post_action_hook",
    # Dependency injection
    "CLIDeps",
    "create_default_deps",
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
    # Output system
    "create_output",
    "OutputMode",
    "OutputConfig",
    "TextOutput",
    "PlainOutput",
    "JsonOutput",
    "CommandResult",
    "is_interactive",
    "is_ci_environment",
    # Progress indicators
    "Spinner",
    "ProgressBar",
    "with_progress",
    "spinner",
    "progress",
]
