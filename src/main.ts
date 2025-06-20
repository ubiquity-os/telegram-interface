import { webhookCallback } from "grammy";
import { createBot } from "./bot.ts";
import { getConfig } from "./utils/config.ts";
import { deduplicationService } from "./services/deduplication.ts";

const bot = createBot();
const config = getConfig();

// Create webhook handler
const handleUpdate = webhookCallback(bot, "std/http");

Deno.serve({
  port: 8000,
  onListen: ({ hostname, port }) => {
    console.log(`Webhook server running at http://${hostname}:${port}`);
    console.log(`Webhook path: /webhook/${config.webhookSecret}`);
  },
}, async (req) => {
  const url = new URL(req.url);

  // Health check endpoint
  if (url.pathname === "/health" && req.method === "GET") {
    return new Response(JSON.stringify({ 
      status: "ok", 
      timestamp: new Date().toISOString(),
      deduplicationCacheSize: deduplicationService.getSize()
    }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Webhook endpoint
  if (url.pathname === `/webhook/${config.webhookSecret}` && req.method === "POST") {
    try {
      // Parse the update to check for duplicates
      const bodyText = await req.text();
      const update = JSON.parse(bodyText);
      
      // Check if we've already processed this update
      if (update.update_id && deduplicationService.hasProcessed(update.update_id)) {
        console.log(`Duplicate update detected: ${update.update_id}, skipping processing`);
        return new Response("OK", { status: 200 });
      }
      
      // Mark update as processed
      if (update.update_id) {
        deduplicationService.markAsProcessed(update.update_id);
        console.log(`Processing new update: ${update.update_id}`);
      }
      
      // Process the update asynchronously (don't await)
      // This allows us to return 200 OK immediately
      processUpdateAsync(bodyText);
      
      // Return 200 OK immediately to acknowledge webhook
      return new Response("OK", { status: 200 });
      
    } catch (error) {
      console.error("Webhook error:", error);
      return new Response("Internal Server Error", { status: 500 });
    }
  }

  // 404 for all other routes
  return new Response("Not Found", { status: 404 });
});

// Async function to process updates in the background
async function processUpdateAsync(bodyText: string) {
  try {
    // Create a new request object with the body for grammy
    const fakeRequest = new Request("https://telegram.org", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: bodyText,
    });
    
    // Let grammy handle the update
    await handleUpdate(fakeRequest);
  } catch (error) {
    console.error("Error processing update asynchronously:", error);
  }
}