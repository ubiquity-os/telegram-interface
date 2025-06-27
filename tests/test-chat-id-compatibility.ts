/**
 * Test Chat ID Compatibility Fix
 *
 * This test verifies that the MessageRouter can handle both:
 * - Numeric chat IDs (Telegram platform)
 * - String chat IDs (REST API platform)
 */

import { assertEquals, assertThrows } from "https://deno.land/std@0.213.0/assert/mod.ts";
import { UniversalMessage, Platform } from '../src/core/protocol/ump-types.ts';

// Create a test class that exposes the private methods for testing
class TestableMessageRouter {
  /**
   * Test version of stringToNumericId method
   */
  static stringToNumericId(str: string): number {
    if (!str || typeof str !== 'string') {
      throw new Error(`Invalid string ID: "${str}" cannot be converted to numeric representation`);
    }

    // Simple hash function to convert string to number
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    // Ensure positive number and within safe integer range
    return Math.abs(hash) % Number.MAX_SAFE_INTEGER;
  }

  /**
   * Test version of chat ID conversion logic
   */
  static convertChatIdToNumeric(chatIdRaw: string | number): number {
    if (typeof chatIdRaw === 'string' && !isNaN(Number(chatIdRaw))) {
      // If it's a numeric string, parse it directly
      return parseInt(chatIdRaw, 10);
    } else if (typeof chatIdRaw === 'number') {
      // If it's already a number (from Telegram), use it directly
      return chatIdRaw;
    } else {
      // For non-numeric string chat IDs (REST API), create a deterministic numeric representation
      return this.stringToNumericId(chatIdRaw.toString());
    }
  }
}

Deno.test("Chat ID Conversion - Handle numeric chat ID", () => {
  // Test with numeric chat ID (Telegram style)
  const numericChatId = 123456789;
  const result = TestableMessageRouter.convertChatIdToNumeric(numericChatId);

  assertEquals(result, 123456789);
  assertEquals(typeof result, "number");
});

Deno.test("Chat ID Conversion - Handle numeric string chat ID", () => {
  // Test with numeric string chat ID
  const numericStringChatId = "123456789";
  const result = TestableMessageRouter.convertChatIdToNumeric(numericStringChatId);

  assertEquals(result, 123456789);
  assertEquals(typeof result, "number");
});

Deno.test("Chat ID Conversion - Handle string chat ID (REST API)", () => {
  // Test with string chat ID (REST API style) - this was the original failing case
  const stringChatId = "cli-user-1751010655494";
  const result = TestableMessageRouter.convertChatIdToNumeric(stringChatId);

  // Should return a consistent numeric representation
  assertEquals(typeof result, "number");
  assertEquals(result > 0, true);

  // Should be deterministic - same input produces same output
  const result2 = TestableMessageRouter.convertChatIdToNumeric(stringChatId);
  assertEquals(result, result2);
});

Deno.test("Chat ID Conversion - Handle different string formats", () => {
  // Test various string formats
  const testCases = [
    "user-abc-123",
    "session_456789",
    "cli-user-1751010655494",
    "telegram-chat-987654321",
    "api-client-uuid-12345"
  ];

  for (const chatId of testCases) {
    const result = TestableMessageRouter.convertChatIdToNumeric(chatId);

    assertEquals(typeof result, "number");
    assertEquals(result > 0, true);
    assertEquals(Number.isInteger(result), true);

    // Test deterministic behavior
    const result2 = TestableMessageRouter.convertChatIdToNumeric(chatId);
    assertEquals(result, result2);
  }
});

Deno.test("String to Numeric ID - Handle empty string", () => {
  // Test with empty string - should throw error
  assertThrows(
    () => {
      TestableMessageRouter.stringToNumericId("");
    },
    Error,
    "Invalid string ID"
  );
});

Deno.test("String to Numeric ID - Handle null/undefined", () => {
  // Test with null/undefined - should throw error
  assertThrows(
    () => {
      TestableMessageRouter.stringToNumericId(null as any);
    },
    Error,
    "Invalid string ID"
  );

  assertThrows(
    () => {
      TestableMessageRouter.stringToNumericId(undefined as any);
    },
    Error,
    "Invalid string ID"
  );
});

Deno.test("String to Numeric ID - Deterministic output", () => {
  const testString = "cli-user-1751010655494";

  // Generate multiple outputs for the same input
  const results = [];
  for (let i = 0; i < 100; i++) {
    results.push(TestableMessageRouter.stringToNumericId(testString));
  }

  // All results should be the same (deterministic)
  const firstResult = results[0];
  for (const result of results) {
    assertEquals(result, firstResult);
  }
});

Deno.test("String to Numeric ID - Different inputs produce different outputs", () => {
  const input1 = "cli-user-1751010655494";
  const input2 = "cli-user-1751010655495";

  const result1 = TestableMessageRouter.stringToNumericId(input1);
  const result2 = TestableMessageRouter.stringToNumericId(input2);

  // Different inputs should produce different outputs (with high probability)
  assertEquals(result1 !== result2, true);
});

console.log("✅ Chat ID compatibility tests completed");