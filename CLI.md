# Centris CLI System Contract

This file defines the execution contract for all Centris CLI surfaces.

## Control doc loading for CLI loops

CLI runtimes must use selective control-doc loading:

- always load: `CLI.md`, `AGENT.md`, `GUARDRAILS.md`
- load on demand: `ERROR_TAXONOMY.md`, `SAFETY_POLICY.md`, `MEMORY_SCHEMA.md`, `LEARNING_LOOP.md`, `CONNECTOR_QUALITY_GATE.md`

Do not preload non-required docs for every command.

## Scope

- `centris` (TypeScript SDK CLI)
- `centris-py` (Python SDK CLI)
- Future Centris app/operator CLIs
- External systems exposed through Centris adapters

## Codebase baseline (already present)

Implemented today in this repository:

- Two SDK CLIs: TypeScript (`sdk/typescript/src/cli/*`) and Python (`sdk/python/centris_sdk/cli/*`)
- Gateway seam with tool discovery/execution (`sdk/typescript/src/gateway/*`, `sdk/typescript/src/loader/*`)
- Action API seam for deterministic runtime flows (`observe`, `act`, `verify`, `route.*`)
- Connector registry with tool + CLI extension points (`sdk/typescript/src/loader/registry.ts`)

This contract extends those systems without replacing them.

## Contract goals

- Keep command behavior deterministic across CLIs.
- Keep safety and side effects explicit for agentic execution.
- Keep SDK, CLI, and API behavior aligned.
- Make Centris the adapter layer for systems that do not have an AI-native CLI.

## Shared command model

Every command should map to this model:

- `intent`: what the user asked for
- `operation`: normalized action name (for example `connector.validate`)
- `input`: typed parameters
- `execution_mode`: `sync` or `async`
- `safety_level`: `read`, `write`, `external`, `destructive`
- `result`: structured response envelope

## Result envelope

All CLIs and adapters should support a structured output mode with equivalent fields:

```json
{
  "ok": true,
  "operation": "connector.validate",
  "summary": "Validated 4 capabilities",
  "data": {},
  "warnings": [],
  "errors": [],
  "meta": {
    "duration_ms": 132,
    "request_id": "req_123",
    "profile": "default",
    "connector_id": "acme-crm",
    "system": "salesforce",
    "system_version": "v62"
  }
}
```

## Safety and approvals

Command families must declare a default side-effect class:

- `read`: status, inspect, list, search, logs
- `write`: init, config set, route record, save
- `external`: publish, login, remote API calls
- `destructive`: delete, reset, force-prune

Rules:

- `destructive` commands require explicit confirmation unless `--yes` is supplied.
- `external` commands require explicit network target and timeout controls.
- `write` and `destructive` commands should support `--dry-run` when feasible.

## Exit code policy

- `0`: success
- `2`: validation/input error
- `3`: auth or permission error
- `4`: network/backend unavailable
- `5`: execution/runtime failure
- `6`: partial success with warnings

## SDK CLI and API parity

Each feature should have parity targets:

- SDK API call (TypeScript/Python)
- CLI command
- HTTP endpoint (if remotely callable)

Minimum parity fields:

- action name
- input schema
- output schema
- error classes
- idempotency behavior

## Agentic-loop affordances

To work reliably inside an agent loop, commands should expose:

- `--json` or equivalent machine-readable output
- stable operation identifiers (`operation`)
- deterministic error codes
- consistent retry hints for transient failures
- optional `--timeout-ms` for bounded tool execution

## External system adapter contract (new)

Centris should support systems with no native AI CLI by defining adapter connectors that normalize their interfaces.

Adapter minimum spec:

- `adapter_id`: stable adapter identifier (for example `salesforce-cli`)
- `system`: upstream system name
- `operations`: list of normalized operations this adapter implements
- `transport`: `subprocess`, `http`, `sdk`, or `hybrid`
- `auth_mode`: `env`, `oauth`, `api_key`, `session`
- `timeouts`: default and max timeout policy
- `safety_map`: operation -> safety level mapping
- `schema_map`: operation -> input/output JSON schema

Adapter execution guarantees:

- normalize upstream output into Centris result envelope
- map upstream errors to Centris exit/error classes
- provide deterministic `operation` names even if upstream command names vary
- emit `meta.system` and `meta.connector_id` for tracing

## Cross-system composition contract (new)

To let systems talk to each other safely, each execution step should emit portable artifacts.

Artifact envelope:

```json
{
  "artifact_type": "record.ref",
  "schema": "centris/artifact/record-ref@v1",
  "producer_operation": "crm.contact.lookup",
  "value": {
    "system": "salesforce",
    "entity": "contact",
    "id": "003...",
    "display": "Ada Lovelace"
  }
}
```

Composition rules:

- commands may emit zero or more artifacts
- downstream commands consume artifacts by schema, not by free-form text
- adapter boundaries must preserve artifact schema/version fields
- unresolved artifacts return partial success (`exit code 6`) with retry hints

## Capability extension points

A new capability should define:

- operation name
- CLI command shape
- SDK function signature
- API route and schema
- safety level
- test coverage targets (unit + integration)

If any one of these is missing, the capability is incomplete.

## Validation checklist for new command families

- Added in TypeScript CLI matrix
- Added in Python CLI matrix
- Added in SDK docs/examples
- Added in API docs if network-backed
- Added tests for success, validation failure, and auth/network failure

## Validation checklist for new adapters (new)

- Declares adapter spec (`adapter_id`, operations, transport, auth, schema map)
- Provides operation-level safety map
- Converts upstream outputs to Centris result envelope
- Converts upstream failures to Centris error/exit classes
- Emits portable artifacts for cross-system handoff where applicable
- Includes at least one cross-system integration test
