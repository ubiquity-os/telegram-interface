/**
 * UMP Formatter - Converts UniversalResponse to platform-specific formats
 */

import {
  UniversalResponse,
  Platform,
  ResponseAction,
  ResponseFormat,
  PlatformConstraints,
  PLATFORM_CAPABILITIES,
  UMPError,
  UMPErrorType
} from './ump-types.ts';

import { TelegramResponse, InlineKeyboard } from '../../interfaces/message-types.ts';

/**
 * Main UMP Formatter class
 */
export class UMPFormatter {
  /**
   * Format UniversalResponse to platform-specific format
   */
  static async formatResponse(
    response: UniversalResponse,
    platform: Platform,
    platformSpecificData?: any
  ): Promise<any> {
    try {
      // Validate response before formatting
      this.validateUniversalResponse(response, platform);

      switch (platform) {
        case Platform.TELEGRAM:
          return this.formatTelegramResponse(response, platformSpecificData);
        case Platform.REST_API:
          return this.formatRestApiResponse(response);
        default:
          throw new UMPError(
            `Unsupported platform for formatting: ${platform}`,
            UMPErrorType.PLATFORM_NOT_SUPPORTED,
            platform
          );
      }
    } catch (error) {
      if (error instanceof UMPError) {
        throw error;
      }
      throw new UMPError(
        `Failed to format response: ${error.message}`,
        UMPErrorType.CONVERSION_FAILED,
        platform,
        error as Error
      );
    }
  }

  /**
   * Format UniversalResponse to Telegram format
   */
  private static formatTelegramResponse(
    response: UniversalResponse,
    telegramData?: any
  ): TelegramResponse {
    const capabilities = PLATFORM_CAPABILITIES[Platform.TELEGRAM];

    // Truncate message if too long
    let text = response.content.text;
    if (text.length > capabilities.maxMessageLength) {
      text = text.substring(0, capabilities.maxMessageLength - 3) + '...';
    }

    // Format text based on response format preferences
    if (response.format.markdown && capabilities.supportsMarkdown) {
      // Keep markdown formatting
    } else if (response.format.html && capabilities.supportsHtml) {
      // Convert to HTML if needed (basic implementation)
      text = text.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
                 .replace(/\*(.*?)\*/g, '<i>$1</i>')
                 .replace(/`(.*?)`/g, '<code>$1</code>');
    } else {
      // Strip all formatting for plain text
      text = this.stripFormatting(text);
    }

    const telegramResponse: TelegramResponse = {
      chatId: telegramData?.chatId || 0,
      text,
      parseMode: response.format.markdown ? 'Markdown' :
                 response.format.html ? 'HTML' : undefined
    };

    // Add inline keyboard if actions are present and supported
    if (response.content.actions &&
        response.content.actions.length > 0 &&
        capabilities.supportsInlineKeyboard) {
      telegramResponse.replyMarkup = this.formatTelegramKeyboard(
        response.content.actions,
        capabilities
      );
    }

    // Add reply to message ID if available
    if (telegramData?.replyToMessageId) {
      telegramResponse.replyToMessageId = telegramData.replyToMessageId;
    }

    return telegramResponse;
  }

  /**
   * Format UniversalResponse to REST API format
   */
  private static formatRestApiResponse(response: UniversalResponse): RestApiResponseFormat {
    return {
      id: response.id,
      requestId: response.requestId,
      timestamp: response.timestamp.toISOString(),
      success: true,
      data: {
        message: response.content.text,
        actions: response.content.actions || [],
        attachments: response.content.attachments || [],
        metadata: response.content.metadata || {}
      },
      processing: {
        tokensUsed: response.processing.tokensUsed,
        processingTime: response.processing.processingTime,
        toolsUsed: response.processing.toolsUsed || [],
        confidence: response.processing.confidence
      },
      format: response.format
    };
  }

  /**
   * Format actions as Telegram inline keyboard
   */
  private static formatTelegramKeyboard(
    actions: ResponseAction[],
    capabilities: PlatformConstraints
  ): InlineKeyboard {
    const buttons: any[][] = [];
    let currentRow: any[] = [];

    for (const action of actions.slice(0, capabilities.maxActions)) {
      // Create button based on action type
      const button: any = {
        text: action.label
      };

      switch (action.action.type) {
        case 'callback':
          button.callback_data = action.action.data;
          break;
        case 'url':
          button.url = action.action.data;
          break;
        default:
          // Default to callback for unsupported types
          button.callback_data = action.action.data;
      }

      currentRow.push(button);

      // Start new row if we hit the max buttons per row (default 3 for Telegram)
      if (currentRow.length >= 3) {
        buttons.push(currentRow);
        currentRow = [];
      }
    }

    // Add the last row if it has buttons
    if (currentRow.length > 0) {
      buttons.push(currentRow);
    }

    return {
      inline_keyboard: buttons
    };
  }

  /**
   * Validate UniversalResponse before formatting
   */
  private static validateUniversalResponse(
    response: UniversalResponse,
    platform: Platform
  ): void {
    if (!response.content.text || response.content.text.trim().length === 0) {
      throw new UMPError(
        'UniversalResponse content.text is required and cannot be empty',
        UMPErrorType.VALIDATION_ERROR,
        platform
      );
    }

    const capabilities = PLATFORM_CAPABILITIES[platform];

    // Check if message exceeds platform limits (will be truncated, but warn)
    if (response.content.text.length > capabilities.maxMessageLength) {
      console.warn(
        `Response text exceeds platform limit (${response.content.text.length} > ${capabilities.maxMessageLength}), will be truncated`
      );
    }

    // Check actions count
    if (response.content.actions &&
        response.content.actions.length > capabilities.maxActions) {
      console.warn(
        `Response has too many actions (${response.content.actions.length} > ${capabilities.maxActions}), some will be dropped`
      );
    }

    // Validate format compatibility
    if (response.format.markdown && !capabilities.supportsMarkdown) {
      console.warn(`Platform ${platform} does not support markdown formatting`);
    }

    if (response.format.html && !capabilities.supportsHtml) {
      console.warn(`Platform ${platform} does not support HTML formatting`);
    }
  }

  /**
   * Strip formatting from text
   */
  private static stripFormatting(text: string): string {
    return text
      .replace(/\*\*(.*?)\*\*/g, '$1')  // Bold
      .replace(/\*(.*?)\*/g, '$1')      // Italic
      .replace(/`(.*?)`/g, '$1')        // Code
      .replace(/~~(.*?)~~/g, '$1')      // Strikethrough
      .replace(/__(.*?)__/g, '$1')      // Underline
      .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1'); // Links
  }

  /**
   * Optimize text for platform constraints
   */
  static optimizeTextForPlatform(text: string, platform: Platform): string {
    const capabilities = PLATFORM_CAPABILITIES[platform];

    if (text.length <= capabilities.maxMessageLength) {
      return text;
    }

    // Intelligent truncation - try to break at sentence boundaries
    const maxLength = capabilities.maxMessageLength - 3; // Reserve space for "..."

    // Find the last sentence boundary before the limit
    const sentences = text.match(/[^\.!?]+[\.!?]+/g) || [text];
    let result = '';

    for (const sentence of sentences) {
      if ((result + sentence).length > maxLength) {
        break;
      }
      result += sentence;
    }

    // If no complete sentences fit, just truncate
    if (result.length === 0) {
      result = text.substring(0, maxLength);
    }

    return result + '...';
  }

  /**
   * Create response format based on platform capabilities
   */
  static createOptimalResponseFormat(platform: Platform): ResponseFormat {
    const capabilities = PLATFORM_CAPABILITIES[platform];

    return {
      markdown: capabilities.supportsMarkdown,
      html: capabilities.supportsHtml,
      plainText: true,
      maxLength: capabilities.maxMessageLength,
      lineBreaks: true,
      codeBlocks: capabilities.supportsMarkdown,
      inlineKeyboard: capabilities.supportsInlineKeyboard,
      quickReplies: platform === Platform.REST_API, // REST API can support custom quick replies
      carousel: false, // Not implemented in Phase 1
      platformConstraints: capabilities
    };
  }

  /**
   * Convert actions between different platform formats
   */
  static convertActionsForPlatform(
    actions: ResponseAction[],
    fromPlatform: Platform,
    toPlatform: Platform
  ): ResponseAction[] {
    const targetCapabilities = PLATFORM_CAPABILITIES[toPlatform];

    // Limit actions to platform maximum
    const limitedActions = actions.slice(0, targetCapabilities.maxActions);

    // Convert action types based on platform support
    return limitedActions.map(action => {
      const convertedAction = { ...action };

      // Handle platform-specific action type conversions
      if (toPlatform === Platform.TELEGRAM) {
        // Telegram supports callback and URL actions well
        if (action.action.type === 'share') {
          convertedAction.action.type = 'url';
        }
      } else if (toPlatform === Platform.REST_API) {
        // REST API can handle all action types as they're returned to client
        // No conversion needed
      }

      return convertedAction;
    });
  }

  /**
   * Create error response in platform-specific format
   */
  static createErrorResponse(
    error: UMPError,
    requestId?: string,
    platform?: Platform
  ): ErrorResponseFormat {
    return {
      id: `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      requestId,
      timestamp: new Date().toISOString(),
      success: false,
      error: {
        code: error.type,
        message: error.message,
        type: error.type,
        platform: error.platform,
        details: error.metadata
      }
    };
  }
}

/**
 * REST API response format interface
 */
export interface RestApiResponseFormat {
  id: string;
  requestId: string;
  timestamp: string;
  success: boolean;
  data: {
    message: string;
    actions: ResponseAction[];
    attachments: any[];
    metadata: Record<string, any>;
  };
  processing: {
    tokensUsed?: number;
    processingTime: number;
    toolsUsed: string[];
    confidence?: number;
  };
  format: ResponseFormat;
}

/**
 * Error response format for APIs
 */
export interface ErrorResponseFormat {
  id: string;
  requestId?: string;
  timestamp: string;
  success: false;
  error: {
    code: string;
    message: string;
    type: UMPErrorType;
    platform?: Platform;
    details?: Record<string, any>;
  };
}

/**
 * Utility functions for response formatting
 */
export class UMPFormatterUtils {
  /**
   * Create error response in platform-specific format
   */
  static createErrorResponse(
    error: UMPError,
    requestId?: string,
    platform?: Platform
  ): ErrorResponseFormat {
    return {
      id: `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      requestId,
      timestamp: new Date().toISOString(),
      success: false,
      error: {
        code: error.type,
        message: error.message,
        type: error.type,
        platform: error.platform,
        details: error.metadata
      }
    };
  }

  /**
   * Calculate estimated response size
   */
  static estimateResponseSize(response: UniversalResponse): number {
    let size = response.content.text.length;

    if (response.content.actions) {
      size += response.content.actions.reduce((total, action) =>
        total + action.label.length + action.action.data.length, 0
      );
    }

    if (response.content.attachments) {
      size += response.content.attachments.reduce((total, attachment) =>
        total + (attachment.data?.length || 0), 0
      );
    }

    return size;
  }

  /**
   * Validate response against platform constraints
   */
  static validateResponseConstraints(
    response: UniversalResponse,
    platform: Platform
  ): boolean {
    const capabilities = PLATFORM_CAPABILITIES[platform];

    // Check text length
    if (response.content.text.length > capabilities.maxMessageLength) {
      return false;
    }

    // Check actions count
    if (response.content.actions &&
        response.content.actions.length > capabilities.maxActions) {
      return false;
    }

    // Check attachments count
    if (response.content.attachments &&
        response.content.attachments.length > capabilities.maxAttachments) {
      return false;
    }

    return true;
  }
}