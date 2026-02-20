# @centris/sdk

The complete Centris SDK for building connectors, skills, and agents.

## Documentation

Detailed SDK documentation is available in [`sdk/typescript/docs`](./docs):

- [Centris SDK overview](./docs/index.md)
- [Installation and quickstart](./docs/quickstart.md)
- [CLI reference](./docs/cli.md)
- [CLI command matrix](./docs/cli-command-matrix.md)
- [Connector API](./docs/connector-api.md)
- [Execution engine](./docs/execution.md)
- [MCP and HTTP API](./docs/mcp-http-api.md)
- [MCP/HTTP endpoint examples](./docs/api-endpoints-examples.md)
- [Manifest and routes](./docs/manifest-routes.md)
- [TypeScript API surface](./docs/api-surface.md)
- [Auth and config patterns](./docs/auth-config-patterns.md)
- [Errors and troubleshooting](./docs/errors-troubleshooting.md)

## Features

- **Connector Development**: Create connectors that integrate any application with Centris
- **MCP Compatible**: Works with Claude Desktop, Cursor, and other MCP-compatible tools
- **Multiple Execution Methods**: API, Browser, and Desktop automation support
- **CLI Tools**: Initialize, test, serve, and publish connectors
- **TypeBox Schemas**: Type-safe schema definitions with runtime validation
- **Plugin API**: Inspired by Clawdbot's mature plugin architecture

## Installation

```bash
npm install @centris/sdk
```

### Global CLI one-liner (recommended for dev UX)

```bash
npm install -g @centris/sdk
```

Create, compile, and run:

```bash
npx centris init demo-ts --language typescript
cd demo-ts
npm install
npm run build
centris validate .
centris test .
centris serve .
```

## Quick Start

### 1. Initialize a Connector

```bash
npx centris init my-connector
cd my-connector
npm install
```

### 2. Create Your Connector

```typescript
// src/index.ts
import { Type } from "@centris/sdk";
import type { CentrisConnectorDefinition, CentrisConnectorApi } from "@centris/sdk";

const SendMessageSchema = Type.Object({
  channel: Type.String({ description: "Target channel" }),
  message: Type.String({ description: "Message to send" }),
});

export default {
  id: "my-connector",
  name: "My Connector",
  version: "1.0.0",
  description: "My awesome connector",

  register(api: CentrisConnectorApi) {
    api.registerTool({
      name: "my-connector.send",
      description: "Send a message",
      parameters: SendMessageSchema,
      async execute(toolCallId, params) {
        // Your implementation here
        return {
          content: [{ type: "text", text: `Sent: ${params.message}` }],
        };
      },
    });

    api.logger.info("My Connector registered!");
  },
} satisfies CentrisConnectorDefinition;
```

### 3. Test Your Connector

```bash
# Start development server
npm run dev

# Open playground
# http://localhost:8000/ui
```

### 4. Publish

```bash
npm run build
centris publish
```

Registry publish API: `POST /api/connectors`.

## CLI Commands

```bash
# Initialize a new connector
centris init <id> [options]
  --name <name>        Display name
  --description <desc> Description
  --language <lang>    typescript or python
  --template <tmpl>    basic, oauth, browser, desktop

# Validate connector schema
centris validate [path]
  --strict             Enable strict validation

# Test capabilities
centris test [path]
  --capability <id>    Test specific capability
  --params <json>      Test parameters

# Start development server
centris serve [path]
  --port <port>        Port (default: 8000)
  --host <host>        Host (default: localhost)
  --watch              Enable hot reload

# Publish to registry
centris publish [path]
  --registry <url>     Registry URL
  --api-key <key>      API key
  --dry-run            Dry run

# Record/run/test deterministic routes (manifest-backed)
centris route record --app <app> --action <name> --description <text> --url-pattern <pattern> --route-pattern <pattern> --steps '<json>' [--checks '<json>'] [--fallback-chains '<json>']
centris route run --action <name> --url <url> [--manifest <file>] [--playwright]
centris route test --action <name> --url <url> --playwright
```

## MCP Gateway

Run your connectors as an MCP server:

```typescript
import { createMCPGateway, createMCPServer } from "@centris/sdk";

// Create gateway
const gateway = createMCPGateway({
  name: "my-gateway",
  autoDiscover: true,
});

await gateway.initialize();

// Start server
const server = createMCPServer({
  gateway,
  port: 3000,
});

await server.start();
// MCP Server running at http://localhost:3000
```

### MCP Endpoints

| Endpoint                  | Description           |
| ------------------------- | --------------------- |
| `/mcp/tools`              | List all tools        |
| `/mcp/execute`            | Execute a tool        |
| `/mcp/schema`             | Full MCP schema       |
| `/rpc`                    | JSON-RPC 2.0 endpoint |
| `/.well-known/agent.json` | A2A Agent Card        |

## Execution Engine

Route capabilities to the optimal execution method:

```typescript
import { createExecutionEngine } from "@centris/sdk";

const engine = createExecutionEngine();

const result = await engine.execute({
  connectorId: "slack",
  capabilityId: "send_message",
  params: { channel: "#general", message: "Hello!" },
  context: {
    auth: { accessToken: "..." },
  },
});
```

### Execution Methods

| Method    | Description         | Use Case                |
| --------- | ------------------- | ----------------------- |
| `api`     | Direct API calls    | Fastest, requires OAuth |
| `browser` | Browser automation  | Fallback, no API access |
| `desktop` | Desktop app control | Native apps             |

## TypeBox Schemas

Type-safe schemas with runtime validation:

```typescript
import { Type, validate, stringEnum } from "@centris/sdk";

// String enum (avoids TypeBox Union issues)
const PrioritySchema = stringEnum(["low", "medium", "high"]);

// Common primitives
import { NonEmptyString, PositiveInteger, Timestamp, EmailString } from "@centris/sdk";

// Validation
const schema = Type.Object({
  email: EmailString,
  count: PositiveInteger,
});

const result = validate(schema, { email: "test@example.com", count: 5 });
if (result.ok) {
  console.log(result.value);
} else {
  console.log(result.errors);
}
```

## Plugin API

Register multiple components from a connector:

```typescript
export default {
  register(api: CentrisConnectorApi) {
    // Tools
    api.registerTool(myTool);

    // Gateway methods
    api.registerGatewayMethod("my.method", async (params, ctx) => {
      return { result: "..." };
    });

    // CLI commands
    api.registerCli(
      (ctx) => {
        ctx.program.command("my-cmd").action(() => {});
      },
      { commands: ["my-cmd"] },
    );

    // Background services
    api.registerService({
      id: "my-service",
      start: async (ctx) => {
        /* ... */
      },
      stop: async (ctx) => {
        /* ... */
      },
    });
  },
};
```

## Configuration

Create `centris.config.ts` in your project:

```typescript
import type { CentrisConfig } from "@centris/sdk";

export default {
  connectors: {
    enabled: true,
    allow: ["slack", "gmail"],
    deny: ["dangerous-connector"],
    entries: {
      slack: {
        enabled: true,
        config: {
          workspace: "my-workspace",
        },
      },
    },
  },
  gateway: {
    port: 3000,
    cors: true,
  },
} satisfies CentrisConfig;
```

## Python SDK

The Python SDK provides equivalent functionality:

```python
from centris_sdk import (
    CentrisPluginConnector,
    CentrisConnectorApi,
    CentrisTool,
    text_result,
)

connector = CentrisPluginConnector(
    id="my-connector",
    name="My Connector",
    description="My connector",
)

@connector.register
def register(api: CentrisConnectorApi):
    async def handler(tool_call_id, params, context):
        return text_result(f"Hello {params.get('name')}!")

    api.register_tool(CentrisTool(
        name="greet",
        description="Greet someone",
        parameters={
            "type": "object",
            "properties": {
                "name": {"type": "string"},
            },
        },
        execute=handler,
    ))
```

## Examples

See the [examples](./examples) directory for:

- Basic connector
- OAuth connector (Slack, Gmail)
- Browser automation connector
- Desktop app connector
- Multi-tool connector

## API Reference

### Core Types

- `CentrisConnectorDefinition` - Connector export structure
- `CentrisConnectorApi` - API passed to register function
- `CentrisTool` - Tool definition
- `ToolResult` - Tool execution result

### Schema Types

- `Type` - TypeBox type builder
- `stringEnum` - String enum helper
- `validate` - Schema validation

### Gateway

- `CentrisMCPGateway` - MCP Gateway class
- `MCPServer` - HTTP server for MCP

### Execution

- `ExecutionEngine` - Execution engine
- `ExecutionRouter` - Route planning
- `APIExecutor`, `BrowserExecutor`, `DesktopExecutor` - Executors

## License

MIT
