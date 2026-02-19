"""
Centris SDK Connector Loader

Loads connectors from various sources (filesystem, packages, registry).
"""

import sys
import logging
import importlib
import importlib.util
from pathlib import Path
from typing import Any, Optional
from dataclasses import dataclass, field

from centris_sdk.loader.discovery import (
    discover_connectors,
    discover_installed_packages,
    DiscoveredConnector,
)


logger = logging.getLogger("centris.loader")


@dataclass
class LoadedConnector:
    """A loaded connector with its module."""
    
    connector: Any  # CentrisConnector or CentrisPluginConnector
    module: Any
    source: DiscoveredConnector


class ConnectorLoader:
    """
    Loads connectors from various sources.
    
    Features:
    - Load from file paths
    - Load from installed packages
    - Auto-discovery in search paths
    - Caching of loaded connectors
    
    Example:
        loader = ConnectorLoader()
        loader.add_search_path("./connectors")
        
        # Discover all connectors
        connectors = loader.discover_all()
        
        # Load specific connector
        slack = await loader.load("slack")
    """
    
    def __init__(
        self,
        search_paths: Optional[list[str | Path]] = None,
        auto_discover_packages: bool = True,
    ):
        self._search_paths: list[Path] = []
        self._discovered: dict[str, DiscoveredConnector] = {}
        self._loaded: dict[str, LoadedConnector] = {}
        self._auto_discover_packages = auto_discover_packages
        
        if search_paths:
            for path in search_paths:
                self.add_search_path(path)
    
    def add_search_path(self, path: str | Path) -> None:
        """Add a path to search for connectors."""
        resolved = Path(path).resolve()
        if resolved not in self._search_paths:
            self._search_paths.append(resolved)
            # Clear discovery cache
            self._discovered.clear()
    
    def discover_all(self, refresh: bool = False) -> list[DiscoveredConnector]:
        """
        Discover all available connectors.
        
        Args:
            refresh: Force re-discovery even if cached
            
        Returns:
            List of discovered connectors
        """
        if self._discovered and not refresh:
            return list(self._discovered.values())
        
        self._discovered.clear()
        
        # Discover from search paths
        if self._search_paths:
            for discovered in discover_connectors(self._search_paths):
                self._discovered[discovered.id] = discovered
        
        # Discover from installed packages
        if self._auto_discover_packages:
            for discovered in discover_installed_packages():
                if discovered.id not in self._discovered:
                    self._discovered[discovered.id] = discovered
        
        logger.info(f"Discovered {len(self._discovered)} connectors")
        return list(self._discovered.values())
    
    def get_discovered(self, connector_id: str) -> Optional[DiscoveredConnector]:
        """Get discovery info for a connector."""
        if not self._discovered:
            self.discover_all()
        return self._discovered.get(connector_id)
    
    async def load(self, connector_id: str) -> Optional[Any]:
        """
        Load a connector by ID.
        
        Args:
            connector_id: ID of the connector to load
            
        Returns:
            Loaded connector instance or None
        """
        # Check if already loaded
        if connector_id in self._loaded:
            return self._loaded[connector_id].connector
        
        # Find connector
        discovered = self.get_discovered(connector_id)
        if not discovered:
            logger.warning(f"Connector not found: {connector_id}")
            return None
        
        # Load connector
        loaded = await self._load_connector(discovered)
        if loaded:
            self._loaded[connector_id] = loaded
            return loaded.connector
        
        return None
    
    async def load_from_path(self, path: str | Path) -> Optional[Any]:
        """
        Load a connector from a specific path.
        
        Args:
            path: Path to connector directory or file
            
        Returns:
            Loaded connector instance or None
        """
        path = Path(path).resolve()
        
        # Create discovery info
        discovered = DiscoveredConnector(
            id=path.name,
            name=path.name,
            path=path if path.is_dir() else path.parent,
            source="direct",
        )
        
        loaded = await self._load_connector(discovered)
        if loaded:
            self._loaded[loaded.connector.id] = loaded
            return loaded.connector
        
        return None
    
    async def _load_connector(
        self,
        discovered: DiscoveredConnector,
    ) -> Optional[LoadedConnector]:
        """Load a connector from discovery info."""
        path = discovered.path
        
        # Determine module to load
        connector_py = path / "connector.py"
        if not connector_py.exists():
            # Try __init__.py
            init_py = path / "__init__.py"
            if init_py.exists():
                connector_py = init_py
            else:
                logger.error(f"No connector module found in {path}")
                return None
        
        try:
            # Add path to sys.path
            parent_path = str(path.parent)
            if parent_path not in sys.path:
                sys.path.insert(0, parent_path)
            
            # Import module
            module_name = f"centris_connector_{discovered.id.replace('-', '_')}"
            spec = importlib.util.spec_from_file_location(module_name, connector_py)
            
            if spec is None or spec.loader is None:
                logger.error(f"Cannot create module spec for {connector_py}")
                return None
            
            module = importlib.util.module_from_spec(spec)
            sys.modules[module_name] = module
            spec.loader.exec_module(module)
            
            # Find connector export
            connector = None
            
            if hasattr(module, "connector"):
                connector = module.connector
            elif hasattr(module, "plugin"):
                connector = module.plugin
            elif hasattr(module, "default"):
                connector = module.default
            else:
                # Look for CentrisConnector instances
                for name in dir(module):
                    obj = getattr(module, name)
                    if hasattr(obj, "card") or hasattr(obj, "capabilities"):
                        connector = obj
                        break
            
            if connector is None:
                logger.error(f"No connector export found in {connector_py}")
                return None
            
            # Update discovered info with actual connector data
            discovered.id = connector.id if hasattr(connector, "id") else discovered.id
            discovered.name = connector.name if hasattr(connector, "name") else discovered.name
            
            logger.info(f"Loaded connector: {discovered.id} from {path}")
            
            return LoadedConnector(
                connector=connector,
                module=module,
                source=discovered,
            )
        
        except Exception as e:
            logger.error(f"Failed to load connector from {path}: {e}")
            return None
    
    def get_loaded(self, connector_id: str) -> Optional[Any]:
        """Get a loaded connector by ID."""
        loaded = self._loaded.get(connector_id)
        return loaded.connector if loaded else None
    
    def list_loaded(self) -> list[str]:
        """List IDs of all loaded connectors."""
        return list(self._loaded.keys())
    
    def unload(self, connector_id: str) -> bool:
        """
        Unload a connector.
        
        Args:
            connector_id: ID of connector to unload
            
        Returns:
            True if unloaded, False if not found
        """
        if connector_id in self._loaded:
            del self._loaded[connector_id]
            logger.info(f"Unloaded connector: {connector_id}")
            return True
        return False
    
    async def reload(self, connector_id: str) -> Optional[Any]:
        """
        Reload a connector.
        
        Args:
            connector_id: ID of connector to reload
            
        Returns:
            Reloaded connector or None
        """
        self.unload(connector_id)
        return await self.load(connector_id)
