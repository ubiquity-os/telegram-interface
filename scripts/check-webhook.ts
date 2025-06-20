import { getConfig } from "../src/utils/config.ts";

type BotType = "production" | "preview" | "all";

function parseArgs(): { botType: BotType } {
  const args = process.argv.slice(2);
  let botType: BotType = "all"; // Default to showing all

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === "--bot-type") {
      const nextArg = args[i + 1];
      if (nextArg === "production" || nextArg === "preview" || nextArg === "all") {
        botType = nextArg;
        i++; // Skip next argument since we consumed it
      } else {
        console.error("❌ Error: --bot-type must be 'production', 'preview', or 'all'");
        process.exit(1);
      }
    }
  }

  return { botType };
}

function printUsage() {
  console.log("Usage:");
  console.log("  bun run scripts/check-webhook.ts [--bot-type production|preview|all]");
  console.log("");
  console.log("Options:");
  console.log("  --bot-type    Bot type to check (production, preview, or all, defaults to all)");
  console.log("");
  console.log("Examples:");
  console.log("  bun run scripts/check-webhook.ts");
  console.log("  bun run scripts/check-webhook.ts --bot-type production");
  console.log("  bun run scripts/check-webhook.ts --bot-type preview");
}

async function checkWebhookForBot(botType: "production" | "preview"): Promise<void> {
  console.log(`📊 Checking webhook status for ${botType} bot...\n`);

  // Get config with the appropriate bot type
  // Set BOT_TYPE environment variable temporarily to get the right config
  const originalBotType = process.env.BOT_TYPE;
  process.env.BOT_TYPE = botType;
  
  let config;
  try {
    config = getConfig();
  } catch (error) {
    console.error(`❌ Error getting config for ${botType} bot: ${error.message}`);
    return;
  } finally {
    // Restore original BOT_TYPE
    if (originalBotType) {
      process.env.BOT_TYPE = originalBotType;
    } else {
      delete process.env.BOT_TYPE;
    }
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${config.botToken}/getWebhookInfo`
    );
    
    const data = await response.json();
    
    if (data.ok) {
      console.log(`✅ ${botType.charAt(0).toUpperCase() + botType.slice(1)} Bot Webhook Status:`);
      console.log(`- URL: ${data.result.url || "Not set"}`);
      console.log(`- Pending updates: ${data.result.pending_update_count || 0}`);
      console.log(`- Max connections: ${data.result.max_connections || 40}`);
      console.log(`- Last error: ${data.result.last_error_message || "None"}`);
      if (data.result.last_error_date) {
        console.log(`- Last error date: ${new Date(data.result.last_error_date * 1000).toISOString()}`);
      }
      console.log(`- Webhook secret: ${config.webhookSecret ? "Set" : "Not set"}`);
    } else {
      console.error(`❌ Failed to get webhook info for ${botType} bot:`, data);
    }
  } catch (error) {
    console.error(`❌ Error checking webhook for ${botType} bot:`, error);
  }
  
  console.log(""); // Add spacing between bots
}

async function main() {
  const { botType } = parseArgs();

  // Show help if requested
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  try {
    if (botType === "all") {
      await checkWebhookForBot("production");
      await checkWebhookForBot("preview");
    } else {
      await checkWebhookForBot(botType as "production" | "preview");
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
    console.log("\n💡 Run with --help for usage information");
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}