"""Google Meet API Connector for Centris AI.

Fast meeting creation via API.

API Docs: https://developers.google.com/meet/api
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from .base import GoogleWorkspaceConnectorBase, GoogleApiTool

logger = logging.getLogger(__name__)


class MeetApiConnector(GoogleWorkspaceConnectorBase):
    """Google Meet API connector.
    
    Capabilities:
    - Create meeting spaces
    - Get meeting details
    - List participants (after meeting)
    """
    
    SERVICE_NAME = "meet"
    SERVICE_VERSION = "v2"
    REQUIRED_SCOPES = [
        "https://www.googleapis.com/auth/meetings.space.created",
        "https://www.googleapis.com/auth/meetings.space.readonly",
    ]
    
    @property
    def id(self) -> str:
        return "meet-api"
    
    @property
    def name(self) -> str:
        return "Google Meet API"
    
    @property
    def description(self) -> str:
        return "Fast meeting creation and management via API."
    
    async def create_meeting(
        self,
        user_id: str,
        space_type: str = 'MEETING_SPACE'
    ) -> Dict[str, Any]:
        """Create a new meeting space.
        
        Returns a meeting link instantly (~100ms).
        """
        service = self.get_service(user_id)
        if not service:
            return {"success": False, "error": "No Meet API access"}
        
        try:
            space = service.spaces().create(
                body={'config': {'accessType': 'OPEN'}}
            ).execute()
            
            meeting_code = space.get('meetingCode')
            meeting_uri = space.get('meetingUri')
            
            logger.info(f"[Meet API] Meeting created: {meeting_code}")
            
            return {
                "success": True,
                "meeting_code": meeting_code,
                "meeting_uri": meeting_uri or f"https://meet.google.com/{meeting_code}",
                "space_name": space.get('name')
            }
            
        except Exception as e:
            logger.error(f"[Meet API] Create meeting failed: {e}")
            return {"success": False, "error": str(e)}
    
    async def get_meeting(
        self,
        user_id: str,
        space_name: str
    ) -> Dict[str, Any]:
        """Get meeting space details."""
        service = self.get_service(user_id)
        if not service:
            return {"success": False, "error": "No Meet API access"}
        
        try:
            space = service.spaces().get(name=space_name).execute()
            
            return {
                "success": True,
                "space_name": space.get('name'),
                "meeting_code": space.get('meetingCode'),
                "meeting_uri": space.get('meetingUri'),
                "config": space.get('config')
            }
            
        except Exception as e:
            logger.error(f"[Meet API] Get meeting failed: {e}")
            return {"success": False, "error": str(e)}
    
    def get_tools(self) -> List[GoogleApiTool]:
        return [
            GoogleApiTool(
                name="meet_api_create",
                label="Create Meeting",
                description="Create a Google Meet meeting link instantly.",
                parameters={
                    "type": "object",
                    "properties": {}
                },
                execute=self.create_meeting,
                tags=["meet", "meeting", "create", "api"]
            ),
        ]


meet_api_connector = MeetApiConnector()
