/**
 * End-to-End Testing Script for Telegram Bot API
 *
 * This script demonstrates how to test the Telegram bot messaging capabilities
 * without requiring actual Telegram integration.
 */

const BASE_URL = "http://localhost:8000";

interface TestCase {
  name: string;
  message: string;
  chatId: number;
  expectedSuccess: boolean;
  description: string;
}

const testCases: TestCase[] = [
  {
    name: "Basic Greeting",
    message: "Hello!",
    chatId: 999001,
    expectedSuccess: true,
    description: "Test basic conversation with AI"
  },
  {
    name: "Weather Query",
    message: "What's the weather in Tokyo?",
    chatId: 999002,
    expectedSuccess: true,
    description: "Test tool calling with weather API"
  },
  {
    name: "Follow-up Question",
    message: "What about tomorrow?",
    chatId: 999002, // Same chat ID to test conversation context
    expectedSuccess: true,
    description: "Test conversation context and follow-up"
  },
  {
    name: "Complex Question",
    message: "Can you help me understand how machine learning works?",
    chatId: 999003,
    expectedSuccess: true,
    description: "Test AI reasoning capabilities"
  },
  {
    name: "Tool Selection Question",
    message: "I need help choosing between option A and option B",
    chatId: 999004,
    expectedSuccess: true,
    description: "Test potential inline keyboard generation"
  }
];

async function testEndpoint(testCase: TestCase): Promise<void> {
  console.log(`\n🧪 Testing: ${testCase.name}`);
  console.log(`📝 Description: ${testCase.description}`);
  console.log(`💬 Message: "${testCase.message}"`);

  const startTime = Date.now();

  try {
    const response = await fetch(`${BASE_URL}/test/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: testCase.message,
        chatId: String(testCase.chatId),
        userId: "12345",
        username: "testuser",
        firstName: "Test User"
      }),
    });

    const result = await response.json();
    const requestTime = Date.now() - startTime;

    if (response.ok && result.success === testCase.expectedSuccess) {
      console.log(`✅ SUCCESS (${requestTime}ms)`);
      console.log(`🤖 Bot Response: ${result.response?.substring(0, 150)}${result.response?.length > 150 ? "..." : ""}`);

      if (result.metadata) {
        console.log(`⏱️  Processing Time: ${result.metadata.processingTime}ms`);
        console.log(`💬 Chat ID: ${result.metadata.chatId}`);
        console.log(`⌨️  Has Inline Keyboard: ${result.metadata.hasInlineKeyboard}`);

        if (result.inlineKeyboard) {
          console.log(`🔘 Keyboard Options: ${result.inlineKeyboard.options.join(", ")}`);
        }
      }
    } else {
      console.log(`❌ FAILED (${requestTime}ms)`);
      console.log(`Expected success: ${testCase.expectedSuccess}, got: ${result.success}`);
      if (result.error) {
        console.log(`Error: ${result.error}`);
      }
    }

  } catch (error) {
    console.log(`💥 REQUEST FAILED: ${error.message}`);
  }
}

async function testHealthEndpoint(): Promise<void> {
  console.log("\n🏥 Testing Health Endpoint");

  try {
    const response = await fetch(`${BASE_URL}/health`);
    const result = await response.json();

    if (response.ok && result.status === "ok") {
      console.log("✅ Health check passed");
      console.log(`📊 Deduplication cache size: ${result.deduplicationCacheSize}`);
    } else {
      console.log("❌ Health check failed");
    }
  } catch (error) {
    console.log(`💥 Health check request failed: ${error.message}`);
  }
}

async function testConversationHistory(): Promise<void> {
  console.log("\n💾 Testing Conversation History");

  try {
    const response = await fetch(`${BASE_URL}/conversations?limit=3`);
    const result = await response.json();

    if (response.ok) {
      console.log("✅ Conversation history retrieved");
      console.log(`📈 Total chats: ${result.stats?.totalChats || 0}`);
      console.log(`📝 Total messages: ${result.stats?.totalMessages || 0}`);
      console.log(`🗂️  Recent conversations: ${result.conversations?.length || 0}`);
    } else {
      console.log("❌ Failed to retrieve conversation history");
    }
  } catch (error) {
    console.log(`💥 Conversation history request failed: ${error.message}`);
  }
}

async function testInvalidRequests(): Promise<void> {
  console.log("\n🚫 Testing Invalid Requests");

  // Test missing text (was message)
  try {
    const response = await fetch(`${BASE_URL}/test/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId: "999" }),
    });

    const result = await response.json();
    if (response.status === 400 && !result.success) {
      console.log("✅ Correctly rejected request with missing text");
    } else {
      console.log("❌ Should have rejected request with missing text");
    }
  } catch (error) {
    console.log(`💥 Invalid request test failed: ${error.message}`);
  }

  // Test missing chatId
  try {
    const response = await fetch(`${BASE_URL}/test/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Hello" }),
    });

    const result = await response.json();
    if (response.status === 400 && !result.success) {
      console.log("✅ Correctly rejected request with missing chatId");
    } else {
      console.log("❌ Should have rejected request with missing chatId");
    }
  } catch (error) {
    console.log(`💥 Invalid request test failed: ${error.message}`);
  }
}

async function runAllTests(): Promise<void> {
  console.log("🚀 Starting End-to-End API Tests");
  console.log(`🎯 Target: ${BASE_URL}`);
  console.log("=".repeat(50));

  // Test health endpoint first
  await testHealthEndpoint();

  // Test invalid requests
  await testInvalidRequests();

  // Run all test cases
  for (const testCase of testCases) {
    await testEndpoint(testCase);
    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Test conversation history
  await testConversationHistory();

  console.log("\n" + "=".repeat(50));
  console.log("🏁 All tests completed!");
  console.log("\n📋 Usage Examples:");
  console.log("# Basic test");
  console.log(`curl -X POST ${BASE_URL}/test/message \\`);
  console.log(`  -H "Content-Type: application/json" \\`);
  console.log(`  -d '{"text": "Hello!", "chatId": "999", "userId": "12345"}'`);
  console.log("\n# Weather test");
  console.log(`curl -X POST ${BASE_URL}/test/message \\`);
  console.log(`  -H "Content-Type: application/json" \\`);
  console.log(`  -d '{"text": "What is the weather in San Francisco?", "chatId": "999", "userId": "12345"}'`);
}

// Run tests if this script is executed directly
if (import.meta.main) {
  runAllTests().catch(console.error);
}

export { runAllTests, testEndpoint, testCases };
