import { getConfig } from "../src/utils/config.ts";

const config = getConfig();

// Get deployment URL from command line argument
const deploymentUrl = Deno.args[0];

if (!deploymentUrl) {
  console.error("❌ Error: Please provide your Deno Deploy URL as an argument");
  console.error("Usage: deno run --allow-net --allow-env scripts/set-webhook.ts https://your-project.deno.dev");
  Deno.exit(1);
}

// Validate URL format
try {
  new URL(deploymentUrl);
} catch {
  console.error("❌ Error: Invalid URL format. Please provide a valid URL like https://your-project.deno.dev");
  Deno.exit(1);
}

const webhookUrl = `${deploymentUrl}/webhook/${config.webhookSecret}`;

console.log("🔄 Setting webhook for Telegram bot...");
console.log(`📍 Webhook URL: ${webhookUrl}`);

const response = await fetch(
  `https://api.telegram.org/bot${config.botToken}/setWebhook`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      drop_pending_updates: true,
    }),
  }
);

const result = await response.json();

if (result.ok) {
  console.log("✅ Webhook successfully set!");
  console.log("📋 Details:", result);
  
  // Get webhook info to verify
  const infoResponse = await fetch(
    `https://api.telegram.org/bot${config.botToken}/getWebhookInfo`
  );
  const info = await infoResponse.json();
  
  if (info.ok) {
    console.log("\n📊 Current webhook info:");
    console.log(`- URL: ${info.result.url}`);
    console.log(`- Pending updates: ${info.result.pending_update_count || 0}`);
    console.log(`- Last error: ${info.result.last_error_message || "None"}`);
  }
} else {
  console.error("❌ Failed to set webhook:", result);
  Deno.exit(1);
}