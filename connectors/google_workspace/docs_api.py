"""Google Docs API Connector for Centris AI.

Fast document creation and editing via API.

API Docs: https://developers.google.com/docs/api
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from .base import GoogleWorkspaceConnectorBase, GoogleApiTool

logger = logging.getLogger(__name__)


class DocsApiConnector(GoogleWorkspaceConnectorBase):
    """Google Docs API connector.
    
    Capabilities:
    - Create documents
    - Insert/replace text
    - Format documents
    - Read document content
    """
    
    SERVICE_NAME = "docs"
    SERVICE_VERSION = "v1"
    REQUIRED_SCOPES = ["https://www.googleapis.com/auth/documents"]
    
    @property
    def id(self) -> str:
        return "docs-api"
    
    @property
    def name(self) -> str:
        return "Google Docs API"
    
    @property
    def description(self) -> str:
        return "Fast document creation and editing via API."
    
    async def create_document(
        self,
        user_id: str,
        title: str,
        content: Optional[str] = None
    ) -> Dict[str, Any]:
        """Create a new Google Doc."""
        service = self.get_service(user_id)
        if not service:
            return {"success": False, "error": "No Docs API access"}
        
        try:
            # Create document
            doc = service.documents().create(body={'title': title}).execute()
            doc_id = doc.get('documentId')
            
            # Add content if provided
            if content:
                requests = [
                    {'insertText': {'location': {'index': 1}, 'text': content}}
                ]
                service.documents().batchUpdate(
                    documentId=doc_id,
                    body={'requests': requests}
                ).execute()
            
            logger.info(f"[Docs API] Document created: {doc_id}")
            
            return {
                "success": True,
                "document_id": doc_id,
                "title": title,
                "url": f"https://docs.google.com/document/d/{doc_id}/edit"
            }
            
        except Exception as e:
            logger.error(f"[Docs API] Create document failed: {e}")
            return {"success": False, "error": str(e)}
    
    async def get_document(self, user_id: str, document_id: str) -> Dict[str, Any]:
        """Get document content."""
        service = self.get_service(user_id)
        if not service:
            return {"success": False, "error": "No Docs API access"}
        
        try:
            doc = service.documents().get(documentId=document_id).execute()
            
            # Extract text content
            content = self._extract_text(doc.get('body', {}).get('content', []))
            
            return {
                "success": True,
                "document_id": document_id,
                "title": doc.get('title'),
                "content": content,
                "url": f"https://docs.google.com/document/d/{document_id}/edit"
            }
            
        except Exception as e:
            logger.error(f"[Docs API] Get document failed: {e}")
            return {"success": False, "error": str(e)}
    
    async def append_text(
        self,
        user_id: str,
        document_id: str,
        text: str
    ) -> Dict[str, Any]:
        """Append text to the end of a document."""
        service = self.get_service(user_id)
        if not service:
            return {"success": False, "error": "No Docs API access"}
        
        try:
            # Get document to find end index
            doc = service.documents().get(documentId=document_id).execute()
            end_index = doc.get('body', {}).get('content', [{}])[-1].get('endIndex', 1) - 1
            
            requests = [
                {'insertText': {'location': {'index': end_index}, 'text': text}}
            ]
            
            service.documents().batchUpdate(
                documentId=document_id,
                body={'requests': requests}
            ).execute()
            
            logger.info(f"[Docs API] Text appended to {document_id}")
            return {"success": True, "document_id": document_id, "appended": len(text)}
            
        except Exception as e:
            logger.error(f"[Docs API] Append text failed: {e}")
            return {"success": False, "error": str(e)}
    
    def _extract_text(self, content: List[Dict]) -> str:
        """Extract plain text from document content."""
        text_parts = []
        for element in content:
            if 'paragraph' in element:
                for elem in element['paragraph'].get('elements', []):
                    if 'textRun' in elem:
                        text_parts.append(elem['textRun'].get('content', ''))
        return ''.join(text_parts)
    
    def get_tools(self) -> List[GoogleApiTool]:
        return [
            GoogleApiTool(
                name="docs_api_create",
                label="Create Google Doc",
                description="Create a new Google Doc with optional content.",
                parameters={
                    "type": "object",
                    "properties": {
                        "title": {"type": "string", "description": "Document title"},
                        "content": {"type": "string", "description": "Initial content (optional)"},
                    },
                    "required": ["title"]
                },
                execute=self.create_document,
                tags=["docs", "create", "api"]
            ),
            GoogleApiTool(
                name="docs_api_read",
                label="Read Google Doc",
                description="Get the content of a Google Doc.",
                parameters={
                    "type": "object",
                    "properties": {
                        "document_id": {"type": "string", "description": "Document ID"},
                    },
                    "required": ["document_id"]
                },
                execute=self.get_document,
                tags=["docs", "read", "api"]
            ),
            GoogleApiTool(
                name="docs_api_append",
                label="Append to Google Doc",
                description="Append text to a Google Doc.",
                parameters={
                    "type": "object",
                    "properties": {
                        "document_id": {"type": "string", "description": "Document ID"},
                        "text": {"type": "string", "description": "Text to append"},
                    },
                    "required": ["document_id", "text"]
                },
                execute=self.append_text,
                tags=["docs", "edit", "api"]
            ),
        ]


docs_api_connector = DocsApiConnector()
