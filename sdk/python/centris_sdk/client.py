"""Centris Python Client - One method, infinite power.

Usage:
    from centris import Centris
    
    centris = Centris(api_key="ck_live_xxx")
    result = centris.do("Open Gmail and read my first 3 emails")
    print(result.text)

That's it. The entire Centris platform in one method.

API Versioning:
    # Pin to a specific API version for stability
    centris = Centris(api_key="ck_live_xxx", api_version="2026-01-30")
    
    # Handle deprecation warnings
    centris.on_deprecation(lambda endpoint, sunset, alt: 
        print(f"Warning: {endpoint} deprecated, use {alt}")
    )

Advanced usage:
    # Async execution (for long tasks)
    task = centris.do("Research AI trends", async_mode=True)
    result = centris.wait(task.task_id)
    
    # Check usage
    usage = centris.usage()
    print(f"Tasks remaining: {usage.tasks_remaining}")
    
    # Context (e.g., current browser URL)
    result = centris.do(
        "Click the submit button",
        context={"browser": {"url": "https://example.com/form"}}
    )

See Also:
    - docs/api/API_MIGRATION_GUIDE.md - Version negotiation and deprecation
    - docs/api/API_CHANGELOG.md - Version history
"""

import logging
import os
import time
import warnings
from dataclasses import dataclass, field
from typing import Optional, Dict, Any, List, Callable

import httpx
from centris_sdk.action_api import (
    ACTION_API_SPEC_VERSION,
    ActionApiError,
    ActionArtifact,
    ActionAnchor,
    ActionIndexEntry,
    ActionLandmark,
    ActionNodeHint,
    ActionPageFingerprint,
    ActionRouteMemory,
    ActionRouteMemoryStep,
    ActionApiRequestEnvelope,
    ActionApiResponseEnvelope,
    ActionRouteRecordStartRequest,
    ActionRouteRecordStartResult,
    ActionRouteRecordStopRequest,
    ActionRouteRecordStopResult,
    ActionRouteRunRequest,
    ActionRouteRunResult,
    ActionWebMemoryExecuteRequest,
    ActionWebMemoryExecuteResult,
    ActionWebMemoryIndexRequest,
    ActionWebMemoryIndexResult,
    ActionWebMemoryInvalidateRequest,
    ActionWebMemoryInvalidateResult,
    ActionWebMemoryResolveRequest,
    ActionWebMemoryResolveResult,
    ActionWebMemoryStatsRequest,
    ActionWebMemoryStatsResult,
)
from centris_sdk.kernel import (
    KernelActRequest,
    KernelActResult,
    KernelObserveRequest,
    KernelObserveResult,
    KernelSuccessCheck,
    KernelVerifyRequest,
    KernelVerifyResult,
)

logger = logging.getLogger(__name__)

# Default API version (set to current stable)
DEFAULT_API_VERSION = "2026-01-30"


def _kernel_check_to_dict(check: KernelSuccessCheck) -> Dict[str, Any]:
    return {"type": check.type, "value": check.value}


def _artifact_to_dict(artifact: ActionArtifact) -> Dict[str, Any]:
    return {
        "artifactType": artifact.artifact_type,
        "schema": artifact.schema,
        "producerOperation": artifact.producer_operation,
        "value": artifact.value,
    }


def _anchor_to_dict(anchor: ActionAnchor) -> Dict[str, Any]:
    return {
        "anchorType": anchor.anchor_type,
        "value": anchor.value,
        "weight": anchor.weight,
    }


def _node_hint_to_dict(node_hint: ActionNodeHint) -> Dict[str, Any]:
    return {
        "nodeId": node_hint.node_id,
        "selector": node_hint.selector,
        "role": node_hint.role,
        "name": node_hint.name,
    }


def _landmark_to_dict(landmark: ActionLandmark) -> Dict[str, Any]:
    return {
        "role": landmark.role,
        "label": landmark.label,
        "region": landmark.region,
        "selectors": landmark.selectors,
        "textHints": landmark.text_hints,
    }


def _page_fingerprint_to_dict(page_fingerprint: ActionPageFingerprint) -> Dict[str, Any]:
    return {
        "fingerprintId": page_fingerprint.fingerprint_id,
        "urlPattern": page_fingerprint.url_pattern,
        "titleHints": page_fingerprint.title_hints,
        "headings": page_fingerprint.headings,
        "navLabels": page_fingerprint.nav_labels,
        "primaryActions": page_fingerprint.primary_actions,
        "landmarks": [_landmark_to_dict(item) for item in page_fingerprint.landmarks],
        "interactiveSummary": page_fingerprint.interactive_summary,
        "signatureHash": page_fingerprint.signature_hash,
        "generatedAt": page_fingerprint.generated_at,
        "confidence": page_fingerprint.confidence,
    }


def _action_index_entry_to_dict(entry: ActionIndexEntry) -> Dict[str, Any]:
    return {
        "actionId": entry.action_id,
        "intent": entry.intent,
        "affordance": entry.affordance,
        "semanticLabel": entry.semantic_label,
        "region": entry.region,
        "nodeHints": [_node_hint_to_dict(item) for item in entry.node_hints],
        "anchors": [_anchor_to_dict(item) for item in entry.anchors],
        "preconditions": entry.preconditions,
        "successChecks": [_kernel_check_to_dict(item) for item in entry.success_checks],
        "fallbackActionIds": entry.fallback_action_ids,
        "confidence": entry.confidence,
        "updatedAt": entry.updated_at,
    }


def _route_memory_step_to_dict(step: ActionRouteMemoryStep) -> Dict[str, Any]:
    return {
        "stepId": step.step_id,
        "actionId": step.action_id,
        "operation": step.operation,
        "params": step.params,
        "expectedPageFingerprintId": step.expected_page_fingerprint_id,
        "successChecks": [_kernel_check_to_dict(item) for item in step.success_checks],
    }


def _route_memory_to_dict(route_memory: ActionRouteMemory) -> Dict[str, Any]:
    return {
        "routeId": route_memory.route_id,
        "intent": route_memory.intent,
        "site": route_memory.site,
        "pageFingerprintId": route_memory.page_fingerprint_id,
        "steps": [_route_memory_step_to_dict(item) for item in route_memory.steps],
        "preconditions": route_memory.preconditions,
        "successChecks": [_kernel_check_to_dict(item) for item in route_memory.success_checks],
        "fallbackRouteIds": route_memory.fallback_route_ids,
        "confidence": route_memory.confidence,
        "version": route_memory.version,
        "updatedAt": route_memory.updated_at,
    }


def _parse_kernel_check(raw: Any) -> Optional[KernelSuccessCheck]:
    if not isinstance(raw, dict):
        return None
    check_type = raw.get("type")
    check_value = raw.get("value")
    if not isinstance(check_type, str) or not isinstance(check_value, str):
        return None
    return KernelSuccessCheck(type=check_type, value=check_value)


def _parse_action_artifact(raw: Any) -> Optional[ActionArtifact]:
    if not isinstance(raw, dict):
        return None
    return ActionArtifact(
        artifact_type=str(raw.get("artifactType", "")),
        schema=str(raw.get("schema", "")),
        producer_operation=str(raw.get("producerOperation", "")),
        value=raw.get("value", {}) if isinstance(raw.get("value"), dict) else {},
    )


def _parse_page_fingerprint(raw: Any) -> Optional[ActionPageFingerprint]:
    if not isinstance(raw, dict):
        return None
    landmarks: list[ActionLandmark] = []
    for item in raw.get("landmarks", []):
        if not isinstance(item, dict):
            continue
        role = item.get("role")
        if not isinstance(role, str) or role == "":
            continue
        selectors = item.get("selectors")
        text_hints = item.get("textHints")
        landmarks.append(
            ActionLandmark(
                role=role,
                label=item.get("label") if isinstance(item.get("label"), str) else None,
                region=item.get("region") if isinstance(item.get("region"), str) else None,
                selectors=selectors if isinstance(selectors, list) else [],
                text_hints=text_hints if isinstance(text_hints, list) else [],
            )
        )
    interactive_summary = raw.get("interactiveSummary")
    return ActionPageFingerprint(
        fingerprint_id=raw.get("fingerprintId") if isinstance(raw.get("fingerprintId"), str) else None,
        url_pattern=raw.get("urlPattern") if isinstance(raw.get("urlPattern"), str) else None,
        title_hints=raw.get("titleHints") if isinstance(raw.get("titleHints"), list) else [],
        headings=raw.get("headings") if isinstance(raw.get("headings"), list) else [],
        nav_labels=raw.get("navLabels") if isinstance(raw.get("navLabels"), list) else [],
        primary_actions=raw.get("primaryActions") if isinstance(raw.get("primaryActions"), list) else [],
        landmarks=landmarks,
        interactive_summary=interactive_summary if isinstance(interactive_summary, dict) else {},
        signature_hash=raw.get("signatureHash") if isinstance(raw.get("signatureHash"), str) else None,
        generated_at=raw.get("generatedAt") if isinstance(raw.get("generatedAt"), str) else None,
        confidence=float(raw["confidence"]) if isinstance(raw.get("confidence"), (int, float)) else None,
    )


def _parse_action_index_entries(raw: Any) -> list[ActionIndexEntry]:
    entries: list[ActionIndexEntry] = []
    if not isinstance(raw, list):
        return entries
    for item in raw:
        if not isinstance(item, dict):
            continue
        action_id = item.get("actionId")
        intent = item.get("intent")
        affordance = item.get("affordance")
        if not isinstance(action_id, str) or not isinstance(intent, str) or not isinstance(affordance, str):
            continue
        node_hints: list[ActionNodeHint] = []
        for node in item.get("nodeHints", []):
            if isinstance(node, dict):
                node_hints.append(
                    ActionNodeHint(
                        node_id=node.get("nodeId") if isinstance(node.get("nodeId"), int) else None,
                        selector=node.get("selector") if isinstance(node.get("selector"), str) else None,
                        role=node.get("role") if isinstance(node.get("role"), str) else None,
                        name=node.get("name") if isinstance(node.get("name"), str) else None,
                    )
                )
        anchors: list[ActionAnchor] = []
        for anchor in item.get("anchors", []):
            if isinstance(anchor, dict):
                anchor_type = anchor.get("anchorType")
                value = anchor.get("value")
                if isinstance(anchor_type, str) and isinstance(value, str):
                    anchors.append(
                        ActionAnchor(
                            anchor_type=anchor_type,
                            value=value,
                            weight=float(anchor["weight"])
                            if isinstance(anchor.get("weight"), (int, float))
                            else None,
                        )
                    )
        success_checks: list[KernelSuccessCheck] = []
        for check in item.get("successChecks", []):
            parsed_check = _parse_kernel_check(check)
            if parsed_check:
                success_checks.append(parsed_check)
        entries.append(
            ActionIndexEntry(
                action_id=action_id,
                intent=intent,
                affordance=affordance,
                semantic_label=item.get("semanticLabel")
                if isinstance(item.get("semanticLabel"), str)
                else None,
                region=item.get("region") if isinstance(item.get("region"), str) else None,
                node_hints=node_hints,
                anchors=anchors,
                preconditions=item.get("preconditions") if isinstance(item.get("preconditions"), list) else [],
                success_checks=success_checks,
                fallback_action_ids=item.get("fallbackActionIds")
                if isinstance(item.get("fallbackActionIds"), list)
                else [],
                confidence=float(item["confidence"])
                if isinstance(item.get("confidence"), (int, float))
                else None,
                updated_at=item.get("updatedAt") if isinstance(item.get("updatedAt"), str) else None,
            )
        )
    return entries


def _parse_route_memory(raw: Any) -> Optional[ActionRouteMemory]:
    if not isinstance(raw, dict):
        return None
    route_id = raw.get("routeId")
    if not isinstance(route_id, str):
        return None
    steps: list[ActionRouteMemoryStep] = []
    for item in raw.get("steps", []):
        if not isinstance(item, dict):
            continue
        success_checks: list[KernelSuccessCheck] = []
        for check in item.get("successChecks", []):
            parsed_check = _parse_kernel_check(check)
            if parsed_check:
                success_checks.append(parsed_check)
        steps.append(
            ActionRouteMemoryStep(
                step_id=item.get("stepId") if isinstance(item.get("stepId"), str) else None,
                action_id=item.get("actionId") if isinstance(item.get("actionId"), str) else None,
                operation=item.get("operation") if isinstance(item.get("operation"), str) else None,
                params=item.get("params") if isinstance(item.get("params"), dict) else {},
                expected_page_fingerprint_id=item.get("expectedPageFingerprintId")
                if isinstance(item.get("expectedPageFingerprintId"), str)
                else None,
                success_checks=success_checks,
            )
        )
    success_checks: list[KernelSuccessCheck] = []
    for check in raw.get("successChecks", []):
        parsed_check = _parse_kernel_check(check)
        if parsed_check:
            success_checks.append(parsed_check)
    return ActionRouteMemory(
        route_id=route_id,
        steps=steps,
        intent=raw.get("intent") if isinstance(raw.get("intent"), str) else None,
        site=raw.get("site") if isinstance(raw.get("site"), str) else None,
        page_fingerprint_id=raw.get("pageFingerprintId")
        if isinstance(raw.get("pageFingerprintId"), str)
        else None,
        preconditions=raw.get("preconditions") if isinstance(raw.get("preconditions"), list) else [],
        success_checks=success_checks,
        fallback_route_ids=raw.get("fallbackRouteIds")
        if isinstance(raw.get("fallbackRouteIds"), list)
        else [],
        confidence=float(raw["confidence"]) if isinstance(raw.get("confidence"), (int, float)) else None,
        version=raw.get("version") if isinstance(raw.get("version"), str) else None,
        updated_at=raw.get("updatedAt") if isinstance(raw.get("updatedAt"), str) else None,
    )


@dataclass
class CentrisResult:
    """Result from a Centris command."""
    task_id: str
    status: str  # "completed", "failed", "queued", "running"
    text: str  # The result text
    actions: List[Dict[str, Any]]  # Actions performed
    error: Optional[str] = None
    usage: Optional[Dict[str, Any]] = None
    # Version metadata from response headers
    api_version: Optional[str] = None
    api_version_warning: Optional[str] = None
    deprecation_info: Optional[Dict[str, str]] = None
    
    @property
    def success(self) -> bool:
        return self.status == "completed"
    
    @property
    def is_deprecated(self) -> bool:
        """Check if this endpoint is deprecated."""
        return self.deprecation_info is not None
    
    def __str__(self) -> str:
        return self.text if self.success else f"Error: {self.error}"


# Type alias for deprecation callback
DeprecationCallback = Callable[[str, Optional[str], Optional[str]], None]


@dataclass
class CentrisUsage:
    """Usage information."""
    tier: str
    tasks_remaining: int
    monthly_limit: int
    daily_bonus: int
    tasks_used_today: int
    period_ends: Optional[str] = None


class CentrisError(Exception):
    """Base exception for Centris errors."""
    
    def __init__(self, message: str, code: Optional[str] = None, task_id: Optional[str] = None):
        super().__init__(message)
        self.code = code
        self.task_id = task_id


class AuthenticationError(CentrisError):
    """API key is invalid or missing."""
    pass


class RateLimitError(CentrisError):
    """Task limit exceeded."""
    pass


class _WebMemoryClient:
    """Convenience namespace for web memory operations."""

    def __init__(self, client: "Centris"):
        self._client = client

    def index(self, request: ActionWebMemoryIndexRequest) -> ActionWebMemoryIndexResult:
        return self._client.web_memory_index(request)

    def resolve(self, request: ActionWebMemoryResolveRequest) -> ActionWebMemoryResolveResult:
        return self._client.web_memory_resolve(request)

    def execute(self, request: ActionWebMemoryExecuteRequest) -> ActionWebMemoryExecuteResult:
        return self._client.web_memory_execute(request)

    def invalidate(
        self,
        request: ActionWebMemoryInvalidateRequest,
    ) -> ActionWebMemoryInvalidateResult:
        return self._client.web_memory_invalidate(request)

    def stats(
        self,
        request: Optional[ActionWebMemoryStatsRequest] = None,
    ) -> ActionWebMemoryStatsResult:
        return self._client.web_memory_stats(request or ActionWebMemoryStatsRequest())


class Centris:
    """Centris API client.
    
    The simplest way to use Centris programmatically:
    
        centris = Centris(api_key="ck_live_xxx")
        result = centris.do("Open Gmail")
        
    That's it.
    
    API Versioning:
        # Pin to a specific version for stability
        centris = Centris(api_key="ck_live_xxx", api_version="2026-01-30")
        
        # Handle deprecation warnings
        centris.on_deprecation(lambda endpoint, sunset, alt: 
            print(f"Warning: {endpoint} deprecated, use {alt}")
        )
    
    Local-First Execution:
        # Run entirely on your computer (no API server needed)
        centris = Centris(local=True)
        result = centris.do("Open Gmail")
    """
    
    DEFAULT_URL = "https://api.centris.ai"
    LOCAL_URL = "http://localhost:7777"
    
    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        timeout: float = 120.0,
        local: bool = False,
        api_version: Optional[str] = None,
    ):
        """Initialize Centris client.
        
        Args:
            api_key: Your Centris API key (or set CENTRIS_API_KEY env var)
            base_url: API base URL (defaults to https://api.centris.ai)
            timeout: Request timeout in seconds
            local: If True, run locally without API server (local-first mode)
            api_version: API version to use (YYYY-MM-DD format, or set CENTRIS_API_VERSION env var)
                        If not specified, uses the current stable version.
                        Pin this for production stability.
        """
        self.api_key = api_key or os.environ.get("CENTRIS_API_KEY")
        if not self.api_key:
            # Try local development
            self.api_key = "ck_test_local"
        
        self.local = local or os.environ.get("CENTRIS_LOCAL", "").lower() == "true"
        self.timeout = timeout
        self._client = None
        
        # API versioning
        self.api_version = api_version or os.environ.get("CENTRIS_API_VERSION") or DEFAULT_API_VERSION
        self._deprecation_callbacks: List[DeprecationCallback] = []
        
        # Determine base URL (only if not local mode)
        if not self.local:
            if base_url:
                self.base_url = base_url.rstrip("/")
            elif os.environ.get("CENTRIS_API_URL"):
                self.base_url = os.environ["CENTRIS_API_URL"].rstrip("/")
            else:
                # Check if local server is running, fallback to cloud
                self.base_url = self._detect_base_url()
            
            self._client = httpx.Client(timeout=timeout)
        else:
            self.base_url = None

        self.web_memory = _WebMemoryClient(self)
    
    def _detect_base_url(self) -> str:
        """Detect if local or cloud API should be used."""
        try:
            # Quick check if local server is running
            response = httpx.get(f"{self.LOCAL_URL}/health", timeout=1.0)
            if response.status_code == 200:
                return self.LOCAL_URL
        except:
            pass
        return self.DEFAULT_URL
    
    def _headers(self) -> Dict[str, str]:
        """Get request headers including API version."""
        return {
            "X-Centris-Key": self.api_key,
            "Content-Type": "application/json",
            "Accept-Version": self.api_version,
        }
    
    def _parse_version_headers(self, response: httpx.Response) -> Dict[str, Any]:
        """Parse version-related headers from response.
        
        Returns dict with:
            - api_version: The actual version used
            - api_version_warning: Warning if version mismatch
            - deprecation_info: Deprecation details if endpoint is deprecated
        """
        result = {
            "api_version": response.headers.get("X-API-Version"),
            "api_version_warning": response.headers.get("X-API-Version-Warning"),
            "deprecation_info": None,
        }
        
        # Check for deprecation
        if response.headers.get("Deprecation") == "true":
            result["deprecation_info"] = {
                "deprecated": True,
                "sunset": response.headers.get("Sunset"),
                "link": response.headers.get("Link"),
            }
            
            # Extract alternative endpoint from Link header
            link_header = response.headers.get("Link", "")
            if 'rel="successor-version"' in link_header:
                # Parse: </api/v1/do>; rel="successor-version"
                for part in link_header.split(","):
                    if 'rel="successor-version"' in part:
                        alt = part.split(";")[0].strip().strip("<>")
                        result["deprecation_info"]["alternative"] = alt
                        break
            
            # Fire deprecation callbacks
            self._fire_deprecation_callbacks(
                endpoint=response.request.url.path if response.request else "unknown",
                sunset=response.headers.get("Sunset"),
                alternative=result["deprecation_info"].get("alternative"),
            )
        
        # Log version warnings
        if result["api_version_warning"]:
            logger.warning(f"API Version Warning: {result['api_version_warning']}")
        
        return result
    
    def _fire_deprecation_callbacks(
        self,
        endpoint: str,
        sunset: Optional[str],
        alternative: Optional[str],
    ) -> None:
        """Fire registered deprecation callbacks."""
        # Always emit Python warning
        warnings.warn(
            f"Centris API endpoint '{endpoint}' is deprecated. "
            f"Sunset: {sunset or 'unknown'}. "
            f"Alternative: {alternative or 'see migration docs'}",
            DeprecationWarning,
            stacklevel=4,
        )
        
        # Fire registered callbacks
        for callback in self._deprecation_callbacks:
            try:
                callback(endpoint, sunset, alternative)
            except Exception as e:
                logger.warning(f"Deprecation callback error: {e}")
    
    def on_deprecation(self, callback: DeprecationCallback) -> "Centris":
        """Register a callback for deprecation warnings.
        
        The callback receives (endpoint, sunset_date, alternative_endpoint).
        
        Args:
            callback: Function called when a deprecated endpoint is used
            
        Returns:
            self (for chaining)
            
        Example:
            centris.on_deprecation(lambda ep, sun, alt: 
                print(f"Warning: {ep} deprecated, use {alt}")
            )
        """
        self._deprecation_callbacks.append(callback)
        return self
    
    def get_version_info(self) -> Dict[str, Any]:
        """Get API version information from the server.
        
        Returns:
            Dict with current_version, minimum_supported_version, deprecations, etc.
            
        Example:
            info = centris.get_version_info()
            print(f"Current version: {info['current_version']}")
        """
        if self.local:
            return {
                "current_version": self.api_version,
                "local_mode": True,
            }
        
        response = self._client.get(
            f"{self.base_url}/api/version",
            headers=self._headers(),
        )
        return response.json()
    
    def do(
        self,
        command: str,
        async_mode: bool = False,
        context: Optional[Dict[str, Any]] = None,
    ) -> CentrisResult:
        """Execute a command.
        
        Args:
            command: What you want Centris to do (natural language)
            async_mode: If True, returns immediately with task_id for polling
            context: Optional context (browser URL, system info, etc.)
            
        Returns:
            CentrisResult with the response (includes API version metadata)
            
        Raises:
            AuthenticationError: Invalid API key
            RateLimitError: Task limit exceeded
            CentrisError: Other errors (including VERSION_NOT_SUPPORTED)
            
        Example:
            result = centris.do("Open Gmail and read my first email")
            print(result.text)
            
            # Check if endpoint is deprecated
            if result.is_deprecated:
                print(f"Warning: endpoint deprecated, sunset: {result.deprecation_info['sunset']}")
        """
        # Local-first execution (no API server needed)
        if self.local:
            return self._execute_local(command, context)
        
        # API execution
        response = self._client.post(
            f"{self.base_url}/api/v1/do",
            headers=self._headers(),
            json={
                "command": command,
                "async": async_mode,
                "context": context or {},
            },
        )
        
        data = response.json()
        
        # Parse version headers (may fire deprecation callbacks)
        version_info = self._parse_version_headers(response)
        
        # Handle errors
        if response.status_code == 400 and data.get("code") == "VERSION_NOT_SUPPORTED":
            raise CentrisError(
                data.get("error", "API version not supported"),
                code="VERSION_NOT_SUPPORTED",
                task_id=data.get("task_id"),
            )
        
        if response.status_code == 401:
            raise AuthenticationError(
                data.get("error", "Authentication failed"),
                code="AUTH_FAILED",
                task_id=data.get("task_id"),
            )
        
        if response.status_code == 429:
            raise RateLimitError(
                data.get("error", "Rate limit exceeded"),
                code="RATE_LIMIT_EXCEEDED",
                task_id=data.get("task_id"),
            )
        
        if data.get("status") == "failed":
            raise CentrisError(
                data.get("error", "Command failed"),
                code=data.get("code"),
                task_id=data.get("task_id"),
            )
        
        return CentrisResult(
            task_id=data.get("task_id", ""),
            status=data.get("status", "completed"),
            text=data.get("result", ""),
            actions=data.get("actions", []),
            usage=data.get("usage"),
            api_version=version_info.get("api_version"),
            api_version_warning=version_info.get("api_version_warning"),
            deprecation_info=version_info.get("deprecation_info"),
        )
    
    def _execute_local(self, command: str, context: Optional[Dict[str, Any]] = None) -> CentrisResult:
        """Execute command locally without API server.
        
        This is local-first execution - the entire Centris system runs
        on your computer without needing a backend server.
        """
        import asyncio
        import uuid
        
        task_id = f"ctask_{uuid.uuid4().hex[:12]}"
        
        try:
            # Import backend modules directly
            from backend.infra.command_executor import execute_command
            
            # Run in event loop
            try:
                loop = asyncio.get_event_loop()
            except RuntimeError:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
            
            result = loop.run_until_complete(
                execute_command(
                    command=command,
                    user_id="local_user",
                    source="sdk_local",
                    context=context,
                )
            )
            
            if result.success:
                return CentrisResult(
                    task_id=task_id,
                    status="completed",
                    text=result.response,
                    actions=result.actions,
                    usage={"llm_calls": result.llm_calls},
                )
            else:
                raise CentrisError(
                    result.error or "Local execution failed",
                    code=result.error_code,
                    task_id=task_id,
                )
                
        except ImportError as e:
            raise CentrisError(
                f"Backend not available for local execution: {e}. "
                "Install centris-sdk[all] or run with local=False to use API.",
                code="IMPORT_ERROR",
                task_id=task_id,
            )
    
    def wait(
        self,
        task_id: str,
        poll_interval: float = 2.0,
        timeout: Optional[float] = None,
    ) -> CentrisResult:
        """Wait for an async task to complete.
        
        Args:
            task_id: Task ID from async do() call
            poll_interval: Seconds between status checks
            timeout: Max seconds to wait (None = use client timeout)
            
        Returns:
            CentrisResult when task completes (includes API version metadata)
        """
        timeout = timeout or self.timeout
        start = time.time()
        
        while time.time() - start < timeout:
            response = self._client.get(
                f"{self.base_url}/api/v1/task/{task_id}",
                headers=self._headers(),
            )
            
            data = response.json()
            status = data.get("status")
            
            # Parse version headers
            version_info = self._parse_version_headers(response)
            
            if status == "completed":
                return CentrisResult(
                    task_id=task_id,
                    status="completed",
                    text=data.get("result", ""),
                    actions=data.get("actions", []),
                    api_version=version_info.get("api_version"),
                    api_version_warning=version_info.get("api_version_warning"),
                    deprecation_info=version_info.get("deprecation_info"),
                )
            
            if status == "failed":
                raise CentrisError(
                    data.get("error", "Task failed"),
                    code=data.get("code"),
                    task_id=task_id,
                )
            
            time.sleep(poll_interval)
        
        raise CentrisError(
            f"Task {task_id} timed out after {timeout}s",
            code="TIMEOUT",
            task_id=task_id,
        )
    
    def usage(self) -> CentrisUsage:
        """Get current usage and limits.
        
        Returns:
            CentrisUsage with tier, remaining tasks, etc.
        """
        response = self._client.get(
            f"{self.base_url}/api/v1/usage",
            headers=self._headers(),
        )
        
        if response.status_code == 401:
            raise AuthenticationError("Invalid API key")
        
        data = response.json()
        
        return CentrisUsage(
            tier=data.get("tier", "free"),
            tasks_remaining=data.get("tasks_remaining", 0),
            monthly_limit=data.get("monthly_limit", 0),
            daily_bonus=data.get("daily_bonus", 0),
            tasks_used_today=data.get("tasks_used_today", 0),
            period_ends=data.get("period_ends"),
        )

    def observe(self, request: KernelObserveRequest) -> KernelObserveResult:
        """Observe runtime state via Action API."""
        result = self._call_action_api("observe", request.__dict__)
        return KernelObserveResult(
            url=str(result.get("url", "")),
            title=result.get("title"),
            interactive=result.get("interactive", []),
        )

    def act(self, request: KernelActRequest) -> KernelActResult:
        """Execute one runtime action via Action API."""
        result = self._call_action_api("act", request.__dict__)
        return KernelActResult(
            ok=bool(result.get("ok", False)),
            details=result.get("details", {}),
        )

    def verify(self, request: KernelVerifyRequest) -> KernelVerifyResult:
        """Run success checks via Action API."""
        payload_checks = [c.__dict__ for c in request.checks]
        result = self._call_action_api("verify", {"checks": payload_checks})
        return KernelVerifyResult(
            ok=bool(result.get("ok", False)),
            passed=[KernelSuccessCheck(**c) for c in result.get("passed", [])],
            failed=[KernelSuccessCheck(**c) for c in result.get("failed", [])],
        )

    def route_run(self, request: ActionRouteRunRequest) -> ActionRouteRunResult:
        """Run a named route via Action API."""
        payload = {
            "routeId": request.route_id,
            "url": request.url,
            "params": request.params,
            "checks": [_kernel_check_to_dict(c) for c in request.checks],
            "artifacts": [_artifact_to_dict(a) for a in request.artifacts],
            "pageFingerprint": (
                _page_fingerprint_to_dict(request.page_fingerprint)
                if request.page_fingerprint
                else None
            ),
            "actionIndex": [_action_index_entry_to_dict(item) for item in request.action_index],
            "routeMemory": (
                _route_memory_to_dict(request.route_memory) if request.route_memory else None
            ),
        }
        result = self._call_action_api("route.run", payload)
        verify = result.get("verify")
        verify_result = None
        if isinstance(verify, dict):
            verify_result = KernelVerifyResult(
                ok=bool(verify.get("ok", False)),
                passed=[KernelSuccessCheck(**c) for c in verify.get("passed", [])],
                failed=[KernelSuccessCheck(**c) for c in verify.get("failed", [])],
            )
        artifacts: list[ActionArtifact] = []
        for item in result.get("artifacts", []):
            parsed_artifact = _parse_action_artifact(item)
            if parsed_artifact:
                artifacts.append(parsed_artifact)
        return ActionRouteRunResult(
            ok=bool(result.get("ok", False)),
            executed=int(result.get("executed", 0)),
            verify=verify_result,
            artifacts=artifacts,
            source=result.get("source") if isinstance(result.get("source"), str) else None,
            page_fingerprint=_parse_page_fingerprint(result.get("pageFingerprint")),
            action_index=_parse_action_index_entries(result.get("actionIndex")),
            route_memory=_parse_route_memory(result.get("routeMemory")),
        )

    def route_record_start(
        self,
        request: ActionRouteRecordStartRequest,
    ) -> ActionRouteRecordStartResult:
        """Start route recording via Action API."""
        payload = {
            "intent": request.intent,
            "url": request.url,
            "params": request.params,
            "metadata": request.metadata,
        }
        result = self._call_action_api("route.record.start", payload)
        return ActionRouteRecordStartResult(
            ok=bool(result.get("ok", False)),
            session_id=str(result.get("sessionId", "")),
            started_at=result.get("startedAt"),
        )

    def route_record_stop(
        self,
        request: ActionRouteRecordStopRequest,
    ) -> ActionRouteRecordStopResult:
        """Stop route recording via Action API."""
        payload = {
            "sessionId": request.session_id,
            "outcome": request.outcome,
            "metadata": request.metadata,
        }
        result = self._call_action_api("route.record.stop", payload)
        return ActionRouteRecordStopResult(
            ok=bool(result.get("ok", False)),
            route_id=result.get("routeId"),
            updated_at=result.get("updatedAt"),
        )

    def web_memory_index(self, request: ActionWebMemoryIndexRequest) -> ActionWebMemoryIndexResult:
        """Index or update a cached web playbook via Action API."""
        payload = {
            "url": request.url,
            "intent": request.intent,
            "playbook": request.playbook,
            "pageFingerprint": (
                _page_fingerprint_to_dict(request.page_fingerprint)
                if request.page_fingerprint
                else None
            ),
            "actionIndex": [_action_index_entry_to_dict(item) for item in request.action_index],
            "routeMemory": (
                _route_memory_to_dict(request.route_memory) if request.route_memory else None
            ),
            "ttlMs": request.ttl_ms,
            "metadata": request.metadata,
        }
        result = self._call_action_api("web.memory.index", payload)
        artifact_obj = _parse_action_artifact(result.get("artifact"))
        return ActionWebMemoryIndexResult(
            ok=bool(result.get("ok", False)),
            cache_key=result.get("cacheKey"),
            version=result.get("version"),
            created_at=result.get("createdAt"),
            expires_at=result.get("expiresAt"),
            page_fingerprint=_parse_page_fingerprint(result.get("pageFingerprint")),
            action_index=_parse_action_index_entries(result.get("actionIndex")),
            route_memory=_parse_route_memory(result.get("routeMemory")),
            artifact=artifact_obj,
        )

    def web_memory_resolve(
        self,
        request: ActionWebMemoryResolveRequest,
    ) -> ActionWebMemoryResolveResult:
        """Resolve cached web playbook for URL + intent via Action API."""
        payload = {
            "url": request.url,
            "intent": request.intent,
            "maxAgeMs": request.max_age_ms,
        }
        result = self._call_action_api("web.memory.resolve", payload)
        artifact_obj = _parse_action_artifact(result.get("artifact"))
        return ActionWebMemoryResolveResult(
            hit=bool(result.get("hit", False)),
            cache_key=result.get("cacheKey"),
            playbook=result.get("playbook", {}) if isinstance(result.get("playbook"), dict) else {},
            generated_at=result.get("generatedAt"),
            expires_at=result.get("expiresAt"),
            source=result.get("source") if isinstance(result.get("source"), str) else None,
            confidence=float(result["confidence"])
            if isinstance(result.get("confidence"), (int, float))
            else None,
            page_fingerprint=_parse_page_fingerprint(result.get("pageFingerprint")),
            action_index=_parse_action_index_entries(result.get("actionIndex")),
            route_memory=_parse_route_memory(result.get("routeMemory")),
            artifact=artifact_obj,
        )

    def web_memory_execute(
        self,
        request: ActionWebMemoryExecuteRequest,
    ) -> ActionWebMemoryExecuteResult:
        """Execute a web-memory operation via Action API."""
        payload = {
            "url": request.url,
            "intent": request.intent,
            "operation": request.operation,
            "pageFingerprintId": request.page_fingerprint_id,
            "routeId": request.route_id,
            "params": request.params,
        }
        result = self._call_action_api("web.memory.execute", payload)
        artifacts: list[ActionArtifact] = []
        for item in result.get("artifacts", []):
            parsed_artifact = _parse_action_artifact(item)
            if parsed_artifact:
                artifacts.append(parsed_artifact)
        source_value = result.get("source")
        source = source_value if source_value in ("cache", "live") else None
        return ActionWebMemoryExecuteResult(
            ok=bool(result.get("ok", False)),
            source=source,
            executed=int(result["executed"]) if isinstance(result.get("executed"), int) else None,
            confidence=float(result["confidence"])
            if isinstance(result.get("confidence"), (int, float))
            else None,
            page_fingerprint=_parse_page_fingerprint(result.get("pageFingerprint")),
            action_index=_parse_action_index_entries(result.get("actionIndex")),
            route_memory=_parse_route_memory(result.get("routeMemory")),
            details=result.get("details", {}) if isinstance(result.get("details"), dict) else {},
            artifacts=artifacts,
        )

    def web_memory_invalidate(
        self,
        request: ActionWebMemoryInvalidateRequest,
    ) -> ActionWebMemoryInvalidateResult:
        """Invalidate cached web playbooks via Action API."""
        payload = {
            "url": request.url,
            "playbookId": request.playbook_id,
            "scope": request.scope,
            "reason": request.reason,
        }
        result = self._call_action_api("web.memory.invalidate", payload)
        return ActionWebMemoryInvalidateResult(
            ok=bool(result.get("ok", False)),
            invalidated=int(result.get("invalidated", 0)),
        )

    def web_memory_stats(
        self,
        request: ActionWebMemoryStatsRequest,
    ) -> ActionWebMemoryStatsResult:
        """Fetch web memory cache stats via Action API."""
        payload = {
            "url": request.url,
            "window": request.window,
        }
        result = self._call_action_api("web.memory.stats", payload)
        return ActionWebMemoryStatsResult(
            entries=int(result.get("entries", 0)),
            hits=int(result.get("hits", 0)),
            misses=int(result.get("misses", 0)),
            hit_rate=float(result["hitRate"]) if isinstance(result.get("hitRate"), (int, float)) else None,
            avg_resolve_ms=float(result["avgResolveMs"])
            if isinstance(result.get("avgResolveMs"), (int, float))
            else None,
            indexed_pages=int(result["indexedPages"])
            if isinstance(result.get("indexedPages"), int)
            else None,
            indexed_actions=int(result["indexedActions"])
            if isinstance(result.get("indexedActions"), int)
            else None,
            indexed_routes=int(result["indexedRoutes"])
            if isinstance(result.get("indexedRoutes"), int)
            else None,
            avg_execute_ms=float(result["avgExecuteMs"])
            if isinstance(result.get("avgExecuteMs"), (int, float))
            else None,
        )

    def dispatch_action_api(
        self,
        request: ActionApiRequestEnvelope,
    ) -> ActionApiResponseEnvelope:
        """Dispatch a typed Action API envelope."""
        if self.local:
            raise CentrisError("Action API dispatch requires API mode", code="LOCAL_UNSUPPORTED")

        response = self._client.post(
            f"{self.base_url}/api/v1/action",
            headers=self._headers(),
            json={
                "specVersion": request.spec_version,
                "method": request.method,
                "id": request.id,
                "params": request.params,
            },
        )
        body = response.json()
        if response.status_code >= 400:
            raise CentrisError(
                body.get("error", "Action API dispatch failed"),
                code=body.get("code", "ACTION_API_FAILED"),
            )

        err_obj = None
        if isinstance(body.get("error"), dict):
            err_data = body["error"]
            err_obj = ActionApiError(
                code=str(err_data.get("code", "ACTION_API_FAILED")),
                message=str(err_data.get("message", "Action API failed")),
                details=err_data.get("details", {}) or {},
            )

        return ActionApiResponseEnvelope(
            spec_version=str(body.get("specVersion", ACTION_API_SPEC_VERSION)),
            method=body.get("method", request.method),
            ok=bool(body.get("ok", False)),
            result=body.get("result"),
            error=err_obj,
            id=body.get("id"),
        )

    def _call_action_api(self, method: str, params: Dict[str, Any]) -> Dict[str, Any]:
        envelope = ActionApiRequestEnvelope(
            spec_version=ACTION_API_SPEC_VERSION,
            method=method,  # type: ignore[arg-type]
            params=params,
        )
        response = self.dispatch_action_api(envelope)
        if not response.ok or not isinstance(response.result, dict):
            err = getattr(response, "error", None)
            message = getattr(err, "message", None) if err else None
            raise CentrisError(
                message or f"Action API method failed: {method}",
                code=getattr(err, "code", "ACTION_API_FAILED") if err else "ACTION_API_FAILED",
            )
        return response.result
    
    def __enter__(self):
        return self
    
    def __exit__(self, *args):
        self._client.close()
    
    def close(self):
        """Close the HTTP client."""
        self._client.close()


# Convenience function for one-off usage
def do(command: str, api_key: Optional[str] = None, **kwargs) -> CentrisResult:
    """Execute a command without creating a client.
    
    Args:
        command: What you want Centris to do
        api_key: Optional API key (or set CENTRIS_API_KEY env var)
        **kwargs: Additional arguments passed to Centris.do()
        
    Returns:
        CentrisResult
        
    Example:
        from centris import do
        result = do("Open Gmail")
    """
    with Centris(api_key=api_key) as client:
        return client.do(command, **kwargs)
