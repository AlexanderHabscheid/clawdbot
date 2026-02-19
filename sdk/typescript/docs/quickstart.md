# Installation and quickstart

## Prerequisites

- Node.js `>=22.12.0`
- npm, pnpm, or bun

## Install

```bash
npm install @centris/sdk
```

## Initialize a connector project

```bash
npx centris init my-connector
cd my-connector
npm install
```

Common init options:

- `--name <name>`
- `--description <desc>`
- `--language <typescript|python>`
- `--template <basic|oauth|browser|desktop>`
- `--yes`

## Minimal connector example

```ts
import { Type } from "@centris/sdk";
import type { CentrisConnectorDefinition, CentrisConnectorApi } from "@centris/sdk";

const SendSchema = Type.Object({
  message: Type.String({ minLength: 1 }),
});

export default {
  id: "my-connector",
  name: "My Connector",
  version: "1.0.0",
  description: "Example connector",

  register(api: CentrisConnectorApi) {
    api.registerTool({
      name: "my-connector.send",
      description: "Send a message",
      parameters: SendSchema,
      async execute(_toolCallId, params) {
        return {
          content: [{ type: "text", text: `Sent: ${params.message}` }],
        };
      },
    });
  },
} satisfies CentrisConnectorDefinition;
```

## Validate, test, and serve

```bash
centris validate . --strict
centris test . --all
centris serve . --port 8000 --host localhost
```

## Publish

```bash
centris publish . --registry https://registry.centris.ai
```

Use `--dry-run` to verify packaging before real publish.
