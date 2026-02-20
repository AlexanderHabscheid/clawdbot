# Centris Error Taxonomy

Unified error classes and retry behavior across TypeScript SDK, Python SDK, both CLIs, and API.

## Load policy

Load only during execution planning, failure handling, or connector integration.

## Error classes

- `VALIDATION_ERROR` (exit 2): bad input/schema mismatch
- `AUTH_ERROR` (exit 3): auth missing/invalid/expired
- `PERMISSION_ERROR` (exit 3): denied by policy or platform permissions
- `NETWORK_ERROR` (exit 4): timeout/unreachable/backend unavailable
- `RUNTIME_ERROR` (exit 5): deterministic execution failure
- `PARTIAL_SUCCESS` (exit 6): mixed outcome, non-fatal gaps
- `POLICY_DENY` (exit 5): blocked by guardrails/safety gate

## Retry policy

- retryable: `NETWORK_ERROR` and explicitly transient `RUNTIME_ERROR`
- non-retryable: `VALIDATION_ERROR`, `AUTH_ERROR`, `PERMISSION_ERROR`, `POLICY_DENY`
- retry budget: max 2 retries with bounded backoff
- escalate after budget exhausted with actionable recovery hint

## Required fields

- `error_code`
- `message`
- `retriable`
- `operation`
- `request_id`
- `surface`
- `safe_hint`
