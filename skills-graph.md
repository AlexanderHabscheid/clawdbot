# Centris Skills Graph

This file describes how skills/capabilities are selected and extended.

## Purpose

- Route tasks to the smallest capable skill set.
- Prevent broad, expensive tool exposure by default.
- Make capability growth predictable across SDK, CLI, and API.

## Graph model

Nodes:

- `intent`: user goal class
- `skill`: reusable workflow/unit
- `tool`: executable primitive
- `surface`: `voice`, `cli`, `sdk`, `api`

Edges:

- `intent -> skill` (match score)
- `skill -> tool` (required tooling)
- `tool -> surface` (where it can execute)

## Selection algorithm

1. Classify intent.
2. Pull candidate skills by highest confidence.
3. Filter by policy and safety level.
4. Select minimal covering skill set.
5. Materialize allowed tools only for selected skills.

## Scoring dimensions

- confidence
- safety risk
- token cost
- latency cost
- historical success rate

Recommended weighted objective:

- maximize confidence + success rate
- minimize risk + cost + latency

## Capability classes

- `core`: must be available for all runtimes
- `optional`: loaded per domain/context
- `experimental`: behind flags and explicit opt-in

## How this extends Centris

The graph enables:

- faster routing with fewer tools per turn
- better reliability from deterministic skill selection
- safer execution through policy-aware filtering
- easier onboarding of new capabilities with explicit edges
- consistent behavior across TypeScript SDK, Python SDK, CLI, and API

## New capability onboarding

For each new skill/capability:

1. Define intent mappings.
2. Define required tools and safety class.
3. Define supported surfaces (`cli`, `sdk`, `api`, `voice`).
4. Add evaluation cases (success, fail, ambiguous intent).
5. Add observability tags for rollout metrics.

## Example mapping

- intent: `browser_checkout_flow`
- skill: `checkout-assistant`
- tools: `snapshot`, `click`, `type`, `read_page`
- surfaces: `voice`, `cli`, `sdk`, `api`
- safety: `write`
