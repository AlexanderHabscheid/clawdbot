# Python CLI command matrix (exhaustive)

Source of truth: `sdk/python/centris_sdk/cli/*`.

## Global options (`centris-py`)

- `--verbose`, `-v`: enable verbose output
- `--quiet`, `-q`: suppress non-essential output
- `--json`: JSON output mode
- `--non-interactive`, `-n`: no prompts
- `--dev`: use `dev` profile (`~/.centris-dev/`)
- `--profile <name>`: use named profile (`~/.centris-<name>/`)
- `--no-banner`: suppress banner (hidden)

## Core top-level commands

- Development: `init`, `validate`, `test`, `serve`, `refine`, `skills`
- Publish/package: `publish`, `package`
- Discovery/install: `list`, `search`, `install`, `update`
- Auth: `login`, `logout`, `whoami`
- Backend management: `run`, `start`, `stop`, `doctor`, `status`, `config`, `onboard`
- Power user: `agent`, `do`, `exec`, `browser`, `file`, `daemon`, `sandbox`, `elements`, `introspect`, `deprecations`

## `centris-py browser` group

Group option:

- `--backend-url` (hidden), default `http://127.0.0.1:5001`

Subcommands:

- `navigate <url>`
  - `--wait, -w <seconds>` default `2.0`
  - `--json`
- `snapshot`
  - `--format <tree|json|summary>` default `summary`
  - `--json`
- `click`
  - `--node-id, -n <id>`
  - `--selector, -s <css>`
  - `--text, -t <text>`
  - `--json`
- `type <text>`
  - `--json`
- `key <key>`
  - `--json`
- `content`
  - `--json`
- `search <query>`
  - `--json`
- `screenshot`
  - `--output, -o <path>`
  - `--json`

## `centris-py file` group

Subcommands:

- `read <path>`
  - `--limit, -n <lines>`
  - `--json`
- `write <path> [content]`
  - `--append, -a`
  - `--stdin`
  - `--json`
- `list [path]`
  - `--recursive, -r`
  - `--pattern, -p <glob>`
  - `--hidden, -a`
  - `--json`
- `search <query>`
  - `--path, -p <path>` default `.`
  - `--pattern, -g <glob>`
  - `--max, -m <n>` default `100`
  - `--json`
- `delete <path>`
  - `--force, -f`
  - `--recursive, -r`
  - `--json`

## `centris-py daemon` group

Subcommands:

- `install`
  - `--port, -p <port>` default `5001`
  - `--start`
  - `--json`
- `start`
  - `--json`
- `stop`
  - `--json`
- `status`
  - `--json`
- `logs`
  - `--follow, -f`
  - `--lines, -n <n>` default `50`
  - `--error`
- `uninstall`
  - `--force, -f`
  - `--json`

## `centris-py sandbox` group

Subcommands:

- `status`
  - `--json`
- `list`
  - `--json`
- `prune`
  - `--max-idle <hours>` default `24`
  - `--force, -f`
  - `--json`
- `shell <container_id>`
- `logs <container_id>`
  - `--follow, -f`
  - `--tail, -n <n>` default `100`
- `exec <container_id> <command>`
  - `--json`

## `centris-py elements` group

Subcommands:

- `capture <url>`
  - `--output, -o <path>`
  - `--sdk`
  - `--wait, -w <seconds>` default `3.0`
  - `--pretty/--compact` default `pretty`
- `export`
  - `--output, -o <path>`
  - `--sdk`
  - `--pretty/--compact` default `pretty`
- `list`
  - `--type, -t <all|clickable|typeable|selectable>` default `all`
- `generate <connector_id>`
  - `--url, -u <url>`
  - `--wait, -w <seconds>` default `3.0`
  - `--output, -o <dir>`

## Backend commands (top-level)

- `run`
  - `--port, -p <port>`
  - `--host, -h <host>`
  - `--debug/--no-debug`
  - `--reload/--no-reload`
  - `--no-audio`
  - `--no-banner`
- `start`
  - `--port, -p <port>`
  - `--host, -h <host>`
  - `--debug/--no-debug`
  - `--reload/--no-reload`
  - `--no-audio`
  - `--no-banner`
- `stop`
  - `--host, -h <host>` default `127.0.0.1`
  - `--port, -p <port>` default `5001`
  - `--force, -f`
  - `--json`
- `status`
  - `--host, -h <host>` default `127.0.0.1`
  - `--port, -p <port>` default `5001`
  - `--watch, -w`
  - `--json`
  - `--full, -f`
- `doctor`
  - `--fix`
  - `--json`
  - `--category, -c <name>` (repeatable)
  - `--verbose, -v`
- `onboard`
  - `--skip-keys`
  - `--skip-extension`

## `centris-py config` subgroup

Subcommands:

- `config show [section]`
  - `--json`
- `config env`
  - `--all`
  - `--json`
- `config validate`
  - `--json`
- `config migrate`
  - `--dry-run`
  - `--force`
  - `--no-backup`
  - `--json`
- `config version`
  - `--json`
- `config history`
  - `--json`
  - `--limit <n>` default `10`
