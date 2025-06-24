import {
  InternalMessage,
  TelegramResponse
} from "../interfaces/message-types.ts";
import { getAIResponse } from "../services/llm-service/get-ai-response.ts";

interface TestMessageRequest {
  userId: string;
  chatId: string;
  text: string;
}

interface TestMessageResponse {
  success: boolean;
  response?: TelegramResponse;
  error?: string;
  metadata: {
    processingTime: number;
    chatId: string;
    userId: string;
    timestamp: string;
  };
}

/**
 * Handles test messages by bypassing Telegram interface and injecting directly into the processing pipeline
 */
export async function handleTestMessage(request: TestMessageRequest): Promise<TestMessageResponse> {
  const startTime = Date.now();

  try {
    // Validate input
    if (!request.text || typeof request.text !== "string") {
      throw new Error("Missing or invalid 'text' field");
    }
    if (!request.chatId || typeof request.chatId !== "string") {
      throw new Error("Missing or invalid 'chatId' field");
    }
    if (!request.userId || typeof request.userId !== "string") {
      throw new Error("Missing or invalid 'userId' field");
    }

    // Convert string IDs to numbers for internal processing
    const chatId = parseInt(request.chatId);
    const userId = parseInt(request.userId);

    if (isNaN(chatId) || isNaN(userId)) {
      throw new Error("chatId and userId must be valid numbers");
    }

    // Create internal message format
    const internalMessage: InternalMessage = {
      id: `test_${Date.now()}_${Math.random()}`,
      chatId,
      userId,
      content: request.text,
      timestamp: new Date(),
      metadata: {
        source: 'system',
        originalMessageId: Math.floor(Math.random() * 1000000)
      }
    };

    // For now, use the existing AI response pipeline which handles the entire flow
    // This bypasses the TelegramInterfaceAdapter as required, while still processing through
    // the internal pipeline (conversation history, tool execution, etc.)
    const responseText = await getAIResponse(request.text, chatId);

    // Create the final response in the format that would be sent to Telegram
    const telegramResponse: TelegramResponse = {
      chatId,
      text: responseText,
      parseMode: 'Markdown'
    };

    const processingTime = Date.now() - startTime;

    return {
      success: true,
      response: telegramResponse,
      metadata: {
        processingTime,
        chatId: request.chatId,
        userId: request.userId,
        timestamp: new Date().toISOString()
      }
    };

  } catch (error) {
    const processingTime = Date.now() - startTime;

    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
      metadata: {
        processingTime,
        chatId: request.chatId || "unknown",
        userId: request.userId || "unknown",
        timestamp: new Date().toISOString()
      }
    };
  }
}