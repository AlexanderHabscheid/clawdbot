"""
Bundled Example Connectors

These examples show complete, working patterns for building Centris connectors.
They are included in the SDK for easy reference.

Usage:
    from centris_sdk.examples import TodoAppConnector
    from centris_sdk.examples import get_example_path
    
    # Get path to example source files
    example_dir = get_example_path("todoapp")
"""

import os
from pathlib import Path

# Import example connectors
from centris_sdk.examples.todoapp import connector as TodoAppConnector


def get_example_path(example_name: str) -> Path:
    """Get the file path to an example connector.
    
    Useful for copying example code or examining source.
    
    Args:
        example_name: Name of the example (e.g., "todoapp")
        
    Returns:
        Path to the example directory
    """
    examples_dir = Path(__file__).parent
    example_path = examples_dir / example_name
    
    if not example_path.exists():
        available = [d.name for d in examples_dir.iterdir() if d.is_dir() and not d.name.startswith("_")]
        raise ValueError(f"Example '{example_name}' not found. Available: {available}")
    
    return example_path


def list_examples() -> list[str]:
    """List available example connectors."""
    examples_dir = Path(__file__).parent
    return [
        d.name for d in examples_dir.iterdir() 
        if d.is_dir() and not d.name.startswith("_") and (d / "connector.py").exists()
    ]


__all__ = [
    "TodoAppConnector",
    "get_example_path",
    "list_examples",
]
