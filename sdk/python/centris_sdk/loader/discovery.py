"""
Centris SDK Connector Discovery

Utilities for discovering connectors in the filesystem and packages.

Supports multiple connector formats:
1. Full connector: connector.py + connector.json
2. Simplified connector: CONNECTOR.md (like Clawdbot skills)
"""

import os
import sys
import json
import re
import logging
import importlib
import importlib.util
from pathlib import Path
from typing import Any, Optional
from dataclasses import dataclass, field


logger = logging.getLogger("centris.loader.discovery")


@dataclass
class DiscoveredConnector:
    """Information about a discovered connector."""
    
    id: str
    name: str
    path: Path
    version: str = "1.0.0"
    description: str = ""
    source: str = "filesystem"  # filesystem, package, registry
    format: str = "standard"  # standard, connector_md
    metadata: dict[str, Any] = field(default_factory=dict)


def parse_connector_md(path: Path) -> dict[str, Any]:
    """
    Parse CONNECTOR.md simplified format.
    
    Format:
    ---
    name: my-connector
    description: A simple connector
    version: 1.0.0
    categories: utilities, automation
    ---
    
    # My Connector
    
    Instructions for using the connector...
    
    ## Tools
    
    ### my_tool
    Description of the tool
    
    **Parameters:**
    - input (string): The input value
    """
    content = path.read_text()
    
    # Extract YAML frontmatter
    frontmatter_match = re.match(r'^---\s*\n(.*?)\n---', content, re.DOTALL)
    
    metadata = {
        "id": path.parent.name,
        "name": path.parent.name.replace("-", " ").replace("_", " ").title(),
        "version": "1.0.0",
        "description": "",
        "format": "connector_md",
    }
    
    if frontmatter_match:
        frontmatter = frontmatter_match.group(1)
        
        # Parse simple YAML-like format
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
                elif key == "url_patterns":
                    metadata["url_patterns"] = [u.strip() for u in value.split(",")]
    
    # Store the body content (everything after frontmatter)
    if frontmatter_match:
        body_start = frontmatter_match.end()
        metadata["body"] = content[body_start:].strip()
    else:
        metadata["body"] = content.strip()
    
    return metadata


def find_connector_modules(
    search_paths: list[str | Path],
    recursive: bool = True,
) -> list[Path]:
    """
    Find connector modules in given paths.
    
    Looks for:
    - Directories containing connector.py
    - Directories containing connector.json
    - Directories containing CONNECTOR.md (simplified format)
    - Python files with CentrisConnector imports
    
    Args:
        search_paths: Paths to search
        recursive: Whether to search recursively
        
    Returns:
        List of paths to connector modules
    """
    found: list[Path] = []
    
    for search_path in search_paths:
        path = Path(search_path).resolve()
        
        if not path.exists():
            logger.warning(f"Search path does not exist: {path}")
            continue
        
        if path.is_file():
            # Single file - check if it's a connector
            if _is_connector_file(path):
                found.append(path.parent)
            continue
        
        # Directory - search for connectors
        if recursive:
            patterns = ["**/connector.py", "**/connector.json", "**/CONNECTOR.md"]
            for pattern in patterns:
                for match in path.glob(pattern):
                    connector_dir = match.parent
                    if connector_dir not in found:
                        found.append(connector_dir)
        else:
            # Non-recursive - check direct children
            for child in path.iterdir():
                if child.is_dir():
                    connector_py = child / "connector.py"
                    connector_json = child / "connector.json"
                    connector_md = child / "CONNECTOR.md"
                    if connector_py.exists() or connector_json.exists() or connector_md.exists():
                        if child not in found:
                            found.append(child)
    
    return found


def _is_connector_file(path: Path) -> bool:
    """Check if a file is likely a connector module."""
    if path.suffix == ".py":
        try:
            content = path.read_text()
            indicators = [
                "CentrisConnector",
                "CentrisPluginConnector",
                "centris_sdk",
                "@connector.capability",
            ]
            return any(ind in content for ind in indicators)
        except Exception:
            return False
    
    if path.name == "CONNECTOR.md":
        return True
    
    return False


def discover_connectors(
    search_paths: list[str | Path] | str | Path,
    recursive: bool = True,
) -> list[DiscoveredConnector]:
    """
    Discover connectors in given paths.
    
    Args:
        search_paths: Path(s) to search for connectors
        recursive: Whether to search recursively
        
    Returns:
        List of discovered connector information
    """
    if isinstance(search_paths, (str, Path)):
        search_paths = [search_paths]
    
    connector_paths = find_connector_modules(search_paths, recursive)
    discovered: list[DiscoveredConnector] = []
    
    for path in connector_paths:
        try:
            info = _get_connector_info(path)
            if info:
                discovered.append(info)
        except Exception as e:
            logger.warning(f"Failed to get connector info from {path}: {e}")
    
    return discovered


def _get_connector_info(path: Path) -> Optional[DiscoveredConnector]:
    """Get connector information from a directory."""
    # Try connector.json first
    connector_json = path / "connector.json"
    if connector_json.exists():
        try:
            with open(connector_json) as f:
                data = json.load(f)
            
            return DiscoveredConnector(
                id=data.get("id", path.name),
                name=data.get("name", path.name),
                path=path,
                version=data.get("version", "1.0.0"),
                description=data.get("description", ""),
                source="filesystem",
                format="standard",
                metadata=data,
            )
        except Exception as e:
            logger.warning(f"Failed to parse {connector_json}: {e}")
    
    # Try CONNECTOR.md (simplified format)
    connector_md = path / "CONNECTOR.md"
    if connector_md.exists():
        try:
            data = parse_connector_md(connector_md)
            
            return DiscoveredConnector(
                id=data.get("id", path.name),
                name=data.get("name", path.name),
                path=path,
                version=data.get("version", "1.0.0"),
                description=data.get("description", ""),
                source="filesystem",
                format="connector_md",
                metadata=data,
            )
        except Exception as e:
            logger.warning(f"Failed to parse {connector_md}: {e}")
    
    # Try to extract from connector.py
    connector_py = path / "connector.py"
    if connector_py.exists():
        try:
            # Quick parse without full import
            content = connector_py.read_text()
            
            # Extract ID from CentrisConnector call
            connector_id = path.name
            name = path.name.replace("-", " ").replace("_", " ").title()
            
            # Look for connector_id= or id= patterns
            id_match = re.search(r'connector_id\s*=\s*["\']([^"\']+)["\']', content)
            if id_match:
                connector_id = id_match.group(1)
            
            name_match = re.search(r'name\s*=\s*["\']([^"\']+)["\']', content)
            if name_match:
                name = name_match.group(1)
            
            desc_match = re.search(r'description\s*=\s*["\']([^"\']+)["\']', content)
            description = desc_match.group(1) if desc_match else ""
            
            return DiscoveredConnector(
                id=connector_id,
                name=name,
                path=path,
                version="1.0.0",
                description=description,
                source="filesystem",
                format="standard",
            )
        except Exception as e:
            logger.warning(f"Failed to parse {connector_py}: {e}")
    
    return None


def discover_installed_packages() -> list[DiscoveredConnector]:
    """
    Discover connectors from installed pip packages.
    
    Looks for packages with:
    - Name starting with "centris-connector-"
    - Entry point in "centris.connectors" group
    """
    discovered: list[DiscoveredConnector] = []
    
    try:
        from importlib.metadata import entry_points
        
        # Python 3.10+ style
        eps = entry_points(group="centris.connectors")
        
        for ep in eps:
            try:
                connector = ep.load()
                discovered.append(DiscoveredConnector(
                    id=connector.id if hasattr(connector, "id") else ep.name,
                    name=connector.name if hasattr(connector, "name") else ep.name,
                    path=Path(ep.value.split(":")[0]),
                    version=getattr(connector, "version", "1.0.0") or "1.0.0",
                    description=getattr(connector, "description", "") or "",
                    source="package",
                    metadata={"entry_point": ep.name},
                ))
            except Exception as e:
                logger.warning(f"Failed to load entry point {ep.name}: {e}")
    
    except Exception as e:
        logger.debug(f"Failed to discover from entry points: {e}")
    
    # Also check for centris-connector-* packages
    try:
        import pkg_resources
        
        for pkg in pkg_resources.working_set:
            if pkg.project_name.startswith("centris-connector-"):
                try:
                    module_name = pkg.project_name.replace("-", "_")
                    module = importlib.import_module(module_name)
                    
                    if hasattr(module, "connector"):
                        connector = module.connector
                        discovered.append(DiscoveredConnector(
                            id=connector.id,
                            name=connector.name,
                            path=Path(pkg.location) / module_name,
                            version=pkg.version,
                            description=getattr(connector, "description", "") or "",
                            source="package",
                            metadata={"package": pkg.project_name},
                        ))
                except Exception as e:
                    logger.warning(f"Failed to load package {pkg.project_name}: {e}")
    
    except ImportError:
        pass
    
    return discovered
