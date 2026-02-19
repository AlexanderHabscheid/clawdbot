"""
Centris CLI Interactive Wizard

Provides guided, interactive prompts for connector creation.
Inspired by @clack/prompts but for Python.
"""

import sys
from typing import Optional, List, Any, Callable, TypeVar

from centris_sdk.cli.theme import theme, symbols, styled_success, styled_error, box, COLORS_ENABLED


T = TypeVar("T")


class WizardCancelledError(Exception):
    """Raised when user cancels the wizard."""
    pass


# =============================================================================
# Prompt Utilities
# =============================================================================

def _read_line() -> str:
    """Read a line from stdin."""
    try:
        return input().strip()
    except EOFError:
        raise WizardCancelledError("Input stream closed")


def _is_cancel(value: str) -> bool:
    """Check if input indicates cancellation."""
    return value.lower() in ("q", "quit", "exit", "cancel")


def _guard_cancel(value: str) -> str:
    """Raise WizardCancelledError if value indicates cancellation."""
    if _is_cancel(value):
        print(f"\n{theme.warn('!')} Setup cancelled.")
        raise WizardCancelledError("User cancelled")
    return value


# =============================================================================
# Styled Output
# =============================================================================

def intro(title: str) -> None:
    """
    Display wizard intro message.
    
    Usage:
        intro("Create a new connector")
    """
    if COLORS_ENABLED:
        border = theme.muted("━" * 50)
        print(f"\n{border}")
        print(f"  {theme.heading(symbols.LOGO)} {theme.heading(title)}")
        print(f"{border}\n")
    else:
        print(f"\n{'=' * 50}")
        print(f"  {title}")
        print(f"{'=' * 50}\n")


def outro(message: str) -> None:
    """
    Display wizard outro message.
    
    Usage:
        outro("Connector created successfully!")
    """
    if COLORS_ENABLED:
        border = theme.muted("━" * 50)
        print(f"\n{border}")
        print(f"  {theme.success(symbols.CHECK)} {message}")
        print(f"{border}\n")
    else:
        print(f"\n{'=' * 50}")
        print(f"  [OK] {message}")
        print(f"{'=' * 50}\n")


def note(message: str, title: Optional[str] = None) -> None:
    """
    Display a note box.
    
    Usage:
        note("This is important information", "Note")
    """
    print(box(message, title))
    print()


def step(number: int, total: int, message: str) -> None:
    """
    Display a step indicator.
    
    Usage:
        step(1, 5, "Configure basics")
    """
    if COLORS_ENABLED:
        prefix = theme.accent(f"[{number}/{total}]")
        print(f"\n{prefix} {theme.heading(message)}")
    else:
        print(f"\n[{number}/{total}] {message}")


# =============================================================================
# Input Prompts
# =============================================================================

def text(
    message: str,
    default: Optional[str] = None,
    placeholder: Optional[str] = None,
    validate: Optional[Callable[[str], Optional[str]]] = None,
) -> str:
    """
    Prompt for text input.
    
    Args:
        message: The prompt message
        default: Default value (shown in prompt)
        placeholder: Placeholder hint
        validate: Validation function (returns error message or None)
    
    Returns:
        User input string
    
    Usage:
        name = text("Connector name", default="my-connector")
    """
    while True:
        # Build prompt
        prompt_parts = [theme.accent("?") if COLORS_ENABLED else "?", message]
        
        if default:
            prompt_parts.append(theme.muted(f"({default})") if COLORS_ENABLED else f"({default})")
        
        if placeholder:
            prompt_parts.append(theme.muted(f"[{placeholder}]") if COLORS_ENABLED else f"[{placeholder}]")
        
        prompt = " ".join(prompt_parts) + " "
        
        # Get input
        sys.stdout.write(prompt)
        sys.stdout.flush()
        
        value = _read_line()
        _guard_cancel(value)
        
        # Use default if empty
        if not value and default:
            value = default
        
        # Validate
        if validate:
            error = validate(value)
            if error:
                print(styled_error(error))
                continue
        
        if not value:
            print(styled_error("Value required"))
            continue
        
        return value


def confirm(message: str, default: bool = True) -> bool:
    """
    Prompt for yes/no confirmation.
    
    Args:
        message: The prompt message
        default: Default value
    
    Returns:
        True for yes, False for no
    
    Usage:
        if confirm("Continue?"):
            # proceed
    """
    default_hint = "Y/n" if default else "y/N"
    
    if COLORS_ENABLED:
        prompt = f"{theme.accent('?')} {message} {theme.muted(f'({default_hint})')} "
    else:
        prompt = f"? {message} ({default_hint}) "
    
    sys.stdout.write(prompt)
    sys.stdout.flush()
    
    value = _read_line().lower()
    _guard_cancel(value)
    
    if not value:
        return default
    
    return value in ("y", "yes", "true", "1")


def select(
    message: str,
    options: List[dict],
    default: Optional[str] = None,
) -> str:
    """
    Prompt for selection from options.
    
    Args:
        message: The prompt message
        options: List of {"value": ..., "label": ..., "hint": ...}
        default: Default value
    
    Returns:
        Selected value
    
    Usage:
        template = select("Template", [
            {"value": "basic", "label": "Basic", "hint": "Simple connector"},
            {"value": "browser", "label": "Browser", "hint": "Browser automation"},
        ])
    """
    if COLORS_ENABLED:
        print(f"\n{theme.accent('?')} {message}")
    else:
        print(f"\n? {message}")
    
    # Display options
    for i, opt in enumerate(options, 1):
        label = opt.get("label", opt["value"])
        hint = opt.get("hint", "")
        
        marker = theme.accent(">") if opt["value"] == default else " "
        number = theme.muted(f"{i}.") if COLORS_ENABLED else f"{i}."
        
        if hint:
            if COLORS_ENABLED:
                print(f"  {marker} {number} {label} {theme.muted(f'- {hint}')}")
            else:
                print(f"  {marker} {number} {label} - {hint}")
        else:
            print(f"  {marker} {number} {label}")
    
    print()
    
    # Get selection
    while True:
        if COLORS_ENABLED:
            prompt = f"  {theme.muted('Enter number or value:')} "
        else:
            prompt = "  Enter number or value: "
        
        sys.stdout.write(prompt)
        sys.stdout.flush()
        
        value = _read_line()
        _guard_cancel(value)
        
        # Use default if empty
        if not value and default:
            return default
        
        # Check if it's a number
        try:
            idx = int(value) - 1
            if 0 <= idx < len(options):
                return options[idx]["value"]
        except ValueError:
            pass
        
        # Check if it's a value
        for opt in options:
            if opt["value"] == value or opt.get("label", "").lower() == value.lower():
                return opt["value"]
        
        print(styled_error(f"Invalid selection. Enter 1-{len(options)} or a value."))


def multiselect(
    message: str,
    options: List[dict],
    defaults: Optional[List[str]] = None,
) -> List[str]:
    """
    Prompt for multiple selections.
    
    Args:
        message: The prompt message
        options: List of {"value": ..., "label": ..., "hint": ...}
        defaults: Default selected values
    
    Returns:
        List of selected values
    
    Usage:
        features = multiselect("Features", [
            {"value": "auth", "label": "Authentication"},
            {"value": "cache", "label": "Caching"},
        ])
    """
    defaults = defaults or []
    
    if COLORS_ENABLED:
        print(f"\n{theme.accent('?')} {message} {theme.muted('(comma-separated numbers)')}")
    else:
        print(f"\n? {message} (comma-separated numbers)")
    
    # Display options
    for i, opt in enumerate(options, 1):
        label = opt.get("label", opt["value"])
        hint = opt.get("hint", "")
        selected = opt["value"] in defaults
        
        check = theme.success("[x]") if selected else theme.muted("[ ]")
        number = theme.muted(f"{i}.") if COLORS_ENABLED else f"{i}."
        
        if hint:
            if COLORS_ENABLED:
                print(f"  {check} {number} {label} {theme.muted(f'- {hint}')}")
            else:
                check_plain = "[x]" if selected else "[ ]"
                print(f"  {check_plain} {number} {label} - {hint}")
        else:
            print(f"  {check} {number} {label}")
    
    print()
    
    # Get selection
    if COLORS_ENABLED:
        prompt = f"  {theme.muted('Enter numbers (e.g., 1,3,4) or press Enter for defaults:')} "
    else:
        prompt = "  Enter numbers (e.g., 1,3,4) or press Enter for defaults: "
    
    sys.stdout.write(prompt)
    sys.stdout.flush()
    
    value = _read_line()
    _guard_cancel(value)
    
    if not value:
        return defaults
    
    # Parse selections
    selected = []
    for part in value.split(","):
        part = part.strip()
        try:
            idx = int(part) - 1
            if 0 <= idx < len(options):
                selected.append(options[idx]["value"])
        except ValueError:
            # Check if it's a value
            for opt in options:
                if opt["value"] == part or opt.get("label", "").lower() == part.lower():
                    selected.append(opt["value"])
                    break
    
    return selected


# =============================================================================
# Wizard Class
# =============================================================================

class Wizard:
    """
    Interactive wizard helper.
    
    Usage:
        wiz = Wizard("Create Connector")
        wiz.intro()
        
        name = wiz.text("Name?")
        template = wiz.select("Template?", [...])
        
        wiz.outro("Done!")
    """
    
    def __init__(self, title: str):
        self.title = title
        self._step_num = 0
        self._total_steps = 0
    
    def set_total_steps(self, total: int):
        """Set total number of steps for step display."""
        self._total_steps = total
    
    def intro(self) -> None:
        """Display intro."""
        intro(self.title)
    
    def outro(self, message: str) -> None:
        """Display outro."""
        outro(message)
    
    def note(self, message: str, title: Optional[str] = None) -> None:
        """Display a note."""
        note(message, title)
    
    def step(self, message: str) -> None:
        """Display and advance step."""
        self._step_num += 1
        if self._total_steps > 0:
            step(self._step_num, self._total_steps, message)
        else:
            if COLORS_ENABLED:
                print(f"\n{theme.accent(symbols.ARROW)} {theme.heading(message)}")
            else:
                print(f"\n-> {message}")
    
    def text(self, *args, **kwargs) -> str:
        """Prompt for text."""
        return text(*args, **kwargs)
    
    def confirm(self, *args, **kwargs) -> bool:
        """Prompt for confirmation."""
        return confirm(*args, **kwargs)
    
    def select(self, *args, **kwargs) -> str:
        """Prompt for selection."""
        return select(*args, **kwargs)
    
    def multiselect(self, *args, **kwargs) -> List[str]:
        """Prompt for multiple selection."""
        return multiselect(*args, **kwargs)


__all__ = [
    "WizardCancelledError",
    "intro",
    "outro",
    "note",
    "step",
    "text",
    "confirm",
    "select",
    "multiselect",
    "Wizard",
]
