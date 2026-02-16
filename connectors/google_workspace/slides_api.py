"""Google Slides API Connector for Centris AI.

Fast presentation creation and editing via API.

API Docs: https://developers.google.com/slides/api
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from .base import GoogleWorkspaceConnectorBase, GoogleApiTool

logger = logging.getLogger(__name__)


class SlidesApiConnector(GoogleWorkspaceConnectorBase):
    """Google Slides API connector.
    
    Capabilities:
    - Create presentations
    - Add/modify slides
    - Insert text, images, shapes
    - Read presentation content
    """
    
    SERVICE_NAME = "slides"
    SERVICE_VERSION = "v1"
    REQUIRED_SCOPES = ["https://www.googleapis.com/auth/presentations"]
    
    @property
    def id(self) -> str:
        return "slides-api"
    
    @property
    def name(self) -> str:
        return "Google Slides API"
    
    @property
    def description(self) -> str:
        return "Fast presentation creation and editing via API."
    
    async def create_presentation(
        self,
        user_id: str,
        title: str
    ) -> Dict[str, Any]:
        """Create a new presentation."""
        service = self.get_service(user_id)
        if not service:
            return {"success": False, "error": "No Slides API access"}
        
        try:
            presentation = {'title': title}
            result = service.presentations().create(body=presentation).execute()
            
            logger.info(f"[Slides API] Presentation created: {result.get('presentationId')}")
            
            return {
                "success": True,
                "presentation_id": result.get('presentationId'),
                "title": title,
                "url": f"https://docs.google.com/presentation/d/{result.get('presentationId')}/edit"
            }
            
        except Exception as e:
            logger.error(f"[Slides API] Create presentation failed: {e}")
            return {"success": False, "error": str(e)}
    
    async def add_slide(
        self,
        user_id: str,
        presentation_id: str,
        layout: str = 'BLANK'
    ) -> Dict[str, Any]:
        """Add a new slide to a presentation."""
        service = self.get_service(user_id)
        if not service:
            return {"success": False, "error": "No Slides API access"}
        
        try:
            requests = [{
                'createSlide': {
                    'slideLayoutReference': {
                        'predefinedLayout': layout
                    }
                }
            }]
            
            result = service.presentations().batchUpdate(
                presentationId=presentation_id,
                body={'requests': requests}
            ).execute()
            
            slide_id = result.get('replies', [{}])[0].get('createSlide', {}).get('objectId')
            logger.info(f"[Slides API] Slide added: {slide_id}")
            
            return {
                "success": True,
                "slide_id": slide_id,
                "presentation_id": presentation_id
            }
            
        except Exception as e:
            logger.error(f"[Slides API] Add slide failed: {e}")
            return {"success": False, "error": str(e)}
    
    async def get_presentation(
        self,
        user_id: str,
        presentation_id: str
    ) -> Dict[str, Any]:
        """Get presentation metadata and slides."""
        service = self.get_service(user_id)
        if not service:
            return {"success": False, "error": "No Slides API access"}
        
        try:
            presentation = service.presentations().get(
                presentationId=presentation_id
            ).execute()
            
            slides = []
            for slide in presentation.get('slides', []):
                slides.append({
                    'id': slide.get('objectId'),
                    'elements': len(slide.get('pageElements', []))
                })
            
            return {
                "success": True,
                "presentation_id": presentation_id,
                "title": presentation.get('title'),
                "slides": slides,
                "slide_count": len(slides)
            }
            
        except Exception as e:
            logger.error(f"[Slides API] Get presentation failed: {e}")
            return {"success": False, "error": str(e)}
    
    def get_tools(self) -> List[GoogleApiTool]:
        return [
            GoogleApiTool(
                name="slides_api_create",
                label="Create Presentation",
                description="Create a new Google Slides presentation.",
                parameters={
                    "type": "object",
                    "properties": {
                        "title": {"type": "string", "description": "Presentation title"},
                    },
                    "required": ["title"]
                },
                execute=self.create_presentation,
                tags=["slides", "presentation", "create", "api"]
            ),
            GoogleApiTool(
                name="slides_api_add_slide",
                label="Add Slide",
                description="Add a new slide to a presentation.",
                parameters={
                    "type": "object",
                    "properties": {
                        "presentation_id": {"type": "string", "description": "Presentation ID"},
                        "layout": {"type": "string", "enum": ["BLANK", "TITLE", "TITLE_AND_BODY"], "default": "BLANK"},
                    },
                    "required": ["presentation_id"]
                },
                execute=self.add_slide,
                tags=["slides", "add", "api"]
            ),
        ]


slides_api_connector = SlidesApiConnector()
