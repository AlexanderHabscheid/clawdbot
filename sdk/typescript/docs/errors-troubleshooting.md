# TypeScript errors and troubleshooting

## Execution-layer error codes

From `sdk/typescript/src/execution/*`:

- router/engine: `CANCELLED`, `TIMEOUT`, `ALL_METHODS_FAILED`
- API executor: `NO_ENDPOINT`, `HTTP_<status>`, `API_ERROR`
- browser executor: `NO_BRIDGE`, `NO_UI_MAPPINGS`, `NO_ACTIONS`, `BROWSER_ERROR`
- desktop executor: `DESKTOP_NOT_IMPLEMENTED`

## Gateway/runtime error shapes

From `sdk/typescript/src/gateway/gateway.ts` and `server.ts`:

- tool lookup failure result: `Tool not found: <name>` with `isError: true`
- execution failure result: `Tool execution failed: <error>` with `isError: true`
- HTTP server errors:
  - `400 Missing tool name`
  - `400 Missing query parameter`
  - `404 Not found`
  - `405 Method not allowed`
  - `500 Request error`
- JSON-RPC unknown method: `-32603` with message `Unknown method: ...`

## Troubleshooting matrix

- Symptom: `NO_ENDPOINT`
  - Cause: `context.endpointUrl` missing in API executor path
  - Fix: provide connector endpoint URL in execution context
- Symptom: browser unavailable / `NO_BRIDGE`
  - Cause: browser executor not bound
  - Fix: call `bind(sendCommand, isConnected)` during runtime boot
- Symptom: `NO_UI_MAPPINGS` or `NO_ACTIONS`
  - Cause: capability lacks applicable UI mappings
  - Fix: register mapping metadata for capability + params
- Symptom: `DESKTOP_NOT_IMPLEMENTED`
  - Cause: TS desktop executor is placeholder
  - Fix: use Centris runtime desktop bridge or custom executor override
