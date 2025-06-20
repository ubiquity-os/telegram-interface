/// <reference types="deno-types" />
import { getDeploymentUrl } from "./deno-deploy-api.ts";

const DRY_RUN = Deno.args.includes("--dry-run");

console.log("=== WEBHOOK UPDATE DEBUG ===");
console.log("Dry run mode:", DRY_RUN);
console.log("Environment variables:");
console.log(`- IS_PRODUCTION: ${Deno.env.get("IS_PRODUCTION")}`);
console.log(`- BOT_TOKEN: ${Deno.env.get("BOT_TOKEN") ? "*****" : "MISSING"}`);
console.log(`- WEBHOOK_SECRET: ${Deno.env.get("WEBHOOK_SECRET") ? "*****" : "MISSING"}`);

if (!Deno.env.get("BOT_TOKEN")) {
  console.error("ERROR: BOT_TOKEN environment variable is required");
  Deno.exit(1);
}
if (!Deno.env.get("WEBHOOK_SECRET")) {
  console.error("ERROR: WEBHOOK_SECRET environment variable is required");
  Deno.exit(1);
}

try {
  console.log("\nFetching deployment URL...");
  const isProduction = Deno.env.get("IS_PRODUCTION") === "true";
  const deploymentUrl = await getDeploymentUrl(isProduction);
  console.log(`Resolved deployment URL: ${deploymentUrl}`);
  const webhookUrl = `${deploymentUrl}/webhook`;

  if (DRY_RUN) {
    console.log("\nDRY RUN RESULTS:");
    console.log(`Would set ${isProduction ? "production" : "preview"} webhook to: ${webhookUrl}`);
    console.log("Would use token:", Deno.env.get("BOT_TOKEN") ? "*****" : "MISSING");
    console.log("Would use secret:", Deno.env.get("WEBHOOK_SECRET") ? "*****" : "MISSING");
    Deno.exit(0);
  }

  console.log(`\nSetting ${isProduction ? "production" : "preview"} webhook...`);
  const response = await fetch(`https://api.telegram.org/bot${Deno.env.get("BOT_TOKEN")}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: Deno.env.get("WEBHOOK_SECRET"),
      drop_pending_updates: true,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("ERROR:", error);
    throw new Error(`Failed to set webhook: ${response.status} ${error}`);
  }

  const result = await response.json() as {ok: boolean, description: string};
  console.log("\nSUCCESS:", result.description);
} catch (error) {
  console.error("\nFATAL ERROR:", error);
  Deno.exit(1);
}
