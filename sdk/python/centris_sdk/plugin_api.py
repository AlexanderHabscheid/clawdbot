"""
Centris SDK Plugin API

Plugin API pattern for Python connectors, matching the TypeScript SDK.
This enables connectors to register tools, gateway methods, CLI commands, and services.

SECURITY NOTE FOR THIRD-PARTY DEVELOPERS:
=========================================
The SDK exposes a sandboxed BrowserBridge interface. You DO NOT have access to:
- Internal Centris codebase or implementation details
- User credentials or session tokens
- System-level operations outside browser automation
- Other connectors' data or state

Your connector receives ONLY:
- BrowserBridge: Safe browser automation primitives
- ToolContext: Your connector's config and session info
- params: User-provided input for the current tool call
"""

from dataclasses import dataclass, field
from typing import Any, Callable, Optional, Awaitable, Protocol
from abc import ABC, abstractmethod
import logging

from centris_sdk.types import ExecutionMethod


# =============================================================================
# Browser Bridge Interface (Public API for Third-Party Developers)
# =============================================================================

class BrowserBridge(ABC):
    """
    Secure browser automation interface for connector developers.
    
    This is the ONLY way connectors interact with the user's browser.
    The actual implementation is provided by Centris at runtime.
    
    WHAT YOU CAN DO:
    - Navigate to URLs
    - Click elements by CSS selector
    - Type text into inputs
    - Wait for elements/navigation
    - Read page content
    - Take screenshots
    
    WHAT YOU CANNOT DO:
    - Access cookies/localStorage directly
    - Execute arbitrary JavaScript
    - Access other tabs/windows
    - Read/write files on the user's system
    - Make network requests outside the browser
    
    Example:
        async def gmail_send_email(tool_call_id, params, context):
            bridge = context.get("browser_bridge")
            
            # Navigate to Gmail (user is already logged in)
            await bridge.navigate_browser("https://mail.google.com")
            await bridge.wait(2000)
            
            # Click compose
            await bridge.click_node('[gh="cm"]')
            await bridge.wait(1000)
            
            # Fill email fields
            await bridge.input_text_node('[name="to"]', params["to"])
            await bridge.input_text_node('[name="subjectbox"]', params["subject"])
            await bridge.input_text_node('[aria-label="Message Body"]', params["body"])
            
            # Send
            await bridge.click_node('[aria-label*="Send"]')
            
            return {"success": True}
    """
    
    # =========================================================================
    # Navigation
    # =========================================================================
    
    @abstractmethod
    async def navigate_browser(self, url: str) -> dict[str, Any]:
        """
        Navigate to a URL in the active tab.
        
        Args:
            url: The URL to navigate to
            
        Returns:
            {"success": True, "url": "..."} on success
            {"success": False, "error": "..."} on failure
        """
        pass
    
    @abstractmethod
    async def get_active_tab(self) -> dict[str, Any]:
        """
        Get information about the current tab.
        
        Returns:
            {"url": "https://...", "title": "Page Title"}
        """
        pass
    
    @abstractmethod
    async def get_all_tabs(self) -> list[dict[str, Any]]:
        """
        Get information about all open tabs.
        
        Returns:
            List of {"url": "...", "title": "...", "active": bool}
        """
        pass
    
    # =========================================================================
    # DOM Interaction
    # =========================================================================
    
    @abstractmethod
    async def click_node(self, selector: str) -> dict[str, Any]:
        """
        Click an element by CSS selector.
        
        Args:
            selector: CSS selector (e.g., '[data-testid="submit"]', '#btn-send')
            
        Returns:
            {"success": True} on success
            {"success": False, "error": "Element not found"} on failure
        """
        pass
    
    @abstractmethod
    async def input_text_node(self, selector: str, text: str) -> dict[str, Any]:
        """
        Clear and type text into an input element.
        
        Args:
            selector: CSS selector for the input element
            text: Text to type
            
        Returns:
            {"success": True} on success
        """
        pass
    
    @abstractmethod
    async def type_text(self, text: str) -> dict[str, Any]:
        """
        Type text at the current cursor position.
        
        Args:
            text: Text to type
            
        Returns:
            {"success": True} on success
        """
        pass
    
    @abstractmethod
    async def press_key(self, key: str) -> dict[str, Any]:
        """
        Press a keyboard key.
        
        Args:
            key: Key to press (e.g., "Enter", "Tab", "Escape", "ArrowDown")
            
        Returns:
            {"success": True} on success
        """
        pass
    
    @abstractmethod
    async def fill_form(self, fields: dict[str, str]) -> dict[str, Any]:
        """
        Fill multiple form fields at once.
        
        Args:
            fields: Dict mapping selectors to values
                    e.g., {"#name": "John", "#email": "john@example.com"}
                    
        Returns:
            {"success": True, "filled": 2} on success
        """
        pass
    
    @abstractmethod
    async def select_option(self, selector: str, value: str) -> dict[str, Any]:
        """
        Select an option in a dropdown.
        
        Args:
            selector: CSS selector for the select element
            value: Value or visible text of the option
            
        Returns:
            {"success": True} on success
        """
        pass
    
    # =========================================================================
    # Waiting
    # =========================================================================
    
    @abstractmethod
    async def wait(self, ms: int) -> dict[str, Any]:
        """
        Wait for a specified number of milliseconds.
        
        Args:
            ms: Milliseconds to wait
            
        Returns:
            {"success": True}
        """
        pass
    
    @abstractmethod
    async def wait_for_selector(
        self, 
        selector: str, 
        timeout_ms: int = 10000
    ) -> dict[str, Any]:
        """
        Wait for an element to appear in the DOM.
        
        Args:
            selector: CSS selector to wait for
            timeout_ms: Maximum time to wait (default 10 seconds)
            
        Returns:
            {"success": True, "found": True} when element appears
            {"success": False, "error": "Timeout"} if element doesn't appear
        """
        pass
    
    @abstractmethod
    async def wait_for_navigation(self, timeout_ms: int = 30000) -> dict[str, Any]:
        """
        Wait for page navigation to complete.
        
        Args:
            timeout_ms: Maximum time to wait (default 30 seconds)
            
        Returns:
            {"success": True, "url": "..."} on success
        """
        pass
    
    # =========================================================================
    # Content
    # =========================================================================
    
    @abstractmethod
    async def get_page_content(self) -> str:
        """
        Get the text content of the current page.
        
        Returns:
            Page text content (HTML tags stripped)
        """
        pass
    
    @abstractmethod
    async def get_interactive_snapshot(self) -> dict[str, Any]:
        """
        Get a snapshot of interactive elements on the page.
        
        Returns:
            {
                "elements": [
                    {"selector": "...", "type": "button", "text": "Submit"},
                    {"selector": "...", "type": "input", "placeholder": "Email"},
                ]
            }
        """
        pass
    
    @abstractmethod
    async def scroll_page(self, direction: str = "down", amount: int = 500) -> dict[str, Any]:
        """
        Scroll the page.
        
        Args:
            direction: "up" or "down"
            amount: Pixels to scroll
            
        Returns:
            {"success": True}
        """
        pass
    
    # =========================================================================
    # Screenshots
    # =========================================================================
    
    @abstractmethod
    async def take_screenshot(self) -> dict[str, Any]:
        """
        Take a screenshot of the current page.
        
        Returns:
            {"success": True, "data": "base64...", "mime_type": "image/png"}
        """
        pass


# =============================================================================
# Types
# =============================================================================

class PluginLogger(Protocol):
    """Logger interface for plugins."""

    def debug(self, message: str) -> None: ...
    def info(self, message: str) -> None: ...
    def warn(self, message: str) -> None: ...
    def error(self, message: str) -> None: ...


@dataclass
class ToolContext:
    """
    Context passed to tool execution.
    
    The browser_bridge enables deterministic browser automation - SDK connectors
    can use the same primitives as the LLM agent but without LLM-in-loop overhead.
    
    IMPORTANT: The browser_bridge is a sandboxed interface. You cannot access
    Centris internals, user credentials, or perform system-level operations.
    
    Example:
        async def my_tool_handler(tool_call_id, params, context):
            '''Deterministic browser automation - no LLM calls.'''
            bridge = context.get("browser_bridge")
            if bridge:
                await bridge.navigate_browser("https://app.example.com")
                await bridge.wait_for_selector(".login-form")
                await bridge.input_text_node("#username", params["username"])
                await bridge.click_node("button[type=submit]")
            
            return text_result("Login successful")
    """

    config: dict[str, Any] = field(default_factory=dict)
    workspace_dir: Optional[str] = None
    connector_dir: Optional[str] = None
    connector_id: Optional[str] = None
    session_key: Optional[str] = None
    user_id: Optional[str] = None
    auth: Optional[dict[str, Any]] = None
    
    # Browser bridge for deterministic browser automation (sandboxed interface)
    # This is the key difference between SDK connectors and LLM-in-loop automation:
    # - SDK connectors: Use browser_bridge for pre-compiled, deterministic scripts
    # - LLM-in-loop: Each step requires LLM decision → snapshot → action cycle
    browser_bridge: Optional[BrowserBridge] = None


@dataclass
class ToolResult:
    """Result from tool execution."""

    content: list[dict[str, Any]]
    details: Optional[Any] = None
    is_error: bool = False


@dataclass
class CentrisTool:
    """Tool definition for Centris connectors."""

    name: str
    description: str
    parameters: dict[str, Any]  # JSON Schema
    execute: Callable[[str, dict[str, Any], Optional[ToolContext]], Awaitable[ToolResult]]
    label: Optional[str] = None


@dataclass
class ConnectorService:
    """Background service definition."""

    id: str
    start: Callable[[dict[str, Any]], Awaitable[None]]
    stop: Optional[Callable[[dict[str, Any]], Awaitable[None]]] = None


GatewayRequestHandler = Callable[[Any, dict[str, Any]], Awaitable[Any]]
CliRegistrar = Callable[[Any], None]
ToolFactory = Callable[[ToolContext], Optional[CentrisTool | list[CentrisTool]]]


# =============================================================================
# Plugin API
# =============================================================================

@dataclass
class CentrisConnectorApi:
    """
    The API surface exposed to connector developers.
    Inspired by Clawdbot's ClawdbotPluginApi.
    """

    # Identity
    id: str
    name: str
    version: Optional[str] = None
    description: Optional[str] = None
    source: str = ""

    # Config
    config: dict[str, Any] = field(default_factory=dict)
    connector_config: Optional[dict[str, Any]] = None

    # Internal storage
    _tools: list[CentrisTool | ToolFactory] = field(default_factory=list, repr=False)
    _gateway_methods: dict[str, GatewayRequestHandler] = field(default_factory=dict, repr=False)
    _cli_registrars: list[CliRegistrar] = field(default_factory=list, repr=False)
    _services: list[ConnectorService] = field(default_factory=list, repr=False)
    _logger: Optional[PluginLogger] = field(default=None, repr=False)

    @property
    def logger(self) -> PluginLogger:
        """Get the logger instance."""
        if self._logger is None:
            self._logger = _create_default_logger(self.name)
        return self._logger

    def register_tool(
        self,
        tool: CentrisTool | ToolFactory,
        *,
        name: Optional[str] = None,
        names: Optional[list[str]] = None,
    ) -> None:
        """
        Register a tool or tool factory.

        Args:
            tool: Tool definition or factory function
            name: Optional name override
            names: Optional list of name aliases
        """
        self._tools.append(tool)
        tool_name = name or (tool.name if isinstance(tool, CentrisTool) else "factory")
        self.logger.debug(f"Registered tool: {tool_name}")

    def register_gateway_method(
        self,
        method: str,
        handler: GatewayRequestHandler,
    ) -> None:
        """
        Register a gateway method handler.

        Args:
            method: Method name (e.g., 'slack.send')
            handler: Request handler function
        """
        self._gateway_methods[method] = handler
        self.logger.debug(f"Registered gateway method: {method}")

    def register_cli(
        self,
        registrar: CliRegistrar,
        *,
        commands: Optional[list[str]] = None,
    ) -> None:
        """
        Register CLI commands.

        Args:
            registrar: Function to register commands
            commands: Optional command name hints
        """
        self._cli_registrars.append(registrar)
        self.logger.debug(f"Registered CLI commands: {commands or 'unknown'}")

    def register_service(self, service: ConnectorService) -> None:
        """
        Register a background service.

        Args:
            service: Service definition
        """
        self._services.append(service)
        self.logger.debug(f"Registered service: {service.id}")

    def resolve_path(self, input_path: str) -> str:
        """
        Resolve a path relative to the connector's directory.

        Args:
            input_path: Relative path

        Returns:
            Absolute path
        """
        import os

        if os.path.isabs(input_path):
            return input_path
        if self.source:
            base_dir = os.path.dirname(self.source)
            return os.path.abspath(os.path.join(base_dir, input_path))
        return os.path.abspath(input_path)

    def get_tools(self, context: Optional[ToolContext] = None) -> list[CentrisTool]:
        """
        Get all registered tools, resolving factories.

        Args:
            context: Optional tool context for factories

        Returns:
            List of resolved tools
        """
        ctx = context or ToolContext()
        tools: list[CentrisTool] = []

        for tool_or_factory in self._tools:
            if isinstance(tool_or_factory, CentrisTool):
                tools.append(tool_or_factory)
            elif callable(tool_or_factory):
                try:
                    result = tool_or_factory(ctx)
                    if result is None:
                        continue
                    if isinstance(result, list):
                        tools.extend(result)
                    else:
                        tools.append(result)
                except Exception as e:
                    self.logger.error(f"Tool factory failed: {e}")

        return tools


def _create_default_logger(name: str) -> PluginLogger:
    """Create a default logger."""
    logger = logging.getLogger(f"centris.{name}")

    class LoggerWrapper:
        def debug(self, message: str) -> None:
            logger.debug(message)

        def info(self, message: str) -> None:
            logger.info(message)

        def warn(self, message: str) -> None:
            logger.warning(message)

        def error(self, message: str) -> None:
            logger.error(message)

    return LoggerWrapper()


# =============================================================================
# Result Builders
# =============================================================================

def text_result(text: str, is_error: bool = False) -> ToolResult:
    """Create a text result."""
    return ToolResult(
        content=[{"type": "text", "text": text}],
        is_error=is_error,
    )


def json_result(data: Any, is_error: bool = False) -> ToolResult:
    """Create a JSON result."""
    import json
    return ToolResult(
        content=[{"type": "text", "text": json.dumps(data, indent=2)}],
        details=data,
        is_error=is_error,
    )


def error_result(message: str, details: Optional[Any] = None) -> ToolResult:
    """Create an error result."""
    return ToolResult(
        content=[{"type": "text", "text": f"Error: {message}"}],
        details=details,
        is_error=True,
    )


def image_result(data: str, mime_type: str = "image/png") -> ToolResult:
    """Create an image result."""
    return ToolResult(
        content=[{"type": "image", "data": data, "mimeType": mime_type}],
    )


# =============================================================================
# Connector with Plugin API
# =============================================================================

class CentrisPluginConnector:
    """
    A connector that uses the Plugin API pattern.

    This provides a class-based alternative to the decorator-based CentrisConnector
    that matches the TypeScript SDK's plugin pattern.

    Example:
        connector = CentrisPluginConnector(
            id="my-connector",
            name="My Connector",
            description="Description",
        )

        def register(api: CentrisConnectorApi):
            api.register_tool(CentrisTool(
                name="my_tool",
                description="My tool",
                parameters={"type": "object", "properties": {}},
                execute=my_handler,
            ))

        connector.register = register
    """

    def __init__(
        self,
        *,
        id: str,
        name: str,
        description: str = "",
        version: str = "1.0.0",
    ):
        self.id = id
        self.name = name
        self.description = description
        self.version = version
        self._api: Optional[CentrisConnectorApi] = None
        self._register_fn: Optional[Callable[[CentrisConnectorApi], None]] = None

    @property
    def api(self) -> CentrisConnectorApi:
        """Get or create the connector API."""
        if self._api is None:
            self._api = CentrisConnectorApi(
                id=self.id,
                name=self.name,
                version=self.version,
                description=self.description,
            )
        return self._api

    def register(self, register_fn: Callable[[CentrisConnectorApi], None]) -> None:
        """
        Set the register function (can be used as a decorator).

        Args:
            register_fn: Function that registers tools, services, etc.
        """
        self._register_fn = register_fn
        # Call immediately
        register_fn(self.api)

    def activate(self) -> CentrisConnectorApi:
        """
        Activate the connector (for use by loaders).

        Returns:
            The connector API with all registrations.
        """
        if self._register_fn and self._api is None:
            self._register_fn(self.api)
        return self.api

    def get_tools(self, context: Optional[ToolContext] = None) -> list[CentrisTool]:
        """Get all registered tools."""
        return self.api.get_tools(context)

    def to_mcp_schema(self) -> dict[str, Any]:
        """Export as MCP-compatible schema."""
        tools = self.get_tools()
        return {
            "name": self.id,
            "version": self.version,
            "description": self.description,
            "tools": [
                {
                    "name": tool.name,
                    "description": tool.description,
                    "inputSchema": tool.parameters,
                }
                for tool in tools
            ],
        }
