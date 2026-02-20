# Centris Postmortem Template

Use this template for any loop or tool failure that impacted correctness, safety, latency, or user trust.

## Load policy

Load only when incident triage, RCA, or prevention planning is active.

## Incident summary

- `incident_id`:
- `date_utc`:
- `owner`:
- `surface`: `voice` | `cli` | `sdk` | `api`
- `severity`: `sev1` | `sev2` | `sev3`

## Trigger

What event started the failure?

## User impact

What users experienced and how long it lasted.

## Detection

- detection source
- time to detect
- why existing checks missed or delayed detection

## Root cause

Primary technical cause with file/component references.

## Contributing factors

List secondary causes that amplified impact.

## Containment and fix

- immediate mitigation
- permanent fix
- rollout strategy

## Regression tests

- test added/updated
- exact scenario covered
- expected pass criteria

## Prevention rule

New guardrail, policy, or contract update that prevents recurrence.

## Follow-up actions

1. owner + due date + action
2. owner + due date + action
