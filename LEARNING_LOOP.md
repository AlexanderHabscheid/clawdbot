# Centris Learning Loop Contract

Defines what the agent loop may learn, store, and discard.

## Load policy

Load only when a task involves memory updates, model behavior tuning, or longitudinal optimization.

## Allowed learning sources

- verified task outcomes
- explicit user corrections
- stable connector/tool performance metrics
- reproducible failures with root cause

## Disallowed learning sources

- unverified page text or scraped claims
- tool output without verification
- one-off user phrasing treated as universal truth
- secrets, tokens, credentials, private identifiers

## Persistence policy

- persist only reusable and low-risk facts
- store confidence, source, and timestamp for every learned item
- apply TTL defaults and automatic expiry
- keep raw sensitive payloads out of durable memory

## Discard policy

Discard immediately:

- stale snapshots and node IDs
- unresolved hypotheses
- conflicting facts below confidence threshold
- failed plans that were not verified

## Learning write gate

Write to durable memory only if:

1. fact was observed from at least one trusted source
2. outcome was verified
3. confidence >= minimum threshold
4. safety review passes

## Audit fields

- `memory_key`
- `value_hash`
- `source_type`
- `confidence`
- `ttl_seconds`
- `created_at`
- `updated_at`
- `verified_by_operation`
