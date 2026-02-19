"""
Tests for validate command.

Colocated test file following Clawdbot pattern.
"""

import pytest
import json
from pathlib import Path

from centris_sdk.cli.validate_cmd import (
    ValidationResult,
    validate_connector_json,
    validate_connector_py,
    validate_python_syntax,
    validate_command,
)


class TestValidationResult:
    """Tests for ValidationResult dataclass."""
    
    def test_valid_result(self):
        result = ValidationResult(
            valid=True,
            errors=[],
            warnings=["Minor issue"],
            info=["Found 3 capabilities"],
        )
        assert result.valid is True
        assert len(result.warnings) == 1
    
    def test_invalid_result(self):
        result = ValidationResult(
            valid=False,
            errors=["Missing required field"],
            warnings=[],
            info=[],
        )
        assert result.valid is False


class TestValidateConnectorJson:
    """Tests for validate_connector_json function."""
    
    def test_valid_connector_json(self, temp_dir):
        connector_json = {
            "id": "test-connector",
            "name": "Test Connector",
            "description": "A test connector",
            "version": "1.0.0",
            "capabilities": [
                {"id": "action", "name": "Action"}
            ]
        }
        (temp_dir / "connector.json").write_text(json.dumps(connector_json))
        
        result = validate_connector_json(temp_dir)
        
        assert result.valid is True
        assert len(result.errors) == 0
    
    def test_missing_connector_json(self, temp_dir):
        result = validate_connector_json(temp_dir)
        
        assert result.valid is False
        assert "connector.json not found" in result.errors[0]
    
    def test_invalid_json_syntax(self, temp_dir):
        (temp_dir / "connector.json").write_text("{invalid json")
        
        result = validate_connector_json(temp_dir)
        
        assert result.valid is False
        assert "Invalid JSON" in result.errors[0]
    
    def test_missing_required_field_id(self, temp_dir):
        connector_json = {
            "name": "Test",
            "description": "Test",
            "version": "1.0.0",
        }
        (temp_dir / "connector.json").write_text(json.dumps(connector_json))
        
        result = validate_connector_json(temp_dir)
        
        assert result.valid is False
        assert any("id" in err for err in result.errors)
    
    def test_missing_required_field_name(self, temp_dir):
        connector_json = {
            "id": "test",
            "description": "Test",
            "version": "1.0.0",
        }
        (temp_dir / "connector.json").write_text(json.dumps(connector_json))
        
        result = validate_connector_json(temp_dir)
        
        assert result.valid is False
        assert any("name" in err for err in result.errors)
    
    def test_empty_required_field(self, temp_dir):
        connector_json = {
            "id": "",
            "name": "Test",
            "description": "Test",
            "version": "1.0.0",
        }
        (temp_dir / "connector.json").write_text(json.dumps(connector_json))
        
        result = validate_connector_json(temp_dir)
        
        assert result.valid is False
        assert any("Empty required field" in err for err in result.errors)
    
    def test_warns_on_uppercase_id(self, temp_dir):
        connector_json = {
            "id": "Test-Connector",
            "name": "Test",
            "description": "Test",
            "version": "1.0.0",
        }
        (temp_dir / "connector.json").write_text(json.dumps(connector_json))
        
        result = validate_connector_json(temp_dir)
        
        assert any("lowercase" in warn for warn in result.warnings)
    
    def test_warns_on_invalid_version_format(self, temp_dir):
        connector_json = {
            "id": "test",
            "name": "Test",
            "description": "Test",
            "version": "1.0",  # Should be x.y.z
        }
        (temp_dir / "connector.json").write_text(json.dumps(connector_json))
        
        result = validate_connector_json(temp_dir)
        
        assert any("semver" in warn for warn in result.warnings)
    
    def test_warns_on_no_main_entry(self, temp_dir):
        connector_json = {
            "id": "test",
            "name": "Test",
            "description": "Test",
            "version": "1.0.0",
        }
        (temp_dir / "connector.json").write_text(json.dumps(connector_json))
        
        result = validate_connector_json(temp_dir)
        
        assert any("main" in warn for warn in result.warnings)
    
    def test_warns_on_empty_capabilities(self, temp_dir):
        connector_json = {
            "id": "test",
            "name": "Test",
            "description": "Test",
            "version": "1.0.0",
            "capabilities": [],
        }
        (temp_dir / "connector.json").write_text(json.dumps(connector_json))
        
        result = validate_connector_json(temp_dir)
        
        assert any("No capabilities" in warn for warn in result.warnings)


class TestValidateConnectorPy:
    """Tests for validate_connector_py function."""
    
    def test_missing_connector_py(self, temp_dir):
        result = validate_connector_py(temp_dir)
        
        assert result.valid is False
        assert "connector.py not found" in result.errors[0]
    
    def test_valid_decorator_pattern(self, temp_dir):
        code = '''"""Connector."""
from centris_sdk import CentrisConnector

connector = CentrisConnector(
    connector_id="test",
    name="Test",
    description="Test",
)

@connector.capability(
    id="action",
    name="Action",
    description="Do action",
    input_schema={"type": "object"},
)
async def action(params, context):
    return {"ok": True}

__all__ = ["connector"]
'''
        (temp_dir / "connector.py").write_text(code)
        
        result = validate_connector_py(temp_dir)
        
        assert result.valid is True
        assert any("Found connector export" in info for info in result.info)
    
    def test_valid_plugin_pattern(self, temp_dir):
        code = '''"""Connector."""
from centris_sdk import CentrisPluginConnector

connector = CentrisPluginConnector(
    id="test",
    name="Test",
    description="Test",
)

def get_tools():
    return []

__all__ = ["connector"]
'''
        (temp_dir / "connector.py").write_text(code)
        
        result = validate_connector_py(temp_dir)
        
        assert result.valid is True
    
    def test_warns_on_no_connector_pattern(self, temp_dir):
        code = '''"""Connector without standard pattern."""
def something():
    pass
'''
        (temp_dir / "connector.py").write_text(code)
        
        result = validate_connector_py(temp_dir)
        
        assert any("No standard connector pattern" in warn for warn in result.warnings)
    
    def test_warns_on_no_async_handlers(self, temp_dir):
        code = '''"""Connector."""
from centris_sdk import CentrisConnector

connector = CentrisConnector(
    connector_id="test",
    name="Test",
    description="Test",
)

def sync_handler(params, context):
    return {"ok": True}
'''
        (temp_dir / "connector.py").write_text(code)
        
        result = validate_connector_py(temp_dir)
        
        assert any("No async handlers" in warn for warn in result.warnings)
    
    def test_warns_on_no_all_export(self, temp_dir):
        code = '''"""Connector."""
from centris_sdk import CentrisConnector

connector = CentrisConnector(
    connector_id="test",
    name="Test",
    description="Test",
)

async def handler(params, context):
    return {}
'''
        (temp_dir / "connector.py").write_text(code)
        
        result = validate_connector_py(temp_dir)
        
        assert any("__all__" in warn for warn in result.warnings)


class TestValidatePythonSyntax:
    """Tests for validate_python_syntax function."""
    
    def test_valid_syntax(self, temp_dir):
        code = '''def hello():
    return "world"
'''
        (temp_dir / "connector.py").write_text(code)
        
        result = validate_python_syntax(temp_dir)
        
        assert result.valid is True
        assert any("syntax is valid" in info for info in result.info)
    
    def test_invalid_syntax(self, temp_dir):
        code = '''def broken(:
    return
'''
        (temp_dir / "connector.py").write_text(code)
        
        result = validate_python_syntax(temp_dir)
        
        assert result.valid is False
        assert any("syntax error" in err for err in result.errors)
    
    def test_returns_valid_when_no_file(self, temp_dir):
        result = validate_python_syntax(temp_dir)
        
        assert result.valid is True


class TestValidateCommand:
    """Tests for validate_command CLI command."""
    
    def test_command_with_valid_connector(self, cli_runner, temp_connector):
        result = cli_runner.invoke(
            validate_command,
            [str(temp_connector)],
            obj={"verbose": False},
        )
        
        assert result.exit_code == 0
        assert "passed" in result.output.lower()
    
    def test_command_with_invalid_connector(self, cli_runner, invalid_connector):
        result = cli_runner.invoke(
            validate_command,
            [str(invalid_connector)],
            obj={"verbose": False},
        )
        
        assert result.exit_code == 1
        assert "failed" in result.output.lower()
    
    def test_command_json_output(self, cli_runner, temp_connector):
        result = cli_runner.invoke(
            validate_command,
            [str(temp_connector), "--json-output"],
            obj={"verbose": False},
        )
        
        # Output should be valid JSON
        output = json.loads(result.output)
        assert "valid" in output
        assert "errors" in output
        assert "warnings" in output
    
    def test_command_strict_mode(self, cli_runner, temp_dir):
        # Create connector that generates warnings
        connector_json = {
            "id": "Test-Connector",  # Uppercase will generate warning
            "name": "Test",
            "description": "Test",
            "version": "1.0",  # Bad version format
        }
        (temp_dir / "connector.json").write_text(json.dumps(connector_json))
        (temp_dir / "connector.py").write_text("connector = None\n__all__ = ['connector']")
        
        result = cli_runner.invoke(
            validate_command,
            [str(temp_dir), "--strict"],
            obj={"verbose": False},
        )
        
        # Warnings should cause failure in strict mode
        assert result.exit_code == 1
