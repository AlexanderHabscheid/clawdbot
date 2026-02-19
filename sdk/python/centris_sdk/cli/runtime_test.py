"""
Tests for CLI runtime module.

Colocated test file following Clawdbot pattern.
"""

import pytest
from io import StringIO

from centris_sdk.cli.runtime import (
    RuntimeProtocol,
    DefaultRuntime,
    MockRuntime,
    StyledRuntime,
    MockExitError,
    default_runtime,
    styled_runtime,
)


class TestRuntimeProtocol:
    """Tests for RuntimeProtocol compliance."""
    
    def test_default_runtime_implements_protocol(self):
        runtime = DefaultRuntime()
        assert isinstance(runtime, RuntimeProtocol)
    
    def test_mock_runtime_implements_protocol(self):
        runtime = MockRuntime()
        assert isinstance(runtime, RuntimeProtocol)
    
    def test_styled_runtime_implements_protocol(self):
        runtime = StyledRuntime()
        assert isinstance(runtime, RuntimeProtocol)


class TestDefaultRuntime:
    """Tests for DefaultRuntime implementation."""
    
    def test_log_writes_to_stdout(self):
        stdout = StringIO()
        runtime = DefaultRuntime(stdout=stdout)
        
        runtime.log("Hello, world!")
        
        assert "Hello, world!" in stdout.getvalue()
    
    def test_error_writes_to_stderr(self):
        stderr = StringIO()
        runtime = DefaultRuntime(stderr=stderr)
        
        runtime.error("An error occurred")
        
        assert "An error occurred" in stderr.getvalue()
    
    def test_exit_calls_sys_exit(self):
        runtime = DefaultRuntime()
        
        with pytest.raises(SystemExit) as exc_info:
            runtime.exit(1)
        
        assert exc_info.value.code == 1


class TestMockRuntime:
    """Tests for MockRuntime implementation."""
    
    def test_captures_logs(self):
        runtime = MockRuntime()
        
        runtime.log("Message 1")
        runtime.log("Message 2")
        
        assert len(runtime.logs) == 2
        assert "Message 1" in runtime.logs
        assert "Message 2" in runtime.logs
    
    def test_captures_errors(self):
        runtime = MockRuntime()
        
        runtime.error("Error 1")
        runtime.error("Error 2")
        
        assert len(runtime.errors) == 2
        assert "Error 1" in runtime.errors
    
    def test_exit_raises_mock_exit_error(self):
        runtime = MockRuntime()
        
        with pytest.raises(MockExitError) as exc_info:
            runtime.exit(42)
        
        assert exc_info.value.code == 42
    
    def test_exit_captures_code(self):
        runtime = MockRuntime()
        
        try:
            runtime.exit(5)
        except MockExitError:
            pass
        
        assert runtime.exit_code == 5
    
    def test_clear_resets_state(self):
        runtime = MockRuntime()
        runtime.log("test")
        runtime.error("error")
        try:
            runtime.exit(1)
        except MockExitError:
            pass
        
        runtime.clear()
        
        assert runtime.logs == []
        assert runtime.errors == []
        assert runtime.exit_code is None
    
    def test_all_output_combines_logs_and_errors(self):
        runtime = MockRuntime()
        runtime.log("log message")
        runtime.error("error message")
        
        output = runtime.all_output
        
        assert "log message" in output
        assert "error message" in output
    
    def test_assert_logged_passes(self):
        runtime = MockRuntime()
        runtime.log("Success: operation completed")
        
        runtime.assert_logged("Success")  # Should not raise
    
    def test_assert_logged_fails(self):
        runtime = MockRuntime()
        runtime.log("Something else")
        
        with pytest.raises(AssertionError):
            runtime.assert_logged("Success")
    
    def test_assert_error_passes(self):
        runtime = MockRuntime()
        runtime.error("Failed: connection timeout")
        
        runtime.assert_error("Failed")  # Should not raise
    
    def test_assert_error_fails(self):
        runtime = MockRuntime()
        runtime.error("Something else")
        
        with pytest.raises(AssertionError):
            runtime.assert_error("Failed")
    
    def test_assert_exited_passes(self):
        runtime = MockRuntime()
        try:
            runtime.exit(0)
        except MockExitError:
            pass
        
        runtime.assert_exited(0)  # Should not raise
    
    def test_assert_exited_fails(self):
        runtime = MockRuntime()
        try:
            runtime.exit(1)
        except MockExitError:
            pass
        
        with pytest.raises(AssertionError):
            runtime.assert_exited(0)


class TestStyledRuntime:
    """Tests for StyledRuntime implementation."""
    
    def test_delegates_to_inner_runtime(self):
        mock = MockRuntime()
        styled = StyledRuntime(inner=mock)
        
        styled.log("Hello")
        
        assert "Hello" in mock.logs
    
    def test_success_adds_prefix(self):
        mock = MockRuntime()
        styled = StyledRuntime(inner=mock)
        
        styled.success("Operation completed")
        
        # Should have some styled output
        assert len(mock.logs) == 1
    
    def test_warn_adds_prefix(self):
        mock = MockRuntime()
        styled = StyledRuntime(inner=mock)
        
        styled.warn("Be careful")
        
        assert len(mock.logs) == 1
    
    def test_info_adds_prefix(self):
        mock = MockRuntime()
        styled = StyledRuntime(inner=mock)
        
        styled.info("Information")
        
        assert len(mock.logs) == 1
    
    def test_debug_adds_prefix(self):
        mock = MockRuntime()
        styled = StyledRuntime(inner=mock)
        
        styled.debug("Debug message")
        
        assert len(mock.logs) == 1
    
    def test_error_goes_to_inner_error(self):
        mock = MockRuntime()
        styled = StyledRuntime(inner=mock)
        
        styled.error("Something went wrong")
        
        assert len(mock.errors) == 1


class TestMockExitError:
    """Tests for MockExitError exception."""
    
    def test_stores_exit_code(self):
        error = MockExitError(42)
        assert error.code == 42
    
    def test_string_representation(self):
        error = MockExitError(1)
        assert "1" in str(error)


class TestModuleSingletons:
    """Tests for module-level singleton instances."""
    
    def test_default_runtime_exists(self):
        assert default_runtime is not None
        assert isinstance(default_runtime, DefaultRuntime)
    
    def test_styled_runtime_exists(self):
        assert styled_runtime is not None
        assert isinstance(styled_runtime, StyledRuntime)
