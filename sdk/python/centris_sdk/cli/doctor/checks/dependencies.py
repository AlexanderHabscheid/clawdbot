"""
Centris CLI - Dependencies Health Checks

Checks for required Python packages and system dependencies.
"""

import shutil
import subprocess
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from centris_sdk.cli.doctor import DoctorResult
    from centris_sdk.cli.doctor.prompter import DoctorPrompter, DoctorOptions


def note_dependencies_health(
    result: "DoctorResult",
    prompter: "DoctorPrompter",
    options: "DoctorOptions",
) -> None:
    """
    Check dependencies health.
    
    Args:
        result: DoctorResult to add checks to
        prompter: Prompter for interactive questions
        options: Doctor command options
    """
    # Python packages
    _check_python_packages(result)
    
    # System dependencies
    _check_system_dependencies(result)


def _check_python_packages(result: "DoctorResult") -> None:
    """Check required Python packages are installed."""
    required_packages = [
        ("click", "click", True),
        ("httpx", "httpx", True),
        ("Flask", "flask", False),
        ("Flask-SocketIO", "flask_socketio", False),
        ("python-dotenv", "dotenv", True),
        ("PyYAML", "yaml", False),
    ]
    
    for name, package, required in required_packages:
        _check_single_package(result, name, package, required)


def _check_single_package(
    result: "DoctorResult",
    name: str,
    package: str,
    required: bool,
) -> None:
    """Check if a single Python package is installed."""
    try:
        __import__(package)
        result.add_check(
            name=name,
            status="pass",
            category="dependencies",
        )
    except ImportError:
        if required:
            result.add_check(
                name=name,
                status="fail",
                message="Not installed",
                category="dependencies",
                fix_hint=f"Run: pip install {name.lower().replace('-', '_')}",
            )
        else:
            result.add_check(
                name=name,
                status="warn",
                message="Not installed (optional)",
                category="dependencies",
                fix_hint=f"Run: pip install {name.lower().replace('-', '_')}",
            )


def _check_system_dependencies(result: "DoctorResult") -> None:
    """Check system dependencies like FFmpeg."""
    # FFmpeg
    _check_ffmpeg(result)
    
    # Git (for connector development)
    _check_git(result)


def _check_ffmpeg(result: "DoctorResult") -> None:
    """Check if FFmpeg is available."""
    ffmpeg_path = shutil.which("ffmpeg")
    
    if ffmpeg_path:
        try:
            proc = subprocess.run(
                ["ffmpeg", "-version"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            version_line = proc.stdout.split("\n")[0] if proc.stdout else "Unknown"
            # Truncate long version strings
            if len(version_line) > 50:
                version_line = version_line[:47] + "..."
            
            result.add_check(
                name="FFmpeg",
                status="pass",
                message=version_line,
                category="dependencies",
            )
        except Exception:
            result.add_check(
                name="FFmpeg",
                status="pass",
                message="Installed",
                category="dependencies",
            )
    else:
        result.add_check(
            name="FFmpeg",
            status="warn",
            message="Not found (optional for audio)",
            category="dependencies",
            fix_hint="Install: brew install ffmpeg (macOS) or apt install ffmpeg (Linux)",
        )


def _check_git(result: "DoctorResult") -> None:
    """Check if Git is available."""
    git_path = shutil.which("git")
    
    if git_path:
        try:
            proc = subprocess.run(
                ["git", "--version"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            version = proc.stdout.strip() if proc.stdout else "Unknown version"
            
            result.add_check(
                name="Git",
                status="pass",
                message=version,
                category="dependencies",
            )
        except Exception:
            result.add_check(
                name="Git",
                status="pass",
                message="Installed",
                category="dependencies",
            )
    else:
        result.add_check(
            name="Git",
            status="warn",
            message="Not found (optional for connectors)",
            category="dependencies",
            fix_hint="Install Git for connector development",
        )
