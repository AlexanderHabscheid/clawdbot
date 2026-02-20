# Centris Agent Loop Contract

This file defines how Centris agentic execution should behave across runtime surfaces.

## Loop phases

1. Intake: parse user intent and context.
2. Route: choose domain/tool family with minimal viable scope.
3. Plan: create the smallest safe action sequence.
4. Execute: run tools/commands with bounded retries.
5. Verify: confirm expected state change or output quality.
6. Respond: return a concise, structured outcome.
7. Compact: prune stale context to control latency and cost.

## Core loop invariants

- Do not execute high-risk operations without explicit confirmation.
- Prefer deterministic routes before free-form exploratory execution.
- Keep each turn bounded by timeout and token budgets.
- Emit structured telemetry for each step.
- Preserve user trust: report what changed and what failed.

## Routing policy

Router priority:

1. deterministic route (known action + known context)
2. constrained tool use (single domain)
3. broad tool use (fallback only)

Tie-breakers:

- lower risk path first
- fewer side effects first
- lower token cost first

## Execution policy

- Use explicit operation IDs per step.
- Retriable errors: bounded retry with backoff.
- Non-retriable errors: fail fast with reason and recovery hint.
- All side-effecting steps should be journaled for replay/debug.

## Verification policy

Verification should check:

- expected artifact/state exists
- expected response schema is valid
- no hidden partial failures

If verification fails, return failure even if a command returned success.

## Session memory policy

- Keep short-lived operational context for current task.
- Prune stale snapshots and obsolete node IDs aggressively.
- Persist only reusable facts, not noisy transient state.

## Human handoff policy

Escalate to user when:

- destructive action is requested
- policy uncertainty exists
- repeated retries exceed threshold
- conflicting tool results cannot be reconciled

## Observability contract

Each step should emit:

- `operation`
- `status`
- `duration_ms`
- `error_code` (if any)
- `retriable` flag
- `token_or_cost_hint` where applicable

## Surface mapping

The same loop applies to:

- voice/UI runtime
- `centris` CLI flows
- `centris-py` CLI flows
- SDK-driven orchestrations
- HTTP/API-driven orchestrations
