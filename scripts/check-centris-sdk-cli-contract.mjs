#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createServer } from "node:http";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseJsonFromStdout(stdout, label) {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error(`${label} did not emit JSON output`);
  }
  const raw = stdout.slice(start, end + 1);
  return JSON.parse(raw);
}

async function main() {
  const expectedKey = "ck_contract_test";
  const expectedCommand = "contract-cli-check";

  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (req.method === "POST" && url === "/api/v1/do") {
      let body = "";
      req.on("data", (chunk) => {
        body += String(chunk);
      });
      req.on("end", () => {
        const apiKey = String(req.headers["x-centris-key"] ?? "");
        if (apiKey !== expectedKey) {
          res.writeHead(401, { "content-type": "application/json" });
          res.end(JSON.stringify({ status: "failed", error: "invalid key" }));
          return;
        }
        let command = "";
        try {
          const parsed = JSON.parse(body);
          command = typeof parsed.command === "string" ? parsed.command : "";
        } catch {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ status: "failed", error: "invalid json" }));
          return;
        }
        if (command !== expectedCommand) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ status: "failed", error: "unexpected command" }));
          return;
        }
        res.writeHead(200, {
          "content-type": "application/json",
          "x-api-version": "2026-01-30",
        });
        res.end(
          JSON.stringify({
            task_id: "ctask_contract_1",
            status: "completed",
            result: "contract-ok",
            actions: [{ type: "noop" }],
            usage: { remaining: 123 },
          }),
        );
      });
      return;
    }

    if (req.method === "GET" && url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  assert(port > 0, "failed to bind mock server");
  const baseUrl = `http://127.0.0.1:${port}`;

  const ts = spawnSync(
    "node",
    [
      "sdk/typescript/dist/cli/bin.js",
      "do",
      expectedCommand,
      "--api-key",
      expectedKey,
      "--base-url",
      baseUrl,
      "--json",
    ],
    {
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    },
  );
  assert(ts.status === 0, `typescript cli failed:\n${ts.stderr || ts.stdout}`);
  const tsEnvelope = parseJsonFromStdout(ts.stdout, "typescript cli");
  assert(tsEnvelope.ok === true, "typescript cli envelope was not ok");
  assert(tsEnvelope.data?.text === "contract-ok", "typescript cli returned unexpected result");

  const py = spawnSync(
    "python3",
    ["-m", "centris_sdk.cli.main", "do", expectedCommand, "--key", expectedKey, "--json"],
    {
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1", CENTRIS_API_URL: baseUrl },
    },
  );
  assert(py.status === 0, `python cli failed:\n${py.stderr || py.stdout}`);
  const pyEnvelope = parseJsonFromStdout(py.stdout, "python cli");
  assert(pyEnvelope.ok === true, "python cli envelope was not ok");
  assert(pyEnvelope.data?.result === "contract-ok", "python cli returned unexpected result");

  await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  console.log("centris-sdk cli contract check passed");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
