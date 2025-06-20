import { load } from "std/dotenv/mod.ts";
import { getAIResponse } from "../src/services/get-ai-response.ts";

// Load .env file
await load({ export: true }).catch(() => {
  // Ignore error if .env doesn't exist
});

// Use mock conversation history for local testing
const mockConversationHistory = new Map<number, any[]>();

// Override the conversation history import
const originalAddMessage = globalThis.Deno.openKv;
globalThis.Deno.openKv = async () => {
  return {
    get: async (key: string[]) => ({ value: mockConversationHistory.get(Number(key[1])) || [] }),
    set: async (key: string[], value: any) => { mockConversationHistory.set(Number(key[1]), value); },
    delete: async (key: string[]) => { mockConversationHistory.delete(Number(key[1])); },
    list: async function* () { yield* []; },
    close: () => {},
  } as any;
};

async function testRetryIntegration() {
  console.log("=== Testing Retry Integration ===\n");
  
  const TEST_CHAT_ID = 666666;
  
  // Test 1: Query about tools (should trigger retry if needed)
  console.log("Test 1: Asking about tools...");
  const toolQuery = "hey what tools do you have available to call right now? mcps?";
  
  try {
    const response = await getAIResponse(toolQuery, TEST_CHAT_ID);
    console.log("\nFinal response:");
    console.log(response);
    
    // Check if response mentions tools
    const hasToolInfo = response.toLowerCase().includes("tool") || 
                       response.toLowerCase().includes("weather") ||
                       response.toLowerCase().includes("ask_followup_question");
    
    console.log("\nResponse mentions tools:", hasToolInfo);
    
  } catch (error) {
    console.error("Error:", error);
  }
  
  // Test 2: Regular message (should not trigger retry)
  console.log("\n\nTest 2: Regular message...");
  const regularQuery = "Hello, how are you today?";
  
  try {
    const response = await getAIResponse(regularQuery, TEST_CHAT_ID + 1);
    console.log("\nFinal response:");
    console.log(response.substring(0, 200) + "...");
    
  } catch (error) {
    console.error("Error:", error);
  }
  
  // Test 3: Weather query (should use weather tool)
  console.log("\n\nTest 3: Weather query...");
  const weatherQuery = "What's the weather in London?";
  
  try {
    const response = await getAIResponse(weatherQuery, TEST_CHAT_ID + 2);
    console.log("\nFinal response:");
    console.log(response);
    
    const hasWeatherInfo = response.toLowerCase().includes("london") || 
                          response.toLowerCase().includes("weather");
    
    console.log("\nResponse mentions weather:", hasWeatherInfo);
    
  } catch (error) {
    console.error("Error:", error);
  }
}

testRetryIntegration().catch(console.error);
