"""
Tests for CLI error handling module.

Colocated test file following Clawdbot pattern.
"""

import pytest
import sys

from centris_sdk.cli.errors import (
    ExitCode,
    CentrisCLIError,
    ConfigurationError,
    NetworkError,
    AuthenticationError,
    ValidationError,
    NotFoundError,
    TimeoutError,
    CancelledError,
    handle_cli_error,
    cli_error_handler,
    ensure,
    fail,
    with_error_handling,
)


class TestExitCode:
    """Tests for ExitCode enum."""
    
    def test_success_is_zero(self):
        assert ExitCode.SUCCESS == 0
    
    def test_general_error_is_one(self):
        assert ExitCode.GENERAL_ERROR == 1
    
    def test_cancelled_is_130(self):
        assert ExitCode.CANCELLED == 130


class TestCentrisCLIError:
    """Tests for base CentrisCLIError."""
    
    def test_basic_error(self):
        error = CentrisCLIError(message="Something went wrong")
        assert str(error) == "Something went wrong"
    
    def test_default_exit_code(self):
        error = CentrisCLIError(message="Error")
        assert error.exit_code == ExitCode.GENERAL_ERROR
    
    def test_custom_exit_code(self):
        error = CentrisCLIError(message="Error", exit_code=ExitCode.CONFIG_ERROR)
        assert error.exit_code == ExitCode.CONFIG_ERROR
    
    def test_details_dict(self):
        error = CentrisCLIError(message="Error", details={"key": "value"})
        assert error.details["key"] == "value"
    
    def test_hint(self):
        error = CentrisCLIError(message="Error", hint="Try this instead")
        assert error.hint == "Try this instead"
    
    def test_format_basic(self):
        error = CentrisCLIError(message="Error occurred")
        formatted = error.format()
        assert "Error occurred" in formatted
    
    def test_format_with_hint(self):
        error = CentrisCLIError(message="Error", hint="Run 'centris help'")
        formatted = error.format()
        assert "centris help" in formatted
    
    def test_format_verbose_shows_details(self):
        error = CentrisCLIError(message="Error", details={"path": "/test"})
        formatted = error.format(verbose=True)
        assert "/test" in formatted


class TestConfigurationError:
    """Tests for ConfigurationError."""
    
    def test_sets_config_exit_code(self):
        error = ConfigurationError("Invalid config")
        assert error.exit_code == ExitCode.CONFIG_ERROR
    
    def test_includes_config_key(self):
        error = ConfigurationError("Invalid value", config_key="api_url")
        assert error.details["config_key"] == "api_url"


class TestNetworkError:
    """Tests for NetworkError."""
    
    def test_sets_network_exit_code(self):
        error = NetworkError("Connection failed")
        assert error.exit_code == ExitCode.NETWORK_ERROR
    
    def test_includes_url(self):
        error = NetworkError("Failed", url="http://localhost:5001")
        assert error.details["url"] == "http://localhost:5001"
    
    def test_auto_generates_hint(self):
        error = NetworkError("Failed", url="http://localhost:5001")
        assert "backend" in error.hint.lower()


class TestAuthenticationError:
    """Tests for AuthenticationError."""
    
    def test_sets_auth_exit_code(self):
        error = AuthenticationError("Invalid credentials")
        assert error.exit_code == ExitCode.AUTH_ERROR
    
    def test_auto_generates_hint(self):
        error = AuthenticationError("Invalid token")
        assert "login" in error.hint.lower()


class TestValidationErrorCLI:
    """Tests for ValidationError (CLI version)."""
    
    def test_sets_validation_exit_code(self):
        error = ValidationError("Invalid input")
        assert error.exit_code == ExitCode.VALIDATION_ERROR
    
    def test_includes_field(self):
        error = ValidationError("Invalid value", field="email")
        assert error.details["field"] == "email"


class TestNotFoundError:
    """Tests for NotFoundError."""
    
    def test_sets_not_found_exit_code(self):
        error = NotFoundError("Resource not found")
        assert error.exit_code == ExitCode.NOT_FOUND
    
    def test_includes_resource_info(self):
        error = NotFoundError(
            "Connector not found",
            resource_type="connector",
            resource_id="slack",
        )
        assert error.details["type"] == "connector"
        assert error.details["id"] == "slack"


class TestTimeoutError:
    """Tests for TimeoutError."""
    
    def test_sets_timeout_exit_code(self):
        error = TimeoutError("Operation timed out")
        assert error.exit_code == ExitCode.TIMEOUT_ERROR
    
    def test_includes_timeout_seconds(self):
        error = TimeoutError("Timed out", timeout_seconds=30.0)
        assert error.details["timeout_seconds"] == 30.0


class TestCancelledError:
    """Tests for CancelledError."""
    
    def test_sets_cancelled_exit_code(self):
        error = CancelledError()
        assert error.exit_code == ExitCode.CANCELLED
    
    def test_default_message(self):
        error = CancelledError()
        assert "cancelled" in str(error).lower()


class TestHandleCliError:
    """Tests for handle_cli_error function."""
    
    def test_handles_centris_error(self, capsys):
        error = CentrisCLIError("Test error")
        
        code = handle_cli_error(error, exit_on_error=False)
        
        assert code == ExitCode.GENERAL_ERROR
        captured = capsys.readouterr()
        assert "Test error" in captured.err
    
    def test_handles_keyboard_interrupt(self, capsys):
        error = KeyboardInterrupt()
        
        code = handle_cli_error(error, exit_on_error=False)
        
        assert code == ExitCode.CANCELLED
    
    def test_handles_generic_exception(self, capsys):
        error = ValueError("Unexpected error")
        
        code = handle_cli_error(error, exit_on_error=False)
        
        assert code == ExitCode.GENERAL_ERROR
        captured = capsys.readouterr()
        assert "Unexpected error" in captured.err
    
    def test_exits_by_default(self):
        error = CentrisCLIError("Error", exit_code=42)
        
        with pytest.raises(SystemExit) as exc_info:
            handle_cli_error(error, exit_on_error=True)
        
        assert exc_info.value.code == 42


class TestCliErrorHandler:
    """Tests for cli_error_handler context manager."""
    
    def test_passes_without_error(self):
        with cli_error_handler(exit_on_error=False):
            pass  # No error
    
    def test_catches_and_handles_error(self, capsys):
        with cli_error_handler(exit_on_error=False):
            raise CentrisCLIError("Test error")
        
        captured = capsys.readouterr()
        assert "Test error" in captured.err


class TestEnsure:
    """Tests for ensure helper."""
    
    def test_passes_when_true(self):
        ensure(True, "Should not raise")
    
    def test_raises_when_false(self):
        with pytest.raises(CentrisCLIError) as exc_info:
            ensure(False, "Condition failed")
        
        assert "Condition failed" in str(exc_info.value)
    
    def test_uses_custom_error_class(self):
        with pytest.raises(NetworkError):
            ensure(False, "Network failed", error_class=NetworkError)


class TestFail:
    """Tests for fail helper."""
    
    def test_raises_error(self):
        with pytest.raises(CentrisCLIError) as exc_info:
            fail("Fatal error")
        
        assert "Fatal error" in str(exc_info.value)
    
    def test_uses_custom_error_class(self):
        with pytest.raises(AuthenticationError):
            fail("Auth required", error_class=AuthenticationError)


class TestWithErrorHandling:
    """Tests for @with_error_handling decorator."""
    
    def test_decorator_wraps_function(self):
        @with_error_handling()
        def my_command():
            return "success"
        
        # Function name preserved
        assert my_command.__name__ == "my_command"
    
    def test_handles_errors_in_decorated_function(self, capsys):
        @with_error_handling()
        def failing_command():
            raise CentrisCLIError("Decorated error")
        
        with pytest.raises(SystemExit):
            failing_command()
        
        captured = capsys.readouterr()
        assert "Decorated error" in captured.err
