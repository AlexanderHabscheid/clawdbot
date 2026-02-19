"""
Centris SDK CLI - Init Command

Initialize a new connector project with scaffolding.
Supports both flag-based and interactive wizard modes.

REFACTORED: Templates extracted to templates/ directory.
This file is now ~200 lines instead of ~1000 lines.
"""

import click
import re
from pathlib import Path
from typing import Any, Dict, Optional

from centris_sdk.cli.theme import theme, styled_command
from centris_sdk.cli.progress import Spinner
from centris_sdk.cli.wizard import Wizard, WizardCancelledError
from centris_sdk.cli.deps import CLIDeps, create_default_deps
from centris_sdk.cli.errors import CentrisCLIError, ValidationError
from centris_sdk.cli.templates import (
    load_template,
    load_common_template,
    build_template_context,
    to_title,
    extract_domain,
)


# =============================================================================
# Validation
# =============================================================================

def validate_connector_id(value: str) -> Optional[str]:
    """Validate connector ID format."""
    if not value:
        return "Connector ID is required"
    if not re.match(r'^[a-z][a-z0-9-]*$', value):
        return "ID must start with a letter and contain only lowercase letters, numbers, and hyphens"
    if len(value) < 3:
        return "ID must be at least 3 characters"
    if len(value) > 50:
        return "ID must be 50 characters or less"
    return None


# =============================================================================
# Interactive Wizard
# =============================================================================

def run_interactive_wizard() -> dict:
    """
    Run the interactive connector creation wizard.
    
    Returns:
        Dictionary with connector configuration
    """
    wiz = Wizard("Create a New Connector")
    wiz.set_total_steps(4)
    wiz.intro()
    
    # Step 1: Basic info
    wiz.step("Basic Information")
    
    connector_id = wiz.text(
        "Connector ID",
        placeholder="my-connector",
        validate=validate_connector_id,
    )
    
    display_name = wiz.text(
        "Display name",
        default=to_title(connector_id),
    )
    
    description = wiz.text(
        "Description",
        default="A Centris connector",
    )
    
    # Step 2: Template selection
    wiz.step("Choose Template")
    
    wiz.note(
        "Connector type determines execution method:\n\n"
        "• Browser - Compiled recipe browser automation (FASTEST)\n"
        "• API - Direct API integration with OAuth\n"
        "• Desktop - Desktop app automation\n"
        "• Basic - Simple backend connector\n\n"
        "All connectors use modular structure (services/ directory)\n"
        "to prevent file bloat and keep code maintainable.",
        "Connector Types"
    )
    
    template = wiz.select(
        "Connector Type",
        options=[
            {"value": "browser", "label": "Browser", "hint": "Web app automation via browser"},
            {"value": "api", "label": "API", "hint": "Direct API calls with auth"},
            {"value": "desktop", "label": "Desktop", "hint": "Desktop app automation"},
            {"value": "basic", "label": "Basic", "hint": "Simple backend connector"},
        ],
        default="browser",
    )
    
    # Step 3: Template-specific config
    wiz.step("Configuration")
    
    base_url = None
    if template == "browser":
        base_url = wiz.text(
            "Base URL",
            placeholder="https://app.example.com",
            default=f"https://{extract_domain(connector_id)}",
        )
    
    category = wiz.select(
        "Category",
        options=[
            {"value": "productivity", "label": "Productivity", "hint": "Task management, notes, etc."},
            {"value": "communication", "label": "Communication", "hint": "Email, chat, messaging"},
            {"value": "social", "label": "Social", "hint": "Social media platforms"},
            {"value": "developer", "label": "Developer", "hint": "Dev tools, APIs, CI/CD"},
            {"value": "business", "label": "Business", "hint": "CRM, ERP, finance"},
            {"value": "utilities", "label": "Utilities", "hint": "General purpose tools"},
        ],
        default="utilities",
    )
    
    # Step 4: Confirmation
    wiz.step("Confirm")
    
    print(f"\n  {theme.muted('ID:')} {theme.accent(connector_id)}")
    print(f"  {theme.muted('Name:')} {display_name}")
    print(f"  {theme.muted('Template:')} {template}")
    print(f"  {theme.muted('Category:')} {category}")
    if base_url:
        print(f"  {theme.muted('URL:')} {base_url}")
    print()
    
    if not wiz.confirm("Create connector with these settings?"):
        raise WizardCancelledError("User declined")
    
    wiz.outro(f"Creating {display_name}...")
    
    return {
        "connector_id": connector_id,
        "name": display_name,
        "description": description,
        "template": template,
        "category": category,
        "url": base_url,
    }


# =============================================================================
# Connector Creation
# =============================================================================

def create_connector(
    deps: CLIDeps,
    connector_id: str,
    name: Optional[str] = None,
    description: str = "A Centris connector",
    category: str = "utilities",
    template: str = "basic",
    url: Optional[str] = None,
    output: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Core connector creation logic with injectable dependencies.
    
    Uses extracted templates from templates/ directory.
    """
    file_system = deps.file_system
    verbose = deps.verbose
    
    # Determine output directory
    output_dir = Path(output) if output else Path.cwd() / connector_id
    
    # Build template context
    context = build_template_context(
        connector_id=connector_id,
        name=name,
        description=description,
        category=category,
        base_url=url,
    )
    
    # Create with spinner
    with Spinner(f"Creating {connector_id}...") as spin:
        # Create directory
        file_system.mkdir(output_dir, parents=True, exist_ok=True)
        
        spin.update("Generating files...")
        
        # Load and write template files
        # ALL connectors use modular structure - this is the SDK standard
        try:
            spin.update("Creating modular structure...")
            
            # 1. ALWAYS create modular base structure first
            # Base class file (shared utilities)
            base_content = load_template("modular", "base.py.template", context)
            file_system.write_text(output_dir / "base.py", base_content)
            
            # Services directory (where actual implementation lives)
            services_dir = output_dir / "services"
            file_system.mkdir(services_dir, parents=True, exist_ok=True)
            
            # Services __init__.py (registry)
            services_init = load_template("modular", "services_init.py.template", context)
            file_system.write_text(services_dir / "__init__.py", services_init)
            
            # 2. Add the default service implementation.
            # Keep scaffold deterministic and immediately runnable across all templates.
            service_content = load_template("modular", "service1.py.template", context)
            file_system.write_text(services_dir / "service1.py", service_content)
            
            # 3. Main connector.py (thin coordinator - ALWAYS modular)
            connector_content = load_template("modular", "connector.py.template", context)
            file_system.write_text(output_dir / "connector.py", connector_content)
            
            # 4. Connector manifest
            json_content = load_template("modular", "connector.json.template", context)
            # Add connector type to the manifest
            json_content = json_content.replace(
                '"type": "modular"',
                f'"type": "{template}"'
            )
            file_system.write_text(output_dir / "connector.json", json_content)
            
            # 5. README
            readme_content = load_template("modular", "README.md.template", context)
            file_system.write_text(output_dir / "README.md", readme_content)
            
        except FileNotFoundError as e:
            raise CentrisCLIError(
                f"Template file not found: {e}",
                hint=f"Template '{template}' may be incomplete. Try 'browser' template.",
            )
        
        # Common files (shared across all templates)
        gitignore = load_common_template("gitignore.template", context)
        file_system.write_text(output_dir / ".gitignore", gitignore)
        
        pyproject = load_common_template("pyproject.toml.template", context)
        file_system.write_text(output_dir / "pyproject.toml", pyproject)
        
        init_content = load_common_template("init.py.template", context)
        file_system.write_text(output_dir / "__init__.py", init_content)
        
        if verbose:
            spin.update("Files created")
        
        spin.success(f"Created {context['name']}")
    
    return {
        "success": True,
        "connector_id": connector_id,
        "name": context["name"],
        "output_dir": str(output_dir),
        "template": template,
    }


# =============================================================================
# Create Connector from Elements JSON
# =============================================================================

def create_connector_from_elements(
    deps: CLIDeps,
    connector_id: str,
    elements_data: Dict[str, Any],
    name: Optional[str] = None,
    description: str = "A Centris connector with pre-mapped elements",
    output: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Create a connector project from SDK elements export JSON.
    
    This generates a connector with pre-mapped DOM selectors based on
    elements extracted from a webpage via the Chrome extension.
    """
    from centris_sdk.cli.progress import Spinner
    
    file_system = deps.file_system
    
    # Determine output directory
    output_dir = Path(output) if output else Path.cwd() / connector_id
    
    # Extract info from elements data
    connector_info = elements_data.get("connector", {})
    element_mapping = elements_data.get("elementMapping", {})
    meta = elements_data.get("_meta", {})
    
    final_name = name or connector_info.get("name", to_title(connector_id))
    url_patterns = connector_info.get("urlPatterns", [])
    base_url = f"https://{url_patterns[0]}" if url_patterns else ""
    
    with Spinner(f"Creating {connector_id} from elements...") as spin:
        # Create directory structure
        file_system.mkdir(output_dir, parents=True, exist_ok=True)
        services_dir = output_dir / "services"
        file_system.mkdir(services_dir, parents=True, exist_ok=True)
        
        spin.update("Generating connector files...")
        
        # Generate element selectors class
        nav = element_mapping.get("navigation", {})
        typeable = element_mapping.get("typeableFields", {})
        clickable = element_mapping.get("clickableButtons", {})
        selectable = element_mapping.get("selectableFields", {})
        
        # Build selectors code
        selectors_code = f'''"""
{final_name} Connector for Centris

Pre-mapped DOM elements from Chrome extension.
Generated from: {meta.get("url", "unknown")}
Export time: {meta.get("exportedAt", "unknown")}

Usage:
    centris elements export --sdk -o elements.json
    centris init {connector_id} --from-elements elements.json
"""

import logging
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)


# =============================================================================
# Pre-Mapped Element IDs (from Chrome Extension "Show Elements")
# =============================================================================

class {to_class_name(connector_id)}Selectors:
    """
    Pre-mapped element IDs from Chrome extension.
    
    These IDs can be used with click_node(node_id=N) for fast automation.
    No LLM analysis needed - we know exactly where to click.
    """
    
    # Navigation elements
'''
        for key, value in nav.items():
            selectors_code += f"    NAV_{key.upper()} = {value.get('id')}  # {value.get('label', key)}\n"
        
        selectors_code += "\n    # Typeable fields (inputs, textareas)\n"
        for key, value in typeable.items():
            selectors_code += f"    FIELD_{key.upper()} = {value.get('id')}  # {value.get('label', key)}\n"
        
        selectors_code += "\n    # Clickable buttons\n"
        for key, value in clickable.items():
            selectors_code += f"    BTN_{key.upper()} = {value.get('id')}  # {value.get('label', key)}\n"
        
        selectors_code += "\n    # Selectable elements (dropdowns, etc.)\n"
        for key, value in selectable.items():
            selectors_code += f"    SELECT_{key.upper()} = {value.get('id')}  # {value.get('label', key)}\n"
        
        # Add URL patterns
        selectors_code += f'''

class {to_class_name(connector_id)}URLs:
    """URL patterns for {final_name}."""
    
    BASE = "{base_url}"
    
    @classmethod
    def is_target_site(cls, url: str) -> bool:
        return any(pattern in url for pattern in {url_patterns!r})


# =============================================================================
# Field Mapping: Your Data Key → Element ID
# =============================================================================

# TODO: Map your data structure to element IDs
# Example:
#   "company.name": {to_class_name(connector_id)}Selectors.FIELD_NAME,
#   "company.url": {to_class_name(connector_id)}Selectors.FIELD_URL,

FIELD_MAPPING = {{
'''
        # Add example mappings for typeable fields
        for key, value in list(typeable.items())[:5]:
            selectors_code += f'    # "{key}": {value.get("id")},  # {value.get("label", key)}\n'
        
        selectors_code += '''}


# =============================================================================
# Tool Implementations
# =============================================================================

async def fill_form(
    tool_call_id: str,
    params: Dict[str, Any],
    context: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Fill form fields using pre-mapped element IDs.
    
    Uses element IDs from Chrome extension - no LLM needed to find elements.
    """
    browser_bridge = context.get("browser_bridge") if context else None
    
    if not browser_bridge:
        return {
            "success": False,
            "error": "Browser bridge not available. Ensure Centris desktop app is running."
        }
    
    data = params.get("data", {})
    filled_count = 0
    errors = []
    
    try:
        for json_path, element_id in FIELD_MAPPING.items():
            # Get value from data
            parts = json_path.split(".")
            value = data
            for part in parts:
                if isinstance(value, dict):
                    value = value.get(part)
                else:
                    value = None
                    break
            
            if not value:
                continue
            
            try:
                await browser_bridge.click_node(node_id=element_id)
                await browser_bridge.wait(200)
                await browser_bridge.press_key("Control+a")
                await browser_bridge.wait(100)
                await browser_bridge.type_text(str(value))
                await browser_bridge.wait(300)
                filled_count += 1
            except Exception as e:
                errors.append(f"{json_path}: {str(e)}")
        
        return {
            "success": True,
            "filled_fields": filled_count,
            "errors": errors if errors else None,
        }
        
    except Exception as e:
        return {"success": False, "error": str(e)}


# =============================================================================
# Tool Definitions
# =============================================================================

@dataclass
class Tool:
    """Tool definition for Centris registry."""
    name: str
    description: str
    parameters: Dict[str, Any]
    execute: Callable
    label: Optional[str] = None
    tags: List[str] = field(default_factory=list)


class {to_class_name(connector_id)}ConnectorApi:
    """API for {final_name} connector tools."""
    
    def __init__(self):
        self._gateway_methods: Dict[str, Callable] = {{}}
        self._services: List[Any] = []
    
    def get_tools(self, context: Any = None) -> List[Tool]:
        """Return all tools."""
        return [
            Tool(
                name="{connector_id}_fill_form",
                label="Fill Form",
                description="Fill form fields using pre-mapped element IDs. Fast browser automation.",
                parameters={{
                    "type": "object",
                    "properties": {{
                        "data": {{
                            "type": "object",
                            "description": "Form data to fill"
                        }}
                    }},
                    "required": ["data"]
                }},
                execute=fill_form,
                tags=["form", "automation"]
            ),
        ]


# =============================================================================
# Connector Definition
# =============================================================================

@dataclass
class {to_class_name(connector_id)}Connector:
    """
    {final_name} connector with pre-mapped DOM elements.
    
    Generated from Chrome extension "Show Elements" export.
    """
    
    id: str = "{connector_id}"
    name: str = "{final_name}"
    version: str = "1.0.0"
    description: str = "{description}"
    
    api: {to_class_name(connector_id)}ConnectorApi = field(default_factory={to_class_name(connector_id)}ConnectorApi)
    
    url_patterns: List[str] = field(default_factory=lambda: {url_patterns!r})
    
    element_mapping: Dict[str, Any] = field(default_factory=lambda: {{
        "navigation": {nav!r},
        "typeableFields": {typeable!r},
        "clickableButtons": {clickable!r},
        "selectableFields": {selectable!r}
    }})


# Module-level export
connector = {to_class_name(connector_id)}Connector()

__all__ = ["connector", "{to_class_name(connector_id)}Connector", "{to_class_name(connector_id)}Selectors"]
'''
        
        # Write connector.py
        file_system.write_text(output_dir / "connector.py", selectors_code)
        
        # Write __init__.py
        init_content = f'''"""
{final_name} Connector for Centris

Pre-mapped DOM elements for fast browser automation.
"""

from .connector import connector, {to_class_name(connector_id)}Connector

__all__ = ["connector", "{to_class_name(connector_id)}Connector"]
'''
        file_system.write_text(output_dir / "__init__.py", init_content)
        
        # Write connector.json
        import json
        manifest = {
            "id": connector_id,
            "name": final_name,
            "description": description,
            "version": "1.0.0",
            "main": "connector.py",
            "centrisConnector": {
                "id": connector_id,
                "type": "browser",
                "categories": ["forms", "automation"],
                "authScheme": "browser_session",
                "urlPatterns": url_patterns
            },
            "tools": [
                {
                    "name": f"{connector_id}_fill_form",
                    "description": "Fill form fields using pre-mapped elements"
                }
            ],
            "elementMapping": element_mapping,
            "_meta": {
                "generatedFrom": meta.get("url", "unknown"),
                "generatedAt": meta.get("exportedAt", "unknown")
            }
        }
        file_system.write_text(output_dir / "connector.json", json.dumps(manifest, indent=2))
        
        # Write README
        readme = f'''# {final_name} Connector

Pre-mapped DOM elements for fast browser automation.

## Generated From

- URL: {meta.get("url", "unknown")}
- Exported: {meta.get("exportedAt", "unknown")}

## Element Statistics

- Navigation: {len(nav)} elements
- Typeable Fields: {len(typeable)} elements
- Clickable Buttons: {len(clickable)} elements
- Selectable: {len(selectable)} elements

## Usage

1. Map your data structure to element IDs in `FIELD_MAPPING`
2. Test with: `centris test .`
3. Publish with: `centris publish .`

## Next Steps

1. Edit `connector.py` to map form fields to your data
2. Add additional tools as needed
3. Test with real data

```bash
centris validate .
centris test .
```
'''
        file_system.write_text(output_dir / "README.md", readme)
        
        # Write .gitignore
        gitignore = "__pycache__/\n*.pyc\n.pytest_cache/\n*.egg-info/\n"
        file_system.write_text(output_dir / ".gitignore", gitignore)
        
        spin.success(f"Created {connector_id} with {len(typeable) + len(nav) + len(clickable) + len(selectable)} pre-mapped elements")
    
    return {
        "success": True,
        "connector_id": connector_id,
        "name": final_name,
        "output_dir": str(output_dir),
        "elements_count": len(typeable) + len(nav) + len(clickable) + len(selectable),
    }


def to_class_name(connector_id: str) -> str:
    """Convert connector-id to ClassName."""
    return ''.join(word.title() for word in connector_id.replace('-', '_').split('_'))


# =============================================================================
# CLI Command
# =============================================================================

@click.command("init")
@click.argument("connector_id", required=False)
@click.option("--name", "-n", help="Display name for the connector")
@click.option("--description", "-d", default="A Centris connector", help="Connector description")
@click.option("--category", "-c", default="utilities", help="Primary category")
@click.option("--template", "-t", type=click.Choice(["browser", "api", "desktop", "basic"]), default="browser", help="Connector type (all use modular structure)")
@click.option("--url", "-u", help="Base URL for browser connectors (e.g., https://app.example.com)")
@click.option("--capture-url", help="URL to capture elements from (fully automated - navigates, captures, generates)")
@click.option("--wait", "-w", type=float, default=3.0, help="Seconds to wait after page load (with --capture-url)")
@click.option("--output", "-o", type=click.Path(), help="Output directory (default: ./<connector_id>)")
@click.option("--interactive", "-i", is_flag=True, help="Run interactive wizard")
@click.option("--from-elements", "elements_file", type=click.Path(exists=True), help="Generate from elements JSON file (from 'centris elements export --sdk')")
@click.pass_context
def init_command(
    ctx: click.Context,
    connector_id: Optional[str],
    name: Optional[str],
    description: str,
    category: str,
    template: str,
    url: Optional[str],
    capture_url: Optional[str],
    wait: float,
    output: Optional[str],
    interactive: bool,
    elements_file: Optional[str],
) -> None:
    """
    Initialize a new Centris connector project.
    
    Creates a new directory with connector scaffolding including:
    - connector.py - Main connector implementation
    - connector.json - Connector metadata
    - README.md - Documentation
    - pyproject.toml - Python package configuration
    
    Templates:
    - basic: Simple API connector
    - api: API-first connector with auth
    - browser: Compiled recipe browser automation (RECOMMENDED for web apps)
    - desktop: Desktop app automation
    
    Examples:
        centris init                              Interactive wizard
        centris init slack-connector              Basic connector
        centris init gmail --template browser     Browser automation
        centris init -i                           Force interactive mode
        
    Fully Automated (RECOMMENDED for web apps):
        centris init yc-app --capture-url https://apply.ycombinator.com
        
    From Elements (manual workflow):
        centris elements export --sdk -o elements.json
        centris init my-connector --from-elements elements.json
    """
    # Get deps from context or create default
    deps = ctx.obj.get("deps") if ctx.obj else None
    if deps is None:
        deps = create_default_deps(verbose=ctx.obj.get("verbose", False) if ctx.obj else False)
    
    console = deps.console
    
    # Handle --capture-url option (fully automated: navigate + capture + generate)
    if capture_url:
        from centris_sdk.cli.elements_cmd import capture_elements_from_url, format_elements_for_export
        
        if not connector_id:
            # Extract domain for connector ID
            connector_id = extract_domain(capture_url).replace('.', '-')
        
        # Validate connector ID
        validation_error = validate_connector_id(connector_id)
        if validation_error:
            raise ValidationError(validation_error, field="connector_id")
        
        with Spinner(f"Capturing elements from {capture_url}...") as spin:
            try:
                spin.update("Navigating to URL...")
                result = capture_elements_from_url(deps, capture_url, wait_seconds=wait)
            except CentrisCLIError as e:
                spin.fail(str(e))
                raise
            
            elements = result.get('elements') or result.get('interactiveNodes') or result.get('_internalNodes') or []
            captured_url = result.get('url', capture_url)
            
            if not elements:
                spin.fail("No interactive elements found")
                console.echo(f"\n{theme.warn('!')} The page may still be loading. Try:")
                console.echo(f"  centris init {connector_id} --capture-url {capture_url} --wait 5")
                return
            
            spin.success(f"Found {len(elements)} elements")
        
        # Format for SDK and generate connector
        elements_data = format_elements_for_export(elements, captured_url, for_sdk=True)
        elements_data['connector']['id'] = connector_id
        elements_data['connector']['name'] = name or to_title(connector_id)
        
        # Determine output directory
        output_dir = Path(output) if output else Path.cwd() / connector_id
        
        with Spinner(f"Creating {connector_id}...") as spin:
            result = create_connector_from_elements(
                deps=deps,
                connector_id=connector_id,
                elements_data=elements_data,
                name=name,
                description=description,
                output=str(output_dir),
            )
            spin.success(f"Created {connector_id}")
        
        # Print next steps
        console.echo("")
        console.echo(f"  {theme.heading('Next steps:')}")
        console.echo("")
        console.echo(styled_command(f"cd {connector_id}"))
        console.echo("")
        console.echo(f"  {theme.muted('1.')} Review element mappings in connector.py")
        console.echo(f"  {theme.muted('2.')} Map form fields to your data structure")
        console.echo(f"  {theme.muted('3.')} Test your connector:")
        console.echo(styled_command("centris validate ."))
        console.echo(styled_command("centris test ."))
        return
    
    # Handle --from-elements option (generates connector from elements JSON)
    if elements_file:
        import json
        
        with open(elements_file) as f:
            elements_data = json.load(f)
        
        # Extract connector info from elements data
        if elements_data.get("_meta", {}).get("format") != "centris-sdk-connector":
            console.echo(f"{theme.error('!')} Invalid elements file format.")
            console.echo(f"  Use: centris elements export --sdk -o elements.json")
            return
        
        connector_info = elements_data.get("connector", {})
        
        # Use provided connector_id or from elements
        if not connector_id:
            connector_id = connector_info.get("id", "my-connector")
        
        if not name:
            name = connector_info.get("name")
        
        if not url:
            patterns = connector_info.get("urlPatterns", [])
            url = f"https://{patterns[0]}" if patterns else None
        
        # Always use browser template for elements-based connectors
        template = "browser"
        
        # Validate connector ID
        validation_error = validate_connector_id(connector_id)
        if validation_error:
            raise ValidationError(validation_error, field="connector_id")
        
        # Determine output directory
        output_dir = Path(output) if output else Path.cwd() / connector_id
        
        # Create the connector with element mappings
        result = create_connector_from_elements(
            deps=deps,
            connector_id=connector_id,
            elements_data=elements_data,
            name=name,
            description=description,
            output=str(output_dir),
        )
        
        # Print next steps
        console.echo("")
        console.echo(f"  {theme.heading('Next steps:')}")
        console.echo("")
        console.echo(styled_command(f"cd {connector_id}"))
        console.echo("")
        console.echo(f"  {theme.muted('1.')} Review element mappings in connector.py")
        console.echo(f"  {theme.muted('2.')} Map form fields to your data structure")
        console.echo(f"  {theme.muted('3.')} Test your connector:")
        console.echo(styled_command("centris validate ."))
        console.echo(styled_command("centris test ."))
        return
    
    # Run interactive wizard if no connector_id or --interactive flag
    if interactive or connector_id is None:
        try:
            config = run_interactive_wizard()
            connector_id = config["connector_id"]
            name = config["name"]
            description = config["description"]
            template = config["template"]
            category = config["category"]
            url = config.get("url")
        except WizardCancelledError:
            console.echo(f"\n{theme.warn('!')} Setup cancelled.")
            return
        except KeyboardInterrupt:
            console.echo(f"\n{theme.warn('!')} Aborted.")
            return
    
    # Validate connector ID
    validation_error = validate_connector_id(connector_id)
    if validation_error:
        raise ValidationError(validation_error, field="connector_id")
    
    # Determine output directory
    output_dir = Path(output) if output else Path.cwd() / connector_id
    
    # Check if directory exists
    if output_dir.exists():
        from centris_sdk.cli.wizard import confirm as wizard_confirm
        if not wizard_confirm(f"Directory '{output_dir}' already exists. Overwrite?", default=False):
            console.echo(f"{theme.warn('!')} Aborted.")
            return
    
    # Create the connector
    result = create_connector(
        deps=deps,
        connector_id=connector_id,
        name=name,
        description=description,
        category=category,
        template=template,
        url=url,
        output=output,
    )
    
    # Print next steps - all connectors use modular structure
    console.echo("")
    console.echo(f"  {theme.heading('Next steps:')}")
    console.echo("")
    console.echo(styled_command(f"cd {connector_id}"))
    console.echo("")
    console.echo(f"  {theme.muted('1.')} Implement tools in services/ directory")
    console.echo(f"     {theme.muted('(Each file <300 lines, <5 tools per service)')}")
    
    if template == "browser":
        console.echo("")
        console.echo(f"  {theme.muted('2.')} Update DOM selectors in services/browser_service.py")
        console.echo(f"     {theme.muted('(Use DevTools → F12 → Right-click → Copy selector)')}")
    elif template == "api":
        console.echo("")
        console.echo(f"  {theme.muted('2.')} Add API client code in services/api_service.py")
    
    console.echo("")
    console.echo(f"  {theme.muted('3.')} Register new services in services/__init__.py")
    console.echo("")
    console.echo(f"  {theme.muted('4.')} Test your connector:")
    console.echo(styled_command("centris validate ."))
    
    console.echo("")
    console.echo(styled_command("centris validate ."))
    console.echo(styled_command("centris serve ."))
    console.echo("")
