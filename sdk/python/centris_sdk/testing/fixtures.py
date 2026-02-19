"""
Test Fixtures for Connector Testing

Pre-configured page states and helpers for common testing scenarios.
"""

from typing import Any, Dict
from .mock_browser import MockBrowserBridge, PageState


def create_test_context(
    browser: MockBrowserBridge,
    config: Dict[str, Any] = None,
) -> Dict[str, Any]:
    """Create a standard test execution context.
    
    Args:
        browser: Mock browser bridge instance
        config: Optional connector configuration
        
    Returns:
        Context dict suitable for connector execution
    """
    return {
        "browser_bridge": browser,
        "config": config or {},
        "connector_id": "test_connector",
    }


def mock_browser_session(url: str = "https://example.com") -> MockBrowserBridge:
    """Create a mock browser with a simple session.
    
    Args:
        url: Initial URL for the session
        
    Returns:
        Configured MockBrowserBridge
    """
    browser = MockBrowserBridge(initial_url=url)
    return browser


# =============================================================================
# GMAIL FIXTURES
# =============================================================================

def mock_gmail_page() -> MockBrowserBridge:
    """Create a mock browser configured for Gmail testing.
    
    Returns:
        MockBrowserBridge with Gmail-like state
    """
    browser = MockBrowserBridge(initial_url="https://mail.google.com/mail/u/0/#inbox")
    
    # Configure Gmail page state
    gmail_state = PageState(
        url="https://mail.google.com",
        title="Gmail - Inbox",
        content="Primary | Promotions | Social\n50 conversations",
    )
    
    # Add common Gmail elements
    gmail_elements = {
        '[gh="cm"]': {"role": "button", "text": "Compose"},
        '[aria-label="To recipients"]': {"role": "textbox", "text": ""},
        '[name="subjectbox"]': {"role": "textbox", "text": ""},
        '[aria-label="Message Body"]': {"role": "textbox", "text": ""},
        '[aria-label*="Send"]': {"role": "button", "text": "Send"},
        '[aria-label="Reply"]': {"role": "button", "text": "Reply"},
        '[aria-label="Archive"]': {"role": "button", "text": "Archive"},
        '[aria-label="Delete"]': {"role": "button", "text": "Delete"},
        '[aria-label="Search mail"]': {"role": "textbox", "text": ""},
        '[data-tooltip="Inbox"]': {"role": "link", "text": "Inbox"},
        '[data-tooltip="Sent"]': {"role": "link", "text": "Sent"},
        '[data-tooltip="Drafts"]': {"role": "link", "text": "Drafts"},
    }
    
    for selector, props in gmail_elements.items():
        gmail_state.elements[selector] = props
    
    browser.set_page_state("https://mail.google.com", gmail_state)
    
    return browser


# =============================================================================
# SLACK FIXTURES
# =============================================================================

def mock_slack_page() -> MockBrowserBridge:
    """Create a mock browser configured for Slack testing.
    
    Returns:
        MockBrowserBridge with Slack-like state
    """
    browser = MockBrowserBridge(initial_url="https://app.slack.com/client/T12345/C67890")
    
    slack_state = PageState(
        url="https://app.slack.com",
        title="Slack - Workspace",
        content="#general channel content here",
    )
    
    # Add common Slack elements
    slack_elements = {
        '[data-qa="message-input"]': {"role": "textbox", "text": ""},
        '[data-qa="texty_send_button"]': {"role": "button", "text": "Send"},
        '[data-qa="channel_sidebar_name_general"]': {"role": "link", "text": "#general"},
        '[data-qa="channel_sidebar_name_random"]': {"role": "link", "text": "#random"},
        '[data-qa="new_message_button"]': {"role": "button", "text": "New message"},
        '[aria-label="Add reaction"]': {"role": "button", "text": "Add reaction"},
        '[data-qa="threads_view_link"]': {"role": "link", "text": "Threads"},
    }
    
    for selector, props in slack_elements.items():
        slack_state.elements[selector] = props
    
    browser.set_page_state("https://app.slack.com", slack_state)
    
    return browser


# =============================================================================
# GOOGLE CALENDAR FIXTURES
# =============================================================================

def mock_calendar_page() -> MockBrowserBridge:
    """Create a mock browser configured for Google Calendar testing.
    
    Returns:
        MockBrowserBridge with Calendar-like state
    """
    browser = MockBrowserBridge(initial_url="https://calendar.google.com/calendar/u/0/r")
    
    calendar_state = PageState(
        url="https://calendar.google.com",
        title="Google Calendar",
        content="January 2026",
    )
    
    # Add common Calendar elements
    calendar_elements = {
        '[aria-label="Create"]': {"role": "button", "text": "Create"},
        '[aria-label="Title"]': {"role": "textbox", "text": ""},
        '[aria-label="Add guests"]': {"role": "textbox", "text": ""},
        '[aria-label="Add description"]': {"role": "textbox", "text": ""},
        '[aria-label="Save"]': {"role": "button", "text": "Save"},
        '[aria-label="Date"]': {"role": "button", "text": "January 28, 2026"},
        '[aria-label="Start time"]': {"role": "button", "text": "9:00 AM"},
        '[aria-label="End time"]': {"role": "button", "text": "10:00 AM"},
    }
    
    for selector, props in calendar_elements.items():
        calendar_state.elements[selector] = props
    
    browser.set_page_state("https://calendar.google.com", calendar_state)
    
    return browser


# =============================================================================
# NOTION FIXTURES
# =============================================================================

def mock_notion_page() -> MockBrowserBridge:
    """Create a mock browser configured for Notion testing.
    
    Returns:
        MockBrowserBridge with Notion-like state
    """
    browser = MockBrowserBridge(initial_url="https://www.notion.so/workspace")
    
    notion_state = PageState(
        url="https://www.notion.so",
        title="Notion - Workspace",
        content="Welcome to Notion",
    )
    
    # Add common Notion elements
    notion_elements = {
        '[data-testid="new-page-button"]': {"role": "button", "text": "New page"},
        '[placeholder="Untitled"]': {"role": "textbox", "text": ""},
        '[data-testid="sidebar-search"]': {"role": "button", "text": "Search"},
        '.notion-text-block': {"role": "textbox", "text": ""},
    }
    
    for selector, props in notion_elements.items():
        notion_state.elements[selector] = props
    
    browser.set_page_state("https://www.notion.so", notion_state)
    
    return browser
