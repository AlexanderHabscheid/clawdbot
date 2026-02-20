"""centris do - Execute commands via Centris API.

The simplest way to use Centris:

    centris do "Open Gmail and read my first 3 emails"
    
That's it. One command, infinite power.

Examples:
    # Basic usage
    centris do "Open Gmail"
    centris do "Search for flights to Paris"
    centris do "Read the first email in my inbox"
    
    # With output format
    centris do "What's on my screen?" --json
    
    # Async mode (for long tasks)
    centris do "Research AI trends and write a summary" --async
    
    # Using a specific API key
    centris do "Open Gmail" --key ck_live_xxx
"""

import click
import json
import time
from typing import Optional

from centris_sdk.cli.deps import CLIDeps
from centris_sdk.cli.theme import theme
from centris_sdk.cli.errors import CentrisCLIError, ExitCode
from centris_sdk.cli.result_envelope import build_result_envelope, emit_result_envelope


def _get_api_key(ctx: click.Context, key_override: Optional[str] = None) -> str:
    """Get API key from override, env, or config."""
    if key_override:
        return key_override
    
    import os
    
    # Check environment
    env_key = os.environ.get('CENTRIS_API_KEY')
    if env_key:
        return env_key
    
    # Check config file
    deps: CLIDeps = ctx.obj.get("deps")
    if deps:
        config_key = deps.config_loader.get("CENTRIS_API_KEY")
        if config_key:
            return config_key
    
    # Generate a test key for local development
    return "ck_test_local_development"


def _get_api_url(ctx: click.Context) -> str:
    """Get API URL from config or default."""
    import os
    
    # Check environment
    url = os.environ.get('CENTRIS_API_URL')
    if url:
        return url
    
    # Check if backend is running locally
    deps: CLIDeps = ctx.obj.get("deps")
    if deps:
        config_url = deps.config_loader.get("CENTRIS_API_URL")
        if config_url:
            return config_url
    
    # Default to local
    return "http://localhost:7777"


@click.command("do")
@click.argument("command", required=True)
@click.option("--key", "-k", help="API key (or set CENTRIS_API_KEY)")
@click.option("--async", "is_async", is_flag=True, help="Run asynchronously (returns task ID)")
@click.option("--json", "json_output", is_flag=True, help="Output as JSON")
@click.option("--timeout", "-t", default=120, help="Timeout in seconds (default: 120)")
@click.option("--poll", "-p", default=2, help="Poll interval for async tasks (default: 2s)")
@click.pass_context
def do_command(
    ctx: click.Context,
    command: str,
    key: Optional[str],
    is_async: bool,
    json_output: bool,
    timeout: int,
    poll: int,
):
    """Execute a command via Centris.
    
    The simplest way to use Centris - just tell it what to do.
    
    Examples:
    
        centris do "Open Gmail"
        
        centris do "Read my first 3 emails"
        
        centris do "Search for flights to Paris on Google"
    """
    import httpx
    started_at = time.time()
    
    api_key = _get_api_key(ctx, key)
    api_url = _get_api_url(ctx)
    
    # Show what we're doing
    if not json_output:
        click.echo(f"{theme.muted('→')} {command}")
    
    try:
        # Make request
        with httpx.Client(timeout=timeout) as client:
            response = client.post(
                f"{api_url}/api/v1/do",
                headers={
                    "X-Centris-Key": api_key,
                    "Content-Type": "application/json",
                },
                json={
                    "command": command,
                    "async": is_async,
                },
            )
            
            data = response.json()
            
            # Handle async mode
            if is_async and data.get("status") == "queued":
                task_id = data.get("task_id")
                
                if json_output:
                    emit_result_envelope(
                        build_result_envelope(
                            ok=True,
                            operation="command.do",
                            summary=f"Task queued: {task_id}",
                            data=data if isinstance(data, dict) else {"raw": data},
                            duration_ms=int((time.time() - started_at) * 1000),
                        )
                    )
                    return
                
                click.echo(f"{theme.muted('Task queued:')} {task_id}")
                click.echo(f"{theme.muted('Polling every')} {poll}s...")
                
                # Poll for completion
                start_time = time.time()
                while time.time() - start_time < timeout:
                    time.sleep(poll)
                    
                    poll_response = client.get(
                        f"{api_url}/api/v1/task/{task_id}",
                        headers={"X-Centris-Key": api_key},
                    )
                    poll_data = poll_response.json()
                    
                    status = poll_data.get("status")
                    
                    if status == "completed":
                        data = poll_data
                        break
                    elif status == "failed":
                        data = poll_data
                        break
                    elif status == "running":
                        progress = poll_data.get("progress", "...")
                        click.echo(f"{theme.muted('Running:')} {progress}", nl=False)
                        click.echo("\r", nl=False)
                else:
                    raise CentrisCLIError("Task timed out", exit_code=ExitCode.TIMEOUT)
            
            # Handle response
            if response.status_code == 401:
                raise CentrisCLIError(
                    f"Authentication failed: {data.get('error', 'Invalid API key')}",
                    exit_code=ExitCode.AUTH_ERROR,
                )
            
            if response.status_code == 429:
                raise CentrisCLIError(
                    f"Rate limit: {data.get('error', 'Task limit exceeded')}",
                    exit_code=ExitCode.RATE_LIMITED,
                )
            
            if data.get("status") == "failed":
                error = data.get("error", "Unknown error")
                if json_output:
                    emit_result_envelope(
                        build_result_envelope(
                            ok=False,
                            operation="command.do",
                            summary="Command failed",
                            data=data if isinstance(data, dict) else {"raw": data},
                            errors=[str(error)],
                            duration_ms=int((time.time() - started_at) * 1000),
                        )
                    )
                else:
                    click.echo(f"{theme.error('Error:')} {error}")
                ctx.exit(1)
            
            # Success!
            if json_output:
                emit_result_envelope(
                    build_result_envelope(
                        ok=True,
                        operation="command.do",
                        summary="Command completed",
                        data=data if isinstance(data, dict) else {"raw": data},
                        duration_ms=int((time.time() - started_at) * 1000),
                    )
                )
            else:
                result = data.get("result", "")
                if result:
                    click.echo(f"\n{result}")
                
                # Show usage
                usage = data.get("usage", {})
                remaining = usage.get("remaining", "?")
                click.echo(f"\n{theme.muted(f'Tasks remaining: {remaining}')}")
                
    except httpx.ConnectError:
        # Backend not running - try to execute locally
        if not json_output:
            click.echo(f"{theme.warning('Backend not running, executing locally...')}")
        
        _execute_locally(ctx, command, json_output)
        
    except httpx.TimeoutException:
        raise CentrisCLIError(
            f"Request timed out after {timeout}s",
            exit_code=ExitCode.TIMEOUT,
        )


def _execute_locally(ctx: click.Context, command: str, json_output: bool) -> None:
    """Execute command locally when backend is not running.
    
    Falls back to local orchestrator execution.
    """
    try:
        import asyncio
        import sys
        
        # Add backend to path
        from pathlib import Path
        backend_path = Path(__file__).parent.parent.parent.parent.parent.parent / "backend"
        if backend_path.exists():
            sys.path.insert(0, str(backend_path.parent))
        
        from backend.agent.multi_agent.orchestrator import Orchestrator
        
        orchestrator = Orchestrator()
        
        async def run():
            return await orchestrator.execute(command, context={"source": "cli"})
        
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        
        result = loop.run_until_complete(run())
        
        if json_output:
            import json
            click.echo(json.dumps(result, indent=2))
        else:
            response = result.get("response", "")
            if response:
                click.echo(f"\n{response}")
                
    except ImportError as e:
        raise CentrisCLIError(
            f"Backend not available: {e}\nStart the backend with: centris start",
            exit_code=ExitCode.DEPENDENCY_ERROR,
        )
    except Exception as e:
        raise CentrisCLIError(
            f"Local execution failed: {e}",
            exit_code=ExitCode.EXECUTION_ERROR,
        )
