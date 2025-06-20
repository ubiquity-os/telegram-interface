import { getConfig } from "../src/utils/config.ts";

const config = getConfig();

console.log("📊 Checking webhook status...\n");

try {
  const response = await fetch(
    `https://api.telegram.org/bot${config.botToken}/getWebhookInfo`
  );
  
  const data = await response.json();
  
  if (data.ok) {
    console.log("✅ Webhook Status:");
    console.log(`- URL: ${data.result.url || "Not set"}`);
    console.log(`- Pending updates: ${data.result.pending_update_count || 0}`);
    console.log(`- Max connections: ${data.result.max_connections || 40}`);
    console.log(`- Last error: ${data.result.last_error_message || "None"}`);
    if (data.result.last_error_date) {
      console.log(`- Last error date: ${new Date(data.result.last_error_date * 1000).toISOString()}`);
    }
  } else {
    console.error("❌ Failed to get webhook info:", data);
  }
} catch (error) {
  console.error("❌ Error checking webhook:", error);
}