import { load } from "std/dotenv/mod.ts";
import { callOpenRouter } from "../src/services/call-openrouter.ts";
import { OpenRouterMessage } from "../src/services/openrouter-types.ts";
import { parseAssistantMessage } from "../src/services/tool-parser.ts";
import { isValidResponse, generateInvalidResponseError } from "../src/services/response-validation.ts";
import { generateSystemPrompt } from "../src/services/system-prompt.ts";
import { mcpHub } from "../src/services/mcp-hub.ts";

// Load .env file
await load({ export: true }).catch(() => {
  // Ignore error if .env doesn't exist
});

async function testUniversalRetry() {
  console.log("=== Testing Universal Retry Mechanism ===\n");
  
  // Initialize MCP
  await mcpHub.loadSettings();
  await mcpHub.connectAll();
  
  // Generate system prompt
  const systemPrompt = await generateSystemPrompt();
  
  // Test various message types
  const testMessages = [
    "What's the weather in Paris?",
    "Hello, how are you?",
    "What tools do you have?",
    "Tell me a joke",
    "Calculate 2+2"
  ];
  
  const MODEL = "deepseek/deepseek-r1-0528:free";
  
  for (const userMessage of testMessages) {
    console.log(`\n=== Testing: "${userMessage}" ===`);
    
    let messages: OpenRouterMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage }
    ];
    
    let retryCount = 0;
    const MAX_RETRIES = 3;
    let validResponse = false;
    
    while (retryCount < MAX_RETRIES && !validResponse) {
      console.log(`\nAttempt ${retryCount + 1}:`);
      
      try {
        // Simulate an empty/invalid response to test retry
        let response: string;
        if (retryCount === 0 && Math.random() < 0.5) {
          // Simulate invalid response 50% of the time on first attempt
          response = "";
          console.log("Simulating empty response...");
        } else {
          response = await callOpenRouter(messages, MODEL);
        }
        
        console.log("LLM Response preview:", response.substring(0, 100) + "...");
        
        // Parse and validate
        const contentBlocks = parseAssistantMessage(response);
        validResponse = isValidResponse(contentBlocks);
        
        console.log("Content blocks:", contentBlocks.length);
        console.log("Valid response:", validResponse);
        
        if (!validResponse) {
          console.log("❌ Invalid response detected, adding error message...");
          
          messages.push({ role: "assistant", content: response });
          messages.push({ role: "user", content: generateInvalidResponseError() });
          
          retryCount++;
        } else {
          console.log("✅ Valid response!");
          
          // Show what type of response it was
          const hasText = contentBlocks.some(b => b.type === "text" && b.content);
          const hasTools = contentBlocks.some(b => b.type === "tool_use");
          console.log(`Response type: ${hasText ? "Text" : ""} ${hasTools ? "Tool" : ""}`);
        }
        
      } catch (error) {
        console.error("Error:", error);
        break;
      }
    }
    
    if (!validResponse) {
      console.log("⚠️ Failed to get valid response after retries");
    }
  }
  
  console.log("\n=== Test Complete ===");
}

testUniversalRetry().catch(console.error);
