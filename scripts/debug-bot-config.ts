// Debug bot configuration and webhook settings

const productionToken = Deno.env.get("BOT_TOKEN") || "";
const previewToken = Deno.env.get("PREVIEW_BOT_TOKEN") || "";

if (!productionToken || !previewToken) {
  console.error("❌ Both BOT_TOKEN and PREVIEW_BOT_TOKEN are required");
  Deno.exit(1);
}

console.log("🔍 Debugging Bot Configuration\n");

// Get bot info for both tokens
async function getBotInfo(name: string, token: string) {
  console.log(`\n📱 ${name} Bot:`);
  
  try {
    // Get bot info
    const infoResponse = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const infoData = await infoResponse.json();
    
    if (infoData.ok) {
      console.log(`✅ Bot username: @${infoData.result.username}`);
      console.log(`   Bot name: ${infoData.result.first_name}`);
      console.log(`   Bot ID: ${infoData.result.id}`);
    } else {
      console.log(`❌ Failed to get bot info:`, infoData);
      return;
    }
    
    // Get webhook info
    const webhookResponse = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    const webhookData = await webhookResponse.json();
    
    if (webhookData.ok) {
      const webhook = webhookData.result;
      console.log(`\n📍 Webhook Configuration:`);
      console.log(`   URL: ${webhook.url || "Not set"}`);
      
      if (webhook.url) {
        // Extract deployment from URL
        const urlMatch = webhook.url.match(/https:\/\/([^\/]+)\//);
        if (urlMatch) {
          console.log(`   Deployment: ${urlMatch[1]}`);
        }
      }
      
      console.log(`   Pending updates: ${webhook.pending_update_count || 0}`);
      
      if (webhook.last_error_message) {
        console.log(`   ⚠️  Last error: ${webhook.last_error_message}`);
        console.log(`   Error date: ${new Date(webhook.last_error_date * 1000).toISOString()}`);
      }
    }
    
  } catch (error) {
    console.log(`❌ Error getting bot info:`, error.message);
  }
}

// Check both bots
await getBotInfo("Production", productionToken);
await getBotInfo("Preview", previewToken);

console.log("\n\n🔍 Checking for Issues:\n");

// Check if tokens are the same
if (productionToken === previewToken) {
  console.log("❌ CRITICAL: Production and Preview tokens are the same!");
  console.log("   This means you're using the same bot for both environments.");
}

// Get webhook URLs for comparison
async function getWebhookUrl(token: string): Promise<string | null> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    const data = await response.json();
    return data.ok ? data.result.url : null;
  } catch {
    return null;
  }
}

const prodWebhook = await getWebhookUrl(productionToken);
const previewWebhook = await getWebhookUrl(previewToken);

if (prodWebhook && previewWebhook) {
  if (prodWebhook === previewWebhook) {
    console.log("❌ Both bots are pointing to the same webhook URL!");
  } else {
    console.log("✅ Bots are pointing to different webhook URLs");
    
    // Check if preview is pointing to production
    if (previewWebhook.includes("telegram-interface.deno.dev")) {
      console.log("⚠️  Preview bot is pointing to production deployment!");
    }
  }
}

console.log("\n📝 Next Steps:");
console.log("1. Make sure you have two different bots created in @BotFather");
console.log("2. Ensure BOT_TOKEN and PREVIEW_BOT_TOKEN are from different bots");
console.log("3. Check that the preview deployment has the correct environment variables");
