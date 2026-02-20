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
# CLI Command
# =============================================================================

@click.command("init")
@click.argument("connector_id", required=False)
@click.option("--name", "-n", help="Display name for the connector")
@click.option("--description", "-d", default="A Centris connector", help="Connector description")
@click.option("--category", "-c", default="utilities", help="Primary category")
@click.option("--template", "-t", type=click.Choice(["browser", "api", "desktop", "basic"]), default="browser", help="Connector type (all use modular structure)")
@click.option("--url", "-u", help="Base URL for browser connectors (e.g., https://app.example.com)")
@click.option("--output", "-o", type=click.Path(), help="Output directory (default: ./<connector_id>)")
@click.option("--interactive", "-i", is_flag=True, help="Run interactive wizard")
@click.pass_context
def init_command(
    ctx: click.Context,
    connector_id: Optional[str],
    name: Optional[str],
    description: str,
    category: str,
    template: str,
    url: Optional[str],
    output: Optional[str],
    interactive: bool,
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
        
    """
    # Get deps from context or create default
    deps = ctx.obj.get("deps") if ctx.obj else None
    if deps is None:
        deps = create_default_deps(verbose=ctx.obj.get("verbose", False) if ctx.obj else False)
    
    console = deps.console
    
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
        console.echo(f"  {theme.muted('2.')} Implement live action steps in services/browser_service.py")
        console.echo(f"     {theme.muted('(Use Action API + live node IDs from browser snapshots)')}")
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
