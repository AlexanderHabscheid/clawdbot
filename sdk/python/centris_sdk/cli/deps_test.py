"""
Tests for CLI dependency injection module.

Colocated test file following Clawdbot pattern.
"""

import pytest
import tempfile
from pathlib import Path

from centris_sdk.cli.deps import (
    RuntimeEnv,
    DefaultRuntime,
    MockRuntime,
    CLIDeps,
    DefaultConsole,
    DefaultConfigLoader,
    DefaultBackendClient,
    DefaultFileSystem,
    create_default_deps,
    CURRENT_CONFIG_VERSION,
    run_config_migrations,
)


class TestRuntimeEnv:
    """Tests for RuntimeEnv protocol compliance."""
    
    def test_default_runtime_implements_protocol(self):
        runtime = DefaultRuntime()
        assert isinstance(runtime, RuntimeEnv)
    
    def test_mock_runtime_implements_protocol(self):
        runtime = MockRuntime()
        assert isinstance(runtime, RuntimeEnv)


class TestDefaultRuntime:
    """Tests for DefaultRuntime in deps module."""
    
    def test_log_prints_message(self, capsys):
        runtime = DefaultRuntime(use_theme=False)
        runtime.log("Test message")
        
        captured = capsys.readouterr()
        assert "Test message" in captured.out
    
    def test_error_prints_to_stderr(self, capsys):
        runtime = DefaultRuntime(use_theme=False)
        runtime.error("Error occurred")
        
        captured = capsys.readouterr()
        assert "Error occurred" in captured.err
    
    def test_warn_prints_warning(self, capsys):
        runtime = DefaultRuntime(use_theme=False)
        runtime.warn("Be careful")
        
        captured = capsys.readouterr()
        assert "Be careful" in captured.out
    
    def test_success_prints_success(self, capsys):
        runtime = DefaultRuntime(use_theme=False)
        runtime.success("Done")
        
        captured = capsys.readouterr()
        assert "Done" in captured.out


class TestMockRuntime:
    """Tests for MockRuntime in deps module."""
    
    def test_captures_logs(self):
        runtime = MockRuntime()
        runtime.log("Message 1")
        runtime.log("Message 2")
        
        assert "Message 1" in runtime.logs
        assert "Message 2" in runtime.logs
    
    def test_captures_errors(self):
        runtime = MockRuntime()
        runtime.error("Error 1")
        
        assert "Error 1" in runtime.errors
    
    def test_captures_warnings(self):
        runtime = MockRuntime()
        runtime.warn("Warning 1")
        
        assert "Warning 1" in runtime.warnings
    
    def test_captures_successes(self):
        runtime = MockRuntime()
        runtime.success("Success 1")
        
        assert "Success 1" in runtime.successes
    
    def test_exit_records_code(self):
        runtime = MockRuntime()
        runtime.exit(42)
        
        assert runtime.exit_code == 42
        assert runtime.exited is True
    
    def test_reset_clears_state(self):
        runtime = MockRuntime()
        runtime.log("test")
        runtime.error("error")
        runtime.exit(1)
        
        runtime.reset()
        
        assert runtime.logs == []
        assert runtime.errors == []
        assert runtime.exit_code is None
        assert runtime.exited is False
    
    def test_all_output_combines_everything(self):
        runtime = MockRuntime()
        runtime.log("log")
        runtime.error("error")
        runtime.warn("warn")
        runtime.success("success")
        
        output = runtime.all_output
        
        assert "log" in output
        assert "error" in output
        assert "warn" in output
        assert "success" in output


class TestDefaultConsole:
    """Tests for DefaultConsole."""
    
    def test_respects_quiet_mode(self, capsys):
        console = DefaultConsole(quiet=True)
        console.print("Should not appear")
        console.echo("Also quiet")
        
        captured = capsys.readouterr()
        assert captured.out == ""
    
    def test_verbose_mode_shows_debug(self, capsys):
        console = DefaultConsole(verbose=True)
        console.debug("Debug info")
        
        captured = capsys.readouterr()
        assert "Debug info" in captured.out
    
    def test_normal_mode_hides_debug(self, capsys):
        console = DefaultConsole(verbose=False)
        console.debug("Debug info")
        
        captured = capsys.readouterr()
        assert "Debug info" not in captured.out


class TestDefaultConfigLoader:
    """Tests for DefaultConfigLoader."""
    
    def test_get_returns_env_var(self, monkeypatch):
        monkeypatch.setenv("TEST_CONFIG_VAR", "test_value")
        
        loader = DefaultConfigLoader()
        value = loader.get("test_config_var")
        
        assert value == "test_value"
    
    def test_get_returns_default(self):
        loader = DefaultConfigLoader()
        value = loader.get("nonexistent_key", default="fallback")
        
        assert value == "fallback"
    
    def test_load_returns_dict(self):
        loader = DefaultConfigLoader()
        config = loader.load()
        
        assert isinstance(config, dict)


class TestDefaultBackendClient:
    """Tests for DefaultBackendClient."""
    
    def test_is_available_returns_bool(self):
        client = DefaultBackendClient(base_url="http://127.0.0.1:99999")
        result = client.is_available()
        
        assert isinstance(result, bool)
        assert result is False  # Port 99999 shouldn't be in use
    
    @pytest.mark.asyncio
    async def test_health_check_returns_dict(self):
        client = DefaultBackendClient(base_url="http://127.0.0.1:99999")
        result = await client.health_check()
        
        assert isinstance(result, dict)
        assert "status" in result or "error" in result


class TestDefaultFileSystem:
    """Tests for DefaultFileSystem."""
    
    def test_exists_returns_correct_value(self, temp_dir):
        fs = DefaultFileSystem()
        
        # Non-existent
        assert fs.exists(temp_dir / "nonexistent.txt") is False
        
        # Create file
        (temp_dir / "exists.txt").write_text("hello")
        assert fs.exists(temp_dir / "exists.txt") is True
    
    def test_write_and_read_text(self, temp_dir):
        fs = DefaultFileSystem()
        path = temp_dir / "test.txt"
        
        fs.write_text(path, "Hello, World!")
        content = fs.read_text(path)
        
        assert content == "Hello, World!"
    
    def test_mkdir_creates_directory(self, temp_dir):
        fs = DefaultFileSystem()
        path = temp_dir / "subdir" / "nested"
        
        fs.mkdir(path, parents=True)
        
        assert path.exists()
        assert path.is_dir()


class TestCLIDeps:
    """Tests for CLIDeps container."""
    
    def test_state_dir_default(self, mock_deps):
        # Without profile, should use ~/.centris
        path = mock_deps.state_dir
        assert "centris" in str(path).lower() or ".centris" in str(path)
    
    def test_config_dir_default(self, mock_deps):
        path = mock_deps.config_dir
        assert "centris" in str(path).lower()
    
    def test_pre_action_hooks(self, mock_deps):
        called = []
        
        def hook(deps, cmd):
            called.append(cmd)
        
        mock_deps.add_pre_action_hook(hook)
        mock_deps.run_pre_action_hooks("test_command")
        
        assert "test_command" in called
    
    def test_post_action_hooks(self, mock_deps):
        called = []
        
        def hook(deps, cmd, result):
            called.append((cmd, result))
        
        mock_deps.add_post_action_hook(hook)
        mock_deps.run_post_action_hooks("test_command", "result")
        
        assert ("test_command", "result") in called
    
    def test_hooks_handle_exceptions(self, mock_deps):
        def failing_hook(deps, cmd):
            raise RuntimeError("Hook failed")
        
        mock_deps.add_pre_action_hook(failing_hook)
        
        # Should not raise
        mock_deps.run_pre_action_hooks("test_command")


class TestCreateDefaultDeps:
    """Tests for create_default_deps factory."""
    
    def test_creates_deps_with_defaults(self):
        deps = create_default_deps()
        
        assert deps is not None
        assert deps.console is not None
        assert deps.config_loader is not None
        assert deps.backend_client is not None
        assert deps.file_system is not None
    
    def test_respects_verbose_flag(self):
        deps = create_default_deps(verbose=True)
        assert deps.verbose is True
    
    def test_respects_quiet_flag(self):
        deps = create_default_deps(quiet=True)
        assert deps.quiet is True
    
    def test_respects_json_output_flag(self):
        deps = create_default_deps(json_output=True)
        assert deps.json_output is True
    
    def test_respects_non_interactive_flag(self):
        deps = create_default_deps(non_interactive=True)
        assert deps.non_interactive is True
    
    def test_uses_custom_backend_url(self):
        deps = create_default_deps(backend_url="http://custom:8080")
        assert deps.backend_client.base_url == "http://custom:8080"


class TestConfigMigrations:
    """Tests for config migration system."""
    
    def test_migration_creates_version_file(self, mock_deps, temp_dir):
        config_dir = temp_dir / "config"
        config_dir.mkdir()
        
        run_config_migrations(mock_deps, config_dir)
        
        version_file = config_dir / "version"
        assert version_file.exists()
        assert version_file.read_text().strip() == CURRENT_CONFIG_VERSION
    
    def test_migration_skips_when_up_to_date(self, mock_deps, temp_dir):
        config_dir = temp_dir / "config"
        config_dir.mkdir()
        
        # Write current version
        (config_dir / "version").write_text(CURRENT_CONFIG_VERSION)
        
        result = run_config_migrations(mock_deps, config_dir)
        
        assert result is False  # No migration needed
