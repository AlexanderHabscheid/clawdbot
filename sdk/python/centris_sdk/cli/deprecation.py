"""
Centris CLI Deprecation System

Provides decorators and utilities for deprecating CLI commands and API features.
Ensures developers are warned early and guided through migrations.

Usage:
    @deprecated(
        version="2.0.0",
        alternative="centris agent run",
        reason="Unified under agent command",
        sunset_date="2026-06-01",
    )
    @cli.command()
    def exec():
        '''DEPRECATED: Use 'centris agent run' instead.'''
        pass
"""

import functools
import warnings
from dataclasses import dataclass, field
from datetime import datetime
from typing import Callable, Dict, List, Optional, TypeVar, Any, Union
from enum import Enum
import sys

import click


# =============================================================================
# Deprecation Registry
# =============================================================================

class DeprecationLevel(Enum):
    """Severity level for deprecation warnings."""
    WARNING = "warning"  # Feature works, will be removed
    DEPRECATED = "deprecated"  # Feature works, removal imminent
    REMOVED = "removed"  # Feature no longer works


@dataclass
class DeprecationInfo:
    """Information about a deprecated feature."""
    name: str
    deprecated_in: str  # Version when deprecated
    removal_version: Optional[str] = None  # Version when removal planned
    alternative: Optional[str] = None
    reason: Optional[str] = None
    sunset_date: Optional[str] = None  # ISO date (YYYY-MM-DD)
    migration_guide: Optional[str] = None  # URL to migration docs
    level: DeprecationLevel = DeprecationLevel.WARNING
    show_once: bool = True  # Only show warning once per session
    _warned: bool = field(default=False, repr=False, compare=False)
    
    def is_past_sunset(self) -> bool:
        """Check if the sunset date has passed."""
        if not self.sunset_date:
            return False
        try:
            sunset = datetime.strptime(self.sunset_date, "%Y-%m-%d")
            return datetime.now() > sunset
        except ValueError:
            return False
    
    def format_warning(self, include_color: bool = True) -> str:
        """Format the deprecation warning message."""
        from centris_sdk.cli.theme import theme, symbols, COLORS_ENABLED
        
        use_color = include_color and COLORS_ENABLED
        
        parts = []
        
        # Header
        if use_color:
            if self.level == DeprecationLevel.REMOVED:
                parts.append(theme.error(f"{symbols.CROSS} REMOVED: '{self.name}' has been removed."))
            elif self.level == DeprecationLevel.DEPRECATED:
                parts.append(theme.warning(f"{symbols.WARN} DEPRECATED: '{self.name}' will be removed soon."))
            else:
                parts.append(theme.warning(f"{symbols.WARN} WARNING: '{self.name}' is deprecated."))
        else:
            if self.level == DeprecationLevel.REMOVED:
                parts.append(f"REMOVED: '{self.name}' has been removed.")
            elif self.level == DeprecationLevel.DEPRECATED:
                parts.append(f"DEPRECATED: '{self.name}' will be removed soon.")
            else:
                parts.append(f"WARNING: '{self.name}' is deprecated.")
        
        # Version info
        version_info = f"  Deprecated in: v{self.deprecated_in}"
        if self.removal_version:
            version_info += f" | Removal: v{self.removal_version}"
        parts.append(theme.muted(version_info) if use_color else version_info)
        
        # Reason
        if self.reason:
            reason_line = f"  Reason: {self.reason}"
            parts.append(theme.muted(reason_line) if use_color else reason_line)
        
        # Sunset date
        if self.sunset_date:
            sunset_line = f"  Sunset date: {self.sunset_date}"
            if self.is_past_sunset():
                sunset_line = theme.error(sunset_line + " (PASSED)") if use_color else sunset_line + " (PASSED)"
            else:
                sunset_line = theme.muted(sunset_line) if use_color else sunset_line
            parts.append(sunset_line)
        
        # Alternative
        if self.alternative:
            alt_line = f"  Use instead: {self.alternative}"
            parts.append(theme.accent(alt_line) if use_color else alt_line)
        
        # Migration guide
        if self.migration_guide:
            guide_line = f"  Migration guide: {self.migration_guide}"
            parts.append(theme.link(guide_line) if use_color else guide_line)
        
        return "\n".join(parts)


class DeprecationRegistry:
    """
    Registry of all deprecated features.
    
    Used to:
    - Track all deprecations in one place
    - Generate deprecation reports
    - Validate deprecation consistency
    """
    
    _instance: Optional["DeprecationRegistry"] = None
    
    def __init__(self):
        self._deprecations: Dict[str, DeprecationInfo] = {}
        self._categories: Dict[str, List[str]] = {}  # category -> names
    
    @classmethod
    def get_instance(cls) -> "DeprecationRegistry":
        """Get the singleton registry instance."""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance
    
    def register(
        self,
        name: str,
        deprecated_in: str,
        *,
        category: str = "cli",
        **kwargs,
    ) -> DeprecationInfo:
        """
        Register a deprecation.
        
        Args:
            name: Feature name (e.g., "centris exec", "api.v1.do")
            deprecated_in: Version when deprecated
            category: Category for grouping (cli, api, sdk)
            **kwargs: Additional DeprecationInfo fields
        
        Returns:
            The DeprecationInfo object
        """
        info = DeprecationInfo(name=name, deprecated_in=deprecated_in, **kwargs)
        self._deprecations[name] = info
        
        if category not in self._categories:
            self._categories[category] = []
        self._categories[category].append(name)
        
        return info
    
    def get(self, name: str) -> Optional[DeprecationInfo]:
        """Get deprecation info by name."""
        return self._deprecations.get(name)
    
    def get_by_category(self, category: str) -> List[DeprecationInfo]:
        """Get all deprecations in a category."""
        names = self._categories.get(category, [])
        return [self._deprecations[n] for n in names if n in self._deprecations]
    
    def list_all(self) -> List[DeprecationInfo]:
        """List all registered deprecations."""
        return list(self._deprecations.values())
    
    def get_active(self) -> List[DeprecationInfo]:
        """Get deprecations that are still relevant (not past removal version)."""
        return [d for d in self._deprecations.values() if d.level != DeprecationLevel.REMOVED]
    
    def get_past_sunset(self) -> List[DeprecationInfo]:
        """Get deprecations past their sunset date."""
        return [d for d in self._deprecations.values() if d.is_past_sunset()]
    
    def clear(self):
        """Clear all registrations (for testing)."""
        self._deprecations.clear()
        self._categories.clear()


# Global registry instance
_registry = DeprecationRegistry.get_instance()


def get_deprecation_registry() -> DeprecationRegistry:
    """Get the global deprecation registry."""
    return _registry


# =============================================================================
# Deprecation Decorator for CLI Commands
# =============================================================================

F = TypeVar('F', bound=Callable[..., Any])


def deprecated(
    version: str,
    *,
    alternative: Optional[str] = None,
    reason: Optional[str] = None,
    removal_version: Optional[str] = None,
    sunset_date: Optional[str] = None,
    migration_guide: Optional[str] = None,
    level: DeprecationLevel = DeprecationLevel.WARNING,
    show_once: bool = True,
    category: str = "cli",
) -> Callable[[F], F]:
    """
    Decorator to mark a CLI command as deprecated.
    
    Displays a warning when the command is invoked and registers
    the deprecation in the global registry.
    
    Args:
        version: Version in which the feature was deprecated
        alternative: Alternative command to use instead
        reason: Reason for deprecation
        removal_version: Version in which feature will be removed
        sunset_date: ISO date (YYYY-MM-DD) after which feature may stop working
        migration_guide: URL to migration documentation
        level: Severity level (WARNING, DEPRECATED, REMOVED)
        show_once: Only show warning once per session
        category: Category for registry grouping
    
    Usage:
        @deprecated(
            version="2.0.0",
            alternative="centris agent run",
            reason="Unified under agent command",
        )
        @cli.command()
        def exec():
            '''Execute a command (DEPRECATED).'''
            pass
    """
    def decorator(func: F) -> F:
        # Get command name from function or Click command
        # Handle both raw functions and Click Command objects
        if hasattr(func, '__name__'):
            func_name = func.__name__
        elif hasattr(func, 'name'):
            # Click Command object
            func_name = func.name
        elif hasattr(func, 'callback') and hasattr(func.callback, '__name__'):
            # Click Command with callback
            func_name = func.callback.__name__
        else:
            func_name = "unknown"
        name = f"centris {func_name.replace('_', '-')}"
        
        # Register deprecation
        info = _registry.register(
            name,
            version,
            category=category,
            alternative=alternative,
            reason=reason,
            removal_version=removal_version,
            sunset_date=sunset_date,
            migration_guide=migration_guide,
            level=level,
            show_once=show_once,
        )
        
        def create_warning_wrapper(original_func):
            """Create a wrapper that shows deprecation warning."""
            @functools.wraps(original_func)
            def wrapper(*args, **kwargs):
                # Check if we should warn
                should_warn = not (info.show_once and info._warned)
                
                if should_warn:
                    # Print warning to stderr
                    click.echo(info.format_warning(), err=True)
                    click.echo("", err=True)  # Blank line
                    info._warned = True
                    
                    # If past sunset, fail the command
                    if info.is_past_sunset() and info.level == DeprecationLevel.REMOVED:
                        raise click.ClickException(
                            f"'{name}' has been removed. "
                            f"Please use '{info.alternative}' instead."
                        )
                
                return original_func(*args, **kwargs)
            return wrapper
        
        # Handle Click Command objects specially - modify callback, preserve Command
        if isinstance(func, click.Command):
            if func.callback is not None:
                func.callback = create_warning_wrapper(func.callback)
            return func  # type: ignore
        
        # For regular functions, wrap and preserve click params
        wrapper = create_warning_wrapper(func)
        wrapper.__click_params__ = getattr(func, '__click_params__', [])
        
        return wrapper  # type: ignore
    
    return decorator


def deprecated_option(
    option_name: str,
    version: str,
    *,
    alternative: Optional[str] = None,
    reason: Optional[str] = None,
) -> Callable[[F], F]:
    """
    Decorator to mark a CLI option as deprecated.
    
    Displays a warning when the option is used.
    
    Args:
        option_name: Name of the deprecated option (e.g., "--old-flag")
        version: Version in which the option was deprecated
        alternative: Alternative option to use
        reason: Reason for deprecation
    
    Usage:
        @cli.command()
        @click.option("--old-flag", hidden=True)
        @deprecated_option("--old-flag", "2.0.0", alternative="--new-flag")
        def my_command(old_flag):
            pass
    """
    def decorator(func: F) -> F:
        # Register in registry
        name = f"option {option_name}"
        _registry.register(
            name,
            version,
            category="cli-option",
            alternative=f"--{alternative}" if alternative and not alternative.startswith("--") else alternative,
            reason=reason,
        )
        
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            # Check if the deprecated option was used
            param_name = option_name.lstrip("-").replace("-", "_")
            if kwargs.get(param_name) is not None:
                from centris_sdk.cli.theme import theme, symbols
                
                msg = f"{symbols.WARN} Option '{option_name}' is deprecated (since v{version})."
                if alternative:
                    msg += f" Use '{alternative}' instead."
                if reason:
                    msg += f"\n  Reason: {reason}"
                
                click.echo(theme.warning(msg), err=True)
            
            return func(*args, **kwargs)
        
        wrapper.__click_params__ = getattr(func, '__click_params__', [])
        return wrapper  # type: ignore
    
    return decorator


# =============================================================================
# Deprecation Warning Utilities
# =============================================================================

def warn_deprecated(
    feature: str,
    version: str,
    *,
    alternative: Optional[str] = None,
    stacklevel: int = 2,
):
    """
    Issue a deprecation warning programmatically.
    
    Use this for deprecated function calls or behaviors within commands.
    
    Args:
        feature: Name of the deprecated feature
        version: Version when deprecated
        alternative: Alternative to use
        stacklevel: Stack level for warning (default: 2 = caller)
    
    Example:
        def old_function():
            warn_deprecated("old_function", "2.0.0", alternative="new_function()")
            return new_function()
    """
    msg = f"'{feature}' is deprecated since v{version}."
    if alternative:
        msg += f" Use '{alternative}' instead."
    
    warnings.warn(msg, DeprecationWarning, stacklevel=stacklevel)


def emit_deprecation_notice(name: str, ctx: Optional[click.Context] = None):
    """
    Emit a deprecation notice for a registered deprecation.
    
    Looks up the deprecation in the registry and displays the warning.
    
    Args:
        name: Name of the deprecated feature (as registered)
        ctx: Optional Click context for additional info
    """
    info = _registry.get(name)
    if info:
        click.echo(info.format_warning(), err=True)
        click.echo("", err=True)


# =============================================================================
# Migration Guide Framework
# =============================================================================

@dataclass
class MigrationStep:
    """A single step in a migration guide."""
    description: str
    old_code: Optional[str] = None
    new_code: Optional[str] = None
    notes: Optional[str] = None


@dataclass
class MigrationGuide:
    """
    A migration guide for moving from deprecated to new features.
    
    Can be rendered as markdown or CLI output.
    """
    feature: str
    deprecated_in: str
    removal_version: Optional[str] = None
    summary: str = ""
    steps: List[MigrationStep] = field(default_factory=list)
    breaking_changes: List[str] = field(default_factory=list)
    additional_notes: Optional[str] = None
    
    def add_step(
        self,
        description: str,
        *,
        old_code: Optional[str] = None,
        new_code: Optional[str] = None,
        notes: Optional[str] = None,
    ) -> "MigrationGuide":
        """Add a migration step."""
        self.steps.append(MigrationStep(
            description=description,
            old_code=old_code,
            new_code=new_code,
            notes=notes,
        ))
        return self
    
    def add_breaking_change(self, change: str) -> "MigrationGuide":
        """Add a breaking change note."""
        self.breaking_changes.append(change)
        return self
    
    def to_markdown(self) -> str:
        """Render as Markdown."""
        lines = [
            f"# Migration Guide: {self.feature}",
            "",
            f"**Deprecated in:** v{self.deprecated_in}",
        ]
        
        if self.removal_version:
            lines.append(f"**Will be removed in:** v{self.removal_version}")
        
        lines.extend(["", self.summary, ""])
        
        if self.breaking_changes:
            lines.extend([
                "## Breaking Changes",
                "",
            ])
            for change in self.breaking_changes:
                lines.append(f"- {change}")
            lines.append("")
        
        if self.steps:
            lines.extend([
                "## Migration Steps",
                "",
            ])
            for i, step in enumerate(self.steps, 1):
                lines.append(f"### Step {i}: {step.description}")
                lines.append("")
                
                if step.old_code:
                    lines.extend([
                        "**Before:**",
                        "```python",
                        step.old_code,
                        "```",
                        "",
                    ])
                
                if step.new_code:
                    lines.extend([
                        "**After:**",
                        "```python",
                        step.new_code,
                        "```",
                        "",
                    ])
                
                if step.notes:
                    lines.extend([
                        f"> **Note:** {step.notes}",
                        "",
                    ])
        
        if self.additional_notes:
            lines.extend([
                "## Additional Notes",
                "",
                self.additional_notes,
            ])
        
        return "\n".join(lines)
    
    def print_cli(self):
        """Print as CLI output with colors."""
        from centris_sdk.cli.theme import theme, symbols
        
        click.echo(theme.header(f"Migration Guide: {self.feature}"))
        click.echo("")
        click.echo(f"  Deprecated in: {theme.accent(f'v{self.deprecated_in}')}")
        if self.removal_version:
            click.echo(f"  Removal planned: {theme.warning(f'v{self.removal_version}')}")
        click.echo("")
        click.echo(self.summary)
        click.echo("")
        
        if self.breaking_changes:
            click.echo(theme.warning(f"{symbols.WARN} Breaking Changes:"))
            for change in self.breaking_changes:
                click.echo(f"  • {change}")
            click.echo("")
        
        if self.steps:
            click.echo(theme.header("Migration Steps:"))
            for i, step in enumerate(self.steps, 1):
                click.echo(f"\n  {i}. {step.description}")
                
                if step.old_code:
                    click.echo(f"\n     {theme.muted('Before:')}")
                    for line in step.old_code.split("\n"):
                        click.echo(f"       {theme.error(line)}")
                
                if step.new_code:
                    click.echo(f"\n     {theme.muted('After:')}")
                    for line in step.new_code.split("\n"):
                        click.echo(f"       {theme.success(line)}")
                
                if step.notes:
                    click.echo(f"\n     {theme.muted('Note:')} {step.notes}")


class MigrationRegistry:
    """Registry for migration guides."""
    
    _instance: Optional["MigrationRegistry"] = None
    
    def __init__(self):
        self._guides: Dict[str, MigrationGuide] = {}
    
    @classmethod
    def get_instance(cls) -> "MigrationRegistry":
        """Get the singleton instance."""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance
    
    def register(self, guide: MigrationGuide) -> MigrationGuide:
        """Register a migration guide."""
        self._guides[guide.feature] = guide
        return guide
    
    def get(self, feature: str) -> Optional[MigrationGuide]:
        """Get a migration guide by feature name."""
        return self._guides.get(feature)
    
    def list_all(self) -> List[MigrationGuide]:
        """List all migration guides."""
        return list(self._guides.values())


_migration_registry = MigrationRegistry.get_instance()


def get_migration_registry() -> MigrationRegistry:
    """Get the global migration registry."""
    return _migration_registry


def register_migration(
    feature: str,
    deprecated_in: str,
    summary: str,
    *,
    removal_version: Optional[str] = None,
) -> MigrationGuide:
    """
    Create and register a migration guide.
    
    Returns the guide for chaining.
    
    Usage:
        guide = register_migration(
            "centris exec",
            "2.0.0",
            "The exec command is replaced by agent run.",
        )
        guide.add_step(
            "Update CLI calls",
            old_code="centris exec 'git status'",
            new_code="centris agent run --tool exec --args 'git status'",
        )
    """
    guide = MigrationGuide(
        feature=feature,
        deprecated_in=deprecated_in,
        removal_version=removal_version,
        summary=summary,
    )
    return _migration_registry.register(guide)


# =============================================================================
# CLI Command for Deprecation Info
# =============================================================================

@click.command("deprecations")
@click.option("--category", "-c", help="Filter by category (cli, api, sdk)")
@click.option("--format", "-f", "output_format", 
              type=click.Choice(["text", "json", "markdown"]),
              default="text", help="Output format")
@click.option("--include-past-sunset", is_flag=True, 
              help="Include features past sunset date")
def deprecations_command(category: Optional[str], output_format: str, include_past_sunset: bool):
    """
    List all deprecated features and migration guides.
    
    Shows current deprecations with their status, alternatives,
    and links to migration guides.
    """
    from centris_sdk.cli.theme import theme, symbols
    
    registry = get_deprecation_registry()
    
    # Filter deprecations
    if category:
        deprecations = registry.get_by_category(category)
    else:
        deprecations = registry.list_all()
    
    if not include_past_sunset:
        deprecations = [d for d in deprecations if d.level != DeprecationLevel.REMOVED or not d.is_past_sunset()]
    
    if not deprecations:
        click.echo(theme.muted("No deprecations found."))
        return
    
    if output_format == "json":
        import json
        data = []
        for d in deprecations:
            data.append({
                "name": d.name,
                "deprecated_in": d.deprecated_in,
                "removal_version": d.removal_version,
                "alternative": d.alternative,
                "reason": d.reason,
                "sunset_date": d.sunset_date,
                "level": d.level.value,
                "migration_guide": d.migration_guide,
            })
        click.echo(json.dumps(data, indent=2))
    
    elif output_format == "markdown":
        lines = ["# Deprecated Features", ""]
        for d in deprecations:
            status = "⚠️ " if d.level == DeprecationLevel.WARNING else "🚨 "
            lines.append(f"## {status}{d.name}")
            lines.append("")
            lines.append(f"- **Deprecated in:** v{d.deprecated_in}")
            if d.removal_version:
                lines.append(f"- **Removal:** v{d.removal_version}")
            if d.alternative:
                lines.append(f"- **Alternative:** `{d.alternative}`")
            if d.reason:
                lines.append(f"- **Reason:** {d.reason}")
            if d.sunset_date:
                past = " (PASSED)" if d.is_past_sunset() else ""
                lines.append(f"- **Sunset:** {d.sunset_date}{past}")
            if d.migration_guide:
                lines.append(f"- **Guide:** [{d.migration_guide}]({d.migration_guide})")
            lines.append("")
        click.echo("\n".join(lines))
    
    else:  # text
        click.echo(theme.header("Deprecated Features"))
        click.echo("")
        
        for d in deprecations:
            if d.level == DeprecationLevel.REMOVED:
                status_icon = theme.error(symbols.CROSS)
                status_text = "REMOVED"
            elif d.level == DeprecationLevel.DEPRECATED:
                status_icon = theme.warning(symbols.WARN)
                status_text = "DEPRECATED"
            else:
                status_icon = theme.muted(symbols.INFO)
                status_text = "WARNING"
            
            click.echo(f"{status_icon} {theme.accent(d.name)}")
            click.echo(f"    Status: {status_text} (since v{d.deprecated_in})")
            
            if d.alternative:
                click.echo(f"    Use: {theme.success(d.alternative)}")
            if d.reason:
                click.echo(f"    Reason: {d.reason}")
            if d.sunset_date:
                past_marker = theme.error(" [PAST]") if d.is_past_sunset() else ""
                click.echo(f"    Sunset: {d.sunset_date}{past_marker}")
            
            click.echo("")


__all__ = [
    # Core types
    "DeprecationLevel",
    "DeprecationInfo",
    "DeprecationRegistry",
    "MigrationStep",
    "MigrationGuide",
    "MigrationRegistry",
    # Decorators
    "deprecated",
    "deprecated_option",
    # Utilities
    "warn_deprecated",
    "emit_deprecation_notice",
    # Registry access
    "get_deprecation_registry",
    "get_migration_registry",
    "register_migration",
    # CLI command
    "deprecations_command",
]
