"""
Centris SDK CLI - Install Command

Install connectors from multiple sources:
1. Local directory: centris install ./my-connector
2. Local package: centris install ./my-connector-1.0.0.connector
3. GitHub: centris install github:user/repo
4. Registry: centris install gmail (if CENTRIS_REGISTRY_URL is set)

Local-first design: No cloud registry required for basic workflows.
"""

import click
import json
import sys
import os
import re
import tarfile
import zipfile
import tempfile
import asyncio
import shutil
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

REGISTRY_URL = os.environ.get("CENTRIS_REGISTRY_URL", "")
DEFAULT_INSTALL_PATH = os.path.expanduser("~/.centris/connectors")


# =============================================================================
# Source Detection
# =============================================================================

def detect_source_type(source: str) -> tuple[str, str]:
    """
    Detect the type of installation source.
    
    Returns:
        (source_type, normalized_source)
        
    Source types:
        - "local_dir": Local directory containing connector
        - "local_package": .connector or .tar.gz file
        - "github": github:user/repo or github.com URL
        - "registry": Connector ID to fetch from registry
    """
    # Check if it's a local path
    path = Path(source)
    
    if path.exists():
        if path.is_dir():
            return ("local_dir", str(path.resolve()))
        elif path.suffix in (".connector", ".gz", ".zip"):
            return ("local_package", str(path.resolve()))
    
    # Check for github: prefix
    if source.startswith("github:"):
        return ("github", source[7:])  # Remove "github:" prefix
    
    # Check for GitHub URL
    github_patterns = [
        r"^https?://github\.com/([^/]+/[^/]+)",
        r"^github\.com/([^/]+/[^/]+)",
    ]
    for pattern in github_patterns:
        match = re.match(pattern, source)
        if match:
            return ("github", match.group(1))
    
    # Default: assume it's a registry connector ID
    return ("registry", source)


# =============================================================================
# Local Directory Installation
# =============================================================================

def install_from_local_dir(
    source_path: Path,
    install_path: Path,
    force: bool = False,
) -> dict:
    """Install connector from a local directory."""
    source_path = source_path.resolve()
    
    # Validate it's a connector
    has_connector_py = (source_path / "connector.py").exists()
    has_connector_json = (source_path / "connector.json").exists()
    has_connector_md = (source_path / "CONNECTOR.md").exists()
    
    if not (has_connector_py or has_connector_md):
        raise ValueError(f"Not a valid connector: {source_path}")
    
    # Get metadata
    if has_connector_json:
        with open(source_path / "connector.json") as f:
            metadata = json.load(f)
    elif has_connector_md:
        from centris_sdk.cli.package_cmd import parse_connector_md
        metadata = parse_connector_md(source_path / "CONNECTOR.md")
    else:
        metadata = {
            "id": source_path.name,
            "name": source_path.name.replace("-", " ").title(),
            "version": "1.0.0",
        }
    
    connector_id = metadata.get("id", source_path.name)
    target_path = install_path / connector_id
    
    # Check if already installed
    if target_path.exists() and not force:
        raise ValueError(f"Already installed at {target_path}. Use --force to overwrite.")
    
    # Remove existing if force
    if target_path.exists():
        shutil.rmtree(target_path)
    
    # Copy connector
    shutil.copytree(
        source_path,
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
        "source": "local_dir",
    }


# =============================================================================
# Local Package Installation
# =============================================================================

def install_from_local_package(
    package_path: Path,
    install_path: Path,
    force: bool = False,
) -> dict:
    """Install connector from a .connector or .tar.gz file."""
    package_path = package_path.resolve()
    
    with tempfile.TemporaryDirectory() as tmpdir:
        extract_dir = Path(tmpdir) / "extracted"
        extract_dir.mkdir()
        
        # Extract based on file type
        if package_path.suffix == ".connector" or package_path.suffix == ".zip":
            with zipfile.ZipFile(package_path, "r") as zf:
                zf.extractall(extract_dir)
        elif package_path.name.endswith(".tar.gz"):
            with tarfile.open(package_path, "r:gz") as tar:
                tar.extractall(extract_dir)
        else:
            raise ValueError(f"Unknown package format: {package_path.suffix}")
        
        # Find the connector root (might be nested)
        connector_root = extract_dir
        
        # Check if files are in a subdirectory
        items = list(extract_dir.iterdir())
        if len(items) == 1 and items[0].is_dir():
            connector_root = items[0]
        
        # Get metadata
        metadata_file = connector_root / "connector.json"
        if metadata_file.exists():
            with open(metadata_file) as f:
                metadata = json.load(f)
        else:
            metadata = {
                "id": package_path.stem.split("-")[0],
                "name": package_path.stem,
                "version": "1.0.0",
            }
        
        connector_id = metadata.get("id", package_path.stem)
        target_path = install_path / connector_id
        
        # Check if already installed
        if target_path.exists() and not force:
            raise ValueError(f"Already installed at {target_path}. Use --force to overwrite.")
        
        # Remove existing if force
        if target_path.exists():
            shutil.rmtree(target_path)
        
        # Copy to install location
        shutil.copytree(connector_root, target_path)
    
    return {
        "connector_id": connector_id,
        "name": metadata.get("name", connector_id),
        "version": metadata.get("version", "1.0.0"),
        "path": str(target_path),
        "source": "local_package",
    }


# =============================================================================
# GitHub Installation
# =============================================================================

async def install_from_github(
    repo: str,
    install_path: Path,
    force: bool = False,
    ref: Optional[str] = None,
) -> dict:
    """
    Install connector from a GitHub repository.
    
    Supports:
        - github:user/repo
        - github:user/repo@tag
        - github:user/repo#path/to/connector
    """
    try:
        import httpx
    except ImportError:
        raise ImportError("httpx not installed. Install with: pip install httpx")
    
    # Parse repo string
    path_in_repo = ""
    
    if "#" in repo:
        repo, path_in_repo = repo.split("#", 1)
    
    if "@" in repo:
        repo, ref = repo.split("@", 1)
    else:
        ref = ref or "main"
    
    # Construct download URL
    download_url = f"https://github.com/{repo}/archive/refs/heads/{ref}.zip"
    
    # Try tags if heads fails
    async with httpx.AsyncClient(follow_redirects=True) as client:
        response = await client.head(download_url, timeout=30.0)
        
        if response.status_code == 404:
            download_url = f"https://github.com/{repo}/archive/refs/tags/{ref}.zip"
            response = await client.head(download_url, timeout=30.0)
        
        if response.status_code != 200:
            raise ValueError(f"GitHub repository not found: {repo}@{ref}")
        
        # Download
        response = await client.get(download_url, timeout=120.0)
        
        if response.status_code != 200:
            raise ValueError(f"Failed to download from GitHub: {response.status_code}")
    
    with tempfile.TemporaryDirectory() as tmpdir:
        # Save and extract
        zip_path = Path(tmpdir) / "repo.zip"
        with open(zip_path, "wb") as f:
            f.write(response.content)
        
        extract_dir = Path(tmpdir) / "extracted"
        extract_dir.mkdir()
        
        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(extract_dir)
        
        # Find the repo root (GitHub adds a directory)
        items = list(extract_dir.iterdir())
        if len(items) == 1 and items[0].is_dir():
            repo_root = items[0]
        else:
            repo_root = extract_dir
        
        # Navigate to connector path if specified
        connector_root = repo_root / path_in_repo if path_in_repo else repo_root
        
        if not connector_root.exists():
            raise ValueError(f"Path not found in repository: {path_in_repo}")
        
        # Validate it's a connector
        has_connector_py = (connector_root / "connector.py").exists()
        has_connector_md = (connector_root / "CONNECTOR.md").exists()
        
        if not (has_connector_py or has_connector_md):
            # Maybe the connector is in a subdirectory
            for subdir in connector_root.iterdir():
                if subdir.is_dir():
                    if (subdir / "connector.py").exists() or (subdir / "CONNECTOR.md").exists():
                        connector_root = subdir
                        break
        
        if not ((connector_root / "connector.py").exists() or (connector_root / "CONNECTOR.md").exists()):
            raise ValueError(f"No connector found in {repo}")
        
        # Get metadata
        metadata_file = connector_root / "connector.json"
        if metadata_file.exists():
            with open(metadata_file) as f:
                metadata = json.load(f)
        else:
            metadata = {
                "id": connector_root.name or repo.split("/")[-1],
                "name": connector_root.name or repo.split("/")[-1],
                "version": "1.0.0",
            }
        
        connector_id = metadata.get("id", repo.split("/")[-1])
        target_path = install_path / connector_id
        
        # Check if already installed
        if target_path.exists() and not force:
            raise ValueError(f"Already installed at {target_path}. Use --force to overwrite.")
        
        # Remove existing if force
        if target_path.exists():
            shutil.rmtree(target_path)
        
        # Copy to install location
        shutil.copytree(
            connector_root,
            target_path,
            ignore=shutil.ignore_patterns(
                "__pycache__",
                "*.pyc",
                ".git",
                ".github",
            )
        )
    
    return {
        "connector_id": connector_id,
        "name": metadata.get("name", connector_id),
        "version": metadata.get("version", "1.0.0"),
        "path": str(target_path),
        "source": f"github:{repo}",
    }


# =============================================================================
# Registry Installation
# =============================================================================

async def fetch_connector_info(
    connector_id: str,
    registry_url: str,
    version: Optional[str] = None,
) -> dict:
    """Fetch connector info from registry."""
    try:
        import httpx
    except ImportError:
        raise ImportError("httpx not installed. Install with: pip install httpx")
    
    async with httpx.AsyncClient() as client:
        url = f"{registry_url}/api/registry/connectors/{connector_id}"
        response = await client.get(url, timeout=30.0)
        
        if response.status_code == 404:
            raise ValueError(f"Connector not found: {connector_id}")
        
        if response.status_code != 200:
            raise ValueError(f"Registry error: {response.text}")
        
        data = response.json()
        if not data.get("success"):
            raise ValueError(data.get("error", "Unknown error"))
        
        return data.get("connector", {})


async def download_connector(
    connector_id: str,
    version: str,
    download_url: str,
    registry_url: str,
) -> bytes:
    """Download connector package from registry."""
    try:
        import httpx
    except ImportError:
        raise ImportError("httpx not installed. Install with: pip install httpx")
    
    async with httpx.AsyncClient() as client:
        if download_url.startswith("/"):
            download_url = f"{registry_url}{download_url}"
        
        response = await client.get(download_url, timeout=120.0)
        
        if response.status_code != 200:
            raise ValueError(f"Failed to download: {response.status_code}")
        
        return response.content


async def install_from_registry(
    connector_id: str,
    install_path: Path,
    registry_url: str,
    version: Optional[str] = None,
    force: bool = False,
) -> dict:
    """Install connector from Centris registry."""
    # Fetch info
    info = await fetch_connector_info(connector_id, registry_url, version)
    
    target_version = version or info.get("version", "latest")
    
    # Find version to download
    versions = info.get("versions", [])
    download_url = None
    
    if versions:
        for v in versions:
            if v.get("version") == target_version or (not version and versions.index(v) == 0):
                download_url = v.get("download_url")
                target_version = v.get("version")
                break
    
    if not download_url:
        raise ValueError(f"Version not found: {target_version}")
    
    # Download
    package_data = await download_connector(
        connector_id,
        target_version,
        download_url,
        registry_url,
    )
    
    target_path = install_path / connector_id
    
    # Check if already installed
    if target_path.exists() and not force:
        raise ValueError(f"Already installed at {target_path}. Use --force to overwrite.")
    
    # Remove existing if force
    if target_path.exists():
        shutil.rmtree(target_path)
    
    target_path.mkdir(parents=True, exist_ok=True)
    
    # Extract (assuming tar.gz)
    with tempfile.TemporaryDirectory() as tmpdir:
        tarball_path = Path(tmpdir) / "package.tar.gz"
        with open(tarball_path, "wb") as f:
            f.write(package_data)
        
        with tarfile.open(tarball_path, "r:gz") as tar:
            tar.extractall(target_path)
    
    return {
        "connector_id": connector_id,
        "name": info.get("name", connector_id),
        "version": target_version,
        "path": str(target_path),
        "source": "registry",
    }


# =============================================================================
# CLI Command
# =============================================================================

@click.command("install")
@click.argument("source")
@click.option("--version", "-v", help="Specific version (for registry installs)")
@click.option("--registry", default=REGISTRY_URL, help="Registry URL")
@click.option("--path", "-p", type=click.Path(), help="Custom install path")
@click.option("--force", "-f", is_flag=True, help="Overwrite existing installation")
@click.option("--local", "-l", is_flag=True, help="Install from current directory to local connectors")
@click.option("--json-output", "json_out", is_flag=True, help="Output as JSON")
@click.pass_context
def install_command(
    ctx: click.Context,
    source: str,
    version: Optional[str],
    registry: str,
    path: Optional[str],
    force: bool,
    local: bool,
    json_out: bool,
) -> None:
    """
    Install a connector from various sources.
    
    Sources:
        LOCAL DIRECTORY:
            centris install ./my-connector
            centris install . --local
        
        LOCAL PACKAGE:
            centris install ./my-connector-1.0.0.connector
        
        GITHUB:
            centris install github:user/repo
            centris install github:user/repo@v1.0.0
            centris install github:user/repo#path/to/connector
        
        REGISTRY (if CENTRIS_REGISTRY_URL is set):
            centris install gmail
            centris install gmail --version 1.2.0
    
    Examples:
        centris install ./my-connector
        centris install ./my-connector-1.0.0.connector
        centris install github:centris-ai/connector-gmail
        centris install gmail --registry https://registry.example.com
    """
    verbose = ctx.obj.get("verbose", False) if ctx.obj else False
    
    # Handle --local flag
    if local:
        source = "."
    
    # Detect source type
    source_type, normalized_source = detect_source_type(source)
    
    # Determine install path
    install_path = Path(path) if path else Path(DEFAULT_INSTALL_PATH)
    install_path.mkdir(parents=True, exist_ok=True)
    
    if not json_out:
        source_desc = {
            "local_dir": "local directory",
            "local_package": "package file",
            "github": "GitHub",
            "registry": "registry",
        }.get(source_type, source_type)
        
        click.echo(f"Installing from {source_desc}: {normalized_source}")
        if verbose:
            click.echo(f"  Install path: {install_path}")
        click.echo()
    
    async def do_install():
        if source_type == "local_dir":
            return install_from_local_dir(
                Path(normalized_source),
                install_path,
                force,
            )
        
        elif source_type == "local_package":
            return install_from_local_package(
                Path(normalized_source),
                install_path,
                force,
            )
        
        elif source_type == "github":
            return await install_from_github(
                normalized_source,
                install_path,
                force,
            )
        
        elif source_type == "registry":
            if not registry:
                raise ValueError(
                    "Registry URL not configured.\n"
                    "Options:\n"
                    "  1. Set CENTRIS_REGISTRY_URL environment variable\n"
                    "  2. Use --registry flag\n"
                    "  3. Install from local path or GitHub instead:\n"
                    "     centris install ./my-connector\n"
                    "     centris install github:user/repo"
                )
            
            return await install_from_registry(
                normalized_source,
                install_path,
                registry,
                version,
                force,
            )
        
        else:
            raise ValueError(f"Unknown source type: {source_type}")
    
    try:
        result = asyncio.run(do_install())
        
        if json_out:
            click.echo(json.dumps({
                "success": True,
                **result,
            }))
        else:
            click.echo(click.style("✓ Installed successfully!", fg="green", bold=True))
            click.echo()
            click.echo(f"  Connector: {result['name']} ({result['connector_id']})")
            click.echo(f"  Version: {result['version']}")
            click.echo(f"  Path: {result['path']}")
            click.echo(f"  Source: {result['source']}")
            click.echo()
            click.echo("The connector will be loaded automatically when Centris starts.")
            
    except Exception as e:
        if json_out:
            click.echo(json.dumps({
                "success": False,
                "error": str(e),
            }))
        else:
            click.echo(click.style(f"Installation failed: {e}", fg="red"))
        sys.exit(1)
