/**
 * API Response Adapter - Handles responses for CLI and REST API requests
 *
 * This adapter provides response handling for non-Telegram platforms,
 * ensuring the core system is decoupled from Telegram-specific logic.
 */

import { IMessageInterface, GenericResponse, InterfacePlatform } from '../interfaces/message-interface.ts';
import { ComponentStatus } from '../interfaces/component-interfaces.ts';
import { createEventEmitter, SystemEventType } from '../services/event-bus/index.ts';

/**
 * Configuration for API Response Adapter
 */
export interface ApiResponseAdapterConfig {
  enableLogging: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  responseFormat: 'json' | 'text';
  includeMetadata: boolean;
}

/**
 * Response capture for testing and CLI output
 */
export interface CapturedResponse {
  chatId: string | number;
  text: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

/**
 * API Response Adapter Implementation
 *
 * This adapter handles responses for CLI and REST API requests by:
 * - Capturing responses for CLI output
 * - Logging responses appropriately
 * - Providing JSON/text formatted output
 * - NOT sending to external platforms like Telegram
 */
export class ApiResponseAdapter implements IMessageInterface {
  public readonly name = 'ApiResponseAdapter';

  private config: ApiResponseAdapterConfig;
  private capturedResponses: Map<string | number, CapturedResponse[]> = new Map();
  private eventEmitter: ReturnType<typeof createEventEmitter>;
  private isInitialized = false;

  constructor(config: ApiResponseAdapterConfig) {
    this.config = config;
    this.eventEmitter = createEventEmitter('ApiResponseAdapter');
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      throw new Error('ApiResponseAdapter already initialized');
    }

    this.log('info', 'Initializing API Response Adapter');
    this.isInitialized = true;

    // Emit component initialized event
    await this.eventEmitter.emit({
      type: SystemEventType.COMPONENT_INITIALIZED,
      payload: {
        componentName: this.name,
        timestamp: new Date()
      }
    });

    this.log('info', 'API Response Adapter initialized successfully');
  }

  async sendMessage(response: GenericResponse): Promise<void> {
    console.log(`=== SENDING RESPONSE TO API ADAPTER ===`);
    console.log(`[ApiResponseAdapter] sendMessage called with:`, JSON.stringify(response, null, 2));

    if (!this.isInitialized) {
      throw new Error('ApiResponseAdapter not initialized');
    }

    try {
      // Create captured response
      const capturedResponse: CapturedResponse = {
        chatId: response.chatId,
        text: response.text,
        timestamp: new Date(),
        metadata: response.metadata
      };

      // Store the response
      const existing = this.capturedResponses.get(response.chatId) || [];
      existing.push(capturedResponse);
      this.capturedResponses.set(response.chatId, existing);

      // Log the response based on format preference
      if (this.config.responseFormat === 'json') {
        this.logJsonResponse(capturedResponse);
      } else {
        this.logTextResponse(capturedResponse);
      }

      this.log('info', `Response captured for chat ${response.chatId}: "${response.text}"`);

      // Emit response sent event
      await this.eventEmitter.emit({
        type: SystemEventType.MESSAGE_RECEIVED, // Reusing existing event type
        payload: {
          message: {
            chatId: typeof response.chatId === 'string' ? parseInt(response.chatId, 10) || 0 : response.chatId,
            userId: 0, // API responses don't have a specific user ID
            messageId: Date.now(), // Use timestamp as message ID for API responses
            text: response.text,
            timestamp: capturedResponse.timestamp
          },
          requestId: response.metadata?.requestId || 'unknown'
        }
      });

    } catch (error) {
      this.log('error', `Failed to send API response: ${error.message}`);

      await this.eventEmitter.emit({
        type: SystemEventType.COMPONENT_ERROR,
        payload: {
          componentName: this.name,
          error: error as Error
        }
      });

      throw error;
    }
  }

  async sendTypingIndicator(chatId: string | number): Promise<void> {
    // API/CLI doesn't need typing indicators, but we can log it
    this.log('debug', `Typing indicator requested for chat ${chatId} (ignored for API/CLI)`);
  }

  getStatus(): ComponentStatus {
    return {
      name: this.name,
      status: this.isInitialized ? 'healthy' : 'unhealthy',
      lastHealthCheck: new Date(),
      metadata: {
        capturedResponseCount: Array.from(this.capturedResponses.values())
          .reduce((total, responses) => total + responses.length, 0),
        activeChatSessions: this.capturedResponses.size,
        responseFormat: this.config.responseFormat,
        enableLogging: this.config.enableLogging
      }
    };
  }

  async shutdown(): Promise<void> {
    this.log('info', 'Shutting down API Response Adapter');

    // Clear captured responses
    this.capturedResponses.clear();
    this.isInitialized = false;

    await this.eventEmitter.emit({
      type: SystemEventType.COMPONENT_SHUTDOWN,
      payload: {
        componentName: this.name,
        timestamp: new Date()
      }
    });
  }

  /**
   * Get captured responses for a specific chat (useful for CLI/testing)
   */
  getCapturedResponses(chatId: string | number): CapturedResponse[] {
    return this.capturedResponses.get(chatId) || [];
  }

  /**
   * Get all captured responses (useful for debugging)
   */
  getAllCapturedResponses(): Map<string | number, CapturedResponse[]> {
    return new Map(this.capturedResponses);
  }

  /**
   * Clear captured responses for a specific chat
   */
  clearCapturedResponses(chatId?: string | number): void {
    if (chatId !== undefined) {
      this.capturedResponses.delete(chatId);
      this.log('debug', `Cleared captured responses for chat ${chatId}`);
    } else {
      this.capturedResponses.clear();
      this.log('debug', 'Cleared all captured responses');
    }
  }

  /**
   * Get the last response for a chat (useful for CLI output)
   */
  getLastResponse(chatId: string | number): CapturedResponse | undefined {
    const responses = this.capturedResponses.get(chatId);
    return responses && responses.length > 0 ? responses[responses.length - 1] : undefined;
  }

  /**
   * Log response in JSON format
   */
  private logJsonResponse(response: CapturedResponse): void {
    const jsonOutput = {
      platform: 'api',
      chatId: response.chatId,
      text: response.text,
      timestamp: response.timestamp.toISOString(),
      ...(this.config.includeMetadata && response.metadata ? { metadata: response.metadata } : {})
    };

    console.log(`[ApiResponseAdapter] JSON Response:`, JSON.stringify(jsonOutput, null, 2));
  }

  /**
   * Log response in text format
   */
  private logTextResponse(response: CapturedResponse): void {
    console.log(`[ApiResponseAdapter] Text Response for chat ${response.chatId}: ${response.text}`);

    if (this.config.includeMetadata && response.metadata) {
      console.log(`[ApiResponseAdapter] Metadata:`, response.metadata);
    }
  }

  /**
   * Internal logging utility
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
      console.log(`[${timestamp}] [${level.toUpperCase()}] [${this.name}] ${message}`);
    }
  }
}

/**
 * Create default configuration for API Response Adapter
 */
export function createDefaultApiResponseAdapterConfig(): ApiResponseAdapterConfig {
  return {
    enableLogging: true,
    logLevel: 'info',
    responseFormat: 'text',
    includeMetadata: true
  };
}