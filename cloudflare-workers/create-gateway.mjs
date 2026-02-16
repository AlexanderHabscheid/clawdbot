// Create AI Gateway using Cloudflare API

import fs from "fs";
import os from "os";
import path from "path";

const ACCOUNT_ID = "7cd2b493d94c63bba7fb6b1813984ce0";
const GATEWAY_ID = "centris-ai-gateway";

async function main() {
  const configPath = path.join(os.homedir(), "Library/Preferences/.wrangler/config/default.toml");
  const configContent = fs.readFileSync(configPath, "utf-8");

  // Parse token from TOML
  const tokenMatch = configContent.match(/oauth_token\s*=\s*"([^"]+)"/);
  if (!tokenMatch) {
    console.error("Could not find OAuth token");
    process.exit(1);
  }

  const token = tokenMatch[1];
  console.log("Found OAuth token, checking existing gateways...");

  // First check if gateway already exists
  const listResponse = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai-gateway/gateways`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    },
  );

  const listResult = await listResponse.json();
  console.log("List result:", JSON.stringify(listResult, null, 2));

  // Check if our gateway exists
  if (listResult.success && listResult.result) {
    const existing = listResult.result.find((g) => g.id === GATEWAY_ID);
    if (existing) {
      console.log("\n✅ AI Gateway already exists!");
      console.log(
        "Gateway URL:",
        `https://gateway.ai.cloudflare.com/v1/${ACCOUNT_ID}/${GATEWAY_ID}`,
      );
      return;
    }
  }

  // Create the gateway
  console.log("\nCreating AI Gateway...");
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai-gateway/gateways`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: GATEWAY_ID,
        cache_invalidate_on_update: true,
        cache_ttl: 3600,
        collect_logs: true,
        rate_limiting_interval: 60,
        rate_limiting_limit: 100,
        rate_limiting_technique: "fixed",
      }),
    },
  );

  const result = await response.json();
  console.log(JSON.stringify(result, null, 2));

  if (result.success) {
    console.log("\n✅ AI Gateway created successfully!");
    console.log("Gateway URL:", `https://gateway.ai.cloudflare.com/v1/${ACCOUNT_ID}/${GATEWAY_ID}`);
  }
}

main().catch(console.error);
