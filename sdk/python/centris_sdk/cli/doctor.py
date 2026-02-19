"""
Centris CLI - Standalone Health Checks

Provides health check functions that work without the full backend.
These are used as fallbacks when backend.health.checks is unavailable.
"""

import os
import sys
import shutil
import socket
import subprocess
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Optional, List, Dict, Callable, Any


# =============================================================================
# Check Result Types
# =============================================================================

class CheckStatus(str, Enum):
    """Status of a health check."""
    PASS = "pass"
    WARN = "warn"
    FAIL = "fail"
    SKIP = "skip"


@dataclass
class CheckResult:
    """Result of a single health check."""
    name: str
    status: CheckStatus
    message: str = ""
    category: str = "general"
    fix_hint: Optional[str] = None
    details: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "status": self.status.value,
            "message": self.message,
            "category": self.category,
            "fix_hint": self.fix_hint,
            "details": self.details,
        }


@dataclass
class CheckResults:
    """Aggregated results of all health checks."""
    results: List[CheckResult] = field(default_factory=list)
    
    @property
    def passed(self) -> int:
        return sum(1 for r in self.results if r.status == CheckStatus.PASS)
    
    @property
    def warnings(self) -> int:
        return sum(1 for r in self.results if r.status == CheckStatus.WARN)
    
    @property
    def failed(self) -> int:
        return sum(1 for r in self.results if r.status == CheckStatus.FAIL)
    
    @property
    def skipped(self) -> int:
        return sum(1 for r in self.results if r.status == CheckStatus.SKIP)
    
    @property
    def all_passed(self) -> bool:
        return self.failed == 0
    
    def by_category(self) -> Dict[str, List[CheckResult]]:
        """Group results by category."""
        groups: Dict[str, List[CheckResult]] = {}
        for result in self.results:
            if result.category not in groups:
                groups[result.category] = []
            groups[result.category].append(result)
        return groups
    
    def to_dict(self) -> dict:
        return {
            "results": [r.to_dict() for r in self.results],
            "summary": {
                "passed": self.passed,
                "warnings": self.warnings,
                "failed": self.failed,
                "skipped": self.skipped,
                "all_passed": self.all_passed,
            },
        }


# =============================================================================
# Individual Health Checks
# =============================================================================

def check_python_version() -> CheckResult:
    """Check Python version is supported."""
    version = sys.version_info
    
    if version >= (3, 10):
        return CheckResult(
            name="Python version",
            status=CheckStatus.PASS,
            message=f"Python {version.major}.{version.minor}.{version.micro}",
            category="environment",
            details={"version": f"{version.major}.{version.minor}.{version.micro}"},
        )
    elif version >= (3, 8):
        return CheckResult(
            name="Python version",
            status=CheckStatus.WARN,
            message=f"Python {version.major}.{version.minor} (3.10+ recommended)",
            category="environment",
            fix_hint="Upgrade to Python 3.10 or later for best compatibility",
        )
    else:
        return CheckResult(
            name="Python version",
            status=CheckStatus.FAIL,
            message=f"Python {version.major}.{version.minor} is not supported",
            category="environment",
            fix_hint="Install Python 3.10 or later",
        )


def check_api_key(name: str, env_var: str, required: bool = True) -> CheckResult:
    """Check if an API key is configured."""
    value = os.environ.get(env_var, "")
    
    if value:
        # Mask the key for display
        masked = value[:4] + "***" + value[-4:] if len(value) > 8 else "***"
        return CheckResult(
            name=f"{name} API key",
            status=CheckStatus.PASS,
            message=f"Configured ({masked})",
            category="environment",
            details={"env_var": env_var, "set": True},
        )
    elif required:
        return CheckResult(
            name=f"{name} API key",
            status=CheckStatus.FAIL,
            message="Not configured",
            category="environment",
            fix_hint=f"Set {env_var} in your .env file",
            details={"env_var": env_var, "set": False},
        )
    else:
        return CheckResult(
            name=f"{name} API key",
            status=CheckStatus.WARN,
            message="Not configured (optional)",
            category="environment",
            fix_hint=f"Set {env_var} to enable {name} features",
            details={"env_var": env_var, "set": False},
        )


def check_deepseek_api_key() -> CheckResult:
    """Check DeepSeek API key."""
    return check_api_key("DeepSeek", "DEEPSEEK_API_KEY", required=True)


def check_deepgram_api_key() -> CheckResult:
    """Check Deepgram API key."""
    return check_api_key("Deepgram", "DEEPGRAM_API_KEY", required=True)


def check_openai_api_key() -> CheckResult:
    """Check OpenAI API key."""
    return check_api_key("OpenAI", "OPENAI_API_KEY", required=False)


def check_anthropic_api_key() -> CheckResult:
    """Check Anthropic API key."""
    return check_api_key("Anthropic", "ANTHROPIC_API_KEY", required=False)


def check_gemini_api_key() -> CheckResult:
    """Check Gemini API key."""
    return check_api_key("Gemini", "GEMINI_API_KEY", required=False)


def check_port_available(port: int = 5001) -> CheckResult:
    """Check if the server port is available."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(1)
            result = s.connect_ex(("127.0.0.1", port))
            
            if result == 0:
                # Port is in use - check if it's Centris
                import urllib.request
                import urllib.error
                
                try:
                    url = f"http://127.0.0.1:{port}/api/health"
                    req = urllib.request.Request(url, headers={"Accept": "application/json"})
                    with urllib.request.urlopen(req, timeout=2):
                        return CheckResult(
                            name=f"Port {port}",
                            status=CheckStatus.PASS,
                            message="In use by Centris (server running)",
                            category="connections",
                            details={"port": port, "available": False, "is_centris": True},
                        )
                except:
                    return CheckResult(
                        name=f"Port {port}",
                        status=CheckStatus.WARN,
                        message="In use by another process",
                        category="connections",
                        fix_hint=f"Stop the process using port {port} or use --port to specify another",
                        details={"port": port, "available": False, "is_centris": False},
                    )
            else:
                return CheckResult(
                    name=f"Port {port}",
                    status=CheckStatus.PASS,
                    message="Available",
                    category="connections",
                    details={"port": port, "available": True},
                )
    except Exception as e:
        return CheckResult(
            name=f"Port {port}",
            status=CheckStatus.WARN,
            message=f"Could not check: {e}",
            category="connections",
            details={"port": port, "error": str(e)},
        )


def check_chrome_extension() -> CheckResult:
    """Check if Chrome extension connection is available."""
    import urllib.request
    import urllib.error
    import json
    
    try:
        # Check server first
        url = "http://127.0.0.1:5001/api/health"
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=3) as response:
            health = json.loads(response.read().decode())
            
            # Check for extension status in health response
            if health.get("extension_connected"):
                return CheckResult(
                    name="Chrome extension",
                    status=CheckStatus.PASS,
                    message="Connected",
                    category="connections",
                    details={"connected": True},
                )
            else:
                return CheckResult(
                    name="Chrome extension",
                    status=CheckStatus.WARN,
                    message="Not connected",
                    category="connections",
                    fix_hint="Install and enable the Centris Chrome extension",
                    details={"connected": False},
                )
    except urllib.error.URLError:
        return CheckResult(
            name="Chrome extension",
            status=CheckStatus.SKIP,
            message="Server not running",
            category="connections",
            details={"connected": False, "server_running": False},
        )
    except Exception as e:
        return CheckResult(
            name="Chrome extension",
            status=CheckStatus.SKIP,
            message=f"Could not check: {e}",
            category="connections",
            details={"error": str(e)},
        )


def check_dependency(name: str, package: str) -> CheckResult:
    """Check if a Python package is installed."""
    try:
        __import__(package)
        return CheckResult(
            name=name,
            status=CheckStatus.PASS,
            category="dependencies",
            details={"package": package, "installed": True},
        )
    except ImportError:
        return CheckResult(
            name=name,
            status=CheckStatus.FAIL,
            message="Not installed",
            category="dependencies",
            fix_hint=f"Run: pip install {package}",
            details={"package": package, "installed": False},
        )


def check_click() -> CheckResult:
    """Check Click dependency."""
    return check_dependency("Click", "click")


def check_httpx() -> CheckResult:
    """Check httpx dependency."""
    return check_dependency("httpx", "httpx")


def check_flask() -> CheckResult:
    """Check Flask dependency."""
    return check_dependency("Flask", "flask")


def check_socketio() -> CheckResult:
    """Check Flask-SocketIO dependency."""
    return check_dependency("Flask-SocketIO", "flask_socketio")


def check_dotenv() -> CheckResult:
    """Check python-dotenv dependency."""
    return check_dependency("python-dotenv", "dotenv")


def check_env_file() -> CheckResult:
    """Check if .env file exists."""
    # Check common locations
    locations = [
        Path.cwd() / ".env",
        Path.cwd() / "backend" / ".env",
        Path.cwd().parent / ".env",
    ]
    
    for loc in locations:
        if loc.exists():
            return CheckResult(
                name=".env file",
                status=CheckStatus.PASS,
                message=f"Found at {loc}",
                category="environment",
                details={"path": str(loc), "found": True},
            )
    
    return CheckResult(
        name=".env file",
        status=CheckStatus.WARN,
        message="Not found",
        category="environment",
        fix_hint="Create a .env file from .env.example",
        details={"found": False},
    )


def check_ffmpeg() -> CheckResult:
    """Check if FFmpeg is available."""
    if shutil.which("ffmpeg"):
        try:
            result = subprocess.run(
                ["ffmpeg", "-version"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            version_line = result.stdout.split("\n")[0] if result.stdout else "Unknown version"
            return CheckResult(
                name="FFmpeg",
                status=CheckStatus.PASS,
                message=version_line[:50],
                category="dependencies",
                details={"installed": True},
            )
        except:
            return CheckResult(
                name="FFmpeg",
                status=CheckStatus.PASS,
                category="dependencies",
                details={"installed": True},
            )
    else:
        return CheckResult(
            name="FFmpeg",
            status=CheckStatus.WARN,
            message="Not found (optional for audio processing)",
            category="dependencies",
            fix_hint="Install FFmpeg: brew install ffmpeg (macOS) or apt install ffmpeg (Linux)",
            details={"installed": False},
        )


def check_centris_directory() -> CheckResult:
    """Check if ~/.centris directory exists."""
    centris_dir = Path.home() / ".centris"
    
    if centris_dir.exists():
        connectors_dir = centris_dir / "connectors"
        connector_count = 0
        if connectors_dir.exists():
            connector_count = len(list(connectors_dir.iterdir()))
        
        return CheckResult(
            name="Centris directory",
            status=CheckStatus.PASS,
            message=f"{centris_dir} ({connector_count} connectors)",
            category="connectors",
            details={"path": str(centris_dir), "exists": True, "connector_count": connector_count},
        )
    else:
        return CheckResult(
            name="Centris directory",
            status=CheckStatus.WARN,
            message="Not created yet",
            category="connectors",
            fix_hint="Run 'centris init' to create the directory structure",
            details={"path": str(centris_dir), "exists": False},
        )


# =============================================================================
# Check Registry
# =============================================================================

def get_default_checks() -> List[Callable[[], CheckResult]]:
    """Get the default list of health checks."""
    return [
        # Environment
        check_python_version,
        check_env_file,
        check_deepseek_api_key,
        check_deepgram_api_key,
        check_openai_api_key,
        check_anthropic_api_key,
        check_gemini_api_key,
        
        # Dependencies
        check_click,
        check_httpx,
        check_flask,
        check_socketio,
        check_dotenv,
        check_ffmpeg,
        
        # Connections
        check_port_available,
        check_chrome_extension,
        
        # Connectors
        check_centris_directory,
    ]


def run_health_checks(
    checks: Optional[List[Callable[[], CheckResult]]] = None,
    filter_categories: Optional[List[str]] = None,
    fix: bool = False,
) -> CheckResults:
    """
    Run all health checks and return aggregated results.
    
    Args:
        checks: List of check functions (defaults to get_default_checks())
        filter_categories: Only run checks in these categories
        fix: Attempt to auto-fix issues (not implemented yet)
    
    Returns:
        CheckResults with all check results
    """
    if checks is None:
        checks = get_default_checks()
    
    results = CheckResults()
    
    for check_fn in checks:
        try:
            result = check_fn()
            
            # Filter by category if specified
            if filter_categories and result.category not in filter_categories:
                continue
            
            results.results.append(result)
        except Exception as e:
            # Wrap exceptions in a failed result
            results.results.append(CheckResult(
                name=check_fn.__name__,
                status=CheckStatus.FAIL,
                message=f"Check failed: {e}",
                category="general",
            ))
    
    return results


__all__ = [
    "CheckStatus",
    "CheckResult",
    "CheckResults",
    "get_default_checks",
    "run_health_checks",
    # Individual checks
    "check_python_version",
    "check_api_key",
    "check_deepseek_api_key",
    "check_deepgram_api_key",
    "check_openai_api_key",
    "check_anthropic_api_key",
    "check_gemini_api_key",
    "check_port_available",
    "check_chrome_extension",
    "check_dependency",
    "check_click",
    "check_httpx",
    "check_flask",
    "check_socketio",
    "check_dotenv",
    "check_ffmpeg",
    "check_env_file",
    "check_centris_directory",
]
