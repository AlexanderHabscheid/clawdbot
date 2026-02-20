# Centris Memory Schema

Defines durable memory and session memory structures.

## Load policy

Load only when reading/writing memory or resolving memory conflicts.

## Session memory (ephemeral)

Use for in-task operational context.

Fields:

- `session_id`
- `key`
- `value`
- `source`
- `confidence`
- `created_at`
- `expires_at`

Defaults:

- short TTL
- auto-prune stale browser/computer snapshots

## Durable memory (persistent)

Use for reusable high-confidence facts only.

Fields:

- `memory_id`
- `namespace`
- `key`
- `value`
- `source_type`
- `source_ref`
- `confidence`
- `sensitivity`
- `created_at`
- `updated_at`
- `ttl_seconds`
- `version`

## Conflict handling

- prefer higher confidence from trusted source
- if tie, prefer newer verified value
- if unresolved, mark conflict and do not auto-apply

## Safety constraints

- never persist secrets
- never persist raw untrusted prompt payloads
- always attach source and confidence metadata
