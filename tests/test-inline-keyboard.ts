import { load } from "std/dotenv/mod.ts";
import { Bot, InlineKeyboard } from "grammy";
import { getAIResponse, getLastToolResult } from "../src/services/get-ai-response.ts";
import { mcpHub } from "../src/services/mcp-hub.ts";

// Load .env file
await load({ export: true }).catch(() => {
  // Ignore error if .env doesn't exist
});

// Mock conversation history
const mockConversationHistory = new Map<number, any[]>();
globalThis.Deno.openKv = async () => {
  return {
    get: async (key: string[]) => ({ value: mockConversationHistory.get(Number(key[1])) || [] }),
    set: async (key: string[], value: any) => { mockConversationHistory.set(Number(key[1]), value); },
    delete: async (key: string[]) => { mockConversationHistory.delete(Number(key[1])); },
    list: async function* () { yield* []; },
    close: () => {},
  } as any;
};

async function testInlineKeyboard() {
  console.log("=== Testing Inline Keyboard Integration ===\n");
  
  // Initialize MCP hub
  await mcpHub.loadSettings();
  await mcpHub.connectAll();
  
  const TEST_CHAT_ID = 888888;
  
  // Test 1: Simulate a message that triggers ask_followup_question with options
  console.log("Test 1: Triggering followup question with options...");
  
  // This prompt should trigger the LLM to use ask_followup_question with options
  const testMessage = "I need help choosing a programming language. Can you ask me about my preferences?";
  
  try {
    const response = await getAIResponse(testMessage, TEST_CHAT_ID);
    console.log("AI Response:", response);
    
    // Check if we have a tool result with options
    const toolResult = getLastToolResult();
    console.log("\nTool Result:", toolResult);
    
    if (toolResult?.type === "followup_question" && toolResult.options) {
      console.log("✅ Followup question with options detected!");
      console.log("Question:", toolResult.question);
      console.log("Options:", toolResult.options);
      
      // Simulate creating inline keyboard (as the message handler would)
      const keyboard = new InlineKeyboard();
      toolResult.options.forEach((option: string, index: number) => {
        keyboard.text(option, `option_${TEST_CHAT_ID}_${index}`).row();
      });
      
      console.log("\n✅ Inline keyboard would be created with", toolResult.options.length, "buttons");
      
      // Test 2: Simulate selecting an option
      console.log("\nTest 2: Simulating option selection...");
      const selectedIndex = 0;
      const selectedOption = toolResult.options[selectedIndex];
      console.log("Selecting option:", selectedOption);
      
      // Process the selection as if it came from a callback query
      const selectionResponse = await getAIResponse(selectedOption, TEST_CHAT_ID);
      console.log("\nAI Response to selection:", selectionResponse.substring(0, 200) + "...");
      
      console.log("\n✅ Option selection processed successfully!");
    } else {
      console.log("❌ No followup question with options was generated");
      console.log("Try adjusting the prompt to trigger ask_followup_question tool");
    }
    
  } catch (error) {
    console.error("❌ Error:", error);
  }
  
  // Test 3: Direct tool execution test
  console.log("\n\nTest 3: Direct tool execution test...");
  
  // Manually create a followup question with options
  const manualPrompt = `Please help me choose a database.
<ask_followup_question>
<question>What type of database would work best for your project?</question>
<options>["PostgreSQL (Relational)", "MongoDB (NoSQL)", "Redis (Key-Value)", "Neo4j (Graph)"]</options>
</ask_followup_question>`;
  
  try {
    // Clear previous tool result
    const response = await getAIResponse(manualPrompt, TEST_CHAT_ID + 1);
    const toolResult = getLastToolResult();
    
    if (toolResult?.type === "followup_question" && toolResult.options) {
      console.log("✅ Manual followup question processed!");
      console.log("Question:", toolResult.question);
      console.log("Options:", toolResult.options);
      console.log("\nThis would create an inline keyboard with 4 database options");
    }
  } catch (error) {
    console.error("❌ Error in manual test:", error);
  }
  
  console.log("\n=== Test Complete ===");
}

testInlineKeyboard().catch(console.error);
