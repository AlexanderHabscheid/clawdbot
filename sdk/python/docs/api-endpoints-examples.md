# Python API and gateway endpoint examples

## Python client (`centris_sdk.client.Centris`)

### Execute command

Endpoint called by client:

- `POST /api/v1/do`

Example request (equivalent to `Centris.do("Open Gmail")`):

```http
POST /api/v1/do
X-Centris-Key: ck_live_xxx
Accept-Version: 2026-01-30
Content-Type: application/json

{
  "command": "Open Gmail",
  "async": false,
  "context": {}
}
```

Example success payload shape consumed by client:

```json
{
  "task_id": "ctask_abc123",
  "status": "completed",
  "result": "Opened Gmail",
  "actions": [],
  "usage": { "remaining": 97 }
}
```

### Poll async task

- `GET /api/v1/task/{task_id}`

### Usage

- `GET /api/v1/usage`

### Version info

- `GET /api/version`

## Python gateway server (`GatewayServer`)

Default bind from `GatewayConfig`:

- host `127.0.0.1`
- port `8000`

Endpoints:

- `GET /health`
- `GET /mcp/tools`
- `POST /mcp/execute`
- `GET /mcp/schema`
- `POST /rpc`
- `GET /.well-known/agent.json`
- `GET /connectors`
- `GET /connectors/{connector_id}`

### Tool list

```bash
curl -sS http://127.0.0.1:8000/mcp/tools
```

Example response:

```json
{
  "tools": [
    {
      "name": "slack.send_message",
      "description": "Send a message",
      "inputSchema": { "type": "object" }
    }
  ]
}
```

### Tool execution

Accepted aliases in request body:

- tool id: `tool` or `tool_id` or `name`
- params: `params` or `arguments` or `input`
- call id: `call_id` or `id`

```bash
curl -sS http://127.0.0.1:8000/mcp/execute \
  -H 'Content-Type: application/json' \
  -d '{
    "tool": "slack.send_message",
    "params": {"channel":"#general","message":"hello"},
    "call_id": "c1"
  }'
```

Example response:

```json
{
  "success": true,
  "content": [{ "type": "text", "text": "{\n  \"ok\": true\n}" }],
  "call_id": "c1",
  "error": null,
  "metadata": { "latency_ms": 25 }
}
```

### JSON-RPC

Supported methods:

- `initialize`
- `tools/list`
- `tools/call`
- `notifications/initialized`

```bash
curl -sS http://127.0.0.1:8000/rpc \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```
