/**
 * Authentication Middleware - Phase 3.1
 *
 * Handles request authentication and authorization
 */

import { Middleware, MiddlewareResult, IncomingRequest } from '../api-gateway.ts';

/**
 * Authentication middleware implementation
 */
export class AuthenticationMiddleware implements Middleware {
  name = 'Authentication';
  order = 2; // Second in pipeline, after rate limiting
  enabled: boolean;

  constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  /**
   * Execute authentication check
   */
  async execute(request: IncomingRequest): Promise<MiddlewareResult> {
    // Skip authentication if disabled
    if (!this.enabled) {
      return { success: true };
    }

    // For current implementation, authentication is not strictly required
    // as the system is designed to work with Telegram's built-in authentication
    // and REST API with basic validation

    try {
      // Validate basic request structure
      if (!request.userId || !request.content) {
        return {
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'Missing required fields: userId or content',
            statusCode: 400
          }
        };
      }

      // Validate user ID format
      if (!/^\d+$/.test(request.userId) && !request.userId.startsWith('cli-user-')) {
        return {
          success: false,
          error: {
            code: 'INVALID_USER_ID',
            message: 'Invalid user ID format',
            statusCode: 400
          }
        };
      }

      // Source-specific authentication
      switch (request.source) {
        case 'telegram':
          return this.authenticateTelegramRequest(request);

        case 'http':
          return this.authenticateHttpRequest(request);

        case 'cli':
          return this.authenticateCliRequest(request);

        default:
          return {
            success: false,
            error: {
              code: 'UNKNOWN_SOURCE',
              message: `Unknown request source: ${request.source}`,
              statusCode: 400
            }
          };
      }

    } catch (error) {
      return {
        success: false,
        error: {
          code: 'AUTHENTICATION_ERROR',
          message: `Authentication failed: ${(error as Error).message}`,
          statusCode: 500
        }
      };
    }
  }

  /**
   * Authenticate Telegram requests
   */
  private authenticateTelegramRequest(request: IncomingRequest): MiddlewareResult {
    // Telegram requests are authenticated through the bot token
    // and webhook secret, which is validated before reaching the gateway

    // Additional validation for Telegram-specific fields
    if (request.chatId && !/^-?\d+$/.test(request.chatId)) {
      return {
        success: false,
        error: {
          code: 'INVALID_CHAT_ID',
          message: 'Invalid chat ID format for Telegram request',
          statusCode: 400
        }
      };
    }

    return {
      success: true,
      metadata: {
        authenticatedSource: 'telegram',
        userId: request.userId,
        chatId: request.chatId
      }
    };
  }

  /**
   * Authenticate HTTP API requests
   */
  private authenticateHttpRequest(request: IncomingRequest): MiddlewareResult {
    // For HTTP requests, we could validate API keys if required
    // Currently using basic validation

    // Check for session ID if required
    if (!request.sessionId) {
      return {
        success: false,
        error: {
          code: 'MISSING_SESSION_ID',
          message: 'Session ID is required for HTTP requests',
          statusCode: 400
        }
      };
    }

    // Validate session ID format
    if (!/^[a-zA-Z0-9-_]+$/.test(request.sessionId)) {
      return {
        success: false,
        error: {
          code: 'INVALID_SESSION_ID',
          message: 'Invalid session ID format',
          statusCode: 400
        }
      };
    }

    return {
      success: true,
      metadata: {
        authenticatedSource: 'http',
        userId: request.userId,
        sessionId: request.sessionId
      }
    };
  }

  /**
   * Authenticate CLI requests
   */
  private authenticateCliRequest(request: IncomingRequest): MiddlewareResult {
    // CLI requests have basic validation
    // User ID should start with 'cli-user-' for CLI requests

    if (!request.userId.startsWith('cli-user-')) {
      return {
        success: false,
        error: {
          code: 'INVALID_CLI_USER_ID',
          message: 'CLI user ID must start with "cli-user-"',
          statusCode: 400
        }
      };
    }

    return {
      success: true,
      metadata: {
        authenticatedSource: 'cli',
        userId: request.userId
      }
    };
  }

  /**
   * Enable or disable authentication
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Validate API key (if authentication is enhanced in the future)
   */
  private validateApiKey(apiKey: string): boolean {
    // Placeholder for future API key validation
    // Could check against environment variables or database
    return apiKey && apiKey.length > 10;
  }
}