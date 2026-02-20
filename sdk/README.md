# Centris SDK documentation map

SDK docs are organized per language/runtime.

## Quick install and startup

Use the language-specific one-liners below to install both SDKs and their CLIs (`centris` for TypeScript and `centris-py` for Python).

### Python SDK + CLI + API runtime

```bash
pipx install "centris-sdk[all]"
```

Sanity check and run:

```bash
centris-py --version
centris-py doctor
centris-py init demo-py --template browser --url https://example.com
cd demo-py
centris-py validate .
centris-py test .
centris-py serve .
```

### TypeScript SDK + CLI

```bash
npm install -g @centris/sdk
```

Create, build, and run:

```bash
npx centris init demo-ts --language typescript
cd demo-ts
npm install
npm run build
centris validate .
centris test .
centris serve .
```

## TypeScript SDK

- Overview: `sdk/typescript/docs/index.md`
- Quickstart: `sdk/typescript/docs/quickstart.md`
- CLI: `sdk/typescript/docs/cli.md`
- CLI matrix: `sdk/typescript/docs/cli-command-matrix.md`
- Connector API: `sdk/typescript/docs/connector-api.md`
- Execution: `sdk/typescript/docs/execution.md`
- MCP/HTTP API: `sdk/typescript/docs/mcp-http-api.md`
- MCP/HTTP examples: `sdk/typescript/docs/api-endpoints-examples.md`
- Manifest/routes: `sdk/typescript/docs/manifest-routes.md`
- Auth/config patterns: `sdk/typescript/docs/auth-config-patterns.md`
- Errors/troubleshooting: `sdk/typescript/docs/errors-troubleshooting.md`

## Python SDK

- Overview: `sdk/python/docs/index.md`
- Quickstart: `sdk/python/docs/quickstart.md`
- Python client API: `sdk/python/docs/python-client-api.md`
- CLI reference: `sdk/python/docs/cli-reference.md`
- CLI matrix: `sdk/python/docs/cli-command-matrix.md`
- Connector/plugin API: `sdk/python/docs/connector-plugin-api.md`
- Gateway/HTTP API: `sdk/python/docs/gateway-http-api.md`
- API examples: `sdk/python/docs/api-endpoints-examples.md`
- Execution/kernel: `sdk/python/docs/execution-kernel.md`
- Auth/profile/config: `sdk/python/docs/auth-profile-config.md`
- Errors/troubleshooting: `sdk/python/docs/errors-troubleshooting.md`

## Docs maintenance checklist

Use this checklist whenever you change SDK code.

- CLI surface changed:
  - update `sdk/typescript/docs/cli-command-matrix.md` (TS CLI)
  - update `sdk/python/docs/cli-command-matrix.md` (Python CLI)
  - update corresponding CLI reference pages if behavior changed
- API/gateway endpoints changed:
  - update `sdk/typescript/docs/mcp-http-api.md` and `sdk/typescript/docs/api-endpoints-examples.md`
  - update `sdk/python/docs/gateway-http-api.md` and `sdk/python/docs/api-endpoints-examples.md`
- Error codes or exit codes changed:
  - update `sdk/typescript/docs/errors-troubleshooting.md`
  - update `sdk/python/docs/errors-troubleshooting.md`
- Auth/profile/config behavior changed:
  - update `sdk/typescript/docs/auth-config-patterns.md`
  - update `sdk/python/docs/auth-profile-config.md`
- Execution/runtime behavior changed:
  - update `sdk/typescript/docs/execution.md`
  - update `sdk/python/docs/execution-kernel.md`
- New module/page added:
  - link it from `sdk/typescript/docs/index.md` or `sdk/python/docs/index.md`
  - add it to this file (`sdk/README.md`)
- Before shipping:
  - run docs link checks you use in CI/local workflow
  - verify examples still match current request/response shapes in code
