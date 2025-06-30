/**
 * Message Router - Routes UMP messages to SystemOrchestrator
 *
 * This component bridges the new UMP system with the existing
 * SystemOrchestrator, converting between formats as needed
 */

import {
  UniversalMessage,
  UniversalResponse,
  Platform,
  Session,
  UMPError,
  UMPErrorType
} from './protocol/ump-types.ts';

import { UMPFormatter } from './protocol/ump-formatter.ts';
import { SystemOrchestrator } from '../components/system-orchestrator/system-orchestrator.ts';
import { TelegramUpdate, ToolDefinition } from '../interfaces/component-interfaces.ts';

// Import event-based logging system
import { initializeEventLogging, finalizeEventLogging } from '../utils/event-log-manager.ts';

/**
 * Message Router Configuration
 */
export interface MessageRouterConfig {
  // Timeouts
  processingTimeout: number;

  // Retries
  maxRetries: number;
  retryDelay: number;

  // Error handling
  enableCircuitBreaker: boolean;
  circuitBreakerThreshold: number;

  // Logging
  enableLogging: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Main Message Router class
 */
export class MessageRouter {
  private config: MessageRouterConfig;
  private systemOrchestrator: SystemOrchestrator;
  private circuitBreakerState = new Map<string, {
    failures: number;
    lastFailure: Date;
    isOpen: boolean;
  }>();

  constructor(
    config: MessageRouterConfig,
    systemOrchestrator: SystemOrchestrator
  ) {
    this.config = config;
    this.systemOrchestrator = systemOrchestrator;
  }

  /**
   * Route a UniversalMessage through the system
   */
  async routeMessage(
    universalMessage: UniversalMessage,
    session: Session
  ): Promise<UniversalResponse> {
    const startTime = Date.now();

    // Initialize event-based logging for this specific message
    try {
      const messageTimestamp = Math.floor(Date.now() / 1000);
      const { sessionId, eventTimestamp } = initializeEventLogging(
        universalMessage.platform.toLowerCase(),
        universalMessage.conversation.chatId,
        universalMessage.userId,
        messageTimestamp
      );

      this.log('info', `Processing message event: ${eventTimestamp}-${sessionId.split('_').pop()}.log (session: ${sessionId})`);
    } catch (error) {
      this.log('error', `Failed to initialize event logging: ${error.message}`);
      throw error; // Fail explicitly instead of continuing
    }

    try {
      this.log('info', `Routing message ${universalMessage.id} from platform ${universalMessage.platform}`);

      // Check circuit breaker
      if (this.isCircuitBreakerOpen(universalMessage.platform)) {
        throw new UMPError(
          `Circuit breaker open for platform ${universalMessage.platform}`,
          UMPErrorType.TEMPORARY_FAILURE,
          universalMessage.platform
        );
      }

      // Convert UniversalMessage to platform-specific format for existing system
      const platformMessage = this.convertToPlatformMessage(universalMessage);

      // Route through existing SystemOrchestrator
      const result = await this.processWithRetry(platformMessage, universalMessage, session);

      // Convert result back to UniversalResponse
      const response = await this.convertToUniversalResponse(
        result,
        universalMessage,
        startTime
      );

      this.recordSuccess(universalMessage.platform);
      this.log('info', `Successfully processed message ${universalMessage.id} in ${Date.now() - startTime}ms`);

      await finalizeEventLogging(
        'message_processed_success',
        {
          messageId: universalMessage.id,
          platform: universalMessage.platform,
          processingTime: Date.now() - startTime,
          response: result
        },
        universalMessage.platform.toLowerCase(),
        universalMessage.conversation.chatId,
        universalMessage.userId
      );
      return response;

    } catch (error) {
      this.recordFailure(universalMessage.platform, error as Error);
      this.log('error', `Failed to route message ${universalMessage.id}: ${error.message}`);

      // Create error response
      await finalizeEventLogging(
        'message_processed_error',
        {
          messageId: universalMessage.id,
          platform: universalMessage.platform,
          processingTime: Date.now() - startTime,
          error: {
            message: error.message,
            name: error.name,
            stack: error.stack
          }
        },
        universalMessage.platform.toLowerCase(),
        universalMessage.conversation.chatId,
        universalMessage.userId
      );
      return this.createErrorResponse(universalMessage, error as Error, startTime);
    }
  }

  /**
   * Get available tools from the system
   */
  async getAvailableTools(): Promise<ToolDefinition[]> {
    try {
      // Access MCP tool manager through system orchestrator
      const mcpToolManager = this.systemOrchestrator.getComponent<any>('MCPToolManager');

      if (mcpToolManager && typeof mcpToolManager.getAvailableTools === 'function') {
        return await mcpToolManager.getAvailableTools();
      }

      // Fallback - return empty array if no tools available
      return [];
    } catch (error) {
      this.log('warn', `Failed to get available tools: ${error.message}`);
      return [];
    }
  }

  /**
   * Convert UniversalMessage to platform-specific format
   */
  private convertToPlatformMessage(universalMessage: UniversalMessage): any {
    console.log(`[MessageRouter] 🔄 CONVERTING MESSAGE TO PLATFORM FORMAT`);
    console.log(`[MessageRouter] 🔍 Input platform: ${universalMessage.platform}`);
    console.log(`[MessageRouter] 🔍 Message ID: ${universalMessage.id}`);
    console.log(`[MessageRouter] 🔍 User ID: ${universalMessage.userId}`);
    console.log(`[MessageRouter] 🔍 Chat ID: ${universalMessage.conversation.chatId}`);
    console.log(`[MessageRouter] 🔍 Content: "${universalMessage.content.text}"`);

    switch (universalMessage.platform) {
      case Platform.TELEGRAM:
        console.log(`[MessageRouter] ✅ ROUTING: Telegram platform - calling convertToTelegramUpdate`);
        return this.convertToTelegramUpdate(universalMessage);
      case Platform.REST_API:
        console.log(`[MessageRouter] ✅ ROUTING: REST API platform - calling convertToInternalFormat`);
        // For REST API, we'll process it directly through the system
        return this.convertToInternalFormat(universalMessage);
      default:
        console.error(`[MessageRouter] ❌ UNSUPPORTED PLATFORM: ${universalMessage.platform}`);
        throw new UMPError(
          `Unsupported platform for conversion: ${universalMessage.platform}`,
          UMPErrorType.PLATFORM_NOT_SUPPORTED,
          universalMessage.platform
        );
    }
  }

  /**
   * Convert UniversalMessage to Telegram update format
   */
  private convertToTelegramUpdate(universalMessage: UniversalMessage): TelegramUpdate {
    const telegramData = universalMessage.platformSpecific[Platform.TELEGRAM];

    if (!telegramData) {
      throw new UMPError(
        'Missing Telegram platform data',
        UMPErrorType.VALIDATION_ERROR,
        Platform.TELEGRAM
      );
    }

    // Handle user ID conversion (similar to chat ID logic)
    let userIdNumeric: number;
    const userIdRaw = universalMessage.userId;

    if (typeof userIdRaw === 'string' && !isNaN(Number(userIdRaw))) {
      userIdNumeric = parseInt(userIdRaw, 10);
    } else if (typeof userIdRaw === 'number') {
      userIdNumeric = userIdRaw;
    } else {
      // For non-numeric user IDs, create a deterministic numeric representation
      userIdNumeric = this.stringToNumericId(userIdRaw);
    }

    return {
      update_id: telegramData.updateId,
      message: {
        message_id: telegramData.messageId,
        date: Math.floor(universalMessage.timestamp.getTime() / 1000),
        chat: {
          id: telegramData.chatId, // Telegram platform data already contains numeric chatId
          type: telegramData.chatType
        },
        from: {
          id: userIdNumeric,
          is_bot: telegramData.isBot,
          first_name: telegramData.firstName || 'User',
          last_name: telegramData.lastName,
          username: telegramData.username
        },
        text: universalMessage.content.text
      }
    };
  }

  /**
   * Convert UniversalMessage to internal format for direct processing
   */
  private convertToInternalFormat(universalMessage: UniversalMessage): any {
    console.log(`[MessageRouter] 🔄 CONVERTING REST API MESSAGE TO INTERNAL FORMAT`);
    console.log(`[MessageRouter] 📥 Input universalMessage:`, JSON.stringify(universalMessage, null, 2));

    // Create a mock Telegram update for REST API messages
    // This allows us to reuse the existing SystemOrchestrator logic
    const chatIdRaw = universalMessage.conversation.chatId;
    console.log(`[MessageRouter] 🔍 Raw chat ID: "${chatIdRaw}" (type: ${typeof chatIdRaw})`);

    // Handle both numeric (Telegram) and string (REST API) chat IDs
    let chatIdNumeric: number;

    if (typeof chatIdRaw === 'string' && !isNaN(Number(chatIdRaw))) {
      // If it's a numeric string, parse it directly
      chatIdNumeric = parseInt(chatIdRaw, 10);
      console.log(`[MessageRouter] ✅ Numeric string chat ID converted: ${chatIdNumeric}`);
    } else if (typeof chatIdRaw === 'number') {
      // If it's already a number (from Telegram), use it directly
      chatIdNumeric = chatIdRaw;
      console.log(`[MessageRouter] ✅ Already numeric chat ID: ${chatIdNumeric}`);
    } else {
      // For non-numeric string chat IDs (REST API), create a deterministic numeric representation
      chatIdNumeric = this.stringToNumericId(chatIdRaw);
      console.log(`[MessageRouter] ✅ String chat ID hashed to numeric: "${chatIdRaw}" → ${chatIdNumeric}`);
    }

    // Parse user ID with similar logic
    let userIdNumeric: number;
    const userIdRaw = universalMessage.userId;
    console.log(`[MessageRouter] 🔍 Raw user ID: "${userIdRaw}" (type: ${typeof userIdRaw})`);

    if (typeof userIdRaw === 'string' && !isNaN(Number(userIdRaw))) {
      userIdNumeric = parseInt(userIdRaw, 10);
      console.log(`[MessageRouter] ✅ Numeric string user ID converted: ${userIdNumeric}`);
    } else {
      // For non-numeric user IDs, create a deterministic numeric representation
      userIdNumeric = this.stringToNumericId(userIdRaw);
      console.log(`[MessageRouter] ✅ String user ID hashed to numeric: "${userIdRaw}" → ${userIdNumeric}`);
    }

    const currentTime = Date.now();
    console.log(`[MessageRouter] 🕒 Using timestamp for update_id and message_id: ${currentTime}`);

    const mockTelegramUpdate = {
      update_id: currentTime,
      message: {
        message_id: currentTime,
        date: Math.floor(universalMessage.timestamp.getTime() / 1000),
        chat: {
          id: chatIdNumeric,
          type: 'private'
        },
        from: {
          id: userIdNumeric,
          is_bot: false,
          first_name: 'API User' // CRITICAL: This is the REST API indicator!
        },
        text: universalMessage.content.text
      }
    };

    console.log(`[MessageRouter] 📤 Generated mock Telegram update (THIS IS WHAT SystemOrchestrator WILL SEE):`);
    console.log(`[MessageRouter] 📤 `, JSON.stringify(mockTelegramUpdate, null, 2));
    console.log(`[MessageRouter] 🔑 PLATFORM DETECTION INDICATORS:`);
    console.log(`[MessageRouter] 🔑 - first_name: "${mockTelegramUpdate.message.from.first_name}" (should be "API User")`);
    console.log(`[MessageRouter] 🔑 - update_id: ${mockTelegramUpdate.update_id} (timestamp-based)`);
    console.log(`[MessageRouter] 🔑 - chat.type: "${mockTelegramUpdate.message.chat.type}"`);
    console.log(`[MessageRouter] 🔑 - is_bot: ${mockTelegramUpdate.message.from.is_bot}`);

    return mockTelegramUpdate;
  }

  /**
   * Convert string ID to a deterministic numeric representation
   * Uses a simple hash function to ensure consistency
   */
  private stringToNumericId(str: string): number {
    if (!str || typeof str !== 'string') {
      throw new UMPError(
        `Invalid string ID: "${str}" cannot be converted to numeric representation`,
        UMPErrorType.VALIDATION_ERROR,
        Platform.REST_API
      );
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
   * Process message with retry logic
   */
  private async processWithRetry(
    platformMessage: any,
    originalMessage: UniversalMessage,
    session: Session
  ): Promise<any> {
    let lastError: Error;

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        // Use existing SystemOrchestrator.handleUpdate method
        // This is where the message enters the existing system
        const actualResponse = await this.systemOrchestrator.handleUpdate(platformMessage);

        // Return the actual response from the system
        return {
          success: true,
          processed: true,
          platform: originalMessage.platform,
          sessionId: session.id,
          actualContent: actualResponse
        };

      } catch (error) {
        lastError = error as Error;
        this.log('warn', `Attempt ${attempt} failed: ${error.message}`);

        if (attempt < this.config.maxRetries) {
          await this.delay(this.config.retryDelay * attempt);
        }
      }
    }

    throw lastError!;
  }

  /**
   * Convert processing result to UniversalResponse
   */
  private async convertToUniversalResponse(
    result: any,
    originalMessage: UniversalMessage,
    startTime: number
  ): Promise<UniversalResponse> {
    const processingTime = Date.now() - startTime;

    // Use the actual response content from the system
    const response: UniversalResponse = {
      id: `resp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      requestId: originalMessage.id,
      timestamp: new Date(),
      content: {
        text: result.actualContent || "System processed the message successfully.",
        metadata: {
          originalPlatform: originalMessage.platform,
          sessionId: originalMessage.sessionId,
          processed: result.processed
        }
      },
      format: UMPFormatter.createOptimalResponseFormat(originalMessage.platform),
      processing: {
        processingTime,
        confidence: 1.0
      }
    };

    return response;
  }

  /**
   * Create error response
   */
  private createErrorResponse(
    originalMessage: UniversalMessage,
    error: Error,
    startTime: number
  ): UniversalResponse {
    const processingTime = Date.now() - startTime;

    return {
      id: `error_resp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      requestId: originalMessage.id,
      timestamp: new Date(),
      content: {
        text: `Sorry, I encountered an error while processing your message: ${error.message}`,
        metadata: {
          error: true,
          errorType: error.name,
          originalPlatform: originalMessage.platform
        }
      },
      format: UMPFormatter.createOptimalResponseFormat(originalMessage.platform),
      processing: {
        processingTime,
        confidence: 0
      }
    };
  }

  /**
   * Circuit breaker logic
   */
  private isCircuitBreakerOpen(platform: Platform): boolean {
    if (!this.config.enableCircuitBreaker) {
      return false;
    }

    const state = this.circuitBreakerState.get(platform);
    if (!state) {
      return false;
    }

    if (state.failures >= this.config.circuitBreakerThreshold) {
      const timeSinceLastFailure = Date.now() - state.lastFailure.getTime();
      const cooldownPeriod = 60000; // 1 minute

      if (timeSinceLastFailure < cooldownPeriod) {
        return true;
      } else {
        // Reset circuit breaker after cooldown
        this.circuitBreakerState.delete(platform);
        return false;
      }
    }

    return false;
  }

  /**
   * Record successful processing
   */
  private recordSuccess(platform: Platform): void {
    // Reset circuit breaker on success
    this.circuitBreakerState.delete(platform);
  }

  /**
   * Record failed processing
   */
  private recordFailure(platform: Platform, error: Error): void {
    if (!this.config.enableCircuitBreaker) {
      return;
    }

    const state = this.circuitBreakerState.get(platform) || {
      failures: 0,
      lastFailure: new Date(),
      isOpen: false
    };

    state.failures++;
    state.lastFailure = new Date();

    if (state.failures >= this.config.circuitBreakerThreshold) {
      state.isOpen = true;
      this.log('warn', `Circuit breaker opened for platform ${platform} after ${state.failures} failures`);
    }

    this.circuitBreakerState.set(platform, state);
  }

  /**
   * Delay utility
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Logging utility
   */
  private log(level: string, message: string): void {
    if (!this.config.enableLogging) {
      return;
    }

    const levels = ['debug', 'info', 'warn', 'error'];
    const configLevelIndex = levels.indexOf(this.config.logLevel);
    const messageLevelIndex = levels.indexOf(level);

    if (messageLevelIndex >= configLevelIndex) {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] [${level.toUpperCase()}] [MessageRouter] ${message}`);
    }
  }
}

/**
 * Create default configuration for Message Router
 */
export function createDefaultMessageRouterConfig(): MessageRouterConfig {
  return {
    processingTimeout: 30000, // 30 seconds
    maxRetries: 3,
    retryDelay: 1000, // 1 second
    enableCircuitBreaker: true,
    circuitBreakerThreshold: 5,
    enableLogging: true,
    logLevel: 'info'
  };
}

/**
 * Additional error type for circuit breaker
 */
declare module './protocol/ump-types.ts' {
  enum UMPErrorType {
    TEMPORARY_FAILURE = 'temporary_failure'
  }
}