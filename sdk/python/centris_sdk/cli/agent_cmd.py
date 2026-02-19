"""
Centris CLI Agent Command

Execute agent tasks directly from the command line.
Connects to the Centris backend to run multi-agent orchestration.

Examples:
    centris agent "Open Gmail and read my latest email"
    centris agent "Create a Python script that lists files" --session myproject
    centris agent --no-stream "What time is it?"
    centris agent --json "List files in ~/Documents"
"""

import asyncio
import json
import sys
import time
import uuid
from typing import Any, Callable, Dict, Optional

import click

from centris_sdk.cli.deps import CLIDeps, create_default_deps
from centris_sdk.cli.theme import theme, symbols
from centris_sdk.cli.progress import Spinner, with_progress
from centris_sdk.cli.errors import CentrisCLIError, ExitCode


def generate_session_id() -> str:
    """Generate a unique session ID for agent execution."""
    return f"cli_{uuid.uuid4().hex[:12]}_{int(time.time())}"


class AgentClient:
    """
    Client for interacting with the Centris agent backend.
    
    Provides methods to execute tasks via the multi-agent orchestrator,
    with support for both streaming and synchronous execution.
    """
    
    def __init__(self, base_url: str = "http://127.0.0.1:5001"):
        self.base_url = base_url
    
    async def execute_streaming(
        self,
        instruction: str,
        session_id: Optional[str] = None,
        stream_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
        enable_voice: bool = False,
    ) -> Dict[str, Any]:
        """
        Execute a task with streaming updates.
        
        Args:
            instruction: The task instruction to execute
            session_id: Optional session ID for context continuity
            stream_callback: Callback for streaming updates
            enable_voice: Enable voice synthesis for responses
            
        Returns:
            Execution result with success status, response, and tool calls
        """
        try:
            import httpx
        except ImportError:
            raise CentrisCLIError(
                "httpx is required for agent execution. Install with: pip install httpx",
                code="missing_dependency",
            )
        
        session_id = session_id or generate_session_id()
        
        async with httpx.AsyncClient(timeout=httpx.Timeout(300.0)) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/api/task/execute-stream",
                json={
                    "instruction": instruction,
                    "session_id": session_id,
                    "enable_voice": enable_voice,
                },
            ) as response:
                if response.status_code != 200:
                    error_text = await response.aread()
                    raise CentrisCLIError(
                        f"Agent execution failed: {error_text.decode()}",
                        code="execution_failed",
                    )
                
                result = None
                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        try:
                            data = json.loads(line[6:])
                            
                            if stream_callback:
                                stream_callback(data)
                            
                            if data.get("type") == "complete":
                                result = data.get("result", {})
                            elif data.get("type") == "error":
                                raise CentrisCLIError(
                                    data.get("message", "Unknown error"),
                                    code=data.get("code", "execution_error"),
                                )
                        except json.JSONDecodeError:
                            pass
                
                return result or {"success": False, "error": "No result received"}
    
    async def execute_sync(
        self,
        instruction: str,
        session_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Execute a task synchronously (no streaming).
        
        Collects all updates and returns the final result.
        """
        updates = []
        
        def collect_updates(update: Dict[str, Any]):
            updates.append(update)
        
        result = await self.execute_streaming(
            instruction=instruction,
            session_id=session_id,
            stream_callback=collect_updates,
        )
        
        return {
            **result,
            "updates": updates,
        }
    
    def is_backend_available(self) -> bool:
        """Check if the backend server is available."""
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


def format_streaming_update(update: Dict[str, Any], verbose: bool = False) -> Optional[str]:
    """
    Format a streaming update for CLI display.
    
    Args:
        update: The update data from the backend
        verbose: Show all update types (not just key events)
        
    Returns:
        Formatted string or None if update should be skipped
    """
    update_type = update.get("type", "")
    
    if update_type == "status":
        message = update.get("message", "")
        return f"{theme.muted('→')} {message}"
    
    elif update_type == "tool_call":
        tool_name = update.get("tool_name", "unknown")
        message = update.get("message", "")
        return f"{theme.accent('⚙')} {theme.heading(tool_name)}: {message}"
    
    elif update_type == "tool_result":
        success = update.get("success", False)
        message = update.get("message", "")
        if success:
            return f"  {theme.success(symbols.CHECK)} {message}"
        else:
            return f"  {theme.error(symbols.CROSS)} {message}"
    
    elif update_type == "thinking":
        if verbose:
            content = update.get("content", "")[:100]
            return f"{theme.muted('🤔')} {theme.muted(content)}..."
        return None
    
    elif update_type == "agent_switch":
        agent = update.get("agent", "")
        return f"\n{theme.info('Agent:')} {theme.heading(agent)}"
    
    elif update_type == "error":
        message = update.get("message", "")
        return f"{theme.error(symbols.CROSS)} Error: {message}"
    
    elif verbose:
        # Show all updates in verbose mode
        return f"{theme.muted(f'[{update_type}]')} {json.dumps(update)[:80]}"
    
    return None


@click.command(name="agent")
@click.argument("instruction", required=False)
@click.option("--session", "-s", help="Session ID for context continuity")
@click.option("--stream/--no-stream", default=True, help="Stream output (default: stream)")
@click.option("--voice", is_flag=True, help="Enable voice synthesis for responses")
@click.option("--json", "json_output", is_flag=True, help="Output as JSON")
@click.option("--verbose", "-v", is_flag=True, help="Show all updates including thinking")
@click.option("--sandbox", is_flag=True, help="Run in sandboxed container (for research/scaling)")
@click.option("--parallel", "-p", type=int, default=1, help="Number of parallel instances (requires --sandbox)")
@click.option("--headless/--no-headless", default=True, help="Run browsers in headless mode (with --sandbox)")
@click.option("--backend-url", default="http://127.0.0.1:5001", help="Backend server URL")
@click.pass_context
def agent_command(
    ctx: click.Context,
    instruction: Optional[str],
    session: Optional[str],
    stream: bool,
    voice: bool,
    json_output: bool,
    verbose: bool,
    sandbox: bool,
    parallel: int,
    headless: bool,
    backend_url: str,
):
    """
    Execute an agent task.
    
    Run commands on your computer through the Centris multi-agent system.
    The agent can browse the web, control your desktop, and manage files.
    
    \b
    MODES:
      Default:     Uses your REAL Chrome browser via the extension
      --sandbox:   Uses Docker containers with headless browsers (for scaling)
    
    \b
    Examples:
      centris agent "Open Gmail and read my latest email"
      centris agent "Create a file called notes.txt with today's date"
      centris agent --session myproject "Continue working on the bug fix"
      
      # Sandboxed research (doesn't affect your browser)
      centris agent --sandbox "Research AI trends and summarize"
      centris agent --sandbox --parallel 5 "Find pricing for these 10 products"
    
    \b
    Options:
      --session/-s     Reuse a session for context continuity
      --no-stream      Wait for completion instead of streaming
      --voice          Enable voice synthesis for responses
      --json           Output result as JSON (useful for scripting)
      --verbose/-v     Show all updates including agent thinking
      
    \b
    Sandbox Options (for research/scaling):
      --sandbox        Run in Docker container with headless browser
      --parallel/-p N  Spawn N parallel instances (requires --sandbox)
      --no-headless    Show browser window (for debugging)
    
    \b
    Docs: https://docs.centris.ai/sdk/cli/agent
    """
    # Get JSON output from context if not set via flag
    json_output = json_output or ctx.obj.get("json_output", False)
    verbose = verbose or ctx.obj.get("verbose", False)
    
    # Read instruction from stdin if not provided
    if not instruction:
        if sys.stdin.isatty():
            click.echo(theme.error("Error: No instruction provided"))
            click.echo(theme.muted("Usage: centris agent \"your instruction\""))
            click.echo(theme.muted("       echo 'instruction' | centris agent"))
            ctx.exit(ExitCode.ERROR)
        else:
            instruction = sys.stdin.read().strip()
            if not instruction:
                click.echo(theme.error("Error: No instruction received from stdin"))
                ctx.exit(ExitCode.ERROR)
    
    # Create agent client
    client = AgentClient(base_url=backend_url)
    
    # Check backend availability
    if not client.is_backend_available():
        if json_output:
            click.echo(json.dumps({
                "success": False,
                "error": "Backend server not available",
                "hint": "Start the backend with: centris start",
            }))
        else:
            click.echo(f"{theme.error(symbols.CROSS)} Backend server not available")
            click.echo(f"{theme.muted('Start it with:')} centris start")
        ctx.exit(ExitCode.ERROR)
    
    # Validate sandbox options
    if parallel > 1 and not sandbox:
        click.echo(f"{theme.error(symbols.CROSS)} --parallel requires --sandbox")
        click.echo(f"{theme.muted('Usage:')} centris agent --sandbox --parallel 3 \"your task\"")
        ctx.exit(ExitCode.ERROR)
    
    # Sandbox mode execution
    if sandbox:
        async def run_sandboxed():
            """Run agent task in sandboxed container(s)."""
            try:
                from backend.agent.multi_agent.container_manager import get_container_manager
                manager = get_container_manager()
            except ImportError:
                return {
                    "success": False, 
                    "error": "Container manager not available. Run from project root.",
                }
            
            # Check Docker
            if not manager.is_docker_available():
                return {
                    "success": False,
                    "error": "Docker is not available",
                    "hint": "Install Docker: https://docs.docker.com/get-docker/",
                }
            
            if parallel > 1:
                # Parallel execution with research pool
                if not json_output:
                    click.echo(f"\n{theme.heading('Centris Agent (Sandbox Mode)')}")
                    click.echo(f"{theme.muted('Task:')} {instruction}")
                    click.echo(f"{theme.muted('Mode:')} Parallel research ({parallel} instances)")
                    click.echo(f"{theme.muted('Headless:')} {'Yes' if headless else 'No'}\n")
                
                # Spawn research pool
                with Spinner(f"Spawning {parallel} browser containers...") as spinner:
                    browsers = await manager.spawn_research_pool(
                        count=parallel,
                        base_session=session or "research",
                        headless=headless,
                    )
                    spinner.success(f"Spawned {len(browsers)} containers")
                
                if not browsers:
                    return {"success": False, "error": "Failed to spawn research containers"}
                
                # Execute task in parallel
                results = []
                with Spinner(f"Executing research tasks...") as spinner:
                    # For now, execute the same task in each container
                    # TODO: Support task splitting for parallel execution
                    for browser in browsers:
                        result = await client.execute_sync(
                            instruction=instruction,
                            session_id=browser.session_key,
                        )
                        results.append(result)
                    spinner.success(f"Completed {len(results)} tasks")
                
                # Cleanup
                with Spinner("Cleaning up containers...") as spinner:
                    await manager.cleanup_research_pool(browsers)
                    spinner.success("Containers cleaned up")
                
                # Aggregate results
                successful = sum(1 for r in results if r.get("success"))
                return {
                    "success": successful > 0,
                    "parallel_results": results,
                    "successful_count": successful,
                    "total_count": len(results),
                    "response": f"Completed {successful}/{len(results)} parallel tasks",
                }
            
            else:
                # Single sandbox execution
                if not json_output:
                    click.echo(f"\n{theme.heading('Centris Agent (Sandbox Mode)')}")
                    click.echo(f"{theme.muted('Task:')} {instruction}")
                    click.echo(f"{theme.muted('Mode:')} Single sandboxed instance")
                    click.echo(f"{theme.muted('Headless:')} {'Yes' if headless else 'No'}\n")
                
                session_key = session or f"sandbox_{uuid.uuid4().hex[:8]}"
                
                # Create sandbox container
                with Spinner("Creating sandbox container...") as spinner:
                    container = await manager.ensure_sandbox_container(
                        session_key=session_key,
                        network_enabled=True,  # Research needs network
                    )
                    spinner.success(f"Container ready: {container.name}")
                
                # Create browser container
                with Spinner("Starting headless browser...") as spinner:
                    browser = await manager.ensure_browser_container(
                        session_key=session_key,
                        headless=headless,
                    )
                    spinner.success(f"Browser ready on port {browser.host_cdp_port}")
                
                # Execute task
                # TODO: Route to sandbox browser via CDP bridge
                result = await client.execute_sync(
                    instruction=instruction,
                    session_id=session_key,
                )
                
                return result
        
        # Run sandboxed execution
        try:
            result = asyncio.run(run_sandboxed())
        except KeyboardInterrupt:
            if json_output:
                click.echo(json.dumps({"success": False, "error": "Cancelled by user"}))
            else:
                click.echo(f"\n{theme.warn('!')} Cancelled")
            ctx.exit(ExitCode.CANCELLED)
        
        # Output result
        if json_output:
            click.echo(json.dumps(result, indent=2))
        else:
            if result.get("success"):
                click.echo(f"\n{theme.success(symbols.CHECK)} Task completed")
                if result.get("response"):
                    click.echo(f"\n{theme.heading('Response:')}")
                    click.echo(result.get("response"))
            else:
                click.echo(f"\n{theme.error(symbols.CROSS)} Task failed")
                if result.get("error"):
                    click.echo(f"{theme.muted('Error:')} {result.get('error')}")
                if result.get("hint"):
                    click.echo(f"{theme.muted('Hint:')} {result.get('hint')}")
        
        if not result.get("success"):
            ctx.exit(ExitCode.ERROR)
        return
    
    async def run_agent():
        """Run the agent task."""
        if stream and not json_output:
            # Streaming mode with live updates
            click.echo(f"\n{theme.heading('Centris Agent')}")
            click.echo(f"{theme.muted('Task:')} {instruction}\n")
            
            def display_update(update: Dict[str, Any]):
                formatted = format_streaming_update(update, verbose=verbose)
                if formatted:
                    click.echo(formatted)
            
            try:
                result = await client.execute_streaming(
                    instruction=instruction,
                    session_id=session,
                    stream_callback=display_update,
                    enable_voice=voice,
                )
                
                # Show final result
                click.echo("")
                if result.get("success"):
                    click.echo(f"{theme.success(symbols.CHECK)} Task completed")
                    response = result.get("response", "")
                    if response:
                        click.echo(f"\n{theme.heading('Response:')}")
                        click.echo(response)
                else:
                    click.echo(f"{theme.error(symbols.CROSS)} Task failed")
                    error = result.get("error", "Unknown error")
                    click.echo(f"{theme.muted('Error:')} {error}")
                
                return result
                
            except CentrisCLIError as e:
                click.echo(f"\n{theme.error(symbols.CROSS)} {e.message}")
                return {"success": False, "error": str(e)}
        
        else:
            # Non-streaming or JSON mode
            if not json_output:
                with Spinner("Executing task...") as spinner:
                    try:
                        result = await client.execute_sync(
                            instruction=instruction,
                            session_id=session,
                        )
                        if result.get("success"):
                            spinner.success("Task completed")
                        else:
                            spinner.fail("Task failed")
                        return result
                    except CentrisCLIError as e:
                        spinner.fail(str(e))
                        return {"success": False, "error": str(e)}
            else:
                try:
                    result = await client.execute_sync(
                        instruction=instruction,
                        session_id=session,
                    )
                    return result
                except CentrisCLIError as e:
                    return {"success": False, "error": str(e)}
    
    # Run the async function
    try:
        result = asyncio.run(run_agent())
    except KeyboardInterrupt:
        if json_output:
            click.echo(json.dumps({"success": False, "error": "Cancelled by user"}))
        else:
            click.echo(f"\n{theme.warn('!')} Cancelled")
        ctx.exit(ExitCode.CANCELLED)
    
    # Output JSON if requested
    if json_output:
        # Clean result for JSON output
        output = {
            "success": result.get("success", False),
            "response": result.get("response"),
            "error": result.get("error"),
            "tool_calls": result.get("tool_calls", []),
            "execution_mode": result.get("execution_mode"),
            "session_id": session,
        }
        click.echo(json.dumps(output, indent=2))
    
    # Show final response for non-streaming mode
    if not stream and not json_output:
        response = result.get("response", "")
        if response:
            click.echo(f"\n{theme.heading('Response:')}")
            click.echo(response)
    
    # Exit with appropriate code
    if not result.get("success"):
        ctx.exit(ExitCode.ERROR)


__all__ = ["agent_command", "AgentClient"]
