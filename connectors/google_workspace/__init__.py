"""Google Workspace API Connectors for Centris AI.

This module provides fast, structured API access to ALL Google Workspace services.
Users grant permission ONCE during signup, then Centris has 10-100x faster access.

Available Connectors:
- Gmail API - Email automation
- Calendar API - Scheduling
- Drive API - File management
- Docs API - Document creation
- Sheets API - Spreadsheet automation
- Slides API - Presentation creation
- Forms API - Form creation & responses
- Meet API - Meeting management
- Classroom API - Education automation
- Tasks API - Todo management
- Contacts API - Contact management

Usage:
    from connectors.google_workspace import gmail_api_connector
    
    # Check if user has API access
    if gmail_api_connector.has_api_access(user_id):
        result = await gmail_api_connector.send_email(user_id, to, subject, body)
    else:
        # Fall back to browser automation
        result = await browser_connector.send_email(to, subject, body)
"""
from __future__ import annotations

from .base import GoogleWorkspaceConnectorBase, GoogleApiTool, GOOGLE_API_AVAILABLE

# Import all connectors
from .gmail_api import gmail_api_connector, GmailApiConnector
from .calendar_api import calendar_api_connector, CalendarApiConnector
from .drive_api import drive_api_connector, DriveApiConnector
from .docs_api import docs_api_connector, DocsApiConnector
from .sheets_api import sheets_api_connector, SheetsApiConnector
from .slides_api import slides_api_connector, SlidesApiConnector
from .forms_api import forms_api_connector, FormsApiConnector
from .meet_api import meet_api_connector, MeetApiConnector
from .classroom_api import classroom_api_connector, ClassroomApiConnector
from .tasks_api import tasks_api_connector, TasksApiConnector
from .contacts_api import contacts_api_connector, ContactsApiConnector

# All connector instances
ALL_CONNECTORS = [
    gmail_api_connector,
    calendar_api_connector,
    drive_api_connector,
    docs_api_connector,
    sheets_api_connector,
    slides_api_connector,
    forms_api_connector,
    meet_api_connector,
    classroom_api_connector,
    tasks_api_connector,
    contacts_api_connector,
]


def get_all_google_workspace_tools():
    """Get all tools from all Google Workspace connectors.
    
    Returns:
        List of all available GoogleApiTool instances
    """
    tools = []
    for connector in ALL_CONNECTORS:
        tools.extend(connector.get_tools())
    return tools


def get_connector_by_service(service_name: str):
    """Get a connector by its service name.
    
    Args:
        service_name: One of 'gmail', 'calendar', 'drive', 'docs', 'sheets', 
                      'slides', 'forms', 'meet', 'classroom', 'tasks', 'contacts'
    
    Returns:
        Connector instance or None
    """
    connector_map = {
        'gmail': gmail_api_connector,
        'calendar': calendar_api_connector,
        'drive': drive_api_connector,
        'docs': docs_api_connector,
        'sheets': sheets_api_connector,
        'slides': slides_api_connector,
        'forms': forms_api_connector,
        'meet': meet_api_connector,
        'classroom': classroom_api_connector,
        'tasks': tasks_api_connector,
        'contacts': contacts_api_connector,
    }
    return connector_map.get(service_name.lower())


__all__ = [
    # Base
    'GoogleWorkspaceConnectorBase',
    'GoogleApiTool',
    'GOOGLE_API_AVAILABLE',
    
    # Connectors
    'gmail_api_connector',
    'calendar_api_connector',
    'drive_api_connector',
    'docs_api_connector',
    'sheets_api_connector',
    'slides_api_connector',
    'forms_api_connector',
    'meet_api_connector',
    'classroom_api_connector',
    'tasks_api_connector',
    'contacts_api_connector',
    
    # Classes
    'GmailApiConnector',
    'CalendarApiConnector',
    'DriveApiConnector',
    'DocsApiConnector',
    'SheetsApiConnector',
    'SlidesApiConnector',
    'FormsApiConnector',
    'MeetApiConnector',
    'ClassroomApiConnector',
    'TasksApiConnector',
    'ContactsApiConnector',
    
    # Helpers
    'ALL_CONNECTORS',
    'get_all_google_workspace_tools',
    'get_connector_by_service',
]
