"""
Centris CLI Daemon Commands

Manage the Centris backend as a background service/daemon.

Commands:
    centris daemon install    Install daemon service
    centris daemon start      Start the daemon
    centris daemon stop       Stop the daemon
    centris daemon status     Check daemon status
    centris daemon logs       View daemon logs
    centris daemon uninstall  Remove daemon service
"""

import json
import os
import platform
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, Optional

import click

from centris_sdk.cli.theme import theme, symbols
from centris_sdk.cli.progress import Spinner
from centris_sdk.cli.errors import CentrisCLIError, ExitCode


# Platform-specific paths
SYSTEM = platform.system()

def get_daemon_paths() -> Dict[str, Path]:
    """Get platform-specific paths for daemon management."""
    home = Path.home()
    
    if SYSTEM == "Darwin":  # macOS
        return {
            "plist": home / "Library/LaunchAgents/ai.centris.backend.plist",
            "log_dir": home / "Library/Logs/Centris",
            "pid_file": home / ".centris/daemon.pid",
            "config_dir": home / ".centris",
        }
    elif SYSTEM == "Linux":
        return {
            "service": home / ".config/systemd/user/centris-backend.service",
            "log_dir": home / ".local/share/centris/logs",
            "pid_file": home / ".centris/daemon.pid",
            "config_dir": home / ".centris",
        }
    else:  # Windows or other
        return {
            "log_dir": home / ".centris/logs",
            "pid_file": home / ".centris/daemon.pid",
            "config_dir": home / ".centris",
        }


def find_backend_script() -> Optional[Path]:
    """Find the backend main.py script."""
    candidates = [
        Path.cwd() / "backend" / "main.py",
        Path.cwd().parent / "backend" / "main.py",
        Path(__file__).resolve().parent.parent.parent.parent.parent.parent / "backend" / "main.py",
    ]
    
    for candidate in candidates:
        if candidate.exists():
            return candidate
    
    return None


def find_python_executable() -> str:
    """Find the Python executable to use."""
    # Check for virtual environment
    venv_python = Path.cwd() / "backend" / "venv" / "bin" / "python"
    if venv_python.exists():
        return str(venv_python)
    
    venv_python = Path.cwd() / "venv" / "bin" / "python"
    if venv_python.exists():
        return str(venv_python)
    
    return sys.executable


def is_daemon_running() -> tuple[bool, Optional[int]]:
    """Check if the daemon is running. Returns (is_running, pid)."""
    paths = get_daemon_paths()
    pid_file = paths["pid_file"]
    
    if not pid_file.exists():
        return False, None
    
    try:
        pid = int(pid_file.read_text().strip())
        
        # Check if process is running
        try:
            os.kill(pid, 0)  # Signal 0 just checks if process exists
            return True, pid
        except ProcessLookupError:
            # Process not running, clean up stale PID file
            pid_file.unlink()
            return False, None
        except PermissionError:
            # Process exists but we can't signal it
            return True, pid
    except (ValueError, FileNotFoundError):
        return False, None


def generate_macos_plist(
    backend_path: Path,
    python_path: str,
    port: int = 5001,
    log_dir: Path = None,
) -> str:
    """Generate macOS launchd plist content."""
    paths = get_daemon_paths()
    log_dir = log_dir or paths["log_dir"]
    
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>ai.centris.backend</string>
    
    <key>ProgramArguments</key>
    <array>
        <string>{python_path}</string>
        <string>-m</string>
        <string>backend.main</string>
    </array>
    
    <key>WorkingDirectory</key>
    <string>{backend_path.parent}</string>
    
    <key>EnvironmentVariables</key>
    <dict>
        <key>PORT</key>
        <string>{port}</string>
    </dict>
    
    <key>StandardOutPath</key>
    <string>{log_dir}/centris-backend.log</string>
    
    <key>StandardErrorPath</key>
    <string>{log_dir}/centris-backend.error.log</string>
    
    <key>RunAtLoad</key>
    <false/>
    
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
</dict>
</plist>
"""


def generate_linux_service(
    backend_path: Path,
    python_path: str,
    port: int = 5001,
) -> str:
    """Generate Linux systemd service content."""
    return f"""[Unit]
Description=Centris Backend Server
After=network.target

[Service]
Type=simple
ExecStart={python_path} -m backend.main
WorkingDirectory={backend_path.parent}
Environment=PORT={port}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
"""


# =============================================================================
# Daemon Command Group
# =============================================================================

@click.group(name="daemon")
@click.pass_context
def daemon_group(ctx: click.Context):
    """
    Manage the Centris backend daemon.
    
    Run the Centris backend as a background service that starts
    automatically and stays running.
    
    \b
    Examples:
      centris daemon install    # Install the service
      centris daemon start      # Start the daemon
      centris daemon status     # Check if running
      centris daemon logs       # View logs
      centris daemon stop       # Stop the daemon
    
    \b
    Docs: https://docs.centris.ai/sdk/cli/daemon
    """
    ctx.ensure_object(dict)


@daemon_group.command(name="install")
@click.option("--port", "-p", type=int, default=5001, help="Port for backend server")
@click.option("--start", is_flag=True, help="Start daemon after install")
@click.option("--json", "json_output", is_flag=True, help="Output as JSON")
@click.pass_context
def install_command(ctx: click.Context, port: int, start: bool, json_output: bool):
    """
    Install the daemon service.
    
    Creates the necessary service files for your platform to run
    the Centris backend as a background service.
    
    \b
    Examples:
      centris daemon install
      centris daemon install --port 5002
      centris daemon install --start
    """
    json_output = json_output or ctx.obj.get("json_output", False)
    paths = get_daemon_paths()
    
    # Find backend script
    backend_path = find_backend_script()
    if not backend_path:
        result = {"success": False, "error": "Backend not found. Run from project root."}
        if json_output:
            click.echo(json.dumps(result, indent=2))
        else:
            click.echo(f"{theme.error(symbols.CROSS)} {result['error']}")
        ctx.exit(ExitCode.ERROR)
    
    python_path = find_python_executable()
    
    # Create log directory
    paths["log_dir"].mkdir(parents=True, exist_ok=True)
    paths["config_dir"].mkdir(parents=True, exist_ok=True)
    
    try:
        if SYSTEM == "Darwin":
            # macOS: Create launchd plist
            plist_content = generate_macos_plist(backend_path, python_path, port, paths["log_dir"])
            plist_path = paths["plist"]
            plist_path.parent.mkdir(parents=True, exist_ok=True)
            plist_path.write_text(plist_content)
            
            result = {
                "success": True,
                "platform": "macos",
                "service_file": str(plist_path),
                "log_dir": str(paths["log_dir"]),
            }
            
        elif SYSTEM == "Linux":
            # Linux: Create systemd service
            service_content = generate_linux_service(backend_path, python_path, port)
            service_path = paths["service"]
            service_path.parent.mkdir(parents=True, exist_ok=True)
            service_path.write_text(service_content)
            
            # Reload systemd
            subprocess.run(["systemctl", "--user", "daemon-reload"], check=True, capture_output=True)
            
            result = {
                "success": True,
                "platform": "linux",
                "service_file": str(service_path),
            }
            
        else:
            result = {"success": False, "error": f"Platform {SYSTEM} not supported for daemon install"}
            if json_output:
                click.echo(json.dumps(result, indent=2))
            else:
                click.echo(f"{theme.error(symbols.CROSS)} {result['error']}")
            ctx.exit(ExitCode.ERROR)
        
        if json_output:
            click.echo(json.dumps(result, indent=2))
        else:
            click.echo(f"{theme.success(symbols.CHECK)} Daemon service installed")
            click.echo(f"{theme.muted('Service file:')} {result.get('service_file')}")
            click.echo(f"\n{theme.muted('Start with:')} centris daemon start")
        
        # Optionally start
        if start:
            ctx.invoke(start_command)
            
    except Exception as e:
        result = {"success": False, "error": str(e)}
        if json_output:
            click.echo(json.dumps(result, indent=2))
        else:
            click.echo(f"{theme.error(symbols.CROSS)} Installation failed: {e}")
        ctx.exit(ExitCode.ERROR)


@daemon_group.command(name="start")
@click.option("--json", "json_output", is_flag=True, help="Output as JSON")
@click.pass_context
def start_command(ctx: click.Context, json_output: bool):
    """
    Start the daemon.
    
    Starts the Centris backend as a background service.
    """
    json_output = json_output or ctx.obj.get("json_output", False)
    paths = get_daemon_paths()
    
    # Check if already running
    running, pid = is_daemon_running()
    if running:
        result = {"success": True, "status": "already_running", "pid": pid}
        if json_output:
            click.echo(json.dumps(result, indent=2))
        else:
            click.echo(f"{theme.warn('!')} Daemon already running (PID: {pid})")
        return
    
    try:
        if SYSTEM == "Darwin":
            plist_path = paths["plist"]
            if not plist_path.exists():
                result = {"success": False, "error": "Service not installed. Run: centris daemon install"}
                if json_output:
                    click.echo(json.dumps(result, indent=2))
                else:
                    click.echo(f"{theme.error(symbols.CROSS)} {result['error']}")
                ctx.exit(ExitCode.ERROR)
            
            subprocess.run(["launchctl", "load", str(plist_path)], check=True, capture_output=True)
            
        elif SYSTEM == "Linux":
            subprocess.run(["systemctl", "--user", "start", "centris-backend"], check=True, capture_output=True)
            
        else:
            # Fallback: Start process directly and save PID
            backend_path = find_backend_script()
            if not backend_path:
                result = {"success": False, "error": "Backend not found"}
                if json_output:
                    click.echo(json.dumps(result, indent=2))
                else:
                    click.echo(f"{theme.error(symbols.CROSS)} {result['error']}")
                ctx.exit(ExitCode.ERROR)
            
            python_path = find_python_executable()
            
            # Start in background
            process = subprocess.Popen(
                [python_path, "-m", "backend.main"],
                cwd=str(backend_path.parent),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
            
            # Save PID
            paths["pid_file"].parent.mkdir(parents=True, exist_ok=True)
            paths["pid_file"].write_text(str(process.pid))
        
        # Wait a moment and verify
        time.sleep(1)
        running, pid = is_daemon_running()
        
        if running:
            result = {"success": True, "status": "started", "pid": pid}
            if json_output:
                click.echo(json.dumps(result, indent=2))
            else:
                click.echo(f"{theme.success(symbols.CHECK)} Daemon started (PID: {pid})")
        else:
            result = {"success": False, "error": "Daemon failed to start. Check logs."}
            if json_output:
                click.echo(json.dumps(result, indent=2))
            else:
                click.echo(f"{theme.error(symbols.CROSS)} {result['error']}")
                click.echo(f"{theme.muted('View logs:')} centris daemon logs")
            ctx.exit(ExitCode.ERROR)
            
    except subprocess.CalledProcessError as e:
        result = {"success": False, "error": f"Failed to start: {e.stderr.decode() if e.stderr else str(e)}"}
        if json_output:
            click.echo(json.dumps(result, indent=2))
        else:
            click.echo(f"{theme.error(symbols.CROSS)} {result['error']}")
        ctx.exit(ExitCode.ERROR)
    except Exception as e:
        result = {"success": False, "error": str(e)}
        if json_output:
            click.echo(json.dumps(result, indent=2))
        else:
            click.echo(f"{theme.error(symbols.CROSS)} {result['error']}")
        ctx.exit(ExitCode.ERROR)


@daemon_group.command(name="stop")
@click.option("--json", "json_output", is_flag=True, help="Output as JSON")
@click.pass_context
def stop_command(ctx: click.Context, json_output: bool):
    """
    Stop the daemon.
    
    Stops the Centris backend background service.
    """
    json_output = json_output or ctx.obj.get("json_output", False)
    paths = get_daemon_paths()
    
    running, pid = is_daemon_running()
    if not running:
        result = {"success": True, "status": "not_running"}
        if json_output:
            click.echo(json.dumps(result, indent=2))
        else:
            click.echo(f"{theme.muted('Daemon is not running')}")
        return
    
    try:
        if SYSTEM == "Darwin":
            plist_path = paths["plist"]
            if plist_path.exists():
                subprocess.run(["launchctl", "unload", str(plist_path)], check=True, capture_output=True)
            else:
                # Kill process directly
                os.kill(pid, signal.SIGTERM)
                
        elif SYSTEM == "Linux":
            subprocess.run(["systemctl", "--user", "stop", "centris-backend"], check=True, capture_output=True)
            
        else:
            # Kill process directly
            if pid:
                os.kill(pid, signal.SIGTERM)
        
        # Clean up PID file
        if paths["pid_file"].exists():
            paths["pid_file"].unlink()
        
        result = {"success": True, "status": "stopped"}
        if json_output:
            click.echo(json.dumps(result, indent=2))
        else:
            click.echo(f"{theme.success(symbols.CHECK)} Daemon stopped")
            
    except ProcessLookupError:
        # Process already gone
        if paths["pid_file"].exists():
            paths["pid_file"].unlink()
        result = {"success": True, "status": "stopped"}
        if json_output:
            click.echo(json.dumps(result, indent=2))
        else:
            click.echo(f"{theme.success(symbols.CHECK)} Daemon stopped")
    except Exception as e:
        result = {"success": False, "error": str(e)}
        if json_output:
            click.echo(json.dumps(result, indent=2))
        else:
            click.echo(f"{theme.error(symbols.CROSS)} {result['error']}")
        ctx.exit(ExitCode.ERROR)


@daemon_group.command(name="status")
@click.option("--json", "json_output", is_flag=True, help="Output as JSON")
@click.pass_context
def status_command(ctx: click.Context, json_output: bool):
    """
    Check daemon status.
    
    Shows whether the daemon is running and basic health info.
    """
    json_output = json_output or ctx.obj.get("json_output", False)
    
    running, pid = is_daemon_running()
    
    # Try to get backend health
    backend_health = None
    if running:
        try:
            import socket
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(1)
            result = sock.connect_ex(("127.0.0.1", 5001))
            sock.close()
            backend_health = "healthy" if result == 0 else "unhealthy"
        except Exception:
            backend_health = "unknown"
    
    result = {
        "running": running,
        "pid": pid,
        "backend_health": backend_health,
        "platform": SYSTEM,
    }
    
    if json_output:
        click.echo(json.dumps(result, indent=2))
    else:
        if running:
            click.echo(f"{theme.success(symbols.CHECK)} Daemon is running (PID: {pid})")
            if backend_health == "healthy":
                click.echo(f"  {theme.muted('Backend:')} {theme.success('healthy')}")
            elif backend_health == "unhealthy":
                click.echo(f"  {theme.muted('Backend:')} {theme.error('unhealthy')}")
        else:
            click.echo(f"{theme.muted('Daemon is not running')}")
            click.echo(f"\n{theme.muted('Start with:')} centris daemon start")


@daemon_group.command(name="logs")
@click.option("--follow", "-f", is_flag=True, help="Follow log output")
@click.option("--lines", "-n", type=int, default=50, help="Number of lines to show")
@click.option("--error", is_flag=True, help="Show error log instead of main log")
@click.pass_context
def logs_command(ctx: click.Context, follow: bool, lines: int, error: bool):
    """
    View daemon logs.
    
    Shows the backend server logs.
    
    \b
    Examples:
      centris daemon logs
      centris daemon logs -f           # Follow logs
      centris daemon logs -n 100       # Last 100 lines
      centris daemon logs --error      # Error log
    """
    paths = get_daemon_paths()
    log_dir = paths["log_dir"]
    
    if error:
        log_file = log_dir / "centris-backend.error.log"
    else:
        log_file = log_dir / "centris-backend.log"
    
    if not log_file.exists():
        click.echo(f"{theme.muted('No logs found at:')} {log_file}")
        click.echo(f"{theme.muted('Daemon may not have been started yet.')}")
        return
    
    if follow:
        # Use tail -f
        try:
            subprocess.run(["tail", "-f", str(log_file)])
        except KeyboardInterrupt:
            pass
    else:
        # Show last N lines
        try:
            result = subprocess.run(
                ["tail", f"-{lines}", str(log_file)],
                capture_output=True,
                text=True,
            )
            click.echo(result.stdout)
        except FileNotFoundError:
            # tail not available, read manually
            content = log_file.read_text()
            log_lines = content.split("\n")[-lines:]
            click.echo("\n".join(log_lines))


@daemon_group.command(name="uninstall")
@click.option("--force", "-f", is_flag=True, help="Don't prompt for confirmation")
@click.option("--json", "json_output", is_flag=True, help="Output as JSON")
@click.pass_context
def uninstall_command(ctx: click.Context, force: bool, json_output: bool):
    """
    Uninstall the daemon service.
    
    Removes the service files and stops the daemon if running.
    """
    json_output = json_output or ctx.obj.get("json_output", False)
    paths = get_daemon_paths()
    
    # Confirm
    if not force and not json_output:
        if not click.confirm("Uninstall Centris daemon service?"):
            click.echo(f"{theme.muted('Cancelled')}")
            return
    
    # Stop if running
    running, _ = is_daemon_running()
    if running:
        ctx.invoke(stop_command, json_output=True)
    
    try:
        if SYSTEM == "Darwin":
            plist_path = paths["plist"]
            if plist_path.exists():
                plist_path.unlink()
                
        elif SYSTEM == "Linux":
            service_path = paths["service"]
            if service_path.exists():
                service_path.unlink()
            subprocess.run(["systemctl", "--user", "daemon-reload"], capture_output=True)
        
        # Clean up PID file
        if paths["pid_file"].exists():
            paths["pid_file"].unlink()
        
        result = {"success": True, "status": "uninstalled"}
        if json_output:
            click.echo(json.dumps(result, indent=2))
        else:
            click.echo(f"{theme.success(symbols.CHECK)} Daemon service uninstalled")
            
    except Exception as e:
        result = {"success": False, "error": str(e)}
        if json_output:
            click.echo(json.dumps(result, indent=2))
        else:
            click.echo(f"{theme.error(symbols.CROSS)} {result['error']}")
        ctx.exit(ExitCode.ERROR)


__all__ = ["daemon_group"]
