# TypeScript CLI command matrix (exhaustive)

Source of truth: `sdk/typescript/src/cli/program.ts`.

## Global options (`centris`)

- `-v, --verbose`
- `-C, --cwd <path>`

## Commands

### `centris init <id>`

- `-n, --name <name>`
- `-d, --description <desc>`
- `-l, --language <lang>` default `typescript`
- `-t, --template <template>` default `basic`
- `-y, --yes`
- alias: `create`

### `centris validate [path]`

- `-s, --strict`

### `centris test [path]`

- `-c, --capability <id>`
- `-p, --params <json>`
- `-a, --all`
- `-w, --watch`

### `centris serve [path]`

- `-p, --port <port>` default `8000`
- `-h, --host <host>` default `localhost`
- `-w, --watch`
- `-o, --open`
- alias: `dev`

### `centris publish [path]`

- `-r, --registry <url>` default `https://registry.centris.ai`
- `-k, --api-key <key>`
- `--dry-run`
- `-y, --yes`

## `centris manifest` group

### `centris manifest init <app>`

- `-o, --out <path>`
- `-u, --url-pattern <pattern>` repeatable
- `-d, --description <text>`
- `-f, --force`

### `centris manifest validate [file]`

- `-s, --strict`

## `centris route` group

### `centris route record`

Required:

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

Required:

- `--action <name>`
- `--url <url>`

Optional:

- `--params <json>`
- `--manifest <path>`
- `--playwright`
- `--headful`
- `--slow-mo <ms>`

### `centris route test`

Required:

- `--action <name>`
- `--url <url>`

Optional:

- `--params <json>`
- `--manifest <path>`
- `--playwright`
- `--headful`
- `--slow-mo <ms>`
