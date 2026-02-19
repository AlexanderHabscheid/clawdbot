"""
Centris SDK Type Definitions

Core types and enums used throughout the SDK.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Optional, TypeVar, Generic


class ExecutionMethod(Enum):
    """Supported execution methods for capabilities."""

    API = "api"  # Direct API call
    BROWSER = "browser"  # Browser automation
    DESKTOP = "desktop"  # Native desktop app
    HYBRID = "hybrid"  # Multiple methods available


class AuthScheme(Enum):
    """Supported authentication schemes."""

    OAUTH2 = "oauth2"
    API_KEY = "apikey"
    BEARER = "bearer"
    BASIC = "basic"
    NONE = "none"


@dataclass
class OAuthConfig:
    """OAuth 2.0 configuration."""

    authorization_url: str
    token_url: str
    scopes: list[str]
    client_id: Optional[str] = None
    client_secret: Optional[str] = None


@dataclass
class UIMapping:
    """Maps a UI element to a semantic action for browser automation."""

    selector: str
    semantic_role: str
    action: str
    context: list[str] = field(default_factory=list)


# =============================================================================
# FEB 2026: Extended DOM Handling for Dynamic Websites
# =============================================================================

class SelectorStrategy(Enum):
    """Strategy for finding elements when primary selector fails."""
    
    CSS = "css"           # Standard CSS selector
    XPATH = "xpath"       # XPath selector
    TEXT = "text"         # Find by text content
    ARIA = "aria"         # Find by ARIA labels/roles
    DATA_ATTR = "data"    # Find by data-* attributes (e.g., data-testid)
    VISUAL = "visual"     # Visual grounding (screenshot comparison)


@dataclass
class SemanticSelector:
    """
    Semantic selector for dynamic DOMs where IDs change but meaning is stable.
    
    Companies building connectors for their dynamic apps can define:
    - Multiple selector strategies in priority order
    - Fallbacks when primary selector fails
    - Wait conditions for async loading
    
    Example:
        selector = SemanticSelector(
            name="compose_email_button",
            strategies=[
                ("data", "[data-testid='compose']"),       # Try data-testid first
                ("aria", "[aria-label='Compose']"),        # Then ARIA
                ("text", "//button[contains(., 'Compose')]"),  # Then text
                ("css", ".compose-btn, #compose-button"),  # Then CSS
            ],
            wait_for="visible",  # Wait until element is visible
            timeout_ms=5000,
        )
    """
    
    name: str                                              # Semantic name (e.g., "submit_button")
    strategies: list[tuple[str, str]]                      # [(strategy, selector), ...] in priority order
    wait_for: str = "exists"                               # "exists", "visible", "clickable"
    timeout_ms: int = 5000                                 # How long to wait
    validation_selector: Optional[str] = None              # Verify action succeeded
    on_not_found: str = "scroll"                           # "scroll", "fail", "screenshot"


@dataclass 
class DynamicDOMConfig:
    """
    Configuration for handling fully dynamic DOMs.
    
    For companies whose websites have:
    - Client-side rendering (React/Vue/Angular SPAs)
    - Real-time updates (chat, dashboards, feeds)
    - Dynamic element IDs
    - Infinite scroll
    
    Example:
        config = DynamicDOMConfig(
            ready_when={
                "type": "selector",
                "value": ".app-loaded, [data-ready='true']"
            },
            mutation_strategy="requery",  # Re-find elements after DOM changes
            scroll_strategy="infinite",   # Handle infinite scroll
            shadow_dom_roots=["my-component", "custom-widget"],
            iframe_map={
                "payment_frame": "iframe#payment",
                "chat_widget": "iframe.intercom"
            },
            rate_limit_ms=500,  # Delay between actions to avoid detection
        )
    """
    
    # Page ready detection
    ready_when: dict[str, str] = field(default_factory=lambda: {
        "type": "event",
        "value": "load"
    })
    
    # How to handle DOM mutations mid-task
    mutation_strategy: str = "requery"  # "requery", "abort", "retry"
    
    # Infinite scroll handling
    scroll_strategy: str = "none"  # "none", "infinite", "paginated"
    
    # Shadow DOM roots to penetrate
    shadow_dom_roots: list[str] = field(default_factory=list)
    
    # iframe navigation map
    iframe_map: dict[str, str] = field(default_factory=dict)
    
    # Rate limiting for bot detection avoidance
    rate_limit_ms: int = 0
    
    # Visual anchors (reference screenshots for visual AI)
    visual_anchors: dict[str, str] = field(default_factory=dict)  # name -> image_path


@dataclass
class ConnectorBrowserConfig:
    """
    Complete browser automation config for a connector.
    
    This is what a company provides when building a connector
    for their dynamic website that doesn't have an API.
    
    Combines:
    - Semantic selectors (survive DOM changes)
    - Dynamic DOM handling (SPAs, real-time apps)
    - Fallback strategies
    """
    
    # Element mappings - stable across DOM changes
    semantic_selectors: list[SemanticSelector] = field(default_factory=list)
    
    # Dynamic DOM handling
    dom_config: Optional[DynamicDOMConfig] = None
    
    # Fallback to live DOM discovery
    fallback_to_live_dom: bool = True
    
    # Custom JavaScript to inject (for complex apps)
    inject_helpers: Optional[str] = None


@dataclass
class ExecutionContext:
    """Context passed to capability handlers during execution."""

    user_id: str
    session_id: str
    access_token: Optional[str] = None
    refresh_token: Optional[str] = None
    preferences: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)


T = TypeVar("T")


@dataclass
class ExecutionResult(Generic[T]):
    """Result from executing a capability."""

    success: bool
    data: Optional[T] = None
    error: Optional["ErrorDetails"] = None
    metadata: Optional["ResponseMetadata"] = None


@dataclass
class ErrorDetails:
    """Details about an execution error."""

    code: str
    message: str
    details: Optional[Any] = None
    retryable: bool = False


@dataclass
class ResponseMetadata:
    """Metadata about the execution."""

    execution_method: ExecutionMethod
    latency_ms: int
    retry_count: int = 0


@dataclass
class ConnectorCard:
    """
    Describes a connector's identity and capabilities.
    Inspired by Google A2A AgentCard pattern.
    """

    # Identity
    id: str
    name: str
    description: str
    version: str

    # Provider info
    provider: str
    provider_url: Optional[str] = None
    support_email: Optional[str] = None

    # Capabilities (populated during registration)
    capabilities: list["Capability"] = field(default_factory=list)

    # Authentication
    auth_schemes: list[AuthScheme] = field(default_factory=list)
    oauth_config: Optional[OAuthConfig] = None

    # Categorization
    categories: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)

    # Metadata
    icon_url: Optional[str] = None
    documentation_url: Optional[str] = None

    def to_mcp_schema(self) -> dict[str, Any]:
        """Export as MCP-compatible tool schema."""
        return {
            "name": self.id,
            "description": self.description,
            "version": self.version,
            "tools": [
                {
                    "name": f"{self.id}.{cap.id}",
                    "description": cap.description,
                    "inputSchema": cap.input_schema,
                    "outputSchema": cap.output_schema,
                }
                for cap in self.capabilities
            ],
        }

    def to_agent_card(self) -> dict[str, Any]:
        """Export as A2A-compatible AgentCard."""
        return {
            "name": self.name,
            "description": self.description,
            "url": f"https://connectors.centris.ai/{self.id}",
            "version": self.version,
            "capabilities": {
                "streaming": True,
                "pushNotifications": False,
                "stateTransitionHistory": True,
            },
            "authentication": {"schemes": [s.value for s in self.auth_schemes]},
            "defaultInputModes": ["text"],
            "defaultOutputModes": ["text"],
            "skills": [
                {
                    "id": cap.id,
                    "name": cap.name,
                    "description": cap.description,
                    "examples": cap.examples,
                    "tags": cap.tags,
                }
                for cap in self.capabilities
            ],
        }


# Import Capability here to avoid circular import
from centris_sdk.capability import Capability  # noqa: E402
