"""Desktop accessibility CLI commands.

Dedicated desktop command family mapped to Action API desktop.* methods.
"""

import time
from typing import Optional

import click

from centris_sdk.action_api import (
    ActionDesktopClickRequest,
    ActionDesktopFindRequest,
    ActionDesktopSnapshotRequest,
    ActionDesktopTypeRequest,
    ActionDesktopWindowsRequest,
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


@click.group("desktop")
def desktop_group() -> None:
    """Control desktop apps via the Centris Accessibility API bridge."""


@desktop_group.command("snapshot")
@click.option("--app-name", help="Optional app name")
@click.option("--window-title", help="Optional window title filter")
@click.option("--key", "key", help="API key override")
@click.option("--base-url", help="API base URL override")
@click.option("--timeout", default=120, type=int, show_default=True)
@click.option("--json", "json_output", is_flag=True, help="Output raw JSON")
@click.pass_context
def desktop_snapshot_command(
    ctx: click.Context,
    app_name: Optional[str],
    window_title: Optional[str],
    key: Optional[str],
    base_url: Optional[str],
    timeout: int,
    json_output: bool,
):
    started_at = time.time()
    client = _client(ctx, key, base_url, timeout)
    result = client.desktop_snapshot(
        ActionDesktopSnapshotRequest(app_name=app_name, window_title=window_title)
    )

    if json_output:
        emit_result_envelope(
            build_result_envelope(
                ok=True,
                operation="desktop.snapshot",
                summary=f"Captured {result.element_count} desktop elements",
                data={
                    "appName": result.app_name,
                    "windowTitle": result.window_title,
                    "elementCount": result.element_count,
                    "elements": result.elements,
                    "note": result.note,
                },
                duration_ms=int((time.time() - started_at) * 1000),
            )
        )
        return

    click.echo(f"Captured {result.element_count} desktop elements")


@desktop_group.command("find")
@click.option("--app-name", help="Optional app name")
@click.option("--window-title", help="Optional window title filter")
@click.option("--role", help="AX role filter (example: AXButton)")
@click.option("--name", "name_filter", help="Element name filter")
@click.option("--key", "key", help="API key override")
@click.option("--base-url", help="API base URL override")
@click.option("--timeout", default=120, type=int, show_default=True)
@click.option("--json", "json_output", is_flag=True, help="Output raw JSON")
@click.pass_context
def desktop_find_command(
    ctx: click.Context,
    app_name: Optional[str],
    window_title: Optional[str],
    role: Optional[str],
    name_filter: Optional[str],
    key: Optional[str],
    base_url: Optional[str],
    timeout: int,
    json_output: bool,
):
    started_at = time.time()
    client = _client(ctx, key, base_url, timeout)
    result = client.desktop_find(
        ActionDesktopFindRequest(
            app_name=app_name,
            window_title=window_title,
            role=role,
            name=name_filter,
        )
    )

    if json_output:
        emit_result_envelope(
            build_result_envelope(
                ok=True,
                operation="desktop.find",
                summary=f"Matched {result.count} desktop elements",
                data={"count": result.count, "elements": result.elements, "note": result.note},
                duration_ms=int((time.time() - started_at) * 1000),
            )
        )
        return

    click.echo(f"Matched {result.count} desktop elements")


@desktop_group.command("click")
@click.option("--element-id", required=True, type=int, help="Element ID from snapshot/find")
@click.option("--key", "key", help="API key override")
@click.option("--base-url", help="API base URL override")
@click.option("--timeout", default=120, type=int, show_default=True)
@click.option("--json", "json_output", is_flag=True, help="Output raw JSON")
@click.pass_context
def desktop_click_command(
    ctx: click.Context,
    element_id: int,
    key: Optional[str],
    base_url: Optional[str],
    timeout: int,
    json_output: bool,
):
    started_at = time.time()
    client = _client(ctx, key, base_url, timeout)
    result = client.desktop_click(ActionDesktopClickRequest(element_id=element_id))

    if json_output:
        emit_result_envelope(
            build_result_envelope(
                ok=result.ok,
                operation="desktop.click",
                summary=f"Clicked element {element_id}" if result.ok else "Desktop click failed",
                data={"ok": result.ok, "details": result.details},
                errors=[] if result.ok else ["Desktop click failed"],
                duration_ms=int((time.time() - started_at) * 1000),
            )
        )
        return

    if not result.ok:
        raise click.ClickException("Desktop click failed")
    click.echo(f"Clicked element {element_id}")


@desktop_group.command("type")
@click.option("--text", required=True, help="Text to type")
@click.option("--element-id", type=int, help="Optional element ID from snapshot/find")
@click.option("--key", "key", help="API key override")
@click.option("--base-url", help="API base URL override")
@click.option("--timeout", default=120, type=int, show_default=True)
@click.option("--json", "json_output", is_flag=True, help="Output raw JSON")
@click.pass_context
def desktop_type_command(
    ctx: click.Context,
    text: str,
    element_id: Optional[int],
    key: Optional[str],
    base_url: Optional[str],
    timeout: int,
    json_output: bool,
):
    started_at = time.time()
    client = _client(ctx, key, base_url, timeout)
    result = client.desktop_type(ActionDesktopTypeRequest(text=text, element_id=element_id))

    if json_output:
        emit_result_envelope(
            build_result_envelope(
                ok=result.ok,
                operation="desktop.type",
                summary="Desktop typing succeeded" if result.ok else "Desktop typing failed",
                data={"ok": result.ok, "details": result.details},
                errors=[] if result.ok else ["Desktop typing failed"],
                duration_ms=int((time.time() - started_at) * 1000),
            )
        )
        return

    if not result.ok:
        raise click.ClickException("Desktop typing failed")
    click.echo("Desktop typing succeeded")


@desktop_group.command("apps")
@click.option("--key", "key", help="API key override")
@click.option("--base-url", help="API base URL override")
@click.option("--timeout", default=120, type=int, show_default=True)
@click.option("--json", "json_output", is_flag=True, help="Output raw JSON")
@click.pass_context
def desktop_apps_command(
    ctx: click.Context,
    key: Optional[str],
    base_url: Optional[str],
    timeout: int,
    json_output: bool,
):
    started_at = time.time()
    client = _client(ctx, key, base_url, timeout)
    result = client.desktop_apps()

    if json_output:
        emit_result_envelope(
            build_result_envelope(
                ok=True,
                operation="desktop.apps",
                summary=f"Listed {len(result.apps)} apps",
                data={"apps": result.apps},
                duration_ms=int((time.time() - started_at) * 1000),
            )
        )
        return

    click.echo(f"Listed {len(result.apps)} apps")


@desktop_group.command("windows")
@click.option("--app-name", help="Optional app name")
@click.option("--key", "key", help="API key override")
@click.option("--base-url", help="API base URL override")
@click.option("--timeout", default=120, type=int, show_default=True)
@click.option("--json", "json_output", is_flag=True, help="Output raw JSON")
@click.pass_context
def desktop_windows_command(
    ctx: click.Context,
    app_name: Optional[str],
    key: Optional[str],
    base_url: Optional[str],
    timeout: int,
    json_output: bool,
):
    started_at = time.time()
    client = _client(ctx, key, base_url, timeout)
    result = client.desktop_windows(ActionDesktopWindowsRequest(app_name=app_name))

    if json_output:
        emit_result_envelope(
            build_result_envelope(
                ok=True,
                operation="desktop.windows",
                summary=f"Listed {len(result.windows)} windows",
                data={"windows": result.windows},
                duration_ms=int((time.time() - started_at) * 1000),
            )
        )
        return

    click.echo(f"Listed {len(result.windows)} windows")
