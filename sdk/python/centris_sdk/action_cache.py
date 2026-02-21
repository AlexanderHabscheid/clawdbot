"""Action cache and replay for Centris SDK."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import TYPE_CHECKING, Any, Dict, List, Optional

if TYPE_CHECKING:
    from centris_sdk.client import Centris


@dataclass
class ActionCache:
    """Serializable action cache for save/load and replay."""

    version: str = "1.0"
    route_id: str = ""
    intent: Optional[str] = None
    site: Optional[str] = None
    steps: Optional[List[Dict[str, Any]]] = None
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat() + "Z")
    metadata: Optional[Dict[str, Any]] = None


@dataclass
class RecordRouteResult:
    """Result of record_route()."""

    session_id: str
    started_at: Optional[str] = None


@dataclass
class StopRouteRecordingResult:
    """Result of stop_route_recording()."""

    route_id: Optional[str] = None
    updated_at: Optional[str] = None

    def to_cache(
        self,
        *,
        intent: Optional[str] = None,
        site: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Optional[ActionCache]:
        """Build an ActionCache from this result for save/replay."""
        if not self.route_id:
            return None
        return build_action_cache(
            self.route_id,
            intent=intent,
            site=site,
            metadata=metadata,
        )


def record_route(
    client: "Centris",
    intent: str,
    *,
    url: Optional[str] = None,
    params: Optional[Dict[str, str]] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> RecordRouteResult:
    """Start recording a route. Perform actions, then call stop_route_recording.

    Args:
        client: Centris client
        intent: Intent description for the flow
        url: Starting URL (optional)
        params: Parameters for the flow
        metadata: Extra metadata

    Returns:
        RecordRouteResult with session_id
    """
    from centris_sdk.action_api import ActionRouteRecordStartRequest

    result = client.route_record_start(
        ActionRouteRecordStartRequest(
            intent=intent,
            url=url,
            params=params or {},
            metadata=metadata or {},
        )
    )
    if not result.ok:
        raise RuntimeError("route.record.start failed")
    return RecordRouteResult(
        session_id=result.session_id,
        started_at=result.started_at,
    )


def stop_route_recording(
    client: "Centris",
    session_id: str,
    *,
    outcome: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> StopRouteRecordingResult:
    """Stop route recording and get the route ID for replay."""
    from centris_sdk.action_api import ActionRouteRecordStopRequest

    result = client.route_record_stop(
        ActionRouteRecordStopRequest(
            session_id=session_id,
            outcome=outcome,
            metadata=metadata or {},
        )
    )
    if not result.ok:
        raise RuntimeError("route.record.stop failed")
    return StopRouteRecordingResult(
        route_id=result.route_id,
        updated_at=result.updated_at,
    )


def build_action_cache(
    route_id: str,
    *,
    intent: Optional[str] = None,
    site: Optional[str] = None,
    steps: Optional[List[Dict[str, Any]]] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> ActionCache:
    """Build an ActionCache from route data for serialization."""
    return ActionCache(
        version="1.0",
        route_id=route_id,
        intent=intent,
        site=site,
        steps=steps,
        created_at=datetime.utcnow().isoformat() + "Z",
        metadata=metadata,
    )


def replay_route(
    client: "Centris",
    cache: ActionCache,
    *,
    url: Optional[str] = None,
    params: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """Replay a route from cache. Uses route.run with the cached route_id.

    Args:
        client: Centris client
        cache: ActionCache from build_action_cache or loaded from JSON
        url: URL to run against (overrides cache if provided)
        params: Parameters for the route

    Returns:
        Dict with ok, executed, details
    """
    from centris_sdk.action_api import ActionRouteRunRequest

    route_id = cache.route_id
    if not route_id:
        raise ValueError("ActionCache has no route_id; cannot replay. Record a route first.")

    run_params: Dict[str, str] = params or {}
    if not run_params and cache.metadata:
        run_params = cache.metadata.get("params") or {}
    result = client.route_run(
        ActionRouteRunRequest(
            route_id=route_id,
            url=url,
            params=run_params,
        )
    )

    return {
        "ok": result.ok,
        "executed": result.executed,
        "details": {"verify": result.verify} if result.verify else None,
    }
