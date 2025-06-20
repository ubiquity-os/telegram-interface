import { webhookCallback } from "grammy";
import { createBot } from "./bot-factory.ts";
import { getConfig } from "./utils/config.ts";
import { deduplicationService } from "./services/deduplication.ts";
import { detectBotFromUpdate, type TelegramUpdate } from "./services/bot-detection.ts";

const config = getConfig();

Deno.serve({
  port: 8000,
  onListen: ({ hostname, port }) => {
    console.log(`Webhook server running at http://${hostname}:${port}`);
    console.log(`Universal webhook: /webhook/${config.webhookSecret}`);
    console.log(`Production Bot ID: ${config.botId}`);
    console.log(`Preview Bot ID: ${config.previewBotId || "not configured"}`);
  },
}, async (req) => {
  const url = new URL(req.url);

  // Health check endpoint
  if (url.pathname === "/health" && req.method === "GET") {
    return new Response(JSON.stringify({
      status: "ok",
      timestamp: new Date().toISOString(),
      deduplicationCacheSize: deduplicationService.getSize(),
      botConfiguration: {
        productionBotId: config.botId,
        previewBotId: config.previewBotId || "not configured",
        hasPreviewBot: !!config.previewBotToken
      }
    }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Conversations endpoint to view KV data
  if (url.pathname === "/conversations" && req.method === "GET") {
    try {
      const params = url.searchParams;
      const chatIdParam = params.get("chatId");
      const limitParam = params.get("limit");
      
      // Dynamically import conversation history to avoid initialization issues
      const { conversationHistory } = await import("./services/conversation-history.ts");
      
      // If specific chatId is requested
      if (chatIdParam) {
        const chatId = parseInt(chatIdParam);
        if (isNaN(chatId)) {
          return new Response(JSON.stringify({
            error: "Invalid chatId parameter"
          }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        
        const history = await conversationHistory.getHistory(chatId);
        const { countTokens } = await import("./utils/token-counter.ts");
        
        // Calculate total tokens for this conversation
        let totalTokens = 0;
        for (const msg of history) {
          totalTokens += countTokens(msg.content);
        }
        
        return new Response(JSON.stringify({
          chatId,
          messageCount: history.length,
          totalTokens,
          messages: history,
          timestamp: new Date().toISOString()
        }, null, 2), {
          headers: { "Content-Type": "application/json" },
        });
      }
      
      // Get all conversations
      const kv = await Deno.openKv();
      const conversations: any[] = [];
      const limit = limitParam ? parseInt(limitParam) : undefined;
      let count = 0;
      
      // Iterate through all chat entries
      const iter = kv.list({ prefix: ["chat"] });
      for await (const entry of iter) {
        if (entry.key[2] === "messages" && entry.value) {
          const chatId = entry.key[1];
          const messages = entry.value as any[];
          
          // Apply limit if specified
          if (limit && count >= limit) break;
          
          // Calculate tokens for this conversation
          const { countTokens } = await import("./utils/token-counter.ts");
          let totalTokens = 0;
          for (const entry of messages) {
            totalTokens += countTokens(entry.message.content);
          }
          
          conversations.push({
            chatId,
            messageCount: messages.length,
            totalTokens,
            firstMessageTime: messages[0]?.timestamp ? new Date(messages[0].timestamp).toISOString() : null,
            lastMessageTime: messages[messages.length - 1]?.timestamp ? new Date(messages[messages.length - 1].timestamp).toISOString() : null,
            // Include actual messages if not too many
            messages: messages.length <= 10 ? messages : `[${messages.length} messages - use ?chatId=${chatId} to view all]`
          });
          
          count++;
        }
      }
      
      // Get overall stats
      const stats = await conversationHistory.getStats();
      
      return new Response(JSON.stringify({
        stats: {
          totalChats: stats.totalChats,
          totalMessages: stats.totalMessages,
          timestamp: new Date().toISOString()
        },
        conversations: conversations.sort((a, b) => {
          // Sort by last message time, newest first
          const timeA = a.lastMessageTime ? new Date(a.lastMessageTime).getTime() : 0;
          const timeB = b.lastMessageTime ? new Date(b.lastMessageTime).getTime() : 0;
          return timeB - timeA;
        }),
        queryParams: {
          available: ["chatId", "limit"],
          examples: [
            "/conversations?chatId=123456789",
            "/conversations?limit=5"
          ]
        }
      }, null, 2), {
        headers: { "Content-Type": "application/json" },
      });
      
    } catch (error) {
      console.error("Conversations endpoint error:", error);
      return new Response(JSON.stringify({
        error: "Failed to retrieve conversation data",
        details: error.message
      }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // Universal webhook endpoint - handles both production and preview bots
  if (url.pathname === `/webhook/${config.webhookSecret}` && req.method === "POST") {
    try {
      // Parse the update to check for duplicates and detect bot
      const bodyText = await req.text();
      const update: TelegramUpdate = JSON.parse(bodyText);
      
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
      
      // Detect which bot should handle this update
      console.log("🎯 Detecting bot from update metadata...");
      const detection = detectBotFromUpdate(
        update,
        config.botId,
        config.previewBotId,
        config.botToken,
        config.previewBotToken
      );
      
      console.log(`📍 Update detected for ${detection.botType.toUpperCase()} bot (ID: ${detection.detectedBotId})`);
      console.log(`📡 Detection method: ${detection.detectionMethod}`);
      
      // Process the update asynchronously (don't await)
      // This allows us to return 200 OK immediately
      processUpdateAsync(bodyText, detection.botToken, detection.botType);
      
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
async function processUpdateAsync(bodyText: string, botToken: string, botType: string) {
  try {
    console.log(`🤖 Processing update with ${botType.toUpperCase()} bot`);
    
    // Create the appropriate bot instance
    const bot = createBot(botToken);
    
    // Create webhook handler for this specific bot
    const handleUpdate = webhookCallback(bot, "std/http");
    
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
