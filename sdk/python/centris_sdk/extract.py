"""Structured extraction API for Centris SDK.

Extract typed, structured data from pages using natural language.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Dict, Optional

if TYPE_CHECKING:
    from centris_sdk.client import Centris


@dataclass
class ExtractResult:
    """Result of extract()."""

    data: Dict[str, Any]
    raw_text: str
    task_id: str
    status: str
    actions: list


def _parse_json_from_result(text: str) -> Any | None:
    """Try to parse result text as JSON, optionally wrapped in markdown code blocks."""
    trimmed = text.strip()
    code_block_match = re.match(r"^```(?:json)?\s*([\s\S]*?)```$", trimmed)
    to_parse = (code_block_match.group(1) or "").strip() if code_block_match else trimmed
    if not to_parse:
        return None
    try:
        return json.loads(to_parse)
    except json.JSONDecodeError:
        return None


def extract(
    client: "Centris",
    instruction: str,
    schema: Dict[str, Any],
    *,
    async_mode: bool = False,
    wait: bool = True,
    context: Optional[Dict[str, Any]] = None,
) -> ExtractResult:
    """Extract structured data from the current page/context using natural language.

    The instruction should describe what to extract (e.g. "Get the first 5 product names and prices").
    The schema defines the expected output shape (JSON Schema). The backend returns structured JSON
    when outputSchema is provided in context.

    Args:
        client: Centris client instance
        instruction: Natural language instruction for extraction
        schema: JSON Schema dict for the expected output
        async_mode: If True, return immediately with task_id for polling
        wait: When async_mode, wait for completion (default True)
        context: Additional context for the command

    Returns:
        ExtractResult with data, raw_text, task_id, status, actions

    Raises:
        ValueError: If result is not valid JSON or validation fails

    Example:
        >>> schema = {
        ...     "type": "object",
        ...     "properties": {
        ...         "products": {
        ...             "type": "array",
        ...             "items": {
        ...                 "type": "object",
        ...                 "properties": {"name": {"type": "string"}, "price": {"type": "number"}},
        ...             },
        ...         }
        ...     },
        ... }
        >>> result = centris.extract("Get first 5 products", schema)
        >>> print(result.data["products"])
    """
    ctx = dict(context or {})
    ctx["outputSchema"] = schema

    result = client.do(instruction, async_mode=async_mode, context=ctx)

    if async_mode and result.status in ("queued", "running") and result.task_id:
        if wait:
            result = client.wait(result.task_id)
        else:
            raise ValueError("extract() with async_mode requires wait=True or poll via client.wait()")

    text = result.text or ""
    parsed = _parse_json_from_result(text)

    if parsed is None:
        raise ValueError(f"Extract failed: result was not valid JSON. Raw: {text[:200]}...")

    return ExtractResult(
        data=parsed,
        raw_text=text,
        task_id=result.task_id,
        status=result.status,
        actions=result.actions,
    )
