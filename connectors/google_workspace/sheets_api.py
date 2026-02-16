"""Google Sheets API Connector for Centris AI.

Fast spreadsheet automation via API.

API Docs: https://developers.google.com/sheets/api
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from .base import GoogleWorkspaceConnectorBase, GoogleApiTool

logger = logging.getLogger(__name__)


class SheetsApiConnector(GoogleWorkspaceConnectorBase):
    """Google Sheets API connector.
    
    Capabilities:
    - Create spreadsheets
    - Read/write cells
    - Batch updates (1000 cells in one call)
    - Format cells
    """
    
    SERVICE_NAME = "sheets"
    SERVICE_VERSION = "v4"
    REQUIRED_SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
    
    @property
    def id(self) -> str:
        return "sheets-api"
    
    @property
    def name(self) -> str:
        return "Google Sheets API"
    
    @property
    def description(self) -> str:
        return "Fast spreadsheet automation via API."
    
    async def create_spreadsheet(
        self,
        user_id: str,
        title: str,
        sheet_names: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """Create a new spreadsheet."""
        service = self.get_service(user_id)
        if not service:
            return {"success": False, "error": "No Sheets API access"}
        
        try:
            spreadsheet = {'properties': {'title': title}}
            
            if sheet_names:
                spreadsheet['sheets'] = [
                    {'properties': {'title': name}} for name in sheet_names
                ]
            
            result = service.spreadsheets().create(body=spreadsheet).execute()
            
            logger.info(f"[Sheets API] Spreadsheet created: {result.get('spreadsheetId')}")
            
            return {
                "success": True,
                "spreadsheet_id": result.get('spreadsheetId'),
                "title": title,
                "url": result.get('spreadsheetUrl')
            }
            
        except Exception as e:
            logger.error(f"[Sheets API] Create spreadsheet failed: {e}")
            return {"success": False, "error": str(e)}
    
    async def read_range(
        self,
        user_id: str,
        spreadsheet_id: str,
        range_notation: str
    ) -> Dict[str, Any]:
        """Read values from a range."""
        service = self.get_service(user_id)
        if not service:
            return {"success": False, "error": "No Sheets API access"}
        
        try:
            result = service.spreadsheets().values().get(
                spreadsheetId=spreadsheet_id,
                range=range_notation
            ).execute()
            
            values = result.get('values', [])
            
            return {
                "success": True,
                "range": range_notation,
                "values": values,
                "rows": len(values)
            }
            
        except Exception as e:
            logger.error(f"[Sheets API] Read range failed: {e}")
            return {"success": False, "error": str(e)}
    
    async def write_range(
        self,
        user_id: str,
        spreadsheet_id: str,
        range_notation: str,
        values: List[List[Any]]
    ) -> Dict[str, Any]:
        """Write values to a range."""
        service = self.get_service(user_id)
        if not service:
            return {"success": False, "error": "No Sheets API access"}
        
        try:
            body = {'values': values}
            
            result = service.spreadsheets().values().update(
                spreadsheetId=spreadsheet_id,
                range=range_notation,
                valueInputOption='USER_ENTERED',
                body=body
            ).execute()
            
            logger.info(f"[Sheets API] Updated {result.get('updatedCells')} cells")
            
            return {
                "success": True,
                "updated_cells": result.get('updatedCells'),
                "updated_range": result.get('updatedRange')
            }
            
        except Exception as e:
            logger.error(f"[Sheets API] Write range failed: {e}")
            return {"success": False, "error": str(e)}
    
    async def append_rows(
        self,
        user_id: str,
        spreadsheet_id: str,
        range_notation: str,
        values: List[List[Any]]
    ) -> Dict[str, Any]:
        """Append rows to a sheet."""
        service = self.get_service(user_id)
        if not service:
            return {"success": False, "error": "No Sheets API access"}
        
        try:
            body = {'values': values}
            
            result = service.spreadsheets().values().append(
                spreadsheetId=spreadsheet_id,
                range=range_notation,
                valueInputOption='USER_ENTERED',
                insertDataOption='INSERT_ROWS',
                body=body
            ).execute()
            
            logger.info(f"[Sheets API] Appended rows to {spreadsheet_id}")
            
            return {
                "success": True,
                "updated_range": result.get('updates', {}).get('updatedRange'),
                "appended_rows": len(values)
            }
            
        except Exception as e:
            logger.error(f"[Sheets API] Append rows failed: {e}")
            return {"success": False, "error": str(e)}
    
    def get_tools(self) -> List[GoogleApiTool]:
        return [
            GoogleApiTool(
                name="sheets_api_create",
                label="Create Spreadsheet",
                description="Create a new Google Spreadsheet.",
                parameters={
                    "type": "object",
                    "properties": {
                        "title": {"type": "string", "description": "Spreadsheet title"},
                        "sheet_names": {"type": "array", "items": {"type": "string"}, "description": "Sheet names"},
                    },
                    "required": ["title"]
                },
                execute=self.create_spreadsheet,
                tags=["sheets", "create", "api"]
            ),
            GoogleApiTool(
                name="sheets_api_read",
                label="Read Spreadsheet",
                description="Read values from a spreadsheet range.",
                parameters={
                    "type": "object",
                    "properties": {
                        "spreadsheet_id": {"type": "string", "description": "Spreadsheet ID"},
                        "range_notation": {"type": "string", "description": "Range (e.g., 'Sheet1!A1:D10')"},
                    },
                    "required": ["spreadsheet_id", "range_notation"]
                },
                execute=self.read_range,
                tags=["sheets", "read", "api"]
            ),
            GoogleApiTool(
                name="sheets_api_write",
                label="Write to Spreadsheet",
                description="Write values to a spreadsheet range.",
                parameters={
                    "type": "object",
                    "properties": {
                        "spreadsheet_id": {"type": "string", "description": "Spreadsheet ID"},
                        "range_notation": {"type": "string", "description": "Range"},
                        "values": {"type": "array", "description": "2D array of values"},
                    },
                    "required": ["spreadsheet_id", "range_notation", "values"]
                },
                execute=self.write_range,
                tags=["sheets", "write", "api"]
            ),
        ]


sheets_api_connector = SheetsApiConnector()
