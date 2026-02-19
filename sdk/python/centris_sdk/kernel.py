"""Centris SDK Action Kernel scaffold.

Versioned contract for deterministic action execution.
"""

from dataclasses import dataclass, field
from typing import Optional, Protocol, Literal, Any

ACTION_KERNEL_SPEC_VERSION: str = "2026-02-19"

KernelActionKind = Literal["navigate", "click", "type", "press", "wait", "scroll"]
KernelSuccessType = Literal[
    "url_contains",
    "text_present",
    "element_visible",
    "download",
    "network_url_contains",
]


@dataclass
class KernelSuccessCheck:
    type: KernelSuccessType
    value: Optional[str] = None


@dataclass
class KernelObserveRequest:
    url: Optional[str] = None
    instruction: Optional[str] = None


@dataclass
class KernelObserveResult:
    url: str
    title: Optional[str] = None
    interactive: list[dict[str, str]] = field(default_factory=list)


@dataclass
class KernelActRequest:
    kind: KernelActionKind
    target: Optional[str] = None
    value: Optional[str] = None
    amount: Optional[int] = None


@dataclass
class KernelActResult:
    ok: bool
    details: dict[str, Any] = field(default_factory=dict)


@dataclass
class KernelVerifyRequest:
    checks: list[KernelSuccessCheck]


@dataclass
class KernelVerifyResult:
    ok: bool
    passed: list[KernelSuccessCheck] = field(default_factory=list)
    failed: list[KernelSuccessCheck] = field(default_factory=list)


@dataclass
class KernelRouteRequest:
    id: str
    url: Optional[str] = None
    steps: list[dict[str, Any]] = field(default_factory=list)
    params: dict[str, str] = field(default_factory=dict)
    checks: list[KernelSuccessCheck] = field(default_factory=list)


@dataclass
class KernelRouteResult:
    ok: bool
    executed: int
    verify: Optional[KernelVerifyResult] = None


@dataclass
class KernelLearnRequest:
    id: str
    url_pattern: str
    steps: list[dict[str, Any]] = field(default_factory=list)
    checks: list[KernelSuccessCheck] = field(default_factory=list)


@dataclass
class KernelLearnResult:
    ok: bool
    route_id: str
    version: str = ACTION_KERNEL_SPEC_VERSION


class ActionKernel(Protocol):
    """Versioned action-kernel protocol for SDK integrations."""

    version: str

    async def observe(self, request: KernelObserveRequest) -> KernelObserveResult: ...
    async def act(self, request: KernelActRequest) -> KernelActResult: ...
    async def verify(self, request: KernelVerifyRequest) -> KernelVerifyResult: ...
    async def route(self, request: KernelRouteRequest) -> KernelRouteResult: ...
    async def learn(self, request: KernelLearnRequest) -> KernelLearnResult: ...
