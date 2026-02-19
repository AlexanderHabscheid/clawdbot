"""
Tests for Centris client module.

Small, focused tests following Clawdbot patterns.
"""

import pytest
from unittest.mock import MagicMock, patch

from centris_sdk.client import (
    Centris,
    CentrisResult,
    CentrisUsage,
    CentrisError,
    AuthenticationError,
    RateLimitError,
    do,
)


class TestCentrisResult:
    """Tests for CentrisResult dataclass."""
    
    def test_success_property_when_completed(self):
        result = CentrisResult(
            task_id="t1",
            status="completed",
            text="Done",
            actions=[],
        )
        assert result.success is True
    
    def test_success_property_when_failed(self):
        result = CentrisResult(
            task_id="t1",
            status="failed",
            text="",
            actions=[],
            error="Something went wrong",
        )
        assert result.success is False
    
    def test_str_returns_text_on_success(self):
        result = CentrisResult(
            task_id="t1",
            status="completed",
            text="Hello world",
            actions=[],
        )
        assert str(result) == "Hello world"
    
    def test_str_returns_error_on_failure(self):
        result = CentrisResult(
            task_id="t1",
            status="failed",
            text="",
            actions=[],
            error="Oops",
        )
        assert "Error: Oops" in str(result)


class TestCentrisUsage:
    """Tests for CentrisUsage dataclass."""
    
    def test_usage_fields(self):
        usage = CentrisUsage(
            tier="pro",
            tasks_remaining=100,
            monthly_limit=1000,
            daily_bonus=10,
            tasks_used_today=5,
        )
        assert usage.tier == "pro"
        assert usage.tasks_remaining == 100


class TestCentrisErrors:
    """Tests for error classes."""
    
    def test_centris_error_basic(self):
        error = CentrisError("Something failed")
        assert str(error) == "Something failed"
        assert error.code is None
        assert error.task_id is None
    
    def test_centris_error_with_code(self):
        error = CentrisError("Auth failed", code="AUTH_ERROR", task_id="t123")
        assert error.code == "AUTH_ERROR"
        assert error.task_id == "t123"
    
    def test_authentication_error_inherits(self):
        error = AuthenticationError("Invalid key")
        assert isinstance(error, CentrisError)
    
    def test_rate_limit_error_inherits(self):
        error = RateLimitError("Too many requests")
        assert isinstance(error, CentrisError)


class TestCentrisInit:
    """Tests for Centris client initialization."""
    
    def test_uses_provided_api_key(self, clean_env):
        client = Centris(api_key="ck_test_123")
        assert client.api_key == "ck_test_123"
    
    def test_falls_back_to_env_var(self, mock_env):
        client = Centris()
        assert client.api_key == "ck_test_mock_key_123"
    
    def test_defaults_to_test_key_when_no_key(self, clean_env):
        client = Centris()
        assert client.api_key == "ck_test_local"
    
    def test_local_mode_sets_base_url_to_none(self, clean_env):
        client = Centris(local=True)
        assert client.local is True
        assert client.base_url is None
    
    def test_respects_timeout(self, mock_env):
        client = Centris(timeout=30.0)
        assert client.timeout == 30.0
    
    def test_uses_custom_base_url(self, mock_env):
        client = Centris(base_url="https://custom.api.com/")
        assert client.base_url == "https://custom.api.com"  # trailing slash stripped


class TestCentrisDo:
    """Tests for Centris.do() method."""
    
    def test_do_returns_result(self, mock_env, mock_httpx_client, mock_response):
        with patch("centris_sdk.client.httpx.Client", return_value=mock_httpx_client):
            mock_httpx_client.post.return_value = mock_response
            
            client = Centris()
            result = client.do("Test command")
            
            assert result.status == "completed"
            assert result.task_id == "ctask_test123"
    
    def test_do_raises_auth_error_on_401(self, mock_env, mock_httpx_client, mock_response):
        mock_response.status_code = 401
        mock_response.json.return_value = {"error": "Invalid API key"}
        
        with patch("centris_sdk.client.httpx.Client", return_value=mock_httpx_client):
            mock_httpx_client.post.return_value = mock_response
            
            client = Centris()
            with pytest.raises(AuthenticationError):
                client.do("Test command")
    
    def test_do_raises_rate_limit_on_429(self, mock_env, mock_httpx_client, mock_response):
        mock_response.status_code = 429
        mock_response.json.return_value = {"error": "Rate limit exceeded"}
        
        with patch("centris_sdk.client.httpx.Client", return_value=mock_httpx_client):
            mock_httpx_client.post.return_value = mock_response
            
            client = Centris()
            with pytest.raises(RateLimitError):
                client.do("Test command")
    
    def test_do_raises_error_on_failed_status(self, mock_env, mock_httpx_client, mock_response):
        mock_response.status_code = 200
        mock_response.json.return_value = {"status": "failed", "error": "Command failed"}
        
        with patch("centris_sdk.client.httpx.Client", return_value=mock_httpx_client):
            mock_httpx_client.post.return_value = mock_response
            
            client = Centris()
            with pytest.raises(CentrisError):
                client.do("Test command")


class TestCentrisWait:
    """Tests for Centris.wait() method."""
    
    def test_wait_returns_on_completed(self, mock_env, mock_httpx_client, mock_response):
        with patch("centris_sdk.client.httpx.Client", return_value=mock_httpx_client):
            mock_httpx_client.get.return_value = mock_response
            
            client = Centris()
            result = client.wait("ctask_test123")
            
            assert result.status == "completed"
    
    def test_wait_raises_on_failed(self, mock_env, mock_httpx_client, mock_response):
        mock_response.json.return_value = {"status": "failed", "error": "Task failed"}
        
        with patch("centris_sdk.client.httpx.Client", return_value=mock_httpx_client):
            mock_httpx_client.get.return_value = mock_response
            
            client = Centris()
            with pytest.raises(CentrisError) as exc_info:
                client.wait("ctask_test123")
            
            assert "Task failed" in str(exc_info.value)


class TestCentrisContextManager:
    """Tests for context manager protocol."""
    
    def test_context_manager_closes_client(self, mock_env, mock_httpx_client):
        with patch("centris_sdk.client.httpx.Client", return_value=mock_httpx_client):
            with Centris() as client:
                assert client._client is not None
            
            mock_httpx_client.close.assert_called_once()


class TestDoConvenienceFunction:
    """Tests for the do() convenience function."""
    
    def test_do_function_creates_client(self, mock_env, mock_httpx_client, mock_response):
        with patch("centris_sdk.client.httpx.Client", return_value=mock_httpx_client):
            mock_httpx_client.post.return_value = mock_response
            
            result = do("Test command")
            
            assert result.status == "completed"
    
    def test_do_function_accepts_api_key(self, clean_env, mock_httpx_client, mock_response):
        with patch("centris_sdk.client.httpx.Client", return_value=mock_httpx_client):
            mock_httpx_client.post.return_value = mock_response
            
            result = do("Test", api_key="ck_custom_key")
            
            assert result is not None
