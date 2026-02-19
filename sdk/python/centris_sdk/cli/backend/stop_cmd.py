"""
Centris CLI - Stop Command

Stop the Centris backend server gracefully.
"""

import click
import sys
import os
import signal
import json
from pathlib import Path
from typing import Optional
import urllib.request
import urllib.error

from centris_sdk.cli.theme import theme, symbols, styled_success, styled_error, styled_warning
from centris_sdk.cli.progress import Spinner


def _check_server_running(host: str, port: int) -> Optional[dict]:
    """Check if the server is running and get health info."""
    try:
        url = f"http://{host}:{port}/api/health"
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=3) as response:
            return json.loads(response.read().decode())
    except urllib.error.URLError:
        return None
    except Exception:
        return None


def _get_pid_file() -> Path:
    """Get the PID file path."""
    return Path.home() / ".centris" / "server.pid"


def _read_pid() -> Optional[int]:
    """Read PID from file if it exists."""
    pid_file = _get_pid_file()
    if pid_file.exists():
        try:
            return int(pid_file.read_text().strip())
        except (ValueError, IOError):
            return None
    return None


def _remove_pid_file() -> None:
    """Remove the PID file."""
    pid_file = _get_pid_file()
    if pid_file.exists():
        try:
            pid_file.unlink()
        except IOError:
            pass


def _find_process_by_port(port: int) -> Optional[int]:
    """Find process ID listening on the given port."""
    import subprocess
    
    try:
        # macOS / Linux
        if sys.platform == "darwin":
            result = subprocess.run(
                ["lsof", "-ti", f":{port}"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if result.returncode == 0 and result.stdout.strip():
                # May return multiple PIDs, take first
                pids = result.stdout.strip().split("\n")
                return int(pids[0])
        elif sys.platform == "linux":
            result = subprocess.run(
                ["fuser", "-n", "tcp", str(port)],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if result.returncode == 0 and result.stdout.strip():
                return int(result.stdout.strip().split()[0])
        elif sys.platform == "win32":
            result = subprocess.run(
                ["netstat", "-ano", "-p", "tcp"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            for line in result.stdout.split("\n"):
                if f":{port}" in line and "LISTENING" in line:
                    parts = line.split()
                    if parts:
                        return int(parts[-1])
    except (subprocess.TimeoutExpired, subprocess.CalledProcessError, ValueError):
        pass
    
    return None


def _kill_process(pid: int, force: bool = False) -> bool:
    """Kill a process by PID."""
    try:
        if force:
            os.kill(pid, signal.SIGKILL)
        else:
            os.kill(pid, signal.SIGTERM)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return False


def _wait_for_shutdown(host: str, port: int, timeout: int = 10) -> bool:
    """Wait for the server to shut down."""
    import time
    
    start = time.time()
    while time.time() - start < timeout:
        if not _check_server_running(host, port):
            return True
        time.sleep(0.5)
    return False


@click.command("stop")
@click.option("--host", "-h", default="127.0.0.1", help="Server host to stop")
@click.option("--port", "-p", type=int, default=5001, help="Server port to stop")
@click.option("--force", "-f", is_flag=True, help="Force kill (SIGKILL)")
@click.option("--json", "as_json", is_flag=True, help="Output as JSON")
@click.pass_context
def stop_command(
    ctx: click.Context,
    host: str,
    port: int,
    force: bool,
    as_json: bool,
) -> None:
    """
    Stop the Centris backend server.
    
    Gracefully stops the running Centris backend server.
    First attempts a graceful shutdown, then falls back to
    process termination if needed.
    
    Examples:
    
        centris stop                    Stop default server
        
        centris stop --port 5002        Stop server on custom port
        
        centris stop --force            Force kill if hung
    """
    # Check if server is running
    health = _check_server_running(host, port)
    
    if not health:
        if as_json:
            click.echo(json.dumps({"success": True, "message": "Server not running"}))
        else:
            click.echo(f"{theme.muted(symbols.BULLET)} Server not running at http://{host}:{port}")
        return
    
    if as_json:
        # JSON mode - attempt shutdown and report
        pid = _read_pid() or _find_process_by_port(port)
        
        if pid:
            killed = _kill_process(pid, force=force)
            if killed:
                _wait_for_shutdown(host, port, timeout=5)
                _remove_pid_file()
                click.echo(json.dumps({"success": True, "pid": pid, "message": "Server stopped"}))
            else:
                click.echo(json.dumps({"success": False, "pid": pid, "message": "Failed to stop"}))
                sys.exit(1)
        else:
            click.echo(json.dumps({"success": False, "message": "Could not find server process"}))
            sys.exit(1)
        return
    
    # Interactive mode
    click.echo(f"{theme.heading(f'{symbols.LOGO} Stopping Centris')}")
    click.echo()
    click.echo(f"  {theme.muted('Server:')} http://{host}:{port}")
    click.echo()
    
    # Try to find the PID
    pid = _read_pid()
    source = "PID file"
    
    if not pid:
        pid = _find_process_by_port(port)
        source = "port scan"
    
    if not pid:
        click.echo(styled_warning(f"Could not find server process. Server may have started externally."))
        click.echo(f"  {theme.muted('Hint:')} Use {theme.command('lsof -i :' + str(port))} to find the process")
        sys.exit(1)
    
    click.echo(f"  {theme.muted('PID:')} {theme.info(str(pid))} ({source})")
    click.echo()
    
    # Attempt graceful shutdown
    with Spinner(f"Stopping server (PID {pid})...") as spin:
        signal_type = "SIGKILL" if force else "SIGTERM"
        spin.update(f"Sending {signal_type} to {pid}...")
        
        killed = _kill_process(pid, force=force)
        
        if not killed:
            spin.fail(f"Failed to send signal to process {pid}")
            click.echo(f"  {theme.muted('Hint:')} Try with {theme.command('sudo')} or check permissions")
            sys.exit(1)
        
        # Wait for shutdown
        spin.update("Waiting for shutdown...")
        if _wait_for_shutdown(host, port, timeout=10 if not force else 3):
            spin.success("Server stopped")
        else:
            if not force:
                spin.update("Graceful shutdown timed out, trying force kill...")
                _kill_process(pid, force=True)
                if _wait_for_shutdown(host, port, timeout=3):
                    spin.success("Server stopped (forced)")
                else:
                    spin.fail("Server did not stop")
                    sys.exit(1)
            else:
                spin.fail("Server did not stop")
                sys.exit(1)
    
    # Cleanup
    _remove_pid_file()
    
    click.echo()
    click.echo(styled_success("Centris backend stopped"))
