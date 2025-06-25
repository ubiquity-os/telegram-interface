/**
 * Test Message Handler
 * Handles test messages for E2E testing
 */

export interface TestMessageRequest {
  userId: string;
  chatId: string;
  text: string;
}

export interface TestMessageResult {
  success: boolean;
  response?: string;
  error?: string;
  timestamp: string;
}

export async function handleTestMessage(request: TestMessageRequest): Promise<TestMessageResult> {
  try {
    const { userId, chatId, text } = request;

    // Basic validation
    if (!userId || !chatId || !text) {
      return {
        success: false,
        error: 'Missing required fields: userId, chatId, or text',
        timestamp: new Date().toISOString()
      };
    }

    // Mock processing - in a real system this would go through the full pipeline
    const response = `Test response for user ${userId} in chat ${chatId}: "${text}"`;

    return {
      success: true,
      response,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    };
  }
}