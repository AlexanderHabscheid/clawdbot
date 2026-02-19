"""
Tests for plugin API module.

Small, focused tests following Clawdbot patterns.
"""

import pytest

from centris_sdk.plugin_api import (
    CentrisPluginConnector,
    CentrisConnectorApi,
    CentrisTool,
    ToolContext,
    ToolResult,
    text_result,
    json_result,
    error_result,
    image_result,
)


class TestToolResult:
    """Tests for ToolResult dataclass."""
    
    def test_creates_tool_result(self):
        result = ToolResult(
            content=[{"type": "text", "text": "Hello"}],
            is_error=False,
        )
        assert result.is_error is False
        assert result.content[0]["text"] == "Hello"
    
    def test_error_flag(self):
        result = ToolResult(content=[], is_error=True)
        assert result.is_error is True


class TestResultBuilders:
    """Tests for result builder functions."""
    
    def test_text_result(self):
        result = text_result("Hello, World!")
        
        assert result.is_error is False
        assert len(result.content) == 1
        assert result.content[0]["type"] == "text"
        assert result.content[0]["text"] == "Hello, World!"
    
    def test_json_result(self):
        result = json_result({"key": "value"})
        
        assert result.is_error is False
        assert '"key"' in result.content[0]["text"]
        assert result.details == {"key": "value"}
    
    def test_error_result(self):
        result = error_result("Something went wrong")
        
        assert result.is_error is True
        assert "Something went wrong" in result.content[0]["text"]
    
    def test_image_result(self):
        result = image_result("base64_data", "image/png")
        
        assert result.is_error is False
        assert result.content[0]["type"] == "image"
        assert result.content[0]["mimeType"] == "image/png"


class TestCentrisTool:
    """Tests for CentrisTool dataclass."""
    
    def test_creates_tool(self):
        async def handler(tool_call_id, params, context):
            return text_result("done")
        
        tool = CentrisTool(
            name="my_tool",
            description="Does something",
            parameters={"type": "object"},
            execute=handler,
        )
        
        assert tool.name == "my_tool"
        assert tool.description == "Does something"
    
    def test_tool_with_label(self):
        async def handler(tool_call_id, params, context):
            return text_result("done")
        
        tool = CentrisTool(
            name="my_tool",
            description="Does something",
            parameters={"type": "object"},
            execute=handler,
            label="My Tool Label",
        )
        
        assert tool.label == "My Tool Label"


class TestCentrisConnectorApi:
    """Tests for CentrisConnectorApi."""
    
    def test_register_tool(self):
        api = CentrisConnectorApi(id="test-connector", name="Test")
        
        async def handler(tool_call_id, params, context):
            return text_result("done")
        
        tool = CentrisTool(
            name="my_tool",
            description="Does something",
            parameters={"type": "object"},
            execute=handler,
        )
        
        api.register_tool(tool)
        
        tools = api.get_tools(None)
        assert len(tools) == 1
        assert tools[0].name == "my_tool"
    
    def test_register_multiple_tools(self):
        api = CentrisConnectorApi(id="test-connector", name="Test")
        
        async def handler(tool_call_id, params, context):
            return text_result("done")
        
        for i in range(3):
            tool = CentrisTool(
                name=f"tool_{i}",
                description=f"Tool {i}",
                parameters={"type": "object"},
                execute=handler,
            )
            api.register_tool(tool)
        
        tools = api.get_tools(None)
        assert len(tools) == 3
    
    def test_register_tool_factory(self):
        api = CentrisConnectorApi(id="test-connector", name="Test")
        
        async def handler(tool_call_id, params, context):
            return text_result("done")
        
        def factory(context):
            return [
                CentrisTool(
                    name="dynamic_tool",
                    description="Dynamically created",
                    parameters={"type": "object"},
                    execute=handler,
                )
            ]
        
        api.register_tool(factory)
        
        tools = api.get_tools(ToolContext())
        assert len(tools) == 1
        assert tools[0].name == "dynamic_tool"


class TestCentrisPluginConnector:
    """Tests for CentrisPluginConnector."""
    
    def test_creates_connector(self):
        connector = CentrisPluginConnector(
            id="test",
            name="Test Connector",
            description="A test connector",
        )
        
        assert connector.id == "test"
        assert connector.name == "Test Connector"
    
    def test_register_decorator(self):
        connector = CentrisPluginConnector(
            id="test",
            name="Test",
            description="Test",
        )
        
        @connector.register
        def register_fn(api: CentrisConnectorApi):
            async def handler(tool_call_id, params, context):
                return text_result("done")
            
            api.register_tool(CentrisTool(
                name="my_tool",
                description="My tool",
                parameters={"type": "object"},
                execute=handler,
            ))
        
        # Register is called immediately when decorated
        assert connector._api is not None
    
    def test_activate_returns_api(self):
        connector = CentrisPluginConnector(
            id="test",
            name="Test",
            description="Test",
        )
        
        @connector.register
        def register_fn(api: CentrisConnectorApi):
            pass
        
        result = connector.activate()
        
        assert isinstance(result, CentrisConnectorApi)
    
    def test_get_tools_after_registration(self):
        connector = CentrisPluginConnector(
            id="test",
            name="Test",
            description="Test",
        )
        
        @connector.register
        def register_fn(api: CentrisConnectorApi):
            async def handler(tool_call_id, params, context):
                return text_result("done")
            
            api.register_tool(CentrisTool(
                name="my_tool",
                description="My tool",
                parameters={"type": "object"},
                execute=handler,
            ))
        
        tools = connector.get_tools(None)
        
        assert len(tools) == 1
        assert tools[0].name == "my_tool"
    
    def test_to_mcp_schema(self):
        connector = CentrisPluginConnector(
            id="test",
            name="Test Connector",
            description="Test description",
        )
        
        @connector.register
        def register_fn(api: CentrisConnectorApi):
            async def handler(tool_call_id, params, context):
                return text_result("done")
            
            api.register_tool(CentrisTool(
                name="my_tool",
                description="My tool",
                parameters={
                    "type": "object",
                    "properties": {"input": {"type": "string"}},
                },
                execute=handler,
            ))
        
        schema = connector.to_mcp_schema()
        
        assert "tools" in schema
        assert len(schema["tools"]) == 1
        assert schema["tools"][0]["name"] == "my_tool"


class TestToolContext:
    """Tests for ToolContext dataclass."""
    
    def test_creates_context(self):
        context = ToolContext(
            connector_id="test",
            user_id="user123",
        )
        
        assert context.connector_id == "test"
        assert context.user_id == "user123"
    
    def test_default_values(self):
        context = ToolContext()
        
        assert context.user_id is None
        assert context.session_key is None
        assert context.config == {}
        assert context.browser_bridge is None
