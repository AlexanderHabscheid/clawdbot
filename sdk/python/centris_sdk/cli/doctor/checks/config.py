"""
Centris CLI - Configuration Health Checks

Checks for configuration files and settings validation.
"""

import os
import json
from pathlib import Path
from typing import TYPE_CHECKING, Optional, Dict, Any

if TYPE_CHECKING:
    from centris_sdk.cli.doctor import DoctorResult
    from centris_sdk.cli.doctor.prompter import DoctorPrompter, DoctorOptions


def note_config_health(
    result: "DoctorResult",
    prompter: "DoctorPrompter",
    options: "DoctorOptions",
) -> None:
    """
    Check configuration health.
    
    Args:
        result: DoctorResult to add checks to
        prompter: Prompter for interactive questions
        options: Doctor command options
    """
    # Check Centris home directory
    _check_centris_home(result)
    
    # Check config file
    _check_config_file(result)
    
    # Check profile
    _check_profile(result)


def _check_centris_home(result: "DoctorResult") -> None:
    """Check if ~/.centris directory exists and is configured."""
    centris_home = Path.home() / ".centris"
    
    if centris_home.exists():
        # Count subdirectories
        subdirs = [d for d in centris_home.iterdir() if d.is_dir()]
        
        result.add_check(
            name="Centris home",
            status="pass",
            message=f"{centris_home} ({len(subdirs)} subdirs)",
            category="config",
        )
        
        # Check for specific subdirectories
        expected_dirs = ["connectors", "cache", "logs"]
        for expected in expected_dirs:
            subdir = centris_home / expected
            if not subdir.exists():
                result.add_note(
                    f"Missing directory: {subdir}",
                    category="config",
                )
    else:
        result.add_check(
            name="Centris home",
            status="warn",
            message="Not created yet",
            category="config",
            fix_hint="Run 'centris init' or 'centris onboard' to create",
        )


def _check_config_file(result: "DoctorResult") -> None:
    """Check if config file exists and is valid."""
    config_locations = [
        Path.home() / ".centris" / "config.json",
        Path.home() / ".centris" / "config.yaml",
        Path.cwd() / "centris.config.json",
    ]
    
    for config_path in config_locations:
        if config_path.exists():
            try:
                if config_path.suffix == ".json":
                    with open(config_path) as f:
                        config = json.load(f)
                    
                    result.add_check(
                        name="Config file",
                        status="pass",
                        message=f"Valid JSON at {config_path}",
                        category="config",
                    )
                    
                    # Check for common config issues
                    _validate_config_contents(result, config)
                    return
                else:
                    result.add_check(
                        name="Config file",
                        status="pass",
                        message=f"Found at {config_path}",
                        category="config",
                    )
                    return
            except json.JSONDecodeError as e:
                result.add_check(
                    name="Config file",
                    status="fail",
                    message=f"Invalid JSON: {e}",
                    category="config",
                    fix_hint=f"Fix JSON syntax in {config_path}",
                )
                return
            except Exception as e:
                result.add_check(
                    name="Config file",
                    status="warn",
                    message=f"Could not read: {e}",
                    category="config",
                )
                return
    
    result.add_check(
        name="Config file",
        status="skip",
        message="Not found (using defaults)",
        category="config",
    )


def _validate_config_contents(result: "DoctorResult", config: Dict[str, Any]) -> None:
    """Validate configuration contents for common issues."""
    # Check for deprecated keys
    deprecated_keys = ["old_key", "legacy_setting"]
    for key in deprecated_keys:
        if key in config:
            result.add_note(
                f"Deprecated config key: {key}",
                category="config",
            )
    
    # Check for required sections
    if "connectors" not in config:
        result.add_note(
            "Missing 'connectors' section in config",
            category="config",
        )


def _check_profile(result: "DoctorResult") -> None:
    """Check current profile configuration."""
    profile = os.environ.get("CENTRIS_PROFILE", "default")
    
    if profile == "default":
        result.add_check(
            name="Profile",
            status="pass",
            message="Using default profile",
            category="config",
        )
    else:
        profile_dir = Path.home() / f".centris-{profile}"
        if profile_dir.exists():
            result.add_check(
                name="Profile",
                status="pass",
                message=f"Using profile: {profile}",
                category="config",
            )
        else:
            result.add_check(
                name="Profile",
                status="warn",
                message=f"Profile '{profile}' directory not found",
                category="config",
                fix_hint=f"Create {profile_dir} or use --profile default",
            )
