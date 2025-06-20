import { getConfig } from "../src/utils/config.ts";

const config = getConfig();

async function setWebhook(token: string, url: string, botName: string) {
  console.log(`\n🔧 Setting webhook for ${botName}...`);
  console.log(`   URL: ${url}`);
  
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: url,
        allowed_updates: ["message", "callback_query"],
      }),
    });
    
    const result = await response.json();
    
    if (result.ok) {
      console.log(`✅ ${botName} webhook set successfully`);
    } else {
      console.error(`❌ Failed to set ${botName} webhook:`, result);
    }
    
    return result;
  } catch (error) {
    console.error(`❌ Error setting ${botName} webhook:`, error);
  }
}

console.log("🔧 Setting up webhooks for both bots...\n");

// Production bot webhook - main deployment
const productionUrl = `https://telegram-interface.deno.dev/webhook/${config.webhookSecret}`;
await setWebhook(config.botToken, productionUrl, "Production Bot");

// Preview bot webhook - latest preview deployment
if (config.previewBotToken) {
  // Use the latest preview URL - you'll need to update this with your actual preview URL
  const previewUrl = `https://telegram-interface-5qxs1tj6qy59.deno.dev/webhook-preview/${config.webhookSecret}`;
  await setWebhook(config.previewBotToken, previewUrl, "Preview Bot");
} else {
  console.log("\n⚠️  Preview bot token not configured");
}

console.log("\n✅ Webhook setup complete!");
