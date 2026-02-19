"""
Centris CLI - Doctor Command

Check Centris installation health and diagnose issues.

Supports dependency injection for testability.
Uses the new output system for consistent JSON/text handling.
"""

import click
import sys
import os
import json
from pathlib import Path
from typing import Any, Dict, Optional, List

from centris_sdk.cli.banner import emit_banner
from centris_sdk.cli.theme import theme, symbols, styled_success, styled_error, styled_warning
from centris_sdk.cli.deps import CLIDeps, create_default_deps
from centris_sdk.cli.version import SDK_VERSION
from centris_sdk.cli.output import create_output, CommandResult, OutputMode


def _find_backend_root() -> Optional[Path]:
    """Find the backend directory."""
    candidates = [
        Path.cwd() / "backend",
        Path.cwd().parent / "backend",
        Path(__file__).resolve().parent.parent.parent.parent.parent.parent / "backend",
    ]
    
    for candidate in candidates:
        if candidate.exists() and (candidate / "main.py").exists():
            return candidate
    
    return None


def _setup_python_path(backend_root: Path) -> None:
    """Add backend to Python path."""
    project_root = backend_root.parent
    if str(project_root) not in sys.path:
        sys.path.insert(0, str(project_root))


def _render_check_result(result) -> str:
    """Render a single check result as a formatted line."""
    try:
        from backend.health.checks_base import CheckStatus
    except ImportError:
        from backend.health.legacy_checks import CheckStatus
    
    if result.status == CheckStatus.PASS:
        icon = theme.success(symbols.CHECK)
    elif result.status == CheckStatus.WARN:
        icon = theme.warn("!")
    elif result.status == CheckStatus.FAIL:
        icon = theme.error(symbols.CROSS)
    else:  # SKIP
        icon = theme.muted("-")
    
    line = f"  {icon} {result.name}"
    
    # Add message for non-pass results
    if result.status != CheckStatus.PASS:
        line += f" {theme.muted('—')} {result.message}"
    
    return line


def _render_fix_hint(result) -> Optional[str]:
    """Render a fix hint if available."""
    if result.fix_hint and result.status in ("fail", "warn"):
        return f"    {theme.muted(symbols.ARROW)} {theme.info(result.fix_hint)}"
    return None


def run_doctor(
    deps: CLIDeps,
    fix: bool = False,
    as_json: bool = False,
    categories: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Core doctor logic with injectable dependencies.
    
    Args:
        deps: CLI dependencies
        fix: Attempt to auto-fix issues
        as_json: Return JSON-compatible dict
        categories: Filter to specific categories
    
    Returns:
        Results dictionary with pass/fail counts and details
    """
    console = deps.console
    verbose = deps.verbose
    
    # Find backend
    backend_root = _find_backend_root()
    if not backend_root:
        return {"error": "Backend not found", "exit_code": 1}
    
    # Setup Python path
    _setup_python_path(backend_root)
    
    # Load .env files
    try:
        from dotenv import load_dotenv
        env_file = backend_root.parent / ".env"
        if env_file.exists():
            load_dotenv(env_file)
        backend_env = backend_root / ".env"
        if backend_env.exists():
            load_dotenv(backend_env, override=True)
    except ImportError:
        pass
    
    # Import health check infrastructure
    use_standalone = False
    use_doctor = False
    
    try:
        from backend.health.doctor import Doctor, run_full_diagnostic
        from backend.health.checks_base import CheckStatus
        use_doctor = True
    except ImportError:
        try:
            from backend.health.legacy_checks import (
                run_health_checks,
                get_default_checks,
                CheckStatus,
            )
        except ImportError:
            try:
                from centris_sdk.cli.doctor import (
                    run_health_checks,
                    get_default_checks,
                    CheckStatus,
                )
                use_standalone = True
                if verbose and not as_json:
                    console.debug("Using standalone health checks (backend not available)")
            except ImportError as e:
                return {"error": f"Cannot import health checks: {e}", "exit_code": 1}
    
    # Filter by category if specified
    filter_categories = categories
    
    # Run checks using appropriate system
    if use_doctor:
        doctor = Doctor(include_legacy=True)
        results = doctor.run_diagnostics(categories=filter_categories, fix=fix)
    else:
        checks = get_default_checks()
        results = run_health_checks(checks, fix=fix, filter_categories=filter_categories)
    
    return {
        "results": results,
        "CheckStatus": CheckStatus,
        "exit_code": 1 if results.failed > 0 else 0,
    }


@click.command("doctor")
@click.option("--fix", is_flag=True, help="Attempt to auto-fix issues where possible")
@click.option("--json", "as_json", is_flag=True, help="Output results as JSON")
@click.option("--category", "-c", multiple=True, help="Only run checks in specific categories")
@click.option("--verbose", "-v", is_flag=True, help="Show detailed output")
@click.pass_context
def doctor_command(
    ctx: click.Context,
    fix: bool,
    as_json: bool,
    category: tuple,
    verbose: bool,
) -> None:
    """
    Check Centris installation health.
    
    Runs comprehensive health checks to validate your Centris installation:
    
    \b
    Chrome & Browser:
    - Chrome executable path and version
    - CDP (Chrome DevTools Protocol) status
    - Chrome extension connectivity
    - Browser profiles
    
    Configuration:
    - .env file presence and validity
    - API keys and secrets
    - Settings validation
    
    Bridges:
    - Extension Bridge connectivity
    - System Bridge (desktop control)
    - Accessibility API availability
    
    Sandbox:
    - Sandbox mode configuration
    - Docker availability
    - Sandbox images and workspace
    
    Plus: Dependencies, Components, Audio, LLM Providers, Connectors
    
    Examples:
    
        centris doctor                 Run all checks
        
        centris doctor --fix           Auto-fix issues where possible
        
        centris doctor --json          Output JSON for scripting
        
        centris doctor -c chrome       Only check Chrome/browser
        
        centris doctor -c config       Only check configuration
        
        centris doctor -c sandbox      Only check sandbox setup
    """
    # Get deps from context or create default
    deps = ctx.obj.get("deps") if ctx.obj else None
    if deps is None:
        deps = create_default_deps(verbose=verbose)
    
    # Override verbose from flag
    if verbose:
        deps.verbose = True
    
    console = deps.console
    
    # Run doctor checks
    result = run_doctor(
        deps=deps,
        fix=fix,
        as_json=as_json,
        categories=list(category) if category else None,
    )
    
    # Handle errors
    if "error" in result:
        if as_json:
            console.echo(json.dumps({"error": result["error"]}))
        else:
            console.error(result["error"])
        sys.exit(result.get("exit_code", 1))
    
    results = result["results"]
    CheckStatus = result["CheckStatus"]
    
    # JSON output
    if as_json:
        console.echo(json.dumps(results.to_dict(), indent=2))
        sys.exit(0 if results.all_passed else 1)
    
    # Pretty output
    emit_banner(SDK_VERSION, compact=True)
    console.echo("")
    console.echo(f"{theme.heading(f'{symbols.LOGO} Centris Doctor')} {theme.info(f'v{SDK_VERSION}')}")
    console.echo("")
    
    # Group by category
    categories_dict = results.by_category()
    
    # Define category display order and labels
    category_labels = {
        "chrome": "Chrome & Browser",
        "config": "Configuration",
        "bridges": "Bridges",
        "sandbox": "Sandbox",
        "environment": "Environment",
        "dependencies": "Dependencies",
        "components": "Components",
        "connections": "Connections",
        "audio": "Audio",
        "llm": "LLM Providers",
        "connectors": "Connectors",
        "general": "General",
    }
    
    # Display results by category
    for cat_key in category_labels:
        if cat_key not in categories_dict:
            continue
        
        cat_results = categories_dict[cat_key]
        cat_label = category_labels.get(cat_key, cat_key.title())
        
        console.echo(theme.heading(cat_label))
        
        for check_result in cat_results:
            console.echo(_render_check_result(check_result))
            
            # Show fix hint for failures/warnings
            if check_result.fix_hint:
                if check_result.status == CheckStatus.FAIL or (verbose and check_result.status == CheckStatus.WARN):
                    console.echo(f"    {theme.muted(symbols.ARROW)} {theme.info(check_result.fix_hint)}")
        
        console.echo("")
    
    # Summary
    console.echo(theme.muted("─" * 50))
    
    summary_parts = []
    if results.passed > 0:
        summary_parts.append(theme.success(f"{results.passed} passed"))
    if results.warnings > 0:
        summary_parts.append(theme.warn(f"{results.warnings} warnings"))
    if results.failed > 0:
        summary_parts.append(theme.error(f"{results.failed} failed"))
    if results.skipped > 0:
        summary_parts.append(theme.muted(f"{results.skipped} skipped"))
    
    console.echo(f"Summary: {', '.join(summary_parts)}")
    
    # Exit with appropriate code
    if results.failed > 0:
        console.echo("")
        console.error("Some checks failed. Fix the issues above and run again.")
        sys.exit(1)
    elif results.warnings > 0:
        console.echo("")
        console.warn("Some warnings detected. Consider addressing them for optimal operation.")
        sys.exit(0)
    else:
        console.echo("")
        console.success("All checks passed! Centris is ready.")
        sys.exit(0)
