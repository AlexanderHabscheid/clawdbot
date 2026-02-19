"""
Centris CLI - Modular Doctor Command

Provides comprehensive health checks with a modular architecture.
Based on Clawdbot's battle-tested doctor pattern.

Structure:
- checks/: Individual health check modules (note_* functions)
- repairs/: Auto-repair modules (maybe_repair_* functions)
- prompter.py: Interactive prompt abstraction for testability
"""

import sys
import json
from pathlib import Path
from typing import Optional, List, Dict, Any

from centris_sdk.cli.doctor.prompter import (
    DoctorPrompter,
    create_doctor_prompter,
    DoctorOptions,
)
from centris_sdk.cli.doctor.checks import (
    note_config_health,
    note_environment_health,
    note_dependencies_health,
    note_connectors_health,
    note_network_health,
)
from centris_sdk.cli.doctor.repairs import (
    maybe_repair_config,
    maybe_repair_env,
)
from centris_sdk.cli.theme import theme, symbols
from centris_sdk.cli.banner import emit_banner
from centris_sdk.cli.ui import section, divider

# SDK Version
SDK_VERSION = "1.1.0"


class DoctorResult:
    """Result from running the doctor command."""
    
    def __init__(self):
        self.passed: int = 0
        self.warnings: int = 0
        self.failed: int = 0
        self.skipped: int = 0
        self.notes: List[str] = []
        self.repairs: List[str] = []
        self.categories: Dict[str, List[Dict[str, Any]]] = {}
    
    @property
    def all_passed(self) -> bool:
        return self.failed == 0
    
    def add_check(
        self,
        name: str,
        status: str,  # "pass", "warn", "fail", "skip"
        message: str = "",
        category: str = "general",
        fix_hint: Optional[str] = None,
    ) -> None:
        """Add a check result."""
        if status == "pass":
            self.passed += 1
        elif status == "warn":
            self.warnings += 1
        elif status == "fail":
            self.failed += 1
        else:
            self.skipped += 1
        
        if category not in self.categories:
            self.categories[category] = []
        
        self.categories[category].append({
            "name": name,
            "status": status,
            "message": message,
            "fix_hint": fix_hint,
        })
    
    def add_note(self, message: str, category: str = "general") -> None:
        """Add an informational note."""
        self.notes.append(f"[{category}] {message}")
    
    def add_repair(self, description: str) -> None:
        """Record a repair action taken."""
        self.repairs.append(description)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON output."""
        return {
            "summary": {
                "passed": self.passed,
                "warnings": self.warnings,
                "failed": self.failed,
                "skipped": self.skipped,
                "all_passed": self.all_passed,
            },
            "categories": self.categories,
            "notes": self.notes,
            "repairs": self.repairs,
        }


def run_doctor(
    prompter: DoctorPrompter,
    options: DoctorOptions,
) -> DoctorResult:
    """
    Run the doctor checks with the given prompter and options.
    
    This is the main orchestrator that calls all check and repair modules.
    
    Args:
        prompter: Interactive prompt abstraction
        options: Doctor command options
    
    Returns:
        DoctorResult with all check results
    """
    result = DoctorResult()
    
    # Filter by category if specified
    filter_categories = options.categories
    
    def should_run(category: str) -> bool:
        if not filter_categories:
            return True
        return category in filter_categories
    
    # Run checks by category
    if should_run("environment"):
        note_environment_health(result, prompter, options)
    
    if should_run("config"):
        note_config_health(result, prompter, options)
        
        # Attempt repairs if requested
        if options.fix and result.failed > 0:
            maybe_repair_config(result, prompter, options)
    
    if should_run("dependencies"):
        note_dependencies_health(result, prompter, options)
    
    if should_run("connectors"):
        note_connectors_health(result, prompter, options)
    
    if should_run("network"):
        note_network_health(result, prompter, options)
    
    # Environment repairs
    if options.fix and should_run("environment"):
        maybe_repair_env(result, prompter, options)
    
    return result


def render_doctor_result(
    result: DoctorResult,
    console,
    verbose: bool = False,
) -> None:
    """
    Render doctor results to console.
    
    Args:
        result: The doctor result to render
        console: Console output interface
        verbose: Show verbose output
    """
    # Category display order and labels
    category_labels = {
        "environment": "Environment",
        "config": "Configuration",
        "dependencies": "Dependencies",
        "connectors": "Connectors",
        "network": "Network",
        "general": "General",
    }
    
    # Display results by category
    for cat_key, cat_label in category_labels.items():
        if cat_key not in result.categories:
            continue
        
        cat_checks = result.categories[cat_key]
        if not cat_checks:
            continue
        
        console.echo(theme.heading(cat_label))
        
        for check in cat_checks:
            status = check["status"]
            name = check["name"]
            message = check.get("message", "")
            fix_hint = check.get("fix_hint")
            
            # Icon based on status
            if status == "pass":
                icon = theme.success(symbols.CHECK)
            elif status == "warn":
                icon = theme.warn("!")
            elif status == "fail":
                icon = theme.error(symbols.CROSS)
            else:  # skip
                icon = theme.muted("-")
            
            line = f"  {icon} {name}"
            if message and status != "pass":
                line += f" {theme.muted('—')} {message}"
            
            console.echo(line)
            
            # Show fix hint for failures (and warnings in verbose mode)
            if fix_hint and (status == "fail" or (verbose and status == "warn")):
                console.echo(f"    {theme.muted(symbols.ARROW)} {theme.info(fix_hint)}")
        
        console.echo("")
    
    # Show repairs if any
    if result.repairs:
        console.echo(theme.heading("Repairs Applied"))
        for repair in result.repairs:
            console.echo(f"  {theme.success(symbols.CHECK)} {repair}")
        console.echo("")
    
    # Summary
    console.echo(divider(50))
    
    summary_parts = []
    if result.passed > 0:
        summary_parts.append(theme.success(f"{result.passed} passed"))
    if result.warnings > 0:
        summary_parts.append(theme.warn(f"{result.warnings} warnings"))
    if result.failed > 0:
        summary_parts.append(theme.error(f"{result.failed} failed"))
    if result.skipped > 0:
        summary_parts.append(theme.muted(f"{result.skipped} skipped"))
    
    console.echo(f"Summary: {', '.join(summary_parts)}")


__all__ = [
    "SDK_VERSION",
    "DoctorResult",
    "DoctorOptions",
    "DoctorPrompter",
    "create_doctor_prompter",
    "run_doctor",
    "render_doctor_result",
]
