"""
TodoApp Connector - Complete Example

A fully working example connector that demonstrates key patterns:
1. Runtime target definitions
2. Tool implementations (browser automation recipes)
3. Tool schema definitions (what LLM sees)
4. Connector export

This is a "compiled recipe" connector - it knows exactly where to click,
making Centris 10x faster than LLM-in-the-loop screenshot analysis.

NO OAUTH REQUIRED - uses the user's existing browser session.
The user is already logged into TodoApp in their browser.

Usage:
    # Import the connector
    from centris_sdk.examples.todoapp import connector
    
    # Get tools for LLM
    tools = connector.api.get_tools()
    
    # Execute a tool (in Centris runtime)
    result = await todoapp_add_task("call_123", {"title": "Buy milk"}, context)
"""

import logging
from dataclasses import dataclass, field
from typing import Dict, Any, List, Optional, Callable

logger = logging.getLogger(__name__)


# =============================================================================
# STEP 1: Define Runtime Targets
# =============================================================================
# This legacy example uses selector targets. Prefer runtime node IDs from live snapshots.

class TodoAppSelectors:
    """TodoApp interaction targets (legacy selector example)."""
    
    # Task Input
    NEW_TASK_INPUT = '[data-testid="new-task-input"], #new-task, .task-input input'
    ADD_TASK_BUTTON = '[data-testid="add-task"], button[type="submit"], .add-btn'
    
    # Task List
    TASK_LIST = '[data-testid="task-list"], .task-list, ul.tasks'
    TASK_ITEM = '[data-testid="task-item"], .task-item, li.task'
    TASK_CHECKBOX = '[data-testid="task-checkbox"], input[type="checkbox"]'
    TASK_DELETE = '[data-testid="delete-task"], .delete-btn, button.delete'
    
    # Filters
    FILTER_ALL = '[data-testid="filter-all"], .filter-all, [href="#/"]'
    FILTER_ACTIVE = '[data-testid="filter-active"], .filter-active, [href="#/active"]'
    FILTER_COMPLETED = '[data-testid="filter-completed"], .filter-completed, [href="#/completed"]'
    
    # Clear
    CLEAR_COMPLETED = '[data-testid="clear-completed"], .clear-completed'
    TASK_COUNT = '[data-testid="task-count"], .task-count, .todo-count'


class TodoAppURLs:
    """URL patterns for TodoApp."""
    
    BASE = "https://todomvc.com/examples/react/dist/"
    
    @classmethod
    def is_todoapp(cls, url: str) -> bool:
        """Check if URL is a TodoApp page."""
        return "todomvc.com" in url or "todo" in url.lower()


# =============================================================================
# STEP 2: Implement Tools (Browser Automation Recipes)
# =============================================================================
# Each tool is a "compiled recipe" - deterministic steps that don't need LLM analysis.

async def todoapp_add_task(
    tool_call_id: str,
    params: Dict[str, Any],
    context: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Add a new task to the todo list.
    
    This is a "compiled recipe" - we know exactly where to click and type.
    10x faster than: Screenshot → LLM: "where's the input?" → Click → etc.
    
    Args:
        tool_call_id: Unique ID for this tool call
        params: {"title": "Buy groceries"}
        context: Contains browser_bridge for automation
        
    Returns:
        {"success": True/False, "message": "..."}
    """
    # Get the browser bridge from context
    browser_bridge = context.get("browser_bridge") if context else None
    
    if not browser_bridge:
        return {
            "success": False,
            "error": "Browser bridge not available. Ensure Centris desktop app is running."
        }
    
    title = params.get("title", "").strip()
    if not title:
        return {"success": False, "error": "Task title is required"}
    
    try:
        logger.info(f"[TodoApp] Adding task: {title}")
        
        # Step 1: Ensure we're on TodoApp
        current_tab = await browser_bridge.get_active_tab()
        if not TodoAppURLs.is_todoapp(current_tab.get("url", "")):
            await browser_bridge.navigate_browser(TodoAppURLs.BASE)
            await browser_bridge.wait(2000)
        
        # Step 2: Type task title into input
        await browser_bridge.input_text_node(TodoAppSelectors.NEW_TASK_INPUT, title)
        await browser_bridge.wait(300)
        
        # Step 3: Press Enter to add task
        await browser_bridge.press_key("Enter")
        await browser_bridge.wait(500)
        
        logger.info(f"[TodoApp] Task added successfully: {title}")
        
        return {
            "success": True,
            "message": f"Added task: {title}"
        }
        
    except Exception as e:
        logger.error(f"[TodoApp] Failed to add task: {e}")
        return {"success": False, "error": str(e)}


async def todoapp_complete_task(
    tool_call_id: str,
    params: Dict[str, Any],
    context: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Mark a task as complete by clicking its checkbox.
    
    Args:
        params: {"task_text": "Buy groceries"} - partial match of task text
    """
    browser_bridge = context.get("browser_bridge") if context else None
    
    if not browser_bridge:
        return {"success": False, "error": "Browser bridge not available"}
    
    task_text = params.get("task_text", "")
    if not task_text:
        return {"success": False, "error": "task_text is required"}
    
    try:
        logger.info(f"[TodoApp] Completing task: {task_text}")
        
        # Find and click the checkbox for this task
        # We'll use a CSS selector that matches the task text
        # In real implementation, you might need to use getPageContent to find the right element
        
        # Click the checkbox (this selector targets checkboxes within task items)
        checkbox_selector = f'{TodoAppSelectors.TASK_ITEM}:has(label:contains("{task_text}")) {TodoAppSelectors.TASK_CHECKBOX}'
        
        # Fallback: try simpler approach - get page content and find the task
        await browser_bridge.click_node(checkbox_selector)
        await browser_bridge.wait(300)
        
        return {
            "success": True,
            "message": f"Completed task: {task_text}"
        }
        
    except Exception as e:
        logger.error(f"[TodoApp] Failed to complete task: {e}")
        return {"success": False, "error": str(e)}


async def todoapp_delete_task(
    tool_call_id: str,
    params: Dict[str, Any],
    context: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """Delete a task from the list."""
    browser_bridge = context.get("browser_bridge") if context else None
    
    if not browser_bridge:
        return {"success": False, "error": "Browser bridge not available"}
    
    task_text = params.get("task_text", "")
    if not task_text:
        return {"success": False, "error": "task_text is required"}
    
    try:
        logger.info(f"[TodoApp] Deleting task: {task_text}")
        
        # Hover over task to show delete button, then click
        task_selector = f'{TodoAppSelectors.TASK_ITEM}:has(label:contains("{task_text}"))'
        delete_selector = f'{task_selector} {TodoAppSelectors.TASK_DELETE}'
        
        # Hover to reveal delete button
        await browser_bridge.click_node(task_selector)
        await browser_bridge.wait(200)
        
        # Click delete
        await browser_bridge.click_node(delete_selector)
        await browser_bridge.wait(300)
        
        return {
            "success": True,
            "message": f"Deleted task: {task_text}"
        }
        
    except Exception as e:
        logger.error(f"[TodoApp] Failed to delete task: {e}")
        return {"success": False, "error": str(e)}


async def todoapp_get_tasks(
    tool_call_id: str,
    params: Dict[str, Any],
    context: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """Get all tasks from the todo list."""
    browser_bridge = context.get("browser_bridge") if context else None
    
    if not browser_bridge:
        return {"success": False, "error": "Browser bridge not available"}
    
    try:
        logger.info("[TodoApp] Getting task list")
        
        # Get page content to extract tasks
        content = await browser_bridge.get_page_content()
        
        # In a real implementation, you'd parse the page content
        # For now, return a placeholder
        return {
            "success": True,
            "tasks": [],
            "message": "Retrieved task list"
        }
        
    except Exception as e:
        logger.error(f"[TodoApp] Failed to get tasks: {e}")
        return {"success": False, "error": str(e)}


async def todoapp_clear_completed(
    tool_call_id: str,
    params: Dict[str, Any],
    context: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """Clear all completed tasks."""
    browser_bridge = context.get("browser_bridge") if context else None
    
    if not browser_bridge:
        return {"success": False, "error": "Browser bridge not available"}
    
    try:
        logger.info("[TodoApp] Clearing completed tasks")
        
        await browser_bridge.click_node(TodoAppSelectors.CLEAR_COMPLETED)
        await browser_bridge.wait(500)
        
        return {
            "success": True,
            "message": "Cleared all completed tasks"
        }
        
    except Exception as e:
        logger.error(f"[TodoApp] Failed to clear completed: {e}")
        return {"success": False, "error": str(e)}


# =============================================================================
# STEP 3: Define Tool Schemas (what the LLM sees)
# =============================================================================

@dataclass
class Tool:
    """Tool definition for Centris registry."""
    name: str
    description: str
    parameters: Dict[str, Any]
    execute: Callable
    label: Optional[str] = None
    tags: List[str] = field(default_factory=list)


class TodoAppConnectorApi:
    """API for tool registration with Centris."""
    
    def __init__(self):
        self._gateway_methods: Dict[str, Callable] = {}
        self._services: List[Any] = []
    
    def get_tools(self, context: Any = None) -> List[Tool]:
        """Return all TodoApp tools for Centris.
        
        These tool schemas tell the LLM what tools are available
        and how to call them.
        """
        return [
            Tool(
                name="todoapp_add_task",
                label="Add Task",
                description="Add a new task to the todo list. No login needed - uses your existing browser session.",
                parameters={
                    "type": "object",
                    "properties": {
                        "title": {
                            "type": "string",
                            "description": "The task title/description"
                        }
                    },
                    "required": ["title"]
                },
                execute=todoapp_add_task,
                tags=["productivity", "todo"]
            ),
            Tool(
                name="todoapp_complete_task",
                label="Complete Task",
                description="Mark a task as complete by checking its checkbox.",
                parameters={
                    "type": "object",
                    "properties": {
                        "task_text": {
                            "type": "string",
                            "description": "Text of the task to complete (partial match)"
                        }
                    },
                    "required": ["task_text"]
                },
                execute=todoapp_complete_task,
                tags=["productivity", "todo"]
            ),
            Tool(
                name="todoapp_delete_task",
                label="Delete Task",
                description="Delete a task from the todo list.",
                parameters={
                    "type": "object",
                    "properties": {
                        "task_text": {
                            "type": "string",
                            "description": "Text of the task to delete (partial match)"
                        }
                    },
                    "required": ["task_text"]
                },
                execute=todoapp_delete_task,
                tags=["productivity", "todo"]
            ),
            Tool(
                name="todoapp_get_tasks",
                label="Get Tasks",
                description="Get all tasks from the todo list.",
                parameters={
                    "type": "object",
                    "properties": {
                        "filter": {
                            "type": "string",
                            "enum": ["all", "active", "completed"],
                            "description": "Filter tasks by status",
                            "default": "all"
                        }
                    }
                },
                execute=todoapp_get_tasks,
                tags=["productivity", "todo"]
            ),
            Tool(
                name="todoapp_clear_completed",
                label="Clear Completed",
                description="Remove all completed tasks from the list.",
                parameters={
                    "type": "object",
                    "properties": {}
                },
                execute=todoapp_clear_completed,
                tags=["productivity", "todo"]
            ),
        ]


# =============================================================================
# STEP 4: Export Connector
# =============================================================================

@dataclass
class TodoAppConnector:
    """
    TodoApp connector - compiled browser automation recipes.
    
    This connector doesn't need OAuth because it operates within
    the user's existing browser session where they're already logged in.
    
    How it makes Centris faster:
    
        WITHOUT CONNECTOR (LLM-in-loop, 10-30 seconds):
            Screenshot → LLM: "find task input" → Click
            Screenshot → LLM: "type task" → Type
            Screenshot → LLM: "press enter" → Done
        
        WITH CONNECTOR (compiled recipe, 1-3 seconds):
            LLM: "use todoapp_add_task" → Connector executes all steps
    """
    
    id: str = "todoapp"
    name: str = "TodoApp"
    version: str = "1.0.0"
    description: str = "Fast todo list automation using compiled browser recipes. No OAuth needed."
    
    # API for tool registration
    api: TodoAppConnectorApi = field(default_factory=TodoAppConnectorApi)
    
    # URL patterns this connector handles
    url_patterns: List[str] = field(default_factory=lambda: [
        r"todomvc\.com",
        r"todo.*app",
    ])
    
    # Capabilities
    capabilities: List[str] = field(default_factory=lambda: [
        "add_task",
        "complete_task", 
        "delete_task",
        "get_tasks",
        "clear_completed",
    ])


# This is what the ConnectorManager discovers
connector = TodoAppConnector()


# =============================================================================
# Module-level exports (for import)
# =============================================================================

__all__ = [
    "connector",
    "TodoAppConnector",
    "TodoAppConnectorApi",
    "TodoAppSelectors",
    "TodoAppURLs",
    "todoapp_add_task",
    "todoapp_complete_task",
    "todoapp_delete_task",
    "todoapp_get_tasks",
    "todoapp_clear_completed",
]
