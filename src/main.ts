import { getConfig } from "./utils/config.ts";
import { deduplicationService } from "./services/deduplication.ts";
import { eventBus, createEventEmitter, SystemEventType } from "./services/event-bus/index.ts";
import { LlmService } from "./services/llm-service/index.ts";
import { SimpleErrorHandler } from "./services/error-handler.ts";

// Import all components
import { SystemOrchestrator } from "./components/system-orchestrator/index.ts";
import { TelegramInterfaceAdapter } from "./components/telegram-interface-adapter/telegram-interface-adapter.ts";
import { MessagePreProcessor } from "./components/message-pre-processor/index.ts";
import { DecisionEngine } from "./components/decision-engine/decision-engine.ts";
import { ContextManager } from "./components/context-manager/index.ts";
import { ResponseGenerator } from "./components/response-generator/index.ts";
import { KVContextStorage } from "./components/context-manager/kv-context-storage.ts";
import { LLMServiceAdapter } from "./components/message-pre-processor/llm-service-adapter.ts";

// Import types
import { SystemOrchestratorConfig, ComponentDependencies } from "./components/system-orchestrator/types.ts";
import { TelegramInterfaceAdapterConfig } from "./components/telegram-interface-adapter/types.ts";
import { MessagePreProcessorConfig } from "./components/message-pre-processor/types.ts";
import { DecisionEngineConfig } from "./components/decision-engine/types.ts";
import { ContextManagerConfig } from "./components/context-manager/types.ts";
import { ResponseGeneratorConfig } from "./components/response-generator/types.ts";

// Load config
const config = await getConfig();

// Create LLM service instance
const llmService = new LlmService();
const llmServiceAdapter = new LLMServiceAdapter();

// Create component configurations
const telegramConfig: TelegramInterfaceAdapterConfig = {
  botToken: config.botToken,
  maxMessageLength: 4096,
  rateLimits: {
    maxMessagesPerSecond: 30,
    maxMessagesPerMinute: 20 * 60,
    maxMessagesPerHour: 1000 * 60
  },
  queueConfig: {
    maxQueueSize: 100,
    processingInterval: 100,
    maxRetries: 3
  }
};

const messagePreProcessorConfig: MessagePreProcessorConfig = {
  maxCacheSize: 1000,
  cacheTTL: 60 * 60 * 1000, // 1 hour
  temperature: 0.7,
  verbose: false,
  confidenceThreshold: 0.8
};

const contextConfig: ContextManagerConfig = {
  storage: {
    type: 'deno-kv',
    kvPath: undefined // Use default KV path
  },
  limits: {
    maxConversationAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    maxMessagesPerChat: 100,
    maxStorageSize: 1024 * 1024 * 1024 // 1GB
  },
  cleanup: {
    enabled: true,
    interval: 60 * 60 * 1000, // 1 hour
    batchSize: 10
  }
};

const responseGeneratorConfig: ResponseGeneratorConfig = {
  maxResponseLength: 4000,
  enableMarkdown: true,
  temperature: 0.7,
  maxButtonsPerRow: 3,
  maxRows: 10
};

// Create context storage
const contextStorage = new KVContextStorage();
await contextStorage.initialize();

// Create component instances
const telegramAdapter = new TelegramInterfaceAdapter(telegramConfig);

const messagePreProcessor = new MessagePreProcessor(
  llmServiceAdapter,
  messagePreProcessorConfig
);

const decisionEngine = new DecisionEngine({
  maxStateRetention: 1000,
  defaultTimeout: 30000,
  enableStatePersistence: true,
  debugMode: false
});

const contextManager = new ContextManager(
  contextConfig,
  contextStorage
);

const responseGenerator = new ResponseGenerator(
  llmService,
  responseGeneratorConfig
);

const errorHandler = new SimpleErrorHandler();

// Initialize error handler first
await errorHandler.initialize();

// Initialize all components
await telegramAdapter.initialize();
await messagePreProcessor.initialize();
await decisionEngine.initialize();
await contextManager.initialize();
await responseGenerator.initialize();

// Create system orchestrator configuration
const orchestratorConfig: SystemOrchestratorConfig = {
  telegramConfig: {
    botToken: config.botToken,
    webhookSecret: config.webhookSecret
  },
  enableMCPTools: true,
  enableSelfModeration: true,
  enableErrorRecovery: true,
  requestTimeout: 30000,
  maxRetries: 3,
  logLevel: 'info'
};

// Create component dependencies
const componentDependencies: ComponentDependencies = {
  telegramAdapter,
  messagePreProcessor,
  decisionEngine,
  contextManager,
  responseGenerator,
  errorHandler
};

// Initialize the system orchestrator with dependencies
const orchestrator = new SystemOrchestrator(componentDependencies);
await orchestrator.initialize(orchestratorConfig);

console.log("System Orchestrator initialized successfully");

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

      // Import and use the new test message handler
      const { handleTestMessage } = await import("./handlers/test-message-handler.ts");
      const result = await handleTestMessage(body);

      return new Response(JSON.stringify(result, null, 2), {
        headers: { "Content-Type": "application/json" },
      });

    } catch (error) {
      console.error("Test message endpoint error:", error);
      return new Response(JSON.stringify({
        success: false,
        error: "Failed to process test message",
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
async function processUpdateAsync(update: any) {
  try {
    // Let the orchestrator handle the update
    await orchestrator.handleUpdate(update);
  } catch (error) {
    console.error("Error processing update asynchronously:", error);
  }
}
