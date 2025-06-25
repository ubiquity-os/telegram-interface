/**
 * Telegram Interface Adapter implementation
 */

import { Bot } from "grammy";
import {
  ITelegramInterfaceAdapter,
  TelegramUpdate,
  ComponentStatus
} from '../../interfaces/component-interfaces.ts';
import {
  TelegramMessage,
  TelegramResponse
} from '../../interfaces/message-types.ts';
import {
  TelegramInterfaceAdapterConfig,
  QueuedMessage,
  RateLimitState,
  DeduplicationEntry
} from './types.ts';
import { createEventEmitter, SystemEventType } from '../../services/event-bus/index.ts';

export class TelegramInterfaceAdapter implements ITelegramInterfaceAdapter {
  public readonly name = 'TelegramInterfaceAdapter';

  private bot: Bot | null = null;
  private config: TelegramInterfaceAdapterConfig;
  private messageQueue: QueuedMessage[] = [];
  private rateLimitState: RateLimitState;
  private deduplicationCache: Map<number, DeduplicationEntry> = new Map();
  private processingInterval: number | null = null;
  private eventEmitter: ReturnType<typeof createEventEmitter>;
  private isInitialized = false;

  constructor(config: TelegramInterfaceAdapterConfig) {
    this.config = config;
    this.eventEmitter = createEventEmitter('TelegramInterfaceAdapter');

    // Initialize rate limit state
    const now = new Date();
    this.rateLimitState = {
      messagesThisSecond: 0,
      messagesThisMinute: 0,
      messagesThisHour: 0,
      lastResetSecond: now,
      lastResetMinute: now,
      lastResetHour: now,
    };
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      throw new Error('TelegramInterfaceAdapter already initialized');
    }

    try {
      // Create bot instance
      this.bot = new Bot(this.config.botToken);

      // Start message queue processor
      this.startQueueProcessor();

      // Clean up old deduplication entries periodically
      setInterval(() => this.cleanDeduplicationCache(), 60000); // Every minute

      this.isInitialized = true;

      // Emit component initialized event
      await this.eventEmitter.emit({
        type: SystemEventType.COMPONENT_INITIALIZED,
        payload: {
          componentName: this.name,
          timestamp: new Date()
        }
      });
    } catch (error) {
      // Emit component error event
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

  async receiveUpdate(update: TelegramUpdate): Promise<TelegramMessage> {
    if (!this.isInitialized) {
      throw new Error('TelegramInterfaceAdapter not initialized');
    }

    // Check for duplicate updates
    if (this.isDuplicateUpdate(update.update_id)) {
      throw new Error(`Duplicate update received: ${update.update_id}`);
    }

    // Store update ID for deduplication
    this.deduplicationCache.set(update.update_id, {
      updateId: update.update_id,
      timestamp: new Date()
    });

    // Convert Telegram update to internal message format
    let telegramMessage: TelegramMessage;

    if (update.message) {
      telegramMessage = {
        chatId: update.message.chat.id,
        userId: update.message.from?.id || 0,
        messageId: update.message.message_id,
        text: update.message.text,
        timestamp: new Date(update.message.date * 1000)
      };
    } else if (update.callback_query) {
      telegramMessage = {
        chatId: update.callback_query.message?.chat.id || 0,
        userId: update.callback_query.from.id,
        messageId: update.callback_query.message?.message_id || 0,
        callbackData: update.callback_query.data,
        timestamp: new Date()
      };
    } else {
      throw new Error('Unsupported update type');
    }

    // Emit message received event
    await this.eventEmitter.emit({
      type: SystemEventType.MESSAGE_RECEIVED,
      payload: {
        message: telegramMessage,
        requestId: telegramMessage.messageId.toString()
      }
    });

    return telegramMessage;
  }

  async sendResponse(response: TelegramResponse): Promise<void> {
    if (!this.isInitialized || !this.bot) {
      throw new Error('TelegramInterfaceAdapter not initialized');
    }

    // Check if we can send immediately or need to queue
    if (this.canSendNow()) {
      await this.sendMessage(response);
    } else {
      // Queue the message
      this.queueMessage(response);
    }
  }

  async sendTypingIndicator(chatId: number): Promise<void> {
    if (!this.isInitialized || !this.bot) {
      throw new Error('TelegramInterfaceAdapter not initialized');
    }

    try {
      await this.bot.api.sendChatAction(chatId, 'typing');
    } catch (error) {
      console.error('Failed to send typing indicator:', error);
      // Don't throw - typing indicator is not critical
    }
  }

  getStatus(): ComponentStatus {
    return {
      name: 'TelegramInterfaceAdapter',
      status: this.isInitialized ? 'healthy' : 'unhealthy',
      lastHealthCheck: new Date(),
      metadata: {
        queueSize: this.messageQueue.length,
        rateLimitState: this.rateLimitState,
        deduplicationCacheSize: this.deduplicationCache.size
      }
    };
  }

  private async sendMessage(response: TelegramResponse): Promise<void> {
    if (!this.bot) return;

    try {
      // Split message if it's too long
      const chunks = this.splitMessage(response.text);

      for (const chunk of chunks) {
        const options: any = {
          parse_mode: response.parseMode
        };

        if (response.replyMarkup) {
          options.reply_markup = response.replyMarkup;
        }

        await this.bot.api.sendMessage(response.chatId, chunk, options);

        // Update rate limit counters
        this.incrementRateLimitCounters();

        // Small delay between chunks
        if (chunks.length > 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      throw error;
    }
  }

  private splitMessage(text: string): string[] {
    if (text.length <= this.config.maxMessageLength) {
      return [text];
    }

    const chunks: string[] = [];
    let currentChunk = '';
    const lines = text.split('\n');

    for (const line of lines) {
      if (currentChunk.length + line.length + 1 > this.config.maxMessageLength) {
        if (currentChunk) {
          chunks.push(currentChunk);
          currentChunk = line;
        } else {
          // Single line is too long, split it
          let remaining = line;
          while (remaining.length > 0) {
            chunks.push(remaining.substring(0, this.config.maxMessageLength));
            remaining = remaining.substring(this.config.maxMessageLength);
          }
        }
      } else {
        currentChunk += (currentChunk ? '\n' : '') + line;
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk);
    }

    return chunks;
  }

  private queueMessage(response: TelegramResponse): void {
    if (this.messageQueue.length >= this.config.queueConfig.maxQueueSize) {
      throw new Error('Message queue is full');
    }

    const queuedMessage: QueuedMessage = {
      id: crypto.randomUUID(),
      chatId: response.chatId,
      text: response.text,
      replyMarkup: response.replyMarkup,
      parseMode: response.parseMode,
      timestamp: new Date(),
      retryCount: 0
    };

    this.messageQueue.push(queuedMessage);
  }

  private canSendNow(): boolean {
    this.updateRateLimitCounters();

    const { rateLimits } = this.config;
    const { messagesThisSecond, messagesThisMinute, messagesThisHour } = this.rateLimitState;

    return messagesThisSecond < rateLimits.maxMessagesPerSecond &&
           messagesThisMinute < rateLimits.maxMessagesPerMinute &&
           messagesThisHour < rateLimits.maxMessagesPerHour;
  }

  private updateRateLimitCounters(): void {
    const now = new Date();

    // Reset second counter
    if (now.getTime() - this.rateLimitState.lastResetSecond.getTime() >= 1000) {
      this.rateLimitState.messagesThisSecond = 0;
      this.rateLimitState.lastResetSecond = now;
    }

    // Reset minute counter
    if (now.getTime() - this.rateLimitState.lastResetMinute.getTime() >= 60000) {
      this.rateLimitState.messagesThisMinute = 0;
      this.rateLimitState.lastResetMinute = now;
    }

    // Reset hour counter
    if (now.getTime() - this.rateLimitState.lastResetHour.getTime() >= 3600000) {
      this.rateLimitState.messagesThisHour = 0;
      this.rateLimitState.lastResetHour = now;
    }
  }

  private incrementRateLimitCounters(): void {
    this.rateLimitState.messagesThisSecond++;
    this.rateLimitState.messagesThisMinute++;
    this.rateLimitState.messagesThisHour++;
  }

  private startQueueProcessor(): void {
    this.processingInterval = setInterval(async () => {
      if (this.messageQueue.length === 0) return;

      // Process messages that can be sent now
      while (this.messageQueue.length > 0 && this.canSendNow()) {
        const queuedMessage = this.messageQueue.shift()!;

        try {
          await this.sendMessage({
            chatId: queuedMessage.chatId,
            text: queuedMessage.text,
            replyMarkup: queuedMessage.replyMarkup,
            parseMode: queuedMessage.parseMode
          });
        } catch (error) {
          console.error('Failed to send queued message:', error);

          // Retry logic
          if (queuedMessage.retryCount < this.config.queueConfig.maxRetries) {
            queuedMessage.retryCount++;
            this.messageQueue.push(queuedMessage); // Add back to end of queue
          } else {
            // Message failed after max retries
            await this.eventEmitter.emit({
              type: SystemEventType.COMPONENT_ERROR,
              payload: {
                componentName: this.name,
                error: new Error('Message failed after max retries')
              },
              metadata: {
                messageId: queuedMessage.id
              }
            });
          }
        }
      }

      // Check for rate limit hit
      if (this.messageQueue.length > 0 && !this.canSendNow()) {
        // We don't have a specific rate limit event in the new system
        // Could emit a component error or create a custom event type
        await this.eventEmitter.emit({
          type: SystemEventType.COMPONENT_ERROR,
          payload: {
            componentName: this.name,
            error: new Error(`Rate limit hit. Queue size: ${this.messageQueue.length}`)
          }
        });
      }
    }, this.config.queueConfig.processingInterval) as any;
  }

  private isDuplicateUpdate(updateId: number): boolean {
    return this.deduplicationCache.has(updateId);
  }

  private cleanDeduplicationCache(): void {
    const now = new Date();
    const maxAge = 5 * 60 * 1000; // 5 minutes

    for (const [updateId, entry] of this.deduplicationCache.entries()) {
      if (now.getTime() - entry.timestamp.getTime() > maxAge) {
        this.deduplicationCache.delete(updateId);
      }
    }
  }

  async shutdown(): Promise<void> {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }

    this.isInitialized = false;
    this.bot = null;
  }
}