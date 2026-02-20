"""Tests for manifest CLI commands."""

from __future__ import annotations

import json
from pathlib import Path

from centris_sdk.cli.main import cli


def _write_manifest(path: Path) -> None:
    manifest = {
        "centris": "2.0",
        "app": "example",
        "description": "Example app",
        "url_patterns": ["example.com/*"],
        "routes": {
            "/": {
                "landmarks": {
                    "compose": {
                        "role": "button",
                        "selectors": ["[aria-label='Compose']"],
                        "stability": "stable",
                    }
                },
                "actions": {
                    "open_compose": {
                        "description": "Open compose",
                        "steps": [{"click": "compose"}],
                        "successChecks": [
                            {"type": "element_visible", "value": "[aria-label='Compose']"}
                        ],
                        "confidence": 0.8,
                    }
                },
            }
        },
    }
    path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")


def test_manifest_doctor_json(cli_runner, temp_dir):
    file_path = temp_dir / "centris.json"
    _write_manifest(file_path)

    result = cli_runner.invoke(cli, ["manifest", "doctor", str(file_path), "--json-output"])
    assert result.exit_code == 0
    assert '"operation": "manifest.doctor"' in result.output
    assert '"ok": true' in result.output


def test_manifest_publish_writes_outputs(cli_runner, temp_dir):
    file_path = temp_dir / "centris.json"
    _write_manifest(file_path)
    well_known_path = temp_dir / ".well-known" / "centris.json"
    connector_dir = temp_dir / "dist" / "example"

    result = cli_runner.invoke(
        cli,
        [
            "manifest",
            "publish",
            str(file_path),
            "--well-known-out",
            str(well_known_path),
            "--connector-out-dir",
            str(connector_dir),
        ],
    )

    assert result.exit_code == 0
    assert well_known_path.exists()
    assert (connector_dir / "centris.json").exists()
    assert (connector_dir / "README.md").exists()
