"""
Centris SDK CLI - Authentication

Handles authentication for the Centris CLI:
- Browser-based OAuth login (opens browser, receives callback)
- Token storage (~/.centris/credentials.json)
- API key management

Philosophy: Zero friction - auth only when needed (publishing)
"""

import click
import json
import os
import sys
import webbrowser
import http.server
import urllib.parse
import threading
import time
from pathlib import Path
from typing import Optional, Dict, Any
from datetime import datetime, timedelta

# Where we store credentials
CREDENTIALS_PATH = os.path.expanduser("~/.centris/credentials.json")
AUTH_URL = os.environ.get("CENTRIS_AUTH_URL", "https://centris.ai/auth/cli")
DEFAULT_REGISTRY_URL = os.environ.get("CENTRIS_REGISTRY_URL", "https://registry.centris.ai")


def get_credentials_path() -> Path:
    """Get the credentials file path, creating directory if needed."""
    path = Path(CREDENTIALS_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def load_credentials() -> Optional[Dict[str, Any]]:
    """Load saved credentials if they exist and are valid."""
    path = get_credentials_path()
    
    if not path.exists():
        return None
    
    try:
        with open(path) as f:
            creds = json.load(f)
        
        # Check if token is expired
        expires_at = creds.get("expires_at")
        if expires_at:
            exp_time = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            if exp_time < datetime.now(exp_time.tzinfo):
                return None  # Token expired
        
        return creds
    except Exception:
        return None


def save_credentials(creds: Dict[str, Any]) -> None:
    """Save credentials to disk."""
    path = get_credentials_path()
    
    with open(path, "w") as f:
        json.dump(creds, f, indent=2)
    
    # Set restrictive permissions (owner read/write only)
    os.chmod(path, 0o600)


def clear_credentials() -> None:
    """Clear saved credentials."""
    path = get_credentials_path()
    if path.exists():
        path.unlink()


def get_token() -> Optional[str]:
    """Get access token if available.
    
    Priority:
    1. CENTRIS_API_KEY environment variable
    2. Saved credentials file
    
    Returns None if not authenticated.
    """
    # Check environment variable first
    env_key = os.environ.get("CENTRIS_API_KEY")
    if env_key:
        return env_key
    
    # Check saved credentials
    creds = load_credentials()
    if creds:
        return creds.get("access_token")
    
    return None


def is_authenticated() -> bool:
    """Check if user is authenticated."""
    return get_token() is not None


class OAuthCallbackHandler(http.server.BaseHTTPRequestHandler):
    """Handle OAuth callback from browser."""
    
    token = None
    error = None
    
    def do_GET(self):
        """Handle GET request (OAuth callback)."""
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        
        if "token" in params:
            OAuthCallbackHandler.token = params["token"][0]
            self.send_response(200)
            self.send_header("Content-type", "text/html")
            self.end_headers()
            self.wfile.write(b"""
                <html>
                <head><title>Centris CLI</title></head>
                <body style="font-family: -apple-system, sans-serif; text-align: center; padding: 50px;">
                    <h1>Authentication Successful!</h1>
                    <p>You can close this window and return to the terminal.</p>
                    <script>window.close();</script>
                </body>
                </html>
            """)
        elif "error" in params:
            OAuthCallbackHandler.error = params.get("error_description", params["error"])[0]
            self.send_response(400)
            self.send_header("Content-type", "text/html")
            self.end_headers()
            self.wfile.write(f"""
                <html>
                <head><title>Centris CLI - Error</title></head>
                <body style="font-family: -apple-system, sans-serif; text-align: center; padding: 50px;">
                    <h1>Authentication Failed</h1>
                    <p>{OAuthCallbackHandler.error}</p>
                    <p>Please try again in the terminal.</p>
                </body>
                </html>
            """.encode())
        else:
            self.send_response(400)
            self.send_header("Content-type", "text/plain")
            self.end_headers()
            self.wfile.write(b"Invalid callback")
    
    def log_message(self, format, *args):
        """Suppress logging."""
        pass


def browser_login(timeout: int = 120) -> Optional[Dict[str, Any]]:
    """Perform browser-based OAuth login.
    
    1. Starts local server to receive callback
    2. Opens browser to auth URL
    3. Waits for callback with token
    4. Returns credentials dict
    """
    # Find available port
    import socket
    sock = socket.socket()
    sock.bind(('', 0))
    port = sock.getsockname()[1]
    sock.close()
    
    callback_url = f"http://localhost:{port}/callback"
    
    # Build auth URL
    auth_params = urllib.parse.urlencode({
        "callback": callback_url,
        "client": "cli",
    })
    full_auth_url = f"{AUTH_URL}?{auth_params}"
    
    # Reset handler state
    OAuthCallbackHandler.token = None
    OAuthCallbackHandler.error = None
    
    # Start server in background
    server = http.server.HTTPServer(('localhost', port), OAuthCallbackHandler)
    server_thread = threading.Thread(target=server.handle_request)
    server_thread.daemon = True
    server_thread.start()
    
    # Open browser
    click.echo(f"Opening browser for authentication...")
    click.echo(f"If browser doesn't open, visit: {full_auth_url}")
    click.echo()
    
    webbrowser.open(full_auth_url)
    
    # Wait for callback
    start = time.time()
    while time.time() - start < timeout:
        if OAuthCallbackHandler.token or OAuthCallbackHandler.error:
            break
        time.sleep(0.5)
    
    server.server_close()
    
    if OAuthCallbackHandler.error:
        raise ValueError(f"Authentication failed: {OAuthCallbackHandler.error}")
    
    if not OAuthCallbackHandler.token:
        raise TimeoutError("Authentication timed out. Please try again.")
    
    # Parse token (might be JWT or API key)
    token = OAuthCallbackHandler.token
    
    # Create credentials dict
    creds = {
        "access_token": token,
        "created_at": datetime.utcnow().isoformat() + "Z",
        "expires_at": (datetime.utcnow() + timedelta(days=30)).isoformat() + "Z",
    }
    
    return creds


def ensure_authenticated(auto_login: bool = True) -> str:
    """Ensure user is authenticated, prompting login if needed.
    
    Args:
        auto_login: If True, automatically open browser for login
        
    Returns:
        Access token
        
    Raises:
        click.ClickException if not authenticated and auto_login is False
    """
    token = get_token()
    
    if token:
        return token
    
    if not auto_login:
        raise click.ClickException(
            "Not authenticated. Run 'centris login' or set CENTRIS_API_KEY"
        )
    
    # Auto-login flow
    click.echo("Authentication required for this action.")
    click.echo()
    
    try:
        creds = browser_login()
        save_credentials(creds)
        click.echo(click.style("✓ Logged in successfully!", fg="green"))
        click.echo()
        return creds["access_token"]
    except Exception as e:
        raise click.ClickException(f"Login failed: {e}")


# ============================================================================
# CLI Commands
# ============================================================================

@click.command("login")
@click.option("--token", "-t", help="Use existing token instead of browser login")
@click.pass_context
def login_command(ctx: click.Context, token: Optional[str]) -> None:
    """
    Log in to Centris.
    
    Opens your browser to authenticate with Centris. After login,
    your credentials are saved locally for future CLI commands.
    
    Examples:
        centris login                    # Browser login
        centris login --token YOUR_KEY   # Use API key directly
    """
    if token:
        # Direct token auth
        creds = {
            "access_token": token,
            "created_at": datetime.utcnow().isoformat() + "Z",
            "token_type": "api_key",
        }
        save_credentials(creds)
        click.echo(click.style("✓ Credentials saved!", fg="green"))
        return
    
    # Browser login
    try:
        creds = browser_login()
        save_credentials(creds)
        click.echo()
        click.echo(click.style("✓ Logged in successfully!", fg="green"))
        click.echo()
        click.echo("Your credentials have been saved to ~/.centris/credentials.json")
        click.echo("You can now publish connectors with: centris publish .")
    except Exception as e:
        click.echo(click.style(f"Login failed: {e}", fg="red"))
        sys.exit(1)


@click.command("logout")
@click.pass_context
def logout_command(ctx: click.Context) -> None:
    """
    Log out of Centris.
    
    Removes saved credentials from ~/.centris/credentials.json
    """
    if is_authenticated():
        clear_credentials()
        click.echo(click.style("✓ Logged out successfully!", fg="green"))
    else:
        click.echo("Not logged in.")


@click.command("whoami")
@click.pass_context
def whoami_command(ctx: click.Context) -> None:
    """
    Show current authentication status.
    """
    token = get_token()
    
    if not token:
        click.echo("Not logged in.")
        click.echo()
        click.echo("To log in: centris login")
        return
    
    # Show auth info
    creds = load_credentials()
    if creds:
        click.echo(click.style("✓ Authenticated", fg="green"))
        if creds.get("email"):
            click.echo(f"  Email: {creds['email']}")
        if creds.get("created_at"):
            click.echo(f"  Logged in: {creds['created_at'][:10]}")
        if creds.get("expires_at"):
            click.echo(f"  Expires: {creds['expires_at'][:10]}")
    else:
        click.echo(click.style("✓ Authenticated via CENTRIS_API_KEY", fg="green"))


# Auth subcommand group
@click.group("auth")
def auth_group():
    """Authentication commands."""
    pass


auth_group.add_command(login_command, name="login")
auth_group.add_command(logout_command, name="logout")
auth_group.add_command(whoami_command, name="whoami")
