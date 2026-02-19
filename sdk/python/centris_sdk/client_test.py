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
from centris_sdk.kernel import KernelObserveRequest
from centris_sdk.action_api import (
    ActionRouteRecordStartRequest,
    ActionRouteRecordStopRequest,
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


class _FakeResponse:
    def __init__(self, payload: dict, status_code: int = 200):
        self._payload = payload
        self.status_code = status_code

    def json(self):
        return self._payload


class _FakeHttpClient:
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []

    def post(self, url, headers=None, json=None):
        self.calls.append((url, headers, json))
        return self._responses.pop(0)

    def close(self):
        return None


class TestActionApiClient:
    def test_observe_dispatches_action_api(self):
        fake_http = _FakeHttpClient(
            [
                _FakeResponse(
                    {
                        "specVersion": "2026-02-19",
                        "method": "observe",
                        "ok": True,
                        "result": {"url": "https://example.com", "interactive": []},
                    }
                )
            ]
        )

        client = Centris(api_key="ck_test", base_url="https://api.example.com")
        client._client = fake_http  # type: ignore[assignment]

        result = client.observe(KernelObserveRequest(url="https://example.com"))
        assert result.url == "https://example.com"
        assert fake_http.calls[0][0].endswith("/api/v1/action")
        assert fake_http.calls[0][2]["method"] == "observe"

    def test_route_record_start_stop(self):
        fake_http = _FakeHttpClient(
            [
                _FakeResponse(
                    {
                        "specVersion": "2026-02-19",
                        "method": "route.record.start",
                        "ok": True,
                        "result": {"ok": True, "sessionId": "sess_123"},
                    }
                ),
                _FakeResponse(
                    {
                        "specVersion": "2026-02-19",
                        "method": "route.record.stop",
                        "ok": True,
                        "result": {"ok": True, "routeId": "download_invoice"},
                    }
                ),
            ]
        )

        client = Centris(api_key="ck_test", base_url="https://api.example.com")
        client._client = fake_http  # type: ignore[assignment]

        start = client.route_record_start(ActionRouteRecordStartRequest(intent="download_invoice"))
        stop = client.route_record_stop(ActionRouteRecordStopRequest(session_id=start.session_id))

        assert start.ok is True
        assert start.session_id == "sess_123"
        assert stop.ok is True
        assert stop.route_id == "download_invoice"
