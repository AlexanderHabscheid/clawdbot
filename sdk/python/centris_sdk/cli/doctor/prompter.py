"""
Centris CLI - Doctor Prompter

Abstraction for interactive prompts in the doctor command.
Enables testing by allowing mock prompter implementations.

Based on Clawdbot's doctor-prompter.ts pattern.
"""

import sys
from dataclasses import dataclass, field
from typing import Optional, List, Protocol, runtime_checkable, Any, TypeVar

from centris_sdk.cli.theme import theme
from centris_sdk.cli.ui import note as render_note


@dataclass
class DoctorOptions:
    """Options for the doctor command."""
    fix: bool = False
    as_json: bool = False
    categories: Optional[List[str]] = None
    verbose: bool = False
    non_interactive: bool = False
    yes: bool = False  # Auto-confirm all prompts
    
    @property
    def should_prompt(self) -> bool:
        """Whether interactive prompts are allowed."""
        return not self.non_interactive and not self.yes and sys.stdin.isatty()


T = TypeVar('T')


@runtime_checkable
class DoctorPrompter(Protocol):
    """
    Protocol for doctor command prompts.
    
    This abstraction allows:
    - Interactive mode with real user input
    - Non-interactive mode that uses defaults
    - Test mode with mock responses
    """
    
    def confirm(
        self,
        message: str,
        initial: bool = True,
    ) -> bool:
        """
        Ask a yes/no confirmation question.
        
        Args:
            message: The question to ask
            initial: Default value if non-interactive
        
        Returns:
            True for yes, False for no
        """
        ...
    
    def confirm_repair(
        self,
        message: str,
        initial: bool = True,
    ) -> bool:
        """
        Ask for confirmation before a repair action.
        
        Args:
            message: Description of the repair
            initial: Default value if non-interactive
        
        Returns:
            True to proceed, False to skip
        """
        ...
    
    def confirm_skip_in_non_interactive(
        self,
        message: str,
        initial: bool = True,
    ) -> bool:
        """
        Ask for confirmation, returning False in non-interactive mode.
        
        Args:
            message: The question to ask
            initial: Default value in interactive mode
        
        Returns:
            True for yes, False for no (always False in non-interactive)
        """
        ...
    
    def select(
        self,
        message: str,
        options: List[str],
        initial: Optional[str] = None,
    ) -> str:
        """
        Ask the user to select from a list of options.
        
        Args:
            message: The question to ask
            options: List of options to choose from
            initial: Default option if non-interactive
        
        Returns:
            The selected option
        """
        ...
    
    def note(self, message: str, category: str = "") -> None:
        """
        Display an informational note.
        
        Args:
            message: The note content
            category: Optional category label
        """
        ...


class InteractivePrompter:
    """Interactive prompter that asks the user for input."""
    
    def __init__(self, options: DoctorOptions):
        self.options = options
    
    def _should_prompt(self) -> bool:
        """Check if we should show interactive prompts."""
        return self.options.should_prompt
    
    def confirm(
        self,
        message: str,
        initial: bool = True,
    ) -> bool:
        """Ask a yes/no confirmation."""
        if not self._should_prompt():
            return initial if not self.options.yes else True
        
        default_str = "Y/n" if initial else "y/N"
        prompt = f"{message} [{default_str}]: "
        
        try:
            response = input(theme.muted(prompt)).strip().lower()
            if not response:
                return initial
            return response in ("y", "yes", "1", "true")
        except (EOFError, KeyboardInterrupt):
            print()
            return initial
    
    def confirm_repair(
        self,
        message: str,
        initial: bool = True,
    ) -> bool:
        """Ask for repair confirmation."""
        if not self._should_prompt():
            return initial if not self.options.yes else True
        
        # Add visual indicator for repair actions
        repair_msg = f"🔧 {message}"
        return self.confirm(repair_msg, initial)
    
    def confirm_skip_in_non_interactive(
        self,
        message: str,
        initial: bool = True,
    ) -> bool:
        """Ask for confirmation, skipping in non-interactive mode."""
        if not self._should_prompt():
            return False
        return self.confirm(message, initial)
    
    def select(
        self,
        message: str,
        options: List[str],
        initial: Optional[str] = None,
    ) -> str:
        """Ask user to select from options."""
        if not self._should_prompt():
            return initial or options[0]
        
        print(theme.muted(message))
        for i, option in enumerate(options, 1):
            marker = ">" if option == initial else " "
            print(f"  {marker} {i}. {option}")
        
        default_idx = options.index(initial) + 1 if initial in options else 1
        prompt = f"Enter choice [1-{len(options)}, default={default_idx}]: "
        
        try:
            response = input(theme.muted(prompt)).strip()
            if not response:
                return initial or options[0]
            
            idx = int(response) - 1
            if 0 <= idx < len(options):
                return options[idx]
            return initial or options[0]
        except (ValueError, EOFError, KeyboardInterrupt):
            print()
            return initial or options[0]
    
    def note(self, message: str, category: str = "") -> None:
        """Display an informational note."""
        if category:
            print(f"\n{theme.heading(category)}")
        for line in message.split("\n"):
            print(f"  {theme.muted('•')} {line}")


class NonInteractivePrompter:
    """Non-interactive prompter that uses defaults."""
    
    def __init__(self, options: DoctorOptions):
        self.options = options
    
    def confirm(
        self,
        message: str,
        initial: bool = True,
    ) -> bool:
        """Return default or yes if --yes flag."""
        return True if self.options.yes else initial
    
    def confirm_repair(
        self,
        message: str,
        initial: bool = True,
    ) -> bool:
        """Return default or yes if --yes flag."""
        return True if self.options.yes else initial
    
    def confirm_skip_in_non_interactive(
        self,
        message: str,
        initial: bool = True,
    ) -> bool:
        """Always return False in non-interactive mode."""
        return False
    
    def select(
        self,
        message: str,
        options: List[str],
        initial: Optional[str] = None,
    ) -> str:
        """Return the initial/default option."""
        return initial or options[0]
    
    def note(self, message: str, category: str = "") -> None:
        """Notes are silent in non-interactive mode."""
        pass


class MockPrompter:
    """
    Mock prompter for testing.
    
    Records all prompts and returns configured responses.
    """
    
    def __init__(
        self,
        confirm_responses: Optional[List[bool]] = None,
        select_responses: Optional[List[str]] = None,
    ):
        self.confirm_responses = confirm_responses or []
        self.select_responses = select_responses or []
        self.confirm_calls: List[str] = []
        self.select_calls: List[str] = []
        self.notes: List[str] = []
        self._confirm_idx = 0
        self._select_idx = 0
    
    def confirm(
        self,
        message: str,
        initial: bool = True,
    ) -> bool:
        """Return pre-configured response or initial."""
        self.confirm_calls.append(message)
        if self._confirm_idx < len(self.confirm_responses):
            response = self.confirm_responses[self._confirm_idx]
            self._confirm_idx += 1
            return response
        return initial
    
    def confirm_repair(
        self,
        message: str,
        initial: bool = True,
    ) -> bool:
        """Same as confirm for testing."""
        return self.confirm(message, initial)
    
    def confirm_skip_in_non_interactive(
        self,
        message: str,
        initial: bool = True,
    ) -> bool:
        """Same as confirm for testing."""
        return self.confirm(message, initial)
    
    def select(
        self,
        message: str,
        options: List[str],
        initial: Optional[str] = None,
    ) -> str:
        """Return pre-configured response or initial."""
        self.select_calls.append(message)
        if self._select_idx < len(self.select_responses):
            response = self.select_responses[self._select_idx]
            self._select_idx += 1
            return response
        return initial or options[0]
    
    def note(self, message: str, category: str = "") -> None:
        """Record notes for verification."""
        self.notes.append(f"[{category}] {message}" if category else message)


def create_doctor_prompter(options: DoctorOptions) -> DoctorPrompter:
    """
    Factory function to create the appropriate prompter.
    
    Args:
        options: Doctor command options
    
    Returns:
        A prompter instance based on the options
    """
    if options.non_interactive or options.as_json:
        return NonInteractivePrompter(options)
    return InteractivePrompter(options)


__all__ = [
    "DoctorOptions",
    "DoctorPrompter",
    "InteractivePrompter",
    "NonInteractivePrompter",
    "MockPrompter",
    "create_doctor_prompter",
]
