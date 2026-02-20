"""
Centris CLI Browser Commands

Control browser automation directly from the command line.
Connects to the Centris backend's browser agent.

Commands:
    centris browser navigate "https://gmail.com"
    centris browser snapshot
    centris browser click --node-id 123
    centris browser type "Hello world"
    centris browser search "Python tutorials"
"""

import asyncio
import json
import sys
from typing import Any, Dict, Optional

import click

from centris_sdk.cli.theme import theme, symbols
from centris_sdk.cli.progress import Spinner
from centris_sdk.cli.errors import CentrisCLIError, ExitCode


class BrowserClient:
    """
    Client for browser automation via the Centris backend.
    
    Uses the ExtensionBridge or CDP to control the browser.
    """
    
    def __init__(self, base_url: str = "http://127.0.0.1:5001"):
        self.base_url = base_url
    
    async def execute_tool(
        self,
        tool_name: str,
        params: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Execute a browser tool through the backend."""
        try:
            import httpx
        except ImportError:
            raise CentrisCLIError(
                "httpx is required. Install with: pip install httpx",
                code="missing_dependency",
            )
        
        async with httpx.AsyncClient(timeout=60.0) as client:
            try:
                response = await client.post(
                    f"{self.base_url}/api/tools/execute",
                    json={
                        "tool": tool_name,
                        "params": params,
                    },
                )
                
                if response.status_code == 200:
                    return response.json()
                else:
                    return {
                        "success": False,
                        "error": f"Backend error: {response.text}",
                    }
            except httpx.ConnectError:
                raise CentrisCLIError(
                    "Cannot connect to backend. Start it with: centris start",
                    code="backend_unavailable",
                )
    
    async def navigate(self, url: str) -> Dict[str, Any]:
        """Navigate to a URL."""
        return await self.execute_tool("navigate_browser", {"url": url})
    
    async def get_snapshot(self) -> Dict[str, Any]:
        """Get interactive snapshot of current page."""
        return await self.execute_tool("get_interactive_snapshot", {})
    
    async def click_element(
        self,
        node_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Click an element on the page."""
        if node_id is None:
            return {
                "success": False,
                "error": "nodeId is required",
            }
        return await self.execute_tool("click_node", {"nodeId": node_id})
    
    async def type_text(self, text: str) -> Dict[str, Any]:
        """Type text into the focused element."""
        return await self.execute_tool("type_text", {"text": text})
    
    async def press_key(self, key: str) -> Dict[str, Any]:
        """Press a keyboard key."""
        return await self.execute_tool("press_key", {"key": key})
    
    async def get_page_content(self) -> Dict[str, Any]:
        """Get the page text content."""
        return await self.execute_tool("get_page_content", {})
    
    async def google_search(self, query: str) -> Dict[str, Any]:
        """Perform a Google search."""
        return await self.execute_tool("google_search", {"query": query})
    
    async def take_screenshot(self) -> Dict[str, Any]:
        """Take a screenshot of the current page."""
        return await self.execute_tool("screenshot", {})
    
    def is_backend_available(self) -> bool:
        """Check if the backend is available."""
        try:
            import socket
            host, port = self.base_url.replace("http://", "").replace("https://", "").split(":")
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(2)
            result = sock.connect_ex((host, int(port)))
            sock.close()
            return result == 0
        except Exception:
            return False


def check_backend(client: BrowserClient, json_output: bool = False) -> bool:
    """Check if backend is available, show error if not."""
    if not client.is_backend_available():
        if json_output:
            click.echo(json.dumps({
                "success": False,
                "error": "Backend server not available",
                "hint": "Start with: centris start",
            }))
        else:
            click.echo(f"{theme.error(symbols.CROSS)} Backend server not available")
            click.echo(f"{theme.muted('Start it with:')} centris start")
        return False
    return True


# =============================================================================
# Browser Command Group
# =============================================================================

@click.group(name="browser")
@click.option("--backend-url", default="http://127.0.0.1:5001", help="Backend server URL", hidden=True)
@click.pass_context
def browser_group(ctx: click.Context, backend_url: str):
    """
    Control browser automation.
    
    Navigate, interact with pages, and extract content through
    the Centris browser agent.
    
    \b
    Examples:
      centris browser navigate "https://gmail.com"
      centris browser snapshot
      centris browser click --node-id 123
      centris browser type "Hello world"
      centris browser search "Python tutorials"
    
    \b
    Docs: https://docs.centris.ai/sdk/cli/browser
    """
    ctx.ensure_object(dict)
    ctx.obj["browser_client"] = BrowserClient(base_url=backend_url)


@browser_group.command(name="navigate")
@click.argument("url")
@click.option("--wait", "-w", type=float, default=2.0, help="Seconds to wait after navigation")
@click.option("--json", "json_output", is_flag=True, help="Output as JSON")
@click.pass_context
def navigate_command(ctx: click.Context, url: str, wait: float, json_output: bool):
    """
    Navigate to a URL.
    
    \b
    Examples:
      centris browser navigate "https://google.com"
      centris browser navigate "https://gmail.com" --wait 5
    """
    client: BrowserClient = ctx.obj["browser_client"]
    json_output = json_output or ctx.obj.get("json_output", False)
    
    if not check_backend(client, json_output):
        ctx.exit(ExitCode.ERROR)
    
    async def run():
        return await client.navigate(url)
    
    if not json_output:
        with Spinner(f"Navigating to {url}...") as spinner:
            result = asyncio.run(run())
            if result.get("success"):
                spinner.success(f"Loaded: {url}")
            else:
                spinner.fail(result.get("error", "Navigation failed"))
    else:
        result = asyncio.run(run())
    
    if json_output:
        click.echo(json.dumps(result, indent=2))
    
    if not result.get("success"):
        ctx.exit(ExitCode.ERROR)


@browser_group.command(name="snapshot")
@click.option("--format", "output_format", type=click.Choice(["tree", "json", "summary"]), default="summary", help="Output format")
@click.option("--json", "json_output", is_flag=True, help="Output as JSON")
@click.pass_context
def snapshot_command(ctx: click.Context, output_format: str, json_output: bool):
    """
    Get interactive snapshot of current page.
    
    Shows clickable elements with their node IDs for automation.
    
    \b
    Examples:
      centris browser snapshot
      centris browser snapshot --format tree
      centris browser snapshot --json
    """
    client: BrowserClient = ctx.obj["browser_client"]
    json_output = json_output or ctx.obj.get("json_output", False) or output_format == "json"
    
    if not check_backend(client, json_output):
        ctx.exit(ExitCode.ERROR)
    
    async def run():
        return await client.get_snapshot()
    
    if not json_output:
        with Spinner("Getting page snapshot...") as spinner:
            result = asyncio.run(run())
            if result.get("success"):
                spinner.success("Snapshot captured")
            else:
                spinner.fail(result.get("error", "Snapshot failed"))
    else:
        result = asyncio.run(run())
    
    if json_output:
        click.echo(json.dumps(result, indent=2))
    else:
        # Format snapshot for display
        elements = result.get("elements", [])
        if elements:
            click.echo(f"\n{theme.heading('Interactive Elements:')}")
            for elem in elements[:30]:  # Limit display
                node_id = elem.get("nodeId", "?")
                tag = elem.get("tag", "?")
                text = elem.get("text", "")[:50] or elem.get("role", "")
                click.echo(f"  {theme.accent(f'[{node_id}]')} {tag}: {text}")
            
            if len(elements) > 30:
                click.echo(f"\n  {theme.muted(f'... and {len(elements) - 30} more elements')}")
        else:
            click.echo(f"{theme.muted('No interactive elements found')}")
    
    if not result.get("success"):
        ctx.exit(ExitCode.ERROR)


@browser_group.command(name="click")
@click.option("--node-id", "-n", type=int, required=True, help="Node ID to click (from snapshot)")
@click.option("--json", "json_output", is_flag=True, help="Output as JSON")
@click.pass_context
def click_command(
    ctx: click.Context,
    node_id: int,
    json_output: bool,
):
    """
    Click an element on the page.
    
    Node ID is required (from `centris browser snapshot`).
    
    \b
    Examples:
      centris browser click --node-id 123
    """
    client: BrowserClient = ctx.obj["browser_client"]
    json_output = json_output or ctx.obj.get("json_output", False)
    
    if not check_backend(client, json_output):
        ctx.exit(ExitCode.ERROR)
    
    async def run():
        return await client.click_element(node_id=node_id)
    
    target = str(node_id)
    if not json_output:
        with Spinner(f"Clicking: {target}...") as spinner:
            result = asyncio.run(run())
            if result.get("success"):
                spinner.success("Clicked")
            else:
                spinner.fail(result.get("error", "Click failed"))
    else:
        result = asyncio.run(run())
    
    if json_output:
        click.echo(json.dumps(result, indent=2))
    
    if not result.get("success"):
        ctx.exit(ExitCode.ERROR)


@browser_group.command(name="type")
@click.argument("text")
@click.option("--json", "json_output", is_flag=True, help="Output as JSON")
@click.pass_context
def type_command(ctx: click.Context, text: str, json_output: bool):
    """
    Type text into the focused element.
    
    \b
    Examples:
      centris browser type "Hello world"
      centris browser type "user@example.com"
    """
    client: BrowserClient = ctx.obj["browser_client"]
    json_output = json_output or ctx.obj.get("json_output", False)
    
    if not check_backend(client, json_output):
        ctx.exit(ExitCode.ERROR)
    
    async def run():
        return await client.type_text(text)
    
    if not json_output:
        with Spinner(f"Typing: {text[:20]}...") as spinner:
            result = asyncio.run(run())
            if result.get("success"):
                spinner.success("Typed")
            else:
                spinner.fail(result.get("error", "Type failed"))
    else:
        result = asyncio.run(run())
    
    if json_output:
        click.echo(json.dumps(result, indent=2))
    
    if not result.get("success"):
        ctx.exit(ExitCode.ERROR)


@browser_group.command(name="key")
@click.argument("key")
@click.option("--json", "json_output", is_flag=True, help="Output as JSON")
@click.pass_context
def key_command(ctx: click.Context, key: str, json_output: bool):
    """
    Press a keyboard key.
    
    Supported keys: Enter, Tab, Escape, Backspace, ArrowUp, ArrowDown, etc.
    
    \b
    Examples:
      centris browser key Enter
      centris browser key Tab
      centris browser key Escape
    """
    client: BrowserClient = ctx.obj["browser_client"]
    json_output = json_output or ctx.obj.get("json_output", False)
    
    if not check_backend(client, json_output):
        ctx.exit(ExitCode.ERROR)
    
    async def run():
        return await client.press_key(key)
    
    if not json_output:
        with Spinner(f"Pressing: {key}...") as spinner:
            result = asyncio.run(run())
            if result.get("success"):
                spinner.success(f"Pressed {key}")
            else:
                spinner.fail(result.get("error", "Key press failed"))
    else:
        result = asyncio.run(run())
    
    if json_output:
        click.echo(json.dumps(result, indent=2))
    
    if not result.get("success"):
        ctx.exit(ExitCode.ERROR)


@browser_group.command(name="content")
@click.option("--json", "json_output", is_flag=True, help="Output as JSON")
@click.pass_context
def content_command(ctx: click.Context, json_output: bool):
    """
    Get the text content of the current page.
    
    \b
    Examples:
      centris browser content
      centris browser content --json
    """
    client: BrowserClient = ctx.obj["browser_client"]
    json_output = json_output or ctx.obj.get("json_output", False)
    
    if not check_backend(client, json_output):
        ctx.exit(ExitCode.ERROR)
    
    async def run():
        return await client.get_page_content()
    
    if not json_output:
        with Spinner("Getting page content...") as spinner:
            result = asyncio.run(run())
            if result.get("success"):
                spinner.success("Content retrieved")
            else:
                spinner.fail(result.get("error", "Failed"))
    else:
        result = asyncio.run(run())
    
    if json_output:
        click.echo(json.dumps(result, indent=2))
    else:
        content = result.get("content", "")
        if content:
            click.echo(f"\n{content}")
        else:
            click.echo(f"{theme.muted('No content found')}")
    
    if not result.get("success"):
        ctx.exit(ExitCode.ERROR)


@browser_group.command(name="search")
@click.argument("query")
@click.option("--json", "json_output", is_flag=True, help="Output as JSON")
@click.pass_context
def search_command(ctx: click.Context, query: str, json_output: bool):
    """
    Perform a Google search.
    
    \b
    Examples:
      centris browser search "Python tutorials"
      centris browser search "weather today"
    """
    client: BrowserClient = ctx.obj["browser_client"]
    json_output = json_output or ctx.obj.get("json_output", False)
    
    if not check_backend(client, json_output):
        ctx.exit(ExitCode.ERROR)
    
    async def run():
        return await client.google_search(query)
    
    if not json_output:
        with Spinner(f"Searching: {query}...") as spinner:
            result = asyncio.run(run())
            if result.get("success"):
                spinner.success("Search completed")
            else:
                spinner.fail(result.get("error", "Search failed"))
    else:
        result = asyncio.run(run())
    
    if json_output:
        click.echo(json.dumps(result, indent=2))
    
    if not result.get("success"):
        ctx.exit(ExitCode.ERROR)


@browser_group.command(name="screenshot")
@click.option("--output", "-o", type=click.Path(), help="Save to file (default: screenshot.png)")
@click.option("--json", "json_output", is_flag=True, help="Output as base64 JSON")
@click.pass_context
def screenshot_command(ctx: click.Context, output: Optional[str], json_output: bool):
    """
    Take a screenshot of the current page.
    
    \b
    Examples:
      centris browser screenshot
      centris browser screenshot -o page.png
      centris browser screenshot --json
    """
    _ = output
    _ = json_output
    raise click.ClickException(
        "Screenshot command is disabled in migrated runtime. "
        "Use `centris browser snapshot` and `centris browser content`."
    )


__all__ = ["browser_group", "BrowserClient"]
