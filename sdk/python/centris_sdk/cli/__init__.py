"""
Centris SDK CLI

Command-line interface for voice-controlled computer automation.

QUICK START:
    pip install centris-sdk
    centris-py onboard                   # Interactive setup wizard
    centris-py start                     # Start the backend server
    centris-py doctor                    # Check installation health

Backend Management:
    centris-py start            - Start the Centris backend server
    centris-py stop             - Stop the backend server gracefully
    centris-py status           - Show server status and health
    centris-py doctor           - Diagnose installation issues
    centris-py config show      - Show current configuration
    centris-py onboard          - Interactive setup wizard

Connector Development:
    centris-py init <id>        - Initialize a new connector project
    centris-py validate [path]  - Validate connector schema
    centris-py test [path]      - Test connector capabilities
    centris-py serve [path]     - Start local dev server with playground

Publishing & Distribution:
    centris-py publish [path]   - Publish to registry (auto-login)
    centris-py package [path]   - Create distributable .connector file

Discovery & Installation:
    centris-py search <query>   - Search registry for connectors
    centris-py list             - List installed/available connectors
    centris-py install <id>     - Install connector from registry
    centris-py update           - Update installed connectors

Authentication (optional):
    centris-py login            - Login via browser
    centris-py logout           - Clear credentials
    centris-py whoami           - Show auth status
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
from centris_sdk.cli.adapter_cmd import adapter_group
from centris_sdk.cli.web_memory_cmd import web_memory_group
from centris_sdk.cli.result_envelope import (
    CliResultEnvelope,
    CliResultMeta,
    CliArtifact,
    build_result_envelope,
    emit_result_envelope,
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
    # Adapter interop
    "adapter_group",
    "web_memory_group",
    # Shared JSON result envelope
    "CliResultEnvelope",
    "CliResultMeta",
    "CliArtifact",
    "build_result_envelope",
    "emit_result_envelope",
]
