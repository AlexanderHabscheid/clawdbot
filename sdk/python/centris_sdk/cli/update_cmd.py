"""
Centris SDK CLI - Update Command

Update installed connectors to the latest version.

Note: Update only works for connectors installed from registry.
Local connectors should be updated manually.
"""

import click
import json
import sys
import os
import asyncio
import shutil
import tarfile
import tempfile
from pathlib import Path
from typing import Optional, List, Dict, Any

from centris_sdk.cli.install_cmd import (
    fetch_connector_info,
    download_connector,
    DEFAULT_INSTALL_PATH,
    REGISTRY_URL,
)
from centris_sdk.cli.list_cmd import get_installed_connectors


def extract_package(package_data: bytes, target_path: Path) -> None:
    """Extract connector package (tar.gz) to target path."""
    with tempfile.TemporaryDirectory() as tmpdir:
        tarball_path = Path(tmpdir) / "package.tar.gz"
        with open(tarball_path, "wb") as f:
            f.write(package_data)
        
        with tarfile.open(tarball_path, "r:gz") as tar:
            tar.extractall(target_path)


def parse_version(version: str) -> tuple:
    """Parse version string into comparable tuple."""
    try:
        parts = version.split(".")
        return tuple(int(p) for p in parts[:3])
    except (ValueError, AttributeError):
        return (0, 0, 0)


def version_compare(v1: str, v2: str) -> int:
    """Compare two version strings. Returns: -1 if v1 < v2, 0 if equal, 1 if v1 > v2."""
    t1 = parse_version(v1)
    t2 = parse_version(v2)
    
    if t1 < t2:
        return -1
    elif t1 > t2:
        return 1
    return 0


@click.command("update")
@click.argument("connector_id", required=False)
@click.option("--registry", default=REGISTRY_URL, help="Registry URL")
@click.option("--all", "-a", "update_all", is_flag=True, help="Update all installed connectors")
@click.option("--check", is_flag=True, help="Check for updates without installing")
@click.option("--json-output", "json_out", is_flag=True, help="Output as JSON")
@click.pass_context
def update_command(
    ctx: click.Context,
    connector_id: Optional[str],
    registry: str,
    update_all: bool,
    check: bool,
    json_out: bool,
) -> None:
    """
    Update installed connectors to the latest version.
    
    By default, updates a single connector. Use --all to update all
    installed connectors.
    
    Examples:
        centris update gmail
        centris update --all
        centris update --check           # Check for updates
        centris update gmail --check     # Check specific connector
    """
    verbose = ctx.obj.get("verbose", False)
    install_path = Path(DEFAULT_INSTALL_PATH)
    
    # Get installed connectors
    installed = get_installed_connectors(install_path, [Path("./connectors")])
    
    if not installed:
        if json_out:
            click.echo(json.dumps({"success": False, "error": "No connectors installed"}))
        else:
            click.echo("No connectors installed.")
            click.echo("Install a connector with: centris install <connector_id>")
        sys.exit(1)
    
    # Determine which connectors to update
    if update_all:
        to_update = list(installed.keys())
    elif connector_id:
        if connector_id not in installed:
            if json_out:
                click.echo(json.dumps({
                    "success": False,
                    "error": f"Connector not installed: {connector_id}"
                }))
            else:
                click.echo(click.style(f"Connector not installed: {connector_id}", fg="red"))
                click.echo(f"Installed connectors: {', '.join(installed.keys())}")
            sys.exit(1)
        to_update = [connector_id]
    else:
        if json_out:
            click.echo(json.dumps({
                "success": False,
                "error": "Specify a connector ID or use --all"
            }))
        else:
            click.echo("Specify a connector to update:")
            click.echo("  centris update <connector_id>")
            click.echo("  centris update --all")
            click.echo()
            click.echo(f"Installed: {', '.join(installed.keys())}")
        sys.exit(1)
    
    async def check_and_update():
        updates_available = []
        updated = []
        errors = []
        
        for conn_id in to_update:
            local_info = installed[conn_id]
            local_version = local_info.get("version", "0.0.0")
            
            # Skip local-only connectors
            if local_info.get("source") == "local":
                if verbose and not json_out:
                    click.echo(f"  Skipping {conn_id} (local development connector)")
                continue
            
            try:
                # Fetch registry info
                registry_info = await fetch_connector_info(conn_id, registry)
                latest_version = registry_info.get("version", "0.0.0")
                
                # Compare versions
                cmp = version_compare(local_version, latest_version)
                
                if cmp < 0:
                    updates_available.append({
                        "id": conn_id,
                        "name": registry_info.get("name", conn_id),
                        "current": local_version,
                        "latest": latest_version,
                        "info": registry_info,
                    })
                elif verbose and not json_out:
                    click.echo(f"  {conn_id}: up to date ({local_version})")
                    
            except Exception as e:
                errors.append({
                    "id": conn_id,
                    "error": str(e),
                })
                if not json_out:
                    click.echo(click.style(f"  Error checking {conn_id}: {e}", fg="red"))
        
        # If check only, report and return
        if check:
            return {
                "mode": "check",
                "updates_available": updates_available,
                "errors": errors,
            }
        
        # Perform updates
        for update in updates_available:
            conn_id = update["id"]
            registry_info = update["info"]
            latest_version = update["latest"]
            
            if not json_out:
                click.echo(f"  Updating {conn_id}: {update['current']} → {latest_version}")
            
            try:
                # Find download URL
                versions = registry_info.get("versions", [])
                download_url = None
                for v in versions:
                    if v.get("version") == latest_version:
                        download_url = v.get("download_url")
                        break
                
                if not download_url:
                    raise ValueError(f"Download URL not found for version {latest_version}")
                
                # Download
                package_data = await download_connector(
                    conn_id, latest_version, download_url, registry
                )
                
                # Backup and remove old version
                connector_path = install_path / conn_id
                backup_path = install_path / f"{conn_id}.backup"
                
                if connector_path.exists():
                    if backup_path.exists():
                        shutil.rmtree(backup_path)
                    shutil.move(str(connector_path), str(backup_path))
                
                try:
                    # Install new version
                    connector_path.mkdir(parents=True, exist_ok=True)
                    extract_package(package_data, connector_path)
                    
                    # Success - remove backup
                    if backup_path.exists():
                        shutil.rmtree(backup_path)
                    
                    updated.append({
                        "id": conn_id,
                        "from": update["current"],
                        "to": latest_version,
                    })
                    
                except Exception as install_error:
                    # Restore backup on failure
                    if backup_path.exists():
                        if connector_path.exists():
                            shutil.rmtree(connector_path)
                        shutil.move(str(backup_path), str(connector_path))
                    raise install_error
                    
            except Exception as e:
                errors.append({
                    "id": conn_id,
                    "error": str(e),
                })
                if not json_out:
                    click.echo(click.style(f"    Failed: {e}", fg="red"))
        
        return {
            "mode": "update",
            "updates_available": updates_available,
            "updated": updated,
            "errors": errors,
        }
    
    if not json_out:
        if check:
            click.echo("Checking for updates...")
        else:
            click.echo("Checking and updating connectors...")
        click.echo()
    
    try:
        result = asyncio.run(check_and_update())
        
        if json_out:
            click.echo(json.dumps({
                "success": True,
                **result,
            }, indent=2))
            return
        
        # Pretty print results
        if check:
            if result["updates_available"]:
                click.echo(click.style("Updates available:", fg="yellow", bold=True))
                for update in result["updates_available"]:
                    click.echo(f"  {update['name']} ({update['id']}): {update['current']} → {update['latest']}")
                click.echo()
                click.echo("Run 'centris update --all' to update all connectors")
            else:
                click.echo(click.style("All connectors are up to date!", fg="green"))
        else:
            if result.get("updated"):
                click.echo()
                click.echo(click.style("✓ Updated successfully!", fg="green", bold=True))
                for u in result["updated"]:
                    click.echo(f"  {u['id']}: {u['from']} → {u['to']}")
            elif not result["updates_available"]:
                click.echo(click.style("All connectors are up to date!", fg="green"))
            
            if result.get("errors"):
                click.echo()
                click.echo(click.style("Errors:", fg="red"))
                for err in result["errors"]:
                    click.echo(f"  {err['id']}: {err['error']}")
                    
    except Exception as e:
        if json_out:
            click.echo(json.dumps({"success": False, "error": str(e)}))
        else:
            click.echo(click.style(f"Update failed: {e}", fg="red"))
        sys.exit(1)
