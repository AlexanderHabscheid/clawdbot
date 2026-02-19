"""
Tests for SDK version handling.

Small, focused tests following Clawdbot patterns.
"""

import pytest


class TestSDKVersion:
    """Tests for SDK version string."""
    
    def test_version_is_string(self):
        from centris_sdk import __version__
        
        assert isinstance(__version__, str)
    
    def test_version_format(self):
        from centris_sdk import __version__
        
        # Should be semver-ish or dev fallback
        assert "." in __version__ or __version__ == "0.0.0.dev"
    
    def test_version_not_empty(self):
        from centris_sdk import __version__
        
        assert len(__version__) > 0


class TestModuleExports:
    """Tests for SDK module exports."""
    
    def test_exports_centris_client(self):
        from centris_sdk import Centris
        assert Centris is not None
    
    def test_exports_centris_connector(self):
        from centris_sdk import CentrisConnector
        assert CentrisConnector is not None
    
    def test_exports_centris_plugin_connector(self):
        from centris_sdk import CentrisPluginConnector
        assert CentrisPluginConnector is not None
    
    def test_exports_execution_method(self):
        from centris_sdk import ExecutionMethod
        assert ExecutionMethod is not None
    
    def test_exports_auth_scheme(self):
        from centris_sdk import AuthScheme
        assert AuthScheme is not None
    
    def test_exports_validate_params(self):
        from centris_sdk import validate_params
        assert callable(validate_params)
    
    def test_exports_validation_error(self):
        from centris_sdk import ValidationError
        assert ValidationError is not None
    
    def test_exports_mcp_gateway(self):
        from centris_sdk import MCPGateway
        assert MCPGateway is not None
    
    def test_exports_execution_engine(self):
        from centris_sdk import ExecutionEngine
        assert ExecutionEngine is not None
    
    def test_exports_connector_loader(self):
        from centris_sdk import ConnectorLoader
        assert ConnectorLoader is not None
    
    def test_exports_result_builders(self):
        from centris_sdk import text_result, json_result, error_result
        assert callable(text_result)
        assert callable(json_result)
        assert callable(error_result)
    
    def test_exports_do_convenience_function(self):
        from centris_sdk import do
        assert callable(do)


class TestCLIVersion:
    """Tests for CLI version handling."""
    
    def test_cli_has_version(self):
        from centris_sdk.cli.main import SDK_VERSION
        assert SDK_VERSION is not None
        assert isinstance(SDK_VERSION, str)
    
    def test_cli_version_command(self):
        from click.testing import CliRunner
        from centris_sdk.cli.main import cli
        
        runner = CliRunner()
        result = runner.invoke(cli, ["--version"])
        
        assert result.exit_code == 0
        assert "centris" in result.output.lower()


class TestAllExports:
    """Tests for __all__ export list."""
    
    def test_all_exports_exist(self):
        import centris_sdk
        
        for name in centris_sdk.__all__:
            # Testing utilities may not be available
            if name in ("MockBrowserBridge", "ConnectorTestHarness", "create_test_context"):
                if not centris_sdk._testing_available:
                    continue
            assert hasattr(centris_sdk, name), f"Missing export: {name}"
    
    def test_public_exports_only(self):
        import centris_sdk
        
        # __version__ is a dunder, which is acceptable
        for name in centris_sdk.__all__:
            assert not name.startswith("_") or name.startswith("__"), \
                f"Private export (single underscore): {name}"
