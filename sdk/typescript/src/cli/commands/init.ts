/**
 * @centris/sdk - CLI Init Command
 *
 * Initialize a new connector project from templates.
 */

import fs from "node:fs";
import path from "node:path";
import type { InitOptions, CLIContext } from "../types.js";

// =============================================================================
// Templates
// =============================================================================

const TYPESCRIPT_TEMPLATE = `/**
 * {{name}} Connector
 *
 * {{description}}
 */

import { Type } from "@sinclair/typebox";
import type { CentrisConnectorDefinition, CentrisConnectorApi, CentrisTool } from "@centris/sdk";

// Define input schemas using TypeBox
const {{capabilityName}}InputSchema = Type.Object({
  // Add your input parameters here
  message: Type.String({ description: "Input message" }),
});

// Export the connector definition
export const connector: CentrisConnectorDefinition = {
  id: "{{id}}",
  name: "{{name}}",
  description: "{{description}}",
  version: "1.0.0",

  register(api: CentrisConnectorApi) {
    // Register your tools
    api.registerTool({
      name: "{{id}}.example",
      description: "Example capability",
      parameters: {{capabilityName}}InputSchema,
      async execute(toolCallId, params, context) {
        api.logger.info(\`Executing example with: \${JSON.stringify(params)}\`);
        
        // Your implementation here
        return {
          content: [{ type: "text", text: \`Processed: \${params.message}\` }],
        };
      },
    });

    api.logger.info(\`{{name}} connector registered\`);
  },
};

export default connector;
`;

const PYTHON_TEMPLATE = `"""
{{name}} Connector

{{description}}
"""

from centris_sdk import (
    CentrisConnector,
    ExecutionMethod,
    AuthScheme,
)

# Initialize the connector
connector = CentrisConnector(
    connector_id="{{id}}",
    name="{{name}}",
    description="{{description}}",
    version="1.0.0",
    auth_schemes=[AuthScheme.NONE],
)


@connector.capability(
    id="example",
    name="Example",
    description="Example capability",
    input_schema={
        "type": "object",
        "properties": {
            "message": {
                "type": "string",
                "description": "Input message",
            },
        },
        "required": ["message"],
    },
    examples=["Process a message"],
    tags=["example"],
)
async def example(params: dict, context: dict) -> dict:
    """Example capability implementation."""
    return {
        "success": True,
        "result": f"Processed: {params['message']}",
    }


# Run the connector
if __name__ == "__main__":
    import asyncio
    asyncio.run(connector.serve(port=8000))
`;

const PACKAGE_JSON_TEMPLATE = `{
  "name": "@centris/connector-{{id}}",
  "version": "1.0.0",
  "description": "{{description}}",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "keywords": ["centris", "centris-connector", "{{id}}"],
  "centrisConnector": {
    "id": "{{id}}",
    "categories": []
  },
  "scripts": {
    "build": "tsc",
    "dev": "centris serve",
    "test": "centris test",
    "prepublishOnly": "npm run build"
  },
  "dependencies": {
    "@centris/sdk": "^1.0.0",
    "@sinclair/typebox": "^0.32.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0"
  }
}
`;

const TSCONFIG_TEMPLATE = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
`;

const PYPROJECT_TEMPLATE = `[project]
name = "centris-connector-{{id}}"
version = "1.0.0"
description = "{{description}}"
requires-python = ">=3.10"
dependencies = [
    "centris-sdk>=1.0.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.0.0",
    "pytest-asyncio>=0.21.0",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
`;

const README_TEMPLATE = `# {{name}}

{{description}}

## Installation

\`\`\`bash
npm install @centris/connector-{{id}}
\`\`\`

## Usage

This connector provides the following capabilities:

- **example**: Example capability

## Development

\`\`\`bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm run test

# Build for production
npm run build
\`\`\`

## Publishing

\`\`\`bash
centris publish
\`\`\`

## License

MIT
`;

// =============================================================================
// Init Command
// =============================================================================

function fillTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }
  return result;
}

function toPascalCase(str: string): string {
  return str
    .split(/[-_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");
}

export async function initConnector(options: InitOptions, ctx: CLIContext): Promise<void> {
  const { logger } = ctx;
  const {
    id,
    name = toPascalCase(id),
    description = `${name} connector for Centris`,
    language = "typescript",
    // template is available for future use with different project templates
  } = options;

  const projectDir = path.join(ctx.cwd, id);

  logger.info(`Creating ${language} connector: ${id}`);

  // Check if directory exists
  if (fs.existsSync(projectDir)) {
    logger.error(`Directory already exists: ${projectDir}`);
    process.exit(1);
  }

  // Create directory structure
  fs.mkdirSync(projectDir, { recursive: true });

  const vars = {
    id,
    name,
    description,
    capabilityName: toPascalCase(id),
  };

  if (language === "typescript") {
    // Create TypeScript project
    const srcDir = path.join(projectDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });

    // Write files
    fs.writeFileSync(path.join(srcDir, "index.ts"), fillTemplate(TYPESCRIPT_TEMPLATE, vars));
    fs.writeFileSync(
      path.join(projectDir, "package.json"),
      fillTemplate(PACKAGE_JSON_TEMPLATE, vars),
    );
    fs.writeFileSync(path.join(projectDir, "tsconfig.json"), TSCONFIG_TEMPLATE);
    fs.writeFileSync(path.join(projectDir, "README.md"), fillTemplate(README_TEMPLATE, vars));

    logger.success(`Created TypeScript connector at ${projectDir}`);
    logger.info("");
    logger.info("Next steps:");
    logger.info(`  cd ${id}`);
    logger.info("  npm install");
    logger.info("  npm run dev");
  } else {
    // Create Python project
    fs.writeFileSync(path.join(projectDir, "connector.py"), fillTemplate(PYTHON_TEMPLATE, vars));
    fs.writeFileSync(
      path.join(projectDir, "pyproject.toml"),
      fillTemplate(PYPROJECT_TEMPLATE, vars),
    );
    fs.writeFileSync(path.join(projectDir, "README.md"), fillTemplate(README_TEMPLATE, vars));

    logger.success(`Created Python connector at ${projectDir}`);
    logger.info("");
    logger.info("Next steps:");
    logger.info(`  cd ${id}`);
    logger.info("  pip install -e .");
    logger.info("  python connector.py");
  }
}
