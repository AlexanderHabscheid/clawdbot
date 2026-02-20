# Action Index and Route Memory Spec

This spec defines the concrete payload contract for pre-context execution using:

- `web.memory.index`
- `web.memory.resolve`
- `web.memory.execute`
- `route.run`

The goal is to reuse known UI structure so runtime can execute deterministically before exploratory loops.

## Core objects

### `pageFingerprint`

Compact page identity + drift baseline.

```json
{
  "fingerprintId": "billing-v3-main",
  "urlPattern": "https://app.example.com/settings/billing*",
  "titleHints": ["Billing", "Invoices"],
  "headings": ["Billing", "Invoices"],
  "navLabels": ["Settings", "Billing", "Payment methods"],
  "primaryActions": ["Download invoice", "Update card"],
  "landmarks": [
    { "role": "sidebar", "region": "nav", "selectors": ["nav[aria-label='Settings']"] },
    { "role": "invoice_table", "region": "main", "selectors": ["table[data-testid='invoices']"] }
  ],
  "interactiveSummary": { "total": 42, "buttons": 8, "links": 11, "inputs": 4, "forms": 1 },
  "signatureHash": "sha256:7e84...",
  "generatedAt": "2026-02-20T12:00:00.000Z",
  "confidence": 0.93
}
```

### `actionIndex[]`

Semantic action map, not raw DOM dump.

```json
[
  {
    "actionId": "open_invoices",
    "intent": "open invoices",
    "affordance": "click",
    "semanticLabel": "Invoices",
    "region": "nav",
    "nodeHints": [{ "selector": "a[href='/settings/billing/invoices']", "role": "link" }],
    "anchors": [
      { "anchorType": "label", "value": "Invoices", "weight": 1.0 },
      { "anchorType": "test_id", "value": "settings-invoices-link", "weight": 0.95 },
      { "anchorType": "business_id", "value": "open_invoices", "weight": 0.9 },
      { "anchorType": "near_text", "value": "Billing", "weight": 0.6 }
    ],
    "successChecks": [{ "type": "url_contains", "value": "/settings/billing/invoices" }],
    "fallbackActionIds": ["open_billing"],
    "confidence": 0.9
  }
]
```

### `routeMemory`

Deterministic route for a user intent.

```json
{
  "routeId": "download_latest_invoice",
  "intent": "download latest invoice",
  "site": "app.example.com",
  "pageFingerprintId": "billing-v3-main",
  "steps": [
    {
      "stepId": "s1",
      "actionId": "open_invoices",
      "operation": "click",
      "successChecks": [{ "type": "url_contains", "value": "/invoices" }]
    },
    {
      "stepId": "s2",
      "actionId": "download_latest_pdf",
      "operation": "click",
      "successChecks": [{ "type": "download", "value": "invoice" }]
    }
  ],
  "fallbackRouteIds": ["download_any_invoice"],
  "confidence": 0.87,
  "version": "1",
  "updatedAt": "2026-02-20T12:00:00.000Z"
}
```

## API flow

1. Index (write memory):

```json
{
  "method": "web.memory.index",
  "params": {
    "url": "https://app.example.com/settings/billing",
    "intent": "download latest invoice",
    "pageFingerprint": {},
    "actionIndex": [],
    "routeMemory": {},
    "ttlMs": 2592000000
  }
}
```

2. Resolve (lookup memory):

```json
{
  "method": "web.memory.resolve",
  "params": {
    "url": "https://app.example.com/settings/billing",
    "intent": "download latest invoice",
    "maxAgeMs": 604800000
  }
}
```

3. Execute (reuse memory):

```json
{
  "method": "web.memory.execute",
  "params": {
    "url": "https://app.example.com/settings/billing",
    "intent": "download latest invoice",
    "routeId": "download_latest_invoice",
    "pageFingerprintId": "billing-v3-main"
  }
}
```

4. Route run fallback:

```json
{
  "method": "route.run",
  "params": {
    "routeId": "download_latest_invoice",
    "pageFingerprint": {},
    "actionIndex": [],
    "routeMemory": {}
  }
}
```

## Execution policy

- Prefer `web.memory.execute` when confidence is high.
- For each route-memory step, execute a target chain in priority order:
  - nodeId hints (fast path)
  - explicit selectors
  - `test_id` and `business_id` anchor-derived selectors
- Fall back to live observe/act/verify on miss or drift.
- On successful live fallback, re-index with updated fingerprint/action anchors.
- Keep payloads semantic-first (`intent`, `anchors`, `checks`) rather than node-id-first.
