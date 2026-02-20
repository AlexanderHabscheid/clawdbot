"""Action API CLI commands.

Thin CLI client over the runtime Action API seam.
"""

import json
import time
from typing import Any, Dict, Optional

import click

from centris_sdk.action_api import (
    ActionArtifact,
    ActionRouteRecordStartRequest,
    ActionRouteRecordStopRequest,
    ActionRouteRunRequest,
)
from centris_sdk.cli.do_cmd import _get_api_key, _get_api_url
from centris_sdk.cli.result_envelope import build_result_envelope, emit_result_envelope
from centris_sdk.client import Centris
from centris_sdk.kernel import (
    KernelActRequest,
    KernelObserveRequest,
    KernelSuccessCheck,
    KernelVerifyRequest,
)


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


def _parse_checks(raw: Optional[str]) -> list[KernelSuccessCheck]:
    if not raw:
        return []
    parsed = json.loads(raw)
    if not isinstance(parsed, list):
        raise click.ClickException("checks must be a JSON array")
    checks: list[KernelSuccessCheck] = []
    for item in parsed:
        if not isinstance(item, dict) or "type" not in item:
            raise click.ClickException("each check must be an object with a 'type'")
        checks.append(KernelSuccessCheck(type=item["type"], value=item.get("value")))
    return checks


def _parse_artifacts(raw: Optional[str]) -> list[ActionArtifact]:
    if not raw:
        return []
    parsed = json.loads(raw)
    if not isinstance(parsed, list):
        raise click.ClickException("artifacts must be a JSON array")
    artifacts: list[ActionArtifact] = []
    for item in parsed:
        if not isinstance(item, dict):
            raise click.ClickException("each artifact must be an object")
        artifacts.append(
            ActionArtifact(
                artifact_type=str(item.get("artifactType", "")),
                schema=str(item.get("schema", "")),
                producer_operation=str(item.get("producerOperation", "")),
                value=item.get("value", {}) if isinstance(item.get("value", {}), dict) else {},
            )
        )
    return artifacts


@click.command("observe")
@click.option("--url", help="Optional URL hint")
@click.option("--instruction", help="Optional instruction hint")
@click.option("--key", "key", help="API key override")
@click.option("--base-url", help="API base URL override")
@click.option("--timeout", default=120, type=int, show_default=True)
@click.option("--json", "json_output", is_flag=True, help="Output raw JSON")
@click.pass_context
def observe_command(
    ctx: click.Context,
    url: Optional[str],
    instruction: Optional[str],
    key: Optional[str],
    base_url: Optional[str],
    timeout: int,
    json_output: bool,
):
    started_at = time.time()
    client = _client(ctx, key, base_url, timeout)
    result = client.observe(KernelObserveRequest(url=url, instruction=instruction))

    if json_output:
        emit_result_envelope(
            build_result_envelope(
                ok=True,
                operation="action.observe",
                summary=f"Observed: {result.url}",
                data=result.__dict__,
                duration_ms=int((time.time() - started_at) * 1000),
            )
        )
        return

    click.echo(f"Observed: {result.url}")
    click.echo(f"Interactive elements: {len(result.interactive)}")


@click.command("act")
@click.option("--kind", required=True, help="navigate|click|type|press|wait|scroll")
@click.option("--target", help="Action target")
@click.option("--value", help="Action value")
@click.option("--amount", type=int, help="Numeric amount")
@click.option("--key", "key", help="API key override")
@click.option("--base-url", help="API base URL override")
@click.option("--timeout", default=120, type=int, show_default=True)
@click.option("--json", "json_output", is_flag=True, help="Output raw JSON")
@click.pass_context
def act_command(
    ctx: click.Context,
    kind: str,
    target: Optional[str],
    value: Optional[str],
    amount: Optional[int],
    key: Optional[str],
    base_url: Optional[str],
    timeout: int,
    json_output: bool,
):
    started_at = time.time()
    client = _client(ctx, key, base_url, timeout)
    result = client.act(
        KernelActRequest(
            kind=kind,  # type: ignore[arg-type]
            target=target,
            value=value,
            amount=amount,
        )
    )

    if json_output:
        emit_result_envelope(
            build_result_envelope(
                ok=result.ok,
                operation="action.act",
                summary=f"Action executed: {kind}" if result.ok else "Action failed",
                data={"ok": result.ok, "details": result.details},
                errors=[] if result.ok else ["Action failed"],
                duration_ms=int((time.time() - started_at) * 1000),
            )
        )
        return

    if not result.ok:
        raise click.ClickException("Action failed")
    click.echo(f"Action executed: {kind}")


@click.command("verify")
@click.option("--checks", required=True, help="Checks JSON array")
@click.option("--key", "key", help="API key override")
@click.option("--base-url", help="API base URL override")
@click.option("--timeout", default=120, type=int, show_default=True)
@click.option("--json", "json_output", is_flag=True, help="Output raw JSON")
@click.pass_context
def verify_command(
    ctx: click.Context,
    checks: str,
    key: Optional[str],
    base_url: Optional[str],
    timeout: int,
    json_output: bool,
):
    started_at = time.time()
    client = _client(ctx, key, base_url, timeout)
    parsed_checks = _parse_checks(checks)
    result = client.verify(KernelVerifyRequest(checks=parsed_checks))

    if json_output:
        emit_result_envelope(
            build_result_envelope(
                ok=result.ok,
                operation="action.verify",
                summary=(
                    f"Verify passed ({len(result.passed)} checks)"
                    if result.ok
                    else f"Verify failed ({len(result.failed)} checks)"
                ),
                data={
                    "ok": result.ok,
                    "passed": [c.__dict__ for c in result.passed],
                    "failed": [c.__dict__ for c in result.failed],
                },
                errors=[] if result.ok else [f"{len(result.failed)} checks failed"],
                duration_ms=int((time.time() - started_at) * 1000),
            )
        )
        return

    if not result.ok:
        raise click.ClickException(f"Verify failed ({len(result.failed)} checks)")

    click.echo(f"Verify passed ({len(result.passed)} checks)")


@click.group("route")
def route_group() -> None:
    """Route runtime operations via Action API."""


@route_group.command("run")
@click.option("--route-id", required=True, help="Route id")
@click.option("--url", help="Optional URL hint")
@click.option("--params", help="Route params JSON object")
@click.option("--checks", help="Success checks JSON array")
@click.option("--artifacts", help="Input artifacts JSON array")
@click.option("--key", "key", help="API key override")
@click.option("--base-url", help="API base URL override")
@click.option("--timeout", default=120, type=int, show_default=True)
@click.option("--json", "json_output", is_flag=True, help="Output raw JSON")
@click.pass_context
def route_run_command(
    ctx: click.Context,
    route_id: str,
    url: Optional[str],
    params: Optional[str],
    checks: Optional[str],
    artifacts: Optional[str],
    key: Optional[str],
    base_url: Optional[str],
    timeout: int,
    json_output: bool,
):
    started_at = time.time()
    client = _client(ctx, key, base_url, timeout)
    payload = ActionRouteRunRequest(
        route_id=route_id,
        url=url,
        params={k: str(v) for k, v in _parse_json_object(params, "params").items()},
        checks=_parse_checks(checks),
        artifacts=_parse_artifacts(artifacts),
    )
    result = client.route_run(payload)

    if json_output:
        out = {"ok": result.ok, "executed": result.executed}
        if result.verify is not None:
            out["verify"] = {
                "ok": result.verify.ok,
                "passed": [c.__dict__ for c in result.verify.passed],
                "failed": [c.__dict__ for c in result.verify.failed],
            }
        out["artifacts"] = [a.__dict__ for a in result.artifacts]
        emit_result_envelope(
            build_result_envelope(
                ok=result.ok,
                operation="action.route.run",
                summary=(
                    f"Route run succeeded: {route_id}" if result.ok else f"Route run failed: {route_id}"
                ),
                data=out,
                errors=[] if result.ok else [f"Route run failed: {route_id}"],
                duration_ms=int((time.time() - started_at) * 1000),
            )
        )
        return

    if not result.ok:
        raise click.ClickException(f"Route run failed: {route_id}")

    click.echo(f"Route run succeeded: {route_id} (executed={result.executed})")


@route_group.command("record-start")
@click.option("--intent", required=True, help="Recording intent")
@click.option("--url", help="Optional URL hint")
@click.option("--params", help="Params JSON object")
@click.option("--metadata", help="Metadata JSON object")
@click.option("--key", "key", help="API key override")
@click.option("--base-url", help="API base URL override")
@click.option("--timeout", default=120, type=int, show_default=True)
@click.option("--json", "json_output", is_flag=True, help="Output raw JSON")
@click.pass_context
def route_record_start_command(
    ctx: click.Context,
    intent: str,
    url: Optional[str],
    params: Optional[str],
    metadata: Optional[str],
    key: Optional[str],
    base_url: Optional[str],
    timeout: int,
    json_output: bool,
):
    started_at = time.time()
    client = _client(ctx, key, base_url, timeout)
    payload = ActionRouteRecordStartRequest(
        intent=intent,
        url=url,
        params={k: str(v) for k, v in _parse_json_object(params, "params").items()},
        metadata=_parse_json_object(metadata, "metadata"),
    )
    result = client.route_record_start(payload)

    if json_output:
        emit_result_envelope(
            build_result_envelope(
                ok=result.ok,
                operation="action.route.record.start",
                summary=(
                    f"Route recording started: {result.session_id}"
                    if result.ok
                    else f"Route record start failed: {intent}"
                ),
                data={
                    "ok": result.ok,
                    "sessionId": result.session_id,
                    "startedAt": result.started_at,
                },
                errors=[] if result.ok else [f"Route record start failed: {intent}"],
                duration_ms=int((time.time() - started_at) * 1000),
            )
        )
        return

    if not result.ok:
        raise click.ClickException(f"Route record start failed: {intent}")

    click.echo(f"Route recording started: {result.session_id}")


@route_group.command("record-stop")
@click.option("--session-id", required=True, help="Recording session id")
@click.option("--outcome", type=click.Choice(["success", "failed", "cancelled"]))
@click.option("--metadata", help="Metadata JSON object")
@click.option("--key", "key", help="API key override")
@click.option("--base-url", help="API base URL override")
@click.option("--timeout", default=120, type=int, show_default=True)
@click.option("--json", "json_output", is_flag=True, help="Output raw JSON")
@click.pass_context
def route_record_stop_command(
    ctx: click.Context,
    session_id: str,
    outcome: Optional[str],
    metadata: Optional[str],
    key: Optional[str],
    base_url: Optional[str],
    timeout: int,
    json_output: bool,
):
    started_at = time.time()
    client = _client(ctx, key, base_url, timeout)
    payload = ActionRouteRecordStopRequest(
        session_id=session_id,
        outcome=outcome,  # type: ignore[arg-type]
        metadata=_parse_json_object(metadata, "metadata"),
    )
    result = client.route_record_stop(payload)

    if json_output:
        emit_result_envelope(
            build_result_envelope(
                ok=result.ok,
                operation="action.route.record.stop",
                summary=(
                    f"Route recording stopped: {session_id}"
                    if result.ok
                    else f"Route record stop failed: {session_id}"
                ),
                data={
                    "ok": result.ok,
                    "routeId": result.route_id,
                    "updatedAt": result.updated_at,
                },
                errors=[] if result.ok else [f"Route record stop failed: {session_id}"],
                duration_ms=int((time.time() - started_at) * 1000),
            )
        )
        return

    if not result.ok:
        raise click.ClickException(f"Route record stop failed: {session_id}")

    click.echo(f"Route recording stopped: {session_id}")
