"""
Centris CLI - Environment Health Checks

Checks for environment variables, API keys, and system requirements.
"""

import os
import sys
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from centris_sdk.cli.doctor import DoctorResult
    from centris_sdk.cli.doctor.prompter import DoctorPrompter, DoctorOptions


def note_environment_health(
    result: "DoctorResult",
    prompter: "DoctorPrompter",
    options: "DoctorOptions",
) -> None:
    """
    Check environment health including Python version and API keys.
    
    Args:
        result: DoctorResult to add checks to
        prompter: Prompter for interactive questions
        options: Doctor command options
    """
    # Python version check
    _check_python_version(result)
    
    # .env file check
    _check_env_file(result)
    
    # API key checks
    _check_api_keys(result)


def _check_python_version(result: "DoctorResult") -> None:
    """Check Python version is supported."""
    version = sys.version_info
    version_str = f"{version.major}.{version.minor}.{version.micro}"
    
    if version >= (3, 10):
        result.add_check(
            name="Python version",
            status="pass",
            message=f"Python {version_str}",
            category="environment",
        )
    elif version >= (3, 8):
        result.add_check(
            name="Python version",
            status="warn",
            message=f"Python {version_str} (3.10+ recommended)",
            category="environment",
            fix_hint="Upgrade to Python 3.10 or later for best compatibility",
        )
    else:
        result.add_check(
            name="Python version",
            status="fail",
            message=f"Python {version_str} is not supported",
            category="environment",
            fix_hint="Install Python 3.10 or later",
        )


def _check_env_file(result: "DoctorResult") -> None:
    """Check if .env file exists."""
    locations = [
        Path.cwd() / ".env",
        Path.cwd() / "backend" / ".env",
        Path.cwd().parent / ".env",
    ]
    
    for loc in locations:
        if loc.exists():
            result.add_check(
                name=".env file",
                status="pass",
                message=f"Found at {loc}",
                category="environment",
            )
            return
    
    result.add_check(
        name=".env file",
        status="warn",
        message="Not found",
        category="environment",
        fix_hint="Create a .env file from .env.example",
    )


def _check_api_keys(result: "DoctorResult") -> None:
    """Check API keys are configured."""
    # Required keys
    _check_single_api_key(result, "DeepSeek", "DEEPSEEK_API_KEY", required=True)
    _check_single_api_key(result, "Deepgram", "DEEPGRAM_API_KEY", required=True)
    
    # Optional keys
    _check_single_api_key(result, "OpenAI", "OPENAI_API_KEY", required=False)
    _check_single_api_key(result, "Anthropic", "ANTHROPIC_API_KEY", required=False)
    _check_single_api_key(result, "Gemini", "GEMINI_API_KEY", required=False)


def _check_single_api_key(
    result: "DoctorResult",
    name: str,
    env_var: str,
    required: bool,
) -> None:
    """Check if a single API key is configured."""
    value = os.environ.get(env_var, "")
    
    if value:
        # Mask the key for display
        if len(value) > 8:
            masked = value[:4] + "***" + value[-4:]
        else:
            masked = "***"
        
        result.add_check(
            name=f"{name} API key",
            status="pass",
            message=f"Configured ({masked})",
            category="environment",
        )
    elif required:
        result.add_check(
            name=f"{name} API key",
            status="fail",
            message="Not configured",
            category="environment",
            fix_hint=f"Set {env_var} in your .env file",
        )
    else:
        result.add_check(
            name=f"{name} API key",
            status="warn",
            message="Not configured (optional)",
            category="environment",
            fix_hint=f"Set {env_var} to enable {name} features",
        )
