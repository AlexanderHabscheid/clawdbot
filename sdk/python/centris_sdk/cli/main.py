"""
Centris SDK CLI Entry Point

Main CLI application using Click with dependency injection.

LOCAL-FIRST DESIGN: No cloud registry required for basic workflows.

Architecture:
    - All commands receive deps via ctx.obj["deps"]
    - Hooks run before/after command execution
    - Dependencies are injectable for testing

Commands:
  Backend Management:
    run       - Start the Centris backend server
    doctor    - Check installation health
    status    - Show current server status
    config    - Show and manage configuration

  Development:
    init      - Create a new connector project
    validate  - Validate connector schema
    test      - Test connector locally
    serve     - Start dev server with playground

  Publishing & Packaging:
    publish   - Install locally or publish to registry
    package   - Create distributable .connector file
    
  Discovery & Installation:
    list      - List available/installed connectors
    search    - Search registry (if configured)
    install   - Install from local, package, GitHub, or registry
    update    - Update installed connectors
"""

import click
import sys
from typing import Any, Callable, List, Optional, TypeVar

from centris_sdk.cli.init_cmd import init_command
from centris_sdk.cli.validate_cmd import validate_command
from centris_sdk.cli.test_cmd import test_command
from centris_sdk.cli.serve_cmd import serve_command
from centris_sdk.cli.publish_cmd import publish_command
from centris_sdk.cli.package_cmd import package_command
from centris_sdk.cli.install_cmd import install_command
from centris_sdk.cli.list_cmd import list_command, search_command
from centris_sdk.cli.update_cmd import update_command
from centris_sdk.cli.auth import login_command, logout_command, whoami_command
from centris_sdk.cli.backend import register_backend_commands
from centris_sdk.cli.introspect_cmd import introspect_command

# New power-user commands (Clawdbot-inspired)
from centris_sdk.cli.agent_cmd import agent_command
from centris_sdk.cli.exec_cmd import exec_command
from centris_sdk.cli.do_cmd import do_command
from centris_sdk.cli.browser import browser_group
from centris_sdk.cli.file_cmd import file_group
from centris_sdk.cli.daemon import daemon_group
from centris_sdk.cli.sandbox import sandbox_group
from centris_sdk.cli.banner import emit_banner
from centris_sdk.cli.theme import theme, styled_success, styled_error
from centris_sdk.cli.elements_cmd import elements_group
from centris_sdk.cli.refine_cmd import refine_command
from centris_sdk.cli.skills_cmd import skills_group
from centris_sdk.cli.deps import CLIDeps, create_default_deps
from centris_sdk.cli.profile import (
    ProfileConfig,
    resolve_profile,
    set_active_profile,
    get_active_profile,
)
from centris_sdk.cli.errors import (
    CentrisCLIError,
    handle_cli_error,
    cli_error_handler,
    ExitCode,
)
from centris_sdk.cli.runtime import default_runtime, styled_runtime
from centris_sdk.cli.output import (
    create_output,
    is_interactive,
    is_ci_environment,
    OutputMode,
)
from centris_sdk.cli.version import SDK_VERSION, CONFIG_VERSION

# Type for command functions
F = TypeVar('F', bound=Callable[..., Any])


# =============================================================================
# Hooks System
# =============================================================================

# Global hook registries
_pre_action_hooks: List[Callable[[CLIDeps, str], None]] = []
_post_action_hooks: List[Callable[[CLIDeps, str, Any], None]] = []


def register_pre_action_hook(hook: Callable[[CLIDeps, str], None]) -> None:
    """
    Register a hook to run before every command.
    
    Args:
        hook: Function taking (deps, command_name)
    
    Example:
        def my_hook(deps, cmd):
            deps.console.debug(f"Running {cmd}")
        
        register_pre_action_hook(my_hook)
    """
    _pre_action_hooks.append(hook)


def register_post_action_hook(hook: Callable[[CLIDeps, str, Any], None]) -> None:
    """
    Register a hook to run after every command.
    
    Args:
        hook: Function taking (deps, command_name, result)
    
    Example:
        def my_hook(deps, cmd, result):
            deps.console.debug(f"Completed {cmd}")
        
        register_post_action_hook(my_hook)
    """
    _post_action_hooks.append(hook)


def _run_pre_hooks(deps: CLIDeps, command_name: str) -> None:
    """Run all pre-action hooks."""
    # Run global hooks
    for hook in _pre_action_hooks:
        try:
            hook(deps, command_name)
        except Exception as e:
            deps.logger.debug(f"Pre-hook failed: {e}")
    
    # Run deps-level hooks
    deps.run_pre_action_hooks(command_name)


def _run_post_hooks(deps: CLIDeps, command_name: str, result: Any) -> None:
    """Run all post-action hooks."""
    # Run global hooks
    for hook in _post_action_hooks:
        try:
            hook(deps, command_name, result)
        except Exception as e:
            deps.logger.debug(f"Post-hook failed: {e}")
    
    # Run deps-level hooks
    deps.run_post_action_hooks(command_name, result)


# =============================================================================
# Default Hooks
# =============================================================================

def _config_migration_hook(deps: CLIDeps, command_name: str) -> None:
    """
    Check for configuration migrations on startup.
    
    This hook runs before every command to ensure config is up-to-date.
    """
    # Skip for commands that don't need config
    skip_commands = {"version", "help", "--help", "-h", "--version"}
    if command_name in skip_commands:
        return
    
    try:
        config_loader = deps.config_loader
        if hasattr(config_loader, 'get_backend_root'):
            backend_root = config_loader.get_backend_root()
            if backend_root:
                # Check for .centris directory with config version
                centris_dir = backend_root.parent / ".centris"
                if centris_dir.exists():
                    version_file = centris_dir / "config_version"
                    if deps.file_system.exists(version_file):
                        version = deps.file_system.read_text(version_file).strip()
                        deps.logger.debug(f"Config version: {version}")
                        # Future: trigger migration if version is old
    except Exception as e:
        deps.logger.debug(f"Config migration check skipped: {e}")


def _telemetry_hook(deps: CLIDeps, command_name: str, result: Any) -> None:
    """
    Optional telemetry hook (respects privacy).
    
    Only logs anonymized usage data if user has opted in.
    """
    # Check if telemetry is enabled
    telemetry_enabled = deps.config_loader.get("CENTRIS_TELEMETRY", "false").lower() == "true"
    if not telemetry_enabled:
        return
    
    # Log command usage (anonymized)
    deps.logger.debug(f"Command executed: {command_name}")


# Register default hooks
register_pre_action_hook(_config_migration_hook)
register_post_action_hook(_telemetry_hook)


# =============================================================================
# CLI Group with Dependency Injection
# =============================================================================

class CentrisGroup(click.Group):
    """
    Custom Click group with dependency injection and hooks.
    
    Features:
    - Emits banner on help
    - Creates deps and stores in context
    - Runs pre/post action hooks
    """
    
    def format_help(self, ctx: click.Context, formatter: click.HelpFormatter) -> None:
        """Format help with banner."""
        emit_banner(SDK_VERSION, compact=True)
        super().format_help(ctx, formatter)
    
    def invoke(self, ctx: click.Context) -> Any:
        """Invoke command with hooks."""
        # Get deps from context
        deps = ctx.obj.get("deps") if ctx.obj else None
        
        if deps and ctx.invoked_subcommand:
            # Run pre-hooks
            _run_pre_hooks(deps, ctx.invoked_subcommand)
        
        # Invoke the command
        result = super().invoke(ctx)
        
        if deps and ctx.invoked_subcommand:
            # Run post-hooks
            _run_post_hooks(deps, ctx.invoked_subcommand, result)
        
        return result


@click.group(cls=CentrisGroup)
@click.version_option(version=SDK_VERSION, prog_name="centris")
@click.option("--verbose", "-v", is_flag=True, help="Enable verbose output")
@click.option("--quiet", "-q", is_flag=True, help="Suppress non-essential output")
@click.option("--json", "json_output", is_flag=True, help="Output as JSON (for scripting/CI)")
@click.option(
    "--non-interactive", "-n",
    is_flag=True,
    help="Run in non-interactive mode (no prompts, auto-detected in CI)"
)
@click.option("--dev", is_flag=True, help="Use development profile (~/.centris-dev/)")
@click.option("--profile", "profile_name", help="Use named profile (~/.centris-<name>/)")
@click.option("--no-banner", is_flag=True, help="Suppress banner", hidden=True)
@click.pass_context
def cli(
    ctx: click.Context,
    verbose: bool,
    quiet: bool,
    json_output: bool,
    non_interactive: bool,
    dev: bool,
    profile_name: Optional[str],
    no_banner: bool,
) -> None:
    """
    Centris SDK CLI - Voice-controlled computer automation.
    
    LOCAL-FIRST: No cloud registry required. Just init, code, test, publish.
    
    Quick Start:
        centris onboard                  Interactive setup wizard
        centris start                    Start the backend server
        centris doctor                   Check installation health
    
    Agent Execution (run tasks directly):
        centris agent "Open Gmail"       Execute a task via multi-agent system
        centris agent --session myproj   Continue with session context
        centris agent --json "..."       Output as JSON for scripting
    
    Direct Tool Commands:
        centris exec "git status"        Execute shell command
        centris browser navigate URL     Navigate browser
        centris browser snapshot         Get page elements
        centris file read ./config.json  Read file contents
        centris file search "TODO"       Search in files
    
    Daemon Mode (background service):
        centris daemon install           Install as system service
        centris daemon start             Start background server
        centris daemon status            Check if running
        centris daemon logs              View server logs
    
    Backend Management:
        centris start                    Start the backend server
        centris stop                     Stop the backend server  
        centris status                   Show server status
        centris doctor                   Check installation health
    
    Connector Development:
        centris init my-connector        Create new connector
        centris validate .               Validate connector
        centris test . --live            Test with real browser
        centris publish .                Install locally
    
    Profiles (isolated environments):
        centris --dev start              Use development profile
        centris --profile staging start  Use named profile
    """
    ctx.ensure_object(dict)
    
    # Auto-detect non-interactive mode if not explicitly set
    # Non-interactive is enabled if:
    # - Explicitly passed via --non-interactive
    # - Running in CI environment
    # - stdin is not a TTY
    effective_non_interactive = non_interactive or is_ci_environment() or not is_interactive()
    
    # JSON output implies non-interactive
    if json_output:
        effective_non_interactive = True
    
    # Resolve and activate profile
    profile = resolve_profile(dev=dev, profile=profile_name)
    set_active_profile(profile)
    
    # Show profile info in verbose mode (unless JSON output)
    if verbose and not profile.is_default and not json_output:
        click.echo(f"{theme.muted('Profile:')} {profile.display_name} ({profile.state_dir})")
    
    # Create dependencies with profile awareness
    deps = create_default_deps(
        verbose=verbose,
        quiet=quiet,
        json_output=json_output,
        profile=profile,
        non_interactive=effective_non_interactive,
    )
    
    # Store in context for commands to access
    ctx.obj["deps"] = deps
    ctx.obj["verbose"] = verbose
    ctx.obj["quiet"] = quiet
    ctx.obj["json_output"] = json_output
    ctx.obj["non_interactive"] = effective_non_interactive
    ctx.obj["no_banner"] = no_banner
    ctx.obj["profile"] = profile
    ctx.obj["dev"] = dev
    
    # Create output handler for commands to use
    ctx.obj["output"] = create_output(
        json_output=json_output,
        non_interactive=effective_non_interactive,
        verbose=verbose,
        quiet=quiet,
    )


def get_deps(ctx: click.Context) -> CLIDeps:
    """
    Get CLI dependencies from Click context.
    
    Helper function for commands to retrieve deps.
    
    Args:
        ctx: Click context
    
    Returns:
        CLIDeps instance
    
    Example:
        @click.command()
        @click.pass_context
        def my_command(ctx):
            deps = get_deps(ctx)
            deps.console.success("Done!")
    """
    if ctx.obj and "deps" in ctx.obj:
        return ctx.obj["deps"]
    
    # Create default deps if not present (for testing)
    return create_default_deps()


# Development commands
cli.add_command(init_command, name="init")
cli.add_command(validate_command, name="validate")
cli.add_command(test_command, name="test")
cli.add_command(serve_command, name="serve")
cli.add_command(refine_command, name="refine")  # AI-assisted refinement (fallback)

# Skills - teach AI IDEs how to use Centris
cli.add_command(skills_group, name="skills")

# Publishing & Packaging commands
cli.add_command(publish_command, name="publish")
cli.add_command(package_command, name="package")

# Discovery & Installation commands
cli.add_command(list_command, name="list")
cli.add_command(search_command, name="search")
cli.add_command(install_command, name="install")
cli.add_command(update_command, name="update")

# Authentication commands
cli.add_command(login_command, name="login")
cli.add_command(logout_command, name="logout")
cli.add_command(whoami_command, name="whoami")

# Self-learning / introspection (Clawdbot pattern)
cli.add_command(introspect_command, name="introspect")

# Deprecation info command
from centris_sdk.cli.deprecation import deprecations_command
cli.add_command(deprecations_command, name="deprecations")

# Backend management commands
register_backend_commands(cli)

# =============================================================================
# Power-User Commands (Clawdbot-inspired)
# =============================================================================

# Agent execution - run tasks directly from CLI
cli.add_command(agent_command, name="agent")

# The ONE command - simple API access
cli.add_command(do_command, name="do")

# Direct tool commands
cli.add_command(exec_command, name="exec")
cli.add_command(browser_group, name="browser")
cli.add_command(file_group, name="file")

# Daemon management
cli.add_command(daemon_group, name="daemon")

# Sandbox management
cli.add_command(sandbox_group, name="sandbox")

# Elements command for SDK connector development
cli.add_command(elements_group, name="elements")


def main() -> None:
    """
    Main entry point for the CLI.
    
    Uses unified error handling for all exceptions.
    """
    try:
        cli(obj={})
    except KeyboardInterrupt:
        # Ctrl+C - clean exit
        styled_runtime.warn("Aborted")
        sys.exit(ExitCode.CANCELLED)
    except CentrisCLIError as e:
        # Our unified error type - use consistent handler
        handle_cli_error(e, verbose=False)
    except click.ClickException as e:
        # Click's own exceptions - let Click handle them
        e.show()
        sys.exit(e.exit_code)
    except Exception as e:
        # Unexpected error - wrap and handle
        handle_cli_error(e, verbose=True)


if __name__ == "__main__":
    main()
