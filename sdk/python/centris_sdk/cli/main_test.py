"""Tests for CLI main module."""

import pytest


class TestCLIVersion:
    """Tests for CLI version handling."""

    def test_version_from_package_metadata(self):
        # Import lazily to avoid triggering all CLI imports
        from centris_sdk.cli.main import SDK_VERSION
        
        # SDK_VERSION should be read from package metadata
        assert SDK_VERSION is not None
        assert isinstance(SDK_VERSION, str)
        # Should be a valid semver-ish format or dev fallback
        assert "." in SDK_VERSION or SDK_VERSION == "0.0.0.dev"

    def test_version_command(self):
        from click.testing import CliRunner
        from centris_sdk.cli.main import cli
        
        runner = CliRunner()
        result = runner.invoke(cli, ["--version"])
        assert result.exit_code == 0
        assert "centris" in result.output.lower()


class TestCLIHelp:
    """Tests for CLI help output."""

    def test_main_help(self):
        from click.testing import CliRunner
        from centris_sdk.cli.main import cli
        
        runner = CliRunner()
        result = runner.invoke(cli, ["--help"])
        assert result.exit_code == 0
        assert "centris" in result.output.lower()
        # Should show key commands
        assert "init" in result.output
        assert "doctor" in result.output

    def test_init_help(self):
        from click.testing import CliRunner
        from centris_sdk.cli.main import cli
        
        runner = CliRunner()
        result = runner.invoke(cli, ["init", "--help"])
        assert result.exit_code == 0
        assert "connector" in result.output.lower()


class TestGetDeps:
    """Tests for dependency injection helper."""

    def test_get_deps_creates_default(self):
        from click import Context, Command
        from centris_sdk.cli.main import get_deps
        
        ctx = Context(Command("test"))
        ctx.obj = {}
        deps = get_deps(ctx)
        assert deps is not None
        # Should have key attributes
        assert hasattr(deps, "console")
        assert hasattr(deps, "config_loader")
