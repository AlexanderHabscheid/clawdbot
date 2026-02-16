"""Google Forms API Connector for Centris AI.

Fast form creation and response reading via API.

API Docs: https://developers.google.com/forms/api
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from .base import GoogleWorkspaceConnectorBase, GoogleApiTool

logger = logging.getLogger(__name__)


class FormsApiConnector(GoogleWorkspaceConnectorBase):
    """Google Forms API connector.
    
    Capabilities:
    - Create forms
    - Add questions
    - Read responses
    - Get form metadata
    """
    
    SERVICE_NAME = "forms"
    SERVICE_VERSION = "v1"
    REQUIRED_SCOPES = [
        "https://www.googleapis.com/auth/forms.body",
        "https://www.googleapis.com/auth/forms.responses.readonly",
    ]
    
    @property
    def id(self) -> str:
        return "forms-api"
    
    @property
    def name(self) -> str:
        return "Google Forms API"
    
    @property
    def description(self) -> str:
        return "Fast form creation and response reading via API."
    
    async def create_form(
        self,
        user_id: str,
        title: str,
        document_title: Optional[str] = None
    ) -> Dict[str, Any]:
        """Create a new form."""
        service = self.get_service(user_id)
        if not service:
            return {"success": False, "error": "No Forms API access"}
        
        try:
            form = {
                'info': {
                    'title': title,
                    'documentTitle': document_title or title
                }
            }
            
            result = service.forms().create(body=form).execute()
            
            logger.info(f"[Forms API] Form created: {result.get('formId')}")
            
            return {
                "success": True,
                "form_id": result.get('formId'),
                "title": title,
                "responder_url": result.get('responderUri'),
                "edit_url": f"https://docs.google.com/forms/d/{result.get('formId')}/edit"
            }
            
        except Exception as e:
            logger.error(f"[Forms API] Create form failed: {e}")
            return {"success": False, "error": str(e)}
    
    async def get_form(self, user_id: str, form_id: str) -> Dict[str, Any]:
        """Get form details."""
        service = self.get_service(user_id)
        if not service:
            return {"success": False, "error": "No Forms API access"}
        
        try:
            form = service.forms().get(formId=form_id).execute()
            
            questions = []
            for item in form.get('items', []):
                questions.append({
                    'id': item.get('itemId'),
                    'title': item.get('title'),
                    'type': list(item.get('questionItem', {}).get('question', {}).keys())[0] if item.get('questionItem') else 'unknown'
                })
            
            return {
                "success": True,
                "form_id": form_id,
                "title": form.get('info', {}).get('title'),
                "questions": questions,
                "responder_url": form.get('responderUri')
            }
            
        except Exception as e:
            logger.error(f"[Forms API] Get form failed: {e}")
            return {"success": False, "error": str(e)}
    
    async def get_responses(
        self,
        user_id: str,
        form_id: str
    ) -> Dict[str, Any]:
        """Get form responses."""
        service = self.get_service(user_id)
        if not service:
            return {"success": False, "error": "No Forms API access"}
        
        try:
            result = service.forms().responses().list(formId=form_id).execute()
            
            responses = []
            for response in result.get('responses', []):
                responses.append({
                    'response_id': response.get('responseId'),
                    'create_time': response.get('createTime'),
                    'answers': response.get('answers', {})
                })
            
            return {
                "success": True,
                "form_id": form_id,
                "responses": responses,
                "count": len(responses)
            }
            
        except Exception as e:
            logger.error(f"[Forms API] Get responses failed: {e}")
            return {"success": False, "error": str(e)}
    
    def get_tools(self) -> List[GoogleApiTool]:
        return [
            GoogleApiTool(
                name="forms_api_create",
                label="Create Form",
                description="Create a new Google Form.",
                parameters={
                    "type": "object",
                    "properties": {
                        "title": {"type": "string", "description": "Form title"},
                    },
                    "required": ["title"]
                },
                execute=self.create_form,
                tags=["forms", "create", "api"]
            ),
            GoogleApiTool(
                name="forms_api_responses",
                label="Get Form Responses",
                description="Get responses from a Google Form.",
                parameters={
                    "type": "object",
                    "properties": {
                        "form_id": {"type": "string", "description": "Form ID"},
                    },
                    "required": ["form_id"]
                },
                execute=self.get_responses,
                tags=["forms", "responses", "api"]
            ),
        ]


forms_api_connector = FormsApiConnector()
