"""
Tests for CentrisConnector class.

Small, focused tests following Clawdbot patterns.
"""

import pytest
import asyncio

from centris_sdk.connector import CentrisConnector
from centris_sdk.types import ExecutionMethod, AuthScheme, ExecutionContext


class TestConnectorInit:
    """Tests for connector initialization."""
    
    def test_creates_with_minimal_args(self):
        connector = CentrisConnector(
            connector_id="test",
            name="Test",
            description="A test connector",
        )
        assert connector.id == "test"
        assert connector.name == "Test"
    
    def test_sets_default_auth_scheme(self):
        connector = CentrisConnector(
            connector_id="test",
            name="Test",
            description="Test",
        )
        assert AuthScheme.OAUTH2 in connector.card.auth_schemes
    
    def test_accepts_custom_auth_schemes(self):
        connector = CentrisConnector(
            connector_id="test",
            name="Test",
            description="Test",
            auth_schemes=[AuthScheme.API_KEY, AuthScheme.BASIC],
        )
        assert AuthScheme.API_KEY in connector.card.auth_schemes
        assert AuthScheme.BASIC in connector.card.auth_schemes
    
    def test_sets_version(self):
        connector = CentrisConnector(
            connector_id="test",
            name="Test",
            description="Test",
            version="2.0.0",
        )
        assert connector.card.version == "2.0.0"


class TestCapabilityDecorator:
    """Tests for @connector.capability decorator."""
    
    def test_registers_capability(self):
        connector = CentrisConnector(
            connector_id="test",
            name="Test",
            description="Test",
        )
        
        @connector.capability(
            id="send_message",
            name="Send Message",
            description="Send a message",
            input_schema={"type": "object"},
        )
        async def send_message(params, context):
            return {"ok": True}
        
        assert len(connector.capabilities) == 1
        assert connector.capabilities[0].id == "send_message"
    
    def test_preserves_handler_function(self):
        connector = CentrisConnector(
            connector_id="test",
            name="Test",
            description="Test",
        )
        
        @connector.capability(
            id="action",
            name="Action",
            description="Do something",
            input_schema={"type": "object"},
        )
        async def action(params, context):
            return {"result": "done"}
        
        assert "action" in connector._handlers
        assert connector._handlers["action"] is action
    
    def test_sets_default_execution_method(self):
        connector = CentrisConnector(
            connector_id="test",
            name="Test",
            description="Test",
        )
        
        @connector.capability(
            id="action",
            name="Action",
            description="Do something",
            input_schema={"type": "object"},
        )
        async def action(params, context):
            return {}
        
        cap = connector.get_capability("action")
        assert ExecutionMethod.API in cap.execution_methods
    
    def test_accepts_custom_execution_methods(self):
        connector = CentrisConnector(
            connector_id="test",
            name="Test",
            description="Test",
        )
        
        @connector.capability(
            id="browser_action",
            name="Browser Action",
            description="Do something in browser",
            input_schema={"type": "object"},
            execution_methods=[ExecutionMethod.BROWSER],
        )
        async def browser_action(params, context):
            return {}
        
        cap = connector.get_capability("browser_action")
        assert ExecutionMethod.BROWSER in cap.execution_methods


class TestContextProvider:
    """Tests for @connector.context_provider decorator."""
    
    def test_registers_context_provider(self):
        connector = CentrisConnector(
            connector_id="test",
            name="Test",
            description="Test",
        )
        
        @connector.context_provider
        def get_context():
            return {"app_state": "ready"}
        
        assert connector._context_provider is get_context
    
    def test_get_context_returns_provider_result(self):
        connector = CentrisConnector(
            connector_id="test",
            name="Test",
            description="Test",
        )
        
        @connector.context_provider
        def get_context():
            return {"current_page": "inbox"}
        
        context = connector.get_context()
        assert context == {"current_page": "inbox"}
    
    def test_get_context_returns_empty_without_provider(self):
        connector = CentrisConnector(
            connector_id="test",
            name="Test",
            description="Test",
        )
        
        context = connector.get_context()
        assert context == {}


class TestUIMapping:
    """Tests for UI element mapping."""
    
    def test_adds_ui_mapping(self):
        connector = CentrisConnector(
            connector_id="test",
            name="Test",
            description="Test",
        )
        
        connector.map_ui_element(
            selector="button.submit",
            semantic_role="submit_button",
            action="click",
        )
        
        mappings = connector.get_ui_mappings()
        assert len(mappings) == 1
        assert mappings[0].selector == "button.submit"
    
    def test_mapping_includes_context(self):
        connector = CentrisConnector(
            connector_id="test",
            name="Test",
            description="Test",
        )
        
        connector.map_ui_element(
            selector="input.email",
            semantic_role="email_input",
            action="type",
            context=["login_form", "signup_form"],
        )
        
        mappings = connector.get_ui_mappings()
        assert "login_form" in mappings[0].context


class TestExecute:
    """Tests for connector execution."""
    
    @pytest.mark.asyncio
    async def test_executes_capability(self):
        connector = CentrisConnector(
            connector_id="test",
            name="Test",
            description="Test",
        )
        
        @connector.capability(
            id="greet",
            name="Greet",
            description="Greet someone",
            input_schema={"type": "object", "properties": {"name": {"type": "string"}}},
        )
        async def greet(params, context):
            return {"message": f"Hello, {params.get('name', 'World')}!"}
        
        result = await connector.execute("greet", {"name": "Alice"})
        
        assert result.success is True
        assert result.data["message"] == "Hello, Alice!"
    
    @pytest.mark.asyncio
    async def test_returns_error_for_unknown_capability(self):
        connector = CentrisConnector(
            connector_id="test",
            name="Test",
            description="Test",
        )
        
        result = await connector.execute("nonexistent", {})
        
        assert result.success is False
        assert result.error.code == "UNKNOWN_CAPABILITY"
    
    @pytest.mark.asyncio
    async def test_captures_handler_exceptions(self):
        connector = CentrisConnector(
            connector_id="test",
            name="Test",
            description="Test",
        )
        
        @connector.capability(
            id="fail",
            name="Fail",
            description="Always fails",
            input_schema={"type": "object"},
        )
        async def fail(params, context):
            raise ValueError("Intentional failure")
        
        result = await connector.execute("fail", {})
        
        assert result.success is False
        assert result.error.code == "EXECUTION_ERROR"
        assert "Intentional failure" in result.error.message
    
    @pytest.mark.asyncio
    async def test_records_latency(self):
        connector = CentrisConnector(
            connector_id="test",
            name="Test",
            description="Test",
        )
        
        @connector.capability(
            id="quick",
            name="Quick",
            description="Quick action",
            input_schema={"type": "object"},
        )
        async def quick(params, context):
            return {"ok": True}
        
        result = await connector.execute("quick", {})
        
        assert result.metadata.latency_ms >= 0


class TestExportSchemas:
    """Tests for schema export methods."""
    
    def test_to_mcp_schema(self):
        connector = CentrisConnector(
            connector_id="test",
            name="Test Connector",
            description="Test",
        )
        
        @connector.capability(
            id="action",
            name="Action",
            description="Do something",
            input_schema={"type": "object"},
        )
        async def action(params, context):
            return {}
        
        schema = connector.to_mcp_schema()
        
        assert "tools" in schema
        assert len(schema["tools"]) == 1
    
    def test_to_agent_card(self):
        connector = CentrisConnector(
            connector_id="test",
            name="Test Connector",
            description="Test description",
        )
        
        card = connector.to_agent_card()
        
        assert card["name"] == "Test Connector"
        assert card["description"] == "Test description"
    
    def test_export_schema_includes_ui_mappings(self):
        connector = CentrisConnector(
            connector_id="test",
            name="Test",
            description="Test",
        )
        
        connector.map_ui_element(
            selector=".btn",
            semantic_role="button",
            action="click",
        )
        
        schema = connector.export_schema()
        
        assert "ui_mappings" in schema
        assert len(schema["ui_mappings"]) == 1


class TestGetCapability:
    """Tests for get_capability method."""
    
    def test_returns_capability_by_id(self):
        connector = CentrisConnector(
            connector_id="test",
            name="Test",
            description="Test",
        )
        
        @connector.capability(
            id="my_action",
            name="My Action",
            description="Does something",
            input_schema={"type": "object"},
        )
        async def my_action(params, context):
            return {}
        
        cap = connector.get_capability("my_action")
        
        assert cap is not None
        assert cap.id == "my_action"
    
    def test_returns_none_for_unknown(self):
        connector = CentrisConnector(
            connector_id="test",
            name="Test",
            description="Test",
        )
        
        cap = connector.get_capability("nonexistent")
        
        assert cap is None
