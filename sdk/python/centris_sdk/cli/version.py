"""
Centris CLI Version Management

Single source of truth for SDK version.
Reads from package metadata at runtime (no hardcoding).

This fixes the version mismatch problem where hardcoded versions
diverge from pyproject.toml.
"""

from functools import lru_cache


@lru_cache(maxsize=1)
def get_sdk_version() -> str:
    """
    Get the SDK version from package metadata.
    
    Uses importlib.metadata to read version from the installed package,
    which gets it from pyproject.toml. Falls back to a default if
    the package isn't installed (e.g., during development).
    
    Returns:
        Version string like "1.0.0"
    
    Example:
        from centris_sdk.cli.version import get_sdk_version
        print(f"Centris SDK v{get_sdk_version()}")
    """
    try:
        from importlib.metadata import version
        return version("centris-sdk")
    except Exception:
        # Fallback for development or if package not installed
        # Try reading from pyproject.toml directly
        try:
            from pathlib import Path
            import tomllib
            
            # Walk up to find pyproject.toml
            current = Path(__file__).resolve()
            for _ in range(10):
                current = current.parent
                pyproject = current / "pyproject.toml"
                if pyproject.exists():
                    with open(pyproject, "rb") as f:
                        data = tomllib.load(f)
                    return data.get("project", {}).get("version", "0.0.0-dev")
        except Exception:
            pass
        
        return "0.0.0-dev"


# For backwards compatibility with existing code
SDK_VERSION = get_sdk_version()

# Config version for migrations (can differ from SDK version)
CONFIG_VERSION = "1.1.0"


__all__ = [
    "get_sdk_version",
    "SDK_VERSION",
    "CONFIG_VERSION",
]
