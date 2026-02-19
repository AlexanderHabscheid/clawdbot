"""
Centris CLI Profile System

Provides isolated environments for development and testing.

Inspired by Clawdbot's --dev and --profile system.

Profiles allow:
1. Isolated state directories (~/.centris-<profile>/)
2. Separate configuration per environment
3. Easy switching between dev/prod environments
4. Testing without affecting production state

Usage:
    # Development profile (shorthand)
    centris --dev start
    
    # Named profile
    centris --profile staging start
    
    # Default (production)
    centris start
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


# =============================================================================
# Profile Configuration
# =============================================================================

@dataclass
class ProfileConfig:
    """
    Configuration for a CLI profile.
    
    Attributes:
        name: Profile name (None = default/production)
        state_dir: Directory for profile state
        config_dir: Directory for profile configuration
        is_dev: Whether this is a development profile
    """
    
    name: Optional[str]
    state_dir: Path
    config_dir: Path
    is_dev: bool = False
    
    @property
    def is_default(self) -> bool:
        """Check if this is the default profile."""
        return self.name is None
    
    @property
    def display_name(self) -> str:
        """Get display name for the profile."""
        if self.name is None:
            return "default"
        return self.name
    
    def get_path(self, *parts: str) -> Path:
        """Get a path within the profile's state directory."""
        return self.state_dir.joinpath(*parts)
    
    def ensure_dirs(self) -> None:
        """Ensure profile directories exist."""
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.config_dir.mkdir(parents=True, exist_ok=True)


# =============================================================================
# Profile Resolution
# =============================================================================

def get_base_state_dir() -> Path:
    """Get the base state directory for Centris."""
    # Check for explicit override
    if override := os.environ.get("CENTRIS_STATE_DIR"):
        return Path(override)
    
    # Default: ~/.centris
    return Path.home() / ".centris"


def get_profile_state_dir(profile_name: Optional[str]) -> Path:
    """
    Get the state directory for a profile.
    
    Args:
        profile_name: Profile name (None = default)
        
    Returns:
        Path to profile state directory
        
    Examples:
        get_profile_state_dir(None)      -> ~/.centris/
        get_profile_state_dir("dev")     -> ~/.centris-dev/
        get_profile_state_dir("staging") -> ~/.centris-staging/
    """
    base = get_base_state_dir()
    
    if profile_name is None:
        return base
    
    # Named profile: ~/.centris-<name>/
    return base.parent / f".centris-{profile_name}"


def get_profile_config_dir(profile_name: Optional[str]) -> Path:
    """
    Get the config directory for a profile.
    
    Args:
        profile_name: Profile name (None = default)
        
    Returns:
        Path to profile config directory
    """
    state_dir = get_profile_state_dir(profile_name)
    return state_dir / "config"


def resolve_profile(
    dev: bool = False,
    profile: Optional[str] = None,
) -> ProfileConfig:
    """
    Resolve profile from CLI flags.
    
    Args:
        dev: Use development profile (shorthand for --profile dev)
        profile: Explicit profile name
        
    Returns:
        ProfileConfig for the resolved profile
        
    Notes:
        - --dev is equivalent to --profile dev
        - If both are specified, --profile takes precedence
    """
    # Determine profile name
    if profile:
        profile_name = profile
    elif dev:
        profile_name = "dev"
    else:
        # Check environment variable
        profile_name = os.environ.get("CENTRIS_PROFILE")
    
    # Get directories
    state_dir = get_profile_state_dir(profile_name)
    config_dir = get_profile_config_dir(profile_name)
    
    return ProfileConfig(
        name=profile_name,
        state_dir=state_dir,
        config_dir=config_dir,
        is_dev=(profile_name == "dev" or dev),
    )


def set_profile_environment(profile: ProfileConfig) -> None:
    """
    Set environment variables for the active profile.
    
    This ensures child processes and backend use the correct profile.
    
    Args:
        profile: The active profile configuration
    """
    if profile.name:
        os.environ["CENTRIS_PROFILE"] = profile.name
    else:
        os.environ.pop("CENTRIS_PROFILE", None)
    
    os.environ["CENTRIS_STATE_DIR"] = str(profile.state_dir)
    os.environ["CENTRIS_CONFIG_DIR"] = str(profile.config_dir)
    
    if profile.is_dev:
        os.environ["CENTRIS_DEV"] = "true"
    else:
        os.environ.pop("CENTRIS_DEV", None)


# =============================================================================
# Profile Paths
# =============================================================================

class ProfilePaths:
    """
    Common paths within a profile's state directory.
    
    Usage:
        profile = resolve_profile(dev=True)
        paths = ProfilePaths(profile)
        
        connectors_dir = paths.connectors
        config_file = paths.config_file
    """
    
    def __init__(self, profile: ProfileConfig):
        self.profile = profile
        self._state = profile.state_dir
        self._config = profile.config_dir
    
    @property
    def connectors(self) -> Path:
        """Directory for installed connectors."""
        return self._state / "connectors"
    
    @property
    def cache(self) -> Path:
        """Directory for cached data."""
        return self._state / "cache"
    
    @property
    def logs(self) -> Path:
        """Directory for logs."""
        return self._state / "logs"
    
    @property
    def sessions(self) -> Path:
        """Directory for session data."""
        return self._state / "sessions"
    
    @property
    def credentials(self) -> Path:
        """Directory for credentials (encrypted)."""
        return self._state / "credentials"
    
    @property
    def config_file(self) -> Path:
        """Main configuration file."""
        return self._config / "config.json"
    
    @property
    def config_version_file(self) -> Path:
        """Configuration version file (for migrations)."""
        return self._config / "version"
    
    def ensure_all(self) -> None:
        """Ensure all directories exist."""
        self.profile.ensure_dirs()
        self.connectors.mkdir(parents=True, exist_ok=True)
        self.cache.mkdir(parents=True, exist_ok=True)
        self.logs.mkdir(parents=True, exist_ok=True)
        self.sessions.mkdir(parents=True, exist_ok=True)
        self.credentials.mkdir(parents=True, exist_ok=True)


# =============================================================================
# Active Profile Management
# =============================================================================

_active_profile: Optional[ProfileConfig] = None


def get_active_profile() -> ProfileConfig:
    """
    Get the currently active profile.
    
    Returns the default profile if none has been explicitly activated.
    """
    global _active_profile
    if _active_profile is None:
        _active_profile = resolve_profile()
    return _active_profile


def set_active_profile(profile: ProfileConfig) -> None:
    """
    Set the active profile.
    
    Also sets environment variables for child processes.
    """
    global _active_profile
    _active_profile = profile
    set_profile_environment(profile)


def reset_active_profile() -> None:
    """Reset the active profile to default."""
    global _active_profile
    _active_profile = None


# =============================================================================
# Exports
# =============================================================================

__all__ = [
    # Types
    "ProfileConfig",
    "ProfilePaths",
    # Resolution
    "resolve_profile",
    "get_profile_state_dir",
    "get_profile_config_dir",
    # Active profile
    "get_active_profile",
    "set_active_profile",
    "reset_active_profile",
    "set_profile_environment",
    # Utilities
    "get_base_state_dir",
]
