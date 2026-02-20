"""
Centris SDK CLI - Publish Command

Publish connector to the Centris registry OR install locally.

Local-first design:
- If no registry is configured, publish locally to ~/.centris/connectors/
- If CENTRIS_REGISTRY_URL is set, publish to the remote registry

Commands:
- centris publish .           → Install locally (no registry needed)
- centris publish . --local   → Explicitly install locally
- centris publish . --registry https://... → Publish to remote registry
- centris package .           → Just create .connector file (no install)

The registry API accepts:
- POST /api/connectors - Publish connector metadata/package
- GET /connectors/:id - Connector details page
- Legacy compatibility: POST /api/registry/publish
"""

import click
import json
import sys
import os
import hashlib
import tarfile
import tempfile
import base64
import shutil
from pathlib import Path
from typing import Optional, Any
from datetime import datetime


REGISTRY_URL = os.environ.get("CENTRIS_REGISTRY_URL", "")
DEFAULT_INSTALL_PATH = os.path.expanduser("~/.centris/connectors")


def create_package(path: Path) -> tuple[Path, dict[str, Any]]:
    """Create a publishable package from connector directory."""
    # Load connector.json
    connector_json = path / "connector.json"
    if not connector_json.exists():
        raise FileNotFoundError("connector.json not found")
    
    with open(connector_json) as f:
        metadata = json.load(f)
    
    # Create tarball
    package_name = f"{metadata['id']}-{metadata['version']}.tar.gz"
    
    with tempfile.TemporaryDirectory() as tmpdir:
        package_path = Path(tmpdir) / package_name
        
        with tarfile.open(package_path, "w:gz") as tar:
            # Add all Python files
            for py_file in path.glob("**/*.py"):
                if "__pycache__" not in str(py_file):
                    arcname = py_file.relative_to(path)
                    tar.add(py_file, arcname=str(arcname))
            
            # Add connector.json
            tar.add(connector_json, arcname="connector.json")
            
            # Add README if exists
            readme = path / "README.md"
            if readme.exists():
                tar.add(readme, arcname="README.md")
            
            # Add pyproject.toml if exists
            pyproject = path / "pyproject.toml"
            if pyproject.exists():
                tar.add(pyproject, arcname="pyproject.toml")
        
        # Calculate checksum
        with open(package_path, "rb") as f:
            checksum = hashlib.sha256(f.read()).hexdigest()
        
        # Copy to current directory
        final_path = Path.cwd() / package_name
        import shutil
        shutil.copy(package_path, final_path)
    
    package_info = {
        "id": metadata["id"],
        "name": metadata["name"],
        "version": metadata["version"],
        "description": metadata.get("description", ""),
        "checksum": checksum,
        "filename": package_name,
        "size": final_path.stat().st_size,
        "created_at": datetime.utcnow().isoformat() + "Z",
    }
    
    return final_path, package_info


async def publish_to_registry(
    package_path: Path,
    package_info: dict[str, Any],
    api_key: str,
    registry_url: str,
    connector_metadata: dict[str, Any],
) -> dict[str, Any]:
    """Publish package to Centris registry.
    
    Primary contract: POST /api/connectors
    Compatibility fallback: POST /api/registry/publish
    """
    try:
        import httpx
    except ImportError:
        raise ImportError("httpx not installed. Install with: pip install httpx")
    
    async with httpx.AsyncClient() as client:
        # Read and encode package
        with open(package_path, "rb") as f:
            package_data = f.read()
        
        package_base64 = base64.b64encode(package_data).decode('utf-8')
        
        # Build manifest for registry
        manifest = {
            "id": package_info["id"],
            "name": package_info["name"],
            "version": package_info["version"],
            "description": package_info.get("description", ""),
            "author": connector_metadata.get("author", ""),
            "categories": connector_metadata.get("categories", []),
            "tags": connector_metadata.get("tags", []),
            "url_patterns": connector_metadata.get("url_patterns", []),
            "connector_type": connector_metadata.get("connector_type", "browser"),
            "auth_scheme": connector_metadata.get("auth_scheme", "browser_session"),
            "tools": connector_metadata.get("tools", []),
        }
        
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        
        # Primary shared contract used by both SDK CLIs.
        connector_payload = {
            "connector": {
                "id": package_info["id"],
                "name": package_info["name"],
                "description": package_info.get("description", ""),
                "version": package_info["version"],
            },
            "tools": manifest.get("tools", []),
            "package": {
                "name": f"centris-connector-{package_info['id']}",
                "version": package_info["version"],
                "filename": package_info["filename"],
                "checksum": package_info["checksum"],
                "size": package_info["size"],
                "tarball_base64": package_base64,
            },
        }
        primary = await client.post(
            f"{registry_url}/api/connectors",
            json=connector_payload,
            headers=headers,
            timeout=120.0,
        )
        if primary.status_code == 401:
            raise ValueError("Invalid API key. Get your key from https://centris.ai/dashboard")
        if primary.status_code in (404, 405, 501):
            fallback = await client.post(
                f"{registry_url}/api/registry/publish",
                json={
                    "manifest": manifest,
                    "package_base64": package_base64,
                },
                headers=headers,
                timeout=120.0,
            )
            if fallback.status_code == 401:
                raise ValueError("Invalid API key. Get your key from https://centris.ai/dashboard")
            result = fallback.json()
            if not (200 <= fallback.status_code < 300) or not result.get("success"):
                error = result.get("error", fallback.text)
                raise ValueError(f"Publish failed: {error}")
            return result

        result = primary.json()
        if not (200 <= primary.status_code < 300):
            error = result.get("error", primary.text) if isinstance(result, dict) else primary.text
            raise ValueError(f"Publish failed: {error}")
        return result if isinstance(result, dict) else {"success": True}


def install_locally(
    connector_path: Path,
    install_path: Path,
    force: bool = False,
) -> dict:
    """Install connector to local connectors directory."""
    # Get metadata
    connector_json = connector_path / "connector.json"
    if connector_json.exists():
        with open(connector_json) as f:
            metadata = json.load(f)
    else:
        metadata = {
            "id": connector_path.name,
            "name": connector_path.name.replace("-", " ").title(),
            "version": "1.0.0",
        }
    
    connector_id = metadata.get("id", connector_path.name)
    target_path = install_path / connector_id
    
    # Check if already installed
    if target_path.exists() and not force:
        raise ValueError(f"Already installed at {target_path}. Use --force to overwrite.")
    
    # Remove existing if force
    if target_path.exists():
        shutil.rmtree(target_path)
    
    # Ensure install path exists
    install_path.mkdir(parents=True, exist_ok=True)
    
    # Copy connector
    shutil.copytree(
        connector_path,
        target_path,
        ignore=shutil.ignore_patterns(
            "__pycache__",
            "*.pyc",
            ".git",
            ".env",
            ".venv",
            "venv",
            "node_modules",
        )
    )
    
    return {
        "connector_id": connector_id,
        "name": metadata.get("name", connector_id),
        "version": metadata.get("version", "1.0.0"),
        "path": str(target_path),
    }


@click.command("publish")
@click.argument("path", type=click.Path(exists=True), default=".")
@click.option("--api-key", envvar="CENTRIS_API_KEY", help="Centris API key")
@click.option("--registry", default=REGISTRY_URL, help="Registry URL (if empty, installs locally)")
@click.option("--local", "-l", is_flag=True, help="Install locally instead of publishing to registry")
@click.option("--dry-run", is_flag=True, help="Create package without publishing/installing")
@click.option("--force", "-f", is_flag=True, help="Overwrite existing installation")
@click.option("--yes", "-y", is_flag=True, help="Skip confirmation")
@click.pass_context
def publish_command(
    ctx: click.Context,
    path: str,
    api_key: Optional[str],
    registry: str,
    local: bool,
    dry_run: bool,
    force: bool,
    yes: bool,
) -> None:
    """
    Publish connector to registry OR install locally.
    
    LOCAL-FIRST: If no registry is configured, installs to ~/.centris/connectors/
    This makes your connector available to your local Centris instance immediately.
    
    Modes:
        LOCAL INSTALL (default when no registry):
            centris publish .
            centris publish . --local
        
        REMOTE PUBLISH (when registry configured):
            centris publish . --registry https://registry.example.com
    
    Examples:
        centris publish .                    # Install locally
        centris publish . --local            # Explicitly local
        centris publish . --dry-run          # Create package only
        centris publish . --registry URL     # Publish to registry
    """
    import asyncio
    
    verbose = ctx.obj.get("verbose", False) if ctx.obj else False
    connector_path = Path(path).resolve()
    
    # Determine if we're doing local install or remote publish
    use_local = local or not registry
    
    if use_local:
        click.echo(f"Installing connector locally from: {connector_path}")
    else:
        click.echo(f"Publishing connector from: {connector_path}")
    click.echo()
    
    # Validate first
    from centris_sdk.cli.validate_cmd import (
        validate_connector_json,
        validate_connector_py,
        validate_python_syntax,
    )
    
    click.echo("Validating connector...")
    
    # Check what files exist
    has_connector_json = (connector_path / "connector.json").exists()
    has_connector_py = (connector_path / "connector.py").exists()
    has_connector_md = (connector_path / "CONNECTOR.md").exists()
    
    if not (has_connector_py or has_connector_md):
        click.echo(click.style("Error: Not a valid connector directory.", fg="red"))
        click.echo("Expected: connector.py or CONNECTOR.md")
        sys.exit(1)
    
    validations = []
    if has_connector_json:
        validations.append(validate_connector_json(connector_path))
    if has_connector_py:
        validations.append(validate_connector_py(connector_path))
        validations.append(validate_python_syntax(connector_path))
    
    all_errors = []
    for result in validations:
        all_errors.extend(result.errors)
    
    if all_errors:
        click.echo(click.style("Validation failed:", fg="red"))
        for error in all_errors:
            click.echo(f"  ✗ {error}")
        sys.exit(1)
    
    click.echo(click.style("  ✓ Validation passed", fg="green"))
    click.echo()
    
    # For dry-run, just create the package
    if dry_run:
        click.echo("Creating package...")
        
        try:
            package_path, package_info = create_package(connector_path)
        except Exception as e:
            click.echo(click.style(f"Failed to create package: {e}", fg="red"))
            sys.exit(1)
        
        click.echo(f"  Package: {package_info['filename']}")
        click.echo(f"  Size: {package_info['size']:,} bytes")
        click.echo(f"  Checksum: {package_info['checksum'][:16]}...")
        click.echo()
        click.echo(click.style("Dry run - package created but not published", fg="yellow"))
        click.echo(f"Package saved to: {package_path}")
        return
    
    # LOCAL INSTALL
    if use_local:
        install_path = Path(DEFAULT_INSTALL_PATH)
        
        # Confirm
        if not yes:
            click.echo(f"About to install to {install_path}")
            if not click.confirm("Continue?"):
                click.echo("Aborted.")
                return
        
        click.echo("Installing locally...")
        
        try:
            result = install_locally(connector_path, install_path, force)
            
            click.echo()
            click.echo(click.style("✓ Installed successfully!", fg="green", bold=True))
            click.echo()
            click.echo(f"  Connector: {result['name']} ({result['connector_id']})")
            click.echo(f"  Version: {result['version']}")
            click.echo(f"  Path: {result['path']}")
            click.echo()
            click.echo("The connector will be loaded automatically when Centris starts.")
            click.echo()
            click.echo("To share this connector, create a package:")
            click.echo("  centris package .")
            
        except Exception as e:
            click.echo(click.style(f"Installation failed: {e}", fg="red"))
            sys.exit(1)
        
        return
    
    # REMOTE PUBLISH
    # Create package
    click.echo("Creating package...")
    
    try:
        package_path, package_info = create_package(connector_path)
    except Exception as e:
        click.echo(click.style(f"Failed to create package: {e}", fg="red"))
        sys.exit(1)
    
    click.echo(f"  Package: {package_info['filename']}")
    click.echo(f"  Size: {package_info['size']:,} bytes")
    click.echo(f"  Checksum: {package_info['checksum'][:16]}...")
    click.echo()
    
    # Check for API key - auto-login if not provided
    if not api_key:
        try:
            from centris_sdk.cli.auth import ensure_authenticated
            api_key = ensure_authenticated(auto_login=True)
        except Exception as e:
            click.echo(click.style(f"Authentication required: {e}", fg="red"))
            click.echo()
            click.echo("Options:")
            click.echo("  1. Run 'centris login' first")
            click.echo("  2. Set CENTRIS_API_KEY environment variable")
            click.echo("  3. Use --api-key flag")
            click.echo("  4. Use --local to install locally without authentication")
            sys.exit(1)
    
    # Confirm
    if not yes:
        click.echo(f"About to publish {package_info['name']} v{package_info['version']} to {registry}")
        if not click.confirm("Continue?"):
            click.echo("Aborted.")
            return
    
    # Publish
    click.echo("Publishing to registry...")
    
    # Load full connector metadata
    connector_json = connector_path / "connector.json"
    with open(connector_json) as f:
        connector_metadata = json.load(f)
    
    try:
        result = asyncio.run(publish_to_registry(
            package_path,
            package_info,
            api_key,
            registry,
            connector_metadata,
        ))
        
        click.echo()
        click.echo(click.style("✓ Published successfully!", fg="green", bold=True))
        click.echo()
        click.echo(f"  Connector: {result.get('id', package_info['id'])}")
        click.echo(f"  Version: {result.get('version', package_info['version'])}")
        click.echo(f"  URL: {registry}/connectors/{package_info['id']}")
        
    except Exception as e:
        click.echo(click.style(f"Publish failed: {e}", fg="red"))
        sys.exit(1)
    finally:
        # Clean up package file
        if package_path.exists():
            package_path.unlink()
