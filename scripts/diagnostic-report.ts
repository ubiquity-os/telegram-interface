// Comprehensive diagnostic report for webhook/bot configuration issues

import { getConfig } from "../src/utils/config.ts";

console.log("🔍 TELEGRAM BOT CONFIGURATION DIAGNOSTIC REPORT");
console.log("=" .repeat(50));

try {
  const config = getConfig();
  
  console.log("\n📊 ENVIRONMENT CONFIGURATION:");
  console.log(`  Environment: ${config.environment}`);
  console.log(`  Log Level: ${config.logLevel}`);
  console.log(`  Deployment URL: ${config.deploymentUrl || "Not set"}`);
  console.log(`  Webhook Secret: ${config.webhookSecret ? "✅ Set" : "❌ Missing"}`);
  console.log(`  OpenRouter API Key: ${config.openRouterApiKey ? "✅ Set" : "❌ Missing"}`);
  
  console.log("\n🤖 BOT CONFIGURATION:");
  console.log(`  Production Bot Token: ${config.botToken ? "✅ Set" : "❌ Missing"}`);
  console.log(`  Production Bot ID: ${config.botId}`);
  console.log(`  Preview Bot Token: ${config.previewBotToken ? "✅ Set" : "❌ Missing"}`);
  console.log(`  Preview Bot ID: ${config.previewBotId || "Not configured"}`);
  
  // Check webhook status for each bot
  async function checkWebhookStatus(token: string, botName: string, botId: string) {
    console.log(`\n📡 ${botName.toUpperCase()} WEBHOOK STATUS:`);
    
    try {
      // Get bot info
      const botInfoResponse = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const botInfo = await botInfoResponse.json();
      
      if (botInfo.ok) {
        console.log(`  Bot Username: @${botInfo.result.username}`);
        console.log(`  Bot Name: ${botInfo.result.first_name}`);
        console.log(`  Bot ID: ${botInfo.result.id}`);
        console.log(`  ID Match: ${botInfo.result.id.toString() === botId ? "✅" : "❌"}`);
      } else {
        console.log(`  ❌ Failed to get bot info: ${botInfo.description}`);
        return;
      }
      
      // Get webhook info
      const webhookResponse = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
      const webhookData = await webhookResponse.json();
      
      if (webhookData.ok) {
        const webhook = webhookData.result;
        console.log(`  Webhook URL: ${webhook.url || "❌ Not set"}`);
        console.log(`  Pending Updates: ${webhook.pending_update_count || 0}`);
        console.log(`  Max Connections: ${webhook.max_connections || 40}`);
        
        if (webhook.url) {
          // Parse deployment from URL
          const urlMatch = webhook.url.match(/https:\/\/([^\/]+)\//);
          if (urlMatch) {
            const deployment = urlMatch[1];
            console.log(`  Deployment: ${deployment}`);
            
            // Analyze deployment type
            if (deployment.includes("telegram-interface.deno.dev")) {
              console.log(`  Deployment Type: 🏭 Production`);
            } else {
              console.log(`  Deployment Type: 🧪 Preview`);
            }
            
            // Check webhook path
            const pathMatch = webhook.url.match(/\/(webhook[^\/]*)\//);
            if (pathMatch) {
              console.log(`  Webhook Path: ${pathMatch[1]}`);
            }
          }
        }
        
        if (webhook.last_error_message) {
          console.log(`  ⚠️ Last Error: ${webhook.last_error_message}`);
          console.log(`  Error Date: ${new Date(webhook.last_error_date * 1000).toISOString()}`);
        } else {
          console.log(`  Status: ✅ No errors`);
        }
      } else {
        console.log(`  ❌ Failed to get webhook info: ${webhookData.description}`);
      }
    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
    }
  }
  
  // Check production bot
  await checkWebhookStatus(config.botToken, "Production", config.botId);
  
  // Check preview bot if configured
  if (config.previewBotToken && config.previewBotId) {
    await checkWebhookStatus(config.previewBotToken, "Preview", config.previewBotId);
  } else {
    console.log("\n📡 PREVIEW WEBHOOK STATUS:");
    console.log("  ❌ Preview bot not configured");
  }
  
  console.log("\n🔍 POTENTIAL ISSUES ANALYSIS:");
  
  // Issue 1: Missing preview bot
  if (!config.previewBotToken) {
    console.log("  ❌ ISSUE: Preview bot token not configured");
    console.log("     This means preview environments will fall back to production bot");
  }
  
  // Issue 2: Same tokens
  if (config.previewBotToken && config.botToken === config.previewBotToken) {
    console.log("  ❌ CRITICAL: Production and preview using same bot token!");
    console.log("     This will cause conflicts between environments");
  }
  
  // Issue 3: Token/ID mismatch
  if (config.previewBotToken && config.previewBotId) {
    const actualPreviewId = config.previewBotToken.split(":")[0];
    if (actualPreviewId !== config.previewBotId) {
      console.log("  ❌ ISSUE: Preview bot ID doesn't match token");
      console.log(`     Expected: ${config.previewBotId}, Actual: ${actualPreviewId}`);
    }
  }
  
  console.log("\n📋 RECOMMENDED NEXT STEPS:");
  if (!config.previewBotToken) {
    console.log("  1. Create a separate preview bot in @BotFather");
    console.log("  2. Set PREVIEW_BOT_TOKEN environment variable");
    console.log("  3. Update webhook URLs for both bots");
  } else {
    console.log("  1. Verify both bots are pointing to correct deployments");
    console.log("  2. Check deployment environment variables");
    console.log("  3. Test message responses from both bots");
  }

} catch (error) {
  console.error("❌ Configuration Error:", error.message);
  console.log("\nThis usually means environment variables are not properly configured.");
}

console.log("\n" + "=" .repeat(50));