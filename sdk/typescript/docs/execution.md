# Execution engine

The execution layer plans and executes capabilities across three methods:

- `api`
- `desktop`
- `browser`

## Router behavior

`ExecutionRouter` picks a primary method and fallbacks based on:

- available methods for the capability
- user preference (`preferredMethod`)
- auth availability (`accessToken` or `apiKey`)
- method allow flags (`allowBrowserAutomation`, `allowDesktopAutomation`)

Default priority is `api > desktop > browser`, but API priority drops when API credentials are missing.

## Engine behavior

`ExecutionEngine` handles:

- execution planning (`planExecution`)
- confirmation hooks for sensitive actions
- retries (default `2`) with exponential backoff
- timeout handling (default `30000` ms)
- fallback methods when the primary method fails

## Execution options

Key options:

- `preferences.preferredMethod`
- `preferences.allowBrowserAutomation`
- `preferences.allowDesktopAutomation`
- `auth.accessToken` / `auth.apiKey`
- `timeout`
- `retries`

## Result model

Executors return a typed union:

- success: `{ ok: true, data, metadata }`
- failure: `{ ok: false, error, metadata }`

Error details include:

- `code`
- `message`
- optional `details`
- `retryable`

Metadata includes:

- `executionMethod`
- `latencyMs`
- optional `retryCount`
