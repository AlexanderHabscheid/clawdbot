"""
Centris CLI Exec Command

Execute shell commands directly through the CLI.
Can run locally or through the backend for sandboxed execution.

NOTE: This command is being deprecated in favor of the unified agent command.
Use 'centris agent run --tool shell' for new code.

Examples:
    centris exec "ls -la"
    centris exec "git status" --cwd ~/projects/myapp
    centris exec "npm install" --sandbox
    centris exec --json "python --version"
"""

import asyncio
import json
import os
import shlex
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, Optional

import click

from centris_sdk.cli.deps import CLIDeps, create_default_deps
from centris_sdk.cli.theme import theme, symbols
from centris_sdk.cli.progress import Spinner
from centris_sdk.cli.errors import CentrisCLIError, ExitCode


def run_command_locally(
    command: str,
    cwd: Optional[str] = None,
    env: Optional[Dict[str, str]] = None,
    timeout: Optional[float] = None,
    capture_output: bool = True,
) -> Dict[str, Any]:
    """
    Execute a command locally using subprocess.
    
    Args:
        command: The command to execute (will be parsed by shell)
        cwd: Working directory for command execution
        env: Additional environment variables
        timeout: Timeout in seconds (None for no timeout)
        capture_output: Whether to capture stdout/stderr
        
    Returns:
        Dict with exit_code, stdout, stderr, success
    """
    # Resolve working directory
    work_dir = Path(cwd).expanduser().resolve() if cwd else Path.cwd()
    
    if not work_dir.exists():
        return {
            "success": False,
            "exit_code": 1,
            "stdout": "",
            "stderr": f"Directory does not exist: {work_dir}",
        }
    
    # Merge environment
    full_env = os.environ.copy()
    if env:
        full_env.update(env)
    
    try:
        result = subprocess.run(
            command,
            shell=True,
            cwd=str(work_dir),
            env=full_env,
            capture_output=capture_output,
            timeout=timeout,
            text=True,
        )
        
        return {
            "success": result.returncode == 0,
            "exit_code": result.returncode,
            "stdout": result.stdout if capture_output else "",
            "stderr": result.stderr if capture_output else "",
            "command": command,
            "cwd": str(work_dir),
        }
        
    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "exit_code": -1,
            "stdout": "",
            "stderr": f"Command timed out after {timeout} seconds",
            "command": command,
            "cwd": str(work_dir),
        }
    except FileNotFoundError as e:
        return {
            "success": False,
            "exit_code": 127,
            "stdout": "",
            "stderr": f"Command not found: {e}",
            "command": command,
            "cwd": str(work_dir),
        }
    except PermissionError as e:
        return {
            "success": False,
            "exit_code": 126,
            "stdout": "",
            "stderr": f"Permission denied: {e}",
            "command": command,
            "cwd": str(work_dir),
        }
    except Exception as e:
        return {
            "success": False,
            "exit_code": 1,
            "stdout": "",
            "stderr": str(e),
            "command": command,
            "cwd": str(work_dir),
        }


async def run_command_via_backend(
    command: str,
    cwd: Optional[str] = None,
    backend_url: str = "http://127.0.0.1:5001",
    sandbox: bool = True,
    timeout: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Execute a command through the backend (potentially sandboxed).
    
    This routes the command through the Centris backend, which can
    apply sandbox policies and logging.
    """
    try:
        import httpx
    except ImportError:
        raise CentrisCLIError(
            "httpx is required for backend execution. Install with: pip install httpx",
            code="missing_dependency",
        )
    
    async with httpx.AsyncClient(timeout=httpx.Timeout(timeout or 300.0)) as client:
        try:
            response = await client.post(
                f"{backend_url}/api/tools/execute",
                json={
                    "tool": "execute_terminal_command",
                    "params": {
                        "command": command,
                        "cwd": cwd,
                    },
                    "sandbox": sandbox,
                },
            )
            
            if response.status_code == 200:
                return response.json()
            else:
                return {
                    "success": False,
                    "exit_code": 1,
                    "stdout": "",
                    "stderr": f"Backend error: {response.text}",
                }
        except httpx.ConnectError:
            raise CentrisCLIError(
                "Cannot connect to backend. Start it with: centris start",
                code="backend_unavailable",
            )


# Import deprecation decorator
from centris_sdk.cli.deprecation import deprecated

# Register migration guide for exec command
from centris_sdk.cli.deprecation import register_migration

_exec_migration = register_migration(
    "centris exec",
    "2.0.0",
    "The exec command is being unified under the agent command for consistency.",
    removal_version="3.0.0",
)
_exec_migration.add_step(
    "Update CLI calls to use agent run",
    old_code='centris exec "git status"',
    new_code='centris agent run --tool shell "git status"',
    notes="The agent command provides consistent logging and sandbox support.",
)
_exec_migration.add_breaking_change(
    "The --backend flag will be removed; all commands route through agent by default."
)


@deprecated(
    version="2.0.0",
    alternative="centris agent run --tool shell",
    reason="Unifying all execution under the agent command for consistency",
    removal_version="3.0.0",
    sunset_date="2027-01-01",
    migration_guide="https://docs.centris.ai/sdk/migration/exec-to-agent",
)
@click.command(name="exec")
@click.argument("command", required=False)
@click.option("--cwd", "-C", help="Working directory for command execution")
@click.option("--timeout", "-t", type=float, help="Timeout in seconds")
@click.option("--sandbox", is_flag=True, help="Run in sandboxed environment via backend")
@click.option("--backend", is_flag=True, help="Route through backend (without sandbox)")
@click.option("--json", "json_output", is_flag=True, help="Output as JSON")
@click.option("--quiet", "-q", is_flag=True, help="Only show command output, no decoration")
@click.option("--backend-url", default="http://127.0.0.1:5001", help="Backend server URL", hidden=True)
@click.pass_context
def exec_command(
    ctx: click.Context,
    command: Optional[str],
    cwd: Optional[str],
    timeout: Optional[float],
    sandbox: bool,
    backend: bool,
    json_output: bool,
    quiet: bool,
    backend_url: str,
):
    """
    Execute a shell command.
    
    Run commands locally or through the Centris backend for logging
    and optional sandbox isolation.
    
    \b
    Examples:
      centris exec "ls -la"
      centris exec "git status" --cwd ~/projects/myapp
      centris exec "npm install" --timeout 60
      centris exec "python script.py" --sandbox
      centris exec --json "python --version"
    
    \b
    Options:
      --cwd/-C       Working directory for the command
      --timeout/-t   Timeout in seconds
      --sandbox      Run in isolated sandbox via backend
      --backend      Route through backend (for logging) without sandbox
      --json         Output result as JSON
      --quiet/-q     Only show command output
    
    \b
    Docs: https://docs.centris.ai/sdk/cli/exec
    """
    # Get flags from context
    json_output = json_output or ctx.obj.get("json_output", False)
    quiet = quiet or ctx.obj.get("quiet", False)
    
    # Read command from stdin if not provided
    if not command:
        if sys.stdin.isatty():
            click.echo(theme.error("Error: No command provided"))
            click.echo(theme.muted("Usage: centris exec \"your command\""))
            click.echo(theme.muted("       echo 'command' | centris exec"))
            ctx.exit(ExitCode.ERROR)
        else:
            command = sys.stdin.read().strip()
            if not command:
                click.echo(theme.error("Error: No command received from stdin"))
                ctx.exit(ExitCode.ERROR)
    
    # Execute command
    if sandbox or backend:
        # Route through backend
        async def run_via_backend():
            return await run_command_via_backend(
                command=command,
                cwd=cwd,
                backend_url=backend_url,
                sandbox=sandbox,
                timeout=timeout,
            )
        
        try:
            if not quiet and not json_output:
                with Spinner(f"Running: {command[:40]}...") as spinner:
                    result = asyncio.run(run_via_backend())
                    if result.get("success"):
                        spinner.success("Command completed")
                    else:
                        spinner.fail(f"Exit code: {result.get('exit_code', 1)}")
            else:
                result = asyncio.run(run_via_backend())
        except CentrisCLIError as e:
            if json_output:
                click.echo(json.dumps({"success": False, "error": str(e)}))
            else:
                click.echo(f"{theme.error(symbols.CROSS)} {e.message}")
            ctx.exit(ExitCode.ERROR)
    else:
        # Run locally
        if not quiet and not json_output:
            click.echo(f"{theme.muted('$')} {command}")
        
        result = run_command_locally(
            command=command,
            cwd=cwd,
            timeout=timeout,
        )
    
    # Output results
    if json_output:
        click.echo(json.dumps(result, indent=2))
    else:
        # Show stdout
        stdout = result.get("stdout", "")
        if stdout:
            if quiet:
                click.echo(stdout, nl=False)
            else:
                click.echo(stdout, nl=False)
        
        # Show stderr if there was an error
        stderr = result.get("stderr", "")
        if stderr and not result.get("success"):
            if not quiet:
                click.echo(f"{theme.error('stderr:')} {stderr}", err=True)
            else:
                click.echo(stderr, err=True, nl=False)
        
        # Show exit code if non-zero and not quiet
        exit_code = result.get("exit_code", 0)
        if exit_code != 0 and not quiet:
            click.echo(f"\n{theme.muted(f'Exit code: {exit_code}')}")
    
    # Exit with command's exit code
    ctx.exit(result.get("exit_code", 0))


__all__ = ["exec_command", "run_command_locally"]
