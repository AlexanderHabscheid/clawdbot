"""
Centris CLI - Network Health Checks

Checks for network connectivity, ports, and server status.
"""

import socket
import urllib.request
import urllib.error
import json
from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:
    from centris_sdk.cli.doctor import DoctorResult
    from centris_sdk.cli.doctor.prompter import DoctorPrompter, DoctorOptions


DEFAULT_PORT = 5001


def note_network_health(
    result: "DoctorResult",
    prompter: "DoctorPrompter",
    options: "DoctorOptions",
) -> None:
    """
    Check network health including ports and connectivity.
    
    Args:
        result: DoctorResult to add checks to
        prompter: Prompter for interactive questions
        options: Doctor command options
    """
    # Check server port
    _check_server_port(result, DEFAULT_PORT)
    
    # Check backend health endpoint
    _check_backend_health(result, DEFAULT_PORT)
    
    # Check extension connectivity
    _check_extension_connection(result, DEFAULT_PORT)


def _check_server_port(result: "DoctorResult", port: int) -> None:
    """Check if the server port is available or in use by Centris."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(1)
            conn_result = s.connect_ex(("127.0.0.1", port))
            
            if conn_result == 0:
                # Port is in use - check if it's Centris
                if _is_centris_server(port):
                    result.add_check(
                        name=f"Port {port}",
                        status="pass",
                        message="In use by Centris (server running)",
                        category="network",
                    )
                else:
                    result.add_check(
                        name=f"Port {port}",
                        status="warn",
                        message="In use by another process",
                        category="network",
                        fix_hint=f"Stop the process using port {port} or use --port",
                    )
            else:
                result.add_check(
                    name=f"Port {port}",
                    status="pass",
                    message="Available",
                    category="network",
                )
    except Exception as e:
        result.add_check(
            name=f"Port {port}",
            status="warn",
            message=f"Could not check: {e}",
            category="network",
        )


def _is_centris_server(port: int) -> bool:
    """Check if the port is being used by a Centris server."""
    try:
        url = f"http://127.0.0.1:{port}/api/health"
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=2) as response:
            data = json.loads(response.read().decode())
            # Check for Centris-specific response
            return "status" in data or "centris" in str(data).lower()
    except Exception:
        return False


def _check_backend_health(result: "DoctorResult", port: int) -> None:
    """Check if the backend health endpoint responds."""
    try:
        url = f"http://127.0.0.1:{port}/api/health"
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        
        with urllib.request.urlopen(req, timeout=5) as response:
            data = json.loads(response.read().decode())
            status = data.get("status", "unknown")
            
            if status == "healthy" or status == "ok":
                result.add_check(
                    name="Backend server",
                    status="pass",
                    message=f"Running on port {port}",
                    category="network",
                )
            else:
                result.add_check(
                    name="Backend server",
                    status="warn",
                    message=f"Status: {status}",
                    category="network",
                )
    
    except urllib.error.URLError as e:
        if "Connection refused" in str(e):
            result.add_check(
                name="Backend server",
                status="skip",
                message="Not running",
                category="network",
                fix_hint="Start the server with 'centris run'",
            )
        else:
            result.add_check(
                name="Backend server",
                status="warn",
                message=f"Connection error: {e.reason}",
                category="network",
            )
    
    except Exception as e:
        result.add_check(
            name="Backend server",
            status="warn",
            message=f"Could not check: {e}",
            category="network",
        )


def _check_extension_connection(result: "DoctorResult", port: int) -> None:
    """Check if the Chrome extension is connected."""
    try:
        url = f"http://127.0.0.1:{port}/api/health"
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        
        with urllib.request.urlopen(req, timeout=3) as response:
            data = json.loads(response.read().decode())
            
            # Check for extension status in health response
            extension_connected = data.get("extension_connected", False)
            
            if extension_connected:
                result.add_check(
                    name="Chrome extension",
                    status="pass",
                    message="Connected",
                    category="network",
                )
            else:
                result.add_check(
                    name="Chrome extension",
                    status="warn",
                    message="Not connected",
                    category="network",
                    fix_hint="Install and enable the Centris Chrome extension",
                )
    
    except urllib.error.URLError:
        result.add_check(
            name="Chrome extension",
            status="skip",
            message="Server not running",
            category="network",
        )
    
    except Exception as e:
        result.add_check(
            name="Chrome extension",
            status="skip",
            message=f"Could not check: {e}",
            category="network",
        )
