import { expect, test, describe } from "bun:test";
import { handleTestMessage } from "../../src/handlers/test-message-handler.ts";

describe("handleTestMessage", () => {
  test("should process valid requests", async () => {
    const testRequest = {
      userId: "123456",
      chatId: "789012",
      text: "Hello, this is a test message"
    };

    const result = await handleTestMessage(testRequest);

    // Should return success
    expect(result.success).toBe(true);

    // Should have a response
    expect(result.response).toBeDefined();
    expect(result.response?.chatId).toBe(789012);
    expect(result.response?.text).toBeDefined();

    // Should have metadata
    expect(result.metadata).toBeDefined();
    expect(result.metadata.chatId).toBe("789012");
    expect(result.metadata.userId).toBe("123456");
    expect(result.metadata.processingTime).toBeDefined();
    expect(result.metadata.timestamp).toBeDefined();
  });

  test("should handle missing text field", async () => {
    const testRequest = {
      userId: "123456",
      chatId: "789012",
      text: ""
    };

    const result = await handleTestMessage(testRequest);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toBe("Missing or invalid 'text' field");
  });

  test("should handle missing chatId field", async () => {
    const testRequest = {
      userId: "123456",
      chatId: "",
      text: "Hello"
    };

    const result = await handleTestMessage(testRequest);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toBe("Missing or invalid 'chatId' field");
  });

  test("should handle missing userId field", async () => {
    const testRequest = {
      userId: "",
      chatId: "789012",
      text: "Hello"
    };

    const result = await handleTestMessage(testRequest);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toBe("Missing or invalid 'userId' field");
  });

  test("should handle invalid chatId", async () => {
    const testRequest = {
      userId: "123456",
      chatId: "invalid",
      text: "Hello"
    };

    const result = await handleTestMessage(testRequest);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toBe("chatId and userId must be valid numbers");
  });

  test("should handle invalid userId", async () => {
    const testRequest = {
      userId: "invalid",
      chatId: "789012",
      text: "Hello"
    };

    const result = await handleTestMessage(testRequest);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toBe("chatId and userId must be valid numbers");
  });
});