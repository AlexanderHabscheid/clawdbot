# MCP and HTTP API

The SDK provides two runtime pieces:

- `CentrisMCPGateway`: connector aggregator and tool execution runtime
- `MCPServer`: HTTP server exposing gateway functions

## Gateway lifecycle

Typical flow:

1. create a gateway with `createMCPGateway(...)`
2. call `initialize()` for discovery and optional path loading
3. start server with `createMCPServer(...)`

`MCPGatewayOptions` supports:

- `name`, `version`
- `autoDiscover` (default enabled)
- `connectorPaths`
- `workspaceDir`
- custom `logger`

## HTTP endpoints

Server routes from `sdk/typescript/src/gateway/server.ts`:

- `GET /` and `GET /health`: health and connector status
- `GET /mcp/tools` and `GET /tools`: list available tools
- `POST /mcp/execute` and `POST /execute`: execute a tool call
- `GET /mcp/schema` and `GET /schema`: full MCP schema
- `GET /mcp/connectors` and `GET /connectors`: list loaded connectors
- `GET /mcp/search` and `GET /search`: capability search (`q` or `query`, optional `limit`)
- `POST /rpc`: JSON-RPC endpoint
- `GET /.well-known/agent.json`: A2A agent card

The execute endpoint accepts tool name from `tool` or `name`, and params from `arguments` or `params`.

Optional request headers consumed by execute:

- `x-session-key`
- `x-user-id`

## JSON-RPC methods

`/rpc` currently handles:

- `initialize`
- `tools/list`
- `tools/call`
- `resources/list`
- `prompts/list`

## MCP schema output

`gateway.toMCPSchema()` returns:

- gateway `name`
- gateway `version`
- `tools` array with `name`, `description`, and `inputSchema`
