/**
 * Types specific to the Telegram Interface Adapter
 */

import { TelegramUpdate } from '../../interfaces/component-interfaces.ts';

// Rate limiting configuration
export interface RateLimitConfig {
  maxMessagesPerSecond: number;
  maxMessagesPerMinute: number;
  maxMessagesPerHour: number;
}

// Message queue item
export interface QueuedMessage {
  id: string;
  chatId: number;
  text: string;
  replyMarkup?: any;
  parseMode?: 'Markdown' | 'HTML';
  timestamp: Date;
  retryCount: number;
}

// TIA configuration
export interface TelegramInterfaceAdapterConfig {
  botToken: string;
  webhookSecret?: string;
  maxMessageLength: number;
  rateLimits: RateLimitConfig;
  queueConfig: {
    maxQueueSize: number;
    processingInterval: number;
    maxRetries: number;
  };
  testMode?: boolean; // For capturing responses instead of sending to Telegram
}

// Rate limit state
export interface RateLimitState {
  messagesThisSecond: number;
  messagesThisMinute: number;
  messagesThisHour: number;
  lastResetSecond: Date;
  lastResetMinute: Date;
  lastResetHour: Date;
}

// Deduplication cache entry
export interface DeduplicationEntry {
  updateId: number;
  timestamp: Date;
}