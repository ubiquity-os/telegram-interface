// Set webhook for Telegram bot

const botToken = Deno.env.get("BOT_TOKEN");
const previewBotToken = Deno.env.get("PREVIEW_BOT_TOKEN");
const webhookSecret = Deno.env.get("WEBHOOK_SECRET");
const deploymentUrl = Deno.env.get("DEPLOYMENT_URL");

if (!botToken || !webhookSecret) {
  console.error("BOT_TOKEN and WEBHOOK_SECRET are required");
  Deno.exit(1);
}

if (!deploymentUrl) {
  console.error("DEPLOYMENT_URL is required");
  Deno.exit(1);
}

// Function to set webhook for a bot
async function setWebhook(token: string, webhookPath: string, botName: string) {
  const webhookUrl = `${deploymentUrl}${webhookPath}`;
  
  console.log(`\nSetting webhook for ${botName}...`);
  console.log(`Webhook URL: ${webhookUrl}`);
  
  const response = await fetch(
    `https://api.telegram.org/bot${token}/setWebhook`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl,
        allowed_updates: ["message", "callback_query"],
      }),
    }
  );

  const result = await response.json();
  
  if (result.ok) {
    console.log(`✅ Webhook set successfully for ${botName}`);
  } else {
    console.error(`❌ Failed to set webhook for ${botName}:`, result);
  }
  
  return result;
}

// Set webhook for production bot
await setWebhook(botToken, `/webhook/${webhookSecret}`, "Production Bot");

// Set webhook for preview bot if configured
if (previewBotToken) {
  await setWebhook(previewBotToken, `/webhook-preview/${webhookSecret}`, "Preview Bot");
} else {
  console.log("\n⚠️  Preview bot token not configured, skipping preview webhook setup");
}

console.log("\n✅ Webhook setup complete!");
