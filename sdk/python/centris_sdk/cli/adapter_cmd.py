"""Adapter CLI commands for external system interoperability."""

from __future__ import annotations

import json
import click
from typing import Any, Dict, Optional

from centris_sdk.adapter_runtime import (
    AdapterOperation,
    AdapterRuntime,
    AdapterSpec,
)
from centris_sdk.cli.result_envelope import build_result_envelope, emit_result_envelope


def _parse_json(raw: Optional[str], label: str, default: Any) -> Any:
    if not raw:
        return default
    try:
        return json.loads(raw)
    except Exception as exc:
        raise click.ClickException(f"Invalid {label} JSON: {exc}") from exc


def _parse_adapter_spec(raw: str) -> AdapterSpec:
    parsed = _parse_json(raw, "adapter", {})
    if not isinstance(parsed, dict):
        raise click.ClickException("adapter must be a JSON object")

    transport = str(parsed.get("transport", "")).strip()
    if transport not in ("subprocess", "http", "sdk"):
        raise click.ClickException("adapter.transport must be one of subprocess|http|sdk")

    operations_raw = parsed.get("operations", [])
    operations: list[AdapterOperation] = []
    if isinstance(operations_raw, list):
        for item in operations_raw:
            if not isinstance(item, dict):
                continue
            op = str(item.get("operation", "")).strip()
            level = str(item.get("safetyLevel", "read")).strip()
            if op:
                operations.append(
                    AdapterOperation(
                        operation=op,
                        safety_level=level,  # type: ignore[arg-type]
                    )
                )

    return AdapterSpec(
        adapter_id=str(parsed.get("adapterId", "")).strip(),
        system=str(parsed.get("system", "")).strip(),
        transport=transport,  # type: ignore[arg-type]
        operations=operations,
        default_timeout_ms=int(parsed.get("defaultTimeoutMs", 30_000)),
        max_timeout_ms=int(parsed.get("maxTimeoutMs", 120_000)),
        system_version=parsed.get("systemVersion"),
    )


@click.group("adapter")
def adapter_group() -> None:
    """Run external-system adapter operations."""


@adapter_group.command("run")
@click.option("--adapter", required=True, help="Adapter spec JSON")
@click.option("--operation", required=True, help="Operation name")
@click.option("--input", "input_json", help="Operation input JSON object")
@click.option("--timeout-ms", type=int, help="Operation timeout in milliseconds")
@click.option("--dry-run", is_flag=True, help="Validate and return without executing")
@click.option("--allow-external", is_flag=True, help="Allow external safety-level operations")
@click.option("--allow-destructive", is_flag=True, help="Allow destructive safety-level operations")
@click.option("--command", help="Subprocess command")
@click.option("--args", "args_json", help="Subprocess args JSON array")
@click.option("--cwd", help="Subprocess working directory")
@click.option("--env", "env_json", help="Subprocess env JSON object")
@click.option("--url", help="HTTP endpoint URL")
@click.option("--method", default="POST", show_default=True, help="HTTP method")
@click.option("--headers", "headers_json", help="HTTP headers JSON object")
@click.option("--json", "json_output", is_flag=True, help="Output structured JSON envelope")
@click.pass_context
def adapter_run_command(
    ctx: click.Context,
    adapter: str,
    operation: str,
    input_json: Optional[str],
    timeout_ms: Optional[int],
    dry_run: bool,
    allow_external: bool,
    allow_destructive: bool,
    command: Optional[str],
    args_json: Optional[str],
    cwd: Optional[str],
    env_json: Optional[str],
    url: Optional[str],
    method: str,
    headers_json: Optional[str],
    json_output: bool,
) -> None:
    spec = _parse_adapter_spec(adapter)
    input_data = _parse_json(input_json, "input", {})
    args = _parse_json(args_json, "args", [])
    env = _parse_json(env_json, "env", {})
    headers = _parse_json(headers_json, "headers", {})
    runtime = AdapterRuntime()

    result = runtime.execute(
        spec,
        operation=operation,
        input_data=input_data if isinstance(input_data, dict) else {"value": input_data},
        timeout_ms=timeout_ms,
        dry_run=dry_run,
        allow_external=allow_external,
        allow_destructive=allow_destructive,
        subprocess_cmd=command,
        subprocess_args=args if isinstance(args, list) else [],
        subprocess_cwd=cwd,
        subprocess_env=env if isinstance(env, dict) else {},
        http_url=url,
        http_method=method,
        http_headers=headers if isinstance(headers, dict) else {},
    )

    if json_output or ctx.obj.get("json_output", False):
        emit_result_envelope(
            build_result_envelope(
                ok=result.ok,
                operation=operation,
                summary=result.summary,
                data=result.data,
                warnings=result.warnings,
                errors=result.errors,
                duration_ms=result.duration_ms,
                connector_id=spec.adapter_id or None,
                system=spec.system or None,
                system_version=spec.system_version,
                safety_level=result.safety_level,
            )
        )
        if not result.ok:
            ctx.exit(1)
        return

    if result.ok:
        click.echo(result.summary)
        return

    raise click.ClickException("; ".join(result.errors) if result.errors else result.summary)
