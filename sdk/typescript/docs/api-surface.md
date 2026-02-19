# TypeScript SDK API surface

This page documents the exported API surface of `@centris/sdk` from `sdk/typescript/src/index.ts`.

## Main exports

From `@centris/sdk` root entry:

- schema utilities and primitives (`Type`, `validate`, `stringEnum`, typed primitives)
- plugin types and API factory (`CentrisConnectorApi`, `CentrisTool`, `createConnectorApi`)
- config normalization helpers
- connector discovery/registry/loader helpers
- connector config validation helpers
- tool utilities (`textResult`, `jsonResult`, `errorResult`, retries, action gate)
- gateway runtime (`CentrisMCPGateway`, `MCPServer`)
- execution runtime (`ExecutionEngine`, `ExecutionRouter`, executors)
- action kernel exports
- API client (`Centris`, `do`, typed result/errors, API version helpers)
- CLI exports (`createCLI`, `runCLI`, command functions)

## Package subpath exports

From `sdk/typescript/package.json`:

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
- `@centris/sdk/client`
- `@centris/sdk/cli`

## Runtime requirements

- Node.js `>=22.12.0`
- ESM module usage (`"type": "module"`)

## CLI binary

The npm package installs:

- `centris` -> `./dist/cli/bin.js`

Use `centris --help` to inspect generated command help from `sdk/typescript/src/cli/program.ts`.
