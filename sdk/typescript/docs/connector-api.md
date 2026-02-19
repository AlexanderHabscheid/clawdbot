# Connector API

Connector modules register capabilities through `register(api)`.

## Core registration methods

From `CentrisConnectorApi`, connectors can register:

- tools via `api.registerTool(...)`
- gateway methods via `api.registerGatewayMethod(...)`
- CLI commands via `api.registerCli(...)`
- background services via `api.registerService(...)`

The API object also exposes:

- connector identity (`id`, `name`, `version`, `source`)
- global config and connector-specific config
- `logger` (`info`, `warn`, `error`, optional `debug`)
- `resolvePath(input)` for connector-relative file paths

## Tool shape

A connector tool includes:

- `name`
- `description`
- `parameters` schema (`TypeBox`)
- `execute(toolCallId, params, context)` returning a tool result

## Browser bridge contract

For browser-driven capabilities, the context can include `browserBridge` with typed methods:

- navigation: `navigateBrowser`, `getActiveTab`, `getAllTabs`
- interactions by node id: `clickByNodeId`, `typeByNodeId`
- interactions by selector: `clickNode`, `inputTextNode`, `fillForm`, `selectOption`
- keyboard and timing: `typeText`, `pressKey`, `wait`, `waitForSelector`, `waitForNavigation`
- page access: `getPageContent`, `getInteractiveSnapshot`, `scrollPage`, `takeScreenshot`

`InteractiveElement` includes `nodeId`, `name`, `type`, optional `selector`, and optional `role`.

## Config schemas and validation

Use SDK helpers for schema and config workflows:

- `createConfigSchema`
- `validateConnectorConfig`
- `extractConfigUiHints`
- `mergeConfigSchemas`

## Result helpers

SDK tool helpers simplify consistent responses:

- `textResult`
- `jsonResult`
- `imageResult`
- `successResult`
- `errorResult`
