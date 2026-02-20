# Centris Connector Quality Gate

Required checks before enabling or releasing connectors.

## Load policy

Load only when adding/updating connectors or debugging connector failures.

## Required checks

- schema validation for all operations
- timeout defaults and max timeout enforcement
- idempotency behavior documented and tested
- auth failure classification and safe recovery hints
- rollback/compensation behavior for partial side effects
- deterministic output envelope compliance
- safety map completeness for every operation

## Test minimums

- success path
- validation failure
- auth failure
- transient network failure + retry behavior
- non-retryable failure
- partial success path

## Release gate

Connector cannot ship unless all required checks pass.
