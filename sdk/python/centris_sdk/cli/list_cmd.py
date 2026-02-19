"""
Centris SDK CLI - List Command

List available connectors from the registry and installed connectors.
"""

import click
import json
import sys
import os
import asyncio
from pathlib import Path
from typing import Optional, List, Dict, Any

REGISTRY_URL = os.environ.get("CENTRIS_REGISTRY_URL", "https://registry.centris.ai")
DEFAULT_INSTALL_PATH = os.path.expanduser("~/.centris/connectors")


async def fetch_registry_connectors(
    registry_url: str,
    search: Optional[str] = None,
    category: Optional[str] = None,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    """Fetch connectors from registry."""
    try:
        import httpx
    except ImportError:
        raise ImportError("httpx not installed. Install with: pip install httpx")
    
    async with httpx.AsyncClient() as client:
        params = {"limit": limit}
        if search:
            params["search"] = search
        if category:
            params["category"] = category
        
        url = f"{registry_url}/api/registry/connectors"
        response = await client.get(url, params=params, timeout=30.0)
        
        if response.status_code != 200:
            raise ValueError(f"Registry error: {response.text}")
        
        data = response.json()
        if not data.get("success"):
            raise ValueError(data.get("error", "Unknown error"))
        
        return data.get("connectors", [])


def parse_connector_md_metadata(path: Path) -> Dict[str, Any]:
    """Parse CONNECTOR.md simplified format metadata."""
    import re
    
    content = path.read_text()
    metadata = {}
    
    # Extract YAML frontmatter
    frontmatter_match = re.match(r'^---\s*\n(.*?)\n---', content, re.DOTALL)
    
    if frontmatter_match:
        frontmatter = frontmatter_match.group(1)
        
        for line in frontmatter.split("\n"):
            if ":" in line:
                key, value = line.split(":", 1)
                key = key.strip().lower()
                value = value.strip().strip('"').strip("'")
                
                if key in ("name", "id", "version", "description"):
                    metadata[key] = value
    
    return metadata


def get_installed_connectors(
    install_path: Path,
    local_paths: Optional[List[Path]] = None,
) -> Dict[str, Dict[str, Any]]:
    """Get locally installed connectors."""
    installed = {}
    
    # Check default install path
    if install_path.exists():
        for entry in install_path.iterdir():
            if entry.is_dir():
                connector_json = entry / "connector.json"
                connector_py = entry / "connector.py"
                connector_md = entry / "CONNECTOR.md"
                
                if connector_json.exists() or connector_py.exists() or connector_md.exists():
                    info = {"id": entry.name, "path": str(entry), "source": "installed"}
                    
                    # Try to read metadata from connector.json first
                    if connector_json.exists():
                        try:
                            with open(connector_json) as f:
                                meta = json.load(f)
                                info.update({
                                    "name": meta.get("name", entry.name),
                                    "version": meta.get("version", "unknown"),
                                    "description": meta.get("description", ""),
                                    "format": "standard",
                                })
                        except Exception:
                            info["name"] = entry.name
                            info["version"] = "unknown"
                    # Try CONNECTOR.md
                    elif connector_md.exists():
                        try:
                            meta = parse_connector_md_metadata(connector_md)
                            info.update({
                                "name": meta.get("name", entry.name),
                                "version": meta.get("version", "1.0.0"),
                                "description": meta.get("description", ""),
                                "format": "connector_md",
                            })
                        except Exception:
                            info["name"] = entry.name
                            info["version"] = "unknown"
                    else:
                        info["name"] = entry.name
                        info["version"] = "unknown"
                    
                    installed[entry.name] = info
    
    # Check local connectors directory
    if local_paths:
        for local_path in local_paths:
            if local_path.exists():
                for entry in local_path.iterdir():
                    if entry.is_dir() and entry.name not in installed:
                        connector_py = entry / "connector.py"
                        connector_md = entry / "CONNECTOR.md"
                        if connector_py.exists() or connector_md.exists():
                            installed[entry.name] = {
                                "id": entry.name,
                                "name": entry.name,
                                "path": str(entry),
                                "source": "local",
                                "version": "local",
                            }
    
    return installed


@click.command("list")
@click.option("--registry", default=REGISTRY_URL, help="Registry URL")
@click.option("--search", "-s", help="Search query")
@click.option("--category", "-c", help="Filter by category")
@click.option("--installed", "-i", is_flag=True, help="Show only installed connectors")
@click.option("--available", "-a", is_flag=True, help="Show only registry connectors")
@click.option("--json-output", "json_out", is_flag=True, help="Output as JSON")
@click.option("--limit", default=50, help="Max results from registry")
@click.pass_context
def list_command(
    ctx: click.Context,
    registry: str,
    search: Optional[str],
    category: Optional[str],
    installed: bool,
    available: bool,
    json_out: bool,
    limit: int,
) -> None:
    """
    List available and installed connectors.
    
    By default, shows both installed connectors and available connectors
    from the registry.
    
    Examples:
        centris list
        centris list --search gmail
        centris list --category email
        centris list --installed
        centris list --available
    """
    verbose = ctx.obj.get("verbose", False)
    
    # Determine what to show
    show_installed = not available or installed
    show_registry = not installed or available
    
    # Get installed connectors
    installed_connectors = {}
    if show_installed:
        install_path = Path(DEFAULT_INSTALL_PATH)
        local_paths = [Path("./connectors"), Path("./my-connectors")]
        installed_connectors = get_installed_connectors(install_path, local_paths)
    
    # Get registry connectors
    registry_connectors = []
    if show_registry:
        try:
            registry_connectors = asyncio.run(
                fetch_registry_connectors(registry, search, category, limit)
            )
        except Exception as e:
            if not json_out:
                click.echo(click.style(f"Could not fetch from registry: {e}", fg="yellow"))
    
    # Output
    if json_out:
        output = {
            "success": True,
            "installed": list(installed_connectors.values()),
            "available": registry_connectors,
        }
        click.echo(json.dumps(output, indent=2))
        return
    
    # Pretty print
    if show_installed and installed_connectors:
        click.echo(click.style("Installed Connectors", fg="cyan", bold=True))
        click.echo("-" * 60)
        
        for conn in installed_connectors.values():
            status = click.style("●", fg="green")
            name = conn.get("name", conn["id"])
            version = conn.get("version", "unknown")
            source = conn.get("source", "unknown")
            
            click.echo(f"  {status} {name} ({conn['id']})")
            click.echo(f"      Version: {version}  Source: {source}")
            if verbose:
                click.echo(f"      Path: {conn.get('path', 'unknown')}")
        
        click.echo()
    
    if show_registry and registry_connectors:
        click.echo(click.style("Available from Registry", fg="cyan", bold=True))
        click.echo("-" * 60)
        
        for conn in registry_connectors:
            conn_id = conn.get("id")
            is_installed = conn_id in installed_connectors
            
            if is_installed:
                status = click.style("●", fg="green")  # Installed
                status_text = " (installed)"
            else:
                status = click.style("○", fg="white")  # Available
                status_text = ""
            
            verified = " ✓" if conn.get("verified") else ""
            
            click.echo(f"  {status} {conn.get('name')} ({conn_id}){status_text}{verified}")
            click.echo(f"      {conn.get('description', 'No description')[:60]}...")
            click.echo(f"      v{conn.get('version')} | {conn.get('tool_count', 0)} tools | {conn.get('downloads', 0):,} downloads")
            
            if verbose:
                categories = ", ".join(conn.get("categories", []))
                if categories:
                    click.echo(f"      Categories: {categories}")
        
        click.echo()
        click.echo(f"Showing {len(registry_connectors)} of {limit} max results")
    
    if not installed_connectors and not registry_connectors:
        click.echo("No connectors found.")
        click.echo()
        click.echo("To install a connector:")
        click.echo("  centris install <connector_id>")
        click.echo()
        click.echo("To search the registry:")
        click.echo("  centris list --search <query>")


@click.command("search")
@click.argument("query")
@click.option("--registry", default=REGISTRY_URL, help="Registry URL")
@click.option("--category", "-c", help="Filter by category")
@click.option("--json-output", "json_out", is_flag=True, help="Output as JSON")
@click.pass_context
def search_command(
    ctx: click.Context,
    query: str,
    registry: str,
    category: Optional[str],
    json_out: bool,
) -> None:
    """
    Search for connectors in the registry.
    
    Examples:
        centris search email
        centris search "google workspace"
        centris search slack --category communication
    """
    # Delegate to list with search
    ctx.invoke(list_command, search=query, category=category, 
               available=True, json_out=json_out, registry=registry)
