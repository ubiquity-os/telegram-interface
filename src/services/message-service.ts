/**
 * Message Service - Core message processing service
 *
 * Handles message processing coordination between UMP and existing system
 */

import {
  UniversalMessage,
  UniversalResponse,
  Platform,
  Session,
  UMPError,
  UMPErrorType
} from '../core/protocol/ump-types.ts';

import { MessageRouter } from '../core/message-router.ts';
import { SessionManager } from '../core/session-manager.ts';

/**
 * Message processing result
 */
export interface MessageProcessingResult {
  success: boolean;
  response?: UniversalResponse;
  error?: UMPError;
  processingTime: number;
  metadata: {
    sessionId: string;
    platform: Platform;
    retryCount?: number;
  };
}

/**
 * Message Service Configuration
 */
export interface MessageServiceConfig {
  enableMetrics: boolean;
  enableRetry: boolean;
  maxRetries: number;
  retryDelay: number;
  enableCircuitBreaker: boolean;
  timeoutMs: number;
}

/**
 * Main Message Service class
 */
export class MessageService {
  private config: MessageServiceConfig;
  private messageRouter: MessageRouter;
  private sessionManager: SessionManager;
  private metrics = {
    totalMessages: 0,
    successfulMessages: 0,
    failedMessages: 0,
    averageProcessingTime: 0,
    messagesByPlatform: new Map<Platform, number>()
  };

  constructor(
    config: MessageServiceConfig,
    messageRouter: MessageRouter,
    sessionManager: SessionManager
  ) {
    this.config = config;
    this.messageRouter = messageRouter;
    this.sessionManager = sessionManager;
  }

  /**
   * Process a universal message
   */
  async processMessage(message: UniversalMessage): Promise<MessageProcessingResult> {
    const startTime = Date.now();
    let retryCount = 0;

    try {
      // Update metrics
      this.updateMetrics(message.platform, 'received');

      // Get or create session
      let session = await this.sessionManager.getSession(message.sessionId);
      if (!session) {
        session = await this.sessionManager.createSession({
          userId: message.userId,
          platform: message.platform,
          metadata: message.content.metadata || {}
        });
      }

      // Touch session to update last active time
      await this.sessionManager.touchSession(session.id);

      // Process with retry logic
      let response: UniversalResponse;
      let lastError: Error;

      for (let attempt = 1; attempt <= (this.config.enableRetry ? this.config.maxRetries : 1); attempt++) {
        try {
          response = await this.processWithTimeout(message, session);

          // Update session context
          await this.sessionManager.updateSession(session.id, {
            context: {
              messageCount: session.context.messageCount + 1,
              lastMessageAt: new Date()
            }
          });

          // Success
          this.updateMetrics(message.platform, 'success');
          const processingTime = Date.now() - startTime;
          this.updateAverageProcessingTime(processingTime);

          return {
            success: true,
            response,
            processingTime,
            metadata: {
              sessionId: session.id,
              platform: message.platform,
              retryCount: attempt - 1
            }
          };

        } catch (error) {
          lastError = error as Error;
          retryCount = attempt - 1;

          if (attempt < this.config.maxRetries && this.config.enableRetry) {
            console.warn(`[MessageService] Attempt ${attempt} failed, retrying: ${error.message}`);
            await this.delay(this.config.retryDelay * attempt);
          }
        }
      }

      // All retries failed
      throw lastError!;

    } catch (error) {
      this.updateMetrics(message.platform, 'error');
      const processingTime = Date.now() - startTime;

      const umpError = error instanceof UMPError ? error : new UMPError(
        `Message processing failed: ${error.message}`,
        UMPErrorType.CONVERSION_FAILED,
        message.platform,
        error as Error
      );

      return {
        success: false,
        error: umpError,
        processingTime,
        metadata: {
          sessionId: message.sessionId,
          platform: message.platform,
          retryCount
        }
      };
    }
  }

  /**
   * Process message with timeout
   */
  private async processWithTimeout(
    message: UniversalMessage,
    session: Session
  ): Promise<UniversalResponse> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new UMPError(
          `Message processing timed out after ${this.config.timeoutMs}ms`,
          UMPErrorType.TEMPORARY_FAILURE,
          message.platform
        ));
      }, this.config.timeoutMs);

      this.messageRouter.routeMessage(message, session)
        .then(response => {
          clearTimeout(timeout);
          resolve(response);
        })
        .catch(error => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  /**
   * Get processing statistics
   */
  getStats(): {
    totalMessages: number;
    successfulMessages: number;
    failedMessages: number;
    successRate: number;
    averageProcessingTime: number;
    messagesByPlatform: Record<string, number>;
  } {
    const successRate = this.metrics.totalMessages > 0
      ? (this.metrics.successfulMessages / this.metrics.totalMessages) * 100
      : 0;

    const messagesByPlatform: Record<string, number> = {};
    this.metrics.messagesByPlatform.forEach((count, platform) => {
      messagesByPlatform[platform] = count;
    });

    return {
      totalMessages: this.metrics.totalMessages,
      successfulMessages: this.metrics.successfulMessages,
      failedMessages: this.metrics.failedMessages,
      successRate,
      averageProcessingTime: this.metrics.averageProcessingTime,
      messagesByPlatform
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.metrics = {
      totalMessages: 0,
      successfulMessages: 0,
      failedMessages: 0,
      averageProcessingTime: 0,
      messagesByPlatform: new Map<Platform, number>()
    };
  }

  /**
   * Update metrics
   */
  private updateMetrics(platform: Platform, type: 'received' | 'success' | 'error'): void {
    if (!this.config.enableMetrics) {
      return;
    }

    switch (type) {
      case 'received':
        this.metrics.totalMessages++;
        this.metrics.messagesByPlatform.set(
          platform,
          (this.metrics.messagesByPlatform.get(platform) || 0) + 1
        );
        break;
      case 'success':
        this.metrics.successfulMessages++;
        break;
      case 'error':
        this.metrics.failedMessages++;
        break;
    }
  }

  /**
   * Update average processing time
   */
  private updateAverageProcessingTime(processingTime: number): void {
    const totalSuccessful = this.metrics.successfulMessages;
    if (totalSuccessful === 1) {
      this.metrics.averageProcessingTime = processingTime;
    } else {
      this.metrics.averageProcessingTime =
        ((this.metrics.averageProcessingTime * (totalSuccessful - 1)) + processingTime) / totalSuccessful;
    }
  }

  /**
   * Delay utility
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Create default configuration for Message Service
 */
export function createDefaultMessageServiceConfig(): MessageServiceConfig {
  return {
    enableMetrics: true,
    enableRetry: true,
    maxRetries: 3,
    retryDelay: 1000,
    enableCircuitBreaker: true,
    timeoutMs: 30000
  };
}

/**
 * Message Service factory
 */
export class MessageServiceFactory {
  /**
   * Create Message Service with dependencies
   */
  static create(
    messageRouter: MessageRouter,
    sessionManager: SessionManager,
    config?: Partial<MessageServiceConfig>
  ): MessageService {
    const defaultConfig = createDefaultMessageServiceConfig();
    const finalConfig = { ...defaultConfig, ...config };

    return new MessageService(finalConfig, messageRouter, sessionManager);
  }
}