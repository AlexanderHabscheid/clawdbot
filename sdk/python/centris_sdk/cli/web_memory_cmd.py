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
    ActionRouteMemory,
    ActionRouteMemoryStep,
    ActionWebMemoryExecuteRequest,
    ActionWebMemoryIndexRequest,
    ActionWebMemoryValidateRequest,
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


@web_memory_group.command("validate")
@click.option("--payload", help="Raw ActionWebMemoryIndexRequest JSON payload")
@click.option("--payload-file", help="Path to ActionWebMemoryIndexRequest JSON file")
@click.option("--strict", is_flag=True, help="Require semantic anchors")
@click.option("--key", "key", help="API key override")
@click.option("--base-url", help="API base URL override")
@click.option("--timeout", default=120, type=int, show_default=True)
@click.option("--json", "json_output", is_flag=True, help="Output raw JSON")
@click.pass_context
def web_memory_validate_command(
    ctx: click.Context,
    payload: Optional[str],
    payload_file: Optional[str],
    strict: bool,
    key: Optional[str],
    base_url: Optional[str],
    timeout: int,
    json_output: bool,
):
    started_at = time.time()
    client = _client(ctx, key, base_url, timeout)

    payload_raw = payload
    if (not payload_raw or not payload_raw.strip()) and payload_file:
        with open(payload_file, "r", encoding="utf-8") as handle:
            payload_raw = handle.read()

    if not payload_raw or not payload_raw.strip():
        raise click.ClickException("Provide --payload or --payload-file")

    parsed = json.loads(payload_raw)
    if not isinstance(parsed, dict):
        raise click.ClickException("payload must be a JSON object")

    parsed_action_index = parsed.get("actionIndex")
    action_index: list[ActionIndexEntry] = []
    if isinstance(parsed_action_index, list):
        for item in parsed_action_index:
            if not isinstance(item, dict):
                continue
            action_id = item.get("actionId")
            intent = item.get("intent")
            affordance = item.get("affordance")
            if not (isinstance(action_id, str) and isinstance(intent, str) and isinstance(affordance, str)):
                continue
            anchors: list[ActionAnchor] = []
            for anchor in item.get("anchors", []):
                if (
                    isinstance(anchor, dict)
                    and isinstance(anchor.get("anchorType"), str)
                    and isinstance(anchor.get("value"), str)
                ):
                    anchors.append(
                        ActionAnchor(
                            anchor_type=anchor["anchorType"],
                            value=anchor["value"],
                            weight=float(anchor["weight"])
                            if isinstance(anchor.get("weight"), (int, float))
                            else None,
                        )
                    )
            node_hints: list[ActionNodeHint] = []
            for hint in item.get("nodeHints", []):
                if isinstance(hint, dict):
                    node_hints.append(
                        ActionNodeHint(
                            node_id=hint.get("nodeId") if isinstance(hint.get("nodeId"), int) else None,
                            selector=hint.get("selector") if isinstance(hint.get("selector"), str) else None,
                            role=hint.get("role") if isinstance(hint.get("role"), str) else None,
                            name=hint.get("name") if isinstance(hint.get("name"), str) else None,
                        )
                    )
            action_index.append(
                ActionIndexEntry(
                    action_id=action_id,
                    intent=intent,
                    affordance=affordance,  # type: ignore[arg-type]
                    semantic_label=item.get("semanticLabel")
                    if isinstance(item.get("semanticLabel"), str)
                    else None,
                    node_hints=node_hints,
                    anchors=anchors,
                    confidence=float(item["confidence"])
                    if isinstance(item.get("confidence"), (int, float))
                    else None,
                )
            )

    route_memory = None
    raw_route_memory = parsed.get("routeMemory")
    if isinstance(raw_route_memory, dict) and isinstance(raw_route_memory.get("routeId"), str):
        steps: list[ActionRouteMemoryStep] = []
        raw_steps = raw_route_memory.get("steps")
        if isinstance(raw_steps, list):
            for step in raw_steps:
                if isinstance(step, dict):
                    params = step.get("params") if isinstance(step.get("params"), dict) else {}
                    steps.append(
                        ActionRouteMemoryStep(
                            action_id=step.get("actionId")
                            if isinstance(step.get("actionId"), str)
                            else None,
                            operation=step.get("operation")
                            if isinstance(step.get("operation"), str)
                            else None,
                            params={k: str(v) for k, v in params.items()},
                        )
                    )
        route_memory = ActionRouteMemory(
            route_id=raw_route_memory["routeId"],
            steps=steps,
            confidence=float(raw_route_memory["confidence"])
            if isinstance(raw_route_memory.get("confidence"), (int, float))
            else None,
        )

    payload_request = ActionWebMemoryIndexRequest(
        url=str(parsed.get("url", "")),
        intent=parsed.get("intent") if isinstance(parsed.get("intent"), str) else None,
        playbook=parsed.get("playbook") if isinstance(parsed.get("playbook"), dict) else {},
        page_fingerprint=(
            ActionPageFingerprint(
                fingerprint_id=parsed.get("pageFingerprint", {}).get("fingerprintId")
                if isinstance(parsed.get("pageFingerprint"), dict)
                else None
            )
            if isinstance(parsed.get("pageFingerprint"), dict)
            else None
        ),
        action_index=action_index,
        route_memory=route_memory,
        ttl_ms=parsed.get("ttlMs") if isinstance(parsed.get("ttlMs"), int) else None,
        metadata=parsed.get("metadata") if isinstance(parsed.get("metadata"), dict) else {},
    )

    result = client.web_memory.validate(
        ActionWebMemoryValidateRequest(
            payload=payload_request,
            strict=strict,
        )
    )

    if json_output:
        emit_result_envelope(
            build_result_envelope(
                ok=result.ok,
                operation="web.memory.validate",
                summary="web memory payload is valid" if result.ok else "web memory payload is invalid",
                data={
                    "ok": result.ok,
                    "errors": result.errors,
                    "warnings": result.warnings,
                    "stats": result.stats,
                },
                errors=result.errors,
                warnings=result.warnings,
                duration_ms=int((time.time() - started_at) * 1000),
                safety_level="read",
            )
        )
        if not result.ok:
            ctx.exit(1)
        return

    if not result.ok:
        raise click.ClickException("; ".join(result.errors))
    click.echo("Web memory payload is valid")
    if result.stats:
        click.echo(
            f"actions={result.stats.get('actionCount', 0)}, anchors={result.stats.get('anchorCount', 0)}, "
            f"nodeHints={result.stats.get('nodeHintCount', 0)}, semanticAnchors={result.stats.get('semanticAnchorCount', 0)}"
        )
    for warning in result.warnings:
        click.echo(f"warning: {warning}")


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
