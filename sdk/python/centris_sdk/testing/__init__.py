"""
Centris SDK Testing Utilities

Provides testing tools for connectors:

- MockBrowserBridge: Fast local testing (records ops, always succeeds)
- PlaywrightBrowserBridge: Real browser testing (verifies selectors exist)
- ConnectorTestHarness: Full test harness for connectors

Usage:
    # Mock testing (fast, no browser needed)
    from centris_sdk.testing import MockBrowserBridge
    
    bridge = MockBrowserBridge()
    await bridge.click_node('[data-testid="send"]')  # Always succeeds
    
    # Real browser testing (verifies selectors)
    from centris_sdk.testing import PlaywrightBrowserBridge
    
    async with PlaywrightBrowserBridge() as bridge:
        result = await bridge.click_node('[data-testid="send"]')
        if not result["success"]:
            print(result["error"])  # "Selector not found"
            print(result["hint"])   # How to fix it
            print(result["similar"]) # Similar elements found
"""

from .mock_browser import MockBrowserBridge
from .test_harness import ConnectorTestHarness
from .fixtures import (
    create_test_context,
    mock_browser_session,
    mock_gmail_page,
    mock_slack_page,
)

# Playwright is optional - installed with centris-sdk[browser]
try:
    from .playwright_browser import (
        PlaywrightBrowserBridge,
        BrowserOperation,
        SelectorDiagnostic,
        create_browser,
        is_playwright_available,
    )
    _PLAYWRIGHT_EXPORTS = [
        'PlaywrightBrowserBridge',
        'BrowserOperation',
        'SelectorDiagnostic',
        'create_browser',
        'is_playwright_available',
    ]
except ImportError:
    # Playwright not installed
    PlaywrightBrowserBridge = None
    BrowserOperation = None
    SelectorDiagnostic = None
    create_browser = None
    
    def is_playwright_available():
        return False
    
    _PLAYWRIGHT_EXPORTS = ['is_playwright_available']

__all__ = [
    'MockBrowserBridge',
    'ConnectorTestHarness',
    'create_test_context',
    'mock_browser_session',
    'mock_gmail_page',
    'mock_slack_page',
    *_PLAYWRIGHT_EXPORTS,
]
