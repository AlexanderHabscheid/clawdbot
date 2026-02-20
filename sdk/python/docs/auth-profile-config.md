# Python auth, profile, and config patterns

## Authentication flow

Module: `sdk/python/centris_sdk/cli/auth.py`

Token resolution order:

1. `CENTRIS_API_KEY` env var
2. saved credentials file (`~/.centris/credentials.json`)

Commands:

- `centris-py login` (browser OAuth callback flow)
- `centris-py login --token <token>`
- `centris-py logout`
- `centris-py whoami`

Credential file defaults:

- path: `~/.centris/credentials.json`
- permissions: `0600`

## Profiles

Module: `sdk/python/centris_sdk/cli/profile.py`

Profile resolution:

- default profile: `~/.centris/`
- `--dev`: `~/.centris-dev/`
- `--profile staging`: `~/.centris-staging/`

Environment variables set for active profile:

- `CENTRIS_PROFILE`
- `CENTRIS_STATE_DIR`
- `CENTRIS_CONFIG_DIR`
- `CENTRIS_DEV` (for dev profile)

## Config commands

Use `centris-py config` subcommands for runtime and migration checks:

- `centris-py config show [section]`
- `centris-py config env [--all]`
- `centris-py config validate`
- `centris-py config migrate [--dry-run --force --no-backup]`
- `centris-py config version`
- `centris-py config history --limit <n>`

## Production patterns

- Prefer explicit profile separation for environments:
  - `--profile dev`, `--profile staging`, `--profile prod`
- Keep secrets out of shell history:
  - use `CENTRIS_API_KEY` via env injection, not literal command args
- Run health checks in CI before deployments:
  - `centris-py doctor --json`
  - `centris-py status --json`
- Use migration dry runs before config upgrades:
  - `centris-py config migrate --dry-run`
