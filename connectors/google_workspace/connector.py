"""
Google Workspace API Connector for Centris

PURE API CONNECTOR - No DOM element mapping.

Google services (Gmail, Calendar, Drive) have constantly changing DOM
that cannot be reliably pre-mapped. Instead, this connector uses
Google's APIs via OAuth to provide context about the user's data.

The LLM receives:
- What emails the user has (from Gmail API)
- What events are scheduled (from Calendar API)
- What files exist (from Drive API)

Browser automation (clicking, typing) is handled by the browser agent
using the live DOM snapshot, NOT pre-mapped elements.

ARCHITECTURE:
    User: "Reply to John's email about the project"
    
    1. API CONTEXT (this connector):
       Gmail API returns: "Email from John Smith, subject 'Project Update'"
       LLM knows WHAT to look for
    
    2. BROWSER AUTOMATION (browser agent):
       Takes live DOM snapshot
       LLM identifies the email in current page
       Clicks based on live element IDs
       
    This connector provides CONTEXT, not DOM mappings.
"""

import logging
from dataclasses import dataclass, field
from typing import Dict, Any, List, Optional, Callable
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


# =============================================================================
# URL HELPERS
# =============================================================================

class GoogleWorkspaceURLs:
    """URL detection for Google services."""
    
    GMAIL = "https://mail.google.com"
    CALENDAR = "https://calendar.google.com"
    DRIVE = "https://drive.google.com"
    DOCS = "https://docs.google.com"
    SHEETS = "https://sheets.google.com"
    SLIDES = "https://slides.google.com"
    
    @staticmethod
    def get_service(url: str) -> Optional[str]:
        """Detect which Google service from URL."""
        if "mail.google.com" in url:
            return "gmail"
        elif "calendar.google.com" in url:
            return "calendar"
        elif "drive.google.com" in url:
            return "drive"
        elif "docs.google.com" in url:
            return "docs"
        elif "sheets.google.com" in url:
            return "sheets"
        elif "slides.google.com" in url:
            return "slides"
        return None
    
    @staticmethod
    def get_page_type(url: str) -> Optional[str]:
        """Detect page type from URL."""
        service = GoogleWorkspaceURLs.get_service(url)
        return f"{service}_main" if service else None


# =============================================================================
# API CONTEXT PROVIDER - The core of this connector
# =============================================================================

class GoogleWorkspaceAPIContext:
    """
    Fetches dynamic, personalized data via Google APIs.
    
    This is what makes Google Workspace automation possible:
    - APIs tell the LLM WHAT the user has (emails, events, files)
    - Browser agent handles HOW to interact (clicking live DOM elements)
    
    NO DOM MAPPING - Google's UI changes too frequently.
    """
    
    @staticmethod
    async def get_user_context(user_id: str, service: Optional[str] = None) -> Dict[str, Any]:
        """
        Fetch personalized API context for a user.
        
        Args:
            user_id: The user's Centris ID
            service: Optional - limit to specific service (gmail, calendar, drive)
            
        Returns:
            Dict with user's data context for LLM
        """
        context = {
            "connector": "google_workspace",
            "type": "api_context",
            "note": "Use this context to understand user's data. Browser automation will handle UI interaction."
        }
        
        try:
            # Check if user has Google OAuth access
            from backend.services.auth_service import get_auth_service
            auth_service = get_auth_service()
            
            if not auth_service.has_google_api_access(user_id):
                return {
                    "api_access": False,
                    "message": "User hasn't connected Google account via OAuth.",
                    "action": "Prompt user to connect Google account in settings."
                }
            
            # Fetch context based on service
            if service is None or service == "gmail":
                context["gmail"] = await GoogleWorkspaceAPIContext._get_gmail_context(user_id)
            
            if service is None or service == "calendar":
                context["calendar"] = await GoogleWorkspaceAPIContext._get_calendar_context(user_id)
            
            if service is None or service == "drive":
                context["drive"] = await GoogleWorkspaceAPIContext._get_drive_context(user_id)
            
            context["api_access"] = True
            return context
            
        except Exception as e:
            logger.warning(f"[GoogleWorkspace] API context fetch failed: {e}")
            return {
                "api_access": False,
                "error": str(e),
                "fallback": "Navigate to the Google service and use live DOM for automation."
            }
    
    @staticmethod
    async def _get_gmail_context(user_id: str) -> Dict[str, Any]:
        """Fetch Gmail inbox context via API."""
        try:
            from connectors.google_workspace.gmail_api import gmail_api_connector
            
            service = gmail_api_connector.get_service(user_id)
            if not service:
                return {"available": False, "reason": "Gmail API not accessible"}
            
            # Get inbox messages
            results = service.users().messages().list(
                userId='me',
                maxResults=10,
                labelIds=['INBOX']
            ).execute()
            
            messages = results.get('messages', [])
            
            # Get details of recent messages
            email_summaries = []
            for msg in messages[:5]:
                msg_detail = service.users().messages().get(
                    userId='me',
                    id=msg['id'],
                    format='metadata',
                    metadataHeaders=['From', 'Subject', 'Date']
                ).execute()
                
                headers = {h['name']: h['value'] for h in msg_detail.get('payload', {}).get('headers', [])}
                is_unread = 'UNREAD' in msg_detail.get('labelIds', [])
                
                email_summaries.append({
                    "from": headers.get('From', 'Unknown'),
                    "subject": headers.get('Subject', '(no subject)'),
                    "date": headers.get('Date', ''),
                    "unread": is_unread,
                    "id": msg['id']
                })
            
            # Count unread
            unread_results = service.users().messages().list(
                userId='me',
                maxResults=100,
                labelIds=['INBOX', 'UNREAD']
            ).execute()
            unread_count = len(unread_results.get('messages', []))
            
            return {
                "available": True,
                "unread_count": unread_count,
                "total_in_inbox": len(messages),
                "recent_emails": email_summaries,
                "navigation_hint": "Go to mail.google.com to interact with emails",
                "search_hint": "Use Gmail search bar to find specific emails (e.g., 'from:john subject:project')"
            }
            
        except Exception as e:
            logger.warning(f"Gmail API error: {e}")
            return {"available": False, "error": str(e)}
    
    @staticmethod
    async def _get_calendar_context(user_id: str) -> Dict[str, Any]:
        """Fetch Calendar events context via API."""
        try:
            from connectors.google_workspace.calendar_api import calendar_api_connector
            
            service = calendar_api_connector.get_service(user_id)
            if not service:
                return {"available": False, "reason": "Calendar API not accessible"}
            
            # Get upcoming events
            now = datetime.utcnow()
            time_min = now.isoformat() + 'Z'
            time_max = (now + timedelta(days=7)).isoformat() + 'Z'
            
            events_result = service.events().list(
                calendarId='primary',
                timeMin=time_min,
                timeMax=time_max,
                maxResults=10,
                singleEvents=True,
                orderBy='startTime'
            ).execute()
            
            events = events_result.get('items', [])
            
            event_summaries = []
            for event in events:
                start = event['start'].get('dateTime', event['start'].get('date'))
                event_summaries.append({
                    "title": event.get('summary', '(no title)'),
                    "start": start,
                    "location": event.get('location', ''),
                    "attendees": len(event.get('attendees', [])),
                    "id": event['id']
                })
            
            # Check for today's events specifically
            today_end = (now.replace(hour=23, minute=59, second=59)).isoformat() + 'Z'
            today_events = service.events().list(
                calendarId='primary',
                timeMin=time_min,
                timeMax=today_end,
                singleEvents=True,
                orderBy='startTime'
            ).execute()
            
            return {
                "available": True,
                "events_today": len(today_events.get('items', [])),
                "events_this_week": len(events),
                "upcoming_events": event_summaries,
                "navigation_hint": "Go to calendar.google.com to view/edit events",
                "create_hint": "Click the 'Create' button to add new events"
            }
            
        except Exception as e:
            logger.warning(f"Calendar API error: {e}")
            return {"available": False, "error": str(e)}
    
    @staticmethod
    async def _get_drive_context(user_id: str) -> Dict[str, Any]:
        """Fetch Drive files context via API."""
        try:
            from connectors.google_workspace.drive_api import drive_api_connector
            
            service = drive_api_connector.get_service(user_id)
            if not service:
                return {"available": False, "reason": "Drive API not accessible"}
            
            # Get recent files
            results = service.files().list(
                pageSize=10,
                fields="files(id, name, mimeType, modifiedTime, webViewLink)",
                orderBy="modifiedTime desc"
            ).execute()
            
            files = results.get('files', [])
            
            file_summaries = []
            for f in files:
                mime_type = f.get('mimeType', '')
                file_type = mime_type.split('.')[-1] if '.' in mime_type else mime_type.split('/')[-1]
                
                file_summaries.append({
                    "name": f.get('name'),
                    "type": file_type,
                    "modified": f.get('modifiedTime'),
                    "link": f.get('webViewLink'),
                    "id": f.get('id')
                })
            
            return {
                "available": True,
                "recent_files": file_summaries,
                "navigation_hint": "Go to drive.google.com to browse files",
                "search_hint": "Use Drive search to find specific files by name"
            }
            
        except Exception as e:
            logger.warning(f"Drive API error: {e}")
            return {"available": False, "error": str(e)}


# =============================================================================
# TOOL DEFINITIONS
# =============================================================================

@dataclass
class Tool:
    name: str
    description: str
    parameters: Dict[str, Any]
    execute: Callable
    label: Optional[str] = None
    tags: List[str] = field(default_factory=list)


async def google_workspace_get_context(
    tool_call_id: str,
    params: Dict[str, Any],
    context: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Fetch user's Google Workspace data context via APIs.
    
    Returns information about emails, calendar events, and files
    that helps the LLM understand what the user has.
    
    Browser automation is handled separately using live DOM.
    """
    user_id = context.get("user_id") if context else None
    service = params.get("service")  # Optional: gmail, calendar, drive
    
    if not user_id:
        return {
            "success": False,
            "error": "User ID not available",
            "hint": "User must be authenticated to access Google Workspace"
        }
    
    api_context = await GoogleWorkspaceAPIContext.get_user_context(user_id, service)
    
    return {
        "success": True,
        "context": api_context
    }


class GoogleWorkspaceApi:
    """API for Google Workspace context tools."""
    
    def __init__(self):
        self._gateway_methods: Dict[str, Callable] = {}
        self._services: List[Any] = []
    
    def get_tools(self, context=None) -> List[Tool]:
        return [
            Tool(
                name="google_workspace_get_context",
                label="Get Google Workspace Context",
                description=(
                    "Fetch user's Gmail inbox, Calendar events, and Drive files via API. "
                    "Provides context about what the user has so the LLM knows what to look for. "
                    "Does NOT provide DOM elements - browser automation uses live DOM snapshots."
                ),
                parameters={
                    "type": "object",
                    "properties": {
                        "service": {
                            "type": "string",
                            "enum": ["gmail", "calendar", "drive"],
                            "description": "Optional: limit to specific service"
                        }
                    },
                    "required": []
                },
                execute=google_workspace_get_context,
                tags=["google", "context", "api"]
            ),
        ]


# =============================================================================
# CONNECTOR DEFINITION - API ONLY, NO DOM MAPPING
# =============================================================================

@dataclass
class GoogleWorkspaceConnector:
    """
    Google Workspace API Connector - PURE API, NO DOM MAPPING.
    
    WHY NO DOM MAPPING:
    - Gmail, Calendar, Drive have constantly changing DOM
    - Individual emails/events/files have dynamic IDs
    - Pre-mapping would be unreliable and misleading
    
    WHAT THIS CONNECTOR DOES:
    - Provides API context about user's data (via OAuth)
    - Tells LLM what emails, events, files exist
    - Browser agent handles actual UI interaction with live DOM
    
    WHAT THIS CONNECTOR DOES NOT DO:
    - Map DOM elements (compose button, search, etc.)
    - Pre-define where to click
    - Provide static UI element IDs
    """
    
    id: str = "google-workspace"
    name: str = "Google Workspace"
    version: str = "3.0.0"  # Major version bump - now API-only
    description: str = (
        "API-only connector for Gmail, Calendar, Drive. "
        "Provides context about user's data via OAuth. "
        "Browser automation uses live DOM snapshots, not pre-mapped elements."
    )
    
    api: GoogleWorkspaceApi = field(default_factory=GoogleWorkspaceApi)
    
    # =========================================================================
    # URL PATTERNS - For routing to this connector
    # =========================================================================
    url_patterns: List[str] = field(default_factory=lambda: [
        r"mail\.google\.com",
        r"calendar\.google\.com",
        r"drive\.google\.com",
        r"docs\.google\.com",
        r"sheets\.google\.com",
        r"slides\.google\.com",
    ])
    
    # =========================================================================
    # TASK KEYWORDS - Trigger this connector
    # =========================================================================
    task_keywords: List[str] = field(default_factory=lambda: [
        # Gmail
        "gmail", "email", "inbox", "send email", "read email", "compose email",
        "check email", "reply to email", "forward email",
        
        # Calendar
        "calendar", "schedule", "meeting", "event", "appointment",
        "google calendar", "gcal", "create event", "schedule meeting",
        
        # Drive
        "drive", "google drive", "files", "upload file", "my files",
        "documents", "folders",
        
        # Docs/Sheets/Slides
        "google docs", "document", "google sheets", "spreadsheet",
        "google slides", "presentation",
    ])
    
    # =========================================================================
    # NO ELEMENT MAP - This is intentional
    # =========================================================================
    # Google services have dynamic DOM that cannot be reliably pre-mapped.
    # The browser agent will use live DOM snapshots for interaction.
    # This connector provides API CONTEXT only.
    
    # =========================================================================
    # API CONTEXT METHOD - The primary function of this connector
    # =========================================================================
    async def get_api_context(self, user_id: str, service: Optional[str] = None) -> Dict[str, Any]:
        """
        Get API context for this user.
        
        This is the main purpose of this connector:
        - Fetch user's emails, events, files via Google APIs
        - Provide this context to the LLM
        - LLM uses context to understand what to look for
        - Browser agent handles actual clicking/typing on live DOM
        """
        return await GoogleWorkspaceAPIContext.get_user_context(user_id, service)
    
    @staticmethod
    def get_page_type(url: str) -> Optional[str]:
        """Detect page type from URL."""
        return GoogleWorkspaceURLs.get_page_type(url)


# =============================================================================
# MODULE EXPORT
# =============================================================================

connector = GoogleWorkspaceConnector()

__all__ = [
    "connector",
    "GoogleWorkspaceConnector",
    "GoogleWorkspaceURLs",
    "GoogleWorkspaceAPIContext",
]
