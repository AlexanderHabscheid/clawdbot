# Centris SDK

The Centris SDK is the developer system for extending Centris with connectors.

Use it to:

- define typed connector tools
- run deterministic browser and desktop actions
- expose connectors through MCP-compatible endpoints
- ship connector-specific CLI commands and background services

If you are building integrations that make Centris faster, safer, and more capable for end users, this is the entry point.

## What the system includes

- [Installation and quickstart](./quickstart.md)
- [CLI reference](./cli.md)
- [CLI command matrix (exhaustive)](./cli-command-matrix.md)
- [Connector API](./connector-api.md)
- [Execution engine](./execution.md)
- [MCP and HTTP API](./mcp-http-api.md)
- [MCP/HTTP endpoint examples](./api-endpoints-examples.md)
- [Manifest and routes](./manifest-routes.md)
- [TypeScript API surface](./api-surface.md)
- [Auth and config patterns](./auth-config-patterns.md)
- [Errors and troubleshooting](./errors-troubleshooting.md)

## How connectors help Centris

Centris users should be able to speak and get results with minimal friction. Connectors support that by providing:

- app-specific capabilities with explicit schemas
- deterministic action flows for repeated tasks
- lower latency by reducing exploratory model loops
- reusable integrations that can be loaded by the gateway

## Architecture map

At a high level, the SDK is split into modules:

- `plugin`: connector definitions, tool registration, services, browser bridge types
- `cli`: project scaffolding, validation, local serving, publish and route tooling
- `execution`: method routing and fallback across `api`, `desktop`, `browser`
- `gateway`: connector aggregation plus MCP-compatible server endpoints
- `manifest` and `kernel`: deterministic route contracts and checks

## Runtime requirements

From `@centris/sdk` package metadata:

- Node.js `>=22.12.0`
- ESM package usage

## Package entry points

The SDK exports multiple subpaths:

- `@centris/sdk`
- `@centris/sdk/schema`
- `@centris/sdk/plugin`
- `@centris/sdk/loader`
- `@centris/sdk/tools`
- `@centris/sdk/validation`
- `@centris/sdk/config`
- `@centris/sdk/gateway`
- `@centris/sdk/execution`
- `@centris/sdk/kernel`
- `@centris/sdk/cli`
