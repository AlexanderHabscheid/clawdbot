# Connector and plugin API

This page documents the Python connector API surface in:

- `centris_sdk.plugin_api`
- `centris_sdk.connector`
- `centris_sdk.types`

## Connector patterns

The SDK supports decorator-style and plugin-style connector patterns.

The plugin API exports include:

- `CentrisPluginConnector`
- `CentrisConnectorApi`
- `CentrisTool`
- `ToolContext`
- `ConnectorService`
- result helpers: `text_result`, `json_result`, `error_result`, `image_result`

## Browser bridge contract

`BrowserBridge` is an abstract interface for safe automation primitives.

Main methods:

- navigation: `navigate_browser`, `get_active_tab`, `get_all_tabs`
- DOM interaction: `click_node`, `input_text_node`, `type_text`, `press_key`, `fill_form`, `select_option`
- waiting: `wait`, `wait_for_selector`, `wait_for_navigation`
- content: `get_page_content`, `get_interactive_snapshot`, `scroll_page`
- screenshots: `take_screenshot`

## Security model

The plugin API explicitly constrains connector runtime access. Connectors do not receive direct access to internal system credentials or unrestricted host controls.

## Validation and typing

Use SDK types and validation helpers for capability input schemas and runtime checks:

- `ExecutionMethod`
- `AuthScheme`
- `validate_params`
- `ValidationError`
