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
]

RouteRecordOutcome = Literal["success", "failed", "cancelled"]


@dataclass
class ActionRouteRunRequest:
    route_id: str
    url: Optional[str] = None
    params: Dict[str, str] = field(default_factory=dict)
    checks: list[KernelSuccessCheck] = field(default_factory=list)


@dataclass
class ActionRouteRunResult:
    ok: bool
    executed: int
    verify: Optional[KernelVerifyResult] = None


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


ActionApiParams = Union[
    KernelObserveRequest,
    KernelActRequest,
    KernelVerifyRequest,
    ActionRouteRunRequest,
    ActionRouteRecordStartRequest,
    ActionRouteRecordStopRequest,
]

ActionApiResult = Union[
    KernelObserveResult,
    KernelActResult,
    KernelVerifyResult,
    ActionRouteRunResult,
    ActionRouteRecordStartResult,
    ActionRouteRecordStopResult,
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
