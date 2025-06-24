import { messageHandler } from "../handlers/message.ts";
import { InlineKeyboard } from "grammy";

interface TestMessageRequest {
  message: string;
  chatId: number;
  userId?: number;
  username?: string;
  firstName?: string;
}

interface TestMessageResponse {
  success: boolean;
  response?: string;
  error?: string;
  metadata: {
    processingTime: number;
    chatId: number;
    userId: number;
    hasInlineKeyboard: boolean;
    timestamp: string;
  };
  inlineKeyboard?: {
    options: string[];
  };
}

export async function handleTestMessage(request: TestMessageRequest): Promise<TestMessageResponse> {
  const startTime = Date.now();

  try {
    // Create mock Telegram context
    const mockContext = createMockContext(request);

    // Call the actual message handler
    await messageHandler(mockContext as any);

    const processingTime = Date.now() - startTime;

    // Extract response and keyboard from mock context
    const response = mockContext._capturedResponse;
    const inlineKeyboard = mockContext._capturedKeyboard;

    return {
      success: true,
      response: response || "No response captured",
      metadata: {
        processingTime,
        chatId: request.chatId,
        userId: request.userId || 0,
        hasInlineKeyboard: !!inlineKeyboard,
        timestamp: new Date().toISOString()
      },
      ...(inlineKeyboard && {
        inlineKeyboard: {
          options: inlineKeyboard.options
        }
      })
    };

  } catch (error) {
    const processingTime = Date.now() - startTime;

    return {
      success: false,
      error: error.message || "Unknown error occurred",
      metadata: {
        processingTime,
        chatId: request.chatId,
        userId: request.userId || 0,
        hasInlineKeyboard: false,
        timestamp: new Date().toISOString()
      }
    };
  }
}

function createMockContext(request: TestMessageRequest) {
  let capturedResponse: string | undefined;
  let capturedKeyboard: { options: string[] } | undefined;

  const mockContext = {
    // Mock update structure
    update: {
      update_id: Math.floor(Math.random() * 1000000), // Random update ID for testing
    },

    // Mock message structure
    message: {
      text: request.message,
      from: {
        id: request.userId || Math.floor(Math.random() * 1000000),
        username: request.username || "testuser",
        first_name: request.firstName || "Test User",
      }
    },

    // Mock chat structure
    chat: {
      id: request.chatId,
    },

    // Mock from structure (same as message.from)
    from: {
      id: request.userId || Math.floor(Math.random() * 1000000),
      username: request.username || "testuser",
      first_name: request.firstName || "Test User",
    },

    // Mock reply function that captures the response
    reply: (text: string, options?: { reply_markup?: InlineKeyboard }) => {
      console.log(`[TEST] Bot would reply: ${text.substring(0, 100)}${text.length > 100 ? "..." : ""}`);
      capturedResponse = text;

      // Capture inline keyboard if present
      if (options?.reply_markup) {
        const keyboard = options.reply_markup as any;
        if (keyboard.inline_keyboard) {
          const options: string[] = [];
          for (const row of keyboard.inline_keyboard) {
            for (const button of row) {
              if (button.text) {
                options.push(button.text);
              }
            }
          }
          capturedKeyboard = { options };
        }
      }

      return Promise.resolve({} as any);
    },

    // Mock replyWithChatAction function
    replyWithChatAction: (action: string) => {
      console.log(`[TEST] Bot would show chat action: ${action}`);
      return Promise.resolve({} as any);
    },

    // Store captured data for retrieval
    _capturedResponse: undefined as string | undefined,
    _capturedKeyboard: undefined as { options: string[] } | undefined,
  };

  // Add getters to access captured data
  Object.defineProperty(mockContext, '_capturedResponse', {
    get: () => capturedResponse,
    enumerable: false,
    configurable: true
  });

  Object.defineProperty(mockContext, '_capturedKeyboard', {
    get: () => capturedKeyboard,
    enumerable: false,
    configurable: true
  });

  return mockContext;
}
