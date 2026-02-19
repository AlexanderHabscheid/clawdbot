# Centris Python SDK documentation

This directory documents the Python SDK in a modular way for connector developers and API users.

Start here:

- [Installation and quickstart](./quickstart.md)
- [Python client API](./python-client-api.md)
- [CLI reference](./cli-reference.md)
- [CLI command matrix (exhaustive)](./cli-command-matrix.md)
- [Connector and plugin API](./connector-plugin-api.md)
- [Gateway and HTTP API](./gateway-http-api.md)
- [API endpoint examples](./api-endpoints-examples.md)
- [Execution engine and kernel](./execution-kernel.md)
- [Auth, profile, and config patterns](./auth-profile-config.md)
- [Errors and troubleshooting](./errors-troubleshooting.md)

## Scope

The Python SDK in `sdk/python` includes three major surfaces:

- `centris_sdk.client.Centris`: natural-language execution client (`do`, `wait`, `usage`)
- `centris` CLI: local development, backend control, and power-user commands
- connector framework + gateway runtime: tool registration, execution routing, MCP-compatible serving
