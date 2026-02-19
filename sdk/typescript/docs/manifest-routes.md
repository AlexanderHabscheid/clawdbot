# Manifest and routes

The SDK supports deterministic browser automation through manifests and route commands.

## Centris manifest model

`CentrisManifest` contains:

- `centris` spec version string
- `app` identifier
- `description` (optional)
- `url_patterns`
- `routes`

Each route can define:

- `landmarks`: named page regions with selector arrays and stability hints
- `actions`: reusable action recipes with step lists and success checks

## Action steps

Manifest actions support these step types:

- `navigate`
- `click`
- `type`
- `press`
- `wait`
- `scroll`

Optional success checks include:

- `url_contains`
- `text_present`
- `element_visible`
- `download`
- `network_url_contains`

## Action kernel contract

The kernel spec version is exported as:

- `ACTION_KERNEL_SPEC_VERSION = "2026-02-19"`

Core kernel operations:

- `observe`
- `act`
- `verify`
- `route`
- `learn`

## Route workflow with CLI

1. `centris manifest init <app>` to create starter manifest
2. `centris route record ...` to add deterministic action recipes
3. `centris route run ...` to execute a route
4. `centris route test ...` to run and verify checks

This path is useful when you want repeatable, low-variance automation instead of purely exploratory interaction loops.
