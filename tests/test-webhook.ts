// Test script to simulate a Telegram webhook request
import { load } from "std/dotenv/mod.ts";

// Load .env file
await load({ export: true }).catch(() => {
  // Ignore error if .env doesn't exist
});

const BOT_TOKEN = Deno.env.get("BOT_TOKEN");
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") || "test-secret";

if (!BOT_TOKEN) {
  console.error("Error: BOT_TOKEN environment variable is not set");
  Deno.exit(1);
}

// Create a test update with a message
const testUpdate = {
  update_id: Date.now(),
  message: {
    message_id: 1,
    date: Math.floor(Date.now() / 1000),
    chat: {
      id: 12345,
      type: "private",
    },
    from: {
      id: 12345,
      is_bot: false,
      first_name: "Test",
      username: "testuser",
    },
    text: "What's the weather in San Francisco?",
  },
};

async function sendTestWebhook() {
  const webhookUrl = `http://localhost:8000/webhook/${WEBHOOK_SECRET}`;
  
  console.log("Sending test webhook to:", webhookUrl);
  console.log("Test message:", testUpdate.message.text);
  
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(testUpdate),
    });
    
    console.log("Response status:", response.status);
    const responseText = await response.text();
    console.log("Response body:", responseText);
    
    if (response.ok) {
      console.log("✓ Webhook processed successfully");
    } else {
      console.log("✗ Webhook processing failed");
    }
  } catch (error) {
    console.error("Error sending webhook:", error);
  }
}

// Run the test
sendTestWebhook();