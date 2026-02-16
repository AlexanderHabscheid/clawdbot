"""Google Drive API Connector for Centris AI.

Fast file management via API.
Upload, download, search, share files.

API Docs: https://developers.google.com/drive/api
"""
from __future__ import annotations

import logging
import io
from typing import Any, Dict, List, Optional

from .base import GoogleWorkspaceConnectorBase, GoogleApiTool

logger = logging.getLogger(__name__)


class DriveApiConnector(GoogleWorkspaceConnectorBase):
    """Google Drive API connector.
    
    Capabilities:
    - Upload/download files
    - Search files
    - Share files
    - Create folders
    - Move/copy files
    """
    
    SERVICE_NAME = "drive"
    SERVICE_VERSION = "v3"
    REQUIRED_SCOPES = [
        "https://www.googleapis.com/auth/drive",
        "https://www.googleapis.com/auth/drive.file",
    ]
    
    @property
    def id(self) -> str:
        return "drive-api"
    
    @property
    def name(self) -> str:
        return "Google Drive API"
    
    @property
    def description(self) -> str:
        return "Fast file management via API. Upload, search, share files."
    
    async def list_files(
        self,
        user_id: str,
        query: Optional[str] = None,
        max_results: int = 10,
        folder_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """List/search files in Drive."""
        service = self.get_service(user_id)
        if not service:
            return {"success": False, "error": "No Drive API access"}
        
        try:
            # Build query
            q_parts = []
            if query:
                q_parts.append(f"name contains '{query}'")
            if folder_id:
                q_parts.append(f"'{folder_id}' in parents")
            q_parts.append("trashed = false")
            
            q = " and ".join(q_parts)
            
            results = service.files().list(
                q=q,
                pageSize=max_results,
                fields="files(id, name, mimeType, size, createdTime, modifiedTime, webViewLink, parents)"
            ).execute()
            
            files = results.get('files', [])
            
            return {
                "success": True,
                "files": files,
                "count": len(files)
            }
            
        except Exception as e:
            logger.error(f"[Drive API] List files failed: {e}")
            return {"success": False, "error": str(e)}
    
    async def create_folder(
        self,
        user_id: str,
        name: str,
        parent_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """Create a folder in Drive."""
        service = self.get_service(user_id)
        if not service:
            return {"success": False, "error": "No Drive API access"}
        
        try:
            file_metadata = {
                'name': name,
                'mimeType': 'application/vnd.google-apps.folder'
            }
            
            if parent_id:
                file_metadata['parents'] = [parent_id]
            
            folder = service.files().create(
                body=file_metadata,
                fields='id, name, webViewLink'
            ).execute()
            
            logger.info(f"[Drive API] Folder created: {folder.get('id')}")
            
            return {
                "success": True,
                "folder_id": folder.get('id'),
                "name": folder.get('name'),
                "web_link": folder.get('webViewLink')
            }
            
        except Exception as e:
            logger.error(f"[Drive API] Create folder failed: {e}")
            return {"success": False, "error": str(e)}
    
    async def share_file(
        self,
        user_id: str,
        file_id: str,
        email: str,
        role: str = 'reader',
        send_notification: bool = True
    ) -> Dict[str, Any]:
        """Share a file with someone."""
        service = self.get_service(user_id)
        if not service:
            return {"success": False, "error": "No Drive API access"}
        
        try:
            permission = {
                'type': 'user',
                'role': role,  # 'reader', 'writer', 'commenter'
                'emailAddress': email
            }
            
            service.permissions().create(
                fileId=file_id,
                body=permission,
                sendNotificationEmail=send_notification
            ).execute()
            
            logger.info(f"[Drive API] File {file_id} shared with {email}")
            
            return {
                "success": True,
                "file_id": file_id,
                "shared_with": email,
                "role": role
            }
            
        except Exception as e:
            logger.error(f"[Drive API] Share file failed: {e}")
            return {"success": False, "error": str(e)}
    
    async def delete_file(self, user_id: str, file_id: str) -> Dict[str, Any]:
        """Delete a file or folder."""
        service = self.get_service(user_id)
        if not service:
            return {"success": False, "error": "No Drive API access"}
        
        try:
            service.files().delete(fileId=file_id).execute()
            logger.info(f"[Drive API] File deleted: {file_id}")
            return {"success": True, "deleted_file_id": file_id}
            
        except Exception as e:
            logger.error(f"[Drive API] Delete file failed: {e}")
            return {"success": False, "error": str(e)}
    
    async def move_file(
        self,
        user_id: str,
        file_id: str,
        new_parent_id: str
    ) -> Dict[str, Any]:
        """Move a file to a different folder."""
        service = self.get_service(user_id)
        if not service:
            return {"success": False, "error": "No Drive API access"}
        
        try:
            # Get current parents
            file = service.files().get(
                fileId=file_id,
                fields='parents'
            ).execute()
            previous_parents = ",".join(file.get('parents', []))
            
            # Move file
            file = service.files().update(
                fileId=file_id,
                addParents=new_parent_id,
                removeParents=previous_parents,
                fields='id, name, parents'
            ).execute()
            
            logger.info(f"[Drive API] File {file_id} moved to {new_parent_id}")
            return {
                "success": True,
                "file_id": file_id,
                "new_parent_id": new_parent_id
            }
            
        except Exception as e:
            logger.error(f"[Drive API] Move file failed: {e}")
            return {"success": False, "error": str(e)}
    
    def get_tools(self) -> List[GoogleApiTool]:
        return [
            GoogleApiTool(
                name="drive_api_search",
                label="Search Drive Files",
                description="Search files in Google Drive.",
                parameters={
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Search query"},
                        "max_results": {"type": "integer", "default": 10},
                    }
                },
                execute=self.list_files,
                tags=["drive", "files", "search", "api"]
            ),
            GoogleApiTool(
                name="drive_api_create_folder",
                label="Create Folder",
                description="Create a folder in Google Drive.",
                parameters={
                    "type": "object",
                    "properties": {
                        "name": {"type": "string", "description": "Folder name"},
                        "parent_id": {"type": "string", "description": "Parent folder ID (optional)"},
                    },
                    "required": ["name"]
                },
                execute=self.create_folder,
                tags=["drive", "folder", "create", "api"]
            ),
            GoogleApiTool(
                name="drive_api_share",
                label="Share File",
                description="Share a Drive file with someone.",
                parameters={
                    "type": "object",
                    "properties": {
                        "file_id": {"type": "string", "description": "File ID"},
                        "email": {"type": "string", "description": "Email to share with"},
                        "role": {"type": "string", "enum": ["reader", "writer", "commenter"], "default": "reader"},
                    },
                    "required": ["file_id", "email"]
                },
                execute=self.share_file,
                tags=["drive", "share", "api"]
            ),
        ]


drive_api_connector = DriveApiConnector()
