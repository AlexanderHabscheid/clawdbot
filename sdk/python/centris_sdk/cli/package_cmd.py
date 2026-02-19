"""
Centris SDK CLI - Package Command

Package connectors as distributable .connector files.

This enables sharing connectors without a registry:
- Via email, Discord, Slack
- Via GitHub releases
- Via any file sharing service

.connector files are standard zip archives containing:
- connector.py (or CONNECTOR.md for simple connectors)
- connector.json (metadata)
- Any bundled scripts/assets
"""

import click
import json
import sys
import os
import hashlib
import zipfile
import tempfile
from pathlib import Path
from typing import Optional, Any
from datetime import datetime


def get_connector_metadata(path: Path) -> dict[str, Any]:
    """Load connector metadata from connector.json or CONNECTOR.md."""
    # Try connector.json first
    connector_json = path / "connector.json"
    if connector_json.exists():
        with open(connector_json) as f:
            return json.load(f)
    
    # Try CONNECTOR.md (simplified format)
    connector_md = path / "CONNECTOR.md"
    if connector_md.exists():
        return parse_connector_md(connector_md)
    
    # Fallback: infer from directory name
    return {
        "id": path.name,
        "name": path.name.replace("-", " ").replace("_", " ").title(),
        "version": "1.0.0",
        "description": "",
    }


def parse_connector_md(path: Path) -> dict[str, Any]:
    """
    Parse CONNECTOR.md simplified format.
    
    Format:
    ---
    name: my-connector
    description: A simple connector
    version: 1.0.0
    ---
    
    # My Connector
    
    Instructions for the connector...
    """
    import re
    
    content = path.read_text()
    
    # Extract YAML frontmatter
    frontmatter_match = re.match(r'^---\s*\n(.*?)\n---', content, re.DOTALL)
    
    metadata = {
        "id": path.parent.name,
        "name": path.parent.name.replace("-", " ").title(),
        "version": "1.0.0",
        "description": "",
        "format": "connector_md",
    }
    
    if frontmatter_match:
        frontmatter = frontmatter_match.group(1)
        
        # Parse simple YAML
        for line in frontmatter.split("\n"):
            if ":" in line:
                key, value = line.split(":", 1)
                key = key.strip().lower()
                value = value.strip().strip('"').strip("'")
                
                if key == "name":
                    metadata["name"] = value
                    if "id" not in metadata or metadata["id"] == path.parent.name:
                        metadata["id"] = value.lower().replace(" ", "-")
                elif key == "id":
                    metadata["id"] = value
                elif key == "description":
                    metadata["description"] = value
                elif key == "version":
                    metadata["version"] = value
                elif key == "categories":
                    metadata["categories"] = [c.strip() for c in value.split(",")]
                elif key == "tags":
                    metadata["tags"] = [t.strip() for t in value.split(",")]
    
    return metadata


def create_connector_package(
    path: Path,
    output_dir: Optional[Path] = None,
    include_pycache: bool = False,
) -> tuple[Path, dict[str, Any]]:
    """
    Create a .connector package from a connector directory.
    
    Args:
        path: Path to connector directory
        output_dir: Where to save the package (default: current directory)
        include_pycache: Whether to include __pycache__ directories
        
    Returns:
        (package_path, metadata)
    """
    path = path.resolve()
    output_dir = output_dir or Path.cwd()
    output_dir = output_dir.resolve()
    
    # Get metadata
    metadata = get_connector_metadata(path)
    
    # Package filename
    package_name = f"{metadata['id']}-{metadata['version']}.connector"
    package_path = output_dir / package_name
    
    # Files to exclude
    exclude_patterns = {
        ".git",
        ".gitignore",
        ".env",
        ".env.local",
        ".venv",
        "venv",
        "node_modules",
        ".pytest_cache",
        ".mypy_cache",
        "dist",
        "build",
        "*.egg-info",
    }
    
    if not include_pycache:
        exclude_patterns.add("__pycache__")
    
    # Create zip file
    with zipfile.ZipFile(package_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for item in path.rglob("*"):
            if item.is_file():
                # Check exclusions
                rel_path = item.relative_to(path)
                parts = rel_path.parts
                
                should_exclude = False
                for pattern in exclude_patterns:
                    if any(pattern in str(part) or part == pattern for part in parts):
                        should_exclude = True
                        break
                    if item.match(pattern):
                        should_exclude = True
                        break
                
                if not should_exclude:
                    zf.write(item, str(rel_path))
        
        # Ensure connector.json exists in package (create from CONNECTOR.md if needed)
        if not (path / "connector.json").exists():
            connector_json_content = json.dumps(metadata, indent=2)
            zf.writestr("connector.json", connector_json_content)
    
    # Calculate checksum
    with open(package_path, "rb") as f:
        checksum = hashlib.sha256(f.read()).hexdigest()
    
    package_info = {
        **metadata,
        "checksum": checksum,
        "filename": package_name,
        "size": package_path.stat().st_size,
        "created_at": datetime.utcnow().isoformat() + "Z",
    }
    
    return package_path, package_info


def extract_connector_package(
    package_path: Path,
    target_dir: Path,
) -> dict[str, Any]:
    """
    Extract a .connector package.
    
    Args:
        package_path: Path to .connector file
        target_dir: Where to extract
        
    Returns:
        Extracted connector metadata
    """
    target_dir.mkdir(parents=True, exist_ok=True)
    
    with zipfile.ZipFile(package_path, "r") as zf:
        zf.extractall(target_dir)
    
    # Load metadata
    metadata = get_connector_metadata(target_dir)
    return metadata


@click.command("package")
@click.argument("path", type=click.Path(exists=True), default=".")
@click.option("--output", "-o", type=click.Path(), help="Output directory (default: current directory)")
@click.option("--include-pycache", is_flag=True, help="Include __pycache__ directories")
@click.option("--json-output", "json_out", is_flag=True, help="Output as JSON")
@click.pass_context
def package_command(
    ctx: click.Context,
    path: str,
    output: Optional[str],
    include_pycache: bool,
    json_out: bool,
) -> None:
    """
    Package a connector for distribution.
    
    Creates a .connector file (zip archive) that can be shared:
    - Via email, Discord, Slack
    - Via GitHub releases
    - Via any file sharing service
    
    Recipients can install with:
        centris install ./my-connector-1.0.0.connector
    
    Examples:
        centris package .
        centris package ./my-connector
        centris package . --output ./dist
    """
    verbose = ctx.obj.get("verbose", False) if ctx.obj else False
    connector_path = Path(path).resolve()
    output_dir = Path(output).resolve() if output else None
    
    if not json_out:
        click.echo(f"Packaging connector: {connector_path.name}")
        click.echo()
    
    # Validate connector exists
    has_connector_py = (connector_path / "connector.py").exists()
    has_connector_json = (connector_path / "connector.json").exists()
    has_connector_md = (connector_path / "CONNECTOR.md").exists()
    
    if not (has_connector_py or has_connector_md):
        if json_out:
            click.echo(json.dumps({
                "success": False,
                "error": "Not a valid connector: missing connector.py or CONNECTOR.md"
            }))
        else:
            click.echo(click.style(
                "Error: Not a valid connector directory.",
                fg="red"
            ))
            click.echo("Expected: connector.py or CONNECTOR.md")
        sys.exit(1)
    
    # Validate if possible
    if has_connector_json:
        try:
            from centris_sdk.cli.validate_cmd import (
                validate_connector_json,
                validate_connector_py,
            )
            
            if not json_out:
                click.echo("Validating...")
            
            validations = []
            validations.append(validate_connector_json(connector_path))
            
            if has_connector_py:
                validations.append(validate_connector_py(connector_path))
            
            all_errors = []
            for result in validations:
                all_errors.extend(result.errors)
            
            if all_errors:
                if json_out:
                    click.echo(json.dumps({
                        "success": False,
                        "errors": all_errors
                    }))
                else:
                    click.echo(click.style("Validation failed:", fg="red"))
                    for error in all_errors:
                        click.echo(f"  ✗ {error}")
                sys.exit(1)
            
            if not json_out:
                click.echo(click.style("  ✓ Validation passed", fg="green"))
                click.echo()
        except ImportError:
            # Validation module not available, skip
            pass
    
    # Create package
    try:
        package_path, package_info = create_connector_package(
            connector_path,
            output_dir,
            include_pycache,
        )
    except Exception as e:
        if json_out:
            click.echo(json.dumps({
                "success": False,
                "error": str(e)
            }))
        else:
            click.echo(click.style(f"Packaging failed: {e}", fg="red"))
        sys.exit(1)
    
    if json_out:
        click.echo(json.dumps({
            "success": True,
            "path": str(package_path),
            **package_info
        }))
    else:
        click.echo(click.style("✓ Package created successfully!", fg="green", bold=True))
        click.echo()
        click.echo(f"  File: {package_path}")
        click.echo(f"  Size: {package_info['size']:,} bytes")
        click.echo(f"  Checksum: {package_info['checksum'][:16]}...")
        click.echo()
        click.echo("Share this file and install with:")
        click.echo(f"  centris install ./{package_info['filename']}")
        click.echo()
        click.echo("Or install locally:")
        click.echo(f"  centris install . --local")
