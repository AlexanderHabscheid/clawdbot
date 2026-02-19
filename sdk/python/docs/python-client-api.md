# Python client API

This page documents `centris_sdk.client.Centris` as implemented in `sdk/python/centris_sdk/client.py`.

## Constructor

```python
Centris(
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
    timeout: float = 120.0,
    local: bool = False,
    api_version: Optional[str] = None,
)
```

Behavior:

- `api_key` defaults to `CENTRIS_API_KEY`, then falls back to `ck_test_local`
- `local=True` (or `CENTRIS_LOCAL=true`) switches to local execution path
- `api_version` defaults to `CENTRIS_API_VERSION` or `DEFAULT_API_VERSION` (`2026-01-30`)
- default cloud URL is `https://api.centris.ai`
- local URL probe target is `http://localhost:7777`

## Request headers

Cloud requests send:

- `X-Centris-Key`
- `Content-Type: application/json`
- `Accept-Version`

## Methods

### `do(command, async_mode=False, context=None)`

- endpoint: `POST /api/v1/do`
- body: `command`, `async`, `context`
- returns `CentrisResult`

Raises:

- `AuthenticationError` on `401`
- `RateLimitError` on `429`
- `CentrisError` for failures and unsupported versions (`VERSION_NOT_SUPPORTED`)

### `wait(task_id, poll_interval=2.0, timeout=None)`

- polls `GET /api/v1/task/{task_id}`
- returns `CentrisResult` when completed
- raises `CentrisError` on failed status or timeout

### `usage()`

- endpoint: `GET /api/v1/usage`
- returns `CentrisUsage`
- raises `AuthenticationError` on `401`

### `get_version_info()`

- endpoint: `GET /api/version` (cloud mode)
- returns version metadata from server

### `on_deprecation(callback)`

Registers a callback that receives:

- `endpoint`
- `sunset`
- `alternative`

The client also emits Python `DeprecationWarning` when deprecation headers are present.

## Result types

`CentrisResult` fields:

- `task_id`, `status`, `text`, `actions`
- optional `error`, `usage`
- version metadata: `api_version`, `api_version_warning`, `deprecation_info`

`CentrisUsage` fields:

- `tier`, `tasks_remaining`, `monthly_limit`, `daily_bonus`, `tasks_used_today`, `period_ends`

## Convenience function

`do(command, api_key=None, **kwargs)` is a one-shot helper that creates a client, executes once, and closes it.
