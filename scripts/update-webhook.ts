/// <reference types="deno-types" />
import { getDeploymentUrl } from "./deno-deploy-api.ts";

// Get environment variables
const BOT_TOKEN = Deno.env.get("BOT_TOKEN");
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET");
const IS_PRODUCTION = Deno.env.get("IS_PRODUCTION") === "true";

// Validate required environment variables
if (!BOT_TOKEN) {
  console.error("BOT_TOKEN environment variable is required");
  Deno.exit(1);
}
if (!WEBHOOK_SECRET) {
  console.error("WEBHOOK_SECRET environment variable is required");
  Deno.exit(1);
}

try {
  // Get deployment URL from Deno Deploy API
  const deploymentUrl = await getDeploymentUrl(IS_PRODUCTION);
  const webhookUrl = `${deploymentUrl}/webhook`;

  console.log(`Setting webhook for ${IS_PRODUCTION ? "production" : "preview"} environment`);
  console.log(`Webhook URL: ${webhookUrl}`);

  // Set Telegram webhook
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: WEBHOOK_SECRET,
      drop_pending_updates: true,
    }),
  });

  // Handle response
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to set webhook: ${response.status} ${error}`);
  }

  const result = await response.json();
  console.log("Webhook set successfully:", result.description);
} catch (error) {
  console.error("Error setting webhook:", error);
  Deno.exit(1);
}
