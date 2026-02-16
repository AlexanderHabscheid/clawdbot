"""Gmail API Connector for Centris AI.

Provides fast, structured access to Gmail via the Gmail API.
10-100x faster than browser automation for email operations.

API Docs: https://developers.google.com/gmail/api
"""
from __future__ import annotations

import base64
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Any, Dict, List, Optional

from .base import GoogleWorkspaceConnectorBase, GoogleApiTool, handle_google_api_error

logger = logging.getLogger(__name__)


class GmailApiConnector(GoogleWorkspaceConnectorBase):
    """Gmail API connector - fast email automation.
    
    Capabilities:
    - Send emails (200ms vs 5s browser)
    - Read/search emails with structured data
    - Batch operations (archive 100 emails in 1 call)
    - Label management
    - Draft creation
    """
    
    SERVICE_NAME = "gmail"
    SERVICE_VERSION = "v1"
    REQUIRED_SCOPES = [
        "https://www.googleapis.com/auth/gmail.modify",
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/gmail.compose",
        "https://www.googleapis.com/auth/gmail.labels",
    ]
    
    @property
    def id(self) -> str:
        return "gmail-api"
    
    @property
    def name(self) -> str:
        return "Gmail API"
    
    @property
    def description(self) -> str:
        return "Fast Gmail automation via API. Send, read, search, and manage emails."
    
    # =========================================================================
    # API Operations
    # =========================================================================
    
    async def send_email(
        self,
        user_id: str,
        to: str,
        subject: str,
        body: str,
        cc: Optional[str] = None,
        bcc: Optional[str] = None,
        html: bool = False
    ) -> Dict[str, Any]:
        """Send an email via Gmail API.
        
        ~200ms vs ~5 seconds with browser automation.
        """
        service = self.get_service(user_id)
        if not service:
            return {"success": False, "error": "No Gmail API access. User needs to sign in with Google."}
        
        try:
            # Create message
            if html:
                message = MIMEMultipart('alternative')
                message.attach(MIMEText(body, 'html'))
            else:
                message = MIMEText(body)
            
            message['to'] = to
            message['subject'] = subject
            
            if cc:
                message['cc'] = cc
            if bcc:
                message['bcc'] = bcc
            
            # Encode message
            raw = base64.urlsafe_b64encode(message.as_bytes()).decode()
            
            # Send
            result = service.users().messages().send(
                userId='me',
                body={'raw': raw}
            ).execute()
            
            logger.info(f"[Gmail API] Email sent to {to}, id: {result.get('id')}")
            
            return {
                "success": True,
                "message_id": result.get('id'),
                "thread_id": result.get('threadId'),
                "to": to,
                "subject": subject
            }
            
        except Exception as e:
            logger.error(f"[Gmail API] Send failed: {e}")
            return {"success": False, "error": str(e)}
    
    async def list_messages(
        self,
        user_id: str,
        query: Optional[str] = None,
        max_results: int = 10,
        label_ids: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """List/search emails with structured data.
        
        Returns semantic data (sender, subject, date) not HTML blobs.
        """
        service = self.get_service(user_id)
        if not service:
            return {"success": False, "error": "No Gmail API access"}
        
        try:
            # Build request
            request_params = {
                'userId': 'me',
                'maxResults': max_results
            }
            
            if query:
                request_params['q'] = query
            if label_ids:
                request_params['labelIds'] = label_ids
            
            # Get message list
            response = service.users().messages().list(**request_params).execute()
            messages = response.get('messages', [])
            
            # Fetch details for each message
            detailed_messages = []
            for msg in messages[:max_results]:
                details = service.users().messages().get(
                    userId='me',
                    id=msg['id'],
                    format='metadata',
                    metadataHeaders=['From', 'To', 'Subject', 'Date']
                ).execute()
                
                # Extract headers
                headers = {h['name']: h['value'] for h in details.get('payload', {}).get('headers', [])}
                
                detailed_messages.append({
                    'id': details['id'],
                    'thread_id': details['threadId'],
                    'from': headers.get('From', ''),
                    'to': headers.get('To', ''),
                    'subject': headers.get('Subject', ''),
                    'date': headers.get('Date', ''),
                    'snippet': details.get('snippet', ''),
                    'labels': details.get('labelIds', []),
                    'is_unread': 'UNREAD' in details.get('labelIds', [])
                })
            
            return {
                "success": True,
                "messages": detailed_messages,
                "count": len(detailed_messages),
                "query": query
            }
            
        except Exception as e:
            logger.error(f"[Gmail API] List failed: {e}")
            return {"success": False, "error": str(e)}
    
    async def get_message(self, user_id: str, message_id: str) -> Dict[str, Any]:
        """Get full email content by ID."""
        service = self.get_service(user_id)
        if not service:
            return {"success": False, "error": "No Gmail API access"}
        
        try:
            message = service.users().messages().get(
                userId='me',
                id=message_id,
                format='full'
            ).execute()
            
            # Extract body
            payload = message.get('payload', {})
            body = self._extract_body(payload)
            
            # Extract headers
            headers = {h['name']: h['value'] for h in payload.get('headers', [])}
            
            return {
                "success": True,
                "id": message['id'],
                "thread_id": message['threadId'],
                "from": headers.get('From', ''),
                "to": headers.get('To', ''),
                "subject": headers.get('Subject', ''),
                "date": headers.get('Date', ''),
                "body": body,
                "labels": message.get('labelIds', [])
            }
            
        except Exception as e:
            logger.error(f"[Gmail API] Get message failed: {e}")
            return {"success": False, "error": str(e)}
    
    async def batch_modify(
        self,
        user_id: str,
        message_ids: List[str],
        add_labels: Optional[List[str]] = None,
        remove_labels: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """Batch modify multiple emails at once.
        
        Archive 100 emails in ONE API call vs 100 browser clicks.
        """
        service = self.get_service(user_id)
        if not service:
            return {"success": False, "error": "No Gmail API access"}
        
        try:
            body = {'ids': message_ids}
            
            if add_labels:
                body['addLabelIds'] = add_labels
            if remove_labels:
                body['removeLabelIds'] = remove_labels
            
            service.users().messages().batchModify(
                userId='me',
                body=body
            ).execute()
            
            logger.info(f"[Gmail API] Batch modified {len(message_ids)} messages")
            
            return {
                "success": True,
                "modified_count": len(message_ids),
                "added_labels": add_labels,
                "removed_labels": remove_labels
            }
            
        except Exception as e:
            logger.error(f"[Gmail API] Batch modify failed: {e}")
            return {"success": False, "error": str(e)}
    
    async def archive_messages(self, user_id: str, message_ids: List[str]) -> Dict[str, Any]:
        """Archive multiple emails (remove from INBOX)."""
        return await self.batch_modify(
            user_id=user_id,
            message_ids=message_ids,
            remove_labels=['INBOX']
        )
    
    async def mark_as_read(self, user_id: str, message_ids: List[str]) -> Dict[str, Any]:
        """Mark emails as read."""
        return await self.batch_modify(
            user_id=user_id,
            message_ids=message_ids,
            remove_labels=['UNREAD']
        )
    
    async def trash_messages(self, user_id: str, message_ids: List[str]) -> Dict[str, Any]:
        """Move emails to trash."""
        return await self.batch_modify(
            user_id=user_id,
            message_ids=message_ids,
            add_labels=['TRASH'],
            remove_labels=['INBOX']
        )
    
    def _extract_body(self, payload: Dict) -> str:
        """Extract email body from payload."""
        if 'body' in payload and payload['body'].get('data'):
            return base64.urlsafe_b64decode(payload['body']['data']).decode('utf-8', errors='ignore')
        
        if 'parts' in payload:
            for part in payload['parts']:
                if part.get('mimeType') == 'text/plain':
                    if part.get('body', {}).get('data'):
                        return base64.urlsafe_b64decode(part['body']['data']).decode('utf-8', errors='ignore')
                elif part.get('mimeType') == 'text/html':
                    if part.get('body', {}).get('data'):
                        return base64.urlsafe_b64decode(part['body']['data']).decode('utf-8', errors='ignore')
        
        return ""
    
    # =========================================================================
    # Tool Definitions
    # =========================================================================
    
    def get_tools(self) -> List[GoogleApiTool]:
        """Return Gmail API tools for Centris."""
        return [
            GoogleApiTool(
                name="gmail_api_send",
                label="Send Email (Fast)",
                description="Send email via Gmail API. 25x faster than browser automation.",
                parameters={
                    "type": "object",
                    "properties": {
                        "to": {"type": "string", "description": "Recipient email"},
                        "subject": {"type": "string", "description": "Email subject"},
                        "body": {"type": "string", "description": "Email body"},
                        "cc": {"type": "string", "description": "CC recipients (optional)"},
                        "bcc": {"type": "string", "description": "BCC recipients (optional)"},
                    },
                    "required": ["to", "subject", "body"]
                },
                execute=self.send_email,
                tags=["email", "fast", "api"]
            ),
            GoogleApiTool(
                name="gmail_api_search",
                label="Search Emails (Fast)",
                description="Search emails with Gmail query syntax. Returns structured data.",
                parameters={
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Gmail search query (e.g., 'from:boss@company.com is:unread')"},
                        "max_results": {"type": "integer", "description": "Max emails to return", "default": 10},
                    },
                    "required": ["query"]
                },
                execute=self.list_messages,
                tags=["email", "search", "fast", "api"]
            ),
            GoogleApiTool(
                name="gmail_api_archive_batch",
                label="Archive Emails (Batch)",
                description="Archive multiple emails in one call. 100x faster than clicking each.",
                parameters={
                    "type": "object",
                    "properties": {
                        "message_ids": {"type": "array", "items": {"type": "string"}, "description": "List of message IDs to archive"},
                    },
                    "required": ["message_ids"]
                },
                execute=self.archive_messages,
                tags=["email", "batch", "fast", "api"]
            ),
        ]


# Singleton instance
gmail_api_connector = GmailApiConnector()
