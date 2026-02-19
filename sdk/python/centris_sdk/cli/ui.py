"""
Centris CLI UI Components

Enhanced output helpers for beautiful CLI interfaces.
Builds on theme.py with higher-level components.
Includes ANSI-aware text handling for proper width calculation and wrapping.
"""

import re
import sys
import os
from typing import Optional, List, Dict, Any, Union, Tuple, NamedTuple
from dataclasses import dataclass, field

from centris_sdk.cli.theme import (
    theme, 
    symbols, 
    COLORS_ENABLED,
    styled_success,
    styled_error,
    styled_info,
    styled_warning,
    styled_step,
    styled_command,
    box,
)


# =============================================================================
# ANSI Escape Sequence Handling
# =============================================================================

# Regex patterns for ANSI sequences
_ANSI_SGR_PATTERN = re.compile(r'\x1b\[[0-9;]*m')  # SGR: ESC [ ... m
_ANSI_OSC8_PATTERN = re.compile(r'\x1b\]8;;[^\x1b]*\x1b\\')  # OSC-8 hyperlinks
_ANSI_ALL_PATTERN = re.compile(r'\x1b(?:\[[0-9;]*m|\]8;;[^\x1b]*\x1b\\)')

# Characters that are safe word-break points
_BREAK_CHARS = frozenset(' \t\n\r/-_.')
_SPACE_CHARS = frozenset(' \t')


class Token(NamedTuple):
    """Token for ANSI-aware text processing."""
    kind: str  # "ansi" or "char"
    value: str


def visible_width(text: str) -> int:
    """
    Calculate the visible width of text, ignoring ANSI escape sequences.
    
    This function strips ANSI SGR sequences (colors, styles) and OSC-8
    hyperlink sequences to calculate how many character cells the text
    will occupy when displayed in a terminal.
    
    Args:
        text: Text that may contain ANSI escape sequences
    
    Returns:
        The visible character width
    
    Examples:
        >>> visible_width("hello")
        5
        >>> visible_width("\x1b[31mhello\x1b[0m")  # Red "hello"
        5
        >>> visible_width("\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\")
        4  # Only "link" is visible
    """
    # Strip all ANSI sequences
    stripped = _ANSI_ALL_PATTERN.sub('', text)
    return len(stripped)


def strip_ansi(text: str) -> str:
    """
    Remove all ANSI escape sequences from text.
    
    Args:
        text: Text that may contain ANSI escape sequences
    
    Returns:
        Text with all ANSI sequences removed
    """
    return _ANSI_ALL_PATTERN.sub('', text)


def _tokenize_ansi(text: str) -> List[Token]:
    """
    Tokenize text into ANSI sequences and individual characters.
    
    This allows us to process text character by character while
    preserving ANSI sequences intact.
    
    Args:
        text: Text to tokenize
    
    Returns:
        List of Token objects
    """
    tokens: List[Token] = []
    i = 0
    ESC = '\x1b'
    
    while i < len(text):
        if text[i] == ESC:
            # Check for SGR sequence: ESC [ ... m
            if i + 1 < len(text) and text[i + 1] == '[':
                j = i + 2
                while j < len(text):
                    ch = text[j]
                    if ch == 'm':
                        break
                    if ch.isdigit() or ch == ';':
                        j += 1
                        continue
                    break
                if j < len(text) and text[j] == 'm':
                    tokens.append(Token(kind='ansi', value=text[i:j + 1]))
                    i = j + 1
                    continue
            
            # Check for OSC-8 hyperlink: ESC ] 8 ; ; ... ESC \
            if i + 4 < len(text) and text[i + 1] == ']' and text[i + 2:i + 5] == '8;;':
                # Find the terminator ESC \
                term_pos = text.find(f'{ESC}\\', i + 5)
                if term_pos >= 0:
                    tokens.append(Token(kind='ansi', value=text[i:term_pos + 2]))
                    i = term_pos + 2
                    continue
        
        # Regular character
        tokens.append(Token(kind='char', value=text[i]))
        i += 1
    
    return tokens


def wrap_line(text: str, width: int) -> List[str]:
    """
    Wrap text to a given width, preserving ANSI escape sequences.
    
    This function performs word-wrapping while ensuring that ANSI escape
    sequences are never split. The resulting lines will render correctly
    in a terminal because SGR state persists across newlines.
    
    Args:
        text: Text to wrap (may contain ANSI sequences)
        width: Maximum visible width per line
    
    Returns:
        List of wrapped lines
    
    Examples:
        >>> wrap_line("hello world", 5)
        ['hello', 'world']
        >>> wrap_line("\x1b[31mhello world\x1b[0m", 5)
        ['\x1b[31mhello', 'world\x1b[0m']
    """
    if width <= 0:
        return [text]
    
    tokens = _tokenize_ansi(text)
    if not tokens:
        return ['']
    
    lines: List[str] = []
    buf: List[Token] = []
    buf_visible = 0
    last_break_index: Optional[int] = None
    
    def buf_to_string(token_list: Optional[List[Token]] = None) -> str:
        return ''.join(t.value for t in (token_list if token_list is not None else buf))
    
    def buf_visible_width(token_list: List[Token]) -> int:
        return sum(1 for t in token_list if t.kind == 'char')
    
    def push_line(value: str) -> None:
        # Strip trailing whitespace but preserve ANSI
        cleaned = value.rstrip()
        if cleaned or not lines:  # Keep at least one line
            lines.append(cleaned)
    
    def flush_at(break_at: Optional[int]) -> None:
        nonlocal buf, buf_visible, last_break_index
        
        if not buf:
            return
        
        if break_at is None or break_at <= 0:
            push_line(buf_to_string())
            buf = []
            buf_visible = 0
            last_break_index = None
            return
        
        # Split at break point
        left = buf[:break_at]
        rest = buf[break_at:]
        push_line(buf_to_string(left))
        
        # Skip leading spaces in rest
        while rest and rest[0].kind == 'char' and rest[0].value in _SPACE_CHARS:
            rest.pop(0)
        
        buf = rest
        buf_visible = buf_visible_width(buf)
        last_break_index = None
    
    for token in tokens:
        if token.kind == 'ansi':
            buf.append(token)
            continue
        
        ch = token.value
        
        # Check if we need to wrap
        if buf_visible + 1 > width and buf_visible > 0:
            flush_at(last_break_index)
        
        buf.append(token)
        buf_visible += 1
        
        if ch in _BREAK_CHARS:
            last_break_index = len(buf)
    
    # Flush remaining content
    flush_at(len(buf))
    
    return lines if lines else ['']


def pad_cell(text: str, width: int, align: str = 'left') -> str:
    """
    Pad text to a given width, accounting for ANSI escape sequences.
    
    Args:
        text: Text to pad (may contain ANSI sequences)
        width: Target visible width
        align: Alignment - 'left', 'right', or 'center'
    
    Returns:
        Padded text
    """
    visible = visible_width(text)
    if visible >= width:
        return text
    
    pad = width - visible
    
    if align == 'right':
        return ' ' * pad + text
    elif align == 'center':
        left = pad // 2
        right = pad - left
        return ' ' * left + text + ' ' * right
    else:  # left
        return text + ' ' * pad


# =============================================================================
# Table Rendering
# =============================================================================

@dataclass
class Column:
    """
    Table column definition with flexible sizing support.
    
    Attributes:
        header: Column header text
        key: Key to extract value from row dictionaries
        width: Fixed width (overrides min/max if set)
        min_width: Minimum column width
        max_width: Maximum column width
        flex: If True, column can expand/shrink to fill available space
        align: Text alignment - 'left', 'right', or 'center'
        formatter: Optional function to format cell values
    """
    header: str
    key: str
    width: Optional[int] = None
    min_width: Optional[int] = None
    max_width: Optional[int] = None
    flex: bool = False
    align: str = "left"  # "left", "right", "center"
    formatter: Optional[callable] = None


@dataclass
class TableOptions:
    """Options for table rendering."""
    columns: List[Column]
    rows: List[Dict[str, Any]]
    width: Optional[int] = None  # Max table width
    padding: int = 1
    border: str = "unicode"  # "unicode", "ascii", or "none"


def _get_terminal_width() -> int:
    """Get terminal width, with fallback."""
    try:
        size = os.get_terminal_size()
        return size.columns
    except (OSError, ValueError):
        return 80


def _calculate_column_widths(
    cols: List[Column],
    rows: List[Dict[str, Any]],
    max_width: Optional[int],
    padding: int,
) -> List[int]:
    """
    Calculate column widths with flex support.
    
    This implements the Clawdbot algorithm for responsive column sizing:
    1. Calculate natural widths based on content
    2. Apply min/max constraints
    3. If over max_width, shrink flex columns first, then non-flex
    4. If under max_width and flex columns exist, expand them to fill
    """
    # Calculate natural widths (header vs content)
    metrics = []
    for col in cols:
        header_w = visible_width(col.header)
        cell_w = max(
            (visible_width(str(row.get(col.key, ''))) for row in rows),
            default=0
        )
        metrics.append({'header': header_w, 'cell': cell_w})
    
    # Initial widths based on content + padding
    widths = []
    for i, col in enumerate(cols):
        m = metrics[i]
        base = max(m['header'], m['cell']) + padding * 2
        
        # Apply max constraint
        if col.max_width:
            base = min(base, col.max_width)
        
        # Apply min constraint (at least 3 for readability)
        min_w = col.min_width or 3
        base = max(min_w, base)
        
        # Fixed width overrides
        if col.width is not None:
            base = col.width
        
        widths.append(base)
    
    if not max_width:
        return widths
    
    # Calculate total and check if we need to adjust
    sep_count = len(cols) + 1  # Borders between columns
    total = sum(widths) + sep_count
    
    # Calculate minimum widths (header + padding or user min)
    preferred_min = [
        max(col.min_width or 3, metrics[i]['header'] + padding * 2, 3)
        for i, col in enumerate(cols)
    ]
    absolute_min = [
        max(metrics[i]['header'] + padding * 2, 3)
        for i, col in enumerate(cols)
    ]
    
    # Shrink if over max_width
    if total > max_width:
        over = total - max_width
        
        # Get column indices sorted by width (widest first)
        flex_order = sorted(
            [i for i, col in enumerate(cols) if col.flex],
            key=lambda i: widths[i],
            reverse=True
        )
        non_flex_order = sorted(
            [i for i, col in enumerate(cols) if not col.flex],
            key=lambda i: widths[i],
            reverse=True
        )
        
        def shrink(order: List[int], min_widths: List[int]) -> None:
            nonlocal over
            while over > 0:
                progressed = False
                for i in order:
                    if widths[i] <= min_widths[i]:
                        continue
                    widths[i] -= 1
                    over -= 1
                    progressed = True
                    if over <= 0:
                        break
                if not progressed:
                    break
        
        # Prefer shrinking flex columns first
        shrink(flex_order, preferred_min)
        shrink(flex_order, absolute_min)
        shrink(non_flex_order, preferred_min)
        shrink(non_flex_order, absolute_min)
    
    # Expand flex columns if we have room
    current_total = sum(widths) + sep_count
    extra = max_width - current_total
    
    if extra > 0:
        flex_cols = [i for i, col in enumerate(cols) if col.flex]
        if flex_cols:
            caps = [
                col.max_width if col.max_width else float('inf')
                for col in cols
            ]
            while extra > 0:
                progressed = False
                for i in flex_cols:
                    if widths[i] >= caps[i]:
                        continue
                    widths[i] += 1
                    extra -= 1
                    progressed = True
                    if extra <= 0:
                        break
                if not progressed:
                    break
    
    return widths


def table(
    data: List[Dict[str, Any]],
    columns: List[Union[str, Column]],
    title: Optional[str] = None,
    show_header: bool = True,
    compact: bool = False,
    border: str = "unicode",
    width: Optional[int] = None,
    padding: int = 1,
) -> str:
    """
    Render a formatted table with ANSI-aware width handling and flex columns.
    
    Args:
        data: List of dictionaries with data
        columns: List of column keys or Column objects
        title: Optional table title
        show_header: Whether to show column headers
        compact: Use compact formatting (no borders)
        border: Border style - 'unicode', 'ascii', or 'none'
        width: Max table width (defaults to terminal width)
        padding: Cell padding
    
    Returns:
        Formatted table string
    
    Usage:
        # Simple usage
        print(table(
            data=[{"name": "foo", "status": "ok"}],
            columns=["name", "status"],
        ))
        
        # With flex columns
        print(table(
            data=[{"name": "foo", "desc": "A long description"}],
            columns=[
                Column(header="Name", key="name", min_width=10),
                Column(header="Description", key="desc", flex=True, max_width=50),
            ],
            width=80,
        ))
    """
    if not data:
        return theme.muted("(no data)")
    
    # Normalize columns
    cols: List[Column] = []
    for c in columns:
        if isinstance(c, str):
            cols.append(Column(header=c.title(), key=c))
        else:
            cols.append(c)
    
    # Calculate column widths with flex support
    max_width = width or _get_terminal_width()
    widths = _calculate_column_widths(cols, data, max_width, padding)
    
    # For simple width access
    col_widths = {col.key: widths[i] for i, col in enumerate(cols)}
    
    lines: List[str] = []
    
    # Title
    if title:
        lines.append(theme.heading(title))
    
    # Handle "none" border style
    if border == "none":
        header_line = " | ".join(col.header for col in cols)
        lines.append(header_line)
        for row in data:
            row_line = " | ".join(str(row.get(col.key, '')) for col in cols)
            lines.append(row_line)
        return "\n".join(lines)
    
    # Border characters
    if border == "ascii" or not COLORS_ENABLED:
        box_chars = {
            'tl': '+', 'tr': '+', 'bl': '+', 'br': '+',
            'h': '-', 'v': '|',
            't': '+', 'ml': '+', 'm': '+', 'mr': '+', 'b': '+',
        }
    else:
        box_chars = {
            'tl': '┌', 'tr': '┐', 'bl': '└', 'br': '┘',
            'h': '─', 'v': '│',
            't': '┬', 'ml': '├', 'm': '┼', 'mr': '┤', 'b': '┴',
        }
    
    def h_line(left: str, mid: str, right: str) -> str:
        """Create horizontal line with column separators."""
        segments = [box_chars['h'] * w for w in widths]
        return left + mid.join(segments) + right
    
    def content_width(idx: int) -> int:
        """Get content width (width minus padding)."""
        return max(1, widths[idx] - padding * 2)
    
    pad_str = ' ' * padding
    
    def render_row(record: Dict[str, Any], is_header: bool = False) -> List[str]:
        """Render a row, handling multi-line wrapping."""
        cells = []
        for i, col in enumerate(cols):
            if is_header:
                cell_text = col.header
            else:
                value = record.get(col.key, '')
                if col.formatter:
                    value = col.formatter(value)
                cell_text = str(value) if value is not None else ''
            cells.append(cell_text)
        
        # Wrap each cell
        wrapped = [wrap_line(cell, content_width(i)) for i, cell in enumerate(cells)]
        height = max(len(w) for w in wrapped)
        
        out: List[str] = []
        for line_idx in range(height):
            parts = []
            for i, (col, lines_list) in enumerate(zip(cols, wrapped)):
                raw = lines_list[line_idx] if line_idx < len(lines_list) else ''
                aligned = pad_cell(raw, content_width(i), col.align)
                parts.append(f'{pad_str}{aligned}{pad_str}')
            
            row_line = box_chars['v'] + box_chars['v'].join(parts) + box_chars['v']
            out.append(theme.muted(box_chars['v'][0]) + row_line[1:-1] + theme.muted(box_chars['v']))
        return out
    
    # Build table
    if not compact:
        lines.append(theme.muted(h_line(box_chars['tl'], box_chars['t'], box_chars['tr'])))
    
    if show_header:
        header_lines = render_row({}, is_header=True)
        for hl in header_lines:
            # Color header text
            lines.append(hl)
        
        if not compact:
            lines.append(theme.muted(h_line(box_chars['ml'], box_chars['m'], box_chars['mr'])))
    
    for row in data:
        row_lines = render_row(row, is_header=False)
        lines.extend(row_lines)
    
    if not compact:
        lines.append(theme.muted(h_line(box_chars['bl'], box_chars['b'], box_chars['br'])))
    
    return "\n".join(lines)


# =============================================================================
# Status Display
# =============================================================================

def status_line(
    label: str,
    value: Any,
    status: Optional[str] = None,
    indent: int = 0,
) -> str:
    """
    Format a status line with label and value.
    
    Args:
        label: The label text
        value: The value to display
        status: "ok", "warn", "error", or None
        indent: Indentation level
    
    Usage:
        print(status_line("Server", "running", status="ok"))
    """
    prefix = "  " * indent
    
    # Format value based on status
    if status == "ok":
        formatted_value = theme.success(str(value))
        icon = theme.success(symbols.CHECK)
    elif status == "warn":
        formatted_value = theme.warn(str(value))
        icon = theme.warn("!")
    elif status == "error":
        formatted_value = theme.error(str(value))
        icon = theme.error(symbols.CROSS)
    else:
        formatted_value = theme.info(str(value))
        icon = theme.muted(symbols.BULLET)
    
    return f"{prefix}{icon} {theme.muted(label + ':')} {formatted_value}"


def key_value(items: Dict[str, Any], indent: int = 0) -> str:
    """
    Format a dictionary as key-value pairs.
    
    Args:
        items: Dictionary of items to display
        indent: Indentation level
    
    Usage:
        print(key_value({"Host": "localhost", "Port": 5001}))
    """
    lines = []
    prefix = "  " * indent
    
    # Find max key length for alignment
    max_key_len = max(len(str(k)) for k in items.keys()) if items else 0
    
    for key, value in items.items():
        key_str = str(key).ljust(max_key_len)
        
        if isinstance(value, bool):
            val_str = theme.success("yes") if value else theme.error("no")
        elif value is None:
            val_str = theme.muted("(not set)")
        else:
            val_str = theme.info(str(value))
        
        lines.append(f"{prefix}{theme.muted(key_str + ':')} {val_str}")
    
    return "\n".join(lines)


# =============================================================================
# Section Headers
# =============================================================================

def section(title: str, description: Optional[str] = None) -> str:
    """
    Format a section header.
    
    Args:
        title: Section title
        description: Optional description
    
    Usage:
        print(section("Configuration", "Current settings"))
    """
    lines = []
    
    if COLORS_ENABLED:
        lines.append(f"\n{theme.heading(title)}")
        if description:
            lines.append(theme.muted(description))
    else:
        lines.append(f"\n{title}")
        lines.append("=" * len(title))
        if description:
            lines.append(description)
    
    return "\n".join(lines)


def divider(width: int = 50, char: str = "─") -> str:
    """
    Format a horizontal divider.
    
    Args:
        width: Width of the divider
        char: Character to use (default: ─)
    
    Usage:
        print(divider())
    """
    if COLORS_ENABLED:
        return theme.muted(char * width)
    else:
        return "-" * width


# =============================================================================
# Panels and Cards
# =============================================================================

def panel(
    content: str,
    title: Optional[str] = None,
    style: str = "default",
    width: int = 60,
) -> str:
    """
    Render content in a styled panel.
    
    Args:
        content: The content to display
        title: Optional panel title
        style: "default", "success", "warning", "error", "info"
        width: Panel width
    
    Usage:
        print(panel("Server is running", title="Status", style="success"))
    """
    # Select border color based on style
    color_fn = {
        "success": theme.success,
        "warning": theme.warn,
        "error": theme.error,
        "info": theme.info,
        "default": theme.muted,
    }.get(style, theme.muted)
    
    if not COLORS_ENABLED:
        return box(content, title, width)
    
    lines = []
    
    # Box characters
    TL, TR = "╭", "╮"
    BL, BR = "╰", "╯"
    H, V = "─", "│"
    
    # Top border with title
    if title:
        title_str = f" {title} "
        padding = width - len(title_str) - 2
        top = f"{TL}{H}{title_str}{H * padding}{TR}"
    else:
        top = f"{TL}{H * (width - 2)}{TR}"
    lines.append(color_fn(top))
    
    # Content lines
    for line in content.split("\n"):
        padding = width - 4 - len(line)
        lines.append(f"{color_fn(V)} {line}{' ' * max(0, padding)} {color_fn(V)}")
    
    # Bottom border
    lines.append(color_fn(f"{BL}{H * (width - 2)}{BR}"))
    
    return "\n".join(lines)


def card(
    title: str,
    items: Dict[str, Any],
    style: str = "default",
    width: int = 50,
) -> str:
    """
    Render a card with title and key-value items.
    
    Args:
        title: Card title
        items: Dictionary of items to display
        style: Panel style
        width: Card width
    
    Usage:
        print(card("Server", {"Host": "localhost", "Port": 5001}))
    """
    content_lines = []
    max_key_len = max(len(str(k)) for k in items.keys()) if items else 0
    
    for key, value in items.items():
        key_str = str(key).ljust(max_key_len)
        
        if isinstance(value, bool):
            val_str = theme.success("yes") if value else theme.error("no")
        elif value is None:
            val_str = theme.muted("not set")
        else:
            val_str = str(value)
        
        content_lines.append(f"{theme.muted(key_str)} {val_str}")
    
    return panel("\n".join(content_lines), title=title, style=style, width=width)


# =============================================================================
# Lists
# =============================================================================

def bullet_list(items: List[str], indent: int = 0) -> str:
    """
    Format items as a bulleted list.
    
    Usage:
        print(bullet_list(["Item 1", "Item 2"]))
    """
    prefix = "  " * indent
    bullet = theme.accent(symbols.BULLET) if COLORS_ENABLED else "*"
    
    return "\n".join(f"{prefix}{bullet} {item}" for item in items)


def numbered_list(items: List[str], indent: int = 0, start: int = 1) -> str:
    """
    Format items as a numbered list.
    
    Usage:
        print(numbered_list(["First", "Second", "Third"]))
    """
    prefix = "  " * indent
    lines = []
    
    for i, item in enumerate(items, start=start):
        num = theme.accent(f"{i}.") if COLORS_ENABLED else f"{i}."
        lines.append(f"{prefix}{num} {item}")
    
    return "\n".join(lines)


def check_list(items: List[tuple]) -> str:
    """
    Format items as a checklist.
    
    Args:
        items: List of (label, checked: bool) tuples
    
    Usage:
        print(check_list([("Task 1", True), ("Task 2", False)]))
    """
    lines = []
    
    for label, checked in items:
        if checked:
            icon = theme.success(symbols.CHECK)
            text = label
        else:
            icon = theme.muted("○")
            text = theme.muted(label)
        
        lines.append(f"  {icon} {text}")
    
    return "\n".join(lines)


# =============================================================================
# Messages
# =============================================================================

def success(message: str) -> None:
    """Print a success message."""
    print(styled_success(message))


def error(message: str) -> None:
    """Print an error message."""
    print(styled_error(message))


def info(message: str) -> None:
    """Print an info message."""
    print(styled_info(message))


def warning(message: str) -> None:
    """Print a warning message."""
    print(styled_warning(message))


def command_hint(cmd: str, description: Optional[str] = None) -> str:
    """
    Format a command hint for the user.
    
    Usage:
        print(command_hint("centris run", "Start the server"))
    """
    cmd_str = styled_command(cmd)
    if description:
        return f"{cmd_str}\n    {theme.muted(description)}"
    return cmd_str


# =============================================================================
# Welcome / Branding
# =============================================================================

def welcome(
    title: str = "Centris",
    subtitle: Optional[str] = None,
    version: Optional[str] = None,
) -> str:
    """
    Format a welcome message.
    
    Usage:
        print(welcome("Centris CLI", version="1.0.0"))
    """
    lines = []
    
    # Logo and title
    logo = theme.accent(symbols.LOGO) if COLORS_ENABLED else "[C]"
    title_str = theme.heading(title) if COLORS_ENABLED else title
    
    header = f"{logo} {title_str}"
    if version:
        header += f" {theme.info(f'v{version}')}"
    
    lines.append(header)
    
    if subtitle:
        lines.append(theme.muted(subtitle))
    
    return "\n".join(lines)


def goodbye(message: str = "Goodbye!") -> str:
    """
    Format a goodbye message.
    
    Usage:
        print(goodbye())
    """
    return f"\n{theme.muted(symbols.BULLET)} {message}\n"


# =============================================================================
# Interactive Helpers
# =============================================================================

def clear_line() -> None:
    """Clear the current line."""
    if sys.stdout.isatty():
        sys.stdout.write("\r" + " " * 80 + "\r")
        sys.stdout.flush()


def write_inline(text: str) -> None:
    """Write text inline (for progress updates)."""
    if sys.stdout.isatty():
        sys.stdout.write(f"\r{text}")
        sys.stdout.flush()


# =============================================================================
# Exports
# =============================================================================

__all__ = [
    # ANSI utilities
    "visible_width",
    "strip_ansi",
    "wrap_line",
    "pad_cell",
    # Table
    "Column",
    "TableOptions",
    "table",
    # Status
    "status_line",
    "key_value",
    # Sections
    "section",
    "divider",
    # Panels
    "panel",
    "card",
    # Lists
    "bullet_list",
    "numbered_list",
    "check_list",
    # Messages
    "success",
    "error",
    "info",
    "warning",
    "command_hint",
    # Branding
    "welcome",
    "goodbye",
    # Interactive
    "clear_line",
    "write_inline",
]
