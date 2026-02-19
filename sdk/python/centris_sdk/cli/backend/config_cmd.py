"""
Centris CLI - Config Command

Show and manage Centris configuration.
"""

import click
import sys
import os
import json
from pathlib import Path
from typing import Optional

from centris_sdk.cli.theme import theme, symbols, styled_success, styled_error


def _find_backend_root() -> Optional[Path]:
    """Find the backend directory."""
    candidates = [
        Path.cwd() / "backend",
        Path.cwd().parent / "backend",
        Path(__file__).resolve().parent.parent.parent.parent.parent.parent / "backend",
    ]
    
    for candidate in candidates:
        if candidate.exists() and (candidate / "main.py").exists():
            return candidate
    
    return None


def _setup_python_path(backend_root: Path) -> None:
    """Add backend to Python path."""
    project_root = backend_root.parent
    if str(project_root) not in sys.path:
        sys.path.insert(0, str(project_root))


def _load_env_files(backend_root: Path) -> dict:
    """Load and return all environment variables from .env files."""
    env_vars = {}
    
    try:
        from dotenv import dotenv_values
        
        # Load root .env
        root_env = backend_root.parent / ".env"
        if root_env.exists():
            env_vars.update(dotenv_values(root_env))
        
        # Load backend .env (overrides root)
        backend_env = backend_root / ".env"
        if backend_env.exists():
            env_vars.update(dotenv_values(backend_env))
    except ImportError:
        pass
    
    return env_vars


@click.group("config")
def config_group():
    """
    Show and manage Centris configuration.
    
    The config command provides subcommands to view and validate
    your Centris configuration.
    """
    pass


@config_group.command("show")
@click.argument("section", required=False)
@click.option("--json", "as_json", is_flag=True, help="Output as JSON")
@click.pass_context
def config_show(ctx: click.Context, section: Optional[str], as_json: bool) -> None:
    """
    Show current configuration.
    
    Displays the current Centris configuration from settings and environment.
    Optionally filter by section.
    
    \b
    Sections:
      llm        - LLM provider settings
      audio      - Audio/transcription settings
      server     - Server host/port settings
      connectors - Connector system settings
    
    Examples:
    
        centris config show            Show all config
        
        centris config show llm        Show LLM settings
        
        centris config show --json     JSON output
    """
    backend_root = _find_backend_root()
    if not backend_root:
        if as_json:
            click.echo(json.dumps({"error": "Backend not found"}))
        else:
            click.echo(styled_error("Could not find backend directory"))
        sys.exit(1)
    
    _setup_python_path(backend_root)
    
    # Load .env files
    try:
        from dotenv import load_dotenv
        env_file = backend_root.parent / ".env"
        if env_file.exists():
            load_dotenv(env_file)
        backend_env = backend_root / ".env"
        if backend_env.exists():
            load_dotenv(backend_env, override=True)
    except ImportError:
        pass
    
    # Import settings
    try:
        from backend.config.settings import get_settings
        settings = get_settings()
    except ImportError as e:
        if as_json:
            click.echo(json.dumps({"error": f"Cannot import settings: {e}"}))
        else:
            click.echo(styled_error(f"Cannot import settings: {e}"))
        sys.exit(1)
    
    # Build config dict
    config = {
        "llm": {
            "provider": settings.llm_provider,
            "planning_provider": settings.planning_provider,
            "planning_model": settings.planning_model,
            "deepseek_model": settings.deepseek_model,
            "openai_model": settings.openai_model,
            "anthropic_model": settings.anthropic_model,
            "gemini_model": settings.gemini_model,
            "use_gemini_for_simple_tasks": settings.use_gemini_for_simple_tasks,
            "api_keys": {
                "deepseek": bool(settings.deepseek_api_key),
                "openai": bool(settings.openai_api_key),
                "anthropic": bool(settings.anthropic_api_key),
                "gemini": bool(settings.gemini_api_key),
            },
        },
        "audio": {
            "transcription_provider": settings.transcription_provider,
            "tts_provider": settings.tts_provider,
            "deepgram_model": settings.deepgram_model,
            "deepgram_tts_model": settings.deepgram_tts_model,
            "deepgram_api_key_set": bool(settings.deepgram_api_key),
            "transcription_language": settings.transcription_language,
            "dictation_use_llm": settings.dictation_use_llm,
            "ollama_url": settings.ollama_url,
            "ollama_model": settings.ollama_model,
        },
        "server": {
            "host": settings.server_host,
            "port": settings.server_port,
            "debug": settings.debug,
        },
        "agent": {
            "max_trajectory_length": settings.max_trajectory_length,
            "enable_reflection": settings.enable_reflection,
            "auto_launch_browser": settings.auto_launch_browser,
        },
        "connectors": settings.get_connector_config(),
    }
    
    # Filter by section if specified
    if section:
        section = section.lower()
        if section not in config:
            available = ", ".join(config.keys())
            if as_json:
                click.echo(json.dumps({"error": f"Unknown section: {section}", "available": list(config.keys())}))
            else:
                click.echo(styled_error(f"Unknown section: {section}"))
                click.echo(f"  {theme.muted('Available:')} {available}")
            sys.exit(1)
        config = {section: config[section]}
    
    # JSON output
    if as_json:
        click.echo(json.dumps(config, indent=2))
        return
    
    # Pretty output
    click.echo(f"{theme.heading(f'{symbols.LOGO} Centris Configuration')}")
    click.echo()
    
    def render_dict(d: dict, indent: int = 0) -> None:
        """Recursively render a dictionary."""
        prefix = "  " * indent
        for key, value in d.items():
            if isinstance(value, dict):
                click.echo(f"{prefix}{theme.accent(key)}:")
                render_dict(value, indent + 1)
            elif isinstance(value, bool):
                color = theme.success if value else theme.error
                click.echo(f"{prefix}{theme.muted(key + ':')} {color(str(value).lower())}")
            elif value is None:
                click.echo(f"{prefix}{theme.muted(key + ':')} {theme.muted('(not set)')}")
            elif isinstance(value, list):
                if value:
                    click.echo(f"{prefix}{theme.muted(key + ':')} {', '.join(str(v) for v in value)}")
                else:
                    click.echo(f"{prefix}{theme.muted(key + ':')} {theme.muted('(empty)')}")
            else:
                click.echo(f"{prefix}{theme.muted(key + ':')} {theme.info(str(value))}")
    
    for section_name, section_config in config.items():
        click.echo(theme.heading(section_name.upper()))
        render_dict(section_config, indent=1)
        click.echo()


@config_group.command("env")
@click.option("--all", "show_all", is_flag=True, help="Show all env vars, not just Centris-related")
@click.option("--json", "as_json", is_flag=True, help="Output as JSON")
@click.pass_context
def config_env(ctx: click.Context, show_all: bool, as_json: bool) -> None:
    """
    Show environment variables being used.
    
    Displays environment variables that affect Centris operation.
    By default, only shows Centris-related variables.
    
    Examples:
    
        centris config env             Show Centris env vars
        
        centris config env --all       Show all env vars
    """
    backend_root = _find_backend_root()
    if backend_root:
        _setup_python_path(backend_root)
    
    # Load .env files
    file_env = {}
    if backend_root:
        file_env = _load_env_files(backend_root)
    
    # Centris-related prefixes
    centris_prefixes = [
        "DEEPSEEK", "DEEPGRAM", "OPENAI", "ANTHROPIC", "GEMINI",
        "TRANSCRIPTION", "TTS", "AUDIO", "LLM", "PLANNING",
        "SERVER", "PORT", "HOST", "DEBUG",
        "CONNECTORS", "CLOUDFLARE", "CF_",
        "OLLAMA", "USER_LANGUAGE", "DICTATION",
        "MAX_TRAJECTORY", "ENABLE_REFLECTION", "AUTO_LAUNCH",
    ]
    
    def is_centris_var(name: str) -> bool:
        return any(name.startswith(prefix) for prefix in centris_prefixes)
    
    # Collect env vars
    env_vars = {}
    
    if show_all:
        env_vars = dict(os.environ)
    else:
        # Only Centris-related
        for key, value in os.environ.items():
            if is_centris_var(key):
                env_vars[key] = value
        
        # Also include vars from .env files
        for key, value in file_env.items():
            if is_centris_var(key) and key not in env_vars:
                env_vars[key] = value
    
    # Mask sensitive values
    def mask_value(key: str, value: str) -> str:
        sensitive_keywords = ["KEY", "SECRET", "TOKEN", "PASSWORD"]
        if any(kw in key.upper() for kw in sensitive_keywords):
            if len(value) > 8:
                return value[:4] + "***" + value[-4:]
            return "***"
        return value
    
    # JSON output
    if as_json:
        masked = {k: mask_value(k, v) for k, v in sorted(env_vars.items())}
        click.echo(json.dumps(masked, indent=2))
        return
    
    # Pretty output
    click.echo(f"{theme.heading('Environment Variables')}")
    click.echo()
    
    if not env_vars:
        click.echo(f"  {theme.muted('No Centris-related environment variables found.')}")
        return
    
    for key in sorted(env_vars.keys()):
        value = env_vars[key]
        masked = mask_value(key, value)
        
        # Color based on whether it's set
        if value:
            click.echo(f"  {theme.accent(key)}={theme.info(masked)}")
        else:
            click.echo(f"  {theme.muted(key)}={theme.muted('(empty)')}")
    
    click.echo()
    click.echo(f"  {theme.muted(f'Total: {len(env_vars)} variables')}")


@config_group.command("validate")
@click.option("--json", "as_json", is_flag=True, help="Output as JSON")
@click.pass_context
def config_validate(ctx: click.Context, as_json: bool) -> None:
    """
    Validate current configuration.
    
    Checks that the configuration is valid and all required
    settings are present for the configured providers.
    
    Examples:
    
        centris config validate        Validate config
        
        centris config validate --json JSON output
    """
    backend_root = _find_backend_root()
    if not backend_root:
        if as_json:
            click.echo(json.dumps({"valid": False, "error": "Backend not found"}))
        else:
            click.echo(styled_error("Could not find backend directory"))
        sys.exit(1)
    
    _setup_python_path(backend_root)
    
    # Load .env files
    try:
        from dotenv import load_dotenv
        env_file = backend_root.parent / ".env"
        if env_file.exists():
            load_dotenv(env_file)
        backend_env = backend_root / ".env"
        if backend_env.exists():
            load_dotenv(backend_env, override=True)
    except ImportError:
        pass
    
    issues = []
    warnings = []
    
    try:
        from backend.config.settings import get_settings
        settings = get_settings()
        
        # Check LLM provider
        if settings.llm_provider == "deepseek" and not settings.deepseek_api_key:
            issues.append("LLM provider is 'deepseek' but DEEPSEEK_API_KEY is not set")
        elif settings.llm_provider == "openai" and not settings.openai_api_key:
            issues.append("LLM provider is 'openai' but OPENAI_API_KEY is not set")
        elif settings.llm_provider == "anthropic" and not settings.anthropic_api_key:
            issues.append("LLM provider is 'anthropic' but ANTHROPIC_API_KEY is not set")
        elif settings.llm_provider == "gemini" and not settings.gemini_api_key:
            issues.append("LLM provider is 'gemini' but GEMINI_API_KEY is not set")
        
        # Check transcription provider
        if settings.transcription_provider == "deepgram" and not settings.deepgram_api_key:
            issues.append("Transcription provider is 'deepgram' but DEEPGRAM_API_KEY is not set")
        
        # Warnings for optional features
        if settings.use_gemini_for_simple_tasks and not settings.gemini_api_key:
            warnings.append("use_gemini_for_simple_tasks is enabled but GEMINI_API_KEY is not set")
        
        if settings.dictation_use_llm:
            warnings.append("dictation_use_llm is enabled - may increase latency")
        
    except Exception as e:
        issues.append(f"Failed to load settings: {e}")
    
    # JSON output
    if as_json:
        result = {
            "valid": len(issues) == 0,
            "issues": issues,
            "warnings": warnings,
        }
        click.echo(json.dumps(result, indent=2))
        sys.exit(0 if len(issues) == 0 else 1)
    
    # Pretty output
    click.echo(f"{theme.heading('Configuration Validation')}")
    click.echo()
    
    if issues:
        click.echo(theme.error("Issues:"))
        for issue in issues:
            click.echo(f"  {theme.error(symbols.CROSS)} {issue}")
        click.echo()
    
    if warnings:
        click.echo(theme.warn("Warnings:"))
        for warning in warnings:
            click.echo(f"  {theme.warn('!')} {warning}")
        click.echo()
    
    if not issues and not warnings:
        click.echo(styled_success("Configuration is valid!"))
    elif not issues:
        click.echo(f"{theme.success(symbols.CHECK)} Configuration is valid (with warnings)")
    else:
        click.echo(styled_error("Configuration has issues that need to be fixed"))
        sys.exit(1)


@config_group.command("migrate")
@click.option("--dry-run", is_flag=True, help="Show what would be migrated without making changes")
@click.option("--force", is_flag=True, help="Force migration even if already at latest version")
@click.option("--no-backup", is_flag=True, help="Skip creating backup before migration")
@click.option("--json", "as_json", is_flag=True, help="Output as JSON")
@click.pass_context
def config_migrate(ctx: click.Context, dry_run: bool, force: bool, no_backup: bool, as_json: bool) -> None:
    """
    Migrate configuration to the latest schema version.
    
    This command checks if your configuration needs to be migrated
    to a newer schema version and performs the migration if needed.
    
    A backup is automatically created before any migration.
    
    Examples:
    
        centris config migrate              Migrate to latest version
        
        centris config migrate --dry-run   Preview changes without migrating
        
        centris config migrate --force      Force re-migration
    """
    backend_root = _find_backend_root()
    if not backend_root:
        if as_json:
            click.echo(json.dumps({"error": "Backend not found"}))
        else:
            click.echo(styled_error("Could not find backend directory"))
        sys.exit(1)
    
    _setup_python_path(backend_root)
    
    # Load .env files
    try:
        from dotenv import load_dotenv
        env_file = backend_root.parent / ".env"
        if env_file.exists():
            load_dotenv(env_file)
        backend_env = backend_root / ".env"
        if backend_env.exists():
            load_dotenv(backend_env, override=True)
    except ImportError:
        pass
    
    try:
        from backend.config import CONFIG_SCHEMA_VERSION
        from backend.config.migrations import (
            CURRENT_VERSION,
            migrate_config,
            needs_migration,
            get_config_version,
            create_backup,
            backup_env_files,
            load_config_state,
            save_config_state,
            record_migration,
            env_to_config_dict,
            config_dict_to_env,
        )
    except ImportError as e:
        if as_json:
            click.echo(json.dumps({"error": f"Cannot import migration system: {e}"}))
        else:
            click.echo(styled_error(f"Cannot import migration system: {e}"))
        sys.exit(1)
    
    # Load current config state
    state = load_config_state()
    current_version = state.get("config_version", "1.0.0")
    
    # Check if migration is needed
    if not force and current_version == CURRENT_VERSION:
        if as_json:
            click.echo(json.dumps({
                "migrated": False,
                "reason": "already_at_latest",
                "current_version": current_version,
                "target_version": CURRENT_VERSION,
            }))
        else:
            click.echo(f"{theme.success(symbols.CHECK)} Configuration is already at version {current_version}")
        return
    
    # Load env vars as config dict for migration
    env_vars = _load_env_files(backend_root)
    config = env_to_config_dict(env_vars)
    config["config_version"] = current_version
    
    # Perform migration
    result = migrate_config(config, CURRENT_VERSION)
    
    if not result.success:
        if as_json:
            click.echo(json.dumps({
                "migrated": False,
                "errors": result.errors,
                "changes": result.changes,
            }))
        else:
            click.echo(styled_error("Migration failed:"))
            for error in result.errors:
                click.echo(f"  {theme.error(symbols.CROSS)} {error}")
        sys.exit(1)
    
    # Dry run - just show what would change
    if dry_run:
        if as_json:
            click.echo(json.dumps({
                "dry_run": True,
                "current_version": current_version,
                "target_version": CURRENT_VERSION,
                "changes": result.changes,
            }))
        else:
            click.echo(f"{theme.heading('Migration Preview')} (dry run)")
            click.echo()
            click.echo(f"  {theme.muted('From:')} {current_version}")
            click.echo(f"  {theme.muted('To:')} {CURRENT_VERSION}")
            click.echo()
            if result.changes:
                click.echo(theme.accent("Changes that would be made:"))
                for change in result.changes:
                    click.echo(f"  {theme.info('→')} {change}")
            else:
                click.echo(theme.muted("  No changes needed"))
        return
    
    # Create backup before migration
    if not no_backup:
        env_files = backup_env_files(backend_root.parent)
        backup_path = create_backup(
            config,
            env_files=env_files,
            reason="migration",
        )
        if backup_path:
            if not as_json:
                click.echo(f"{theme.success(symbols.CHECK)} Created backup at {backup_path}")
        else:
            if not as_json:
                click.echo(f"{theme.warn('!')} Could not create backup, proceeding anyway")
    
    # Update state with new version
    state["config_version"] = CURRENT_VERSION
    save_config_state(state)
    
    # Record migration in history
    record_migration(
        from_version=current_version,
        to_version=CURRENT_VERSION,
        changes=result.changes,
        success=True,
    )
    
    # Output results
    if as_json:
        click.echo(json.dumps({
            "migrated": True,
            "from_version": current_version,
            "to_version": CURRENT_VERSION,
            "changes": result.changes,
        }))
    else:
        click.echo()
        click.echo(f"{theme.success(symbols.CHECK)} Configuration migrated successfully!")
        click.echo()
        click.echo(f"  {theme.muted('From:')} {current_version}")
        click.echo(f"  {theme.muted('To:')} {CURRENT_VERSION}")
        
        if result.changes:
            click.echo()
            click.echo(theme.accent("Changes made:"))
            for change in result.changes:
                click.echo(f"  {theme.info('→')} {change}")


@config_group.command("version")
@click.option("--json", "as_json", is_flag=True, help="Output as JSON")
@click.pass_context
def config_version(ctx: click.Context, as_json: bool) -> None:
    """
    Show configuration schema version information.
    
    Displays the current config version and whether migration is needed.
    
    Examples:
    
        centris config version             Show version info
        
        centris config version --json      JSON output
    """
    backend_root = _find_backend_root()
    if not backend_root:
        if as_json:
            click.echo(json.dumps({"error": "Backend not found"}))
        else:
            click.echo(styled_error("Could not find backend directory"))
        sys.exit(1)
    
    _setup_python_path(backend_root)
    
    try:
        from backend.config import CONFIG_SCHEMA_VERSION
        from backend.config.migrations import (
            CURRENT_VERSION,
            load_config_state,
            compare_versions,
        )
    except ImportError as e:
        if as_json:
            click.echo(json.dumps({"error": f"Cannot import config system: {e}"}))
        else:
            click.echo(styled_error(f"Cannot import config system: {e}"))
        sys.exit(1)
    
    state = load_config_state()
    current_version = state.get("config_version", "1.0.0")
    needs_update = compare_versions(current_version, CURRENT_VERSION) < 0
    
    if as_json:
        click.echo(json.dumps({
            "current_version": current_version,
            "latest_version": CURRENT_VERSION,
            "needs_migration": needs_update,
        }))
    else:
        click.echo(f"{theme.heading('Configuration Version')}")
        click.echo()
        click.echo(f"  {theme.muted('Current:')} {theme.info(current_version)}")
        click.echo(f"  {theme.muted('Latest:')} {theme.info(CURRENT_VERSION)}")
        click.echo()
        
        if needs_update:
            click.echo(f"  {theme.warn('!')} Migration available. Run: {theme.accent('centris config migrate')}")
        else:
            click.echo(f"  {theme.success(symbols.CHECK)} Configuration is up to date")


@config_group.command("history")
@click.option("--json", "as_json", is_flag=True, help="Output as JSON")
@click.option("--limit", default=10, help="Number of entries to show")
@click.pass_context
def config_history(ctx: click.Context, as_json: bool, limit: int) -> None:
    """
    Show configuration migration history.
    
    Displays past migrations that have been applied to this configuration.
    
    Examples:
    
        centris config history             Show last 10 migrations
        
        centris config history --limit 5   Show last 5 migrations
    """
    backend_root = _find_backend_root()
    if not backend_root:
        if as_json:
            click.echo(json.dumps({"error": "Backend not found"}))
        else:
            click.echo(styled_error("Could not find backend directory"))
        sys.exit(1)
    
    _setup_python_path(backend_root)
    
    try:
        from backend.config.migrations import get_migration_history
    except ImportError as e:
        if as_json:
            click.echo(json.dumps({"error": f"Cannot import migration system: {e}"}))
        else:
            click.echo(styled_error(f"Cannot import migration system: {e}"))
        sys.exit(1)
    
    history = get_migration_history()[:limit]
    
    if as_json:
        click.echo(json.dumps({"history": history}))
    else:
        click.echo(f"{theme.heading('Migration History')}")
        click.echo()
        
        if not history:
            click.echo(f"  {theme.muted('No migrations recorded yet')}")
            return
        
        for entry in history:
            timestamp = entry.get("timestamp", "unknown")[:19].replace("T", " ")
            from_ver = entry.get("from_version", "?")
            to_ver = entry.get("to_version", "?")
            success = entry.get("success", False)
            
            status_icon = theme.success(symbols.CHECK) if success else theme.error(symbols.CROSS)
            click.echo(f"  {status_icon} {theme.muted(timestamp)}")
            click.echo(f"    {from_ver} → {to_ver}")
            
            changes = entry.get("changes", [])
            if changes:
                for change in changes[:3]:  # Show first 3 changes
                    click.echo(f"      {theme.info('→')} {change}")
                if len(changes) > 3:
                    click.echo(f"      {theme.muted(f'... and {len(changes) - 3} more')}")
            click.echo()
