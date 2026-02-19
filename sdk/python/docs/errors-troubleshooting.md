# Python errors and troubleshooting

## CLI exit code reference

From `sdk/python/centris_sdk/cli/errors.py`:

- `0`: success
- `1`: general error
- `2`: usage error
- `3`: config error
- `4`: network error
- `5`: auth error
- `6`: not found
- `7`: permission error
- `8`: timeout error
- `9`: validation error
- `130`: cancelled (`Ctrl+C`)

## Client exception reference

From `sdk/python/centris_sdk/client.py`:

- `AuthenticationError` (invalid/missing key, 401)
- `RateLimitError` (429)
- `CentrisError` (generic failures, `VERSION_NOT_SUPPORTED`, timeout, import issues)

Common `CentrisError.code` values in client path:

- `VERSION_NOT_SUPPORTED`
- `IMPORT_ERROR`
- `TIMEOUT`

## Execution engine error codes

From `sdk/python/centris_sdk/execution`:

- engine: `NO_EXECUTOR`, `MAX_RETRIES_EXCEEDED`
- API executor: `NO_API_CONFIG`, `API_ERROR`, `HTTP_*`, `HTTP_ERROR`, `HANDLER_ERROR`
- browser executor: `BROWSER_EXECUTOR_DISABLED`, `BROWSER_NOT_AVAILABLE`, `NO_URL`, `BROWSER_ERROR`
- desktop executor: `DESKTOP_NOT_AVAILABLE`, `NO_ACTION`, `DESKTOP_ERROR`

## Gateway error codes

From `sdk/python/centris_sdk/gateway/gateway.py`:

- `INVALID_TOOL_ID`
- `CONNECTOR_NOT_FOUND`
- `EXECUTION_ERROR`
- connector-returned `UNKNOWN_ERROR` fallback

## Troubleshooting matrix

- Symptom: `centris do` fails with auth error
  - Check: `CENTRIS_API_KEY` or `centris login`
  - Fix: set valid key or re-authenticate
- Symptom: `centris do` times out
  - Check: backend or API availability; timeout setting
  - Fix: increase `--timeout`, verify backend with `centris status`
- Symptom: browser commands fail
  - Check: backend running, extension connected, target page loaded
  - Fix: `centris start`, then `centris browser snapshot`
- Symptom: `NO_EXECUTOR`
  - Check: capability execution methods and executor setup
  - Fix: register required executor or provide capability metadata
- Symptom: `CONNECTOR_NOT_FOUND` in gateway
  - Check: connector registration in `MCPGateway`
  - Fix: ensure connector loaded and ID matches tool prefix
