"""
Centris CLI Templates

Extracted connector templates for clean code organization.

Templates are stored as separate files and loaded dynamically.
This keeps init_cmd.py clean and makes templates easier to maintain.

Usage:
    from centris_sdk.cli.templates import load_template, get_template_names
    
    # Load a template
    content = load_template("basic", "connector.py", context={...})
    
    # List available templates
    templates = get_template_names()  # ["basic", "browser", "api", "desktop"]
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, List, Optional

# Template directory
TEMPLATES_DIR = Path(__file__).parent


def get_template_names() -> List[str]:
    """
    Get list of available connector types.
    
    Note: ALL connectors use modular structure (services/ directory).
    The type determines execution method, not structure.
    
    Returns:
        List of connector types: ["browser", "api", "desktop", "basic"]
    """
    return ["browser", "api", "desktop", "basic"]


def get_template_path(template_name: str, filename: str) -> Path:
    """
    Get the path to a template file.
    
    Args:
        template_name: Template name (e.g., "basic", "browser")
        filename: File name within template (e.g., "connector.py.template")
        
    Returns:
        Path to the template file
    """
    return TEMPLATES_DIR / template_name / filename


def load_template(
    template_name: str,
    filename: str,
    context: Optional[Dict[str, Any]] = None,
) -> str:
    """
    Load and render a template file.
    
    Args:
        template_name: Template name (e.g., "basic", "browser")
        filename: File name within template (e.g., "connector.py.template")
        context: Dictionary of variables to substitute
        
    Returns:
        Rendered template content
        
    Raises:
        FileNotFoundError: If template file doesn't exist
    """
    template_path = get_template_path(template_name, filename)
    
    if not template_path.exists():
        raise FileNotFoundError(f"Template not found: {template_path}")
    
    content = template_path.read_text()
    
    # Render with context
    if context:
        content = render_template(content, context)
    
    return content


def render_template(template: str, context: Dict[str, Any]) -> str:
    """
    Render a template string with the given context.
    
    Uses {variable} syntax for substitution.
    Handles {{escaped}} braces by preserving them.
    
    Args:
        template: Template string
        context: Dictionary of variables
        
    Returns:
        Rendered string
    """
    # First, temporarily replace escaped braces
    template = template.replace("{{", "\x00LBRACE\x00")
    template = template.replace("}}", "\x00RBRACE\x00")
    
    # Substitute variables
    for key, value in context.items():
        template = template.replace(f"{{{key}}}", str(value))
    
    # Restore escaped braces as single braces (for Python f-strings, dicts, etc.)
    template = template.replace("\x00LBRACE\x00", "{")
    template = template.replace("\x00RBRACE\x00", "}")
    
    return template


def load_common_template(filename: str, context: Optional[Dict[str, Any]] = None) -> str:
    """
    Load a common template (shared across all connector types).
    
    Args:
        filename: File name (e.g., "gitignore.template", "pyproject.toml.template")
        context: Dictionary of variables to substitute
        
    Returns:
        Rendered template content
    """
    return load_template("common", filename, context)


# =============================================================================
# Helper Functions for Template Context
# =============================================================================

def to_module_name(connector_id: str) -> str:
    """Convert connector ID to valid Python module name."""
    return connector_id.replace("-", "_").replace(".", "_").lower()


def to_title(connector_id: str) -> str:
    """Convert connector ID to title case name."""
    return " ".join(
        word.capitalize() 
        for word in connector_id.replace("-", " ").replace("_", " ").split()
    )


def to_class_name(connector_id: str) -> str:
    """Convert connector ID to PascalCase class name."""
    return "".join(
        word.capitalize() 
        for word in connector_id.replace("-", "_").split("_")
    )


def to_python_id(connector_id: str) -> str:
    """Convert connector ID to valid Python identifier (for function names)."""
    return connector_id.replace("-", "_").replace(".", "_").lower()


def extract_domain(connector_id: str) -> str:
    """Extract likely domain from connector ID."""
    base = connector_id.replace("-connector", "").replace("_connector", "")
    return f"{base}.com"


def build_template_context(
    connector_id: str,
    name: Optional[str] = None,
    description: str = "A Centris connector",
    category: str = "utilities",
    base_url: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Build a complete template context from basic inputs.
    
    Args:
        connector_id: The connector ID (e.g., "my-connector")
        name: Display name (defaults to title case of ID)
        description: Connector description
        category: Primary category
        base_url: Base URL for browser connectors
        
    Returns:
        Dictionary with all template variables
    """
    domain = extract_domain(connector_id)
    
    return {
        "id": connector_id,
        "connector_id": connector_id,
        "python_id": to_python_id(connector_id),
        "name": name or to_title(connector_id),
        "description": description,
        "category": category,
        "tag": connector_id.split("-")[0] if "-" in connector_id else connector_id,
        "module_name": to_module_name(connector_id),
        "class_name": to_class_name(connector_id),
        "domain": domain,
        "domain_pattern": domain.replace(".", r"\\."),
        "base_url": base_url or f"https://{domain}",
    }


# =============================================================================
# Exports
# =============================================================================

__all__ = [
    # Core functions
    "load_template",
    "load_common_template",
    "render_template",
    "get_template_names",
    "get_template_path",
    # Helpers
    "to_module_name",
    "to_title",
    "to_class_name",
    "to_python_id",
    "extract_domain",
    "build_template_context",
    # Constants
    "TEMPLATES_DIR",
]
