# CLI reference

The SDK ships a `centris` CLI (`@centris/sdk` bin).

For complete command/flag coverage, see [CLI command matrix (exhaustive)](./cli-command-matrix.md).

Global options:

- `-v, --verbose`
- `-C, --cwd <path>`

## Project commands

### `centris init <id>`

Initialize a new connector project.

Options:

- `-n, --name <name>`
- `-d, --description <desc>`
- `-l, --language <lang>` default `typescript`
- `-t, --template <template>` default `basic`
- `-y, --yes`

### `centris validate [path]`

Validate connector schema and configuration.

Options:

- `-s, --strict`

### `centris test [path]`

Test connector capabilities.

Options:

- `-c, --capability <id>`
- `-p, --params <json>`
- `-a, --all`
- `-w, --watch`

### `centris serve [path]`

Start local development server.

Options:

- `-p, --port <port>` default `8000`
- `-h, --host <host>` default `localhost`
- `-w, --watch`
- `-o, --open`

Alias: `centris dev`

### `centris publish [path]`

Publish connector to registry.

Options:

- `-r, --registry <url>` default `https://registry.centris.ai`
- `-k, --api-key <key>`
- `--dry-run`
- `-y, --yes`

### `centris do <command...>`

Execute a natural-language command through the API client.

Options:

- `-k, --api-key <key>`
- `-u, --base-url <url>`
- `--api-version <version>`
- `--async`
- `--wait`
- `--json`
- `--timeout-ms <ms>`
- `--poll-interval-ms <ms>`
- `--context <json>`

## Manifest commands

### `centris manifest init <app>`

Create a starter `centris.json` manifest.

Options:

- `-o, --out <path>`
- `-u, --url-pattern <pattern>` repeatable
- `-d, --description <text>`
- `-f, --force`

### `centris manifest validate [file]`

Validate a manifest file.

Options:

- `-s, --strict` require route actions or landmarks

## Route commands

### `centris route record`

Record or update a deterministic route action.

Required options:

- `--app <app>`
- `--action <name>`
- `--description <text>`
- `--url-pattern <pattern>`
- `--route-pattern <pattern>`
- `--steps <json>`

Optional:

- `--params <json>`
- `--checks <json>`
- `--fallback-chains <json>`
- `--confidence <num>`
- `--out <path>`

### `centris route run`

Resolve and run a route action.

Required options:

- `--action <name>`
- `--url <url>`

Optional:

- `--params <json>`
- `--manifest <path>`
- `--playwright`
- `--headful`
- `--slow-mo <ms>`

### `centris route run-runtime`

Run a runtime route through Action API (agent-loop safe).

Options:

- `--route-id <id>` (required)
- `--url <url>`
- `--params <json>`
- `--checks <json>`
- `--artifacts <json>`
- `-k, --api-key <key>`
- `-u, --base-url <url>`
- `--api-version <version>`
- `--timeout-ms <ms>`
- `--json`

### `centris adapter run`

Run an external-system adapter operation with safety enforcement.

Options:

- `--adapter <json>` (required)
- `--operation <name>` (required)
- `--input <json>`
- `--timeout-ms <ms>`
- `--dry-run`
- `--allow-external`
- `--allow-destructive`
- transport options: `--command/--args/--cwd/--env`, `--url/--method/--headers`, `--module/--export-name`
- `--json`

### `centris route test`

Execute route plus verification checks.

Required options:

- `--action <name>`
- `--url <url>`

Optional:

- `--params <json>`
- `--manifest <path>`
- `--playwright`
- `--headful`
- `--slow-mo <ms>`
