"""Web memory CLI commands.

Unified CLI surface for cached web playbooks.
"""

import json
import time
from typing import Any, Dict, Optional

import click

from centris_sdk.action_api import (
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


@click.group("web-memory")
def web_memory_group() -> None:
    """Manage cached web playbooks for deterministic browser execution."""


@web_memory_group.command("index")
@click.option("--url", required=True, help="Target URL")
@click.option("--intent", help="Intent label")
@click.option("--playbook", help="Playbook JSON object")
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
    ttl_ms: Optional[int],
    metadata: Optional[str],
    key: Optional[str],
    base_url: Optional[str],
    timeout: int,
    json_output: bool,
):
    started_at = time.time()
    client = _client(ctx, key, base_url, timeout)
    result = client.web_memory.index(
        ActionWebMemoryIndexRequest(
            url=url,
            intent=intent,
            playbook=_parse_json_object(playbook, "playbook"),
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
