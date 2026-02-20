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
    "desktop.snapshot",
    "desktop.find",
    "desktop.click",
    "desktop.type",
    "desktop.apps",
    "desktop.windows",
    "route.run",
    "route.record.start",
    "route.record.stop",
    "web.memory.index",
    "web.memory.validate",
    "web.memory.resolve",
    "web.memory.execute",
    "web.memory.invalidate",
    "web.memory.stats",
]

RouteRecordOutcome = Literal["success", "failed", "cancelled"]
ActionAffordance = Literal["click", "type", "select", "submit", "navigate", "press", "read", "wait"]
ActionRegion = Literal["header", "nav", "main", "sidebar", "modal", "footer", "unknown"]
ActionAnchorType = Literal[
    "label",
    "aria_label",
    "placeholder",
    "near_text",
    "selector",
    "test_id",
    "business_id",
    "role",
    "url",
    "region",
]


@dataclass
class ActionArtifact:
    artifact_type: str
    schema: str
    producer_operation: str
    value: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ActionAnchor:
    anchor_type: ActionAnchorType
    value: str
    weight: Optional[float] = None


@dataclass
class ActionNodeHint:
    node_id: Optional[int] = None
    selector: Optional[str] = None
    role: Optional[str] = None
    name: Optional[str] = None


@dataclass
class ActionLandmark:
    role: str
    label: Optional[str] = None
    region: Optional[ActionRegion] = None
    selectors: list[str] = field(default_factory=list)
    text_hints: list[str] = field(default_factory=list)


@dataclass
class ActionPageFingerprint:
    fingerprint_id: Optional[str] = None
    url_pattern: Optional[str] = None
    title_hints: list[str] = field(default_factory=list)
    headings: list[str] = field(default_factory=list)
    nav_labels: list[str] = field(default_factory=list)
    primary_actions: list[str] = field(default_factory=list)
    landmarks: list[ActionLandmark] = field(default_factory=list)
    interactive_summary: Dict[str, int] = field(default_factory=dict)
    signature_hash: Optional[str] = None
    generated_at: Optional[str] = None
    confidence: Optional[float] = None


@dataclass
class ActionIndexEntry:
    action_id: str
    intent: str
    affordance: ActionAffordance
    semantic_label: Optional[str] = None
    region: Optional[ActionRegion] = None
    node_hints: list[ActionNodeHint] = field(default_factory=list)
    anchors: list[ActionAnchor] = field(default_factory=list)
    preconditions: list[str] = field(default_factory=list)
    success_checks: list[KernelSuccessCheck] = field(default_factory=list)
    fallback_action_ids: list[str] = field(default_factory=list)
    confidence: Optional[float] = None
    updated_at: Optional[str] = None


@dataclass
class ActionRouteMemoryStep:
    step_id: Optional[str] = None
    action_id: Optional[str] = None
    operation: Optional[str] = None
    params: Dict[str, str] = field(default_factory=dict)
    expected_page_fingerprint_id: Optional[str] = None
    success_checks: list[KernelSuccessCheck] = field(default_factory=list)


@dataclass
class ActionRouteMemory:
    route_id: str
    steps: list[ActionRouteMemoryStep] = field(default_factory=list)
    intent: Optional[str] = None
    site: Optional[str] = None
    page_fingerprint_id: Optional[str] = None
    preconditions: list[str] = field(default_factory=list)
    success_checks: list[KernelSuccessCheck] = field(default_factory=list)
    fallback_route_ids: list[str] = field(default_factory=list)
    confidence: Optional[float] = None
    version: Optional[str] = None
    updated_at: Optional[str] = None


@dataclass
class ActionRouteRunRequest:
    route_id: str
    url: Optional[str] = None
    params: Dict[str, str] = field(default_factory=dict)
    checks: list[KernelSuccessCheck] = field(default_factory=list)
    artifacts: list[ActionArtifact] = field(default_factory=list)
    page_fingerprint: Optional[ActionPageFingerprint] = None
    action_index: list[ActionIndexEntry] = field(default_factory=list)
    route_memory: Optional[ActionRouteMemory] = None


@dataclass
class ActionRouteRunResult:
    ok: bool
    executed: int
    verify: Optional[KernelVerifyResult] = None
    artifacts: list[ActionArtifact] = field(default_factory=list)
    source: Optional[Literal["memory", "manifest", "live"]] = None
    page_fingerprint: Optional[ActionPageFingerprint] = None
    action_index: list[ActionIndexEntry] = field(default_factory=list)
    route_memory: Optional[ActionRouteMemory] = None


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
    page_fingerprint: Optional[ActionPageFingerprint] = None
    action_index: list[ActionIndexEntry] = field(default_factory=list)
    route_memory: Optional[ActionRouteMemory] = None
    ttl_ms: Optional[int] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ActionWebMemoryIndexResult:
    ok: bool
    cache_key: Optional[str] = None
    version: Optional[str] = None
    created_at: Optional[str] = None
    expires_at: Optional[str] = None
    page_fingerprint: Optional[ActionPageFingerprint] = None
    action_index: list[ActionIndexEntry] = field(default_factory=list)
    route_memory: Optional[ActionRouteMemory] = None
    artifact: Optional[ActionArtifact] = None


@dataclass
class ActionWebMemoryValidateRequest:
    payload: ActionWebMemoryIndexRequest
    strict: Optional[bool] = None


@dataclass
class ActionWebMemoryValidateResult:
    ok: bool
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    normalized: Optional[ActionWebMemoryIndexRequest] = None
    stats: Dict[str, int] = field(default_factory=dict)


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
    source: Optional[Literal["cache", "live"]] = None
    confidence: Optional[float] = None
    page_fingerprint: Optional[ActionPageFingerprint] = None
    action_index: list[ActionIndexEntry] = field(default_factory=list)
    route_memory: Optional[ActionRouteMemory] = None
    artifact: Optional[ActionArtifact] = None


@dataclass
class ActionWebMemoryExecuteRequest:
    url: str
    intent: Optional[str] = None
    operation: Optional[str] = None
    page_fingerprint_id: Optional[str] = None
    route_id: Optional[str] = None
    params: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ActionWebMemoryExecuteResult:
    ok: bool
    source: Optional[Literal["cache", "live"]] = None
    executed: Optional[int] = None
    confidence: Optional[float] = None
    page_fingerprint: Optional[ActionPageFingerprint] = None
    action_index: list[ActionIndexEntry] = field(default_factory=list)
    route_memory: Optional[ActionRouteMemory] = None
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
    indexed_pages: Optional[int] = None
    indexed_actions: Optional[int] = None
    indexed_routes: Optional[int] = None
    avg_execute_ms: Optional[float] = None


@dataclass
class DesktopElement:
    id: int
    role: Optional[str] = None
    name: Optional[str] = None
    value: Optional[str] = None


@dataclass
class ActionDesktopSnapshotRequest:
    app_name: Optional[str] = None
    window_title: Optional[str] = None


@dataclass
class ActionDesktopSnapshotResult:
    app_name: Optional[str] = None
    window_title: Optional[str] = None
    element_count: int = 0
    elements: list[DesktopElement] = field(default_factory=list)
    note: Optional[str] = None


@dataclass
class ActionDesktopFindRequest:
    app_name: Optional[str] = None
    window_title: Optional[str] = None
    role: Optional[str] = None
    name: Optional[str] = None


@dataclass
class ActionDesktopFindResult:
    count: int = 0
    elements: list[DesktopElement] = field(default_factory=list)
    note: Optional[str] = None


@dataclass
class ActionDesktopClickRequest:
    element_id: int


@dataclass
class ActionDesktopClickResult:
    ok: bool
    details: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ActionDesktopTypeRequest:
    text: str
    element_id: Optional[int] = None


@dataclass
class ActionDesktopTypeResult:
    ok: bool
    details: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ActionDesktopWindowsRequest:
    app_name: Optional[str] = None


@dataclass
class ActionDesktopAppsResult:
    apps: list[Dict[str, Any]] = field(default_factory=list)


@dataclass
class ActionDesktopWindowsResult:
    windows: list[Dict[str, Any]] = field(default_factory=list)


ActionApiParams = Union[
    KernelObserveRequest,
    KernelActRequest,
    KernelVerifyRequest,
    ActionDesktopSnapshotRequest,
    ActionDesktopFindRequest,
    ActionDesktopClickRequest,
    ActionDesktopTypeRequest,
    ActionDesktopWindowsRequest,
    ActionRouteRunRequest,
    ActionRouteRecordStartRequest,
    ActionRouteRecordStopRequest,
    ActionWebMemoryIndexRequest,
    ActionWebMemoryValidateRequest,
    ActionWebMemoryResolveRequest,
    ActionWebMemoryExecuteRequest,
    ActionWebMemoryInvalidateRequest,
    ActionWebMemoryStatsRequest,
]

ActionApiResult = Union[
    KernelObserveResult,
    KernelActResult,
    KernelVerifyResult,
    ActionDesktopSnapshotResult,
    ActionDesktopFindResult,
    ActionDesktopClickResult,
    ActionDesktopTypeResult,
    ActionDesktopAppsResult,
    ActionDesktopWindowsResult,
    ActionRouteRunResult,
    ActionRouteRecordStartResult,
    ActionRouteRecordStopResult,
    ActionWebMemoryIndexResult,
    ActionWebMemoryValidateResult,
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
