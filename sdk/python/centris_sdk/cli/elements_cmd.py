"""
Centris SDK CLI - Elements Command

Export interactive elements from browser pages for connector development.

Fully automated - no manual clicking in extension popup required.

Usage:
    # Capture from URL (fully automated)
    centris elements capture https://example.com -o elements.json
    
    # Export from current browser page (requires backend running)
    centris elements export -o elements.json
    
    # Generate connector directly from URL
    centris elements generate my-connector --url https://example.com
    
    # List elements in terminal
    centris elements list
"""

import asyncio
import click
import json
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from centris_sdk.cli.theme import theme
from centris_sdk.cli.progress import Spinner
from centris_sdk.cli.deps import CLIDeps, create_default_deps
from centris_sdk.cli.errors import CentrisCLIError


# =============================================================================
# Backend Communication
# =============================================================================

def get_backend_url(deps: CLIDeps) -> str:
    """Get the backend URL from config or default."""
    return deps.config_loader.get("CENTRIS_BACKEND_URL", "http://127.0.0.1:5001")


def fetch_elements_from_backend(deps: CLIDeps, timeout: int = 10) -> Dict[str, Any]:
    """
    Fetch interactive elements from the Centris backend.
    
    The backend communicates with the Chrome extension to get the current page's
    interactive elements (same data as "Show Elements" in the popup).
    """
    import requests
    
    backend_url = get_backend_url(deps)
    
    try:
        response = requests.get(
            f"{backend_url}/api/elements/snapshot",
            timeout=timeout
        )
        response.raise_for_status()
        return response.json()
    except requests.exceptions.ConnectionError:
        raise CentrisCLIError(
            "Cannot connect to Centris backend",
            hint="Make sure the backend is running: centris start"
        )
    except requests.exceptions.Timeout:
        raise CentrisCLIError(
            "Backend request timed out",
            hint="The browser extension may not be connected. Check extension popup."
        )
    except requests.exceptions.HTTPError as e:
        raise CentrisCLIError(
            f"Backend error: {e.response.status_code}",
            hint=e.response.text if e.response else "Check backend logs"
        )


async def navigate_and_capture(
    backend_url: str,
    url: str,
    wait_seconds: float = 3.0,
    timeout: int = 30
) -> Dict[str, Any]:
    """
    Navigate to URL and capture elements via the backend.
    
    This is fully automated - no manual extension interaction needed.
    Uses the same BrowserClient as 'centris browser' commands.
    """
    try:
        import httpx
    except ImportError:
        raise CentrisCLIError(
            "httpx is required for capture. Install with: pip install httpx",
            code="missing_dependency"
        )
    
    async with httpx.AsyncClient(timeout=timeout) as client:
        # Step 1: Navigate to URL
        try:
            nav_response = await client.post(
                f"{backend_url}/api/tools/execute",
                json={
                    "tool": "navigate_browser",
                    "params": {"url": url}
                }
            )
            nav_result = nav_response.json()
            
            if not nav_result.get("success"):
                raise CentrisCLIError(
                    f"Navigation failed: {nav_result.get('error', 'Unknown error')}",
                    hint="Make sure browser extension is connected"
                )
        except httpx.ConnectError:
            raise CentrisCLIError(
                "Cannot connect to backend",
                hint="Start the backend with: centris start"
            )
        
        # Step 2: Wait for page to load
        await asyncio.sleep(wait_seconds)
        
        # Step 3: Get interactive snapshot (elements)
        try:
            snap_response = await client.get(
                f"{backend_url}/api/elements/snapshot"
            )
            snap_result = snap_response.json()
            
            if not snap_result.get("success"):
                raise CentrisCLIError(
                    f"Snapshot failed: {snap_result.get('error', 'Unknown error')}"
                )
            
            return snap_result
            
        except httpx.ConnectError:
            raise CentrisCLIError(
                "Lost connection to backend during snapshot"
            )


def capture_elements_from_url(
    deps: CLIDeps,
    url: str,
    wait_seconds: float = 3.0,
    timeout: int = 30
) -> Dict[str, Any]:
    """
    Synchronous wrapper for navigate_and_capture.
    
    Navigate to URL via backend, wait for page load, capture elements.
    Fully automated - no manual clicking required.
    """
    backend_url = get_backend_url(deps)
    return asyncio.run(navigate_and_capture(
        backend_url=backend_url,
        url=url,
        wait_seconds=wait_seconds,
        timeout=timeout
    ))


def format_elements_for_export(
    elements: List[Dict],
    url: str = "",
    for_sdk: bool = False
) -> Dict[str, Any]:
    """
    Format elements for export.
    
    Args:
        elements: Raw elements from backend/extension
        url: Current page URL
        for_sdk: If True, format for SDK connector generation
    
    Returns:
        Formatted export dict
    """
    type_expand = {'cl': 'clickable', 'ty': 'typeable', 'se': 'selectable', 'ot': 'other'}
    
    # Format each element
    formatted = []
    for idx, el in enumerate(elements):
        node_id = el.get('id') or el.get('nodeId') or idx
        name = el.get('n') or el.get('name') or el.get('ariaLabel') or ''
        raw_type = el.get('t') or el.get('type') or 'other'
        elem_type = type_expand.get(raw_type, raw_type)
        bounds = el.get('b') or el.get('bounds') or {}
        
        formatted.append({
            'index': idx + 1,
            'id': node_id,
            'name': name,
            'type': elem_type,
            'bounds': {
                'x': round(bounds.get('x', 0)),
                'y': round(bounds.get('y', 0)),
                'width': round(bounds.get('w') or bounds.get('width', 0)),
                'height': round(bounds.get('h') or bounds.get('height', 0))
            }
        })
    
    if not for_sdk:
        # Simple export format
        return {
            '_meta': {
                'url': url,
                'elementCount': len(formatted),
                'exportedAt': datetime.now().isoformat(),
                'exportedBy': 'centris elements export'
            },
            'elements': formatted
        }
    
    # SDK connector format
    domain = 'my-connector'
    try:
        from urllib.parse import urlparse
        parsed = urlparse(url)
        domain = parsed.hostname.replace('www.', '').split('.')[0] if parsed.hostname else 'my-connector'
    except Exception:
        pass
    
    # Group elements by type
    navigation = {}
    typeable_fields = {}
    clickable_buttons = {}
    selectable_fields = {}
    
    for el in formatted:
        # Create a safe key name
        key = (el['name'] or f"element_{el['id']}").lower()
        key = ''.join(c if c.isalnum() else '_' for c in key)
        key = '_'.join(filter(None, key.split('_')))[:30] or f"el_{el['id']}"
        
        entry = {'id': el['id'], 'label': el['name'] or f"Element {el['index']}"}
        
        if el['type'] == 'typeable':
            typeable_fields[key] = entry
        elif el['type'] == 'selectable':
            selectable_fields[key] = entry
        elif el['type'] == 'clickable':
            # Heuristic: navigation items are usually near top
            if el['bounds']['y'] < 500 and len(el['name']) < 30:
                navigation[key] = entry
            else:
                clickable_buttons[key] = entry
    
    hostname = ''
    try:
        from urllib.parse import urlparse
        hostname = urlparse(url).hostname or ''
        hostname = hostname.replace('www.', '')
    except Exception:
        pass
    
    return {
        '_meta': {
            'format': 'centris-sdk-connector',
            'version': '1.0',
            'url': url,
            'domain': domain,
            'exportedAt': datetime.now().isoformat(),
            'usage': f'Run: centris browser snapshot and use nodeId values with centris browser click'
        },
        'connector': {
            'id': domain,
            'name': domain.title().replace('-', ' ').replace('_', ' '),
            'type': 'browser',
            'urlPatterns': [hostname] if hostname else []
        },
        'elementMapping': {
            'navigation': navigation,
            'typeableFields': typeable_fields,
            'clickableButtons': clickable_buttons,
            'selectableFields': selectable_fields
        },
        'stats': {
            'total': len(formatted),
            'typeable': len(typeable_fields),
            'clickable': len(navigation) + len(clickable_buttons),
            'selectable': len(selectable_fields)
        }
    }


# =============================================================================
# CLI Commands
# =============================================================================

@click.group("elements")
def elements_group():
    """
    Export and manage interactive elements for connector development.
    
    The elements command communicates with the Centris backend and Chrome
    extension to extract interactive elements from the current browser page.
    
    Workflow:
        1. Navigate to a website in Chrome
        2. Run: centris elements export -o elements.json
        3. Use the exported node IDs with runtime browser/action APIs
    """
    pass


@elements_group.command("capture")
@click.argument("url")
@click.option("--output", "-o", type=click.Path(), help="Output file path (default: stdout)")
@click.option("--wait", "-w", type=float, default=3.0, help="Seconds to wait after page load")
@click.option("--pretty/--compact", default=True, help="Pretty print JSON")
@click.pass_context
def capture_command(
    ctx: click.Context,
    url: str,
    output: Optional[str],
    wait: float,
    pretty: bool,
) -> None:
    """
    Capture elements from a URL (fully automated).
    
    Navigates to the URL via the backend browser, waits for page load,
    and captures all interactive elements. No manual clicking required.
    
    Examples:
        centris elements capture https://apply.ycombinator.com
        centris elements capture https://gmail.com -o gmail.json
        centris elements capture https://example.com -o elements.json
    """
    deps = ctx.obj.get("deps") if ctx.obj else create_default_deps()
    console = deps.console
    
    with Spinner(f"Capturing elements from {url}...") as spin:
        try:
            spin.update("Navigating to URL...")
            result = capture_elements_from_url(deps, url, wait_seconds=wait)
        except CentrisCLIError as e:
            spin.fail(str(e))
            raise
        
        elements = result.get('elements') or result.get('interactiveNodes') or result.get('_internalNodes') or []
        captured_url = result.get('url', url)
        
        if not elements:
            spin.fail("No interactive elements found")
            console.echo(f"\n{theme.warn('!')} The page may still be loading. Try:")
            console.echo(f"  centris elements capture {url} --wait 5")
            return
        
        spin.update(f"Found {len(elements)} elements")
        
        # Format for export
        formatted = format_elements_for_export(elements, captured_url, for_sdk=False)
        
        # Output
        indent = 2 if pretty else None
        json_str = json.dumps(formatted, indent=indent)
        
        if output:
            Path(output).write_text(json_str)
            spin.success(f"Captured {len(elements)} elements to {output}")
        else:
            spin.success(f"Captured {len(elements)} elements")
            console.echo("")
            console.echo(json_str)


@elements_group.command("export")
@click.option("--output", "-o", type=click.Path(), help="Output file path (default: stdout)")
@click.option("--pretty/--compact", default=True, help="Pretty print JSON")
@click.pass_context
def export_command(
    ctx: click.Context,
    output: Optional[str],
    pretty: bool,
) -> None:
    """
    Export interactive elements from the current browser page.
    
    This command communicates with the Centris backend to get elements
    from the active browser tab (same data as "Show Elements" in extension).
    
    Examples:
        centris elements export                      # Print to stdout
        centris elements export -o elements.json    # Save to file
    """
    deps = ctx.obj.get("deps") if ctx.obj else create_default_deps()
    console = deps.console
    
    with Spinner("Fetching elements from browser...") as spin:
        try:
            result = fetch_elements_from_backend(deps)
        except CentrisCLIError as e:
            spin.fail(str(e))
            raise
        
        elements = result.get('elements') or result.get('interactiveNodes') or result.get('_internalNodes') or []
        url = result.get('url', '')
        
        if not elements:
            spin.fail("No interactive elements found")
            console.echo(f"\n{theme.warn('!')} Make sure:")
            console.echo("  • Chrome extension is connected (check popup)")
            console.echo("  • You're on a webpage (not chrome:// pages)")
            console.echo("  • The page has finished loading")
            return
        
        spin.update(f"Found {len(elements)} elements")
        
        # Format for export
        formatted = format_elements_for_export(elements, url, for_sdk=False)
        
        # Output
        indent = 2 if pretty else None
        json_str = json.dumps(formatted, indent=indent)
        
        if output:
            Path(output).write_text(json_str)
            spin.success(f"Exported {len(elements)} elements to {output}")
        else:
            spin.success(f"Found {len(elements)} elements")
            console.echo("")
            console.echo(json_str)


@elements_group.command("list")
@click.option("--type", "-t", "element_type", type=click.Choice(["all", "clickable", "typeable", "selectable"]), default="all", help="Filter by element type")
@click.pass_context
def list_command(
    ctx: click.Context,
    element_type: str,
) -> None:
    """
    List interactive elements from the current browser page.
    
    Shows a formatted list in the terminal (similar to extension popup).
    """
    deps = ctx.obj.get("deps") if ctx.obj else create_default_deps()
    console = deps.console
    
    with Spinner("Fetching elements from browser...") as spin:
        try:
            result = fetch_elements_from_backend(deps)
        except CentrisCLIError as e:
            spin.fail(str(e))
            raise
        
        elements = result.get('elements') or result.get('interactiveNodes') or result.get('_internalNodes') or []
        url = result.get('url', '')
        
        if not elements:
            spin.fail("No interactive elements found")
            return
        
        spin.success(f"Found {len(elements)} elements on {url}")
    
    type_expand = {'cl': 'clickable', 'ty': 'typeable', 'se': 'selectable', 'ot': 'other'}
    type_colors = {
        'clickable': theme.success,
        'typeable': theme.accent,
        'selectable': theme.warn,
        'other': theme.muted
    }
    
    console.echo("")
    
    for idx, el in enumerate(elements):
        node_id = el.get('id') or el.get('nodeId') or idx
        name = el.get('n') or el.get('name') or el.get('ariaLabel') or '(no label)'
        raw_type = el.get('t') or el.get('type') or 'other'
        elem_type = type_expand.get(raw_type, raw_type)
        bounds = el.get('b') or el.get('bounds') or {}
        
        # Filter by type
        if element_type != "all" and elem_type != element_type:
            continue
        
        # Format bounds
        bounds_str = f"{round(bounds.get('w', 0))}x{round(bounds.get('h', 0))} @ ({round(bounds.get('x', 0))}, {round(bounds.get('y', 0))})"
        
        # Color by type
        color_fn = type_colors.get(elem_type, theme.muted)
        
        # Display
        console.echo(f"  #{idx + 1}: {theme.bold(name[:50])}")
        console.echo(f"      {color_fn(elem_type)} | id: {node_id} | {bounds_str}")


@elements_group.command("generate")
@click.argument("connector_id")
@click.option("--url", "-u", help="URL to capture elements from (fully automated)")
@click.option("--wait", "-w", type=float, default=3.0, help="Seconds to wait after page load")
@click.option("--output", "-o", type=click.Path(), help="Output directory")
@click.pass_context
def generate_command(
    ctx: click.Context,
    connector_id: str,
    url: Optional[str],
    wait: float,
    output: Optional[str],
) -> None:
    """
    Legacy command removed.
    """
    _ = ctx
    _ = connector_id
    _ = url
    _ = wait
    _ = output
    raise click.ClickException(
        "elements generate was removed in migrated runtime. "
        "Use `centris init <connector-id>` and runtime Action API route recording."
    )
