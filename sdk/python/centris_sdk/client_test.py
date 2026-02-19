"""Tests for Centris client."""

import pytest
from unittest.mock import patch

from centris_sdk.client import (
    Centris,
    CentrisResult,
    CentrisUsage,
    CentrisError,
    AuthenticationError,
    RateLimitError,
)


class TestCentrisClient:
    """Tests for Centris client initialization."""

    def test_creates_with_api_key(self):
        client = Centris(api_key="ck_live_test123")
        assert client.api_key == "ck_live_test123"

    def test_creates_with_env_api_key(self):
        with patch.dict("os.environ", {"CENTRIS_API_KEY": "ck_env_key"}):
            client = Centris()
            assert client.api_key == "ck_env_key"

    def test_local_mode(self):
        client = Centris(local=True)
        assert client.local is True


class TestCentrisResult:
    """Tests for CentrisResult class."""

    def test_result_properties(self):
        result = CentrisResult(
            task_id="task-123",
            status="completed",
            text="Hello world",
            actions=[{"action": "type", "target": "input"}],
        )
        assert result.text == "Hello world"
        assert result.success is True
        assert result.task_id == "task-123"
        assert len(result.actions) == 1

    def test_result_failed_status(self):
        result = CentrisResult(
            task_id="task-456",
            status="failed",
            text="",
            actions=[],
            error="Something went wrong",
        )
        assert result.success is False
        assert result.error == "Something went wrong"

    def test_result_str_representation(self):
        result = CentrisResult(task_id="t1", status="completed", text="Done", actions=[])
        assert str(result) == "Done"

        failed = CentrisResult(task_id="t2", status="failed", text="", actions=[], error="Oops")
        assert "Error" in str(failed)


class TestCentrisUsage:
    """Tests for CentrisUsage class."""

    def test_usage_properties(self):
        usage = CentrisUsage(
            tier="pro",
            tasks_remaining=50,
            monthly_limit=100,
            daily_bonus=10,
            tasks_used_today=5,
        )
        assert usage.tier == "pro"
        assert usage.tasks_remaining == 50


class TestCentrisErrors:
    """Tests for error classes."""

    def test_centris_error(self):
        err = CentrisError("Something went wrong")
        assert str(err) == "Something went wrong"

    def test_centris_error_with_code(self):
        err = CentrisError("Failed", code="ERR_001", task_id="task-123")
        assert err.code == "ERR_001"
        assert err.task_id == "task-123"

    def test_authentication_error(self):
        err = AuthenticationError("Invalid API key")
        assert isinstance(err, CentrisError)
        assert "Invalid API key" in str(err)

    def test_rate_limit_error(self):
        err = RateLimitError("Rate limit exceeded")
        assert isinstance(err, CentrisError)
