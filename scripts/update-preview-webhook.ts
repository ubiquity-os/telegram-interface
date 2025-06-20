import { getConfig } from "../src/utils/config.ts";

const config = getConfig();

// Get the preview deployment URL from command line argument
const previewUrl = Deno.args[0];

if (!previewUrl) {
  console.error("❌ Preview deployment URL is required");
  console.log("Usage: deno run --allow-net --allow-env --allow-read scripts/update-preview-webhook.ts <preview-url>");
  console.log("Example: deno run --allow-net --allow-env --allow-read scripts/update-preview-webhook.ts https://telegram-interface-69bz2rgywb7m.deno.dev");
  Deno.exit(1);
}

if (!config.previewBotToken) {
  console.error("❌ PREVIEW_BOT_TOKEN not configured");
  Deno.exit(1);
}

console.log(`🔧 Updating preview bot webhook to: ${previewUrl}`);

const webhookUrl = `${previewUrl}/webhook-preview/${config.webhookSecret}`;

try {
  const response = await fetch(`https://api.telegram.org/bot${config.previewBotToken}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      allowed_updates: ["message", "callback_query"],
    }),
  });
  
  const result = await response.json();
  
  if (result.ok) {
    console.log(`✅ Preview bot webhook updated successfully!`);
    console.log(`   URL: ${webhookUrl}`);
    
    // Check the webhook status
    const checkResponse = await fetch(`https://api.telegram.org/bot${config.previewBotToken}/getWebhookInfo`);
    const checkResult = await checkResponse.json();
    
    if (checkResult.ok) {
      console.log(`\n📍 Webhook Status:`);
      console.log(`   Pending updates: ${checkResult.result.pending_update_count || 0}`);
      if (checkResult.result.last_error_message) {
        console.log(`   ⚠️  Last error: ${checkResult.result.last_error_message}`);
      }
    }
  } else {
    console.error(`❌ Failed to update webhook:`, result);
  }
} catch (error) {
  console.error(`❌ Error updating webhook:`, error);
}
