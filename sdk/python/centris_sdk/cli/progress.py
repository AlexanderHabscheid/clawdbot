"""
Centris CLI Progress Indicators

Provides spinners and progress bars for CLI feedback.
Includes OSC progress support for terminal app integration (iTerm2, VS Code, etc).
"""

import os
import sys
import time
import threading
from typing import Optional, Callable, Any, Protocol, runtime_checkable
from contextlib import contextmanager
from dataclasses import dataclass

from centris_sdk.cli.theme import theme, symbols, COLORS_ENABLED


# =============================================================================
# Global Progress Tracking
# =============================================================================

_active_progress: int = 0  # Track active progress indicators
_active_lock = threading.Lock()

DEFAULT_DELAY_MS = 300  # Delay before showing progress to avoid flicker


def _increment_active() -> bool:
    """Increment active progress count. Returns True if this is the first."""
    global _active_progress
    with _active_lock:
        _active_progress += 1
        return _active_progress == 1


def _decrement_active() -> int:
    """Decrement active progress count. Returns new count."""
    global _active_progress
    with _active_lock:
        _active_progress = max(0, _active_progress - 1)
        return _active_progress


def get_active_progress_count() -> int:
    """Get current count of active progress indicators."""
    with _active_lock:
        return _active_progress


# =============================================================================
# OSC Progress Support
# =============================================================================

def supports_osc_progress() -> bool:
    """
    Check if the terminal supports OSC progress sequences.
    
    OSC progress is supported by:
    - iTerm2 (ITERM_SESSION_ID)
    - VS Code integrated terminal (TERM_PROGRAM=vscode)
    - Terminals advertising ConEmu compatibility
    - Terminals with TERM containing 'xterm' and specific env vars
    """
    if not sys.stdout.isatty():
        return False
    
    # Check for known supporting terminals
    term_program = os.environ.get("TERM_PROGRAM", "")
    if term_program.lower() in ("iterm.app", "vscode"):
        return True
    
    # iTerm2 specific
    if os.environ.get("ITERM_SESSION_ID"):
        return True
    
    # ConEmu
    if os.environ.get("ConEmuANSI") == "ON":
        return True
    
    # Check for terminal supporting OSC sequences generally
    term = os.environ.get("TERM", "")
    if "256color" in term or "kitty" in term or "alacritty" in term:
        return True
    
    return False


class OSCProgressController:
    """
    Controller for OSC (Operating System Command) progress sequences.
    
    These sequences allow terminals like iTerm2 and VS Code to show
    progress in the terminal tab/title bar.
    """
    
    def __init__(self, stream=None):
        self._stream = stream or sys.stderr
        self._enabled = supports_osc_progress() and self._stream.isatty()
    
    def _write(self, seq: str) -> None:
        """Write an OSC sequence to the stream."""
        if self._enabled:
            self._stream.write(seq)
            self._stream.flush()
    
    def set_indeterminate(self, label: str) -> None:
        """Set indeterminate (spinner) progress with label."""
        # OSC 9;4;3;0 ST - indeterminate progress
        self._write(f"\x1b]9;4;3;0\x07")
    
    def set_percent(self, label: str, percent: float) -> None:
        """Set determinate progress with percentage."""
        # OSC 9;4;1;{percent} ST - determinate progress
        p = max(0, min(100, int(percent)))
        self._write(f"\x1b]9;4;1;{p}\x07")
    
    def clear(self) -> None:
        """Clear progress indicator."""
        # OSC 9;4;0;0 ST - clear progress
        self._write(f"\x1b]9;4;0;0\x07")


# =============================================================================
# Progress Reporter Protocol
# =============================================================================

@runtime_checkable
class ProgressReporter(Protocol):
    """Protocol for progress reporting - enables testing and abstraction."""
    
    def set_label(self, label: str) -> None:
        """Update the progress label."""
        ...
    
    def set_percent(self, percent: float) -> None:
        """Set progress percentage (0-100)."""
        ...
    
    def tick(self, delta: int = 1) -> None:
        """Advance progress by delta units."""
        ...
    
    def done(self) -> None:
        """Complete and clean up progress indicator."""
        ...


@dataclass
class NoopReporter:
    """No-op progress reporter for when progress is disabled."""
    
    def set_label(self, label: str) -> None:
        pass
    
    def set_percent(self, percent: float) -> None:
        pass
    
    def tick(self, delta: int = 1) -> None:
        pass
    
    def done(self) -> None:
        pass


# =============================================================================
# Spinner
# =============================================================================

class Spinner:
    """
    Animated spinner for indeterminate progress.
    
    Features:
    - OSC progress support for terminal integration
    - Delayed start to avoid flicker for quick operations
    - Active progress tracking to prevent multiple spinners
    
    Usage:
        spinner = Spinner("Loading...")
        spinner.start()
        # do work
        spinner.stop("Done!")
        
    Or as context manager:
        with Spinner("Processing...") as spin:
            # do work
            spin.update("Still working...")
    """
    
    FRAMES = ["◐", "◓", "◑", "◒"] if COLORS_ENABLED else ["|", "/", "-", "\\"]
    INTERVAL = 0.1
    
    def __init__(
        self,
        message: str = "",
        *,
        delay_ms: int = DEFAULT_DELAY_MS,
        use_osc: bool = True,
    ):
        self.message = message
        self._delay_ms = delay_ms
        self._use_osc = use_osc and supports_osc_progress()
        self._running = False
        self._started = False
        self._thread: Optional[threading.Thread] = None
        self._frame_idx = 0
        self._lock = threading.Lock()
        self._osc = OSCProgressController() if self._use_osc else None
        self._is_primary = False  # Whether this is the primary progress
    
    def start(self) -> "Spinner":
        """Start the spinner animation."""
        # Track active progress - only show if we're the first
        self._is_primary = _increment_active()
        
        if not sys.stdout.isatty():
            # No spinner in non-TTY mode
            sys.stdout.write(f"{self.message}\n")
            sys.stdout.flush()
            return self
        
        if not self._is_primary:
            # Another progress is active, don't show visually
            return self
        
        self._running = True
        self._thread = threading.Thread(target=self._animate, daemon=True)
        self._thread.start()
        return self
    
    def _animate(self):
        """Animation loop running in background thread."""
        # Delay before showing to avoid flicker for quick operations
        delay_seconds = self._delay_ms / 1000.0
        start_time = time.time()
        
        while self._running and (time.time() - start_time) < delay_seconds:
            time.sleep(0.05)
        
        if not self._running:
            return  # Operation completed during delay
        
        self._started = True
        
        # Start OSC indeterminate progress
        if self._osc:
            self._osc.set_indeterminate(self.message)
        
        while self._running:
            with self._lock:
                frame = self.FRAMES[self._frame_idx % len(self.FRAMES)]
                colored_frame = theme.accent(frame)
                line = f"\r{colored_frame} {self.message}"
                sys.stdout.write(line)
                sys.stdout.flush()
                self._frame_idx += 1
            time.sleep(self.INTERVAL)
    
    def update(self, message: str):
        """Update the spinner message."""
        with self._lock:
            self.message = message
    
    # ProgressReporter protocol methods
    def set_label(self, label: str) -> None:
        """Update the spinner label (alias for update)."""
        self.update(label)
    
    def set_percent(self, percent: float) -> None:
        """Set percent - converts to OSC progress if available."""
        if self._osc and self._started:
            self._osc.set_percent(self.message, percent)
    
    def tick(self, delta: int = 1) -> None:
        """Tick is a no-op for indeterminate spinner."""
        pass
    
    def stop(self, final_message: Optional[str] = None):
        """Stop the spinner and optionally show a final message."""
        self._running = False
        if self._thread:
            self._thread.join(timeout=0.5)
        
        # Clear OSC progress
        if self._osc:
            self._osc.clear()
        
        if sys.stdout.isatty() and self._started:
            # Clear the line
            sys.stdout.write("\r" + " " * 80 + "\r")
            sys.stdout.flush()
        
        if final_message:
            sys.stdout.write(f"{final_message}\n")
            sys.stdout.flush()
        
        # Decrement active progress count
        _decrement_active()
    
    def done(self) -> None:
        """Complete the spinner (ProgressReporter protocol)."""
        self.stop()
    
    def success(self, message: str):
        """Stop with a success message."""
        self.stop(f"{theme.success(symbols.CHECK)} {message}")
    
    def fail(self, message: str):
        """Stop with a failure message."""
        self.stop(f"{theme.error(symbols.CROSS)} {message}")
    
    def __enter__(self) -> "Spinner":
        self.start()
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type:
            self.fail(f"Failed: {exc_val}")
        else:
            self.stop()


# =============================================================================
# Progress Bar
# =============================================================================

class ProgressBar:
    """
    Progress bar for determinate progress.
    
    Features:
    - OSC progress support for terminal integration
    - Delayed start to avoid flicker for quick operations
    - Active progress tracking to prevent multiple indicators
    
    Usage:
        with ProgressBar("Downloading", total=100) as bar:
            for i in range(100):
                # do work
                bar.advance(1)
    """
    
    BAR_WIDTH = 30
    FILLED = "█" if COLORS_ENABLED else "#"
    EMPTY = "░" if COLORS_ENABLED else "-"
    
    def __init__(
        self,
        label: str,
        total: int = 100,
        *,
        delay_ms: int = DEFAULT_DELAY_MS,
        use_osc: bool = True,
    ):
        self.label = label
        self.total = total
        self.current = 0
        self._delay_ms = delay_ms
        self._use_osc = use_osc and supports_osc_progress()
        self._start_time: Optional[float] = None
        self._display_started = False
        self._osc = OSCProgressController() if self._use_osc else None
        self._is_primary = False
    
    def _should_display(self) -> bool:
        """Check if we should display based on delay and primary status."""
        if not self._is_primary:
            return False
        if not sys.stdout.isatty():
            return False
        if self._display_started:
            return True
        if self._start_time is None:
            return False
        
        elapsed_ms = (time.time() - self._start_time) * 1000
        if elapsed_ms >= self._delay_ms:
            self._display_started = True
            return True
        return False
    
    def _render(self) -> str:
        """Render the progress bar."""
        percent = min(100, int(self.current / self.total * 100)) if self.total > 0 else 0
        filled_width = int(self.BAR_WIDTH * percent / 100)
        empty_width = self.BAR_WIDTH - filled_width
        
        filled = theme.accent(self.FILLED * filled_width)
        empty = theme.muted(self.EMPTY * empty_width)
        
        return f"{self.label} [{filled}{empty}] {percent:3d}% ({self.current}/{self.total})"
    
    def start(self) -> "ProgressBar":
        """Start the progress bar."""
        self._is_primary = _increment_active()
        self._start_time = time.time()
        return self
    
    def update(self, current: int):
        """Set current progress value."""
        self.current = min(self.total, current)
        percent = (self.current / self.total * 100) if self.total > 0 else 0
        
        # Update OSC progress
        if self._osc and self._is_primary:
            self._osc.set_percent(self.label, percent)
        
        # Display bar if conditions are met
        if self._should_display():
            sys.stdout.write(f"\r{self._render()}")
            sys.stdout.flush()
    
    def advance(self, delta: int = 1):
        """Advance progress by delta."""
        self.update(self.current + delta)
    
    # ProgressReporter protocol methods
    def set_label(self, label: str) -> None:
        """Update the progress bar label."""
        self.label = label
    
    def set_percent(self, percent: float) -> None:
        """Set progress by percentage."""
        if self.total > 0:
            self.update(int(percent * self.total / 100))
    
    def tick(self, delta: int = 1) -> None:
        """Advance progress by delta (alias for advance)."""
        self.advance(delta)
    
    def done(self, message: Optional[str] = None):
        """Complete the progress bar."""
        self.current = self.total
        
        # Clear OSC progress
        if self._osc:
            self._osc.clear()
        
        if self._display_started and sys.stdout.isatty():
            sys.stdout.write(f"\r{self._render()}\n")
            if message:
                sys.stdout.write(f"{theme.success(symbols.CHECK)} {message}\n")
            sys.stdout.flush()
        
        # Decrement active progress count
        _decrement_active()
    
    def __enter__(self) -> "ProgressBar":
        self.start()
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        if not exc_type:
            self.done()
        else:
            if self._osc:
                self._osc.clear()
            if self._display_started and sys.stdout.isatty():
                sys.stdout.write("\n")
            _decrement_active()


# =============================================================================
# Convenience Functions
# =============================================================================

@contextmanager
def spinner(message: str, *, delay_ms: int = DEFAULT_DELAY_MS):
    """
    Context manager for a spinner.
    
    Args:
        message: The message to display
        delay_ms: Delay before showing spinner (avoids flicker for quick ops)
    
    Usage:
        with spinner("Loading..."):
            # do work
    """
    spin = Spinner(message, delay_ms=delay_ms)
    spin.start()
    try:
        yield spin
    except Exception as e:
        spin.fail(str(e))
        raise
    else:
        spin.success(message.replace("...", ""))


@contextmanager
def progress(label: str, total: int, *, delay_ms: int = DEFAULT_DELAY_MS):
    """
    Context manager for a progress bar.
    
    Args:
        label: The progress bar label
        total: Total units of work
        delay_ms: Delay before showing progress (avoids flicker for quick ops)
    
    Usage:
        with progress("Downloading", 100) as bar:
            for i in range(100):
                bar.advance()
    """
    bar = ProgressBar(label, total, delay_ms=delay_ms)
    bar.start()
    try:
        yield bar
    finally:
        bar.done()


def with_spinner(message: str, *, delay_ms: int = DEFAULT_DELAY_MS):
    """
    Decorator to wrap a function with a spinner.
    
    Args:
        message: The message to display
        delay_ms: Delay before showing spinner
    
    Usage:
        @with_spinner("Processing...")
        def my_function():
            # do work
    """
    def decorator(func: Callable) -> Callable:
        def wrapper(*args, **kwargs) -> Any:
            with spinner(message, delay_ms=delay_ms) as spin:
                result = func(*args, **kwargs)
            return result
        return wrapper
    return decorator


# =============================================================================
# Clawdbot-style with_progress patterns
# =============================================================================

@dataclass
class ProgressOptions:
    """Options for progress indicators."""
    label: str
    indeterminate: bool = True
    total: Optional[int] = None
    enabled: bool = True
    delay_ms: int = DEFAULT_DELAY_MS
    fallback: str = "spinner"  # "spinner" or "none"


@dataclass
class ProgressTotalsUpdate:
    """Update for progress with totals."""
    completed: int
    total: int
    label: Optional[str] = None


def create_cli_progress(options: ProgressOptions) -> ProgressReporter:
    """
    Create a CLI progress indicator based on options.
    
    This is the Clawdbot-style factory for progress indicators.
    Returns a NoopReporter if disabled or another progress is active.
    
    Args:
        options: Configuration for the progress indicator
    
    Returns:
        A ProgressReporter instance
    """
    if not options.enabled:
        return NoopReporter()
    
    # Check if another progress is already active
    if get_active_progress_count() > 0:
        return NoopReporter()
    
    if not sys.stdout.isatty():
        return NoopReporter()
    
    # Create appropriate progress type
    if options.indeterminate or options.total is None:
        return Spinner(options.label, delay_ms=options.delay_ms)
    else:
        return ProgressBar(options.label, options.total, delay_ms=options.delay_ms)


@contextmanager
def with_progress(
    label: str,
    *,
    indeterminate: bool = True,
    total: Optional[int] = None,
    enabled: bool = True,
    delay_ms: int = DEFAULT_DELAY_MS,
):
    """
    Clawdbot-style context manager for progress with unified API.
    
    This provides a consistent API whether using spinners or progress bars,
    with automatic delayed start and OSC progress support.
    
    Args:
        label: The progress label
        indeterminate: If True, use spinner; if False, use progress bar
        total: Total units (required if indeterminate=False)
        enabled: Set False to disable progress display
        delay_ms: Delay before showing progress (avoids flicker)
    
    Usage:
        # Indeterminate (spinner)
        with with_progress("Loading...", indeterminate=True) as progress:
            do_work()
        
        # Determinate (progress bar)
        with with_progress("Processing", indeterminate=False, total=100) as progress:
            for item in items:
                process(item)
                progress.tick()
    """
    options = ProgressOptions(
        label=label,
        indeterminate=indeterminate,
        total=total,
        enabled=enabled,
        delay_ms=delay_ms,
    )
    
    reporter = create_cli_progress(options)
    
    # Start the progress if it's a Spinner or ProgressBar
    if isinstance(reporter, Spinner):
        reporter.start()
    elif isinstance(reporter, ProgressBar):
        reporter.start()
    
    try:
        yield reporter
    finally:
        reporter.done()


@contextmanager
def with_progress_totals(
    label: str,
    total: int,
    *,
    enabled: bool = True,
    delay_ms: int = DEFAULT_DELAY_MS,
):
    """
    Context manager for progress with totals update callback.
    
    Provides a callback to update both progress and totals dynamically.
    
    Args:
        label: Initial progress label
        total: Initial total units
        enabled: Set False to disable progress display
        delay_ms: Delay before showing progress
    
    Usage:
        with with_progress_totals("Processing", total=100) as (update, progress):
            for i, item in enumerate(items):
                process(item)
                update(ProgressTotalsUpdate(completed=i+1, total=len(items)))
    """
    options = ProgressOptions(
        label=label,
        indeterminate=False,
        total=total,
        enabled=enabled,
        delay_ms=delay_ms,
    )
    
    reporter = create_cli_progress(options)
    
    if isinstance(reporter, ProgressBar):
        reporter.start()
    
    def update(upd: ProgressTotalsUpdate) -> None:
        """Update progress with new totals."""
        if upd.label:
            reporter.set_label(upd.label)
        if upd.total > 0:
            percent = (upd.completed / upd.total) * 100
            reporter.set_percent(percent)
    
    try:
        yield update, reporter
    finally:
        reporter.done()


__all__ = [
    # Core classes
    "Spinner",
    "ProgressBar",
    "ProgressReporter",
    "NoopReporter",
    "ProgressOptions",
    "ProgressTotalsUpdate",
    # OSC support
    "OSCProgressController",
    "supports_osc_progress",
    # Simple context managers
    "spinner",
    "progress",
    # Decorator
    "with_spinner",
    # Clawdbot-style patterns
    "create_cli_progress",
    "with_progress",
    "with_progress_totals",
    # Constants
    "DEFAULT_DELAY_MS",
    # Utilities
    "get_active_progress_count",
]
