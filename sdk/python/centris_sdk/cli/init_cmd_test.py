"""
Tests for init command.

Colocated test file following Clawdbot pattern.
"""

import pytest
import json
from pathlib import Path

from centris_sdk.cli.init_cmd import (
    validate_connector_id,
    create_connector,
    init_command,
)


class TestValidateConnectorId:
    """Tests for validate_connector_id function."""
    
    def test_valid_id(self):
        result = validate_connector_id("my-connector")
        assert result is None
    
    def test_valid_id_with_numbers(self):
        result = validate_connector_id("slack-v2")
        assert result is None
    
    def test_empty_id_rejected(self):
        result = validate_connector_id("")
        assert result is not None
        assert "required" in result.lower()
    
    def test_id_starting_with_number_rejected(self):
        result = validate_connector_id("123-connector")
        assert result is not None
    
    def test_id_with_uppercase_rejected(self):
        result = validate_connector_id("MyConnector")
        assert result is not None
    
    def test_id_too_short_rejected(self):
        result = validate_connector_id("ab")
        assert result is not None
        assert "at least 3" in result
    
    def test_id_too_long_rejected(self):
        result = validate_connector_id("a" * 51)
        assert result is not None
        assert "50 characters" in result


class TestCreateConnector:
    """Tests for create_connector function."""
    
    def test_creates_directory(self, mock_deps, temp_dir):
        result = create_connector(
            deps=mock_deps,
            connector_id="test-connector",
            output=str(temp_dir / "test-connector"),
        )
        
        assert result["success"] is True
        assert (temp_dir / "test-connector").exists()
    
    def test_creates_connector_py(self, mock_deps, temp_dir):
        create_connector(
            deps=mock_deps,
            connector_id="test-connector",
            output=str(temp_dir / "test-connector"),
        )
        
        connector_py = temp_dir / "test-connector" / "connector.py"
        assert connector_py.exists()
        
        content = connector_py.read_text()
        assert "test-connector" in content or "test_connector" in content
    
    def test_creates_connector_json(self, mock_deps, temp_dir):
        create_connector(
            deps=mock_deps,
            connector_id="test-connector",
            output=str(temp_dir / "test-connector"),
        )
        
        connector_json = temp_dir / "test-connector" / "connector.json"
        assert connector_json.exists()
        
        data = json.loads(connector_json.read_text())
        assert data["id"] == "test-connector"
    
    def test_creates_readme(self, mock_deps, temp_dir):
        create_connector(
            deps=mock_deps,
            connector_id="test-connector",
            output=str(temp_dir / "test-connector"),
        )
        
        readme = temp_dir / "test-connector" / "README.md"
        assert readme.exists()
    
    def test_creates_gitignore(self, mock_deps, temp_dir):
        create_connector(
            deps=mock_deps,
            connector_id="test-connector",
            output=str(temp_dir / "test-connector"),
        )
        
        gitignore = temp_dir / "test-connector" / ".gitignore"
        assert gitignore.exists()
    
    def test_creates_pyproject_toml(self, mock_deps, temp_dir):
        create_connector(
            deps=mock_deps,
            connector_id="test-connector",
            output=str(temp_dir / "test-connector"),
        )
        
        pyproject = temp_dir / "test-connector" / "pyproject.toml"
        assert pyproject.exists()
    
    def test_uses_custom_name(self, mock_deps, temp_dir):
        create_connector(
            deps=mock_deps,
            connector_id="test-connector",
            name="My Custom Name",
            output=str(temp_dir / "test-connector"),
        )
        
        result_name = (temp_dir / "test-connector" / "connector.json")
        data = json.loads(result_name.read_text())
        assert data["name"] == "My Custom Name"
    
    def test_uses_custom_description(self, mock_deps, temp_dir):
        create_connector(
            deps=mock_deps,
            connector_id="test-connector",
            description="Custom description",
            output=str(temp_dir / "test-connector"),
        )
        
        data = json.loads(
            (temp_dir / "test-connector" / "connector.json").read_text()
        )
        assert data["description"] == "Custom description"
    
    def test_returns_result_dict(self, mock_deps, temp_dir):
        result = create_connector(
            deps=mock_deps,
            connector_id="test-connector",
            output=str(temp_dir / "test-connector"),
        )
        
        assert "success" in result
        assert "connector_id" in result
        assert "output_dir" in result
        assert "template" in result


class TestInitCommand:
    """Tests for init_command CLI command."""
    
    def test_init_with_id_creates_connector(self, cli_runner, temp_dir, monkeypatch):
        # Change to temp dir
        monkeypatch.chdir(temp_dir)
        
        result = cli_runner.invoke(
            init_command,
            ["my-connector"],
            obj={"verbose": False},
        )
        
        # Should complete without error
        assert result.exit_code == 0 or "already exists" in result.output
    
    def test_init_shows_help(self, cli_runner):
        result = cli_runner.invoke(init_command, ["--help"])
        
        assert result.exit_code == 0
        assert "connector" in result.output.lower()
        assert "template" in result.output.lower()
    
    def test_init_with_template_option(self, cli_runner, temp_dir, monkeypatch):
        monkeypatch.chdir(temp_dir)
        
        result = cli_runner.invoke(
            init_command,
            ["api-connector", "--template", "api"],
            obj={"verbose": False},
        )
        
        assert result.exit_code == 0 or "already exists" in result.output
    
    def test_init_validates_id(self, cli_runner, temp_dir, monkeypatch):
        monkeypatch.chdir(temp_dir)
        
        result = cli_runner.invoke(
            init_command,
            ["123-invalid"],  # Starts with number
            obj={"verbose": False},
        )
        
        # Should fail validation
        assert result.exit_code != 0 or "must start" in result.output.lower()


class TestTemplates:
    """Tests for different templates."""
    
    def test_basic_template(self, mock_deps, temp_dir):
        result = create_connector(
            deps=mock_deps,
            connector_id="basic-connector",
            template="basic",
            output=str(temp_dir / "basic-connector"),
        )
        
        assert result["template"] == "basic"
        assert (temp_dir / "basic-connector" / "connector.py").exists()
    
    def test_browser_template(self, mock_deps, temp_dir):
        result = create_connector(
            deps=mock_deps,
            connector_id="browser-connector",
            template="browser",
            url="https://example.com",
            output=str(temp_dir / "browser-connector"),
        )
        
        assert result["template"] == "browser"
        
        # Browser templates should have URL reference
        content = (temp_dir / "browser-connector" / "connector.py").read_text()
        assert "example.com" in content or "browser" in content.lower()
    
    def test_api_template(self, mock_deps, temp_dir):
        result = create_connector(
            deps=mock_deps,
            connector_id="api-connector",
            template="api",
            output=str(temp_dir / "api-connector"),
        )
        
        assert result["template"] == "api"


class TestOutputDirectory:
    """Tests for output directory handling."""
    
    def test_uses_id_as_default_dir(self, mock_deps, temp_dir, monkeypatch):
        monkeypatch.chdir(temp_dir)
        
        result = create_connector(
            deps=mock_deps,
            connector_id="my-connector",
        )
        
        # Should create in current dir / connector_id
        expected_path = temp_dir / "my-connector"
        assert str(expected_path) in result["output_dir"]
    
    def test_uses_custom_output_path(self, mock_deps, temp_dir):
        custom_path = temp_dir / "custom" / "path"
        
        result = create_connector(
            deps=mock_deps,
            connector_id="my-connector",
            output=str(custom_path),
        )
        
        assert str(custom_path) in result["output_dir"]
        assert custom_path.exists()
