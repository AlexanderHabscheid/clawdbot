"""
Centris SDK for Python

The simplest way to use Centris:

    from centris_sdk import Centris
    
    centris = Centris(api_key="ck_live_xxx")
    result = centris.do("Open Gmail and read my first 3 emails")
    print(result.text)

That's it. One method, infinite power.

Or even simpler:

    from centris_sdk import do
    result = do("Open Gmail")

For connector developers, the SDK provides:
- CLI for connector development (centris init, validate, test, serve, publish)
- MCP Gateway for aggregating multiple connectors
- Execution Engine with API, Browser, and Desktop executors
- Connector discovery and loading

Quick Start (Connector Development):
    pip install centris-sdk
    centris init my-connector
    cd my-connector
    centris serve

Example (Decorator Pattern):
    from centris_sdk import CentrisConnector, ExecutionMethod, AuthScheme

    slack = CentrisConnector(
        connector_id="slack",
        name="Slack",
        description="Send messages and manage Slack workspaces",
        auth_schemes=[AuthScheme.OAUTH2],
    )

    @slack.capability(
        id="send_message",
        name="Send Message",
        description="Send a message to a Slack channel",
        input_schema={
            "type": "object",
            "properties": {
                "channel": {"type": "string"},
                "message": {"type": "string"},
            },
            "required": ["channel", "message"],
        },
    )
    async def send_message(params: dict, context: dict) -> dict:
        return {"ok": True, "ts": "12345"}

Example (Plugin API Pattern):
    from centris_sdk import CentrisPluginConnector, CentrisConnectorApi, CentrisTool, text_result

    connector = CentrisPluginConnector(
        id="my-connector",
        name="My Connector",
        description="Example connector",
    )

    @connector.register
    def register(api: CentrisConnectorApi):
        async def handler(tool_call_id, params, context):
            return text_result(f"Received: {params.get('message')}")

        api.register_tool(CentrisTool(
            name="echo",
            description="Echo a message",
            parameters={"type": "object", "properties": {"message": {"type": "string"}}},
            execute=handler,
        ))

Example (MCP Gateway):
    from centris_sdk import MCPGateway, GatewayServer

    gateway = MCPGateway()
    gateway.add_connector(slack_connector)
    gateway.add_connector(github_connector)

    server = GatewayServer(gateway)
    server.run(port=8000)

Example (Execution Engine):
    from centris_sdk import ExecutionEngine

    engine = ExecutionEngine()
    result = await engine.execute(
        connector_id="slack",
        capability_id="send_message",
        params={"channel": "#general", "message": "Hello"},
    )
"""

# API Client - The main interface for using Centris
from centris_sdk.client import (
    Centris,
    CentrisResult,
    CentrisUsage,
    CentrisError,
    AuthenticationError,
    RateLimitError,
    do,  # Convenience function
    DEFAULT_API_VERSION,  # Current stable API version
)

# Core connector classes
from centris_sdk.connector import CentrisConnector
from centris_sdk.capability import Capability
from centris_sdk.types import (
    ExecutionMethod,
    AuthScheme,
    ExecutionContext,
    ExecutionResult,
    ConnectorCard,
    OAuthConfig,
    UIMapping,
)
from centris_sdk.decorators import capability, context_provider
from centris_sdk.validation import validate_params, ValidationError

# Plugin API
from centris_sdk.plugin_api import (
    BrowserBridge,  # Abstract interface for browser automation
    CentrisConnectorApi,
    CentrisPluginConnector,
    CentrisTool,
    ToolContext,
    ToolResult,
    ConnectorService,
    text_result,
    json_result,
    error_result,
    image_result,
)

# Gateway
from centris_sdk.gateway import (
    MCPGateway,
    GatewayServer,
    GatewayConfig,
)

# Execution Engine
from centris_sdk.execution import (
  ExecutionEngine,
  ExecutionRouter,
  ExecutionConfig,
  APIExecutor,
  BrowserExecutor,
  DesktopExecutor,
)
from centris_sdk.kernel import (
    ACTION_KERNEL_SPEC_VERSION,
    ActionKernel,
    KernelSuccessCheck,
    KernelObserveRequest,
    KernelObserveResult,
    KernelActRequest,
    KernelActResult,
    KernelVerifyRequest,
    KernelVerifyResult,
    KernelRouteRequest,
    KernelRouteResult,
    KernelLearnRequest,
    KernelLearnResult,
)
from centris_sdk.action_api import (
    ACTION_API_SPEC_VERSION,
    ActionApiMethod,
    ActionApiRequestEnvelope,
    ActionApiResponseEnvelope,
    ActionApiError,
    ActionArtifact,
    ActionRouteRunRequest,
    ActionRouteRunResult,
    ActionRouteRecordStartRequest,
    ActionRouteRecordStartResult,
    ActionRouteRecordStopRequest,
    ActionRouteRecordStopResult,
    ActionWebMemoryIndexRequest,
    ActionWebMemoryIndexResult,
    ActionWebMemoryResolveRequest,
    ActionWebMemoryResolveResult,
    ActionWebMemoryExecuteRequest,
    ActionWebMemoryExecuteResult,
    ActionWebMemoryInvalidateRequest,
    ActionWebMemoryInvalidateResult,
    ActionWebMemoryStatsRequest,
    ActionWebMemoryStatsResult,
)

# Loader
from centris_sdk.loader import (
    ConnectorLoader,
    discover_connectors,
)
from centris_sdk.adapter_runtime import (
    AdapterRuntime,
    AdapterSpec,
    AdapterOperation,
    AdapterExecutionResult,
)

# Testing utilities (optional import - may not be needed in production)
try:
    from centris_sdk.testing import (
        MockBrowserBridge,
        ConnectorTestHarness,
        create_test_context,
    )
    _testing_available = True
except ImportError:
    _testing_available = False
    MockBrowserBridge = None
    ConnectorTestHarness = None
    create_test_context = None

# Version from package metadata (single source of truth: pyproject.toml)
try:
    from importlib.metadata import version as _get_version
    __version__ = _get_version("centris-sdk")
except Exception:
    # Fallback for development/editable installs
    __version__ = "0.0.0.dev"

__all__ = [
    # API Client (primary interface)
    "Centris",
    "CentrisResult",
    "CentrisUsage",
    "CentrisError",
    "AuthenticationError",
    "RateLimitError",
    "do",
    "DEFAULT_API_VERSION",
    # Main classes (Decorator pattern)
    "CentrisConnector",
    "Capability",
    # Main classes (Plugin API pattern)
    "CentrisPluginConnector",
    "CentrisConnectorApi",
    "CentrisTool",
    "ToolContext",
    "ToolResult",
    "ConnectorService",
    # Browser automation interface
    "BrowserBridge",
    # Result builders
    "text_result",
    "json_result",
    "error_result",
    "image_result",
    # Enums
    "ExecutionMethod",
    "AuthScheme",
    # Types
    "ExecutionContext",
    "ExecutionResult",
    "ConnectorCard",
    "OAuthConfig",
    "UIMapping",
    # Decorators
    "capability",
    "context_provider",
    # Validation
    "validate_params",
    "ValidationError",
    # Gateway
    "MCPGateway",
    "GatewayServer",
    "GatewayConfig",
    # Execution Engine
    "ExecutionEngine",
    "ExecutionRouter",
    "ExecutionConfig",
    "APIExecutor",
    "BrowserExecutor",
    "DesktopExecutor",
    # Action Kernel
    "ACTION_KERNEL_SPEC_VERSION",
    "ActionKernel",
    "KernelSuccessCheck",
    "KernelObserveRequest",
    "KernelObserveResult",
    "KernelActRequest",
    "KernelActResult",
    "KernelVerifyRequest",
    "KernelVerifyResult",
    "KernelRouteRequest",
    "KernelRouteResult",
    "KernelLearnRequest",
    "KernelLearnResult",
    # Action API
    "ACTION_API_SPEC_VERSION",
    "ActionApiMethod",
    "ActionApiRequestEnvelope",
    "ActionApiResponseEnvelope",
    "ActionApiError",
    "ActionArtifact",
    "ActionRouteRunRequest",
    "ActionRouteRunResult",
    "ActionRouteRecordStartRequest",
    "ActionRouteRecordStartResult",
    "ActionRouteRecordStopRequest",
    "ActionRouteRecordStopResult",
    "ActionWebMemoryIndexRequest",
    "ActionWebMemoryIndexResult",
    "ActionWebMemoryResolveRequest",
    "ActionWebMemoryResolveResult",
    "ActionWebMemoryExecuteRequest",
    "ActionWebMemoryExecuteResult",
    "ActionWebMemoryInvalidateRequest",
    "ActionWebMemoryInvalidateResult",
    "ActionWebMemoryStatsRequest",
    "ActionWebMemoryStatsResult",
    # Loader
    "ConnectorLoader",
    "discover_connectors",
    # Adapter runtime
    "AdapterRuntime",
    "AdapterSpec",
    "AdapterOperation",
    "AdapterExecutionResult",
    # Testing (optional)
    "MockBrowserBridge",
    "ConnectorTestHarness",
    "create_test_context",
    # Version
    "__version__",
]
