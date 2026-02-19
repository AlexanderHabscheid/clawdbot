"""
Centris SDK CLI - Skills Command

Install and manage AI skills for Cursor, Claude Code, and other AI IDEs.

Skills are SKILL.md files that teach AI agents how to use Centris tools.
They enable AI-assisted connector development without Centris paying API costs.

Usage:
    centris skills list                    # List available skills
    centris skills install connector-creator   # Install a skill
    centris skills info connector-creator      # Show skill details
"""

import click
import json
import shutil
from pathlib import Path
from typing import Any, Dict, List, Optional

from centris_sdk.cli.theme import theme
from centris_sdk.cli.progress import Spinner
from centris_sdk.cli.deps import CLIDeps, create_default_deps
from centris_sdk.cli.errors import CentrisCLIError


# =============================================================================
# Skill Registry
# =============================================================================

# Built-in skills shipped with Centris SDK
BUILTIN_SKILLS = {
    "connector-creator": {
        "name": "connector-creator",
        "description": "Create Centris browser connectors from URLs. Teaches AI how to use centris init, capture elements, and map fields.",
        "path": "skills/connector-creator",
        "tags": ["browser", "automation", "forms"],
    },
}


def get_centris_root() -> Path:
    """Get the Centris SDK installation root."""
    # Walk up from this file to find the centris-ai root
    current = Path(__file__).resolve()
    for parent in current.parents:
        if (parent / "skills").exists() and (parent / "sdk").exists():
            return parent
        if (parent / "CLAUDE.md").exists():
            return parent
    
    # Fallback: check common locations
    common_paths = [
        Path.home() / "centris-ai",
        Path.home() / "Downloads" / "centris-ai",
        Path("/opt/centris"),
    ]
    for p in common_paths:
        if p.exists() and (p / "skills").exists():
            return p
    
    raise CentrisCLIError(
        "Cannot find Centris installation",
        hint="Set CENTRIS_ROOT environment variable"
    )


def get_workspace_skills_dir() -> Path:
    """Get the workspace skills directory (where skills are installed)."""
    # Check for Cursor workspace
    cursor_dir = Path.cwd() / ".cursor" / "skills"
    if cursor_dir.parent.exists():
        return cursor_dir
    
    # Check for Claude Code workspace
    claude_dir = Path.cwd() / ".claude" / "skills"
    if claude_dir.parent.exists():
        return claude_dir
    
    # Default to .centris/skills in current directory
    return Path.cwd() / ".centris" / "skills"


def get_global_skills_dir() -> Path:
    """Get the global skills directory."""
    return Path.home() / ".centris" / "skills"


# =============================================================================
# CLI Commands
# =============================================================================

@click.group("skills")
def skills_group():
    """
    Install and manage AI skills for Cursor/Claude Code.
    
    Skills teach AI agents how to use Centris tools effectively.
    Install them to your workspace for AI-assisted development.
    
    Examples:
        centris skills list
        centris skills install connector-creator
        centris skills info connector-creator
    """
    pass


@skills_group.command("list")
@click.option("--installed", is_flag=True, help="Show only installed skills")
@click.pass_context
def list_command(ctx: click.Context, installed: bool) -> None:
    """
    List available skills.
    
    Shows both built-in and installed skills.
    """
    deps = ctx.obj.get("deps") if ctx.obj else create_default_deps()
    console = deps.console
    
    console.echo(f"\n{theme.heading('Available Skills:')}\n")
    
    # Show built-in skills
    for skill_id, skill_info in BUILTIN_SKILLS.items():
        status = ""
        
        # Check if installed
        workspace_dir = get_workspace_skills_dir()
        global_dir = get_global_skills_dir()
        
        if (workspace_dir / skill_id).exists():
            status = theme.success(" [installed: workspace]")
        elif (global_dir / skill_id).exists():
            status = theme.success(" [installed: global]")
        
        if installed and not status:
            continue
        
        console.echo(f"  {theme.accent(skill_id)}{status}")
        console.echo(f"    {theme.muted(skill_info['description'][:80])}...")
        console.echo(f"    Tags: {', '.join(skill_info.get('tags', []))}")
        console.echo("")
    
    console.echo(f"{theme.muted('Install with:')} centris skills install <skill-name>")


@skills_group.command("install")
@click.argument("skill_name")
@click.option("--global", "global_install", is_flag=True, help="Install globally (~/.centris/skills/)")
@click.option("--force", is_flag=True, help="Overwrite existing installation")
@click.pass_context
def install_command(
    ctx: click.Context,
    skill_name: str,
    global_install: bool,
    force: bool,
) -> None:
    """
    Install a skill to your workspace.
    
    Skills are installed to .cursor/skills/ or .centris/skills/ in your project.
    Use --global to install to ~/.centris/skills/ for all projects.
    
    Examples:
        centris skills install connector-creator
        centris skills install connector-creator --global
    """
    deps = ctx.obj.get("deps") if ctx.obj else create_default_deps()
    console = deps.console
    
    # Find skill
    if skill_name not in BUILTIN_SKILLS:
        console.echo(f"{theme.error('!')} Unknown skill: {skill_name}")
        console.echo(f"\n{theme.muted('Available skills:')}")
        for name in BUILTIN_SKILLS:
            console.echo(f"  - {name}")
        return
    
    skill_info = BUILTIN_SKILLS[skill_name]
    
    # Determine install location
    if global_install:
        install_dir = get_global_skills_dir() / skill_name
        install_type = "global"
    else:
        install_dir = get_workspace_skills_dir() / skill_name
        install_type = "workspace"
    
    # Check if already installed
    if install_dir.exists() and not force:
        console.echo(f"{theme.warn('!')} Skill already installed at {install_dir}")
        console.echo(f"    Use --force to overwrite")
        return
    
    with Spinner(f"Installing {skill_name}...") as spin:
        try:
            # Find source skill
            centris_root = get_centris_root()
            source_dir = centris_root / skill_info["path"]
            
            if not source_dir.exists():
                spin.fail(f"Skill source not found: {source_dir}")
                return
            
            # Create install directory
            install_dir.parent.mkdir(parents=True, exist_ok=True)
            
            # Remove existing if force
            if install_dir.exists() and force:
                shutil.rmtree(install_dir)
            
            # Copy skill
            shutil.copytree(source_dir, install_dir)
            
            spin.success(f"Installed {skill_name} to {install_type}")
        
        except Exception as e:
            spin.fail(str(e))
            raise CentrisCLIError(f"Installation failed: {e}")
    
    # Show next steps
    console.echo(f"\n{theme.heading('Next steps:')}")
    console.echo(f"  1. The skill is now available to your AI IDE")
    console.echo(f"  2. In Cursor/Claude Code, try: \"Create a connector for [URL]\"")
    console.echo(f"  3. The AI will read the SKILL.md and follow the workflow")
    console.echo(f"\n{theme.muted('Skill location:')} {install_dir}")
    
    # Show SKILL.md preview
    skill_md = install_dir / "SKILL.md"
    if skill_md.exists():
        console.echo(f"\n{theme.heading('SKILL.md Preview:')}")
        content = skill_md.read_text()
        # Show first 10 lines
        lines = content.split('\n')[:15]
        for line in lines:
            console.echo(f"  {theme.muted(line[:80])}")
        if len(content.split('\n')) > 15:
            console.echo(f"  {theme.muted('...')}")


@skills_group.command("info")
@click.argument("skill_name")
@click.pass_context
def info_command(ctx: click.Context, skill_name: str) -> None:
    """
    Show detailed information about a skill.
    """
    deps = ctx.obj.get("deps") if ctx.obj else create_default_deps()
    console = deps.console
    
    if skill_name not in BUILTIN_SKILLS:
        console.echo(f"{theme.error('!')} Unknown skill: {skill_name}")
        return
    
    skill_info = BUILTIN_SKILLS[skill_name]
    
    console.echo(f"\n{theme.heading(skill_name)}")
    console.echo(f"\n{skill_info['description']}")
    console.echo(f"\n{theme.accent('Tags:')} {', '.join(skill_info.get('tags', []))}")
    
    # Check installation status
    workspace_dir = get_workspace_skills_dir() / skill_name
    global_dir = get_global_skills_dir() / skill_name
    
    if workspace_dir.exists():
        console.echo(f"\n{theme.success('✓')} Installed: {workspace_dir}")
    elif global_dir.exists():
        console.echo(f"\n{theme.success('✓')} Installed: {global_dir}")
    else:
        console.echo(f"\n{theme.warn('○')} Not installed")
        console.echo(f"  Run: centris skills install {skill_name}")
    
    # Show SKILL.md content
    try:
        centris_root = get_centris_root()
        source_dir = centris_root / skill_info["path"]
        skill_md = source_dir / "SKILL.md"
        
        if skill_md.exists():
            console.echo(f"\n{theme.heading('SKILL.md Contents:')}")
            console.echo(f"\n{skill_md.read_text()}")
    except Exception:
        pass


@skills_group.command("uninstall")
@click.argument("skill_name")
@click.option("--global", "global_install", is_flag=True, help="Uninstall from global location")
@click.pass_context
def uninstall_command(
    ctx: click.Context,
    skill_name: str,
    global_install: bool,
) -> None:
    """
    Uninstall a skill from your workspace.
    """
    deps = ctx.obj.get("deps") if ctx.obj else create_default_deps()
    console = deps.console
    
    if global_install:
        install_dir = get_global_skills_dir() / skill_name
    else:
        install_dir = get_workspace_skills_dir() / skill_name
    
    if not install_dir.exists():
        console.echo(f"{theme.warn('!')} Skill not installed: {skill_name}")
        return
    
    with Spinner(f"Uninstalling {skill_name}...") as spin:
        try:
            shutil.rmtree(install_dir)
            spin.success(f"Uninstalled {skill_name}")
        except Exception as e:
            spin.fail(str(e))


@skills_group.command("path")
@click.option("--global", "global_path", is_flag=True, help="Show global skills path")
@click.pass_context
def path_command(ctx: click.Context, global_path: bool) -> None:
    """
    Show where skills are installed.
    """
    deps = ctx.obj.get("deps") if ctx.obj else create_default_deps()
    console = deps.console
    
    if global_path:
        path = get_global_skills_dir()
        console.echo(f"Global skills: {path}")
    else:
        path = get_workspace_skills_dir()
        console.echo(f"Workspace skills: {path}")
    
    if path.exists():
        skills = list(path.iterdir())
        if skills:
            console.echo(f"\nInstalled skills:")
            for skill in skills:
                if skill.is_dir():
                    console.echo(f"  - {skill.name}")


__all__ = ["skills_group"]
