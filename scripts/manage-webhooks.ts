// Manage webhooks for both production and preview bots

export {}; // Make this file a module

const productionToken = Deno.env.get("BOT_TOKEN") || "";
const previewToken = Deno.env.get("PREVIEW_BOT_TOKEN") || "";
const webhookSecret = Deno.env.get("WEBHOOK_SECRET") || "";

if (!productionToken || !webhookSecret) {
  console.error("❌ BOT_TOKEN and WEBHOOK_SECRET are required");
  Deno.exit(1);
}

const command = Deno.args[0];

if (!command || !["set", "check", "delete"].includes(command)) {
  console.log("Usage: deno run --allow-net --allow-env scripts/manage-webhooks.ts [set|check|delete] [deployment-url]");
  console.log("\nCommands:");
  console.log("  set <deployment-url>  - Set webhooks for both bots");
  console.log("  check                 - Check current webhook status");
  console.log("  delete                - Delete webhooks for both bots");
  Deno.exit(1);
}

// Helper function to manage webhook
async function manageWebhook(token: string, action: string, webhookPath?: string, botName?: string) {
  let url = `https://api.telegram.org/bot${token}/`;
  
  switch (action) {
    case "set":
      if (!webhookPath) {
        console.error("Webhook URL is required for set action");
        return;
      }
      url += "setWebhook";
      break;
    case "check":
      url += "getWebhookInfo";
      break;
    case "delete":
      url += "deleteWebhook";
      break;
  }
  
  const options: RequestInit = {
    method: action === "check" ? "GET" : "POST",
  };
  
  if (action === "set" && webhookPath) {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify({
      url: webhookPath,
      allowed_updates: ["message", "callback_query"],
    });
  }
  
  const response = await fetch(url, options);
  const result = await response.json();
  
  console.log(`\n${botName || "Bot"} - ${action}:`);
  if (result.ok) {
    if (action === "check" && result.result) {
      console.log(`✅ Webhook URL: ${result.result.url || "Not set"}`);
      if (result.result.pending_update_count) {
        console.log(`   Pending updates: ${result.result.pending_update_count}`);
      }
      if (result.result.last_error_message) {
        console.log(`   ⚠️  Last error: ${result.result.last_error_message}`);
      }
    } else {
      console.log(`✅ Success`);
    }
  } else {
    console.error(`❌ Failed:`, result);
  }
  
  return result;
}

// Execute command
switch (command) {
  case "set": {
    const deploymentUrl = Deno.args[1];
    if (!deploymentUrl) {
      console.error("❌ Deployment URL is required for set command");
      console.log("Example: deno run --allow-net --allow-env scripts/manage-webhooks.ts set https://telegram-interface.deno.dev");
      Deno.exit(1);
    }
    
    console.log(`Setting webhooks for deployment: ${deploymentUrl}`);
    
    // Set production webhook
    await manageWebhook(
      productionToken,
      "set",
      `${deploymentUrl}/webhook/${webhookSecret}`,
      "Production Bot"
    );
    
    // Set preview webhook if token exists (now uses universal endpoint)
    if (previewToken) {
      await manageWebhook(
        previewToken,
        "set",
        `${deploymentUrl}/webhook/${webhookSecret}`,
        "Preview Bot"
      );
    } else {
      console.log("\n⚠️  Preview bot token not configured");
    }
    break;
  }
  
  case "check": {
    // Check production webhook
    await manageWebhook(productionToken, "check", undefined, "Production Bot");
    
    // Check preview webhook if token exists
    if (previewToken) {
      await manageWebhook(previewToken, "check", undefined, "Preview Bot");
    }
    break;
  }
  
  case "delete": {
    // Delete production webhook
    await manageWebhook(productionToken, "delete", undefined, "Production Bot");
    
    // Delete preview webhook if token exists
    if (previewToken) {
      await manageWebhook(previewToken, "delete", undefined, "Preview Bot");
    }
    break;
  }
}

console.log("\n✅ Done!");
