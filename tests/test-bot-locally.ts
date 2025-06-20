import { load } from "std/dotenv/mod.ts";
import { Bot } from "grammy";
import { messageHandler } from "../src/handlers/message.ts";
import { generateSystemPrompt } from "../src/services/system-prompt.ts";
import { mcpHub } from "../src/services/mcp-hub.ts";

// Load .env file
await load({ export: true }).catch(() => {
  // Ignore error if .env doesn't exist
});

// Mock Telegram Update for testing
interface MockUpdate {
  message: {
    chat: {
      id: number;
    };
    text: string;
    from: {
      username?: string;
      first_name: string;
    };
  };
}

async function testBot() {
  console.log("=== Testing Telegram Bot with Tool Calling ===\n");

  // 1. Test system prompt generation
  console.log("1. Testing system prompt generation...");
  await mcpHub.loadSettings();
  await mcpHub.connectAll();
  
  const systemPrompt = await generateSystemPrompt();
  console.log("System prompt length:", systemPrompt.length);
  console.log("Contains ask_followup_question:", systemPrompt.includes("ask_followup_question"));
  console.log("Contains attempt_completion:", systemPrompt.includes("attempt_completion"));
  console.log("Contains use_mcp_tool:", systemPrompt.includes("use_mcp_tool"));
  console.log("Contains weather tool:", systemPrompt.includes("weather"));
  console.log("\n");

  // 2. Test message handler with a simple message
  console.log("2. Testing message handler with simple message...");
  
  // Create a mock context
  const mockCtx = {
    message: {
      chat: { id: 12345 },
      text: "Hello, how are you?",
      from: {
        username: "testuser",
        first_name: "Test User"
      }
    },
    reply: (text: string) => {
      console.log("Bot reply (simple):", text.substring(0, 100) + (text.length > 100 ? "..." : ""));
      return Promise.resolve({} as any);
    }
  };

  try {
    await messageHandler(mockCtx as any);
    console.log("✓ Simple message handled successfully\n");
  } catch (error) {
    console.error("✗ Error handling simple message:", error);
  }

  // 3. Test with a tool-triggering message
  console.log("3. Testing message handler with tool-triggering message...");
  
  const mockCtx2 = {
    message: {
      chat: { id: 12346 },
      text: "What's the weather in San Francisco?",
      from: {
        username: "testuser2",
        first_name: "Test User 2"
      }
    },
    reply: (text: string) => {
      console.log("Bot reply (tool):", text.substring(0, 200) + (text.length > 200 ? "..." : ""));
      return Promise.resolve({} as any);
    }
  };

  try {
    await messageHandler(mockCtx2 as any);
    console.log("✓ Tool-triggering message handled successfully\n");
  } catch (error) {
    console.error("✗ Error handling tool message:", error);
  }

  // 4. Test MCP Hub directly
  console.log("4. Testing MCP Hub directly...");
  const tools = mcpHub.getAllTools();
  console.log(`Found ${tools.length} MCP tools:`);
  for (const { serverName, tool } of tools) {
    console.log(`  - ${serverName}/${tool.name}: ${tool.description || "No description"}`);
  }
  
  // Test weather tool execution
  if (tools.length > 0) {
    try {
      const result = await mcpHub.executeTool("weather", "get_weather", { city: "Tokyo" });
      console.log("Weather tool result:", result);
    } catch (error) {
      console.error("Error executing weather tool:", error);
    }
  }
}

// Run the test
if (import.meta.main) {
  // Check for required environment variables
  if (!Deno.env.get("BOT_TOKEN")) {
    console.error("Error: BOT_TOKEN environment variable is not set");
    console.log("Please set it in your .env file or environment");
    Deno.exit(1);
  }

  if (!Deno.env.get("OPENROUTER_API_KEY")) {
    console.error("Error: OPENROUTER_API_KEY environment variable is not set");
    console.log("Please set it in your .env file or environment");
    Deno.exit(1);
  }

  testBot().then(() => {
    console.log("\n=== Test completed ===");
    Deno.exit(0);
  }).catch((error) => {
    console.error("\n=== Test failed ===", error);
    Deno.exit(1);
  });
}