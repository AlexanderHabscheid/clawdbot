"""
Centris CLI Introspect Command

Self-discovery command for AI agents (Clawdbot pattern).
Allows agents to discover their own capabilities by running:
    centris introspect

This is the CLI counterpart to the introspect tool in the backend.
"""

import click
import json
import sys
from pathlib import Path
from typing import Optional

from .deps import CLIDeps, create_default_deps
from .theme import theme, styled_success, styled_error


@click.command("introspect")
@click.option(
    "--scope",
    type=click.Choice(["all", "tools", "skills", "connectors", "config"]),
    default="all",
    help="What to introspect: all, tools, skills, connectors, or config"
)
@click.option(
    "--json", "json_output",
    is_flag=True,
    help="Output as JSON (machine-readable)"
)
@click.option(
    "--compact",
    is_flag=True,
    help="Compact output (just names/summaries)"
)
@click.pass_context
def introspect_command(
    ctx: click.Context,
    scope: str,
    json_output: bool,
    compact: bool,
) -> None:
    """
    Discover Centris capabilities - tools, skills, connectors.
    
    This command enables self-learning by allowing agents to discover
    what they can do at runtime.
    
    Examples:
        centris introspect                    # Full discovery
        centris introspect --scope tools      # Just tools
        centris introspect --scope skills     # Just skills
        centris introspect --json             # Machine-readable
        centris introspect --compact          # Brief summaries
    
    Output includes:
        - Registered tools with descriptions
        - Available skills with paths
        - Installed connectors
        - Configuration settings
    """
    deps = ctx.obj.get("deps") if ctx.obj else create_default_deps()
    
    result = {}
    
    # ═══════════════════════════════════════════════════════════════════════════
    # TOOLS DISCOVERY
    # ═══════════════════════════════════════════════════════════════════════════
    
    if scope in ("all", "tools"):
        # SDK introspection should never depend on internal backend imports.
        # Report stable, SDK-level execution surfaces instead.
        known_tools = [
            "navigate_browser", "get_interactive_snapshot", "click_node", "type_text",
            "press_key", "global_type", "get_page_content", "scroll_page",
            "read_file", "write_file", "list_directory", "execute_terminal_command",
            "memory_search", "memory_get", "memory_save",
        ]
        result["tools"] = {
            "registered_count": 0,
            "source": "centris-sdk",
            "hint": "Runtime tool registries are discovered from installed connectors.",
            "known_tools": known_tools if compact else known_tools,
        }
    
    # ═══════════════════════════════════════════════════════════════════════════
    # SKILLS DISCOVERY
    # ═══════════════════════════════════════════════════════════════════════════
    
    if scope in ("all", "skills"):
        skills_info = []
        
        # Check multiple skill directories
        skill_dirs = [
            Path.home() / ".centris" / "skills",
            Path(__file__).parent.parent.parent.parent / "backend" / "skills",
        ]
        
        for skill_dir in skill_dirs:
            if skill_dir.exists():
                for item in skill_dir.iterdir():
                    if item.is_dir():
                        skill_file = item / "SKILL.md"
                        if skill_file.exists():
                            # Parse frontmatter for name/description
                            content = skill_file.read_text(encoding="utf-8")
                            name = item.name
                            description = ""
                            
                            # Simple frontmatter parsing
                            if content.startswith("---"):
                                end_idx = content.find("---", 3)
                                if end_idx > 0:
                                    frontmatter = content[3:end_idx]
                                    for line in frontmatter.split("\n"):
                                        if line.startswith("name:"):
                                            name = line.split(":", 1)[1].strip().strip('"\'')
                                        elif line.startswith("description:"):
                                            description = line.split(":", 1)[1].strip().strip('"\'')
                            
                            skills_info.append({
                                "name": name,
                                "description": description[:100] if compact else description,
                                "path": str(skill_file),
                            })
        
        result["skills"] = {
            "count": len(skills_info),
            "skills": skills_info,
            "directories": [str(d) for d in skill_dirs if d.exists()],
        }
    
    # ═══════════════════════════════════════════════════════════════════════════
    # CONNECTORS DISCOVERY
    # ═══════════════════════════════════════════════════════════════════════════
    
    if scope in ("all", "connectors"):
        connectors_info = []
        
        # Check connector directories
        connector_dirs = [
            Path.home() / ".centris" / "connectors",
        ]
        
        for connector_dir in connector_dirs:
            if connector_dir.exists():
                for item in connector_dir.iterdir():
                    if item.is_dir():
                        connector_json = item / "connector.json"
                        if connector_json.exists():
                            try:
                                data = json.loads(connector_json.read_text())
                                connectors_info.append({
                                    "name": data.get("name", item.name),
                                    "version": data.get("version", "unknown"),
                                    "description": data.get("description", "")[:100] if compact else data.get("description", ""),
                                    "capabilities": data.get("capabilities", []),
                                    "path": str(item),
                                })
                            except json.JSONDecodeError:
                                pass
        
        result["connectors"] = {
            "count": len(connectors_info),
            "connectors": connectors_info,
            "directories": [str(d) for d in connector_dirs if d.exists()],
        }
    
    # ═══════════════════════════════════════════════════════════════════════════
    # CONFIG DISCOVERY
    # ═══════════════════════════════════════════════════════════════════════════
    
    if scope in ("all", "config"):
        import os
        
        config_info = {
            "centris_home": str(Path.home() / ".centris"),
            "sandbox_mode": os.environ.get("CENTRIS_SANDBOX_MODE", "SAFE"),
            "debug": os.environ.get("CENTRIS_DEBUG", "false").lower() == "true",
            "backend_url": os.environ.get("CENTRIS_BACKEND_URL", "http://localhost:5050"),
        }
        
        # Check if config file exists
        config_file = Path.home() / ".centris" / "config.json"
        if config_file.exists():
            try:
                config_data = json.loads(config_file.read_text())
                config_info["config_file"] = str(config_file)
                config_info["config_version"] = config_data.get("version", "unknown")
            except json.JSONDecodeError:
                pass
        
        result["config"] = config_info
    
    # ═══════════════════════════════════════════════════════════════════════════
    # OUTPUT
    # ═══════════════════════════════════════════════════════════════════════════
    
    if json_output:
        click.echo(json.dumps(result, indent=2))
    else:
        _print_formatted(result, compact)


def _print_formatted(result: dict, compact: bool) -> None:
    """Print formatted introspection results."""
    
    if "tools" in result:
        click.echo(f"\n{theme.info('═')} {theme.bold('Tools')}")
        tools_data = result["tools"]
        
        if "error" in tools_data:
            click.echo(f"  {theme.warn('⚠')} {tools_data['error']}")
            click.echo(f"  {theme.dim(tools_data.get('hint', ''))}")
            if "known_tools" in tools_data:
                click.echo(f"\n  Known tools: {', '.join(tools_data['known_tools'][:10])}...")
        else:
            click.echo(f"  Registered: {tools_data.get('registered_count', 0)}")
            for tool in tools_data.get("tools", [])[:15 if compact else 50]:
                name = tool["name"]
                desc = tool["description"]
                if compact:
                    click.echo(f"  • {theme.accent(name)}: {theme.dim(desc)}")
                else:
                    click.echo(f"\n  {theme.accent(name)}")
                    click.echo(f"    {desc}")
                    if tool.get("parameters"):
                        click.echo(f"    Parameters: {', '.join(tool['parameters'])}")
    
    if "skills" in result:
        click.echo(f"\n{theme.info('═')} {theme.bold('Skills')}")
        skills_data = result["skills"]
        click.echo(f"  Found: {skills_data.get('count', 0)}")
        
        for skill in skills_data.get("skills", []):
            click.echo(f"  • {theme.accent(skill['name'])}: {theme.dim(skill.get('description', ''))}")
            if not compact:
                click.echo(f"    Path: {skill['path']}")
    
    if "connectors" in result:
        click.echo(f"\n{theme.info('═')} {theme.bold('Connectors')}")
        connectors_data = result["connectors"]
        click.echo(f"  Installed: {connectors_data.get('count', 0)}")
        
        for connector in connectors_data.get("connectors", []):
            version = connector.get("version", "")
            click.echo(f"  • {theme.accent(connector['name'])} {theme.dim(f'v{version}')}")
            if not compact and connector.get("description"):
                click.echo(f"    {connector['description']}")
            if connector.get("capabilities"):
                click.echo(f"    Capabilities: {', '.join(connector['capabilities'][:5])}")
    
    if "config" in result:
        click.echo(f"\n{theme.info('═')} {theme.bold('Configuration')}")
        config_data = result["config"]
        
        for key, value in config_data.items():
            click.echo(f"  {key}: {theme.dim(str(value))}")
    
    click.echo("")
