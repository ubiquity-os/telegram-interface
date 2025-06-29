/**
 * Validation Middleware - Phase 3.1
 *
 * Handles request validation and sanitization
 */

import { Middleware, MiddlewareResult, IncomingRequest } from '../api-gateway.ts';

/**
 * Validation rules for different request types
 */
interface ValidationRules {
  content: {
    minLength: number;
    maxLength: number;
    allowedChars?: RegExp;
    blockedPatterns?: RegExp[];
  };
  userId: {
    format: RegExp;
    maxLength: number;
  };
  chatId?: {
    format: RegExp;
  };
  sessionId?: {
    format: RegExp;
    maxLength: number;
  };
}

/**
 * Validation middleware implementation
 */
export class ValidationMiddleware implements Middleware {
  name = 'Validation';
  order = 3; // Third in pipeline, after authentication
  enabled: boolean;

  private rules: Record<string, ValidationRules> = {
    telegram: {
      content: {
        minLength: 1,
        maxLength: 4096, // Telegram message limit
        blockedPatterns: [
          /^\/start$/, // Block start commands as they're handled specially
          /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi // Block script tags
        ]
      },
      userId: {
        format: /^\d+$/,
        maxLength: 20
      },
      chatId: {
        format: /^-?\d+$/
      }
    },
    http: {
      content: {
        minLength: 1,
        maxLength: 8192, // HTTP API can handle longer messages
        blockedPatterns: [
          /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
          /javascript:/gi,
          /on\w+\s*=/gi // Block event handlers
        ]
      },
      userId: {
        format: /^[a-zA-Z0-9-_]+$/,
        maxLength: 50
      },
      sessionId: {
        format: /^[a-zA-Z0-9-_]+$/,
        maxLength: 100
      }
    },
    cli: {
      content: {
        minLength: 1,
        maxLength: 2048, // CLI has reasonable limits
        blockedPatterns: [
          /\x00/g, // Null bytes
          /[\x01-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g // Control characters
        ]
      },
      userId: {
        format: /^cli-user-[a-zA-Z0-9-_]+$/,
        maxLength: 50
      }
    }
  };

  constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  /**
   * Execute validation
   */
  async execute(request: IncomingRequest): Promise<MiddlewareResult> {
    if (!this.enabled) {
      return { success: true };
    }

    try {
      const rules = this.rules[request.source];
      if (!rules) {
        return {
          success: false,
          error: {
            code: 'UNKNOWN_SOURCE',
            message: `No validation rules for source: ${request.source}`,
            statusCode: 400
          }
        };
      }

      // Validate content
      const contentValidation = this.validateContent(request.content, rules.content);
      if (!contentValidation.valid) {
        return {
          success: false,
          error: {
            code: 'INVALID_CONTENT',
            message: contentValidation.error!,
            statusCode: 400
          }
        };
      }

      // Validate user ID
      const userIdValidation = this.validateUserId(request.userId, rules.userId);
      if (!userIdValidation.valid) {
        return {
          success: false,
          error: {
            code: 'INVALID_USER_ID',
            message: userIdValidation.error!,
            statusCode: 400
          }
        };
      }

      // Validate chat ID if present
      if (request.chatId && rules.chatId) {
        const chatIdValidation = this.validateChatId(request.chatId, rules.chatId);
        if (!chatIdValidation.valid) {
          return {
            success: false,
            error: {
              code: 'INVALID_CHAT_ID',
              message: chatIdValidation.error!,
              statusCode: 400
            }
          };
        }
      }

      // Validate session ID if present
      if (request.sessionId && rules.sessionId) {
        const sessionIdValidation = this.validateSessionId(request.sessionId, rules.sessionId);
        if (!sessionIdValidation.valid) {
          return {
            success: false,
            error: {
              code: 'INVALID_SESSION_ID',
              message: sessionIdValidation.error!,
              statusCode: 400
            }
          };
        }
      }

      // Sanitize content and return modified request
      const sanitizedContent = this.sanitizeContent(request.content, request.source);
      const sanitizedRequest: IncomingRequest = {
        ...request,
        content: sanitizedContent
      };

      return {
        success: true,
        request: sanitizedRequest,
        metadata: {
          validatedSource: request.source,
          sanitized: sanitizedContent !== request.content,
          originalLength: request.content.length,
          sanitizedLength: sanitizedContent.length
        }
      };

    } catch (error) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `Validation failed: ${(error as Error).message}`,
          statusCode: 500
        }
      };
    }
  }

  /**
   * Validate content
   */
  private validateContent(content: string, rules: ValidationRules['content']): { valid: boolean; error?: string } {
    // Check length
    if (content.length < rules.minLength) {
      return {
        valid: false,
        error: `Content too short. Minimum length: ${rules.minLength}`
      };
    }

    if (content.length > rules.maxLength) {
      return {
        valid: false,
        error: `Content too long. Maximum length: ${rules.maxLength}`
      };
    }

    // Check allowed characters
    if (rules.allowedChars && !rules.allowedChars.test(content)) {
      return {
        valid: false,
        error: 'Content contains invalid characters'
      };
    }

    // Check blocked patterns
    if (rules.blockedPatterns) {
      for (const pattern of rules.blockedPatterns) {
        if (pattern.test(content)) {
          return {
            valid: false,
            error: 'Content contains blocked patterns'
          };
        }
      }
    }

    return { valid: true };
  }

  /**
   * Validate user ID
   */
  private validateUserId(userId: string, rules: ValidationRules['userId']): { valid: boolean; error?: string } {
    if (userId.length > rules.maxLength) {
      return {
        valid: false,
        error: `User ID too long. Maximum length: ${rules.maxLength}`
      };
    }

    if (!rules.format.test(userId)) {
      return {
        valid: false,
        error: 'Invalid user ID format'
      };
    }

    return { valid: true };
  }

  /**
   * Validate chat ID
   */
  private validateChatId(chatId: string, rules: NonNullable<ValidationRules['chatId']>): { valid: boolean; error?: string } {
    if (!rules.format.test(chatId)) {
      return {
        valid: false,
        error: 'Invalid chat ID format'
      };
    }

    return { valid: true };
  }

  /**
   * Validate session ID
   */
  private validateSessionId(sessionId: string, rules: NonNullable<ValidationRules['sessionId']>): { valid: boolean; error?: string } {
    if (sessionId.length > rules.maxLength) {
      return {
        valid: false,
        error: `Session ID too long. Maximum length: ${rules.maxLength}`
      };
    }

    if (!rules.format.test(sessionId)) {
      return {
        valid: false,
        error: 'Invalid session ID format'
      };
    }

    return { valid: true };
  }

  /**
   * Sanitize content based on source
   */
  private sanitizeContent(content: string, source: string): string {
    let sanitized = content;

    // Remove null bytes
    sanitized = sanitized.replace(/\x00/g, '');

    // Source-specific sanitization
    switch (source) {
      case 'telegram':
        // Telegram-specific sanitization
        sanitized = this.sanitizeTelegramContent(sanitized);
        break;

      case 'http':
        // HTTP-specific sanitization
        sanitized = this.sanitizeHttpContent(sanitized);
        break;

      case 'cli':
        // CLI-specific sanitization
        sanitized = this.sanitizeCliContent(sanitized);
        break;
    }

    // Trim whitespace
    sanitized = sanitized.trim();

    return sanitized;
  }

  /**
   * Sanitize Telegram content
   */
  private sanitizeTelegramContent(content: string): string {
    // Remove excessive whitespace
    return content.replace(/\s+/g, ' ');
  }

  /**
   * Sanitize HTTP content
   */
  private sanitizeHttpContent(content: string): string {
    // Remove script tags and event handlers
    let sanitized = content.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    sanitized = sanitized.replace(/javascript:/gi, '');
    sanitized = sanitized.replace(/on\w+\s*=/gi, '');

    // Remove excessive whitespace
    sanitized = sanitized.replace(/\s+/g, ' ');

    return sanitized;
  }

  /**
   * Sanitize CLI content
   */
  private sanitizeCliContent(content: string): string {
    // Remove control characters
    let sanitized = content.replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');

    // Remove excessive whitespace
    sanitized = sanitized.replace(/\s+/g, ' ');

    return sanitized;
  }

  /**
   * Update validation rules for a source
   */
  updateRules(source: string, rules: ValidationRules): void {
    this.rules[source] = rules;
  }

  /**
   * Get current validation rules
   */
  getRules(source?: string): Record<string, ValidationRules> | ValidationRules | undefined {
    if (source) {
      return this.rules[source];
    }
    return this.rules;
  }
}