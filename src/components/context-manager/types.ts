/**
 * Types specific to the Context Manager
 */

import { ConversationContext, UserPreferences, InternalMessage } from '../../interfaces/message-types.ts';

// Context Manager configuration
export interface ContextManagerConfig {
  storage: {
    type: 'deno-kv' | 'memory';
    kvPath?: string;
  };
  limits: {
    maxConversationAge: number; // in milliseconds
    maxMessagesPerChat: number;
    maxStorageSize: number; // in bytes
  };
  cleanup: {
    enabled: boolean;
    interval: number; // cleanup interval in milliseconds
    batchSize: number; // number of conversations to process per batch
  };
}

// Storage interface abstraction
export interface IContextStorage {
  // Conversation methods
  getConversation(chatId: number): Promise<ConversationContext | null>;
  saveConversation(context: ConversationContext): Promise<void>;
  deleteConversation(chatId: number): Promise<void>;

  // Message methods
  addMessage(chatId: number, message: InternalMessage): Promise<void>;
  getMessages(chatId: number, limit?: number): Promise<InternalMessage[]>;
  deleteOldMessages(chatId: number, keepCount: number): Promise<number>;

  // User preferences methods
  getUserPreferences(userId: number): Promise<UserPreferences | null>;
  saveUserPreferences(preferences: UserPreferences): Promise<void>;

  // Maintenance methods
  getExpiredConversations(maxAge: number): Promise<number[]>;
  getStorageStats(): Promise<StorageStats>;
  cleanup(): Promise<CleanupResult>;
}

// Storage statistics
export interface StorageStats {
  conversationCount: number;
  totalMessages: number;
  storageSize: number;
  oldestConversation?: Date;
  newestConversation?: Date;
}

// Cleanup operation result
export interface CleanupResult {
  conversationsDeleted: number;
  messagesDeleted: number;
  spaceFree: number;
  duration: number;
}

// Context pruning options
export interface PruneOptions {
  maxAge?: number;
  maxMessages?: number;
  keepRecent?: number;
}

// Context query options
export interface ContextQueryOptions {
  maxMessages?: number;
  includeMetadata?: boolean;
  filterByUser?: number;
}