/**
 * Context Manager implementation
 */

import {
  IContextManager,
  ComponentStatus,
  ContextStats,
  IEventEmitter
} from '../../interfaces/component-interfaces.ts';
import {
  ConversationContext,
  UserPreferences,
  InternalMessage,
  EventType,
  SystemEvent
} from '../../interfaces/message-types.ts';
import {
  ContextManagerConfig,
  IContextStorage,
  StorageStats,
  CleanupResult,
  PruneOptions,
  ContextQueryOptions
} from './types.ts';

export class ContextManager implements IContextManager {
  private config: ContextManagerConfig;
  private storage: IContextStorage;
  private eventEmitter: IEventEmitter | null = null;
  private cleanupInterval: number | null = null;
  private isInitialized = false;

  constructor(
    config: ContextManagerConfig,
    storage: IContextStorage,
    eventEmitter?: IEventEmitter
  ) {
    this.config = config;
    this.storage = storage;
    this.eventEmitter = eventEmitter || null;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      throw new Error('ContextManager already initialized');
    }

    try {
      // Start cleanup interval if enabled
      if (this.config.cleanup.enabled) {
        this.startCleanupInterval();
      }

      this.isInitialized = true;

      this.emitEvent({
        type: EventType.COMPONENT_READY,
        source: 'ContextManager',
        timestamp: new Date(),
        data: { status: 'initialized' }
      });
    } catch (error) {
      this.emitEvent({
        type: EventType.COMPONENT_ERROR,
        source: 'ContextManager',
        timestamp: new Date(),
        data: { error: error instanceof Error ? error.message : 'Unknown error' }
      });
      throw error;
    }
  }

  async addMessage(message: InternalMessage): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('ContextManager not initialized');
    }

    try {
      // Get existing conversation or create new one
      let context = await this.storage.getConversation(message.chatId);

      if (!context) {
        context = {
          chatId: message.chatId,
          userId: message.userId,
          messages: [],
          metadata: {
            startTime: new Date(),
            lastUpdateTime: new Date(),
            messageCount: 0
          }
        };
      }

      // Add the message
      await this.storage.addMessage(message.chatId, message);

      // Update context metadata
      context.metadata.lastUpdateTime = new Date();
      context.metadata.messageCount++;

      // Check if we need to prune old messages
      if (context.metadata.messageCount > this.config.limits.maxMessagesPerChat) {
        const excessCount = context.metadata.messageCount - this.config.limits.maxMessagesPerChat;
        const deletedCount = await this.storage.deleteOldMessages(
          message.chatId,
          this.config.limits.maxMessagesPerChat
        );
        context.metadata.messageCount -= deletedCount;
      }

      // Save updated context
      await this.storage.saveConversation(context);

    } catch (error) {
      this.emitEvent({
        type: EventType.COMPONENT_ERROR,
        source: 'ContextManager',
        timestamp: new Date(),
        data: {
          error: 'Failed to add message',
          chatId: message.chatId,
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      });
      throw error;
    }
  }

  async getContext(chatId: number, maxMessages?: number): Promise<ConversationContext> {
    if (!this.isInitialized) {
      throw new Error('ContextManager not initialized');
    }

    try {
      // Get conversation metadata
      let context = await this.storage.getConversation(chatId);

      if (!context) {
        // Return empty context for new conversations
        return {
          chatId,
          userId: 0,
          messages: [],
          metadata: {
            startTime: new Date(),
            lastUpdateTime: new Date(),
            messageCount: 0
          }
        };
      }

      // Get messages with limit
      const messages = await this.storage.getMessages(
        chatId,
        maxMessages || this.config.limits.maxMessagesPerChat
      );

      return {
        ...context,
        messages
      };

    } catch (error) {
      this.emitEvent({
        type: EventType.COMPONENT_ERROR,
        source: 'ContextManager',
        timestamp: new Date(),
        data: {
          error: 'Failed to get context',
          chatId,
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      });
      throw error;
    }
  }

  async clearContext(chatId: number): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('ContextManager not initialized');
    }

    try {
      await this.storage.deleteConversation(chatId);
    } catch (error) {
      this.emitEvent({
        type: EventType.COMPONENT_ERROR,
        source: 'ContextManager',
        timestamp: new Date(),
        data: {
          error: 'Failed to clear context',
          chatId,
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      });
      throw error;
    }
  }

  async getUserPreferences(userId: number): Promise<UserPreferences> {
    if (!this.isInitialized) {
      throw new Error('ContextManager not initialized');
    }

    try {
      const preferences = await this.storage.getUserPreferences(userId);

      // Return default preferences if none exist
      if (!preferences) {
        return {
          userId,
          language: 'en',
          timezone: 'UTC',
          model: 'default',
          // Don't artificially limit free models - let them use their natural token limits
          temperature: 0.7
        };
      }

      return preferences;
    } catch (error) {
      this.emitEvent({
        type: EventType.COMPONENT_ERROR,
        source: 'ContextManager',
        timestamp: new Date(),
        data: {
          error: 'Failed to get user preferences',
          userId,
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      });
      throw error;
    }
  }

  async updateUserPreferences(userId: number, preferences: Partial<UserPreferences>): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('ContextManager not initialized');
    }

    try {
      // Get existing preferences
      const existing = await this.getUserPreferences(userId);

      // Merge with updates
      const updated: UserPreferences = {
        ...existing,
        ...preferences,
        userId // Ensure userId is correct
      };

      await this.storage.saveUserPreferences(updated);
    } catch (error) {
      this.emitEvent({
        type: EventType.COMPONENT_ERROR,
        source: 'ContextManager',
        timestamp: new Date(),
        data: {
          error: 'Failed to update user preferences',
          userId,
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      });
      throw error;
    }
  }

  async getContextStats(chatId: number): Promise<ContextStats> {
    if (!this.isInitialized) {
      throw new Error('ContextManager not initialized');
    }

    try {
      const context = await this.storage.getConversation(chatId);

      if (!context) {
        return {
          messageCount: 0
        };
      }

      const messages = await this.storage.getMessages(chatId);

      let totalTokens = 0;
      let totalResponseTime = 0;
      let responseCount = 0;

      for (const message of messages) {
        if (message.metadata.tokensUsed) {
          totalTokens += message.metadata.tokensUsed;
        }
        if (message.metadata.processingTime) {
          totalResponseTime += message.metadata.processingTime;
          responseCount++;
        }
      }

      return {
        messageCount: context.metadata.messageCount,
        firstMessageTime: context.metadata.startTime,
        lastMessageTime: context.metadata.lastUpdateTime,
        totalTokens: totalTokens || undefined,
        averageResponseTime: responseCount > 0 ? totalResponseTime / responseCount : undefined
      };

    } catch (error) {
      this.emitEvent({
        type: EventType.COMPONENT_ERROR,
        source: 'ContextManager',
        timestamp: new Date(),
        data: {
          error: 'Failed to get context stats',
          chatId,
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      });
      throw error;
    }
  }

  async pruneOldConversations(maxAge: number): Promise<number> {
    if (!this.isInitialized) {
      throw new Error('ContextManager not initialized');
    }

    try {
      const expiredConversations = await this.storage.getExpiredConversations(maxAge);

      for (const chatId of expiredConversations) {
        await this.storage.deleteConversation(chatId);
      }

      if (expiredConversations.length > 0) {
        this.emitEvent({
          type: EventType.CONTEXT_OVERFLOW,
          source: 'ContextManager',
          timestamp: new Date(),
          data: {
            action: 'pruned_conversations',
            count: expiredConversations.length,
            maxAge
          }
        });
      }

      return expiredConversations.length;
    } catch (error) {
      this.emitEvent({
        type: EventType.COMPONENT_ERROR,
        source: 'ContextManager',
        timestamp: new Date(),
        data: {
          error: 'Failed to prune conversations',
          maxAge,
          details: error instanceof Error ? error.message : 'Unknown error'
        }
      });
      throw error;
    }
  }

  getStatus(): ComponentStatus {
    return {
      name: 'ContextManager',
      status: this.isInitialized ? 'healthy' : 'unhealthy',
      lastHealthCheck: new Date(),
      metadata: {
        cleanupEnabled: this.config.cleanup.enabled,
        maxMessagesPerChat: this.config.limits.maxMessagesPerChat,
        maxConversationAge: this.config.limits.maxConversationAge
      }
    };
  }

  async getStorageStats(): Promise<StorageStats> {
    if (!this.isInitialized) {
      throw new Error('ContextManager not initialized');
    }

    return await this.storage.getStorageStats();
  }

  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(async () => {
      try {
        await this.performCleanup();
      } catch (error) {
        console.error('Cleanup failed:', error);
        this.emitEvent({
          type: EventType.COMPONENT_ERROR,
          source: 'ContextManager',
          timestamp: new Date(),
          data: {
            error: 'Cleanup failed',
            details: error instanceof Error ? error.message : 'Unknown error'
          }
        });
      }
    }, this.config.cleanup.interval) as any;
  }

  private async performCleanup(): Promise<CleanupResult> {
    // Prune old conversations
    const deletedConversations = await this.pruneOldConversations(this.config.limits.maxConversationAge);

    // Perform storage-specific cleanup
    const cleanupResult = await this.storage.cleanup();

    const totalResult: CleanupResult = {
      conversationsDeleted: deletedConversations + cleanupResult.conversationsDeleted,
      messagesDeleted: cleanupResult.messagesDeleted,
      spaceFree: cleanupResult.spaceFree,
      duration: cleanupResult.duration
    };

    if (totalResult.conversationsDeleted > 0 || totalResult.messagesDeleted > 0) {
      this.emitEvent({
        type: 'cleanup.completed',
        source: 'ContextManager',
        timestamp: new Date(),
        data: totalResult
      });
    }

    return totalResult;
  }

  private emitEvent(event: SystemEvent): void {
    if (this.eventEmitter) {
      this.eventEmitter.emit(event);
    }
  }

  async shutdown(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.isInitialized = false;
  }
}