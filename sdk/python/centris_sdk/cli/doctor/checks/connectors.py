"""
Centris CLI - Connectors Health Checks

Checks for installed connectors and their health.
"""

import json
from pathlib import Path
from typing import TYPE_CHECKING, List, Dict, Any

if TYPE_CHECKING:
    from centris_sdk.cli.doctor import DoctorResult
    from centris_sdk.cli.doctor.prompter import DoctorPrompter, DoctorOptions


def note_connectors_health(
    result: "DoctorResult",
    prompter: "DoctorPrompter",
    options: "DoctorOptions",
) -> None:
    """
    Check connectors health.
    
    Args:
        result: DoctorResult to add checks to
        prompter: Prompter for interactive questions
        options: Doctor command options
    """
    # Check connectors directory
    connectors_dir = _get_connectors_dir()
    
    if not connectors_dir or not connectors_dir.exists():
        result.add_check(
            name="Connectors directory",
            status="skip",
            message="Not found",
            category="connectors",
            fix_hint="Run 'centris init' to create the connectors directory",
        )
        return
    
    # Count and validate connectors
    connectors = _find_connectors(connectors_dir)
    
    result.add_check(
        name="Connectors directory",
        status="pass",
        message=f"{len(connectors)} connector(s) found",
        category="connectors",
    )
    
    # Validate each connector
    for connector in connectors:
        _validate_connector(result, connector)


def _get_connectors_dir() -> Path:
    """Get the connectors directory path."""
    return Path.home() / ".centris" / "connectors"


def _find_connectors(connectors_dir: Path) -> List[Path]:
    """Find all connector directories."""
    connectors = []
    
    if not connectors_dir.exists():
        return connectors
    
    for item in connectors_dir.iterdir():
        if item.is_dir():
            # Check if it looks like a connector
            manifest = item / "manifest.json"
            connector_py = item / "connector.py"
            
            if manifest.exists() or connector_py.exists():
                connectors.append(item)
    
    return connectors


def _validate_connector(result: "DoctorResult", connector_path: Path) -> None:
    """Validate a single connector."""
    name = connector_path.name
    manifest_path = connector_path / "manifest.json"
    connector_py = connector_path / "connector.py"
    
    # Check manifest
    if not manifest_path.exists():
        result.add_check(
            name=f"Connector: {name}",
            status="warn",
            message="Missing manifest.json",
            category="connectors",
            fix_hint=f"Add manifest.json to {connector_path}",
        )
        return
    
    # Validate manifest JSON
    try:
        with open(manifest_path) as f:
            manifest = json.load(f)
        
        # Check required fields
        required_fields = ["name", "version", "description"]
        missing = [f for f in required_fields if f not in manifest]
        
        if missing:
            result.add_check(
                name=f"Connector: {name}",
                status="warn",
                message=f"Missing fields: {', '.join(missing)}",
                category="connectors",
                fix_hint=f"Add {', '.join(missing)} to manifest.json",
            )
        elif not connector_py.exists():
            result.add_check(
                name=f"Connector: {name}",
                status="warn",
                message="Missing connector.py",
                category="connectors",
                fix_hint=f"Add connector.py to {connector_path}",
            )
        else:
            version = manifest.get("version", "unknown")
            result.add_check(
                name=f"Connector: {name}",
                status="pass",
                message=f"v{version}",
                category="connectors",
            )
    
    except json.JSONDecodeError as e:
        result.add_check(
            name=f"Connector: {name}",
            status="fail",
            message=f"Invalid manifest.json: {e}",
            category="connectors",
            fix_hint="Fix JSON syntax in manifest.json",
        )
    except Exception as e:
        result.add_check(
            name=f"Connector: {name}",
            status="warn",
            message=f"Could not validate: {e}",
            category="connectors",
        )
