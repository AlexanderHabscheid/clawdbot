"""Google Tasks API Connector for Centris AI.

Todo list management via API.

API Docs: https://developers.google.com/tasks/reference/rest
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from .base import GoogleWorkspaceConnectorBase, GoogleApiTool

logger = logging.getLogger(__name__)


class TasksApiConnector(GoogleWorkspaceConnectorBase):
    """Google Tasks API connector.
    
    Capabilities:
    - Create/update/delete tasks
    - Manage task lists
    - Mark tasks complete
    """
    
    SERVICE_NAME = "tasks"
    SERVICE_VERSION = "v1"
    REQUIRED_SCOPES = ["https://www.googleapis.com/auth/tasks"]
    
    @property
    def id(self) -> str:
        return "tasks-api"
    
    @property
    def name(self) -> str:
        return "Google Tasks API"
    
    @property
    def description(self) -> str:
        return "Todo list management via API."
    
    async def list_task_lists(self, user_id: str) -> Dict[str, Any]:
        """List all task lists."""
        service = self.get_service(user_id)
        if not service:
            return {"success": False, "error": "No Tasks API access"}
        
        try:
            results = service.tasklists().list().execute()
            task_lists = results.get('items', [])
            
            return {
                "success": True,
                "task_lists": [
                    {'id': tl.get('id'), 'title': tl.get('title')}
                    for tl in task_lists
                ],
                "count": len(task_lists)
            }
            
        except Exception as e:
            logger.error(f"[Tasks API] List task lists failed: {e}")
            return {"success": False, "error": str(e)}
    
    async def list_tasks(
        self,
        user_id: str,
        tasklist_id: str = '@default'
    ) -> Dict[str, Any]:
        """List tasks in a task list."""
        service = self.get_service(user_id)
        if not service:
            return {"success": False, "error": "No Tasks API access"}
        
        try:
            results = service.tasks().list(tasklist=tasklist_id).execute()
            tasks = results.get('items', [])
            
            formatted = []
            for task in tasks:
                formatted.append({
                    'id': task.get('id'),
                    'title': task.get('title'),
                    'notes': task.get('notes'),
                    'due': task.get('due'),
                    'status': task.get('status'),
                    'completed': task.get('completed')
                })
            
            return {
                "success": True,
                "tasks": formatted,
                "count": len(formatted)
            }
            
        except Exception as e:
            logger.error(f"[Tasks API] List tasks failed: {e}")
            return {"success": False, "error": str(e)}
    
    async def create_task(
        self,
        user_id: str,
        title: str,
        notes: Optional[str] = None,
        due: Optional[str] = None,
        tasklist_id: str = '@default'
    ) -> Dict[str, Any]:
        """Create a new task."""
        service = self.get_service(user_id)
        if not service:
            return {"success": False, "error": "No Tasks API access"}
        
        try:
            task = {'title': title}
            if notes:
                task['notes'] = notes
            if due:
                task['due'] = due
            
            result = service.tasks().insert(
                tasklist=tasklist_id,
                body=task
            ).execute()
            
            logger.info(f"[Tasks API] Task created: {result.get('id')}")
            
            return {
                "success": True,
                "task_id": result.get('id'),
                "title": title
            }
            
        except Exception as e:
            logger.error(f"[Tasks API] Create task failed: {e}")
            return {"success": False, "error": str(e)}
    
    async def complete_task(
        self,
        user_id: str,
        task_id: str,
        tasklist_id: str = '@default'
    ) -> Dict[str, Any]:
        """Mark a task as complete."""
        service = self.get_service(user_id)
        if not service:
            return {"success": False, "error": "No Tasks API access"}
        
        try:
            task = service.tasks().get(
                tasklist=tasklist_id,
                task=task_id
            ).execute()
            
            task['status'] = 'completed'
            
            result = service.tasks().update(
                tasklist=tasklist_id,
                task=task_id,
                body=task
            ).execute()
            
            logger.info(f"[Tasks API] Task completed: {task_id}")
            
            return {
                "success": True,
                "task_id": task_id,
                "status": "completed"
            }
            
        except Exception as e:
            logger.error(f"[Tasks API] Complete task failed: {e}")
            return {"success": False, "error": str(e)}
    
    async def delete_task(
        self,
        user_id: str,
        task_id: str,
        tasklist_id: str = '@default'
    ) -> Dict[str, Any]:
        """Delete a task."""
        service = self.get_service(user_id)
        if not service:
            return {"success": False, "error": "No Tasks API access"}
        
        try:
            service.tasks().delete(
                tasklist=tasklist_id,
                task=task_id
            ).execute()
            
            logger.info(f"[Tasks API] Task deleted: {task_id}")
            return {"success": True, "deleted_task_id": task_id}
            
        except Exception as e:
            logger.error(f"[Tasks API] Delete task failed: {e}")
            return {"success": False, "error": str(e)}
    
    def get_tools(self) -> List[GoogleApiTool]:
        return [
            GoogleApiTool(
                name="tasks_api_list",
                label="List Tasks",
                description="List tasks from Google Tasks.",
                parameters={
                    "type": "object",
                    "properties": {
                        "tasklist_id": {"type": "string", "description": "Task list ID", "default": "@default"},
                    }
                },
                execute=self.list_tasks,
                tags=["tasks", "todo", "list", "api"]
            ),
            GoogleApiTool(
                name="tasks_api_create",
                label="Create Task",
                description="Create a new task.",
                parameters={
                    "type": "object",
                    "properties": {
                        "title": {"type": "string", "description": "Task title"},
                        "notes": {"type": "string", "description": "Task notes"},
                        "due": {"type": "string", "description": "Due date (RFC 3339)"},
                    },
                    "required": ["title"]
                },
                execute=self.create_task,
                tags=["tasks", "todo", "create", "api"]
            ),
            GoogleApiTool(
                name="tasks_api_complete",
                label="Complete Task",
                description="Mark a task as complete.",
                parameters={
                    "type": "object",
                    "properties": {
                        "task_id": {"type": "string", "description": "Task ID"},
                    },
                    "required": ["task_id"]
                },
                execute=self.complete_task,
                tags=["tasks", "complete", "api"]
            ),
        ]


tasks_api_connector = TasksApiConnector()
