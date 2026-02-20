"""External system adapter runtime for Centris."""

from __future__ import annotations

from dataclasses import dataclass, field
import json
import os
import subprocess
import time
from typing import Any, Dict, List, Literal, Optional

import httpx

SafetyLevel = Literal["read", "write", "external", "destructive"]
AdapterTransport = Literal["subprocess", "http", "sdk"]


@dataclass
class AdapterOperation:
    operation: str
    safety_level: SafetyLevel


@dataclass
class AdapterSpec:
    adapter_id: str
    system: str
    transport: AdapterTransport
    operations: List[AdapterOperation] = field(default_factory=list)
    default_timeout_ms: int = 30_000
    max_timeout_ms: int = 120_000
    system_version: Optional[str] = None


@dataclass
class AdapterExecutionResult:
    ok: bool
    summary: str
    data: Dict[str, Any] = field(default_factory=dict)
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    duration_ms: int = 0
    safety_level: Optional[SafetyLevel] = None


class AdapterRuntime:
    """Execute adapter operations with safety policy enforcement."""

    def _find_operation(self, spec: AdapterSpec, operation: str) -> Optional[AdapterOperation]:
        for entry in spec.operations:
            if entry.operation == operation:
                return entry
        return None

    @staticmethod
    def _safety_error(
        *,
        level: SafetyLevel,
        dry_run: bool,
        allow_external: bool,
        allow_destructive: bool,
    ) -> Optional[str]:
        if level == "external" and not allow_external and not dry_run:
            return "external operations require allow_external=True or dry_run=True"
        if level == "destructive" and not allow_destructive and not dry_run:
            return "destructive operations require allow_destructive=True or dry_run=True"
        return None

    def execute(
        self,
        spec: AdapterSpec,
        *,
        operation: str,
        input_data: Dict[str, Any],
        timeout_ms: Optional[int] = None,
        dry_run: bool = False,
        allow_external: bool = False,
        allow_destructive: bool = False,
        subprocess_cmd: Optional[str] = None,
        subprocess_args: Optional[List[str]] = None,
        subprocess_cwd: Optional[str] = None,
        subprocess_env: Optional[Dict[str, str]] = None,
        http_url: Optional[str] = None,
        http_method: str = "POST",
        http_headers: Optional[Dict[str, str]] = None,
    ) -> AdapterExecutionResult:
        started_at = time.time()
        op = self._find_operation(spec, operation)
        if op is None:
            return AdapterExecutionResult(
                ok=False,
                summary=f"Unknown adapter operation: {operation}",
                errors=[f"operation not declared by adapter {spec.adapter_id}"],
                duration_ms=int((time.time() - started_at) * 1000),
            )

        effective_timeout = min(timeout_ms or spec.default_timeout_ms, spec.max_timeout_ms)
        safety_error = self._safety_error(
            level=op.safety_level,
            dry_run=dry_run,
            allow_external=allow_external,
            allow_destructive=allow_destructive,
        )
        if safety_error:
            return AdapterExecutionResult(
                ok=False,
                summary="Adapter safety policy blocked execution",
                errors=[safety_error],
                duration_ms=int((time.time() - started_at) * 1000),
                safety_level=op.safety_level,
            )

        if dry_run:
            return AdapterExecutionResult(
                ok=True,
                summary="Dry run: adapter execution skipped",
                data={"input": input_data, "transport": spec.transport},
                duration_ms=int((time.time() - started_at) * 1000),
                safety_level=op.safety_level,
            )

        try:
            if spec.transport == "subprocess":
                if not subprocess_cmd:
                    raise ValueError("subprocess transport requires command")
                data = self._run_subprocess(
                    command=subprocess_cmd,
                    args=subprocess_args or [],
                    cwd=subprocess_cwd,
                    env=subprocess_env,
                    input_data=input_data,
                    timeout_ms=effective_timeout,
                )
            elif spec.transport == "http":
                if not http_url:
                    raise ValueError("http transport requires url")
                data = self._run_http(
                    url=http_url,
                    method=http_method,
                    headers=http_headers,
                    input_data=input_data,
                    timeout_ms=effective_timeout,
                )
            else:
                raise ValueError("python adapter runtime supports subprocess/http transports in CLI mode")

            return AdapterExecutionResult(
                ok=True,
                summary="Adapter operation completed",
                data=data if isinstance(data, dict) else {"result": data},
                duration_ms=int((time.time() - started_at) * 1000),
                safety_level=op.safety_level,
            )
        except Exception as exc:
            return AdapterExecutionResult(
                ok=False,
                summary="Adapter operation failed",
                errors=[str(exc)],
                duration_ms=int((time.time() - started_at) * 1000),
                safety_level=op.safety_level,
            )

    @staticmethod
    def _run_subprocess(
        *,
        command: str,
        args: List[str],
        cwd: Optional[str],
        env: Optional[Dict[str, str]],
        input_data: Dict[str, Any],
        timeout_ms: int,
    ) -> Dict[str, Any]:
        final_env = os.environ.copy()
        if env:
            final_env.update(env)

        process = subprocess.run(
            [command, *args],
            input=json.dumps(input_data),
            text=True,
            cwd=cwd,
            env=final_env,
            capture_output=True,
            timeout=max(1.0, timeout_ms / 1000.0),
            check=False,
        )

        if process.returncode != 0:
            raise RuntimeError(process.stderr.strip() or f"subprocess exited with code {process.returncode}")

        out = (process.stdout or "").strip()
        if not out:
            return {}
        try:
            parsed = json.loads(out)
            return parsed if isinstance(parsed, dict) else {"result": parsed}
        except json.JSONDecodeError:
            return {"stdout": out}

    @staticmethod
    def _run_http(
        *,
        url: str,
        method: str,
        headers: Optional[Dict[str, str]],
        input_data: Dict[str, Any],
        timeout_ms: int,
    ) -> Dict[str, Any]:
        with httpx.Client(timeout=max(1.0, timeout_ms / 1000.0)) as client:
            response = client.request(
                method.upper(),
                url,
                headers={"Content-Type": "application/json", **(headers or {})},
                json=input_data,
            )
            if response.status_code >= 400:
                raise RuntimeError(f"http transport failed ({response.status_code}): {response.text[:300]}")
            try:
                parsed = response.json()
                return parsed if isinstance(parsed, dict) else {"result": parsed}
            except Exception:
                return {"body": response.text}
