# Centris SDK

[![Tests](https://github.com/centris-ai/centris-ai/actions/workflows/test.yml/badge.svg)](https://github.com/centris-ai/centris-ai/actions/workflows/test.yml)
[![PyPI version](https://badge.fury.io/py/centris-sdk.svg)](https://pypi.org/project/centris-sdk/)
[![Python 3.10+](https://img.shields.io/badge/python-3.10+-blue.svg)](https://www.python.org/downloads/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**For Developers**: Build connectors that make Centris faster and more capable.

> **End users don't need this SDK.** Users just download the Centris app and control their computer with voice - no setup, no configuration, no technical knowledge required. This SDK is for developers who want to extend what voice commands can do.

## What is Centris SDK?

The Centris SDK lets you create **browser automation connectors** - pre-compiled recipes that automate web applications without OAuth or API keys. Your connectors make the invisible system faster - users just speak and things happen.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  BASE CENTRIS (plan-once):            WITH CONNECTOR (compiled recipe):      │
│  ──────────────────────────────────   ─────────────────────────────────     │
│  LLM creates plan → execute (1s)      Execute pre-compiled steps            │
│  DOM-based actions (1-2s total)       Selectors already known               │
│  No screenshots needed                No planning needed                    │
│  1 LLM call for planning              0 LLM calls                           │
│                                                                              │
│  TOTAL: 2-4 seconds                   TOTAL: 1-2 seconds                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

> **Note**: Centris uses DOM/accessibility tree, NOT screenshots. The comparison
> shows that connectors are even faster because they skip the planning step entirely.

## Installation

### One-Liner (Recommended)

```bash
curl -fsSL https://centris.ai/install.sh | bash
```

Or from GitHub:

```bash
curl -fsSL https://raw.githubusercontent.com/centris-ai/centris-ai/main/scripts/install.sh | bash
```

### Fastest dev setup (single command)

```bash
pipx install "centris-sdk[all]"
```

Verify and start:

```bash
centris-py --version
centris-py doctor
centris-py init demo-py --template browser --url https://example.com
cd demo-py
centris-py validate .
centris-py test .
centris-py serve .
```

### pip / pipx

```bash
# Global install (isolated with pipx - recommended)
pipx install centris-sdk[all]

# Or with pip
pip install centris-sdk[all]

# Verify installation
centris-py --version
centris-py doctor
```

### From Source (Development)

```bash
git clone https://github.com/centris-ai/centris-ai.git
cd centris-ai/sdk/python
pip install -e .[all]
```

### Optional Dependencies

Install only what you need:

```bash
pip install centris-sdk              # Core only (CLI + httpx)
pip install centris-sdk[server]      # + FastAPI dev server
pip install centris-sdk[browser]     # + Playwright automation
pip install centris-sdk[desktop]     # + pyautogui desktop control
pip install centris-sdk[cli]         # + rich terminal output
pip install centris-sdk[all]         # Everything
```

### Browser Testing Setup

If you installed `[browser]` or `[all]`, you also need to install Chromium:

```bash
# After pip install, run:
playwright install chromium
```

This enables `centris-py test . --browser` which verifies your selectors work in a real browser.

## Quick Start (5 Minutes)

### 1. Create a Connector

```bash
# Create a browser connector for your app
centris-py init myapp --template browser --url https://myapp.com

cd myapp
```

This creates:

```
myapp/
├── connector.py      # Main implementation (edit this)
├── connector.json    # Metadata
├── pyproject.toml    # Python config
└── README.md         # Documentation
```

### 2. Define Selectors

Edit `connector.py` - add your DOM selectors (use browser DevTools to find them):

```python
class MyAppSelectors:
    """DOM selectors for MyApp - the knowledge that makes your connector fast."""
    SEND_BUTTON = '[data-testid="send"]'
    MESSAGE_INPUT = '[name="message"]'
    SUCCESS_TOAST = '.toast-success'
```

### 3. Implement Tools

Add browser automation recipes:

```python
async def myapp_send_message(tool_call_id, params, context):
    """Send a message - deterministic, no LLM needed."""
    browser = context.get("browser_bridge")

    if not browser:
        return {"success": False, "error": "Browser bridge not available"}

    # Navigate and interact
    await browser.navigate_browser("https://myapp.com")
    await browser.input_text_node(MyAppSelectors.MESSAGE_INPUT, params["message"])
    await browser.click_node(MyAppSelectors.SEND_BUTTON)

    return {"success": True, "message": "Message sent"}
```

### 4. Test Locally

```bash
# Test with mock browser (fast, no setup needed)
centris-py test .

# See browser operations
centris-py test . --show-ops
```

Output:

```
Testing connector at: ./myapp
Using mock browser for testing

Test Results:
--------------------------------------------------
  ✓ myapp_send_message (12ms)
    Browser Operations:
      → navigate_browser(url='https://myapp.com')
      → input_text_node(selector='[name="message"]', text='test_message')
      → click_node(selector='[data-testid="send"]')
--------------------------------------------------
Total: 1 | Passed: 1 | Failed: 0

✓ All tests passed!
```

### 5. Publish

```bash
# Publish to the Centris registry (auto-login on first use)
centris-py publish .
```

Your connector is now available to all Centris users worldwide.

## CLI Reference

| Command                                     | Description                                            |
| ------------------------------------------- | ------------------------------------------------------ |
| `centris-py init <id>`                      | Create new connector project                           |
| `centris-py init <id> --template browser`   | Create browser automation connector                    |
| `centris-py validate [path]`                | Validate connector structure                           |
| `centris-py test [path]`                    | Test with mock browser (fast, syntax only)             |
| `centris-py test [path] --browser`          | Test with real Playwright browser (verifies selectors) |
| `centris-py test [path] --browser --headed` | Real browser with visible window                       |
| `centris-py test [path] --live`             | Test via Centris backend (requires server running)     |
| `centris-py test [path] --show-ops`         | Show browser operations performed                      |
| `centris-py serve [path]`                   | Start dev server with playground                       |
| `centris-py publish [path]`                 | Publish to registry                                    |
| `centris-py search <query>`                 | Search the registry                                    |
| `centris-py list`                           | List available connectors                              |

## Browser Bridge API

The `browser_bridge` is passed to your tool via `context`. It provides these operations:

### Navigation

```python
# Navigate to URL
await browser.navigate_browser("https://example.com")

# Get current tab info
tab = await browser.get_active_tab()
# Returns: {"url": "https://...", "title": "..."}
```

### Clicking

```python
# Click by CSS selector
await browser.click_node('[data-testid="submit"]')

# Click by aria label
await browser.click_node('[aria-label="Send"]')
```

### Typing

```python
# Input text into a field
await browser.input_text_node('[name="email"]', "user@example.com")

# Type at current focus
await browser.type_text("Hello world")

# Press a key
await browser.press_key("Enter")
await browser.press_key("Tab")
```

### Waiting

```python
# Wait for selector to appear
await browser.wait_for_selector('.success-message', timeout=5000)

# Simple delay (milliseconds)
await browser.wait(1000)
```

### Reading Content

```python
# Get page text content
content = await browser.get_page_content()

# Get interactive elements (accessibility tree)
snapshot = await browser.get_interactive_snapshot()
```

## Example: Gmail Connector

Here's a real-world example - the Gmail connector:

```python
"""Gmail Connector - compiled browser automation for Gmail."""

class GmailSelectors:
    """Gmail's DOM selectors - the knowledge that makes this fast."""
    COMPOSE_BUTTON = '[gh="cm"]'
    COMPOSE_TO = '[aria-label="To recipients"]'
    COMPOSE_SUBJECT = '[name="subjectbox"]'
    COMPOSE_BODY = '[aria-label="Message Body"]'
    COMPOSE_SEND = '[aria-label*="Send"]'

async def gmail_send_email(tool_call_id, params, context):
    """Send email via Gmail - 10x faster than LLM-in-loop."""
    browser = context.get("browser_bridge")

    to, subject, body = params["to"], params["subject"], params["body"]

    # Ensure we're on Gmail
    await browser.navigate_browser("https://mail.google.com")
    await browser.wait(2000)

    # Click compose
    await browser.click_node(GmailSelectors.COMPOSE_BUTTON)
    await browser.wait(1000)

    # Fill fields
    await browser.input_text_node(GmailSelectors.COMPOSE_TO, to)
    await browser.input_text_node(GmailSelectors.COMPOSE_SUBJECT, subject)
    await browser.input_text_node(GmailSelectors.COMPOSE_BODY, body)

    # Send
    await browser.click_node(GmailSelectors.COMPOSE_SEND)

    return {"success": True, "message": f"Email sent to {to}"}
```

## Testing

Three testing modes, from fastest to most thorough:

### 1. Mock Testing (Fastest)

```bash
# Fast syntax check - records operations but doesn't verify selectors
centris-py test .

# With verbose output
centris-py test . -v --show-ops
```

**Best for**: Quick iteration during development. Verifies your code runs without errors, but does NOT check if selectors actually exist on the page.

### 2. Real Browser Testing (Recommended)

```bash
# Launches a real Playwright browser - verifies selectors exist
centris-py test . --browser

# Watch the browser (headed mode)
centris-py test . --browser --headed

# Show all operations
centris-py test . --browser --show-ops
```

**Best for**: Validating selectors before publishing. If a selector doesn't exist, you get actionable errors:

```
✗ gmail_send_email (3421ms)
  Error: Failed to click selector '[gh="cm"]' (element not found within timeout)
  Hint: Selector '[gh="cm"]' not found, but found similar: '[gh="mtm"]'. Try updating your selector to match.
  Similar selectors found:
    • [gh="mtm"]
    • [aria-label="Main menu"]
    • [data-testid="compose-button"]
```

**Requires**: `pip install centris-sdk[browser] && playwright install chromium`

### 3. Live Testing (Full Integration)

```bash
# Tests via Centris backend - uses your actual browser session
centris-py test . --live
```

**Best for**: Final validation with real user state. Requires Centris desktop app or backend running.

### Programmatic Testing with pytest

```python
import pytest
from centris_sdk.testing import MockBrowserBridge, PlaywrightBrowserBridge

# Fast mock tests
@pytest.fixture
def mock_browser():
    return MockBrowserBridge(initial_url="https://example.com")

@pytest.mark.asyncio
async def test_send_message_mock(mock_browser):
    from myapp.connector import myapp_send_message

    result = await myapp_send_message(
        "test-1",
        {"message": "Hello, World!"},
        {"browser_bridge": mock_browser}
    )

    assert result["success"] is True

    # Verify browser operations were recorded
    ops = mock_browser.get_operations()
    assert any(op.action == "navigate_browser" for op in ops)
    assert any(op.action == "click_node" for op in ops)

# Real browser tests (slower, but validates selectors)
@pytest.fixture
async def real_browser():
    async with PlaywrightBrowserBridge(headless=True) as browser:
        yield browser

@pytest.mark.asyncio
@pytest.mark.integration
async def test_send_message_real(real_browser):
    from myapp.connector import myapp_send_message

    result = await myapp_send_message(
        "test-1",
        {"message": "Hello, World!"},
        {"browser_bridge": real_browser}
    )

    # If this fails, result contains hint and similar selectors
    if not result.get("success"):
        print(f"Error: {result.get('error')}")
        print(f"Hint: {result.get('hint')}")
        print(f"Similar: {result.get('similar')}")

    assert result["success"] is True
```

## Security Model

Connectors operate within the user's existing browser session:

| What You CAN Access                        | What You CANNOT Access |
| ------------------------------------------ | ---------------------- |
| `browser_bridge` (click, type, navigate)   | Centris core code      |
| `params` (user input for tool call)        | User credentials       |
| `context.config` (your connector's config) | Other connectors' data |
|                                            | Direct filesystem      |
|                                            | Arbitrary JavaScript   |
|                                            | Cookies/localStorage   |

## Why No OAuth?

Traditional integrations (Zapier, etc.) require users to "connect" accounts with OAuth. Centris connectors don't need this because:

1. **User is already logged in** - They're using their browser where they're already authenticated
2. **Browser automation** - Connectors execute actions like a human clicking around
3. **Zero configuration** - Users just talk to Centris, no account linking needed

## Project Structure

A typical connector project:

```
myapp/
├── connector.py        # Main implementation
│   ├── MyAppSelectors  # DOM selectors (the "knowledge")
│   ├── MyAppURLs       # URL patterns
│   ├── myapp_*         # Tool functions (browser automation recipes)
│   ├── MyAppConnectorApi  # Tool registration
│   └── connector       # Exported connector instance
├── connector.json      # Metadata (id, name, version, categories)
├── pyproject.toml      # Python package config
└── README.md           # Documentation
```

## API Versioning

Centris uses date-based API versioning. For stability, always specify a version:

```python
from centris_sdk import Centris

# Explicit version (recommended for production)
centris = Centris(
    api_key="ck_live_xxx",
    api_version="2026-01-30"
)

# Execute commands
result = centris.do("Open Gmail and read my first 3 emails")
```

### CLI with Version

```bash
# Set default version
centris-py config set api_version 2026-01-30

# Per-request version
centris-py do "Open Gmail" --api-version 2026-01-30
```

### Handling Deprecation Warnings

```python
# Register callback for deprecation warnings
centris.on_deprecation(lambda endpoint, sunset, alternative:
    print(f"Warning: {endpoint} deprecated, use {alternative}")
)
```

For full versioning documentation, see:

- [API Migration Guide](../../docs/api/API_MIGRATION_GUIDE.md)
- [API Changelog](../../docs/api/API_CHANGELOG.md)

## Environment Variables

| Variable               | Description            | Default                     |
| ---------------------- | ---------------------- | --------------------------- |
| `CENTRIS_API_KEY`      | API key for publishing | None                        |
| `CENTRIS_API_VERSION`  | Default API version    | Current stable              |
| `CENTRIS_REGISTRY_URL` | Custom registry URL    | https://registry.centris.ai |
| `CENTRIS_DEBUG`        | Enable debug logging   | false                       |

## Documentation

### Essential Reading

| Document                                                           | Purpose                                                     |
| ------------------------------------------------------------------ | ----------------------------------------------------------- |
| **[docs/index.md](./docs/index.md)**                               | **SDK docs map** - Python SDK modules (client, CLI, API)    |
| [docs/cli-command-matrix.md](./docs/cli-command-matrix.md)         | Full flag-by-flag CLI command matrix                        |
| [docs/api-endpoints-examples.md](./docs/api-endpoints-examples.md) | End-to-end API request/response examples                    |
| [docs/auth-profile-config.md](./docs/auth-profile-config.md)       | Auth, profile isolation, and config patterns                |
| [docs/errors-troubleshooting.md](./docs/errors-troubleshooting.md) | Error codes and troubleshooting matrix                      |
| **[CONNECTOR_FRAMEWORK.md](./CONNECTOR_FRAMEWORK.md)**             | **START HERE** - Complete framework guide                   |
| [CONNECTOR_DEVELOPMENT.md](./CONNECTOR_DEVELOPMENT.md)             | Detailed integration guide (signatures, browser bridge API) |

---

## Critical Concept: Static vs Dynamic DOM

**This is the most important concept for building connectors.**

### What CAN Be Pre-Mapped (Static DOM)

| Element     | Example                  | Mappable? |
| ----------- | ------------------------ | --------- |
| Buttons     | Compose, Search, Reply   | ✅ Yes    |
| Navigation  | Inbox, Sent, Settings    | ✅ Yes    |
| Form fields | To, Subject, Body inputs | ✅ Yes    |

```python
# ✅ CORRECT - Static UI controls
element_map = {
    "controls": {
        "compose": (1, "clickable", "Compose button"),  # Same for everyone
        "search": (2, "typeable", "Search bar"),        # Same for everyone
    }
}
```

### What CANNOT Be Pre-Mapped (Dynamic DOM)

| Content           | Example           | Mappable? |
| ----------------- | ----------------- | --------- |
| Individual emails | "Email from John" | ❌ No     |
| Calendar events   | "Meeting at 3pm"  | ❌ No     |
| Files in Drive    | "Report.docx"     | ❌ No     |

```python
# ❌ WRONG - Dynamic content, different per user
element_map = {
    "emails": {
        "johns_email": (47, "clickable", "Email from John"),  # ❌ WRONG!
    }
}

# ✅ CORRECT - Use API for dynamic content
async def get_api_context(self, user_id: str) -> Dict[str, Any]:
    return {
        "recent_emails": [
            {"from": "John", "subject": "Project Update"}
        ],
        "hint": "Use search to find specific emails"
    }
```

### The Hybrid Pattern (Gmail, Calendar, Drive)

```
┌─────────────────────────────────────────────────────────────────┐
│ STATIC DOM (element_map)          API CONTEXT (get_api_context) │
│ ─────────────────────────         ───────────────────────────── │
│                                                                  │
│ • Compose button = node 1         • "5 unread emails"           │
│ • Search bar = node 2             • "Latest: John - Project"    │
│ • Reply button = node 30          • "Use search: from:john"     │
│                                                                  │
│ (same for ALL users)              (unique per user via OAuth)   │
└─────────────────────────────────────────────────────────────────┘
```

**Static DOM** tells the LLM **HOW to interact** (click this button).
**API Context** tells the LLM **WHAT exists** (user has email from John).

See [CONNECTOR_FRAMEWORK.md](./CONNECTOR_FRAMEWORK.md) for complete patterns and examples.

## Contributing

1. Fork the repo
2. Create your connector in `connectors/your-app/`
3. Add tests
4. Submit PR

See [CONTRIBUTING.md](https://github.com/centris-ai/sdk/blob/main/CONTRIBUTING.md) for guidelines.

## Support

- [Discord](https://discord.gg/centris) - Join our community
- [GitHub Issues](https://github.com/centris-ai/sdk/issues) - Bug reports
- [Documentation](https://docs.centris.ai/sdk) - Full docs

## License

MIT
