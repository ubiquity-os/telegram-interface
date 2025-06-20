import { getRandomProcessingMessage, getLongProcessingMessage, getRetryMessage } from "../src/services/processing-messages.ts";

console.log("=== Testing Processing Messages ===\n");

// Test 1: Random processing messages
console.log("Test 1: Random processing messages");
for (let i = 0; i < 5; i++) {
  console.log(`  ${i + 1}. ${getRandomProcessingMessage()}`);
}

// Test 2: Tool-specific messages
console.log("\nTest 2: Tool-specific messages");
console.log(`  Weather: ${getRandomProcessingMessage("weather")}`);
console.log(`  Search: ${getRandomProcessingMessage("search")}`);
console.log(`  Followup: ${getRandomProcessingMessage("followup")}`);
console.log(`  Unknown tool: ${getRandomProcessingMessage("unknown")}`);

// Test 3: Long processing messages
console.log("\nTest 3: Long processing messages");
for (let i = 0; i < 3; i++) {
  console.log(`  ${i + 1}. ${getLongProcessingMessage()}`);
}

// Test 4: Retry messages
console.log("\nTest 4: Retry messages");
for (let i = 1; i <= 3; i++) {
  console.log(`  ${getRetryMessage(i)}`);
}

console.log("\n✅ All processing message tests passed!");
