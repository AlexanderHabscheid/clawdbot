"""High-level executeTask API for Centris SDK."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Dict, Optional

if TYPE_CHECKING:
    from centris_sdk.client import Centris


@dataclass
class ExecuteTaskResult:
    """Result of execute_task()."""

    output: Any
    task_id: str
    status: str
    actions: list
    usage: Optional[Dict[str, Any]] = None


def execute_task(
    client: "Centris",
    task: str,
    *,
    async_mode: bool = False,
    wait: bool = True,
    output_schema: Optional[Dict[str, Any]] = None,
    context: Optional[Dict[str, Any]] = None,
) -> ExecuteTaskResult:
    """Execute a natural-language task. High-level API over do().

    When output_schema is provided, uses extract() internally to return typed data.
    Otherwise returns the raw text result.

    Args:
        client: Centris client instance
        task: Natural language task description
        async_mode: If True, return immediately with task_id for polling
        wait: When async_mode, wait for completion (default True)
        output_schema: JSON Schema for structured output (uses extract internally)
        context: Additional context

    Returns:
        ExecuteTaskResult with output, task_id, status, actions

    Example:
        >>> result = centris.execute_task("Open Gmail and read first email subject")
        >>> print(result.output)

        >>> schema = {"type": "object", "properties": {"flights": {"type": "array"}}}
        >>> result = centris.execute_task("Search flights NYC to LA", output_schema=schema)
        >>> print(result.output["flights"])
    """
    if output_schema:
        from centris_sdk.extract import extract

        extract_result = extract(
            client,
            task,
            output_schema,
            async_mode=async_mode,
            wait=wait,
            context=context,
        )
        return ExecuteTaskResult(
            output=extract_result.data,
            task_id=extract_result.task_id,
            status=extract_result.status,
            actions=extract_result.actions,
        )

    result = client.do(task, async_mode=async_mode, context=context or {})

    if wait and result.task_id and result.status in ("queued", "running"):
        result = client.wait(result.task_id)

    return ExecuteTaskResult(
        output=result.text,
        task_id=result.task_id,
        status=result.status,
        actions=result.actions,
        usage=result.usage,
    )
