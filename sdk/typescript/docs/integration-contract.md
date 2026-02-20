# External Integration Contract

This contract defines the minimum integration surface for companies plugging their systems into Centris without full source-code exposure.

## Goals

- minimize per-site hand-mapping work
- reduce context/token usage by shipping semantic UI anchors
- keep fallback behavior deterministic when UI drift occurs

## Minimal package shape

Integration should require:

1. one install step
2. one config file
3. one endpoint or event stream

## 1) Install step

Install the lightweight bridge package in the target web app/runtime. The package should emit semantic action metadata, not full DOM dumps.

## 2) Config file

Recommended config fields:

```json
{
  "appId": "acme-billing",
  "version": "1",
  "emit": {
    "testIds": true,
    "businessActionIds": true,
    "landmarks": true
  },
  "privacy": {
    "redactInputValues": true,
    "allowTextHints": true
  }
}
```

## 3) Endpoint or event schema

Emit compact semantic action index entries consumable by `web.memory.index`:

```json
{
  "url": "https://app.example.com/settings/billing",
  "pageFingerprint": {
    "fingerprintId": "billing-main-v4",
    "urlPattern": "https://app.example.com/settings/billing*",
    "confidence": 0.9
  },
  "actionIndex": [
    {
      "actionId": "open_invoices",
      "intent": "open invoices",
      "affordance": "click",
      "anchors": [
        { "anchorType": "test_id", "value": "settings-invoices-link", "weight": 0.95 },
        { "anchorType": "business_id", "value": "open_invoices", "weight": 0.9 },
        { "anchorType": "selector", "value": "a[href='/settings/billing/invoices']", "weight": 0.8 }
      ],
      "confidence": 0.9
    }
  ]
}
```

## Drift fallback policy

When route memory executes a step:

1. attempt nodeId hints first
2. retry explicit selectors
3. retry selectors derived from `test_id`
4. retry selectors derived from `business_id`
5. if all fail, fall back to manifest/live action path

This keeps fast paths fast while preventing stale-node hard failures.

## Source access model

Source-code access is optional quality mode:

- baseline mode: browser/runtime integration only
- quality mode: source instrumentation adds stronger anchors and faster recovery

The runtime contract must work in both modes.
