import { load } from "std/dotenv/mod.ts";
import { getAIResponse } from "../src/services/get-ai-response.ts";

// Load .env file
await load({ export: true }).catch(() => {
  // Ignore error if .env doesn't exist
});

// Use mock conversation history
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

async function testUniversalValidation() {
  console.log("=== Testing Universal Validation ===\n");
  
  const TEST_CHAT_ID = 777777;
  
  // Test different types of messages
  const testCases = [
    {
      name: "Simple greeting",
      message: "Hello!",
      expectTool: false
    },
    {
      name: "Weather query",
      message: "What's the weather in Tokyo?",
      expectTool: true
    },
    {
      name: "Tool capability query",
      message: "What tools do you have available?",
      expectTool: true // Should use ask_followup_question
    },
    {
      name: "Math question",
      message: "What is 2 + 2?",
      expectTool: false
    }
  ];
  
  for (const testCase of testCases) {
    console.log(`\n--- Test: ${testCase.name} ---`);
    console.log(`Message: "${testCase.message}"`);
    
    try {
      const response = await getAIResponse(testCase.message, TEST_CHAT_ID + Math.random());
      
      console.log(`Response preview: ${response.substring(0, 150)}${response.length > 150 ? '...' : ''}`);
      console.log(`Response length: ${response.length} chars`);
      console.log(`Expected tool use: ${testCase.expectTool}`);
      
      // Validate response is not empty
      if (response.length === 0) {
        console.log("❌ FAIL: Empty response");
      } else {
        console.log("✅ PASS: Valid response received");
      }
      
    } catch (error) {
      console.error("❌ Error:", error.message);
    }
  }
  
  console.log("\n=== Test Complete ===");
}

testUniversalValidation().catch(console.error);
