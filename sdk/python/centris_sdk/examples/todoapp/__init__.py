"""
TodoApp Connector Example

A complete, working example of a Centris browser automation connector.
Use this as a reference for building your own connectors.

Usage:
    from centris_sdk.examples.todoapp import connector
    
    # Get available tools
    tools = connector.api.get_tools()
    
    # See legacy selector targets (prefer runtime node IDs in new connectors)
    from centris_sdk.examples.todoapp import TodoAppSelectors
    print(TodoAppSelectors.NEW_TASK_INPUT)
"""

from centris_sdk.examples.todoapp.connector import (
    connector,
    TodoAppConnector,
    TodoAppConnectorApi,
    TodoAppSelectors,
    TodoAppURLs,
)

__all__ = [
    "connector",
    "TodoAppConnector",
    "TodoAppConnectorApi", 
    "TodoAppSelectors",
    "TodoAppURLs",
]
