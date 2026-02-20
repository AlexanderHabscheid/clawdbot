# Centris User Intent Patterns

Canonical user phrasing mapped to routing outcomes.

## Load policy

Load only during routing changes, intent debugging, or eval authoring.

## Pattern record

- `pattern_id`
- `example_utterance`
- `normalized_intent`
- `target_domain`: `browser` | `computer` | `file` | `general`
- `expected_operations`
- `ambiguity_flags`
- `disambiguation_prompt`
- `safety_level`

## Ambiguity policy

- if confidence low, ask one focused clarifying question
- prefer lower-risk interpretation when both are plausible
- never escalate to destructive path without explicit confirmation
