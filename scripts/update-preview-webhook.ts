import { getConfig } from "../src/utils/config.ts";
import { getDeploymentUrl } from "./deno-deploy-api.ts";

async function updatePreviewWebhook(): Promise<void> {
  console.log("🔄 Updating preview bot webhook...");

  // Set BOT_TYPE to preview for this operation
  const originalBotType = process.env.BOT_TYPE;
  process.env.BOT_TYPE = "preview";

  let config;
  try {
    config = getConfig();
  } catch (error) {
    console.error("❌ Error getting preview bot config:", error.message);
    console.error("💡 Make sure PREVIEW_BOT_TOKEN and WEBHOOK_SECRET_PREVIEW are set");
    process.exit(1);
  } finally {
    // Restore original BOT_TYPE
    if (originalBotType) {
      process.env.BOT_TYPE = originalBotType;
    } else {
      delete process.env.BOT_TYPE;
    }
  }

  // Get the latest preview deployment URL
  let deploymentUrl: string;
  try {
    deploymentUrl = await getDeploymentUrl(false, "telegram-project-preview");
    console.log("📍 Latest preview deployment URL:", deploymentUrl);
  } catch (error) {
    console.error("❌ Error getting preview deployment URL:", error.message);
    console.error("💡 Make sure DEPLOY_TOKEN is set and there's a preview deployment available");
    process.exit(1);
  }

  // Construct webhook URL
  const webhookUrl = `${deploymentUrl}/webhook/${config.webhookSecret}`;
  console.log("🔗 Setting webhook URL:", webhookUrl);

  // Update the webhook
  try {
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
      console.log("✅ Preview bot webhook successfully updated!");
      console.log("📋 Response:", result);

      // Verify the webhook was set correctly
      const infoResponse = await fetch(
        `https://api.telegram.org/bot${config.botToken}/getWebhookInfo`
      );
      const info = await infoResponse.json();

      if (info.ok) {
        console.log("\n📊 Webhook verification:");
        console.log(`- URL: ${info.result.url}`);
        console.log(`- Pending updates: ${info.result.pending_update_count || 0}`);
        console.log(`- Last error: ${info.result.last_error_message || "None"}`);

        // Verify the URL matches what we set
        if (info.result.url === webhookUrl) {
          console.log("✅ Webhook URL verification passed");
        } else {
          console.warn("⚠️  Webhook URL mismatch detected");
          console.warn(`Expected: ${webhookUrl}`);
          console.warn(`Actual: ${info.result.url}`);
        }
      }
      } else {
        console.error("❌ Failed to update webhook:", result);
        process.exit(1);
      }
      } catch (error) {
      console.error("❌ Error updating webhook:", error.message);
      process.exit(1);
      }
      }

function printUsage() {
  console.log("Usage:");
  console.log("  bun run scripts/update-preview-webhook.ts");
  console.log("");
  console.log("Environment variables required:");
  console.log("  PREVIEW_BOT_TOKEN           - Telegram bot token for preview bot");
  console.log("  WEBHOOK_SECRET_PREVIEW      - Webhook secret for preview bot");
  console.log("  DEPLOY_TOKEN           - Deno Deploy API token");
  console.log("  DEPLOY_PROJECT_NAME           - Deno Deploy project name (optional, defaults to 'telegram-interface')");
  console.log("");
  console.log("This script is designed for CI/CD use and automatically:");
  console.log("1. Queries Deno Deploy API for the latest preview deployment");
  console.log("2. Updates the preview bot webhook to point to that deployment");
  console.log("3. Verifies the webhook was set correctly");
}

async function main() {
  // Show help if requested
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  // Check for required environment variables
  const requiredEnvVars = [
    "PREVIEW_BOT_TOKEN",
    "WEBHOOK_SECRET_PREVIEW"
  ];

  if (!process.env.DEPLOY_TOKEN && !process.env.DENO_DEPLOY_TOKEN) {
    console.error("❌ Missing required environment variable: DEPLOY_TOKEN or DENO_DEPLOY_TOKEN");
    console.log("\n💡 Run with --help for more information");
    process.exit(1);
  }

  const missing = requiredEnvVars.filter(envVar => !process.env[envVar]);
  if (missing.length > 0) {
    console.error("❌ Missing required environment variables:");
    missing.forEach(envVar => console.error(`   - ${envVar}`));
    console.log("\n💡 Run with --help for more information");
    process.exit(1);
  }

  try {
    await updatePreviewWebhook();
    console.log("\n🎉 Preview webhook update completed successfully!");
  } catch (error) {
    console.error("❌ Unexpected error:", error.message);
    process.exit(1);
  }
}

main();