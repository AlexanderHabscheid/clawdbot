"""
Centris CLI Banner and Taglines

Makes the CLI feel professional and fun.
"""

import random
import sys
from typing import Optional

from centris_sdk.cli.theme import theme, COLORS_ENABLED


# =============================================================================
# Centris ASCII Art
# =============================================================================

CENTRIS_ASCII = [
    "  ██████╗███████╗███╗   ██╗████████╗██████╗ ██╗███████╗",
    " ██╔════╝██╔════╝████╗  ██║╚══██╔══╝██╔══██╗██║██╔════╝",
    " ██║     █████╗  ██╔██╗ ██║   ██║   ██████╔╝██║███████╗",
    " ██║     ██╔══╝  ██║╚██╗██║   ██║   ██╔══██╗██║╚════██║",
    " ╚██████╗███████╗██║ ╚████║   ██║   ██║  ██║██║███████║",
    "  ╚═════╝╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═╝╚═╝╚══════╝",
]

CENTRIS_SIMPLE = [
    " ╔═╗╔═╗╔╗╔╔╦╗╦═╗╦╔═╗",
    " ║  ║╣ ║║║ ║ ╠╦╝║╚═╗",
    " ╚═╝╚═╝╝╚╝ ╩ ╩╚═╩╚═╝",
]


# =============================================================================
# Taglines - Because Personality Matters
# =============================================================================

TAGLINES = [
    # Developer focused
    "Build once, connect everywhere.",
    "Your browser, your rules, your speed.",
    "10x faster than screenshot-LLM-click loops.",
    "Compiled recipes for the win.",
    "No OAuth needed. Just vibes.",
    
    # Technical
    "Browser automation that actually works.",
    "MCP-compatible. Claude-approved.",
    "Local-first. Cloud-optional.",
    "Deterministic. Reliable. Fast.",
    "Selectors > Screenshots.",
    
    # Fun
    "Making LLMs actually useful since 2024.",
    "We put the 'auto' in automation.",
    "Because clicking is so last century.",
    "Your AI's favorite API.",
    "Now with 100% more connectors.",
    
    # Motivational
    "Ship faster. Iterate quicker.",
    "From idea to integration in minutes.",
    "The bridge between AI and everything.",
    "Turning 'I wish' into 'I shipped'.",
    "One connector at a time.",
    
    # Self-aware
    "Yes, we read the DOM so you don't have to.",
    "CSS selectors are our love language.",
    "We're basically Zapier but cooler.",
    "The SDK that actually has documentation.",
    "Warning: May cause productivity.",
]


def pick_tagline() -> str:
    """Pick a random tagline."""
    return random.choice(TAGLINES)


# =============================================================================
# Banner Rendering
# =============================================================================

def _colorize_ascii(lines: list[str]) -> str:
    """Apply Centris colors to ASCII art."""
    if not COLORS_ENABLED:
        return "\n".join(lines)
    
    result = []
    for i, line in enumerate(lines):
        # Gradient effect - brighter at top
        if i < 2:
            result.append(theme.accent_bright(line))
        elif i < 4:
            result.append(theme.accent(line))
        else:
            result.append(theme.accent_dim(line))
    
    return "\n".join(result)


def format_banner(
    version: str,
    commit: Optional[str] = None,
    show_art: bool = True,
    show_tagline: bool = True,
) -> str:
    """
    Format the full CLI banner.
    
    Args:
        version: Current SDK version
        commit: Git commit hash (optional)
        show_art: Whether to show ASCII art
        show_tagline: Whether to show a tagline
    
    Returns:
        Formatted banner string
    """
    parts = []
    
    # ASCII art
    if show_art:
        parts.append(_colorize_ascii(CENTRIS_ASCII))
        parts.append("")  # Empty line
    
    # Version line
    version_str = f"v{version}"
    if commit:
        version_str += f" ({commit[:7]})"
    
    if COLORS_ENABLED:
        version_line = f"  {theme.heading('◈ Centris SDK')} {theme.info(version_str)}"
    else:
        version_line = f"  Centris SDK {version_str}"
    
    parts.append(version_line)
    
    # Tagline
    if show_tagline:
        tagline = pick_tagline()
        if COLORS_ENABLED:
            parts.append(f"  {theme.muted('—')} {theme.accent_dim(tagline)}")
        else:
            parts.append(f"  — {tagline}")
    
    return "\n".join(parts)


def format_compact_banner(version: str) -> str:
    """
    Format a compact one-line banner.
    
    Args:
        version: Current SDK version
    
    Returns:
        Compact banner string
    """
    tagline = pick_tagline()
    
    if COLORS_ENABLED:
        return f"{theme.heading('◈ Centris')} {theme.info(f'v{version}')} {theme.muted('—')} {theme.accent_dim(tagline)}"
    else:
        return f"Centris v{version} — {tagline}"


# =============================================================================
# Banner Emission (Clawdbot Pattern)
# =============================================================================

_banner_emitted = False

# Flags that suppress banner output
SUPPRESS_FLAGS = frozenset([
    "--json",
    "--quiet", "-q",
    "--version", "-V",
    "--help", "-h",
])


def emit_banner(
    version: str,
    commit: Optional[str] = None,
    compact: bool = False,
    force: bool = False,
    skip_if_json: bool = True,
    skip_if_non_tty: bool = True,
    skip_if_help: bool = True,
) -> bool:
    """
    Emit the banner to stdout.
    
    Implements the Clawdbot pattern of emitting banner once per session
    with multiple conditions for skipping.
    
    Args:
        version: Current SDK version
        commit: Git commit hash (optional)
        compact: Use compact one-line format
        force: Emit even if already emitted
        skip_if_json: Skip if --json flag is present
        skip_if_non_tty: Skip if stdout is not a TTY
        skip_if_help: Skip if --help flag is present
    
    Returns:
        True if banner was emitted, False if skipped
    
    Example:
        # In command group callback
        @cli.callback()
        def main_callback():
            emit_banner("1.0.0")
        
        # Or in specific commands
        def doctor_command():
            emit_banner("1.0.0", compact=True)
    """
    global _banner_emitted
    
    # Already emitted check
    if _banner_emitted and not force:
        return False
    
    # Non-TTY check
    if skip_if_non_tty and not sys.stdout.isatty():
        return False
    
    # Build set of flags to check
    skip_flags = set()
    if skip_if_json:
        skip_flags.add("--json")
    if skip_if_help:
        skip_flags.update(["--help", "-h"])
    
    # Always skip for version and quiet
    skip_flags.update(["--version", "-V", "--quiet", "-q"])
    
    # Check for flags that should suppress banner
    if any(arg in skip_flags for arg in sys.argv):
        return False
    
    # Format and emit
    if compact:
        banner = format_compact_banner(version)
    else:
        banner = format_banner(version, commit)
    
    print(f"\n{banner}\n")
    _banner_emitted = True
    return True


def has_emitted_banner() -> bool:
    """
    Check if banner has been emitted in this session.
    
    Returns:
        True if banner was emitted, False otherwise
    """
    return _banner_emitted


def reset_banner_state() -> None:
    """
    Reset the banner emission state.
    
    This is primarily for testing - allows emitting the banner again
    in the same process.
    """
    global _banner_emitted
    _banner_emitted = False


def set_banner_emitted() -> None:
    """
    Mark the banner as emitted without actually printing it.
    
    Useful when you want to suppress the banner but still track
    that the session has started.
    """
    global _banner_emitted
    _banner_emitted = True


__all__ = [
    # Taglines
    "TAGLINES",
    "pick_tagline",
    # Banner formatting
    "format_banner",
    "format_compact_banner",
    # Banner emission (Clawdbot pattern)
    "emit_banner",
    "has_emitted_banner",
    "reset_banner_state",
    "set_banner_emitted",
    # Constants
    "SUPPRESS_FLAGS",
]
