"""Shared structured result envelope for Centris CLI commands."""

from __future__ import annotations

from dataclasses import dataclass, asdict, field
import json
import time
from typing import Any, Dict, List, Optional


SafetyLevel = str


def _request_id() -> str:
    return f"req_{int(time.time() * 1000)}"


@dataclass
class CliArtifact:
    artifact_type: str
    schema: str
    producer_operation: str
    value: Dict[str, Any] = field(default_factory=dict)


@dataclass
class CliResultMeta:
    duration_ms: int
    request_id: str = field(default_factory=_request_id)
    profile: Optional[str] = None
    connector_id: Optional[str] = None
    system: Optional[str] = None
    system_version: Optional[str] = None
    safety_level: Optional[SafetyLevel] = None
    retry_hint: Optional[str] = None


@dataclass
class CliResultEnvelope:
    ok: bool
    operation: str
    summary: str
    data: Dict[str, Any] = field(default_factory=dict)
    warnings: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)
    artifacts: List[CliArtifact] = field(default_factory=list)
    meta: CliResultMeta = field(default_factory=lambda: CliResultMeta(duration_ms=0))

    def to_dict(self) -> Dict[str, Any]:
        payload = asdict(self)
        if not payload["artifacts"]:
            payload.pop("artifacts", None)
        return payload


def build_result_envelope(
    *,
    ok: bool,
    operation: str,
    summary: str,
    data: Optional[Dict[str, Any]] = None,
    warnings: Optional[List[str]] = None,
    errors: Optional[List[str]] = None,
    artifacts: Optional[List[CliArtifact]] = None,
    duration_ms: int,
    profile: Optional[str] = None,
    connector_id: Optional[str] = None,
    system: Optional[str] = None,
    system_version: Optional[str] = None,
    safety_level: Optional[SafetyLevel] = None,
    retry_hint: Optional[str] = None,
) -> CliResultEnvelope:
    return CliResultEnvelope(
        ok=ok,
        operation=operation,
        summary=summary,
        data=data or {},
        warnings=warnings or [],
        errors=errors or [],
        artifacts=artifacts or [],
        meta=CliResultMeta(
            duration_ms=max(0, int(duration_ms)),
            profile=profile,
            connector_id=connector_id,
            system=system,
            system_version=system_version,
            safety_level=safety_level,
            retry_hint=retry_hint,
        ),
    )


def emit_result_envelope(envelope: CliResultEnvelope) -> None:
    print(json.dumps(envelope.to_dict(), indent=2))
