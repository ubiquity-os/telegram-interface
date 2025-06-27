// Bun automatically imports .env files, no dotenv needed
import { getConfig } from "./utils/config.ts";
import { deduplicationService } from "./services/deduplication.ts";
import { eventBus, SystemEventType } from "./services/event-bus/index.ts";

// Import logging system
import { initializeLogging } from "./utils/log-manager.ts";

// Import DI container and bootstrap function
import { bootstrap } from "./core/di-container.ts";
import { TYPES } from "./core/types.ts";

// Import types
import { ISystemOrchestrator } from "./components/system-orchestrator/types.ts";
import { ITelegramInterfaceAdapter } from "./interfaces/component-interfaces.ts";

// Load config
const config = await getConfig();

// Initialize logging system early in the bootstrap process
console.log("Initializing logging system...");
await initializeLogging();

// Bootstrap the system using the DI container
console.log("Bootstrapping system with dependency injection...");
const { container, orchestrator } = await bootstrap({
  botToken: config.botToken,
  webhookSecret: config.webhookSecret
});

// Get telegram adapter for test mode functionality
const telegramAdapter = container.get<ITelegramInterfaceAdapter>(TYPES.TelegramInterfaceAdapter);

console.log("System Orchestrator initialized successfully");

// Export the orchestrator for use in handlers
export { orchestrator as systemOrchestrator };

// Subscribe to critical events
eventBus.on(SystemEventType.ERROR_OCCURRED, (event) => {
  console.error(`System error from ${event.source}:`, event);
});

eventBus.on(SystemEventType.COMPONENT_ERROR, (event) => {
  console.error(`Component error from ${event.source}:`, event);
});

eventBus.on(SystemEventType.SYSTEM_READY, (event) => {
  console.log('System is ready to process messages');
});

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

  // Test message endpoint for E2E testing
  if (url.pathname === "/test/message" && req.method === "POST") {
    try {
      const body = await req.json();

      // Validate request body format: { userId: string, chatId: string, text: string }
      if (!body.text || typeof body.text !== "string") {
        return new Response(JSON.stringify({
          success: false,
          error: "Missing or invalid 'text' field"
        }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (!body.chatId || typeof body.chatId !== "string") {
        return new Response(JSON.stringify({
          success: false,
          error: "Missing or invalid 'chatId' field"
        }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (!body.userId || typeof body.userId !== "string") {
        return new Response(JSON.stringify({
          success: false,
          error: "Missing or invalid 'userId' field"
        }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      console.log(`=== TEST ENDPOINT HIT ===`);
      console.log(`[TEST ENDPOINT] Processing test message: "${body.text}" from user ${body.userId} in chat ${body.chatId}`);

      // Enable test mode on telegram adapter
      console.log(`[TEST ENDPOINT] Enabling test mode on TelegramInterfaceAdapter...`);
      // Cast to implementation to access test mode methods
      const telegramAdapterImpl = telegramAdapter as any;
      telegramAdapterImpl.setTestMode(true);

      // Clear any existing captured responses
      telegramAdapterImpl.clearCapturedResponses();
      console.log(`[TEST ENDPOINT] Test mode enabled and responses cleared`);

      // Create a proper TelegramUpdate object from the test input
      const testUpdate = {
        update_id: Date.now(), // Use timestamp as unique update ID
        message: {
          message_id: Date.now(),
          date: Math.floor(Date.now() / 1000),
          chat: {
            id: parseInt(body.chatId),
            type: "private"
          },
          from: {
            id: parseInt(body.userId),
            is_bot: false,
            first_name: "Test User"
          },
          text: body.text
        }
      };

      console.log(`[TEST ENDPOINT] Created TelegramUpdate:`, JSON.stringify(testUpdate, null, 2));

      // Create a response capture mechanism
      let capturedResponse: string | undefined = undefined;
      let capturedError: Error | undefined = undefined;
      let processingStartTime = Date.now();

      // Process through the real system orchestrator with response capture
      console.log(`[TEST ENDPOINT] Calling orchestrator.handleUpdate()...`);

      try {
        console.log(`[TEST ENDPOINT] BEFORE orchestrator.handleUpdate() - Test mode enabled, response will be captured`);

        await orchestrator.handleUpdate(testUpdate);

        console.log(`[TEST ENDPOINT] AFTER orchestrator.handleUpdate() - Message enqueued, waiting for processing to complete...`);

        // Wait for response capture with polling (max 90 seconds for LLM processing)
        const maxWaitTime = 90000; // 90 seconds
        const pollInterval = 500; // Check every 500ms
        let waitTime = 0;

        while (waitTime < maxWaitTime) {
          capturedResponse = telegramAdapterImpl.getCapturedResponse(parseInt(body.chatId));

          if (capturedResponse) {
            console.log(`[TEST ENDPOINT] SUCCESS: Response captured after ${waitTime}ms: "${capturedResponse.substring(0, 100)}..."`);
            break;
          }

          // Wait before next poll
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          waitTime += pollInterval;

          if (waitTime % 2000 === 0) { // Log every 2 seconds
            console.log(`[TEST ENDPOINT] Still waiting for response capture... (${waitTime}ms elapsed)`);
          }
        }

        if (!capturedResponse) {
          console.log(`[TEST ENDPOINT] TIMEOUT: No response captured after ${maxWaitTime}ms for chat ${body.chatId}`);
        }

      } catch (error) {
        console.error(`[TEST ENDPOINT] ERROR during orchestrator.handleUpdate():`, error);
        capturedError = error as Error;
      } finally {
        // Disable test mode after processing
        telegramAdapterImpl.setTestMode(false);
        console.log(`[TEST ENDPOINT] Test mode disabled`);
      }

      const processingTime = Date.now() - processingStartTime;

      // Return response with captured data
      const result = {
        success: !capturedError,
        message: capturedError ? "Test message processing failed" : "Test message processed successfully with real LLM integration",
        response: capturedResponse,
        processingTime,
        error: capturedError?.message,
        testInput: body,
        telegramUpdate: testUpdate,
        timestamp: new Date().toISOString(),
        note: "PROBLEM: This message was processed through SystemOrchestrator -> MessagePreProcessor (LLM) -> DecisionEngine -> ResponseGenerator, but the final response is sent via Telegram API calls that we cannot intercept in test mode."
      };

      console.log(`[TEST ENDPOINT] Real system processing complete, captured response:`, capturedResponse);

      return new Response(JSON.stringify(result, null, 2), {
        headers: { "Content-Type": "application/json" },
      });

    } catch (error) {
      console.error("Test message endpoint error:", error);
      return new Response(JSON.stringify({
        success: false,
        error: "Failed to process test message through real system",
        details: error.message
      }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
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
          const chatId = String(entry.key[1]);
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

      // Process the update asynchronously through the orchestrator
      // This allows us to return 200 OK immediately
      processUpdateAsync(update);

      return new Response("OK", { status: 200 });
    } catch (error) {
      console.error("Webhook processing error:", error);
      return new Response("Error", { status: 500 });
    }
  }

  return new Response("Not Found", { status: 404 });
});

// Process update asynchronously
async function processUpdateAsync(update: any) {
  try {
    await orchestrator.handleUpdate(update);
  } catch (error) {
    console.error("Error processing update:", error);
    // Error is already handled by the system orchestrator
  }
}
