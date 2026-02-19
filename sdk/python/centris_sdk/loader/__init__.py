"""
Centris SDK Loader Module

Provides connector discovery and loading functionality.

Features:
- Auto-discover connectors from packages
- Load from file paths
- Load from pip packages
- Registry lookup

Example:
    from centris_sdk.loader import ConnectorLoader, discover_connectors
    
    # Discover in workspace
    connectors = discover_connectors("./connectors")
    
    # Use loader
    loader = ConnectorLoader()
    loader.add_search_path("./my-connectors")
    
    connector = await loader.load("slack")
"""

from centris_sdk.loader.discovery import discover_connectors, find_connector_modules
from centris_sdk.loader.loader import ConnectorLoader

__all__ = [
    "ConnectorLoader",
    "discover_connectors",
    "find_connector_modules",
]
