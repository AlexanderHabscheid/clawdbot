# Centris Connector Framework

Complete guide for building connectors that integrate seamlessly with the Centris agent system.

## Table of Contents

1. [Connector Types](#connector-types)
2. [Static vs Dynamic DOM](#static-vs-dynamic-dom)
3. [When to Use APIs vs DOM Mapping](#when-to-use-apis-vs-dom-mapping)
4. [Connector Architecture Patterns](#connector-architecture-patterns)
5. [Required Structure](#required-structure)
6. [Complete Examples](#complete-examples)
7. [Testing](#testing)
8. [Publishing](#publishing)

---

## Connector Types

Centris supports three connector patterns:

| Pattern                       | Use Case                          | Example                |
| ----------------------------- | --------------------------------- | ---------------------- |
| **Static DOM Only**           | Simple sites with fixed UI        | YC Application form    |
| **API Context Only**          | Services with comprehensive APIs  | Stripe, Twilio         |
| **Hybrid (Static DOM + API)** | Complex apps with dynamic content | Gmail, Google Calendar |

---

## Static vs Dynamic DOM

**This is the most important concept for building connectors.**

### Static DOM (Can Be Pre-Mapped)

Static DOM elements are **UI controls that never change position or exist for all users**:

| Element Type       | Examples                  | Can Pre-Map? |
| ------------------ | ------------------------- | ------------ |
| Navigation buttons | Compose, Search, Settings | ✅ Yes       |
| Menu items         | Inbox, Sent, Drafts       | ✅ Yes       |
| Form controls      | Input fields, dropdowns   | ✅ Yes       |
| Toolbar buttons    | Reply, Forward, Delete    | ✅ Yes       |

```python
# ✅ CORRECT - These are static UI elements, same for everyone
class GmailStaticElements:
    COMPOSE_BUTTON = (1, "clickable", "Compose new email button")
    SEARCH_INPUT = (2, "typeable", "Search bar")
    INBOX_LINK = (3, "clickable", "Inbox folder")
    SETTINGS_GEAR = (4, "clickable", "Settings")
```

### Dynamic DOM (CANNOT Be Pre-Mapped)

Dynamic DOM elements are **content that varies per user and changes over time**:

| Element Type         | Examples                   | Can Pre-Map? |
| -------------------- | -------------------------- | ------------ |
| List items           | Individual emails in inbox | ❌ No        |
| Calendar events      | User's specific events     | ❌ No        |
| File entries         | Files in Drive             | ❌ No        |
| Search results       | Query-specific results     | ❌ No        |
| Conversation threads | Chat messages              | ❌ No        |

```python
# ❌ WRONG - These are dynamic, different for every user
class GmailDynamicElements:
    JOHNS_EMAIL = (47, "clickable", "Email from John")  # ❌ WRONG!
    FIRST_UNREAD = (52, "clickable", "First unread")    # ❌ WRONG!
    PROJECT_EMAIL = (63, "clickable", "Project email")  # ❌ WRONG!
```

**Why can't we map dynamic elements?**

- Node IDs change on every page load
- Email positions change as new mail arrives
- Different users have different emails
- The content is user-specific and time-specific

---

## When to Use APIs vs DOM Mapping

### Decision Tree

```
Is this a UI CONTROL (button, menu, input)?
├── YES → Use Static DOM mapping
│         (compose button, search bar, settings)
│
└── NO → Is this USER CONTENT (emails, events, files)?
         ├── YES → Does the service have an API?
         │         ├── YES → Use API for context
         │         │         (Gmail API, Calendar API, Drive API)
         │         │
         │         └── NO → Let LLM analyze page at runtime
         │                  (no pre-mapping possible)
         │
         └── NO → Probably static, can map
```

### Examples by Service

| Service       | Static DOM (Map These)                  | Dynamic Content (Use API) |
| ------------- | --------------------------------------- | ------------------------- |
| **Gmail**     | Compose, Search, Reply, Forward buttons | User's actual emails      |
| **Calendar**  | Create Event, Today, View buttons       | User's actual events      |
| **Drive**     | New, Upload, My Drive buttons           | User's actual files       |
| **Slack**     | Channel list, Compose, Search           | Messages in channels      |
| **Twitter/X** | Tweet button, Home, Search              | User's timeline posts     |

### The Hybrid Pattern (Recommended for Complex Apps)

For apps like Gmail, Calendar, Drive:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│  STATIC DOM (element_map)              API CONTEXT (get_api_context)    │
│  ─────────────────────────             ─────────────────────────────    │
│                                                                          │
│  • Compose button = node 1             • "5 unread emails"              │
│  • Search input = node 2               • "Latest from: John Smith"      │
│  • Reply button = node 30              • "Subject: Project Update"      │
│  • Settings = node 8                   • "Received: 10 minutes ago"     │
│                                                                          │
│  (same for ALL users)                  (unique per user, via OAuth)     │
│                                                                          │
│                         ↓                                                │
│                                                                          │
│  COMBINED CONTEXT TO LLM:                                               │
│  "Use SEARCH_INPUT (node 2) to search for 'from:john project'.          │
│   User has an email from John Smith about 'Project Update'.             │
│   After opening it, use REPLY_BUTTON (node 30) to respond."             │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Connector Architecture Patterns

### Pattern 1: Static DOM Only

**Use for:** Simple websites with fixed forms and stable UI

```python
@dataclass
class SimpleFormConnector:
    """For sites like YC Application where the form is always the same."""

    id: str = "simple-form"
    name: str = "Simple Form"

    # All elements are static - the form is the same for everyone
    element_map: Dict[str, Any] = field(default_factory=lambda: {
        "form_fields": {
            "name": (10, "typeable", "Name input"),
            "email": (11, "typeable", "Email input"),
            "company": (12, "typeable", "Company input"),
            "submit": (20, "clickable", "Submit button"),
        }
    })
```

### Pattern 2: API Context Only

**Use for:** Services with comprehensive REST APIs

```python
@dataclass
class APIOnlyConnector:
    """For services where API is the primary interaction method."""

    id: str = "api-service"
    name: str = "API Service"

    # No element_map needed - all actions go through API
    task_keywords: List[str] = field(default_factory=lambda: ["api service"])

    async def execute_action(self, user_id: str, action: str, params: dict):
        """All actions go through API, not browser."""
        api_client = self._get_client(user_id)
        return await api_client.execute(action, params)
```

### Pattern 3: Hybrid (Static DOM + API Context)

**Use for:** Complex apps with dynamic content (Gmail, Calendar, Drive, Slack)

```python
@dataclass
class HybridConnector:
    """
    HYBRID PATTERN - The gold standard for complex apps.

    Static DOM: UI controls that never change (buttons, menus)
    API Context: User's actual data (emails, events, files)
    """

    id: str = "hybrid-app"
    name: str = "Hybrid App"

    # ONLY map static UI controls
    element_map: Dict[str, Any] = field(default_factory=lambda: {
        "controls": {
            "compose": (1, "clickable", "Compose button"),
            "search": (2, "typeable", "Search input"),
            "settings": (3, "clickable", "Settings"),
        }
    })

    # API provides dynamic content context
    async def get_api_context(self, user_id: str) -> Dict[str, Any]:
        """
        Fetch user's actual data via API.
        This tells LLM WHAT exists, DOM tells HOW to interact.
        """
        return {
            "inbox": await self._get_inbox_summary(user_id),
            "recent": await self._get_recent_items(user_id),
        }
```

---

## Required Structure

### File Structure

```
connectors/
└── your-connector/
    ├── connector.py      # REQUIRED - Main connector code
    ├── connector.json    # RECOMMENDED - Metadata
    └── README.md         # RECOMMENDED - Documentation
```

### Core Connector Class

```python
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional

@dataclass
class YourConnector:
    """Your connector description."""

    # =========================================================================
    # REQUIRED: Identity
    # =========================================================================
    id: str = "your-connector"
    name: str = "Your Connector"
    version: str = "1.0.0"
    description: str = "What this connector does"
    api: YourConnectorApi = field(default_factory=YourConnectorApi)

    # =========================================================================
    # REQUIRED: How to identify when to use this connector
    # =========================================================================
    task_keywords: List[str] = field(default_factory=lambda: [
        "your app", "your service"
    ])

    url_patterns: List[str] = field(default_factory=lambda: [
        r"yourapp\.com"
    ])

    # =========================================================================
    # FOR STATIC DOM: Only UI controls that never change
    # =========================================================================
    element_map: Dict[str, Any] = field(default_factory=lambda: {
        "controls": {
            # ONLY static buttons, menus, inputs
            "main_button": (1, "clickable", "Main action button"),
            "search": (2, "typeable", "Search input"),
        }
    })

    page_element_sections: Dict[str, List[str]] = field(default_factory=lambda: {
        "home": ["controls"],
    })

    @staticmethod
    def get_page_type(url: str) -> Optional[str]:
        return "home"

    # =========================================================================
    # FOR DYNAMIC CONTENT: Use API to fetch user-specific data
    # =========================================================================
    async def get_api_context(self, user_id: str) -> Dict[str, Any]:
        """
        Override this to fetch dynamic content via API.
        Returns context about user's actual data.
        """
        return {}  # Default: no API context


# REQUIRED: Export at module level
connector = YourConnector()
```

---

## Complete Examples

### Example 1: Static DOM Only (YC Application)

The YC Application form is **always the same structure** for all users - perfect for static DOM mapping.

```python
"""
YC Application Connector

The application form is STATIC - same fields for everyone.
Node IDs captured from Chrome extension work for all users.
"""

@dataclass
class YCApplicationConnector:
    id: str = "yc-application"
    name: str = "YC Application"

    task_keywords: List[str] = field(default_factory=lambda: [
        "yc", "y combinator", "yc application"
    ])

    url_patterns: List[str] = field(default_factory=lambda: [
        r"ycombinator\.com/apply",
        r"apply\.ycombinator\.com"
    ])

    # ALL elements are static - the form is identical for everyone
    element_map: Dict[str, Any] = field(default_factory=lambda: {
        "navigation": {
            "founders": (5, "clickable", "Founders section"),
            "company": (7, "clickable", "Company section"),
            "idea": (9, "clickable", "Idea section"),
        },
        "form_fields": {
            "company_name": (19, "typeable", "Company name input"),
            "company_description": (20, "typeable", "Description"),
            "company_url": (21, "typeable", "Company URL"),
        },
        "actions": {
            "save": (47, "clickable", "Save changes"),
            "preview": (4, "clickable", "Preview application"),
        }
    })

    # No get_api_context needed - everything is static
```

### Example 2: Hybrid Pattern (Google Workspace)

Gmail has **static UI controls** but **dynamic email content** - requires hybrid approach.

```python
"""
Google Workspace Connector - HYBRID PATTERN

Static DOM: Compose button, search bar, folder links (same for everyone)
API Context: User's actual emails, events, files (different per user)

CRITICAL: Do NOT try to map individual emails, events, or files!
Those are dynamic and change constantly.
"""

@dataclass
class GoogleWorkspaceConnector:
    id: str = "google-workspace"
    name: str = "Google Workspace"

    task_keywords: List[str] = field(default_factory=lambda: [
        "gmail", "email", "inbox", "calendar", "drive"
    ])

    url_patterns: List[str] = field(default_factory=lambda: [
        r"mail\.google\.com",
        r"calendar\.google\.com",
        r"drive\.google\.com",
    ])

    # ONLY STATIC UI CONTROLS - same for all users
    element_map: Dict[str, Any] = field(default_factory=lambda: {
        "gmail_controls": {
            # ✅ These are static - exist for everyone
            "compose": (1, "clickable", "Compose new email"),
            "search": (2, "typeable", "Search mail"),
            "inbox": (3, "clickable", "Inbox folder"),
            "sent": (4, "clickable", "Sent folder"),
            "settings": (5, "clickable", "Settings"),
        },
        "gmail_compose": {
            # ✅ Compose form is static
            "to": (20, "typeable", "To recipients"),
            "subject": (21, "typeable", "Subject line"),
            "body": (22, "typeable", "Email body"),
        },
        "gmail_reading": {
            # ✅ Email action buttons are static
            "reply": (30, "clickable", "Reply button"),
            "forward": (31, "clickable", "Forward button"),
            "back": (32, "clickable", "Back to inbox"),
        },

        # ❌ NOT INCLUDED: Individual emails
        # Those are dynamic - use API context instead
    })

    async def get_api_context(self, user_id: str) -> Dict[str, Any]:
        """
        Fetch DYNAMIC content via API.

        This provides context about user's actual emails, events, files.
        The LLM uses this to know WHAT to look for.
        Static DOM tells it HOW to interact.
        """
        return {
            "gmail": {
                "unread_count": 5,
                "recent_emails": [
                    {
                        "from": "John Smith <john@example.com>",
                        "subject": "Project Update",
                        "date": "10 minutes ago",
                        "hint": "Search 'from:john project' to find this"
                    }
                ]
            },
            "calendar": {
                "events_today": 3,
                "next_event": "Meeting with Sarah at 3pm"
            }
        }
```

### Example 3: What NOT To Do

```python
# ❌ WRONG - Trying to map dynamic content

element_map: Dict[str, Any] = field(default_factory=lambda: {
    "emails": {
        # ❌ WRONG - These change constantly!
        "johns_email": (47, "clickable", "Email from John"),
        "unread_1": (48, "clickable", "First unread email"),
        "project_thread": (49, "clickable", "Project thread"),
    },
    "calendar_events": {
        # ❌ WRONG - Different for every user!
        "meeting_with_sarah": (60, "clickable", "Sarah meeting"),
        "dentist_appointment": (61, "clickable", "Dentist"),
    },
    "drive_files": {
        # ❌ WRONG - User-specific content!
        "quarterly_report": (70, "clickable", "Q4 Report.docx"),
    }
})
```

```python
# ✅ CORRECT - Use API for dynamic content

async def get_api_context(self, user_id: str) -> Dict[str, Any]:
    """The RIGHT way to handle dynamic content."""

    # Fetch actual user data via API
    emails = await gmail_api.list_messages(user_id, max_results=10)
    events = await calendar_api.get_today_events(user_id)
    files = await drive_api.get_recent_files(user_id)

    return {
        "gmail": {
            "recent_emails": emails,
            "hint": "Use SEARCH_INPUT to find specific emails"
        },
        "calendar": {
            "today_events": events,
            "hint": "Click CREATE_EVENT to add new events"
        },
        "drive": {
            "recent_files": files,
            "hint": "Use SEARCH or MY_DRIVE to navigate"
        }
    }
```

---

## Quick Reference: What Can Be Mapped?

| Element                    | Mappable? | Reason                       |
| -------------------------- | --------- | ---------------------------- |
| Compose button             | ✅ Yes    | Static UI, same for everyone |
| Search bar                 | ✅ Yes    | Static UI                    |
| Folder links (Inbox, Sent) | ✅ Yes    | Static navigation            |
| Settings button            | ✅ Yes    | Static UI                    |
| Reply/Forward buttons      | ✅ Yes    | Static actions               |
| Form input fields          | ✅ Yes    | Static structure             |
| Individual emails          | ❌ No     | Dynamic, changes constantly  |
| Calendar events            | ❌ No     | User-specific                |
| Drive files                | ❌ No     | User-specific                |
| Search results             | ❌ No     | Query-specific               |
| Chat messages              | ❌ No     | Dynamic content              |

---

## Testing

### Test Static DOM

```bash
python -c "
from connectors.your_connector.connector import connector
print(f'Static elements: {len(connector.element_map)} sections')
for section, elements in connector.element_map.items():
    print(f'  {section}: {len(elements)} elements')
"
```

### Test API Context

```python
async def test_api_context():
    from connectors.your_connector.connector import connector

    # Test with a real user ID
    context = await connector.get_api_context("user_123")

    assert "error" not in context, f"API error: {context.get('error')}"
    print(f"API context: {context}")
```

### Verify No Dynamic Content in element_map

```python
def verify_no_dynamic_content():
    """Ensure element_map only contains static UI controls."""

    # Red flags that indicate dynamic content
    dynamic_keywords = [
        "email_from", "message_from", "file_", "event_",
        "first_", "second_", "unread_", "recent_"
    ]

    for section, elements in connector.element_map.items():
        for key in elements.keys():
            for keyword in dynamic_keywords:
                if keyword in key.lower():
                    raise ValueError(
                        f"Possible dynamic content in element_map: {key}\n"
                        f"Dynamic content should use get_api_context() instead!"
                    )

    print("✅ element_map contains only static UI controls")
```

---

## Checklist

Before publishing, verify:

### All Connectors

- [ ] `connector.py` exports `connector` at module level
- [ ] Has `id`, `name`, `version`, `description`, `api` attributes
- [ ] `task_keywords` defined for intelligent selection
- [ ] `url_patterns` defined for URL routing

### Static DOM Elements

- [ ] `element_map` contains ONLY static UI controls
- [ ] NO individual emails, events, files, or other dynamic content
- [ ] `page_element_sections` maps page types to relevant sections
- [ ] `get_page_type(url)` implemented

### Dynamic Content (Hybrid Pattern)

- [ ] `get_api_context(user_id)` fetches user-specific data
- [ ] API context includes hints for how to find/interact with content
- [ ] OAuth tokens properly handled via auth service

---

## Summary

| Content Type                 | Where It Goes           | Why                            |
| ---------------------------- | ----------------------- | ------------------------------ |
| Buttons, menus, inputs       | `element_map`           | Static, same for all users     |
| User's emails, events, files | `get_api_context()`     | Dynamic, different per user    |
| Navigation structure         | `page_element_sections` | Static, defines page layouts   |
| Search/filter guidance       | API context hints       | Helps LLM find dynamic content |

**Remember:** The `element_map` tells the LLM **HOW to interact** (click this button).
The API context tells the LLM **WHAT exists** (user has 5 emails from John).
Together, they enable intelligent automation without expensive screenshot analysis.
