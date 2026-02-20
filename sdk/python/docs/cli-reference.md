# CLI reference

The Python package exposes the `centris-py` CLI via:

- `pyproject.toml`: `centris-py = "centris_sdk.cli:main"`

For a full flag-by-flag map, see [CLI command matrix (exhaustive)](./cli-command-matrix.md).

## Global options

From `sdk/python/centris_sdk/cli/main.py`:

- `--verbose`, `-v`
- `--quiet`, `-q`
- `--json`
- `--non-interactive`, `-n`
- `--dev`
- `--profile <name>`

## Top-level command groups

Development:

- `init`
- `validate`
- `test`
- `serve`
- `refine`
- `skills`

Publishing and packaging:

- `publish`
- `package`

Discovery and installation:

- `list`
- `search`
- `install`
- `update`

Auth:

- `login`
- `logout`
- `whoami`

Backend management (registered via `register_backend_commands`):

- `run`, `start`, `stop`, `doctor`, `status`, `config`, `onboard`

Power-user commands:

- `agent`
- `do`
- `exec`
- `browser`
- `file`
- `daemon`
- `sandbox`
- `elements`
- `introspect`
- `deprecations`

## Important command behaviors

### `centris-py do`

- calls `POST /api/v1/do`
- supports `--async` with polling `GET /api/v1/task/{task_id}`
- falls back to local execution when backend is unavailable

### `centris-py agent`

- default backend URL: `http://127.0.0.1:5001`
- streaming mode by default
- supports session reuse with `--session`

### `centris-py browser` and `centris-py file`

These provide direct tool-like controls from CLI (navigation/snapshot/click/type and file operations).

## Recommendation

For exact flags and subcommands, use built-in help:

```bash
centris-py --help
centris-py <command> --help
```
