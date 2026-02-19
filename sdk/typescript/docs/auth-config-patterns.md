# TypeScript auth and config patterns

## API executor auth mapping

In `sdk/typescript/src/execution/executors/api.ts`:

- `context.auth.accessToken` -> `Authorization: Bearer <token>`
- `context.auth.apiKey` -> `X-API-Key: <key>`
- `context.userId` -> `X-User-Id`
- `context.sessionId` -> `X-Session-Id`

## MCP server request context

In `sdk/typescript/src/gateway/server.ts`, execute route maps headers:

- `x-session-key` -> `ConnectorToolContext.sessionKey`
- `x-user-id` -> `ConnectorToolContext.userId`

## Package/runtime configuration points

From `sdk/typescript/src/gateway/types.ts`:

- gateway name/version
- discovery controls:
  - `autoDiscover`
  - `connectorPaths`
  - `workspaceDir`
- server options:
  - `host`, `port`, `cors`

## Production patterns

- Pin explicit gateway `name` and `version` for stable introspection outputs.
- Use explicit `connectorPaths` in production to avoid accidental auto-discovery drift.
- Set `host` to loopback for local-only runtime, front with reverse proxy if exposing externally.
- Standardize auth at your integration edge and forward `x-user-id`/`x-session-key` for traceability.
