# Gateway and HTTP API

This page documents the Python gateway runtime in:

- `sdk/python/centris_sdk/gateway/gateway.py`
- `sdk/python/centris_sdk/gateway/server.py`

## Core runtime objects

- `MCPGateway`: connector aggregation, tool routing, middleware
- `GatewayServer`: FastAPI HTTP surface on top of `MCPGateway`
- `GatewayConfig`: host/port, auth, CORS, and runtime settings

## Tool naming and routing

Tools are exposed as prefixed IDs:

- `<connector_id>.<capability_id>`

Example: `slack.send_message`

`MCPGateway.execute` parses this ID, resolves connector/capability, executes it, and returns a `ToolResult`.

## HTTP endpoints

From `GatewayServer.create_app()`:

- `GET /health`
- `GET /mcp/tools`
- `POST /mcp/execute`
- `GET /mcp/schema`
- `POST /rpc`
- `GET /.well-known/agent.json`
- `GET /connectors`
- `GET /connectors/{connector_id}`

## Auth behavior

When `GatewayConfig.require_auth=True`, bearer tokens are checked against `GatewayConfig.api_keys`.

## JSON-RPC methods

`POST /rpc` supports:

- `initialize`
- `tools/list`
- `tools/call`
- `notifications/initialized`

## Request shapes

`POST /mcp/execute` accepts these aliases:

- tool id: `tool` or `tool_id` or `name`
- params: `params` or `arguments` or `input`
- call id: `call_id` or `id`
- optional `context`
