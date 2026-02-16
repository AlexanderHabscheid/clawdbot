"""Google Calendar API Connector for Centris AI.

Fast calendar management via API.
Create events, check availability, manage schedules.

API Docs: https://developers.google.com/calendar/api
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from .base import GoogleWorkspaceConnectorBase, GoogleApiTool

logger = logging.getLogger(__name__)


class CalendarApiConnector(GoogleWorkspaceConnectorBase):
    """Google Calendar API connector.
    
    Capabilities:
    - Create/update/delete events (~150ms vs ~5s browser)
    - Check availability
    - List upcoming events
    - Manage attendees
    - Access multiple calendars
    """
    
    SERVICE_NAME = "calendar"
    SERVICE_VERSION = "v3"
    REQUIRED_SCOPES = [
        "https://www.googleapis.com/auth/calendar",
        "https://www.googleapis.com/auth/calendar.events",
    ]
    
    @property
    def id(self) -> str:
        return "calendar-api"
    
    @property
    def name(self) -> str:
        return "Google Calendar API"
    
    @property
    def description(self) -> str:
        return "Fast calendar management via API. Create events, check availability."
    
    # =========================================================================
    # API Operations
    # =========================================================================
    
    async def create_event(
        self,
        user_id: str,
        summary: str,
        start_time: str,
        end_time: str,
        description: Optional[str] = None,
        location: Optional[str] = None,
        attendees: Optional[List[str]] = None,
        calendar_id: str = 'primary',
        send_notifications: bool = True,
        add_meet_link: bool = False
    ) -> Dict[str, Any]:
        """Create a calendar event.
        
        ~150ms vs ~5 seconds with browser automation.
        """
        service = self.get_service(user_id)
        if not service:
            return {"success": False, "error": "No Calendar API access"}
        
        try:
            event = {
                'summary': summary,
                'start': {'dateTime': start_time, 'timeZone': 'America/New_York'},
                'end': {'dateTime': end_time, 'timeZone': 'America/New_York'},
            }
            
            if description:
                event['description'] = description
            if location:
                event['location'] = location
            if attendees:
                event['attendees'] = [{'email': email} for email in attendees]
            
            # Add Google Meet link if requested
            if add_meet_link:
                event['conferenceData'] = {
                    'createRequest': {
                        'requestId': f"centris-{datetime.now().timestamp()}",
                        'conferenceSolutionKey': {'type': 'hangoutsMeet'}
                    }
                }
            
            result = service.events().insert(
                calendarId=calendar_id,
                body=event,
                sendUpdates='all' if send_notifications else 'none',
                conferenceDataVersion=1 if add_meet_link else 0
            ).execute()
            
            logger.info(f"[Calendar API] Event created: {result.get('id')}")
            
            # Extract Meet link if available
            meet_link = None
            if result.get('conferenceData', {}).get('entryPoints'):
                for entry in result['conferenceData']['entryPoints']:
                    if entry.get('entryPointType') == 'video':
                        meet_link = entry.get('uri')
                        break
            
            return {
                "success": True,
                "event_id": result.get('id'),
                "html_link": result.get('htmlLink'),
                "meet_link": meet_link,
                "summary": summary,
                "start": start_time,
                "end": end_time
            }
            
        except Exception as e:
            logger.error(f"[Calendar API] Create event failed: {e}")
            return {"success": False, "error": str(e)}
    
    async def list_events(
        self,
        user_id: str,
        time_min: Optional[str] = None,
        time_max: Optional[str] = None,
        max_results: int = 10,
        calendar_id: str = 'primary'
    ) -> Dict[str, Any]:
        """List upcoming calendar events."""
        service = self.get_service(user_id)
        if not service:
            return {"success": False, "error": "No Calendar API access"}
        
        try:
            # Default to next 7 days
            if not time_min:
                time_min = datetime.utcnow().isoformat() + 'Z'
            if not time_max:
                time_max = (datetime.utcnow() + timedelta(days=7)).isoformat() + 'Z'
            
            events_result = service.events().list(
                calendarId=calendar_id,
                timeMin=time_min,
                timeMax=time_max,
                maxResults=max_results,
                singleEvents=True,
                orderBy='startTime'
            ).execute()
            
            events = events_result.get('items', [])
            
            formatted_events = []
            for event in events:
                start = event['start'].get('dateTime', event['start'].get('date'))
                end = event['end'].get('dateTime', event['end'].get('date'))
                
                formatted_events.append({
                    'id': event['id'],
                    'summary': event.get('summary', 'No title'),
                    'start': start,
                    'end': end,
                    'location': event.get('location'),
                    'description': event.get('description'),
                    'attendees': [a.get('email') for a in event.get('attendees', [])],
                    'meet_link': self._extract_meet_link(event),
                    'html_link': event.get('htmlLink')
                })
            
            return {
                "success": True,
                "events": formatted_events,
                "count": len(formatted_events)
            }
            
        except Exception as e:
            logger.error(f"[Calendar API] List events failed: {e}")
            return {"success": False, "error": str(e)}
    
    async def delete_event(
        self,
        user_id: str,
        event_id: str,
        calendar_id: str = 'primary',
        send_notifications: bool = True
    ) -> Dict[str, Any]:
        """Delete a calendar event."""
        service = self.get_service(user_id)
        if not service:
            return {"success": False, "error": "No Calendar API access"}
        
        try:
            service.events().delete(
                calendarId=calendar_id,
                eventId=event_id,
                sendUpdates='all' if send_notifications else 'none'
            ).execute()
            
            logger.info(f"[Calendar API] Event deleted: {event_id}")
            return {"success": True, "deleted_event_id": event_id}
            
        except Exception as e:
            logger.error(f"[Calendar API] Delete event failed: {e}")
            return {"success": False, "error": str(e)}
    
    async def update_event(
        self,
        user_id: str,
        event_id: str,
        summary: Optional[str] = None,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        description: Optional[str] = None,
        location: Optional[str] = None,
        calendar_id: str = 'primary'
    ) -> Dict[str, Any]:
        """Update an existing calendar event."""
        service = self.get_service(user_id)
        if not service:
            return {"success": False, "error": "No Calendar API access"}
        
        try:
            # Get existing event
            event = service.events().get(
                calendarId=calendar_id,
                eventId=event_id
            ).execute()
            
            # Update fields
            if summary:
                event['summary'] = summary
            if start_time:
                event['start'] = {'dateTime': start_time, 'timeZone': 'America/New_York'}
            if end_time:
                event['end'] = {'dateTime': end_time, 'timeZone': 'America/New_York'}
            if description:
                event['description'] = description
            if location:
                event['location'] = location
            
            result = service.events().update(
                calendarId=calendar_id,
                eventId=event_id,
                body=event
            ).execute()
            
            logger.info(f"[Calendar API] Event updated: {event_id}")
            return {
                "success": True,
                "event_id": result.get('id'),
                "html_link": result.get('htmlLink')
            }
            
        except Exception as e:
            logger.error(f"[Calendar API] Update event failed: {e}")
            return {"success": False, "error": str(e)}
    
    def _extract_meet_link(self, event: Dict) -> Optional[str]:
        """Extract Google Meet link from event."""
        conference_data = event.get('conferenceData', {})
        for entry in conference_data.get('entryPoints', []):
            if entry.get('entryPointType') == 'video':
                return entry.get('uri')
        return None
    
    # =========================================================================
    # Tool Definitions
    # =========================================================================
    
    def get_tools(self) -> List[GoogleApiTool]:
        """Return Calendar API tools."""
        return [
            GoogleApiTool(
                name="calendar_api_create_event",
                label="Create Calendar Event",
                description="Create a calendar event with optional Meet link. 30x faster than browser.",
                parameters={
                    "type": "object",
                    "properties": {
                        "summary": {"type": "string", "description": "Event title"},
                        "start_time": {"type": "string", "description": "Start time (ISO format)"},
                        "end_time": {"type": "string", "description": "End time (ISO format)"},
                        "description": {"type": "string", "description": "Event description"},
                        "location": {"type": "string", "description": "Event location"},
                        "attendees": {"type": "array", "items": {"type": "string"}, "description": "Attendee emails"},
                        "add_meet_link": {"type": "boolean", "description": "Add Google Meet link", "default": False},
                    },
                    "required": ["summary", "start_time", "end_time"]
                },
                execute=self.create_event,
                tags=["calendar", "meeting", "fast", "api"]
            ),
            GoogleApiTool(
                name="calendar_api_list_events",
                label="List Calendar Events",
                description="List upcoming calendar events with structured data.",
                parameters={
                    "type": "object",
                    "properties": {
                        "max_results": {"type": "integer", "description": "Max events to return", "default": 10},
                        "time_min": {"type": "string", "description": "Start of time range (ISO format)"},
                        "time_max": {"type": "string", "description": "End of time range (ISO format)"},
                    }
                },
                execute=self.list_events,
                tags=["calendar", "list", "fast", "api"]
            ),
            GoogleApiTool(
                name="calendar_api_delete_event",
                label="Delete Calendar Event",
                description="Delete a calendar event by ID.",
                parameters={
                    "type": "object",
                    "properties": {
                        "event_id": {"type": "string", "description": "Event ID to delete"},
                    },
                    "required": ["event_id"]
                },
                execute=self.delete_event,
                tags=["calendar", "delete", "fast", "api"]
            ),
        ]


# Singleton instance
calendar_api_connector = CalendarApiConnector()
