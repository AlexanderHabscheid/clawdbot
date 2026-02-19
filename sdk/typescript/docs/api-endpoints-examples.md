# TypeScript MCP/HTTP endpoint examples

Server implementation: `sdk/typescript/src/gateway/server.ts`.

## Endpoints

- `GET /` and `GET /health`
- `GET /mcp/tools` and `GET /tools`
- `POST /mcp/execute` and `POST /execute`
- `GET /mcp/schema` and `GET /schema`
- `GET /mcp/connectors` and `GET /connectors`
- `GET /mcp/search` and `GET /search`
- `POST /rpc`
- `GET /.well-known/agent.json`

## Example: list tools

```bash
curl -sS http://localhost:3000/mcp/tools
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

## Example: execute tool

Accepted request aliases:

- tool: `tool` or `name`
- args: `arguments` or `params`

Optional headers mapped to execution context:

- `x-session-key`
- `x-user-id`

```bash
curl -sS http://localhost:3000/mcp/execute \
  -H 'Content-Type: application/json' \
  -H 'x-session-key: s1' \
  -H 'x-user-id: u1' \
  -d '{
    "tool": "slack.send_message",
    "arguments": {"channel":"#general","message":"hello"}
  }'
```

Example response:

```json
{
  "success": true,
  "result": {
    "content": [{ "type": "text", "text": "ok" }],
    "isError": false
  }
}
```

## Example: search capabilities

```bash
curl -sS "http://localhost:3000/mcp/search?q=message&limit=5"
```

## Example: JSON-RPC

Supported methods:

- `initialize`
- `tools/list`
- `tools/call`
- `resources/list`
- `prompts/list`

```bash
curl -sS http://localhost:3000/rpc \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```
