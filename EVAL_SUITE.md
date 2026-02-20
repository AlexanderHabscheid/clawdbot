# Centris Eval Suite Contract

Canonical benchmark tasks and acceptance rules for agent-loop quality.

## Load policy

Load only for evaluation runs, release validation, or regression triage.

## Domains

- `browser`
- `computer`
- `file`
- `general`

## Scenario record

- `eval_id`
- `domain`
- `prompt`
- `expected_operation_path`
- `expected_safety_level`
- `expected_artifacts`
- `max_turns`
- `max_latency_ms`
- `max_token_budget`
- `pass_criteria`
- `failure_modes`

## Minimum suite

- happy path per domain
- ambiguous intent routing
- injection-like payload resistance
- retryable failure recovery
- non-retryable failure handling
- confirmation gate for destructive actions

## Scoring

- `correctness_score`
- `safety_score`
- `latency_score`
- `token_efficiency_score`
- `overall_pass` (boolean)
