"""
Centris CLI - Run Command

Start the Centris backend server.

Supports dependency injection for testability.
"""

import click
import sys
import os
import signal
from pathlib import Path
from typing import Optional

from centris_sdk.cli.banner import emit_banner
from centris_sdk.cli.theme import theme, symbols, styled_success, styled_error, styled_step
from centris_sdk.cli.progress import Spinner
from centris_sdk.cli.deps import CLIDeps, create_default_deps


# SDK Version (imported from main)
SDK_VERSION = "1.1.0"


def _find_backend_root() -> Optional[Path]:
    """Find the backend directory by searching up from current directory."""
    # Check common locations
    candidates = [
        Path.cwd() / "backend",
        Path.cwd().parent / "backend",
        Path(__file__).resolve().parent.parent.parent.parent.parent.parent / "backend",
    ]
    
    for candidate in candidates:
        if candidate.exists() and (candidate / "main.py").exists():
            return candidate
    
    return None


def _setup_python_path(backend_root: Path) -> None:
    """Add backend to Python path."""
    project_root = backend_root.parent
    if str(project_root) not in sys.path:
        sys.path.insert(0, str(project_root))


def run_server(
    deps: CLIDeps,
    port: Optional[int] = None,
    host: Optional[str] = None,
    debug: Optional[bool] = None,
    reload: bool = False,
    no_audio: bool = False,
    no_banner: bool = False,
) -> int:
    """
    Core server run logic with injectable dependencies.
    
    This function contains the actual implementation, separated from the Click
    command for testability.
    
    Args:
        deps: CLI dependencies
        port: Server port
        host: Bind host
        debug: Enable debug mode
        reload: Enable auto-reload
        no_audio: Disable audio subsystem
        no_banner: Skip startup banner
    
    Returns:
        Exit code (0 for success, 1 for failure)
    """
    console = deps.console
    config_loader = deps.config_loader
    verbose = deps.verbose
    
    # Show banner
    if not no_banner:
        emit_banner(SDK_VERSION)
    
    # Find backend directory
    backend_root = _find_backend_root()
    if not backend_root:
        console.error("Could not find backend directory")
        console.echo(f"  {theme.muted('Looked in:')} {Path.cwd()}")
        console.echo(f"  {theme.muted('Hint:')} Run from project root or set CENTRIS_BACKEND_PATH")
        return 1
    
    # Setup Python path
    _setup_python_path(backend_root)
    
    console.step(1, "Checking environment...")
    
    # Load configuration via deps
    config_loader.load()
    
    # Quick environment check
    try:
        from dotenv import load_dotenv
        env_file = backend_root.parent / ".env"
        if env_file.exists():
            load_dotenv(env_file)
            console.echo(f"  {theme.success(symbols.CHECK)} Loaded .env from {theme.path(str(env_file))}")
        
        backend_env = backend_root / ".env"
        if backend_env.exists():
            load_dotenv(backend_env, override=True)
            console.echo(f"  {theme.success(symbols.CHECK)} Loaded backend/.env")
    except ImportError:
        console.echo(f"  {theme.warn('!')} python-dotenv not installed, skipping .env")
    
    # Check critical env vars
    critical_vars = ["DEEPSEEK_API_KEY", "DEEPGRAM_API_KEY"]
    missing = [v for v in critical_vars if not os.getenv(v)]
    
    if missing:
        console.echo(f"  {theme.warn('!')} Missing: {', '.join(missing)}")
        console.echo(f"  {theme.muted('Some features may not work')}")
    else:
        console.echo(f"  {theme.success(symbols.CHECK)} Required environment variables set")
    
    # Check for config migrations
    try:
        from backend.config.migrations import get_migration_warning, run_startup_migration_check
        run_startup_migration_check(interactive=False, quiet=True)
        
        warning = get_migration_warning()
        if warning:
            console.echo(f"  {theme.warn('!')} {warning}")
        else:
            console.echo(f"  {theme.success(symbols.CHECK)} Config schema is current")
    except ImportError:
        # Migration system not available, skip check
        pass
    except Exception as e:
        console.echo(f"  {theme.warn('!')} Config migration check failed: {e}")
    
    console.echo("")
    console.step(2, "Initializing components...")
    
    # Set environment overrides
    if no_audio:
        os.environ["DISABLE_AUDIO"] = "true"
        console.echo(f"  {theme.muted(symbols.BULLET)} Audio disabled")
    
    if port:
        os.environ["SERVER_PORT"] = str(port)
    if host:
        os.environ["SERVER_HOST"] = host
    if debug is not None:
        os.environ["DEBUG"] = "true" if debug else "false"
    
    # Import and initialize backend
    try:
        from backend.config.settings import get_settings
        settings = get_settings()
        
        # Get effective values
        effective_host = host or settings.server_host
        effective_port = port or settings.server_port
        effective_debug = debug if debug is not None else settings.debug
        
        console.echo(f"  {theme.success(symbols.CHECK)} Settings loaded")
        console.echo(f"  {theme.muted(symbols.BULLET)} LLM Provider: {theme.accent(settings.llm_provider)}")
        console.echo(f"  {theme.muted(symbols.BULLET)} TTS Provider: {theme.accent(settings.tts_provider)}")
        
    except ImportError as e:
        console.error(f"Failed to import backend: {e}")
        console.echo(f"  {theme.muted('Make sure you are in the project directory')}")
        return 1
    except Exception as e:
        console.error(f"Failed to load settings: {e}")
        return 1
    
    console.echo("")
    console.step(3, f"Starting server on {effective_host}:{effective_port}...")
    console.echo("")
    
    # Server info box
    console.echo(f"  {theme.heading('Centris Backend')}")
    console.echo(f"  {theme.muted('─' * 40)}")
    console.echo(f"  {theme.muted('Local:')}    http://{effective_host}:{effective_port}")
    console.echo(f"  {theme.muted('Health:')}   http://{effective_host}:{effective_port}/health")
    console.echo(f"  {theme.muted('API:')}      http://{effective_host}:{effective_port}/api/health/full")
    console.echo(f"  {theme.muted('─' * 40)}")
    console.echo(f"  {theme.muted('Press')} {theme.accent('Ctrl+C')} {theme.muted('to stop')}")
    console.echo("")
    
    # Setup graceful shutdown
    def signal_handler(sig, frame):
        console.echo("")
        console.warn("Shutting down...")
        sys.exit(0)
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    # Start the server
    try:
        from backend.main import app, socketio
        from backend.app.components import initialize_components
        
        # Initialize components (utterance_callback can be None for CLI startup)
        initialize_components(socketio=socketio, utterance_callback=None)
        
        # Run with SocketIO
        socketio.run(
            app,
            host=effective_host,
            port=effective_port,
            debug=effective_debug,
            use_reloader=reload,
            allow_unsafe_werkzeug=True,
        )
        return 0
    except ImportError as e:
        console.error(f"Failed to start server: {e}")
        if verbose:
            import traceback
            traceback.print_exc()
        return 1
    except Exception as e:
        console.error(f"Server error: {e}")
        if verbose:
            import traceback
            traceback.print_exc()
        return 1


@click.command("run")
@click.option("--port", "-p", type=int, default=None, help="Server port (default: 5001)")
@click.option("--host", "-h", default=None, help="Bind host (default: 127.0.0.1)")
@click.option("--debug/--no-debug", default=None, help="Enable debug mode")
@click.option("--reload/--no-reload", default=False, help="Enable auto-reload on changes")
@click.option("--no-audio", is_flag=True, help="Disable audio subsystem")
@click.option("--no-banner", is_flag=True, help="Skip startup banner")
@click.pass_context
def run_command(
    ctx: click.Context,
    port: Optional[int],
    host: Optional[str],
    debug: Optional[bool],
    reload: bool,
    no_audio: bool,
    no_banner: bool,
) -> None:
    """
    Start the Centris backend server.
    
    Starts the Flask/SocketIO server with all components initialized.
    The server provides WebSocket endpoints for real-time communication
    and REST APIs for health checks and management.
    
    Examples:
    
        centris run                    Start with defaults
        
        centris run --port 5001        Custom port
        
        centris run --host 0.0.0.0     Bind to all interfaces
        
        centris run --debug            Enable debug mode
        
        centris run --reload           Auto-reload on code changes
    """
    # Get deps from context or create default
    deps = ctx.obj.get("deps") if ctx.obj else None
    if deps is None:
        deps = create_default_deps(verbose=ctx.obj.get("verbose", False) if ctx.obj else False)
    
    # Check for banner suppression from parent context
    if ctx.obj and ctx.obj.get("no_banner"):
        no_banner = True
    
    # Run the server
    exit_code = run_server(
        deps=deps,
        port=port,
        host=host,
        debug=debug,
        reload=reload,
        no_audio=no_audio,
        no_banner=no_banner,
    )
    
    if exit_code != 0:
        sys.exit(exit_code)
