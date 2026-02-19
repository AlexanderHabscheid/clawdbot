"""
Centris CLI - Status Command

Show current server status and component health.

Supports dependency injection for testability.
Uses the new output system for consistent JSON/text handling.
"""

import click
import sys
import os
import json
import time
from pathlib import Path
from typing import Any, Dict, Optional
import urllib.request
import urllib.error

from centris_sdk.cli.banner import emit_banner
from centris_sdk.cli.theme import theme, symbols, styled_success, styled_error, styled_warning
from centris_sdk.cli.deps import CLIDeps, create_default_deps
from centris_sdk.cli.version import SDK_VERSION
from centris_sdk.cli.output import create_output, OutputMode


def _check_server_running(host: str, port: int) -> Optional[dict]:
    """Check if the server is running and get health info."""
    try:
        url = f"http://{host}:{port}/api/health"
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=5) as response:
            return json.loads(response.read().decode())
    except urllib.error.URLError:
        return None
    except Exception:
        return None


def _get_full_health(host: str, port: int) -> Optional[dict]:
    """Get full health check from running server."""
    try:
        url = f"http://{host}:{port}/api/health/full"
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as response:
            return json.loads(response.read().decode())
    except Exception:
        return None


def _format_uptime(seconds: float) -> str:
    """Format uptime in human-readable form."""
    if seconds < 60:
        return f"{int(seconds)}s"
    elif seconds < 3600:
        mins = int(seconds / 60)
        secs = int(seconds % 60)
        return f"{mins}m {secs}s"
    else:
        hours = int(seconds / 3600)
        mins = int((seconds % 3600) / 60)
        return f"{hours}h {mins}m"


def display_status(
    deps: CLIDeps,
    host: str,
    port: int,
    as_json: bool = False,
    full: bool = False,
    watch: bool = False,
) -> bool:
    """
    Display server status with injectable dependencies.
    
    Args:
        deps: CLI dependencies
        host: Server host
        port: Server port
        as_json: Output as JSON
        full: Show full details
        watch: In watch mode (affects display)
    
    Returns:
        True if server is running, False otherwise
    """
    console = deps.console
    
    # Check if server is running
    health = _check_server_running(host, port)
    
    if as_json:
        if health:
            if full:
                full_health = _get_full_health(host, port)
                if full_health:
                    health["full"] = full_health
            console.echo(json.dumps({"running": True, "health": health}, indent=2))
        else:
            console.echo(json.dumps({"running": False}, indent=2))
        return health is not None
    
    # Clear screen in watch mode
    if watch:
        click.clear()
    
    # Header
    console.echo(f"{theme.heading(f'{symbols.LOGO} Centris Status')}")
    console.echo(theme.muted("─" * 50))
    console.echo("")
    
    # Server status
    if health:
        console.echo(f"  {theme.success(symbols.CHECK)} Server {theme.success('running')} at {theme.info(f'http://{host}:{port}')}")
        console.echo("")
        
        # Basic health info
        console.echo(theme.heading("Components"))
        
        components = [
            ("Audio Manager", health.get("audio_manager", False)),
            ("Tool Executor", health.get("tool_executor", False)),
            ("Mode Manager", health.get("mode_manager", False)),
            ("Dictation Service", health.get("dictation_service", False)),
        ]
        
        for name, status in components:
            if status:
                console.echo(f"  {theme.success(symbols.CHECK)} {name}")
            else:
                console.echo(f"  {theme.error(symbols.CROSS)} {name}")
        
        console.echo("")
        
        # Mode and provider info
        console.echo(theme.heading("Configuration"))
        console.echo(f"  {theme.muted('Mode:')}         {theme.accent(health.get('current_mode', 'unknown'))}")
        console.echo(f"  {theme.muted('LLM Provider:')} {theme.accent(health.get('llm_provider', 'unknown'))}")
        
        # Streaming transcription
        streaming = health.get("streaming_transcription", {})
        if streaming.get("available"):
            status_text = "ready" if streaming.get("model_loaded") else "loading"
            sessions = streaming.get("active_sessions", 0)
            console.echo(f"  {theme.muted('Streaming:')}    {theme.accent(status_text)} ({sessions} sessions)")
        
        # Channel messaging
        channels = health.get("channel_messaging", {})
        if channels.get("available"):
            enabled = channels.get("enabled_channels", [])
            running = channels.get("running_channels", [])
            console.echo(f"  {theme.muted('Channels:')}     {len(running)}/{len(enabled)} running")
        
        console.echo("")
        
        # Full details if requested
        if full:
            full_health = _get_full_health(host, port)
            if full_health:
                console.echo(theme.heading("Full Health Check"))
                console.echo(f"  {theme.muted('Status:')} {full_health.get('status', 'unknown')}")
                console.echo(f"  {theme.muted('Timestamp:')} {full_health.get('timestamp', 'unknown')}")
                console.echo("")
                
                # Components
                for comp_name, comp_info in full_health.get("components", {}).items():
                    if comp_info.get("healthy"):
                        icon = theme.success(symbols.CHECK)
                    else:
                        icon = theme.error(symbols.CROSS)
                    
                    name = comp_info.get("name", comp_name)
                    message = comp_info.get("details", {}).get("message", "")
                    console.echo(f"  {icon} {name}")
                    if message:
                        console.echo(f"      {theme.muted(message)}")
                
                console.echo("")
                
                # Issues
                issues = full_health.get("issues", [])
                if issues:
                    console.echo(theme.heading("Issues"))
                    for issue in issues:
                        console.echo(f"  {theme.error(symbols.CROSS)} {issue}")
                    console.echo("")
                
                # Suggestions
                suggestions = full_health.get("suggestions", [])
                if suggestions:
                    console.echo(theme.heading("Suggestions"))
                    for suggestion in suggestions:
                        console.echo(f"  {theme.info(symbols.ARROW)} {suggestion}")
                    console.echo("")
    else:
        console.echo(f"  {theme.error(symbols.CROSS)} Server {theme.error('not running')} at http://{host}:{port}")
        console.echo("")
        console.echo(f"  {theme.muted('Start with:')} {theme.command('centris run')}")
        console.echo("")
    
    # Watch mode footer
    if watch:
        console.echo(theme.muted("─" * 50))
        console.echo(theme.muted(f"Refreshing every 2s. Press Ctrl+C to stop."))
    
    return health is not None


@click.command("status")
@click.option("--host", "-h", default="127.0.0.1", help="Server host to check")
@click.option("--port", "-p", type=int, default=5001, help="Server port to check")
@click.option("--watch", "-w", is_flag=True, help="Watch mode - refresh every 2 seconds")
@click.option("--json", "as_json", is_flag=True, help="Output as JSON")
@click.option("--full", "-f", is_flag=True, help="Show full component details")
@click.pass_context
def status_command(
    ctx: click.Context,
    host: str,
    port: int,
    watch: bool,
    as_json: bool,
    full: bool,
) -> None:
    """
    Show current Centris server status.
    
    Checks if the server is running and displays component health.
    Can also show real-time status updates in watch mode.
    
    Examples:
    
        centris status                 Check default server
        
        centris status --port 5002     Check custom port
        
        centris status --watch         Live status updates
        
        centris status --json          JSON output for scripts
        
        centris status --full          Detailed component info
    """
    # Get deps from context or create default
    deps = ctx.obj.get("deps") if ctx.obj else None
    if deps is None:
        deps = create_default_deps()
    
    console = deps.console
    
    # Single check or watch mode
    if watch:
        try:
            while True:
                display_status(deps, host, port, as_json, full, watch=True)
                time.sleep(2)
        except KeyboardInterrupt:
            console.echo("")
            console.muted("Stopped watching.")
    else:
        running = display_status(deps, host, port, as_json, full, watch=False)
        sys.exit(0 if running else 1)
