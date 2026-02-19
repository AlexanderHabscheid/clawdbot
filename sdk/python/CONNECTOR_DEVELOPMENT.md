# Centris Connector Development Guide

This guide explains how to build connectors that work correctly with the Centris agent system. Follow this structure to ensure your connector's tools are automatically discovered, loaded, and available to the AI agent.

## Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        CONNECTOR LIFECYCLE                               │
├─────────────────────────────────────────────────────────────────────────┤
│  1. DISCOVERY                                                            │
│     └─ Centris scans connectors/ for connector.py files                  │
│                                                                          │
│  2. LOADING                                                              │
│     └─ Imports module, looks for `connector` export                      │
│                                                                          │
│  3. REGISTRATION                                                         │
│     └─ Calls connector.api.get_tools(context) to get Tool objects        │
│                                                                          │
│  4. EXECUTION                                                            │
│     └─ Agent calls tool.execute(tool_call_id, params, context)           │
│        Context includes browser_bridge for automation                    │
└─────────────────────────────────────────────────────────────────────────┘
```

## Required Structure

Your connector MUST follow this structure for automatic discovery:

```
connectors/
└── your-connector/
    ├── connector.py      # REQUIRED - Main connector code
    ├── connector.json    # OPTIONAL - Metadata
    └── README.md         # OPTIONAL - Documentation
```

### The `connector.py` File

This is the entry point. It MUST export a `connector` object at module level:

```python
# At the end of connector.py
connector = YourConnector()  # REQUIRED - This is what the loader finds
```

## Critical Integration Requirements

### 1. Connector Class Structure

Your connector class MUST have these attributes:

```python
from dataclasses import dataclass, field
from typing import List

@dataclass
class YourConnector:
    """Your connector description."""

    # REQUIRED: Unique identifier (snake_case, no spaces)
    id: str = "your-connector"

    # REQUIRED: Display name
    name: str = "Your Connector"

    # REQUIRED: Version string
    version: str = "1.0.0"

    # REQUIRED: Short description
    description: str = "What this connector does"

    # REQUIRED: API object with get_tools() method
    api: YourConnectorApi = field(default_factory=YourConnectorApi)

    # OPTIONAL: URL patterns for routing
    url_patterns: List[str] = field(default_factory=lambda: [
        r"your-domain\.com"
    ])
```

### 2. The API Class

Your API class MUST implement `get_tools(context)`:

```python
class YourConnectorApi:
    """API for tool registration - THIS IS HOW TOOLS ARE DISCOVERED."""

    def __init__(self):
        # Optional: for gateway methods and services
        self._gateway_methods = {}
        self._services = []

    def get_tools(self, context=None) -> List[Tool]:
        """
        CRITICAL: This method is called by ConnectorManager to discover tools.

        Args:
            context: ToolContext with connector_id and config (may be None)

        Returns:
            List of Tool objects that will be registered with the agent system
        """
        return [
            Tool(
                name="your_connector_action",
                description="What this tool does",
                parameters={...},  # JSON Schema
                execute=your_action_function,
            ),
            # Add more tools...
        ]
```

### 3. Tool Definition

Each tool requires:

```python
from dataclasses import dataclass, field
from typing import Dict, Any, List, Optional, Callable

@dataclass
class Tool:
    """Tool definition for Centris registry."""

    # REQUIRED: Unique name (snake_case, prefix with connector name)
    name: str

    # REQUIRED: Description for LLM (be specific about what it does)
    description: str

    # REQUIRED: JSON Schema for parameters
    parameters: Dict[str, Any]

    # REQUIRED: Async function that executes the tool
    execute: Callable

    # OPTIONAL: Display label
    label: Optional[str] = None

    # OPTIONAL: Tags for categorization
    tags: List[str] = field(default_factory=list)
```

### 4. Execute Function Signature (CRITICAL)

Your execute functions MUST have this exact signature:

```python
async def your_tool_function(
    tool_call_id: str,
    params: Dict[str, Any],
    context: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Execute your tool.

    Args:
        tool_call_id: Unique identifier for this specific tool call
        params: Parameters from the LLM (matches your JSON Schema)
        context: Runtime context containing:
            - browser_bridge: BrowserBridge for browser automation
            - user_id: Current user ID (if available)

    Returns:
        Dict with:
            - success: bool - Whether the operation succeeded
            - result/message: str - Result data or message
            - error: str - Error message if success=False
    """
    # Get browser bridge for automation
    browser_bridge = context.get("browser_bridge") if context else None

    if not browser_bridge:
        return {
            "success": False,
            "error": "Browser bridge not available"
        }

    try:
        # Your automation logic here
        await browser_bridge.navigate_browser("https://your-site.com")
        await browser_bridge.click_node('[data-testid="button"]')

        return {
            "success": True,
            "message": "Operation completed"
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }
```

### 5. Parameter Schema (JSON Schema)

Define parameters using JSON Schema:

```python
parameters = {
    "type": "object",
    "properties": {
        "required_param": {
            "type": "string",
            "description": "A required parameter"
        },
        "optional_param": {
            "type": "integer",
            "description": "An optional parameter",
            "default": 10
        },
        "enum_param": {
            "type": "string",
            "enum": ["option1", "option2", "option3"],
            "description": "One of the predefined options"
        }
    },
    "required": ["required_param"]
}
```

## Complete Example

Here's a complete, working connector:

```python
"""
Example Connector for Centris

This connector demonstrates the required structure for integration
with the Centris agent system.
"""

import logging
from dataclasses import dataclass, field
from typing import Dict, Any, List, Optional, Callable

logger = logging.getLogger(__name__)


# =============================================================================
# SELECTORS - Domain knowledge for fast automation
# =============================================================================

class ExampleSelectors:
    """DOM selectors - the knowledge that makes automation fast."""
    SEARCH_INPUT = '[data-testid="search-input"]'
    SEARCH_BUTTON = '[data-testid="search-button"]'
    RESULT_ITEM = '.search-result-item'


class ExampleURLs:
    """URL patterns."""
    BASE = "https://example.com"

    @classmethod
    def is_example(cls, url: str) -> bool:
        return "example.com" in url


# =============================================================================
# TOOL IMPLEMENTATIONS - Async functions with correct signature
# =============================================================================

async def example_search(
    tool_call_id: str,
    params: Dict[str, Any],
    context: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Search on example.com.

    This is a compiled recipe - deterministic steps that execute
    10x faster than LLM-in-loop screenshot analysis.
    """
    browser_bridge = context.get("browser_bridge") if context else None

    if not browser_bridge:
        return {
            "success": False,
            "error": "Browser bridge not available. Ensure Centris app is running."
        }

    query = params.get("query", "")

    if not query:
        return {
            "success": False,
            "error": "Query parameter is required"
        }

    try:
        logger.info(f"[Example] Searching for: {query}")

        # Navigate to site
        await browser_bridge.navigate_browser(ExampleURLs.BASE)
        await browser_bridge.wait(2000)

        # Enter search query
        await browser_bridge.input_text_node(ExampleSelectors.SEARCH_INPUT, query)
        await browser_bridge.wait(300)

        # Click search
        await browser_bridge.click_node(ExampleSelectors.SEARCH_BUTTON)
        await browser_bridge.wait(2000)

        logger.info(f"[Example] Search completed for: {query}")

        return {
            "success": True,
            "message": f"Searched for: {query}",
            "query": query
        }

    except Exception as e:
        logger.error(f"[Example] Search failed: {e}")
        return {
            "success": False,
            "error": str(e)
        }


# =============================================================================
# TOOL DEFINITION - Standard dataclass
# =============================================================================

@dataclass
class Tool:
    """Tool definition for Centris registry."""
    name: str
    description: str
    parameters: Dict[str, Any]
    execute: Callable
    label: Optional[str] = None
    tags: List[str] = field(default_factory=list)


# =============================================================================
# API CLASS - REQUIRED for tool discovery
# =============================================================================

class ExampleConnectorApi:
    """
    API for tool registration.

    CRITICAL: The get_tools() method is called by ConnectorManager
    to discover and register your tools with the agent system.
    """

    def __init__(self):
        self._gateway_methods: Dict[str, Callable] = {}
        self._services: List[Any] = []

    def get_tools(self, context: Any = None) -> List[Tool]:
        """
        Return all tools provided by this connector.

        This is called during connector loading to register tools
        with the Centris agent system.
        """
        return [
            Tool(
                name="example_search",
                label="Example Search",
                description="Search on example.com. Uses browser automation - no API key needed.",
                parameters={
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "The search query"
                        }
                    },
                    "required": ["query"]
                },
                execute=example_search,
                tags=["search", "example"]
            ),
            # Add more tools here...
        ]


# =============================================================================
# CONNECTOR CLASS - Main export
# =============================================================================

@dataclass
class ExampleConnector:
    """
    Example connector demonstrating Centris integration.

    Required attributes:
        - id: Unique identifier
        - name: Display name
        - version: Semver string
        - description: Short description
        - api: API object with get_tools() method
    """

    id: str = "example"
    name: str = "Example"
    version: str = "1.0.0"
    description: str = "Example connector for demonstration"

    # CRITICAL: This api object's get_tools() method is called during loading
    api: ExampleConnectorApi = field(default_factory=ExampleConnectorApi)

    # URL patterns for routing (optional)
    url_patterns: List[str] = field(default_factory=lambda: [
        r"example\.com"
    ])


# =============================================================================
# MODULE EXPORT - REQUIRED for discovery
# =============================================================================

# This is what ConnectorManager.load() looks for
connector = ExampleConnector()

__all__ = ["connector", "ExampleConnector", "ExampleSelectors"]
```

## Browser Bridge API Reference

The `browser_bridge` in context provides these methods:

### Navigation

```python
# Navigate to URL
await browser_bridge.navigate_browser(url: str)

# Get current tab info
tab = await browser_bridge.get_active_tab()
# Returns: {"url": "...", "title": "..."}
```

### Clicking

```python
# Click by node ID (from Chrome extension)
await browser_bridge.click_node(node_id: int)

# Click by CSS selector
await browser_bridge.click_node(selector: str)
```

### Typing

```python
# Type into specific element
await browser_bridge.input_text_node(selector: str, text: str)

# Type at current focus
await browser_bridge.type_text(text: str)

# Press keyboard key
await browser_bridge.press_key(key: str)  # "Enter", "Tab", "Escape", etc.
```

### Waiting

```python
# Wait for time (milliseconds)
await browser_bridge.wait(ms: int)

# Wait for selector to appear
await browser_bridge.wait_for_selector(selector: str, timeout: int = 5000)
```

### Reading

```python
# Get page text content
content = await browser_bridge.get_page_content()

# Get interactive elements snapshot
snapshot = await browser_bridge.get_interactive_snapshot()
```

## Naming Conventions

1. **Connector ID**: `snake-case` (e.g., `yc-application`, `google-docs`)
2. **Tool Names**: `{connector_prefix}_{action}` (e.g., `yc_fill_application`, `gmail_send_email`)
3. **Class Names**: `PascalCase` (e.g., `YCApplicationConnector`)

## Testing Your Connector

### 1. Quick Mock Test

```bash
cd connectors/your-connector
centris test .
```

### 2. Real Browser Test

```bash
centris test . --browser --headed
```

### 3. Integration Test

```python
# test_connector.py
import asyncio
from your_connector.connector import connector

async def test_tools_are_registered():
    """Verify tools are properly structured."""
    api = connector.api
    tools = api.get_tools(None)

    assert len(tools) > 0, "No tools registered"

    for tool in tools:
        assert tool.name, "Tool missing name"
        assert tool.description, "Tool missing description"
        assert tool.parameters, "Tool missing parameters"
        assert callable(tool.execute), "Tool execute must be callable"

        # Verify async
        import inspect
        assert inspect.iscoroutinefunction(tool.execute), \
            f"Tool {tool.name} execute must be async"

if __name__ == "__main__":
    asyncio.run(test_tools_are_registered())
```

## Common Issues

### Tools Not Appearing

1. **No `connector` export**: Ensure `connector = YourConnector()` at module level
2. **Missing `api` attribute**: Connector must have `api` with `get_tools()` method
3. **Global not set**: Ensure ConnectorManager sets the global (this is handled by Centris)

### Execute Function Errors

1. **Not async**: Execute functions MUST be `async def`
2. **Wrong signature**: Must be `(tool_call_id, params, context)`
3. **Missing context check**: Always check `if context` before accessing `browser_bridge`

### Parameter Schema Issues

1. **Invalid JSON Schema**: Use online validators to check your schema
2. **Missing `type: object`**: Top-level parameters must be an object
3. **Missing `required`**: List required parameters explicitly

## Checklist

Before publishing, verify:

- [ ] `connector.py` exports a `connector` object at module level
- [ ] Connector has `id`, `name`, `version`, `description`, `api` attributes
- [ ] `api.get_tools(context)` returns list of Tool objects
- [ ] All execute functions are `async def`
- [ ] Execute functions have signature `(tool_call_id, params, context)`
- [ ] Tool names are prefixed with connector name (e.g., `myapp_action`)
- [ ] Parameter schemas are valid JSON Schema
- [ ] Tools handle missing `browser_bridge` gracefully
- [ ] `centris test .` passes
- [ ] `centris test . --browser` passes (if using browser automation)
