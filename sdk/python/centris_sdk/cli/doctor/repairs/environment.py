"""
Centris CLI - Environment Repair Functions

Auto-repair functions for environment issues.
"""

import os
import shutil
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from centris_sdk.cli.doctor import DoctorResult
    from centris_sdk.cli.doctor.prompter import DoctorPrompter, DoctorOptions


def maybe_repair_env(
    result: "DoctorResult",
    prompter: "DoctorPrompter",
    options: "DoctorOptions",
) -> None:
    """
    Attempt to repair environment issues.
    
    Args:
        result: DoctorResult to record repairs in
        prompter: Prompter for interactive questions
        options: Doctor command options
    """
    # Check if we should create .env from example
    _maybe_create_env_file(result, prompter, options)


def _maybe_create_env_file(
    result: "DoctorResult",
    prompter: "DoctorPrompter",
    options: "DoctorOptions",
) -> None:
    """Create .env file from .env.example if missing."""
    # Check if .env file check failed/warned
    has_issue = any(
        check.get("name") == ".env file" and check.get("status") in ("fail", "warn")
        for checks in result.categories.values()
        for check in checks
    )
    
    if not has_issue:
        return
    
    # Look for .env.example
    example_locations = [
        Path.cwd() / ".env.example",
        Path.cwd() / "backend" / ".env.example",
        Path.cwd().parent / ".env.example",
    ]
    
    example_path = None
    for loc in example_locations:
        if loc.exists():
            example_path = loc
            break
    
    if not example_path:
        prompter.note(
            "No .env.example found to create .env from",
            category="Environment",
        )
        return
    
    # Determine target path
    target_path = example_path.parent / ".env"
    
    if target_path.exists():
        return
    
    should_create = prompter.confirm_repair(
        f"Create .env from {example_path.name}?",
        initial=True,
    )
    
    if should_create:
        try:
            shutil.copy(example_path, target_path)
            result.add_repair(f"Created {target_path} from {example_path.name}")
            
            prompter.note(
                f"Created {target_path}\nPlease edit it to add your API keys.",
                category="Environment",
            )
            
            # Update the check status
            for checks in result.categories.values():
                for check in checks:
                    if check.get("name") == ".env file":
                        check["status"] = "pass"
                        check["message"] = f"Created at {target_path}"
                        result.passed += 1
                        result.warnings -= 1
        
        except Exception as e:
            prompter.note(f"Failed to create .env: {e}", category="Environment")
