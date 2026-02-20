"""Centris Action API contract.

Stable runtime-facing schema for Electron/extension/CLI integration.
"""

from dataclasses import dataclass, field
from typing import Any, Dict, Literal, Optional, Union

from centris_sdk.kernel import (
    ACTION_KERNEL_SPEC_VERSION,
    KernelActRequest,
    KernelActResult,
    KernelObserveRequest,
    KernelObserveResult,
    KernelSuccessCheck,
    KernelVerifyRequest,
    KernelVerifyResult,
)

ACTION_API_SPEC_VERSION: str = ACTION_KERNEL_SPEC_VERSION

ActionApiMethod = Literal[
    "observe",
    "act",
    "verify",
    "route.run",
    "route.record.start",
    "route.record.stop",
    "web.memory.index",
    "web.memory.resolve",
    "web.memory.execute",
    "web.memory.invalidate",
    "web.memory.stats",
]

RouteRecordOutcome = Literal["success", "failed", "cancelled"]


@dataclass
class ActionArtifact:
    artifact_type: str
    schema: str
    producer_operation: str
    value: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ActionRouteRunRequest:
    route_id: str
    url: Optional[str] = None
    params: Dict[str, str] = field(default_factory=dict)
    checks: list[KernelSuccessCheck] = field(default_factory=list)
    artifacts: list[ActionArtifact] = field(default_factory=list)


@dataclass
class ActionRouteRunResult:
    ok: bool
    executed: int
    verify: Optional[KernelVerifyResult] = None
    artifacts: list[ActionArtifact] = field(default_factory=list)


@dataclass
class ActionRouteRecordStartRequest:
    intent: str
    url: Optional[str] = None
    params: Dict[str, str] = field(default_factory=dict)
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ActionRouteRecordStartResult:
    ok: bool
    session_id: str
    started_at: Optional[str] = None


@dataclass
class ActionRouteRecordStopRequest:
    session_id: str
    outcome: Optional[RouteRecordOutcome] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ActionRouteRecordStopResult:
    ok: bool
    route_id: Optional[str] = None
    updated_at: Optional[str] = None


@dataclass
class ActionWebMemoryIndexRequest:
    url: str
    intent: Optional[str] = None
    playbook: Dict[str, Any] = field(default_factory=dict)
    ttl_ms: Optional[int] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ActionWebMemoryIndexResult:
    ok: bool
    cache_key: Optional[str] = None
    version: Optional[str] = None
    created_at: Optional[str] = None
    expires_at: Optional[str] = None
    artifact: Optional[ActionArtifact] = None


@dataclass
class ActionWebMemoryResolveRequest:
    url: str
    intent: Optional[str] = None
    max_age_ms: Optional[int] = None


@dataclass
class ActionWebMemoryResolveResult:
    hit: bool
    cache_key: Optional[str] = None
    playbook: Dict[str, Any] = field(default_factory=dict)
    generated_at: Optional[str] = None
    expires_at: Optional[str] = None
    artifact: Optional[ActionArtifact] = None


@dataclass
class ActionWebMemoryExecuteRequest:
    url: str
    intent: Optional[str] = None
    operation: Optional[str] = None
    params: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ActionWebMemoryExecuteResult:
    ok: bool
    source: Optional[Literal["cache", "live"]] = None
    executed: Optional[int] = None
    details: Dict[str, Any] = field(default_factory=dict)
    artifacts: list[ActionArtifact] = field(default_factory=list)


@dataclass
class ActionWebMemoryInvalidateRequest:
    url: Optional[str] = None
    playbook_id: Optional[str] = None
    scope: Optional[Literal["url", "domain", "all"]] = None
    reason: Optional[str] = None


@dataclass
class ActionWebMemoryInvalidateResult:
    ok: bool
    invalidated: int


@dataclass
class ActionWebMemoryStatsRequest:
    url: Optional[str] = None
    window: Optional[Literal["1h", "24h", "7d", "30d"]] = None


@dataclass
class ActionWebMemoryStatsResult:
    entries: int
    hits: int
    misses: int
    hit_rate: Optional[float] = None
    avg_resolve_ms: Optional[float] = None


ActionApiParams = Union[
    KernelObserveRequest,
    KernelActRequest,
    KernelVerifyRequest,
    ActionRouteRunRequest,
    ActionRouteRecordStartRequest,
    ActionRouteRecordStopRequest,
    ActionWebMemoryIndexRequest,
    ActionWebMemoryResolveRequest,
    ActionWebMemoryExecuteRequest,
    ActionWebMemoryInvalidateRequest,
    ActionWebMemoryStatsRequest,
]

ActionApiResult = Union[
    KernelObserveResult,
    KernelActResult,
    KernelVerifyResult,
    ActionRouteRunResult,
    ActionRouteRecordStartResult,
    ActionRouteRecordStopResult,
    ActionWebMemoryIndexResult,
    ActionWebMemoryResolveResult,
    ActionWebMemoryExecuteResult,
    ActionWebMemoryInvalidateResult,
    ActionWebMemoryStatsResult,
]


@dataclass
class ActionApiError:
    code: str
    message: str
    details: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ActionApiRequestEnvelope:
    spec_version: str
    method: ActionApiMethod
    params: Dict[str, Any]
    id: Optional[str] = None


@dataclass
class ActionApiResponseEnvelope:
    spec_version: str
    method: ActionApiMethod
    ok: bool
    result: Optional[Dict[str, Any]] = None
    error: Optional[ActionApiError] = None
    id: Optional[str] = None
