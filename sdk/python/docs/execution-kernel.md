# Execution engine and kernel

This page documents runtime execution and deterministic action contracts.

## Execution engine

Module: `sdk/python/centris_sdk/execution`

### Key classes

- `ExecutionEngine`
- `ExecutionRouter`
- `ExecutionConfig`
- default executors: `APIExecutor`, `BrowserExecutor`, `DesktopExecutor`

### Engine behavior

`ExecutionEngine` provides:

- automatic executor setup
- method selection through `ExecutionRouter`
- retries with backoff (`max_retries`, `retry_delay`, `retry_backoff`)
- fallback executor selection when enabled
- batch execution with configurable concurrency (`execute_batch`)

### Router behavior

`ExecutionRouter` filters and ranks candidates using:

- capability-supported methods
- request-level preferred and allowed methods
- executor availability
- `ExecutionPriority`: `speed`, `reliability`, `cost`

## Action kernel

Module: `sdk/python/centris_sdk/kernel.py`

Version constant:

- `ACTION_KERNEL_SPEC_VERSION = "2026-02-19"`

Protocol operations:

- `observe`
- `act`
- `verify`
- `route`
- `learn`

Primary dataclasses:

- `KernelObserveRequest`, `KernelObserveResult`
- `KernelActRequest`, `KernelActResult`
- `KernelVerifyRequest`, `KernelVerifyResult`
- `KernelRouteRequest`, `KernelRouteResult`
- `KernelLearnRequest`, `KernelLearnResult`
