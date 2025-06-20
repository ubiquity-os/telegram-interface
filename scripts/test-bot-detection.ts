#!/usr/bin/env -S deno run --allow-env --allow-read

import { detectBotFromUpdate, type TelegramUpdate } from "../src/services/bot-detection.ts";
import { getConfig } from "../src/utils/config.ts";

const config = getConfig();

console.log("🧪 Testing Bot Detection System");
console.log("==================================");
console.log(`Production Bot ID: ${config.botId}`);
console.log(`Preview Bot ID: ${config.previewBotId || "not configured"}`);
console.log("");

// Test cases with different Telegram update structures
const testCases: Array<{ name: string; update: TelegramUpdate; expectedBotType?: "production" | "preview" }> = [
  {
    name: "Message with via_bot (production)",
    update: {
      update_id: 1001,
      message: {
        message_id: 123,
        chat: { id: 456789, type: "private" },
        from: { id: 987654, is_bot: false },
        via_bot: { id: parseInt(config.botId), username: "production_bot", first_name: "Production Bot" }
      }
    },
    expectedBotType: "production"
  },
  {
    name: "Message with via_bot (preview)",
    update: {
      update_id: 1002,
      message: {
        message_id: 124,
        chat: { id: 456790, type: "private" },
        from: { id: 987655, is_bot: false },
        via_bot: { id: config.previewBotId ? parseInt(config.previewBotId) : 999999, username: "preview_bot", first_name: "Preview Bot" }
      }
    },
    expectedBotType: config.previewBotId ? "preview" : undefined
  },
  {
    name: "Callback query with via_bot (production)",
    update: {
      update_id: 1003,
      callback_query: {
        from: { id: 987656 },
        message: {
          chat: { id: 456791 },
          via_bot: { id: parseInt(config.botId) }
        }
      }
    },
    expectedBotType: "production"
  },
  {
    name: "Edited message with via_bot (production)",
    update: {
      update_id: 1004,
      edited_message: {
        chat: { id: 456792 },
        via_bot: { id: parseInt(config.botId) }
      }
    },
    expectedBotType: "production"
  },
  {
    name: "Private chat with bot ID as chat ID (production)",
    update: {
      update_id: 1005,
      message: {
        message_id: 125,
        chat: { id: parseInt(config.botId), type: "private" },
        from: { id: 987657, is_bot: false }
      }
    },
    expectedBotType: "production"
  },
  {
    name: "Channel post with via_bot (production)",
    update: {
      update_id: 1006,
      channel_post: {
        chat: { id: -1001234567890 },
        via_bot: { id: parseInt(config.botId) }
      }
    },
    expectedBotType: "production"
  },
  {
    name: "Message without bot identification (should fail)",
    update: {
      update_id: 1007,
      message: {
        message_id: 126,
        chat: { id: 456793, type: "private" },
        from: { id: 987658, is_bot: false }
      }
    },
    expectedBotType: undefined
  }
];

let passedTests = 0;
let totalTests = testCases.length;

for (const testCase of testCases) {
  console.log(`\n🔍 Testing: ${testCase.name}`);
  console.log("-----------------------------------");
  
  try {
    const result = detectBotFromUpdate(
      testCase.update,
      config.botId,
      config.previewBotId,
      config.botToken,
      config.previewBotToken
    );
    
    if (testCase.expectedBotType) {
      if (result.botType === testCase.expectedBotType) {
        console.log(`✅ PASS: Detected ${result.botType} bot (ID: ${result.detectedBotId})`);
        console.log(`   Detection method: ${result.detectionMethod}`);
        passedTests++;
      } else {
        console.log(`❌ FAIL: Expected ${testCase.expectedBotType} but got ${result.botType}`);
      }
    } else {
      console.log(`❌ FAIL: Expected test to fail but got result: ${result.botType}`);
    }
  } catch (error) {
    if (testCase.expectedBotType) {
      console.log(`❌ FAIL: Expected ${testCase.expectedBotType} but got error: ${error.message}`);
    } else {
      console.log(`✅ PASS: Test correctly failed with error: ${error.message}`);
      passedTests++;
    }
  }
}

console.log("\n🏁 Test Results");
console.log("================");
console.log(`Passed: ${passedTests}/${totalTests}`);

if (passedTests === totalTests) {
  console.log("🎉 All tests passed!");
} else {
  console.log(`❌ ${totalTests - passedTests} test(s) failed`);
  Deno.exit(1);
}

// Additional manual test section
console.log("\n🔧 Manual Testing");
console.log("==================");
console.log("To manually test with real Telegram updates:");
console.log("1. Send a message to your bot");
console.log("2. Check the server logs for the update structure");
console.log("3. Use the detected bot ID to verify detection works");
console.log("");
console.log("Expected bot IDs in updates:");
console.log(`- Production: ${config.botId}`);
if (config.previewBotId) {
  console.log(`- Preview: ${config.previewBotId}`);
} else {
  console.log("- Preview: Not configured");
}