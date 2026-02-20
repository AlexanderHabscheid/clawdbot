"""Web memory CLI commands.

Unified CLI surface for cached web playbooks.
"""

import json
import time
import hashlib
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import click

from centris_sdk.action_api import (
    ActionAnchor,
    ActionIndexEntry,
    ActionNodeHint,
    ActionPageFingerprint,
    ActionWebMemoryExecuteRequest,
    ActionWebMemoryIndexRequest,
    ActionWebMemoryInvalidateRequest,
    ActionWebMemoryResolveRequest,
    ActionWebMemoryStatsRequest,
)
from centris_sdk.cli.do_cmd import _get_api_key, _get_api_url
from centris_sdk.cli.result_envelope import build_result_envelope, emit_result_envelope
from centris_sdk.client import Centris


def _client(ctx: click.Context, key: Optional[str], base_url: Optional[str], timeout: int) -> Centris:
    return Centris(
        api_key=_get_api_key(ctx, key),
        base_url=base_url or _get_api_url(ctx),
        timeout=float(timeout),
    )


def _parse_json_object(raw: Optional[str], label: str) -> Dict[str, Any]:
    if not raw:
        return {}
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise click.ClickException(f"{label} must be a JSON object")
    return parsed


def _slugify(value: str) -> str:
    normalized = "".join(ch.lower() if ch.isalnum() else "_" for ch in value.strip())
    collapsed = "_".join(part for part in normalized.split("_") if part)
    return collapsed or "action"


def _infer_affordance(node: Dict[str, Any]) -> str:
    role = str(node.get("r") or node.get("role") or "").lower()
    node_type = str(node.get("t") or node.get("type") or "").lower()
    name = str(node.get("n") or node.get("name") or "").lower()
    if "input" in node_type or role == "textbox":
        return "type"
    if role == "link" or "link" in node_type:
        return "navigate"
    if "submit" in name:
        return "submit"
    return "click"


def _derive_snapshot_indexing(
    snapshot_file: str,
    url: str,
    intent: Optional[str],
    fingerprint_id: Optional[str],
) -> tuple[ActionPageFingerprint, list[ActionIndexEntry]]:
    with open(snapshot_file, "r", encoding="utf-8") as handle:
        snapshot = json.load(handle)
    if not isinstance(snapshot, dict):
        raise click.ClickException("snapshot file must contain a JSON object")

    metadata = snapshot.get("metadata")
    metadata = metadata if isinstance(metadata, dict) else {}
    interactive_nodes = snapshot.get("interactiveNodes")
    if not isinstance(interactive_nodes, list):
        interactive_nodes = []
    headings = snapshot.get("headings")
    headings = [item for item in headings if isinstance(item, str)] if isinstance(headings, list) else []
    nav_labels = snapshot.get("navLabels")
    nav_labels = [item for item in nav_labels if isinstance(item, str)] if isinstance(nav_labels, list) else []
    primary_actions = [
        str(node.get("n") or node.get("name") or "").strip()
        for node in interactive_nodes
        if isinstance(node, dict)
    ]
    primary_actions = [item for item in primary_actions if item][:12]
    digest = hashlib.sha256(
        json.dumps(
            {
                "url": url,
                "title": metadata.get("title"),
                "headings": headings,
                "navLabels": nav_labels,
                "count": len(interactive_nodes),
            },
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    page_fingerprint = ActionPageFingerprint(
        fingerprint_id=fingerprint_id,
        url_pattern=url,
        title_hints=[metadata["title"]] if isinstance(metadata.get("title"), str) else [],
        headings=headings,
        nav_labels=nav_labels,
        primary_actions=primary_actions,
        interactive_summary={
            "total": len(interactive_nodes),
            "buttons": sum(
                1
                for node in interactive_nodes
                if isinstance(node, dict) and str(node.get("r") or node.get("role") or "") == "button"
            ),
            "links": sum(
                1
                for node in interactive_nodes
                if isinstance(node, dict) and str(node.get("r") or node.get("role") or "") == "link"
            ),
            "inputs": sum(
                1
                for node in interactive_nodes
                if isinstance(node, dict) and "input" in str(node.get("t") or node.get("type") or "").lower()
            ),
        },
        signature_hash=f"sha256:{digest}",
        generated_at=now,
        confidence=0.7,
    )

    action_index: list[ActionIndexEntry] = []
    for index, node in enumerate(interactive_nodes):
        if not isinstance(node, dict):
            continue
        semantic_label = str(node.get("n") or node.get("name") or "").strip()
        if not semantic_label:
            continue
        selector = node.get("selector")
        node_id = node.get("id") if isinstance(node.get("id"), int) else None
        anchors = [ActionAnchor(anchor_type="label", value=semantic_label, weight=1.0)]
        if isinstance(selector, str) and selector:
            anchors.append(ActionAnchor(anchor_type="selector", value=selector, weight=0.8))
        action_index.append(
            ActionIndexEntry(
                action_id=f"{_slugify(semantic_label)}_{index + 1}",
                intent=intent or semantic_label,
                affordance=_infer_affordance(node),  # type: ignore[arg-type]
                semantic_label=semantic_label,
                node_hints=[
                    ActionNodeHint(
                        node_id=node_id,
                        selector=selector if isinstance(selector, str) else None,
                        role=node.get("r") if isinstance(node.get("r"), str) else None,
                        name=semantic_label,
                    )
                ],
                anchors=anchors,
                confidence=0.65,
                updated_at=now,
            )
        )
    return page_fingerprint, action_index


@click.group("web-memory")
def web_memory_group() -> None:
    """Manage cached web playbooks for deterministic browser execution."""


@web_memory_group.command("index")
@click.option("--url", required=True, help="Target URL")
@click.option("--intent", help="Intent label")
@click.option("--playbook", help="Playbook JSON object")
@click.option("--snapshot-file", help="Snapshot JSON file to derive fingerprint/action index")
@click.option("--fingerprint-id", help="Optional fingerprint id for derived snapshot payloads")
@click.option("--ttl-ms", type=int, help="TTL in milliseconds")
@click.option("--metadata", help="Metadata JSON object")
@click.option("--key", "key", help="API key override")
@click.option("--base-url", help="API base URL override")
@click.option("--timeout", default=120, type=int, show_default=True)
@click.option("--json", "json_output", is_flag=True, help="Output raw JSON")
@click.pass_context
def web_memory_index_command(
    ctx: click.Context,
    url: str,
    intent: Optional[str],
    playbook: Optional[str],
    snapshot_file: Optional[str],
    fingerprint_id: Optional[str],
    ttl_ms: Optional[int],
    metadata: Optional[str],
    key: Optional[str],
    base_url: Optional[str],
    timeout: int,
    json_output: bool,
):
    started_at = time.time()
    client = _client(ctx, key, base_url, timeout)
    page_fingerprint = None
    action_index: list[ActionIndexEntry] = []
    if snapshot_file:
        page_fingerprint, action_index = _derive_snapshot_indexing(
            snapshot_file=snapshot_file,
            url=url,
            intent=intent,
            fingerprint_id=fingerprint_id,
        )
    result = client.web_memory.index(
        ActionWebMemoryIndexRequest(
            url=url,
            intent=intent,
            playbook=_parse_json_object(playbook, "playbook"),
            page_fingerprint=page_fingerprint,
            action_index=action_index,
            ttl_ms=ttl_ms,
            metadata=_parse_json_object(metadata, "metadata"),
        )
    )

    if json_output:
        artifacts = [result.artifact] if result.artifact else []
        emit_result_envelope(
            build_result_envelope(
                ok=result.ok,
                operation="web.memory.index",
                summary=f"Indexed web memory for {url}" if result.ok else f"Web memory index failed for {url}",
                data={
                    "ok": result.ok,
                    "cacheKey": result.cache_key,
                    "version": result.version,
                    "createdAt": result.created_at,
                    "expiresAt": result.expires_at,
                },
                errors=[] if result.ok else [f"web memory index failed for {url}"],
                artifacts=artifacts,
                duration_ms=int((time.time() - started_at) * 1000),
                safety_level="write",
            )
        )
        return

    if not result.ok:
        raise click.ClickException(f"Web memory index failed for {url}")
    click.echo(f"Indexed web memory for {url}")
    if result.cache_key:
        click.echo(f"Cache key: {result.cache_key}")
    if snapshot_file:
        click.echo(f"Derived page fingerprint + {len(action_index)} action index entries")


@web_memory_group.command("resolve")
@click.option("--url", required=True, help="Target URL")
@click.option("--intent", help="Intent label")
@click.option("--max-age-ms", type=int, help="Maximum cache age in milliseconds")
@click.option("--key", "key", help="API key override")
@click.option("--base-url", help="API base URL override")
@click.option("--timeout", default=120, type=int, show_default=True)
@click.option("--json", "json_output", is_flag=True, help="Output raw JSON")
@click.pass_context
def web_memory_resolve_command(
    ctx: click.Context,
    url: str,
    intent: Optional[str],
    max_age_ms: Optional[int],
    key: Optional[str],
    base_url: Optional[str],
    timeout: int,
    json_output: bool,
):
    started_at = time.time()
    client = _client(ctx, key, base_url, timeout)
    result = client.web_memory.resolve(
        ActionWebMemoryResolveRequest(url=url, intent=intent, max_age_ms=max_age_ms)
    )

    if json_output:
        artifacts = [result.artifact] if result.artifact else []
        emit_result_envelope(
            build_result_envelope(
                ok=True,
                operation="web.memory.resolve",
                summary=f"Resolved web memory for {url}" if result.hit else f"No web memory hit for {url}",
                data={
                    "hit": result.hit,
                    "cacheKey": result.cache_key,
                    "playbook": result.playbook,
                    "generatedAt": result.generated_at,
                    "expiresAt": result.expires_at,
                },
                artifacts=artifacts,
                duration_ms=int((time.time() - started_at) * 1000),
                safety_level="read",
            )
        )
        return

    if not result.hit:
        click.echo(f"No cached playbook found for {url}")
        return
    click.echo(f"Resolved cached playbook for {url}")
    if result.cache_key:
        click.echo(f"Cache key: {result.cache_key}")


@web_memory_group.command("execute")
@click.option("--url", required=True, help="Target URL")
@click.option("--intent", help="Intent label")
@click.option("--operation", help="Operation name")
@click.option("--params", help="Operation params JSON object")
@click.option("--key", "key", help="API key override")
@click.option("--base-url", help="API base URL override")
@click.option("--timeout", default=120, type=int, show_default=True)
@click.option("--json", "json_output", is_flag=True, help="Output raw JSON")
@click.pass_context
def web_memory_execute_command(
    ctx: click.Context,
    url: str,
    intent: Optional[str],
    operation: Optional[str],
    params: Optional[str],
    key: Optional[str],
    base_url: Optional[str],
    timeout: int,
    json_output: bool,
):
    started_at = time.time()
    client = _client(ctx, key, base_url, timeout)
    result = client.web_memory.execute(
        ActionWebMemoryExecuteRequest(
            url=url,
            intent=intent,
            operation=operation,
            params=_parse_json_object(params, "params"),
        )
    )

    if json_output:
        emit_result_envelope(
            build_result_envelope(
                ok=result.ok,
                operation="web.memory.execute",
                summary=f"Executed web memory for {url}" if result.ok else f"Web memory execute failed for {url}",
                data={
                    "ok": result.ok,
                    "source": result.source,
                    "executed": result.executed,
                    "details": result.details,
                },
                artifacts=result.artifacts,
                errors=[] if result.ok else [f"web memory execute failed for {url}"],
                duration_ms=int((time.time() - started_at) * 1000),
                safety_level="external",
            )
        )
        return

    if not result.ok:
        raise click.ClickException(f"Web memory execute failed for {url}")
    click.echo(f"Executed web memory for {url}")
    if result.source:
        click.echo(f"Source: {result.source}")


@web_memory_group.command("invalidate")
@click.option("--url", help="Target URL")
@click.option("--playbook-id", help="Specific playbook id")
@click.option("--scope", type=click.Choice(["url", "domain", "all"]), help="Invalidation scope")
@click.option("--reason", help="Invalidation reason")
@click.option("--yes", is_flag=True, help="Confirm destructive invalidation")
@click.option("--key", "key", help="API key override")
@click.option("--base-url", help="API base URL override")
@click.option("--timeout", default=120, type=int, show_default=True)
@click.option("--json", "json_output", is_flag=True, help="Output raw JSON")
@click.pass_context
def web_memory_invalidate_command(
    ctx: click.Context,
    url: Optional[str],
    playbook_id: Optional[str],
    scope: Optional[str],
    reason: Optional[str],
    yes: bool,
    key: Optional[str],
    base_url: Optional[str],
    timeout: int,
    json_output: bool,
):
    if not yes:
        raise click.ClickException("web-memory invalidate is destructive. Re-run with --yes.")

    started_at = time.time()
    client = _client(ctx, key, base_url, timeout)
    result = client.web_memory.invalidate(
        ActionWebMemoryInvalidateRequest(
            url=url,
            playbook_id=playbook_id,
            scope=scope,  # type: ignore[arg-type]
            reason=reason,
        )
    )

    if json_output:
        emit_result_envelope(
            build_result_envelope(
                ok=result.ok,
                operation="web.memory.invalidate",
                summary=(
                    f"Invalidated {result.invalidated} web memory entries"
                    if result.ok
                    else "Web memory invalidate failed"
                ),
                data={"ok": result.ok, "invalidated": result.invalidated},
                errors=[] if result.ok else ["web memory invalidate failed"],
                duration_ms=int((time.time() - started_at) * 1000),
                safety_level="destructive",
            )
        )
        return

    if not result.ok:
        raise click.ClickException("Web memory invalidate failed")
    click.echo(f"Invalidated {result.invalidated} web memory entries")


@web_memory_group.command("stats")
@click.option("--url", help="Target URL")
@click.option("--window", type=click.Choice(["1h", "24h", "7d", "30d"]), help="Stats window")
@click.option("--key", "key", help="API key override")
@click.option("--base-url", help="API base URL override")
@click.option("--timeout", default=120, type=int, show_default=True)
@click.option("--json", "json_output", is_flag=True, help="Output raw JSON")
@click.pass_context
def web_memory_stats_command(
    ctx: click.Context,
    url: Optional[str],
    window: Optional[str],
    key: Optional[str],
    base_url: Optional[str],
    timeout: int,
    json_output: bool,
):
    started_at = time.time()
    client = _client(ctx, key, base_url, timeout)
    result = client.web_memory.stats(
        ActionWebMemoryStatsRequest(
            url=url,
            window=window,  # type: ignore[arg-type]
        )
    )

    if json_output:
        emit_result_envelope(
            build_result_envelope(
                ok=True,
                operation="web.memory.stats",
                summary=f"Web memory stats ({window or '24h'})",
                data={
                    "entries": result.entries,
                    "hits": result.hits,
                    "misses": result.misses,
                    "hitRate": result.hit_rate,
                    "avgResolveMs": result.avg_resolve_ms,
                },
                duration_ms=int((time.time() - started_at) * 1000),
                safety_level="read",
            )
        )
        return

    click.echo("Web memory stats")
    click.echo(f"Entries: {result.entries}")
    click.echo(f"Hits: {result.hits}")
    click.echo(f"Misses: {result.misses}")
