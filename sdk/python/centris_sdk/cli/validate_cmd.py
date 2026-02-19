"""
Centris SDK CLI - Validate Command

Validate connector schema and configuration.
"""

import click
import json
import sys
from pathlib import Path
from typing import Optional, Any
from dataclasses import dataclass


@dataclass
class ValidationResult:
    """Result of a validation check."""
    valid: bool
    errors: list[str]
    warnings: list[str]
    info: list[str]


def validate_connector_json(path: Path) -> ValidationResult:
    """Validate connector.json schema."""
    errors: list[str] = []
    warnings: list[str] = []
    info: list[str] = []
    
    connector_json = path / "connector.json"
    if not connector_json.exists():
        errors.append("connector.json not found")
        return ValidationResult(False, errors, warnings, info)
    
    try:
        with open(connector_json) as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        errors.append(f"Invalid JSON in connector.json: {e}")
        return ValidationResult(False, errors, warnings, info)
    
    # Required fields
    required_fields = ["id", "name", "description", "version"]
    for field in required_fields:
        if field not in data:
            errors.append(f"Missing required field: {field}")
        elif not data[field]:
            errors.append(f"Empty required field: {field}")
    
    # Validate ID format
    if "id" in data:
        connector_id = data["id"]
        if not connector_id.replace("-", "").replace("_", "").isalnum():
            errors.append(f"Invalid connector ID format: {connector_id}")
        if connector_id != connector_id.lower():
            warnings.append(f"Connector ID should be lowercase: {connector_id}")
    
    # Validate version format
    if "version" in data:
        version = data["version"]
        parts = version.split(".")
        if len(parts) != 3 or not all(p.isdigit() for p in parts):
            warnings.append(f"Version should follow semver (x.y.z): {version}")
    
    # Check for main entry point
    if "main" not in data:
        warnings.append("No 'main' entry point specified, defaulting to connector.py")
    
    # Check capabilities
    if "capabilities" in data:
        caps = data["capabilities"]
        if not isinstance(caps, list):
            errors.append("'capabilities' must be an array")
        elif len(caps) == 0:
            warnings.append("No capabilities defined")
        else:
            info.append(f"Found {len(caps)} capability definition(s)")
            for i, cap in enumerate(caps):
                if "id" not in cap:
                    errors.append(f"Capability {i} missing 'id'")
                if "name" not in cap:
                    warnings.append(f"Capability {i} missing 'name'")
    
    valid = len(errors) == 0
    return ValidationResult(valid, errors, warnings, info)


def validate_connector_py(path: Path) -> ValidationResult:
    """Validate connector.py implementation."""
    errors: list[str] = []
    warnings: list[str] = []
    info: list[str] = []
    
    connector_py = path / "connector.py"
    if not connector_py.exists():
        errors.append("connector.py not found")
        return ValidationResult(False, errors, warnings, info)
    
    try:
        content = connector_py.read_text()
    except Exception as e:
        errors.append(f"Cannot read connector.py: {e}")
        return ValidationResult(False, errors, warnings, info)
    
    # Check for connector pattern - supports both decorator pattern AND dataclass pattern
    has_decorator_pattern = "CentrisConnector" in content or "CentrisPluginConnector" in content
    has_dataclass_pattern = "@dataclass" in content and "Connector" in content
    has_api_pattern = "ConnectorApi" in content or "get_tools" in content
    
    if not has_decorator_pattern and not has_dataclass_pattern:
        # Neither pattern found - warn but don't error (might be a custom pattern)
        warnings.append("No standard connector pattern found (CentrisConnector or @dataclass Connector)")
    
    # Check for connector instance
    if "connector = " not in content.lower():
        warnings.append("No 'connector' variable found - ensure you export the connector")
    else:
        info.append("Found connector export")
    
    # Check for capabilities/tools - support multiple patterns
    has_capability_decorator = "@connector.capability" in content
    has_api_tools = "get_tools" in content
    has_tool_class = "class Tool" in content or "Tool(" in content
    
    if not has_capability_decorator and not has_api_tools and not has_tool_class:
        warnings.append("No capabilities/tools found - add @connector.capability decorators or get_tools() method")
    else:
        if has_capability_decorator:
            cap_count = content.count("@connector.capability")
            info.append(f"Found {cap_count} @connector.capability decorator(s)")
        if has_api_tools:
            info.append("Found get_tools() method (API pattern)")
        if has_tool_class:
            tool_count = content.count("Tool(")
            if tool_count > 0:
                info.append(f"Found approximately {tool_count} Tool definition(s)")
    
    # Check for async handlers
    if "async def" not in content:
        warnings.append("No async handlers found - capability handlers should be async")
    else:
        async_count = content.count("async def")
        info.append(f"Found {async_count} async function(s)")
    
    # Check for proper exports
    if "__all__" not in content:
        warnings.append("No __all__ export list - add __all__ = ['connector']")
    
    valid = len(errors) == 0
    return ValidationResult(valid, errors, warnings, info)


def validate_python_syntax(path: Path) -> ValidationResult:
    """Validate Python syntax by attempting to import."""
    errors: list[str] = []
    warnings: list[str] = []
    info: list[str] = []
    
    connector_py = path / "connector.py"
    if not connector_py.exists():
        return ValidationResult(True, errors, warnings, info)
    
    import ast
    
    try:
        content = connector_py.read_text()
        ast.parse(content)
        info.append("Python syntax is valid")
    except SyntaxError as e:
        errors.append(f"Python syntax error at line {e.lineno}: {e.msg}")
    
    valid = len(errors) == 0
    return ValidationResult(valid, errors, warnings, info)


def validate_modularization(path: Path) -> ValidationResult:
    """
    Validate connector follows SDK modularization standard.
    
    ALL Centris connectors must use modular structure:
    - services/ directory for implementation
    - base.py for shared utilities
    - connector.py as thin coordinator only
    - Each service file <300 lines, <5 tools
    """
    errors: list[str] = []
    warnings: list[str] = []
    info: list[str] = []
    
    MAX_LINES_WARNING = 300
    MAX_LINES_ERROR = 500
    MAX_TOOLS_PER_FILE = 5
    
    # Check for required modular structure
    services_dir = path / "services"
    base_py = path / "base.py"
    
    if not services_dir.exists():
        errors.append(
            "Missing services/ directory. All connectors must use modular structure. "
            "Run 'centris init' to create proper structure."
        )
    else:
        info.append("services/ directory exists ✓")
        
        # Check services/__init__.py
        if not (services_dir / "__init__.py").exists():
            errors.append("Missing services/__init__.py - required for service registry")
        
        # Check for at least one service
        service_files = [f for f in services_dir.glob("*.py") if not f.name.startswith("__")]
        if not service_files:
            warnings.append("No service modules in services/ - add your implementation files")
        else:
            info.append(f"Found {len(service_files)} service module(s)")
    
    if not base_py.exists():
        warnings.append("Missing base.py - recommended for shared utilities")
    else:
        info.append("base.py exists ✓")
    
    # Check all Python files for size/tool limits
    py_files = list(path.glob("**/*.py"))
    
    total_tools = 0
    
    for py_file in py_files:
        if py_file.name.startswith("__"):
            continue
        if "test" in py_file.name.lower():
            continue
            
        try:
            content = py_file.read_text()
            lines = content.split("\n")
            line_count = len(lines)
            
            # Count tools in this file
            tool_count = content.count("Tool(") + content.count("@connector.capability")
            total_tools += tool_count
            
            rel_path = py_file.relative_to(path)
            
            # Check line count
            if line_count > MAX_LINES_ERROR:
                errors.append(
                    f"{rel_path}: {line_count} lines exceeds SDK limit ({MAX_LINES_ERROR}). "
                    f"Split into multiple service modules in services/"
                )
            elif line_count > MAX_LINES_WARNING:
                warnings.append(
                    f"{rel_path}: {line_count} lines approaching limit "
                    f"(max: {MAX_LINES_ERROR}, recommended: <{MAX_LINES_WARNING})"
                )
            
            # Check tool count per file
            if tool_count > MAX_TOOLS_PER_FILE:
                errors.append(
                    f"{rel_path}: {tool_count} tools exceeds limit ({MAX_TOOLS_PER_FILE} per file). "
                    f"Split into separate service modules."
                )
                
        except Exception as e:
            warnings.append(f"Could not analyze {py_file.name}: {e}")
    
    info.append(f"Total tools: {total_tools}")
    
    valid = len(errors) == 0
    return ValidationResult(valid, errors, warnings, info)


@click.command("validate")
@click.argument("path", type=click.Path(exists=True), default=".")
@click.option("--strict", is_flag=True, help="Treat warnings as errors")
@click.option("--json-output", "json_out", is_flag=True, help="Output results as JSON")
@click.pass_context
def validate_command(
    ctx: click.Context,
    path: str,
    strict: bool,
    json_out: bool,
) -> None:
    """
    Validate a Centris connector project.
    
    Checks:
    - connector.json schema and required fields
    - connector.py implementation
    - Python syntax validity
    - Capability definitions
    
    Examples:
        centris validate .
        centris validate ./my-connector --strict
    """
    verbose = ctx.obj.get("verbose", False)
    connector_path = Path(path).resolve()
    
    if not json_out:
        click.echo(f"Validating connector at: {connector_path}")
        click.echo()
    
    all_errors: list[str] = []
    all_warnings: list[str] = []
    all_info: list[str] = []
    
    # Run validations
    validations = [
        ("connector.json", validate_connector_json),
        ("connector.py", validate_connector_py),
        ("Python syntax", validate_python_syntax),
        ("Modularization", validate_modularization),
    ]
    
    for name, validator in validations:
        result = validator(connector_path)
        all_errors.extend(result.errors)
        all_warnings.extend(result.warnings)
        all_info.extend(result.info)
        
        if not json_out and verbose:
            status = "✓" if result.valid else "✗"
            color = "green" if result.valid else "red"
            click.echo(f"  {click.style(status, fg=color)} {name}")
    
    # Determine overall validity
    is_valid = len(all_errors) == 0
    if strict:
        is_valid = is_valid and len(all_warnings) == 0
    
    if json_out:
        output = {
            "valid": is_valid,
            "errors": all_errors,
            "warnings": all_warnings,
            "info": all_info,
            "path": str(connector_path),
        }
        click.echo(json.dumps(output, indent=2))
    else:
        click.echo()
        
        # Show errors
        if all_errors:
            click.echo(click.style("Errors:", fg="red", bold=True))
            for error in all_errors:
                click.echo(f"  ✗ {error}")
            click.echo()
        
        # Show warnings
        if all_warnings:
            click.echo(click.style("Warnings:", fg="yellow", bold=True))
            for warning in all_warnings:
                click.echo(f"  ⚠ {warning}")
            click.echo()
        
        # Show info
        if all_info and verbose:
            click.echo(click.style("Info:", fg="blue", bold=True))
            for info in all_info:
                click.echo(f"  ℹ {info}")
            click.echo()
        
        # Summary
        if is_valid:
            click.echo(click.style("✓ Validation passed!", fg="green", bold=True))
        else:
            click.echo(click.style("✗ Validation failed!", fg="red", bold=True))
            sys.exit(1)
