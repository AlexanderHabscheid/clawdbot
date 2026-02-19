"""
Centris CLI Sandbox Commands

Manage Docker containers for sandboxed agent execution.

Commands:
    centris sandbox status    Show sandbox status
    centris sandbox list      List all containers
    centris sandbox prune     Clean up idle containers
    centris sandbox logs      View container logs
    centris sandbox shell     Open shell in container
"""

import asyncio
import json
import subprocess
import sys
from datetime import timedelta
from typing import Any, Dict, Optional

import click

from centris_sdk.cli.theme import theme, symbols
from centris_sdk.cli.progress import Spinner
from centris_sdk.cli.errors import CentrisCLIError, ExitCode


def _check_docker() -> bool:
    """Check if Docker is available."""
    try:
        result = subprocess.run(
            ["docker", "info"],
            capture_output=True,
            timeout=5,
        )
        return result.returncode == 0
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return False


def _get_container_manager():
    """Get the container manager from backend."""
    try:
        from backend.agent.multi_agent.container_manager import get_container_manager
        return get_container_manager()
    except ImportError:
        return None


# =============================================================================
# Sandbox Command Group
# =============================================================================

@click.group(name="sandbox")
@click.pass_context
def sandbox_group(ctx: click.Context):
    """
    Manage sandboxed containers.
    
    Centris uses Docker containers for sandboxed execution:
    - Safe terminal command execution
    - Parallel research with headless browsers
    - Isolated file operations
    
    \b
    Examples:
      centris sandbox status     Check sandbox system status
      centris sandbox list       List all containers
      centris sandbox prune      Clean up idle containers
      centris sandbox shell ID   Open shell in container
    
    \b
    Docs: https://docs.centris.ai/sdk/cli/sandbox
    """
    ctx.ensure_object(dict)


@sandbox_group.command(name="status")
@click.option("--json", "json_output", is_flag=True, help="Output as JSON")
@click.pass_context
def status_command(ctx: click.Context, json_output: bool):
    """
    Check sandbox system status.
    
    Shows Docker availability and container statistics.
    """
    json_output = json_output or ctx.obj.get("json_output", False)
    
    # Check Docker
    docker_available = _check_docker()
    
    # Get container manager stats
    manager = _get_container_manager()
    stats = manager.get_stats() if manager else None
    
    result = {
        "docker_available": docker_available,
        "docker_message": "Docker is running" if docker_available else "Docker not available",
    }
    
    if stats:
        result.update(stats)
    
    if json_output:
        click.echo(json.dumps(result, indent=2))
    else:
        click.echo(f"\n{theme.heading('Sandbox Status')}\n")
        
        if docker_available:
            click.echo(f"  {theme.success(symbols.CHECK)} Docker is running")
        else:
            click.echo(f"  {theme.error(symbols.CROSS)} Docker not available")
            click.echo(f"  {theme.muted('Install Docker:')} https://docs.docker.com/get-docker/")
        
        if stats:
            click.echo(f"\n  {theme.muted('Sandbox containers:')} {stats.get('sandbox_containers', 0)}")
            click.echo(f"  {theme.muted('Browser containers:')} {stats.get('browser_containers', 0)}")
            click.echo(f"  {theme.muted('Workspace base:')} {stats.get('workspace_base', 'N/A')}")


@sandbox_group.command(name="list")
@click.option("--json", "json_output", is_flag=True, help="Output as JSON")
@click.pass_context
def list_command(ctx: click.Context, json_output: bool):
    """
    List all sandbox containers.
    
    Shows sandbox and browser containers managed by Centris.
    """
    json_output = json_output or ctx.obj.get("json_output", False)
    
    manager = _get_container_manager()
    if not manager:
        if json_output:
            click.echo(json.dumps({"error": "Container manager not available"}))
        else:
            click.echo(f"{theme.error(symbols.CROSS)} Container manager not available")
        ctx.exit(ExitCode.ERROR)
    
    containers = manager.list_containers()
    
    if json_output:
        click.echo(json.dumps(containers, indent=2, default=str))
    else:
        sandbox_containers = containers.get("sandbox_containers", [])
        browser_containers = containers.get("browser_containers", [])
        
        if not sandbox_containers and not browser_containers:
            click.echo(f"\n{theme.muted('No sandbox containers running')}")
            click.echo(f"{theme.muted('Use:')} centris agent --sandbox \"your task\"")
            return
        
        if sandbox_containers:
            click.echo(f"\n{theme.heading('Sandbox Containers')}")
            for c in sandbox_containers:
                status_icon = theme.success(symbols.CHECK) if c.get("status") == "running" else theme.muted("○")
                click.echo(f"  {status_icon} {c.get('name', '?')}")
                click.echo(f"      {theme.muted('Session:')} {c.get('session_key', '?')}")
                click.echo(f"      {theme.muted('Workspace:')} {c.get('host_workspace', '?')}")
        
        if browser_containers:
            click.echo(f"\n{theme.heading('Browser Containers')}")
            for c in browser_containers:
                status_icon = theme.success(symbols.CHECK) if c.get("status") == "running" else theme.muted("○")
                click.echo(f"  {status_icon} {c.get('name', '?')}")
                click.echo(f"      {theme.muted('CDP Port:')} {c.get('host_cdp_port', '?')}")
                click.echo(f"      {theme.muted('Headless:')} {'Yes' if c.get('headless') else 'No'}")


@sandbox_group.command(name="prune")
@click.option("--max-idle", type=int, default=24, help="Max idle hours before cleanup")
@click.option("--force", "-f", is_flag=True, help="Don't prompt for confirmation")
@click.option("--json", "json_output", is_flag=True, help="Output as JSON")
@click.pass_context
def prune_command(ctx: click.Context, max_idle: int, force: bool, json_output: bool):
    """
    Clean up idle containers.
    
    Removes containers that have been idle for too long.
    
    \b
    Examples:
      centris sandbox prune              Clean up containers idle > 24h
      centris sandbox prune --max-idle 1 Clean up containers idle > 1h
    """
    json_output = json_output or ctx.obj.get("json_output", False)
    
    manager = _get_container_manager()
    if not manager:
        if json_output:
            click.echo(json.dumps({"error": "Container manager not available"}))
        else:
            click.echo(f"{theme.error(symbols.CROSS)} Container manager not available")
        ctx.exit(ExitCode.ERROR)
    
    # Confirm
    if not force and not json_output:
        if not click.confirm(f"Clean up containers idle > {max_idle} hours?"):
            click.echo(f"{theme.muted('Cancelled')}")
            return
    
    async def do_prune():
        return await manager.cleanup_idle_containers(
            max_idle=timedelta(hours=max_idle)
        )
    
    if not json_output:
        with Spinner("Cleaning up idle containers...") as spinner:
            cleaned = asyncio.run(do_prune())
            if cleaned > 0:
                spinner.success(f"Cleaned up {cleaned} containers")
            else:
                spinner.success("No idle containers to clean up")
    else:
        cleaned = asyncio.run(do_prune())
        click.echo(json.dumps({"cleaned": cleaned}))


@sandbox_group.command(name="shell")
@click.argument("container_id")
@click.pass_context
def shell_command(ctx: click.Context, container_id: str):
    """
    Open interactive shell in a container.
    
    \b
    Examples:
      centris sandbox shell centris-sbx-abc123
      centris sandbox shell abc123
    """
    if not _check_docker():
        click.echo(f"{theme.error(symbols.CROSS)} Docker not available")
        ctx.exit(ExitCode.ERROR)
    
    # Try to find container by partial ID
    try:
        result = subprocess.run(
            ["docker", "ps", "-a", "--filter", f"name={container_id}", "--format", "{{.Names}}"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        
        containers = result.stdout.strip().split("\n")
        if not containers or not containers[0]:
            # Try by ID
            result = subprocess.run(
                ["docker", "ps", "-a", "--filter", f"id={container_id}", "--format", "{{.ID}}"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            container_id = result.stdout.strip() or container_id
        else:
            container_id = containers[0]
        
    except Exception:
        pass
    
    click.echo(f"{theme.muted('Opening shell in:')} {container_id}")
    click.echo(f"{theme.muted('Type')} exit {theme.muted('to return')}\n")
    
    # Open interactive shell
    import os
    os.execvp("docker", ["docker", "exec", "-it", container_id, "/bin/sh"])


@sandbox_group.command(name="logs")
@click.argument("container_id")
@click.option("--follow", "-f", is_flag=True, help="Follow log output")
@click.option("--tail", "-n", type=int, default=100, help="Number of lines to show")
@click.pass_context
def logs_command(ctx: click.Context, container_id: str, follow: bool, tail: int):
    """
    View container logs.
    
    \b
    Examples:
      centris sandbox logs centris-sbx-abc123
      centris sandbox logs abc123 --follow
    """
    if not _check_docker():
        click.echo(f"{theme.error(symbols.CROSS)} Docker not available")
        ctx.exit(ExitCode.ERROR)
    
    cmd = ["docker", "logs", f"--tail={tail}"]
    if follow:
        cmd.append("-f")
    cmd.append(container_id)
    
    try:
        subprocess.run(cmd)
    except KeyboardInterrupt:
        pass


@sandbox_group.command(name="exec")
@click.argument("container_id")
@click.argument("command")
@click.option("--json", "json_output", is_flag=True, help="Output as JSON")
@click.pass_context
def exec_command(ctx: click.Context, container_id: str, command: str, json_output: bool):
    """
    Execute command in a container.
    
    \b
    Examples:
      centris sandbox exec centris-sbx-abc123 "ls -la"
      centris sandbox exec abc123 "cat /etc/os-release"
    """
    json_output = json_output or ctx.obj.get("json_output", False)
    
    if not _check_docker():
        if json_output:
            click.echo(json.dumps({"error": "Docker not available"}))
        else:
            click.echo(f"{theme.error(symbols.CROSS)} Docker not available")
        ctx.exit(ExitCode.ERROR)
    
    try:
        result = subprocess.run(
            ["docker", "exec", container_id, "sh", "-c", command],
            capture_output=True,
            text=True,
            timeout=120,
        )
        
        if json_output:
            click.echo(json.dumps({
                "success": result.returncode == 0,
                "exit_code": result.returncode,
                "stdout": result.stdout,
                "stderr": result.stderr,
            }))
        else:
            if result.stdout:
                click.echo(result.stdout, nl=False)
            if result.stderr and result.returncode != 0:
                click.echo(f"\n{theme.error('stderr:')} {result.stderr}", err=True)
            
            if result.returncode != 0:
                ctx.exit(result.returncode)
                
    except subprocess.TimeoutExpired:
        if json_output:
            click.echo(json.dumps({"error": "Command timed out"}))
        else:
            click.echo(f"{theme.error(symbols.CROSS)} Command timed out")
        ctx.exit(ExitCode.ERROR)


__all__ = ["sandbox_group"]
