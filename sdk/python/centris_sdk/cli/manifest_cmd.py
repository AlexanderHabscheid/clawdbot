"""Manifest CLI commands for external ecosystem publishing."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

import click

from centris_sdk.cli.result_envelope import build_result_envelope, emit_result_envelope


def _parse_manifest(file_path: Path) -> Dict[str, Any]:
    if not file_path.exists():
        raise click.ClickException(f"Manifest not found: {file_path}")
    try:
        data = json.loads(file_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise click.ClickException(f"Invalid JSON in {file_path}: {exc}") from exc
    if not isinstance(data, dict):
        raise click.ClickException("Manifest root must be an object.")
    required = ["centris", "app", "url_patterns", "routes"]
    missing = [field for field in required if field not in data]
    if missing:
        raise click.ClickException(f"Manifest missing required fields: {', '.join(missing)}")
    if not isinstance(data.get("url_patterns"), list) or not data["url_patterns"]:
        raise click.ClickException("url_patterns must be a non-empty array.")
    if not isinstance(data.get("routes"), dict):
        raise click.ClickException("routes must be an object.")
    return data


def _host_from_pattern(pattern: str) -> Optional[str]:
    raw = pattern.strip()
    if not raw:
        return None
    if "://" not in raw:
        raw = f"https://{raw}"
    try:
        from urllib.parse import urlparse

        return urlparse(raw).hostname.replace("*.", "").lower()  # type: ignore[union-attr]
    except Exception:
        return None


def _build_diagnostics(file_path: Path, manifest: Dict[str, Any]) -> Dict[str, Any]:
    warnings: List[str] = []
    errors: List[str] = []
    routes = manifest.get("routes", {})
    if not isinstance(routes, dict):
        routes = {}

    route_count = len(routes)
    action_count = 0
    landmark_count = 0

    hosts = []
    for pattern in manifest.get("url_patterns", []):
        if isinstance(pattern, str):
            host = _host_from_pattern(pattern)
            if host:
                hosts.append(host)
    hosts = sorted(set(hosts))
    if not hosts:
        errors.append("No valid url pattern hosts found.")

    for route_key, route in routes.items():
        if not isinstance(route, dict):
            continue
        actions = route.get("actions", {})
        landmarks = route.get("landmarks", {})
        if not isinstance(actions, dict):
            actions = {}
        if not isinstance(landmarks, dict):
            landmarks = {}
        action_count += len(actions)
        landmark_count += len(landmarks)

        if not actions and not landmarks:
            warnings.append(f'Route "{route_key}" has no landmarks or actions.')

        for action_name, action in actions.items():
            if not isinstance(action, dict):
                continue
            if "confidence" not in action:
                warnings.append(f'Action "{route_key}:{action_name}" missing confidence.')
            checks = action.get("successChecks", action.get("verify"))
            if not checks:
                warnings.append(f'Action "{route_key}:{action_name}" missing success checks.')

    if action_count == 0:
        errors.append("Manifest defines no actions.")

    return {
        "file": str(file_path),
        "app": manifest.get("app"),
        "route_count": route_count,
        "action_count": action_count,
        "landmark_count": landmark_count,
        "hosts": hosts,
        "warnings": warnings,
        "errors": errors,
    }


@click.group("manifest")
def manifest_group() -> None:
    """Manage website manifests for external Centris ecosystem usage."""


@manifest_group.command("doctor")
@click.argument("file", required=False, default="centris.json")
@click.option("--strict", is_flag=True, help="Fail when warnings are present")
@click.option("--json-output", "json_output", is_flag=True, help="Output JSON envelope")
def manifest_doctor_command(file: str, strict: bool, json_output: bool) -> None:
    """Run diagnostics on a manifest before publishing."""
    file_path = Path(file).resolve()
    manifest = _parse_manifest(file_path)
    report = _build_diagnostics(file_path, manifest)
    ok = len(report["errors"]) == 0 and (not strict or len(report["warnings"]) == 0)

    if json_output:
        envelope = build_result_envelope(
            ok=ok,
            operation="manifest.doctor",
            summary="Manifest passed diagnostics" if ok else "Manifest has diagnostics",
            data=report,
            warnings=report["warnings"],
            errors=report["errors"],
            duration_ms=0,
            connector_id=str(report.get("app") or ""),
        )
        emit_result_envelope(envelope)
    else:
        click.echo(f'Manifest: {report["file"]}')
        click.echo(
            f'Routes={report["route_count"]} Actions={report["action_count"]} '
            f'Landmarks={report["landmark_count"]}'
        )
        click.echo(f'Hosts: {", ".join(report["hosts"]) if report["hosts"] else "(none)"}')
        for warning in report["warnings"]:
            click.echo(f"⚠ {warning}")
        for error in report["errors"]:
            click.echo(f"✗ {error}")
        if ok:
            click.echo("✓ Manifest doctor passed")

    if not ok:
        raise click.ClickException("Manifest doctor failed.")


@manifest_group.command("publish")
@click.argument("file", required=False, default="centris.json")
@click.option("--well-known-out", default=".well-known/centris.json", help="Well-known output path")
@click.option("--connector-out-dir", default="", help="Optional connector package output dir")
@click.option("--force", is_flag=True, help="Overwrite existing outputs")
@click.option("--dry-run", is_flag=True, help="Print outputs without writing files")
@click.option("--json-output", "json_output", is_flag=True, help="Output JSON envelope")
def manifest_publish_command(
    file: str,
    well_known_out: str,
    connector_out_dir: str,
    force: bool,
    dry_run: bool,
    json_output: bool,
) -> None:
    """Publish well-known and optional connector distribution artifacts."""
    file_path = Path(file).resolve()
    manifest = _parse_manifest(file_path)
    report = _build_diagnostics(file_path, manifest)
    if report["errors"]:
        raise click.ClickException("Manifest publish blocked by diagnostics errors.")

    well_known_path = Path(well_known_out).resolve()
    outputs = [str(well_known_path)]
    connector_manifest_path: Optional[Path] = None
    connector_readme_path: Optional[Path] = None
    if connector_out_dir.strip():
        connector_dir = Path(connector_out_dir).resolve()
        connector_manifest_path = connector_dir / "centris.json"
        connector_readme_path = connector_dir / "README.md"
        outputs.extend([str(connector_manifest_path), str(connector_readme_path)])

    if json_output:
        envelope = build_result_envelope(
            ok=True,
            operation="manifest.publish",
            summary="Dry-run publish plan" if dry_run else "Manifest published",
            data={
                "app": manifest.get("app"),
                "source": str(file_path),
                "outputs": outputs,
                "dry_run": dry_run,
            },
            warnings=report["warnings"],
            duration_ms=0,
            connector_id=str(manifest.get("app") or ""),
        )
        emit_result_envelope(envelope)

    if dry_run:
        if not json_output:
            click.echo(f"Dry run: {', '.join(outputs)}")
        return

    def _prepare(path_obj: Path) -> None:
        path_obj.parent.mkdir(parents=True, exist_ok=True)
        if path_obj.exists() and not force:
            raise click.ClickException(f"Output exists: {path_obj} (use --force)")

    _prepare(well_known_path)
    well_known_path.write_text(f"{json.dumps(manifest, indent=2)}\n", encoding="utf-8")

    if connector_manifest_path and connector_readme_path:
        _prepare(connector_manifest_path)
        _prepare(connector_readme_path)
        connector_manifest_path.write_text(f"{json.dumps(manifest, indent=2)}\n", encoding="utf-8")
        connector_readme_path.write_text(
            (
                f"# {manifest.get('app', 'Manifest')} Centris Manifest\n\n"
                "This package contains `centris.json` for Centris manifest distribution.\n"
            ),
            encoding="utf-8",
        )

    if not json_output:
        click.echo(f"✓ Published manifest: {well_known_path}")
        if connector_manifest_path:
            click.echo(f"✓ Published connector package files: {connector_manifest_path.parent}")
