/// <reference types="../deno.d.ts" />
import { getConfig } from "../src/utils/config.ts";
import { getDeploymentUrl } from "./deno-deploy-api.ts";

type BotType = "production" | "preview";

function parseArgs(): { botType: BotType; deploymentUrl?: string } {
  const args = process.argv.slice(2);
  let botType: BotType = "production"; // Default to production for backward compatibility
  let deploymentUrl: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--bot-type") {
      const nextArg = args[i + 1];
      if (nextArg === "production" || nextArg === "preview") {
        botType = nextArg;
        i++; // Skip next argument since we consumed it
      } else {
        console.error("❌ Error: --bot-type must be 'production' or 'preview'");
        process.exit(1);
      }
    } else if (arg.startsWith("http")) {
      // Legacy support: URL passed as positional argument
      deploymentUrl = arg;
    }
  }

  return { botType, deploymentUrl };
}

function printUsage() {
  console.log("Usage:");
  console.log("  bun run scripts/set-webhook.ts [--bot-type production|preview] [URL]");
  console.log("");
  console.log("Options:");
  console.log("  --bot-type    Bot type to configure (production or preview, defaults to production)");
  console.log("  URL           Manual deployment URL override (optional)");
  console.log("");
  console.log("Examples:");
  console.log("  bun run scripts/set-webhook.ts");
  console.log("  bun run scripts/set-webhook.ts --bot-type preview");
  console.log("  bun run scripts/set-webhook.ts --bot-type production https://custom.deno.dev");
  console.log("");
  console.log("Environment variables needed:");
  console.log("  DEPLOY_TOKEN    - Deno Deploy API token");
  console.log("  DEPLOY_PROJECT_NAME    - Project name (defaults to 'ubiquity-ai')");
}

async function setWebhookForBot(botType: BotType, manualUrl?: string): Promise<void> {
  console.log(`🔄 Setting webhook for ${botType} bot...`);

  // Get config with the appropriate bot type
  // Set BOT_TYPE environment variable temporarily to get the right config
  const originalBotType = process.env.BOT_TYPE;
  process.env.BOT_TYPE = botType;

  let config;
  try {
    config = getConfig();
  } finally {
    // Restore original BOT_TYPE
    if (originalBotType) {
      process.env.BOT_TYPE = originalBotType;
    } else {
      delete process.env.BOT_TYPE;
    }
  }

  // Determine deployment URL
  let deploymentUrl: string;
  if (manualUrl) {
    deploymentUrl = manualUrl;
    console.log(`📍 Using manual URL: ${deploymentUrl}`);
  } else {
    try {
      deploymentUrl = await getDeploymentUrl(botType === "production");
      console.log(`📍 Auto-detected URL: ${deploymentUrl}`);
    } catch (error) {
      console.error(`❌ Error getting deployment URL: ${error.message}`);
      console.log("\n💡 You can provide a manual URL as an argument:");
      console.log(`   bun run scripts/set-webhook.ts --bot-type ${botType} https://your-deployment.deno.dev`);
      process.exit(1);
    }
  }

  // Validate URL format
  try {
    new URL(deploymentUrl);
  } catch {
    console.error("❌ Error: Invalid URL format. Please provide a valid URL like https://your-project.deno.dev");
    process.exit(1);
  }

  const webhookUrl = `${deploymentUrl}/webhook/${config.webhookSecret}`;

  console.log(`🤖 Bot type: ${botType}`);
  console.log(`🔗 Webhook URL: ${webhookUrl}`);

  // Set the webhook
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
      console.log(`\n📊 Current webhook info for ${botType} bot:`);
      console.log(`- URL: ${info.result.url}`);
      console.log(`- Pending updates: ${info.result.pending_update_count || 0}`);
      console.log(`- Last error: ${info.result.last_error_message || "None"}`);
    }
  } else {
    console.error("❌ Failed to set webhook:", result);
    process.exit(1);
  }
}

async function main() {
  const { botType, deploymentUrl } = parseArgs();

  // Show help if requested
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  try {
    await setWebhookForBot(botType, deploymentUrl);
  } catch (error) {
    console.error("❌ Error:", error.message);
    console.log("\n💡 Run with --help for usage information");
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}