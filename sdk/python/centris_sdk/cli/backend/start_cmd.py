"""
Centris CLI - Start Command

Alias for 'run' command - starts the Centris backend server.
"""

import click
from centris_sdk.cli.backend.run_cmd import run_command


# Create start as an alias for run
@click.command("start")
@click.option("--port", "-p", type=int, default=None, help="Server port (default: 5001)")
@click.option("--host", "-h", default=None, help="Bind host (default: 127.0.0.1)")
@click.option("--debug/--no-debug", default=None, help="Enable debug mode")
@click.option("--reload/--no-reload", default=False, help="Enable auto-reload on changes")
@click.option("--no-audio", is_flag=True, help="Disable audio subsystem")
@click.option("--no-banner", is_flag=True, help="Skip startup banner")
@click.pass_context
def start_command(ctx, port, host, debug, reload, no_audio, no_banner):
    """
    Start the Centris backend server.
    
    This is an alias for 'centris run'.
    
    Examples:
    
        centris start                   Start with defaults
        
        centris start --port 5001       Custom port
        
        centris start --debug           Enable debug mode
    """
    # Invoke the run command with the same arguments
    ctx.invoke(
        run_command,
        port=port,
        host=host,
        debug=debug,
        reload=reload,
        no_audio=no_audio,
        no_banner=no_banner,
    )
