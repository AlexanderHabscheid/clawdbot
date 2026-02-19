"""
Centris CLI Theme System

Provides consistent, beautiful CLI output with the "Signal" color palette.
"""

import os
import sys
from typing import Optional, Callable

# Check for color support
NO_COLOR = os.environ.get("NO_COLOR", "").strip() not in ("", "0")
FORCE_COLOR = os.environ.get("FORCE_COLOR", "").strip() not in ("", "0")
IS_TTY = sys.stdout.isatty()

# Enable colors if TTY and not disabled
COLORS_ENABLED = (IS_TTY or FORCE_COLOR) and not NO_COLOR


# =============================================================================
# Centris Color Palette - "Signal" Theme
# =============================================================================

class CentrisColors:
    """
    Centris color palette - "Signal" theme.
    Clean, modern, and professional.
    """
    # Primary brand colors
    ACCENT = "#00D4AA"        # Centris teal - primary brand color
    ACCENT_BRIGHT = "#00FFD4"  # Bright teal for emphasis
    ACCENT_DIM = "#00A080"     # Dimmed teal for backgrounds
    
    # Semantic colors
    INFO = "#5C9DFF"          # Blue for informational messages
    SUCCESS = "#2FBF71"       # Green for success states
    WARN = "#FFB020"          # Yellow/orange for warnings
    ERROR = "#E23D2D"         # Red for errors
    MUTED = "#8B8B8B"         # Gray for secondary text
    
    # UI colors
    HEADING = "#FFFFFF"       # White for headings
    COMMAND = "#00FFD4"       # Bright teal for commands
    PATH = "#5C9DFF"          # Blue for file paths


def _ansi_256_color(r: int, g: int, b: int) -> int:
    """Convert RGB to closest ANSI 256 color code."""
    # Use 6x6x6 color cube (codes 16-231)
    r_idx = round(r / 255 * 5)
    g_idx = round(g / 255 * 5)
    b_idx = round(b / 255 * 5)
    return 16 + 36 * r_idx + 6 * g_idx + b_idx


def _hex_to_rgb(hex_color: str) -> tuple:
    """Convert hex color to RGB tuple."""
    hex_color = hex_color.lstrip("#")
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))


def _make_colorizer(hex_color: str) -> Callable[[str], str]:
    """Create a function that applies the given color to text."""
    if not COLORS_ENABLED:
        return lambda text: text
    
    r, g, b = _hex_to_rgb(hex_color)
    color_code = _ansi_256_color(r, g, b)
    
    def colorize(text: str) -> str:
        return f"\033[38;5;{color_code}m{text}\033[0m"
    
    return colorize


def _make_bold_colorizer(hex_color: str) -> Callable[[str], str]:
    """Create a function that applies bold + color to text."""
    if not COLORS_ENABLED:
        return lambda text: text
    
    r, g, b = _hex_to_rgb(hex_color)
    color_code = _ansi_256_color(r, g, b)
    
    def colorize(text: str) -> str:
        return f"\033[1;38;5;{color_code}m{text}\033[0m"
    
    return colorize


# =============================================================================
# Theme Functions - Use These!
# =============================================================================

class theme:
    """
    Centris CLI theme - provides consistent styled output.
    
    Usage:
        from centris_sdk.cli.theme import theme
        
        print(theme.accent("Primary text"))
        print(theme.success("Operation completed!"))
        print(theme.error("Something went wrong"))
        print(theme.heading("Section Title"))
    """
    
    # Brand colors
    accent = staticmethod(_make_colorizer(CentrisColors.ACCENT))
    accent_bright = staticmethod(_make_colorizer(CentrisColors.ACCENT_BRIGHT))
    accent_dim = staticmethod(_make_colorizer(CentrisColors.ACCENT_DIM))
    
    # Semantic colors
    info = staticmethod(_make_colorizer(CentrisColors.INFO))
    success = staticmethod(_make_colorizer(CentrisColors.SUCCESS))
    warn = staticmethod(_make_colorizer(CentrisColors.WARN))
    error = staticmethod(_make_colorizer(CentrisColors.ERROR))
    muted = staticmethod(_make_colorizer(CentrisColors.MUTED))
    
    # UI elements
    heading = staticmethod(_make_bold_colorizer(CentrisColors.HEADING))
    command = staticmethod(_make_colorizer(CentrisColors.COMMAND))
    path = staticmethod(_make_colorizer(CentrisColors.PATH))
    
    # Aliases for compatibility
    warning = warn  # Alias
    header = heading  # Alias
    
    @staticmethod
    def link(text: str) -> str:
        """Format a URL/link."""
        if not COLORS_ENABLED:
            return text
        # Underlined blue
        return f"\033[4;38;5;75m{text}\033[0m"
    
    @staticmethod
    def dim(text: str) -> str:
        """Dim/faded text."""
        if not COLORS_ENABLED:
            return text
        return f"\033[2m{text}\033[0m"
    
    @staticmethod
    def bold(text: str) -> str:
        """Bold text."""
        if not COLORS_ENABLED:
            return text
        return f"\033[1m{text}\033[0m"
    
    @staticmethod
    def is_rich() -> bool:
        """Check if rich output is enabled."""
        return COLORS_ENABLED


# =============================================================================
# Emoji & Symbols
# =============================================================================

class symbols:
    """Unicode symbols for CLI output."""
    
    CHECK = "✓" if COLORS_ENABLED else "[OK]"
    CROSS = "✗" if COLORS_ENABLED else "[ERR]"
    ARROW = "→" if COLORS_ENABLED else "->"
    BULLET = "•" if COLORS_ENABLED else "*"
    SPINNER = "◐" if COLORS_ENABLED else "..."
    WARN = "⚠" if COLORS_ENABLED else "[!]"
    INFO = "ℹ" if COLORS_ENABLED else "[i]"
    
    # Centris specific
    LOGO = "◈" if COLORS_ENABLED else "[C]"
    CONNECTOR = "⚡" if COLORS_ENABLED else "[+]"


# =============================================================================
# Styled Output Helpers
# =============================================================================

def styled_success(message: str) -> str:
    """Format a success message."""
    return f"{theme.success(symbols.CHECK)} {message}"


def styled_error(message: str) -> str:
    """Format an error message."""
    return f"{theme.error(symbols.CROSS)} {message}"


def styled_info(message: str) -> str:
    """Format an info message."""
    return f"{theme.info(symbols.BULLET)} {message}"


def styled_warning(message: str) -> str:
    """Format a warning message."""
    return f"{theme.warn('!')} {message}"


def styled_step(number: int, message: str) -> str:
    """Format a numbered step."""
    return f"{theme.accent(f'[{number}]')} {message}"


def styled_command(cmd: str) -> str:
    """Format a command for display."""
    return f"  {theme.muted('$')} {theme.command(cmd)}"


def styled_path(path: str) -> str:
    """Format a file path for display."""
    return theme.path(path)


# =============================================================================
# Box Drawing
# =============================================================================

def box(content: str, title: Optional[str] = None, width: int = 60) -> str:
    """
    Draw a box around content.
    
    Args:
        content: The content to box
        title: Optional title for the box
        width: Width of the box
    
    Returns:
        Box-formatted string
    """
    if not COLORS_ENABLED:
        # Plain ASCII fallback
        lines = content.split("\n")
        result = ["+" + "-" * (width - 2) + "+"]
        if title:
            result.append(f"| {title:<{width-4}} |")
            result.append("+" + "-" * (width - 2) + "+")
        for line in lines:
            result.append(f"| {line:<{width-4}} |")
        result.append("+" + "-" * (width - 2) + "+")
        return "\n".join(result)
    
    # Unicode box drawing
    lines = content.split("\n")
    
    # Box characters
    TL, TR = "╭", "╮"
    BL, BR = "╰", "╯"
    H, V = "─", "│"
    
    result = []
    
    if title:
        title_line = f"{TL}{H} {theme.heading(title)} {H * (width - len(title) - 5)}{TR}"
        result.append(theme.muted(title_line))
    else:
        result.append(theme.muted(f"{TL}{H * (width - 2)}{TR}"))
    
    for line in lines:
        # Pad line to width
        padding = width - 4 - len(line)
        result.append(f"{theme.muted(V)} {line}{' ' * max(0, padding)} {theme.muted(V)}")
    
    result.append(theme.muted(f"{BL}{H * (width - 2)}{BR}"))
    
    return "\n".join(result)


__all__ = [
    "theme",
    "symbols", 
    "CentrisColors",
    "styled_success",
    "styled_error",
    "styled_info",
    "styled_warning",
    "styled_step",
    "styled_command",
    "styled_path",
    "box",
    "COLORS_ENABLED",
]
