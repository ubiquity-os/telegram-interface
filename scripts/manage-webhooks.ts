import { getConfig } from "../src/utils/config.ts";

// Bot configurations
const config = getConfig();
const BOTS = {
  production: {
    name: "Production Bot",
    token: config.botToken, // From .env
    defaultUrl: "https://telegram-interface.deno.dev"
  },
  preview: {
    name: "Preview Bot", 
    token: config.previewBotToken || "", // From .env
    defaultUrl: null // Will be provided as argument
  }
};

// Parse command line arguments
const command = Deno.args[0];
const botType = Deno.args[1] as "production" | "preview";
const deploymentUrl = Deno.args[2];

// Show usage
function showUsage() {
  console.log(`
📋 Webhook Manager for Telegram Bots

Usage:
  deno run --allow-net --allow-env scripts/manage-webhooks.ts <command> <bot> [url]

Commands:
  set       Set webhook for a bot
  check     Check current webhook status
  clear     Clear webhook (switch to polling mode)

Bots:
  production  Main production bot
  preview     Preview/testing bot

Examples:
  # Set preview bot to a preview deployment
  deno run --allow-net --allow-env scripts/manage-webhooks.ts set preview https://telegram-interface-69bz2rgywb7m.deno.dev

  # Check production bot webhook
  deno run --allow-net --allow-env scripts/manage-webhooks.ts check production

  # Clear preview bot webhook (for local testing with polling)
  deno run --allow-net --allow-env scripts/manage-webhooks.ts clear preview
`);
}

// Validate inputs
if (!command || !botType) {
  showUsage();
  Deno.exit(1);
}

if (!["set", "check", "clear"].includes(command)) {
  console.error("❌ Invalid command. Use 'set', 'check', or 'clear'");
  showUsage();
  Deno.exit(1);
}

if (!["production", "preview"].includes(botType)) {
  console.error("❌ Invalid bot type. Use 'production' or 'preview'");
  showUsage();
  Deno.exit(1);
}

const bot = BOTS[botType];

// Check if preview bot token is configured
if (botType === "preview" && !bot.token) {
  console.error("❌ PREVIEW_BOT_TOKEN is not configured in your .env file");
  console.error("Please add: PREVIEW_BOT_TOKEN=your_preview_bot_token_here");
  Deno.exit(1);
}

const webhookSecret = config.webhookSecret;

// Set webhook
async function setWebhook(url: string) {
  const webhookUrl = `${url}/webhook/${webhookSecret}`;
  
  console.log(`🔄 Setting webhook for ${bot.name}...`);
  console.log(`📍 Webhook URL: ${webhookUrl}`);
  
  const response = await fetch(
    `https://api.telegram.org/bot${bot.token}/setWebhook`,
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
    console.log(`✅ Webhook successfully set for ${bot.name}!`);
    await checkWebhook();
  } else {
    console.error(`❌ Failed to set webhook for ${bot.name}:`, result);
    Deno.exit(1);
  }
}

// Check webhook status
async function checkWebhook() {
  console.log(`\n📊 Checking webhook status for ${bot.name}...\n`);
  
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${bot.token}/getWebhookInfo`
    );
    
    const data = await response.json();
    
    if (data.ok) {
      console.log(`✅ ${bot.name} Webhook Status:`);
      console.log(`- URL: ${data.result.url || "Not set"}`);
      console.log(`- Pending updates: ${data.result.pending_update_count || 0}`);
      console.log(`- Max connections: ${data.result.max_connections || 40}`);
      console.log(`- Last error: ${data.result.last_error_message || "None"}`);
      if (data.result.last_error_date) {
        console.log(`- Last error date: ${new Date(data.result.last_error_date * 1000).toISOString()}`);
      }
    } else {
      console.error(`❌ Failed to get webhook info for ${bot.name}:`, data);
    }
  } catch (error) {
    console.error(`❌ Error checking webhook for ${bot.name}:`, error);
  }
}

// Clear webhook
async function clearWebhook() {
  console.log(`🔄 Clearing webhook for ${bot.name}...`);
  
  const response = await fetch(
    `https://api.telegram.org/bot${bot.token}/deleteWebhook`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        drop_pending_updates: true,
      }),
    }
  );
  
  const result = await response.json();
  
  if (result.ok) {
    console.log(`✅ Webhook cleared for ${bot.name}!`);
    console.log("ℹ️  Bot can now be used with polling mode for local testing");
  } else {
    console.error(`❌ Failed to clear webhook for ${bot.name}:`, result);
    Deno.exit(1);
  }
}

// Execute command
switch (command) {
  case "set":
    const url = deploymentUrl || bot.defaultUrl;
    if (!url) {
      console.error("❌ Please provide a deployment URL for the preview bot");
      showUsage();
      Deno.exit(1);
    }
    await setWebhook(url);
    break;
    
  case "check":
    await checkWebhook();
    break;
    
  case "clear":
    await clearWebhook();
    break;
}
