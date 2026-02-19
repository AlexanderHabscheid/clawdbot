"""
Centris CLI - Configuration Repair Functions

Auto-repair functions for configuration issues.
"""

import os
import json
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from centris_sdk.cli.doctor import DoctorResult
    from centris_sdk.cli.doctor.prompter import DoctorPrompter, DoctorOptions


def maybe_repair_config(
    result: "DoctorResult",
    prompter: "DoctorPrompter",
    options: "DoctorOptions",
) -> None:
    """
    Attempt to repair configuration issues.
    
    Args:
        result: DoctorResult to record repairs in
        prompter: Prompter for interactive questions
        options: Doctor command options
    """
    # Check if we should create missing directories
    _maybe_create_centris_home(result, prompter, options)
    
    # Check if we should fix config file
    _maybe_fix_config_file(result, prompter, options)


def _maybe_create_centris_home(
    result: "DoctorResult",
    prompter: "DoctorPrompter",
    options: "DoctorOptions",
) -> None:
    """Create ~/.centris directory if missing."""
    centris_home = Path.home() / ".centris"
    
    if centris_home.exists():
        return
    
    # Check if there was a failure related to this
    has_failure = any(
        check.get("name") == "Centris home" and check.get("status") in ("fail", "warn")
        for checks in result.categories.values()
        for check in checks
    )
    
    if not has_failure:
        return
    
    should_create = prompter.confirm_repair(
        f"Create Centris home directory at {centris_home}?",
        initial=True,
    )
    
    if should_create:
        try:
            centris_home.mkdir(parents=True, exist_ok=True)
            
            # Create subdirectories
            subdirs = ["connectors", "cache", "logs"]
            for subdir in subdirs:
                (centris_home / subdir).mkdir(exist_ok=True)
            
            result.add_repair(f"Created Centris home at {centris_home}")
            
            # Update the check status
            for checks in result.categories.values():
                for check in checks:
                    if check.get("name") == "Centris home":
                        check["status"] = "pass"
                        check["message"] = f"{centris_home} (created)"
                        result.passed += 1
                        result.warnings -= 1
        
        except Exception as e:
            result.add_note(f"Failed to create Centris home: {e}", category="config")


def _maybe_fix_config_file(
    result: "DoctorResult",
    prompter: "DoctorPrompter",
    options: "DoctorOptions",
) -> None:
    """Attempt to fix config file issues."""
    config_path = Path.home() / ".centris" / "config.json"
    
    # Check if there was a config file failure
    has_failure = any(
        check.get("name") == "Config file" and check.get("status") == "fail"
        for checks in result.categories.values()
        for check in checks
    )
    
    if not has_failure:
        return
    
    if not config_path.exists():
        return
    
    # Try to read and fix the config
    try:
        with open(config_path) as f:
            content = f.read()
        
        # Attempt common JSON fixes
        fixed_content = content
        
        # Remove trailing commas
        import re
        fixed_content = re.sub(r',(\s*[}\]])', r'\1', fixed_content)
        
        # Try to parse the fixed content
        try:
            json.loads(fixed_content)
            
            should_fix = prompter.confirm_repair(
                "Fix JSON syntax errors in config.json?",
                initial=True,
            )
            
            if should_fix:
                # Backup original
                backup_path = config_path.with_suffix(".json.bak")
                with open(backup_path, 'w') as f:
                    f.write(content)
                
                # Write fixed content
                with open(config_path, 'w') as f:
                    f.write(fixed_content)
                
                result.add_repair(f"Fixed JSON syntax in {config_path} (backup at {backup_path})")
        
        except json.JSONDecodeError:
            prompter.note(
                "Could not auto-fix config.json - manual repair needed",
                category="Config",
            )
    
    except Exception as e:
        prompter.note(f"Could not repair config: {e}", category="Config")
