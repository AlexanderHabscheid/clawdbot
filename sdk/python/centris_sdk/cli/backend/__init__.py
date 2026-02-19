"""
Centris CLI Backend Commands

Commands for managing the Centris backend server.

Available commands:
    run       - Start the backend server
    start     - Alias for run
    stop      - Stop the backend server
    doctor    - Check installation health
    status    - Show server status
    config    - Show/manage configuration
    onboard   - Interactive setup wizard
"""

import click


def register_backend_commands(cli: click.Group) -> None:
    """
    Register all backend management commands.
    
    Args:
        cli: The main CLI group to register commands on
    """
    from .run_cmd import run_command
    from .start_cmd import start_command
    from .stop_cmd import stop_command
    from .doctor_cmd import doctor_command
    from .status_cmd import status_command
    from .config_cmd import config_group
    from .onboard_cmd import onboard_command
    
    # Server management
    cli.add_command(run_command, name="run")
    cli.add_command(start_command, name="start")
    cli.add_command(stop_command, name="stop")
    
    # Diagnostics
    cli.add_command(doctor_command, name="doctor")
    cli.add_command(status_command, name="status")
    
    # Configuration
    cli.add_command(config_group, name="config")
    
    # Setup
    cli.add_command(onboard_command, name="onboard")


__all__ = ["register_backend_commands"]
