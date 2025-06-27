/**
 * UMP Parser - Converts platform-specific messages to Universal Message Protocol format
 */

import {
  UniversalMessage,
  Platform,
  PlatformSpecificData,
  TelegramPlatformData,
  RestApiPlatformData,
  UMPError,
  UMPErrorType,
  PLATFORM_CAPABILITIES
} from './ump-types.ts';

import { TelegramUpdate } from '../../interfaces/component-interfaces.ts';

/**
 * Main UMP Parser class
 */
export class UMPParser {
  /**
   * Parse incoming message from any platform to UniversalMessage format
   */
  static async parseMessage(
    rawMessage: any,
    platform: Platform,
    sessionId?: string
  ): Promise<UniversalMessage> {
    try {
      switch (platform) {
        case Platform.TELEGRAM:
          return this.parseTelegramMessage(rawMessage, sessionId);
        case Platform.REST_API:
          return this.parseRestApiMessage(rawMessage, sessionId);
        default:
          throw new UMPError(
            `Unsupported platform: ${platform}`,
            UMPErrorType.PLATFORM_NOT_SUPPORTED,
            platform
          );
      }
    } catch (error) {
      if (error instanceof UMPError) {
        throw error;
      }
      throw new UMPError(
        `Failed to parse message: ${error.message}`,
        UMPErrorType.PARSING_ERROR,
        platform,
        error as Error
      );
    }
  }

  /**
   * Parse Telegram update to UniversalMessage
   */
  private static parseTelegramMessage(
    update: TelegramUpdate,
    sessionId?: string
  ): UniversalMessage {
    if (!update.message || !update.message.text) {
      throw new UMPError(
        'Telegram update missing message or text',
        UMPErrorType.VALIDATION_ERROR,
        Platform.TELEGRAM
      );
    }

    const message = update.message;
    const chatId = message.chat.id;
    const userId = message.from.id;
    const messageId = `tg_${update.update_id}_${message.message_id}`;
    const computedSessionId = sessionId || `tg_session_${chatId}_${userId}`;

    // Create platform-specific data
    const telegramData: TelegramPlatformData = {
      chatId: message.chat.id,
      messageId: message.message_id,
      updateId: update.update_id,
      username: message.from.username,
      firstName: message.from.first_name,
      lastName: message.from.last_name,
      chatType: message.chat.type || 'private',
      isBot: message.from.is_bot || false
    };

    const platformSpecific: PlatformSpecificData = {
      [Platform.TELEGRAM]: telegramData
    };

    // Validate message length
    const capabilities = PLATFORM_CAPABILITIES[Platform.TELEGRAM];
    if (message.text.length > capabilities.maxMessageLength) {
      throw new UMPError(
        `Message too long: ${message.text.length} > ${capabilities.maxMessageLength}`,
        UMPErrorType.MESSAGE_TOO_LARGE,
        Platform.TELEGRAM
      );
    }

    return {
      id: messageId,
      sessionId: computedSessionId,
      userId: userId.toString(),
      timestamp: new Date(message.date * 1000),
      content: {
        text: message.text,
        metadata: {
          messageType: 'text',
          originalPlatform: Platform.TELEGRAM
        }
      },
      platform: Platform.TELEGRAM,
      platformSpecific,
      conversation: {
        chatId: chatId.toString(),
        messageCount: 1 // Will be updated by session manager
      }
    };
  }

  /**
   * Parse REST API message to UniversalMessage
   */
  private static parseRestApiMessage(
    request: RestApiMessageRequest,
    sessionId?: string
  ): UniversalMessage {
    this.validateRestApiMessage(request);

    const messageId = `api_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const computedSessionId = sessionId || request.sessionId || `api_session_${request.userId}`;

    // Create platform-specific data
    const restApiData: RestApiPlatformData = {
      endpoint: request.endpoint || '/api/v1/messages',
      method: request.method || 'POST',
      headers: request.headers || {},
      clientId: request.clientId,
      apiVersion: request.apiVersion || '1.0'
    };

    const platformSpecific: PlatformSpecificData = {
      [Platform.REST_API]: restApiData
    };

    // Validate message length
    const capabilities = PLATFORM_CAPABILITIES[Platform.REST_API];
    if (request.message.length > capabilities.maxMessageLength) {
      throw new UMPError(
        `Message too long: ${request.message.length} > ${capabilities.maxMessageLength}`,
        UMPErrorType.MESSAGE_TOO_LARGE,
        Platform.REST_API
      );
    }

    return {
      id: messageId,
      sessionId: computedSessionId,
      userId: request.userId,
      timestamp: new Date(),
      content: {
        text: request.message,
        metadata: {
          messageType: 'text',
          originalPlatform: Platform.REST_API,
          clientId: request.clientId,
          endpoint: request.endpoint
        }
      },
      platform: Platform.REST_API,
      platformSpecific,
      conversation: {
        chatId: request.chatId || request.userId, // Use userId as chatId if not provided
        messageCount: 1 // Will be updated by session manager
      }
    };
  }

  /**
   * Validate REST API message request
   */
  private static validateRestApiMessage(request: RestApiMessageRequest): void {
    if (!request.message || typeof request.message !== 'string') {
      throw new UMPError(
        'REST API request missing or invalid message field',
        UMPErrorType.VALIDATION_ERROR,
        Platform.REST_API
      );
    }

    if (!request.userId || typeof request.userId !== 'string') {
      throw new UMPError(
        'REST API request missing or invalid userId field',
        UMPErrorType.VALIDATION_ERROR,
        Platform.REST_API
      );
    }

    if (request.message.trim().length === 0) {
      throw new UMPError(
        'REST API request message cannot be empty',
        UMPErrorType.VALIDATION_ERROR,
        Platform.REST_API
      );
    }
  }

  /**
   * Extract platform from raw message data
   */
  static detectPlatform(rawMessage: any, headers?: Record<string, string>): Platform {
    // Check for Telegram update structure
    if (rawMessage && typeof rawMessage.update_id === 'number' && rawMessage.message) {
      return Platform.TELEGRAM;
    }

    // Check for REST API structure
    if (rawMessage && rawMessage.message && rawMessage.userId) {
      return Platform.REST_API;
    }

    // Check headers for platform hints
    if (headers) {
      const userAgent = headers['user-agent']?.toLowerCase();
      if (userAgent?.includes('discord')) {
        return Platform.DISCORD;
      }
      if (userAgent?.includes('slack')) {
        return Platform.SLACK;
      }
    }

    throw new UMPError(
      'Could not detect platform from message structure',
      UMPErrorType.PLATFORM_NOT_SUPPORTED
    );
  }

  /**
   * Validate parsed UniversalMessage
   */
  static validateUniversalMessage(message: UniversalMessage): boolean {
    // Required fields validation
    if (!message.id || !message.sessionId || !message.userId) {
      throw new UMPError(
        'UniversalMessage missing required fields (id, sessionId, userId)',
        UMPErrorType.VALIDATION_ERROR,
        message.platform
      );
    }

    if (!message.content.text || message.content.text.trim().length === 0) {
      throw new UMPError(
        'UniversalMessage content.text is required and cannot be empty',
        UMPErrorType.VALIDATION_ERROR,
        message.platform
      );
    }

    if (!Object.values(Platform).includes(message.platform)) {
      throw new UMPError(
        `Invalid platform: ${message.platform}`,
        UMPErrorType.VALIDATION_ERROR,
        message.platform
      );
    }

    // Platform constraints validation
    const capabilities = PLATFORM_CAPABILITIES[message.platform];
    if (message.content.text.length > capabilities.maxMessageLength) {
      throw new UMPError(
        `Message exceeds platform limit: ${message.content.text.length} > ${capabilities.maxMessageLength}`,
        UMPErrorType.MESSAGE_TOO_LARGE,
        message.platform
      );
    }

    return true;
  }
}

/**
 * REST API message request interface
 */
export interface RestApiMessageRequest {
  message: string;
  userId: string;
  chatId?: string;
  sessionId?: string;
  clientId?: string;
  endpoint?: string;
  method?: string;
  headers?: Record<string, string>;
  apiVersion?: string;
  metadata?: Record<string, any>;
}

/**
 * Helper functions for message parsing
 */
export class UMPParserUtils {
  /**
   * Generate unique message ID
   */
  static generateMessageId(platform: Platform, platformId?: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    const platformPrefix = platform.substring(0, 3);
    return `${platformPrefix}_${timestamp}_${platformId || random}`;
  }

  /**
   * Generate session ID
   */
  static generateSessionId(platform: Platform, userId: string, chatId?: string): string {
    const platformPrefix = platform.substring(0, 3);
    const identifier = chatId || userId;
    return `${platformPrefix}_session_${identifier}_${userId}`;
  }

  /**
   * Extract text content from various message formats
   */
  static extractTextContent(rawContent: any): string {
    if (typeof rawContent === 'string') {
      return rawContent;
    }

    if (rawContent && typeof rawContent.text === 'string') {
      return rawContent.text;
    }

    if (rawContent && typeof rawContent.content === 'string') {
      return rawContent.content;
    }

    if (rawContent && typeof rawContent.message === 'string') {
      return rawContent.message;
    }

    throw new UMPError(
      'Could not extract text content from message',
      UMPErrorType.PARSING_ERROR
    );
  }

  /**
   * Sanitize and validate user input
   */
  static sanitizeTextContent(text: string): string {
    if (!text || typeof text !== 'string') {
      throw new UMPError(
        'Text content must be a non-empty string',
        UMPErrorType.VALIDATION_ERROR
      );
    }

    // Trim whitespace
    const sanitized = text.trim();

    // Check for empty content
    if (sanitized.length === 0) {
      throw new UMPError(
        'Text content cannot be empty after sanitization',
        UMPErrorType.VALIDATION_ERROR
      );
    }

    // Basic content validation - reject potentially malicious content
    if (sanitized.includes('\0') || sanitized.includes('\x00')) {
      throw new UMPError(
        'Text content contains null characters',
        UMPErrorType.VALIDATION_ERROR
      );
    }

    return sanitized;
  }
}