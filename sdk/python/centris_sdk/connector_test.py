"""Tests for CentrisConnector class."""

import pytest
from centris_sdk.connector import CentrisConnector
from centris_sdk.types import AuthScheme, ExecutionMethod


class TestCentrisConnector:
    """Tests for connector initialization and capability registration."""

    def test_creates_with_required_fields(self):
        connector = CentrisConnector(
            connector_id="test-app",
            name="Test App",
            description="A test connector",
        )
        assert connector.card.id == "test-app"
        assert connector.card.name == "Test App"
        assert connector.card.description == "A test connector"

    def test_default_version(self):
        connector = CentrisConnector(
            connector_id="test",
            name="Test",
            description="Test",
        )
        assert connector.card.version == "1.0.0"

    def test_custom_auth_schemes(self):
        connector = CentrisConnector(
            connector_id="test",
            name="Test",
            description="Test",
            auth_schemes=[AuthScheme.API_KEY, AuthScheme.BEARER],
        )
        assert AuthScheme.API_KEY in connector.card.auth_schemes
        assert AuthScheme.BEARER in connector.card.auth_schemes

    def test_categories_and_tags(self):
        connector = CentrisConnector(
            connector_id="test",
            name="Test",
            description="Test",
            categories=["productivity", "email"],
            tags=["fast", "reliable"],
        )
        assert "productivity" in connector.card.categories
        assert "fast" in connector.card.tags


class TestCapabilityDecorator:
    """Tests for @connector.capability decorator."""

    def test_registers_capability(self):
        connector = CentrisConnector(
            connector_id="test",
            name="Test",
            description="Test",
        )

        @connector.capability(
            id="do_thing",
            name="Do Thing",
            description="Does a thing",
            input_schema={"type": "object", "properties": {"msg": {"type": "string"}}},
        )
        async def do_thing(params, context):
            return {"done": True}

        # capabilities is a list of Capability objects
        cap_ids = [cap.id for cap in connector.capabilities]
        assert "do_thing" in cap_ids
        cap = next(c for c in connector.capabilities if c.id == "do_thing")
        assert cap.name == "Do Thing"
        assert cap.description == "Does a thing"

    def test_capability_with_execution_methods(self):
        connector = CentrisConnector(
            connector_id="test",
            name="Test",
            description="Test",
        )

        @connector.capability(
            id="browser_action",
            name="Browser Action",
            description="Does browser stuff",
            input_schema={"type": "object"},
            execution_methods=[ExecutionMethod.BROWSER],
        )
        async def browser_action(params, context):
            return {"clicked": True}

        cap = next(c for c in connector.capabilities if c.id == "browser_action")
        assert ExecutionMethod.BROWSER in cap.execution_methods
