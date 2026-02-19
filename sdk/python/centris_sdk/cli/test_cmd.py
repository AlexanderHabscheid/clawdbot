"""
Centris SDK CLI - Test Command

Test connector capabilities with sample inputs.

Three testing modes:
- Mock (default): Fast local testing, records ops but doesn't verify selectors
- Browser: Real Playwright browser, verifies selectors exist, actionable errors
- Live: Full Centris backend, tests against user's actual browser session

Usage:
    centris test .                # Mock browser (fast, syntax check only)
    centris test . --browser      # Real browser (verifies selectors)
    centris test . --browser --headed  # See the browser
    centris test . --live         # Full backend (requires Centris running)
"""

import click
import json
import asyncio
import sys
import importlib.util
from pathlib import Path
from typing import Optional, Any
from dataclasses import dataclass


@dataclass
class TestResult:
    """Result of a capability test."""
    capability_id: str
    passed: bool
    input_params: dict[str, Any]
    output: Any
    error: Optional[str] = None
    hint: Optional[str] = None  # Actionable hint for fixing failures
    duration_ms: float = 0
    operations: Optional[list] = None  # Browser operations for debugging
    similar_selectors: Optional[list] = None  # Similar selectors found (for debugging)


def load_connector(path: Path) -> Any:
    """Load connector module from path."""
    connector_py = path / "connector.py"
    if not connector_py.exists():
        raise FileNotFoundError(f"connector.py not found in {path}")
    
    # Add path to sys.path temporarily
    sys.path.insert(0, str(path))
    
    try:
        spec = importlib.util.spec_from_file_location("connector", connector_py)
        if spec is None or spec.loader is None:
            raise ImportError("Cannot load connector module")
        
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        
        # Look for connector export
        if hasattr(module, "connector"):
            return module.connector
        elif hasattr(module, "plugin"):
            return module.plugin
        else:
            raise AttributeError("No 'connector' or 'plugin' export found")
    finally:
        sys.path.remove(str(path))


def generate_test_input(schema: dict[str, Any]) -> dict[str, Any]:
    """Generate sample test input from JSON schema."""
    if schema.get("type") != "object":
        return {}
    
    properties = schema.get("properties", {})
    required = schema.get("required", [])
    result: dict[str, Any] = {}
    
    for prop_name, prop_schema in properties.items():
        prop_type = prop_schema.get("type", "string")
        
        # Generate sample value based on type
        if prop_type == "string":
            if "enum" in prop_schema:
                result[prop_name] = prop_schema["enum"][0]
            elif "default" in prop_schema:
                result[prop_name] = prop_schema["default"]
            else:
                result[prop_name] = f"test_{prop_name}"
        elif prop_type == "number" or prop_type == "integer":
            result[prop_name] = prop_schema.get("default", 42)
        elif prop_type == "boolean":
            result[prop_name] = prop_schema.get("default", True)
        elif prop_type == "array":
            result[prop_name] = prop_schema.get("default", [])
        elif prop_type == "object":
            result[prop_name] = prop_schema.get("default", {})
    
    return result


class LiveBrowserBridge:
    """
    Live browser bridge that connects to a running Centris backend.
    
    Uses HTTP calls to the Centris backend to execute browser operations
    in a real browser session.
    """
    
    def __init__(self, backend_url: str = "http://localhost:8000"):
        self.backend_url = backend_url.rstrip('/')
        self.operations: list = []
        self._client = None
    
    async def _get_client(self):
        if self._client is None:
            try:
                import httpx
                self._client = httpx.AsyncClient(timeout=30.0)
            except ImportError:
                raise ImportError("httpx required for live testing: pip install httpx")
        return self._client
    
    async def _execute(self, tool_name: str, params: dict) -> dict:
        """Execute a tool via the Centris backend."""
        client = await self._get_client()
        
        self.operations.append({
            'action': tool_name,
            'args': params,
            'timestamp': __import__('datetime').datetime.utcnow().isoformat(),
        })
        
        try:
            response = await client.post(
                f"{self.backend_url}/api/tool/execute",
                json={"tool": tool_name, "params": params}
            )
            result = response.json()
            self.operations[-1]['result'] = result
            return result
        except Exception as e:
            error = {"success": False, "error": str(e)}
            self.operations[-1]['error'] = str(e)
            return error
    
    async def navigate_browser(self, url: str) -> dict:
        return await self._execute("navigate_browser", {"url": url})
    
    async def get_active_tab(self) -> dict:
        return await self._execute("get_active_tab", {})
    
    async def click_node(self, selector: str) -> dict:
        return await self._execute("click_node", {"ref": selector})
    
    async def input_text_node(self, selector: str, text: str) -> dict:
        return await self._execute("input_text_node", {"ref": selector, "text": text})
    
    async def type_text(self, text: str) -> dict:
        return await self._execute("type_text", {"text": text})
    
    async def press_key(self, key: str) -> dict:
        return await self._execute("press_key", {"key": key})
    
    async def wait(self, ms: int) -> dict:
        await asyncio.sleep(ms / 1000)
        return {"success": True, "waited_ms": ms}
    
    async def wait_for_selector(self, selector: str, timeout: int = 5000) -> dict:
        return await self._execute("wait_for_element", {"selector": selector, "timeout_ms": timeout})
    
    async def get_page_content(self) -> dict:
        return await self._execute("get_page_content", {})
    
    async def get_interactive_snapshot(self) -> dict:
        return await self._execute("get_interactive_snapshot", {})
    
    async def scroll_page(self, direction: str = "down", amount: int = 300) -> dict:
        return await self._execute("scroll_page", {"direction": direction, "amount": amount})
    
    async def close(self):
        if self._client:
            await self._client.aclose()


async def check_backend_connection(backend_url: str) -> tuple[bool, str]:
    """Check if Centris backend is running and accessible."""
    try:
        import httpx
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{backend_url}/health")
            if response.status_code == 200:
                return True, "Connected"
            return False, f"Backend returned status {response.status_code}"
    except ImportError:
        return False, "httpx not installed (pip install httpx)"
    except Exception as e:
        return False, str(e)


async def run_capability_test(
    connector: Any,
    capability_id: str,
    params: Optional[dict[str, Any]] = None,
    browser_mode: str = "mock",  # "mock", "browser", "live"
    backend_url: str = "http://localhost:8000",
    headless: bool = True,
) -> TestResult:
    """Test a single capability/tool.
    
    Supports both patterns:
    - Decorator pattern: connector.get_capability() + connector._handlers
    - API pattern: connector.api.get_tools() with tool.execute()
    
    Args:
        connector: Loaded connector object
        capability_id: ID of the capability/tool to test
        params: Optional test parameters
        browser_mode: "mock" (fast), "browser" (real playwright), "live" (full backend)
        backend_url: Centris backend URL for live testing
        headless: Run browser without UI (only for browser mode)
    """
    import time
    
    # Create browser bridge based on mode
    browser = None
    operations = []
    playwright_bridge = None  # Track for cleanup
    
    if browser_mode == "mock":
        try:
            from centris_sdk.testing import MockBrowserBridge
            browser = MockBrowserBridge(simulate_delays=False)
        except ImportError:
            pass
    elif browser_mode == "browser":
        # Real Playwright browser
        try:
            from centris_sdk.testing import PlaywrightBrowserBridge, is_playwright_available
            if not is_playwright_available():
                return TestResult(
                    capability_id=capability_id,
                    passed=False,
                    input_params=params or {},
                    output=None,
                    error="Playwright not installed",
                    hint="Install with: pip install centris-sdk[browser] && playwright install chromium",
                    duration_ms=0,
                )
            playwright_bridge = PlaywrightBrowserBridge(headless=headless)
            await playwright_bridge._start()
            browser = playwright_bridge
        except ImportError as e:
            return TestResult(
                capability_id=capability_id,
                passed=False,
                input_params=params or {},
                output=None,
                error=f"Playwright import failed: {e}",
                hint="Install with: pip install centris-sdk[browser] && playwright install chromium",
                duration_ms=0,
            )
    else:
        # Live browser - connect to Centris backend
        browser = LiveBrowserBridge(backend_url)
    
    # Find the capability/tool - support both patterns
    cap = None
    handler = None
    input_schema = {"type": "object", "properties": {}}
    
    # Pattern 1: Decorator-based with get_capability
    if hasattr(connector, 'get_capability'):
        cap = connector.get_capability(capability_id)
        if cap:
            input_schema = getattr(cap, 'input_schema', input_schema)
            if hasattr(connector, '_handlers'):
                handler = connector._handlers.get(capability_id)
    
    # Pattern 2: API-based with get_tools
    if not cap and hasattr(connector, 'api') and hasattr(connector.api, 'get_tools'):
        tools = connector.api.get_tools()
        for tool in tools:
            if tool.name == capability_id:
                cap = tool
                input_schema = getattr(tool, 'parameters', input_schema)
                handler = getattr(tool, 'execute', None)
                break
    
    if cap is None:
        # Clean up playwright if it was started
        if playwright_bridge:
            await playwright_bridge._close()
        
        return TestResult(
            capability_id=capability_id,
            passed=False,
            input_params={},
            output=None,
            error=f"Capability/tool '{capability_id}' not found",
            hint="Check that your connector exports a tool with this name in api.get_tools()",
            duration_ms=0,
            operations=[],
        )
    
    # Generate test input if not provided
    test_params = params or generate_test_input(input_schema)
    
    start_time = time.time()
    try:
        # Execute the handler with browser context
        if handler:
            context = {"browser_bridge": browser} if browser else {}
            result_data = await handler(f"test_{capability_id}", test_params, context)
            
            # Get operations from browser
            if browser and hasattr(browser, 'operations'):
                if isinstance(browser, LiveBrowserBridge):
                    operations = browser.operations
                elif hasattr(browser.operations[0] if browser.operations else None, '__dict__'):
                    operations = [op.__dict__ for op in browser.operations]
                else:
                    operations = browser.operations
            
            duration_ms = (time.time() - start_time) * 1000
            success = result_data.get("success", True) if isinstance(result_data, dict) else True
            error = result_data.get("error") if isinstance(result_data, dict) else None
            hint = result_data.get("hint") if isinstance(result_data, dict) else None
            similar = result_data.get("similar") if isinstance(result_data, dict) else None
            
            # Clean up browsers
            if isinstance(browser, LiveBrowserBridge):
                await browser.close()
            if playwright_bridge:
                await playwright_bridge._close()
            
            return TestResult(
                capability_id=capability_id,
                passed=success and not error,
                input_params=test_params,
                output=result_data,
                error=error,
                hint=hint,
                duration_ms=duration_ms,
                operations=operations,
                similar_selectors=similar,
            )
        
        # Fallback to connector.execute if no direct handler
        if hasattr(connector, 'execute'):
            result = await connector.execute(capability_id, test_params)
            duration_ms = (time.time() - start_time) * 1000
            
            # Clean up
            if playwright_bridge:
                await playwright_bridge._close()
            
            return TestResult(
                capability_id=capability_id,
                passed=result.success,
                input_params=test_params,
                output=result.data if result.success else None,
                error=result.error.message if result.error else None,
                hint=None,
                duration_ms=duration_ms,
                operations=operations,
            )
        
        # No handler found
        if playwright_bridge:
            await playwright_bridge._close()
        
        return TestResult(
            capability_id=capability_id,
            passed=False,
            input_params=test_params,
            output=None,
            error="No execute handler found for capability",
            hint="Make sure your connector exports a tool with an 'execute' function",
            duration_ms=(time.time() - start_time) * 1000,
            operations=operations,
        )
        
    except Exception as e:
        duration_ms = (time.time() - start_time) * 1000
        
        # Get operations before cleanup
        if browser and hasattr(browser, 'operations'):
            if isinstance(browser, LiveBrowserBridge):
                operations = browser.operations
            elif browser.operations and hasattr(browser.operations[0], '__dict__'):
                operations = [op.__dict__ for op in browser.operations]
            else:
                operations = browser.operations
        
        # Extract hint and similar selectors from failed operations
        hint = None
        similar = None
        if operations:
            for op in reversed(operations):
                op_dict = op if isinstance(op, dict) else (op.__dict__ if hasattr(op, '__dict__') else {})
                if op_dict.get('error') and not op_dict.get('success', True):
                    hint = op_dict.get('hint')
                    break
        
        # Clean up browsers on error
        if isinstance(browser, LiveBrowserBridge):
            try:
                await browser.close()
            except:
                pass
        if playwright_bridge:
            try:
                await playwright_bridge._close()
            except:
                pass
        
        return TestResult(
            capability_id=capability_id,
            passed=False,
            input_params=test_params,
            output=None,
            error=str(e),
            hint=hint,
            duration_ms=duration_ms,
            operations=operations,
            similar_selectors=similar,
        )


@click.command("test")
@click.argument("path", type=click.Path(exists=True), default=".")
@click.option("--capability", "-c", help="Test specific capability ID")
@click.option("--params", "-p", help="JSON params for test (or path to JSON file)")
@click.option("--json-output", "json_out", is_flag=True, help="Output results as JSON")
@click.option("--timeout", "-t", default=30, help="Timeout in seconds per test")
@click.option("--mock", is_flag=True, default=True, help="Use mock browser (default)")
@click.option("--browser", is_flag=True, help="Use real Playwright browser (verifies selectors)")
@click.option("--headed", is_flag=True, help="Show browser window (with --browser)")
@click.option("--live", is_flag=True, help="Test via Centris backend (requires running server)")
@click.option("--backend", default="http://localhost:8000", help="Centris backend URL for --live")
@click.option("--show-ops", is_flag=True, help="Show browser operations performed")
@click.pass_context
def test_command(
    ctx: click.Context,
    path: str,
    capability: Optional[str],
    params: Optional[str],
    json_out: bool,
    timeout: int,
    mock: bool,
    browser: bool,
    headed: bool,
    live: bool,
    backend: str,
    show_ops: bool,
) -> None:
    """
    Test connector capabilities.
    
    Three modes:
    
    \b
    MOCK (default):
      Fast local testing. Records operations but doesn't verify
      selectors actually exist. Good for syntax checking.
    
    \b
    BROWSER (--browser):
      Real Playwright browser. Verifies selectors exist on actual
      pages. Provides actionable errors with hints and similar
      selectors when tests fail.
    
    \b
    LIVE (--live):
      Full Centris backend. Tests in user's actual browser session
      via the extension. Requires Centris to be running.
    
    Examples:
        centris test .                     # Mock (fast)
        centris test . --browser           # Real browser (verifies selectors)
        centris test . --browser --headed  # See the browser
        centris test . --live              # Via Centris backend
        centris test . -c gmail_send_email --browser  # Test specific tool
        centris test . --show-ops          # Show browser operations
    """
    verbose = ctx.obj.get("verbose", False) if ctx.obj else False
    connector_path = Path(path).resolve()
    
    if not json_out:
        click.echo(f"Testing connector at: {connector_path}")
        click.echo()
    
    # Load connector
    try:
        connector = load_connector(connector_path)
        if not json_out:
            click.echo(f"Loaded connector: {connector.name}")
            click.echo()
    except Exception as e:
        if json_out:
            click.echo(json.dumps({"error": str(e), "passed": False}))
        else:
            click.echo(click.style(f"Failed to load connector: {e}", fg="red"))
        sys.exit(1)
    
    # Parse params if provided
    test_params: Optional[dict[str, Any]] = None
    if params:
        try:
            if params.endswith(".json") and Path(params).exists():
                with open(params) as f:
                    test_params = json.load(f)
            else:
                test_params = json.loads(params)
        except (json.JSONDecodeError, FileNotFoundError) as e:
            if json_out:
                click.echo(json.dumps({"error": f"Invalid params: {e}", "passed": False}))
            else:
                click.echo(click.style(f"Invalid params: {e}", fg="red"))
            sys.exit(1)
    
    # Get capabilities/tools to test - support both patterns
    if capability:
        cap_ids = [capability]
    else:
        cap_ids = []
        # Pattern 1: API-based with get_tools() - preferred pattern
        if hasattr(connector, 'api') and hasattr(connector.api, 'get_tools'):
            tools = connector.api.get_tools()
            cap_ids = [tool.name for tool in tools]
        # Pattern 2: Decorator-based with capabilities attribute (must be a list)
        elif hasattr(connector, 'capabilities') and isinstance(connector.capabilities, list) and connector.capabilities:
            # Handle both string lists and capability objects
            first_cap = connector.capabilities[0]
            if isinstance(first_cap, str):
                cap_ids = connector.capabilities
            elif hasattr(first_cap, 'id'):
                cap_ids = [cap.id for cap in connector.capabilities]
    
    if not cap_ids:
        if json_out:
            click.echo(json.dumps({"error": "No capabilities found", "passed": False}))
        else:
            click.echo(click.style("No capabilities found to test", fg="yellow"))
        sys.exit(1)
    
    # Determine browser mode
    if live:
        browser_mode = "live"
    elif browser:
        browser_mode = "browser"
    else:
        browser_mode = "mock"
    
    backend_url = backend
    headless = not headed
    
    if not json_out:
        if browser_mode == "mock":
            click.echo(click.style("Using mock browser for testing", fg="cyan"))
            click.echo(click.style("  (Fast syntax check - does NOT verify selectors exist)", fg="yellow"))
        elif browser_mode == "browser":
            click.echo(click.style("Using real Playwright browser for testing", fg="green", bold=True))
            click.echo(f"  Headless: {'No (--headed)' if headed else 'Yes'}")
            click.echo(click.style("  (Verifies selectors exist - provides actionable errors)", fg="green"))
            
            # Check if Playwright is available
            try:
                from centris_sdk.testing import is_playwright_available
                if not is_playwright_available():
                    click.echo()
                    click.echo(click.style("✗ Playwright not installed", fg="red"))
                    click.echo()
                    click.echo("Install with:")
                    click.echo("  pip install centris-sdk[browser]")
                    click.echo("  playwright install chromium")
                    sys.exit(1)
            except ImportError:
                click.echo()
                click.echo(click.style("✗ Playwright not installed", fg="red"))
                click.echo()
                click.echo("Install with:")
                click.echo("  pip install centris-sdk[browser]")
                click.echo("  playwright install chromium")
                sys.exit(1)
        else:
            click.echo(click.style("Using LIVE browser via Centris backend", fg="yellow", bold=True))
            click.echo(f"  Backend: {backend_url}")
            
            # Check backend connection
            async def check_connection():
                return await check_backend_connection(backend_url)
            
            connected, message = asyncio.run(check_connection())
            
            if not connected:
                click.echo(click.style(f"  ✗ Cannot connect to Centris backend: {message}", fg="red"))
                click.echo()
                click.echo("Make sure Centris is running:")
                click.echo("  1. Start the Centris desktop app, OR")
                click.echo("  2. Run: cd backend && python -m backend.main")
                click.echo()
                click.echo("Or use browser testing: centris test . --browser")
                click.echo("Or use mock testing: centris test . --mock")
                sys.exit(1)
            else:
                click.echo(click.style(f"  ✓ {message}", fg="green"))
        click.echo()
    
    async def run_tests() -> list[TestResult]:
        results = []
        for cap_id in cap_ids:
            result = await asyncio.wait_for(
                run_capability_test(
                    connector, 
                    cap_id, 
                    test_params, 
                    browser_mode=browser_mode,
                    backend_url=backend_url,
                    headless=headless,
                ),
                timeout=timeout,
            )
            results.append(result)
        return results
    
    try:
        results = asyncio.run(run_tests())
    except asyncio.TimeoutError:
        if json_out:
            click.echo(json.dumps({"error": "Test timeout", "passed": False}))
        else:
            click.echo(click.style("Test timeout exceeded", fg="red"))
        sys.exit(1)
    
    # Output results
    passed_count = sum(1 for r in results if r.passed)
    total_count = len(results)
    all_passed = passed_count == total_count
    
    if json_out:
        output = {
            "passed": all_passed,
            "mode": browser_mode,
            "summary": {
                "total": total_count,
                "passed": passed_count,
                "failed": total_count - passed_count,
            },
            "results": [
                {
                    "capability_id": r.capability_id,
                    "passed": r.passed,
                    "input": r.input_params,
                    "output": r.output,
                    "error": r.error,
                    "hint": r.hint,
                    "similar_selectors": r.similar_selectors,
                    "duration_ms": round(r.duration_ms, 2),
                    "operations": r.operations if show_ops else None,
                }
                for r in results
            ],
        }
        click.echo(json.dumps(output, indent=2))
    else:
        click.echo("Test Results:")
        click.echo("-" * 50)
        
        for result in results:
            status = "✓" if result.passed else "✗"
            color = "green" if result.passed else "red"
            duration = f"({result.duration_ms:.0f}ms)"
            
            click.echo(f"  {click.style(status, fg=color)} {result.capability_id} {duration}")
            
            if verbose:
                click.echo(f"    Input: {json.dumps(result.input_params)}")
                if result.passed:
                    click.echo(f"    Output: {json.dumps(result.output)}")
            
            # Show error with actionable hint
            if result.error:
                click.echo(click.style(f"    Error: {result.error}", fg="red"))
                
                # Show hint - this is the actionable part
                if result.hint:
                    click.echo(click.style(f"    Hint: {result.hint}", fg="yellow"))
                
                # Show similar selectors found
                if result.similar_selectors:
                    click.echo(click.style("    Similar selectors found:", fg="cyan"))
                    for sel in result.similar_selectors[:5]:
                        click.echo(f"      • {sel}")
            
            # Show browser operations if requested
            if show_ops and result.operations:
                click.echo(click.style("    Browser Operations:", fg="cyan"))
                for op in result.operations:
                    if isinstance(op, dict):
                        action = op.get('action', 'unknown')
                        args = op.get('args', {})
                        success = op.get('success', True)
                    else:
                        action = getattr(op, 'action', 'unknown')
                        args = getattr(op, 'args', {})
                        success = getattr(op, 'success', True)
                    
                    args_str = ', '.join(f'{k}={v!r}' for k, v in args.items())
                    op_status = click.style("✓", fg="green") if success else click.style("✗", fg="red")
                    click.echo(f"      {op_status} {action}({args_str})")
        
        click.echo("-" * 50)
        click.echo(f"Total: {total_count} | Passed: {passed_count} | Failed: {total_count - passed_count}")
        click.echo()
        
        if all_passed:
            click.echo(click.style("✓ All tests passed!", fg="green", bold=True))
            if browser_mode == "browser":
                click.echo(click.style("  Selectors verified in real browser", fg="green"))
        else:
            click.echo(click.style("✗ Some tests failed!", fg="red", bold=True))
            if browser_mode == "mock":
                click.echo()
                click.echo(click.style("Tip: Mock tests only check syntax.", fg="yellow"))
                click.echo(click.style("     Run with --browser to verify selectors exist:", fg="yellow"))
                click.echo(click.style("     centris test . --browser", fg="cyan"))
            sys.exit(1)
