/**
 * Deno KV implementation of IContextStorage
 */

import {
  IContextStorage,
  StorageStats,
  CleanupResult,
  PruneOptions,
  ContextQueryOptions
} from './types.ts';
import {
  ConversationContext,
  UserPreferences,
  InternalMessage
} from '../../interfaces/message-types.ts';

export class KVContextStorage implements IContextStorage {
  private kv: Deno.Kv | null = null;
  private kvPath?: string;

  constructor(kvPath?: string) {
    this.kvPath = kvPath;
  }

  async initialize(): Promise<void> {
    this.kv = await Deno.openKv(this.kvPath);
  }

  async getConversation(chatId: number): Promise<ConversationContext | null> {
    if (!this.kv) throw new Error('Storage not initialized');

    const result = await this.kv.get(['chat', chatId, 'context']);
    return result.value as ConversationContext | null;
  }

  async saveConversation(context: ConversationContext): Promise<void> {
    if (!this.kv) throw new Error('Storage not initialized');

    await this.kv.set(['chat', context.chatId, 'context'], context);
  }

  async deleteConversation(chatId: number): Promise<void> {
    if (!this.kv) throw new Error('Storage not initialized');

    // Delete context
    await this.kv.delete(['chat', chatId, 'context']);

    // Delete all messages for this chat
    const iter = this.kv.list({ prefix: ['chat', chatId, 'messages'] });
    const keysToDelete: Deno.KvKey[] = [];

    for await (const entry of iter) {
      keysToDelete.push(entry.key);
    }

    // Batch delete
    for (const key of keysToDelete) {
      await this.kv.delete(key);
    }
  }

  async addMessage(chatId: number, message: InternalMessage): Promise<void> {
    if (!this.kv) throw new Error('Storage not initialized');

    // Store message with timestamp as key for ordering
    await this.kv.set(
      ['chat', chatId, 'messages', message.timestamp.getTime()],
      message
    );
  }

  async getMessages(chatId: number, limit?: number): Promise<InternalMessage[]> {
    if (!this.kv) throw new Error('Storage not initialized');

    const messages: InternalMessage[] = [];
    const iter = this.kv.list<InternalMessage>({
      prefix: ['chat', chatId, 'messages']
    });

    for await (const entry of iter) {
      if (entry.value) {
        messages.push(entry.value);
      }
    }

    // Sort by timestamp (newest first)
    messages.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Apply limit if specified
    if (limit && messages.length > limit) {
      messages.splice(limit);
    }

    // Return in chronological order
    return messages.reverse();
  }

  async deleteOldMessages(chatId: number, keepCount: number): Promise<number> {
    if (!this.kv) throw new Error('Storage not initialized');

    const allMessages: Array<{ key: Deno.KvKey; value: InternalMessage }> = [];
    const iter = this.kv.list<InternalMessage>({
      prefix: ['chat', chatId, 'messages']
    });

    for await (const entry of iter) {
      if (entry.value) {
        allMessages.push({ key: entry.key, value: entry.value });
      }
    }

    // Sort by timestamp (oldest first)
    allMessages.sort((a, b) =>
      a.value.timestamp.getTime() - b.value.timestamp.getTime()
    );

    // Calculate how many to delete
    const deleteCount = Math.max(0, allMessages.length - keepCount);

    // Delete oldest messages
    for (let i = 0; i < deleteCount; i++) {
      await this.kv.delete(allMessages[i].key);
    }

    return deleteCount;
  }

  async getUserPreferences(userId: number): Promise<UserPreferences | null> {
    if (!this.kv) throw new Error('Storage not initialized');

    const result = await this.kv.get(['user', userId, 'preferences']);
    return result.value as UserPreferences | null;
  }

  async saveUserPreferences(preferences: UserPreferences): Promise<void> {
    if (!this.kv) throw new Error('Storage not initialized');

    await this.kv.set(['user', preferences.userId, 'preferences'], preferences);
  }

  async getExpiredConversations(maxAge: number): Promise<number[]> {
    if (!this.kv) throw new Error('Storage not initialized');

    const expiredChats: number[] = [];
    const cutoffTime = Date.now() - maxAge;

    const iter = this.kv.list<ConversationContext>({ prefix: ['chat'] });

    for await (const entry of iter) {
      if (entry.key[2] === 'context' && entry.value) {
        const context = entry.value;
        if (context.metadata.lastUpdateTime.getTime() < cutoffTime) {
          expiredChats.push(context.chatId);
        }
      }
    }

    return expiredChats;
  }

  async getStorageStats(): Promise<StorageStats> {
    if (!this.kv) throw new Error('Storage not initialized');

    let conversationCount = 0;
    let totalMessages = 0;
    let oldestConversation: Date | undefined;
    let newestConversation: Date | undefined;

    // Count conversations and messages
    const chatIter = this.kv.list({ prefix: ['chat'] });

    for await (const entry of chatIter) {
      if (entry.key[2] === 'context' && entry.value) {
        conversationCount++;
        const context = entry.value as ConversationContext;

        // Track oldest and newest
        if (!oldestConversation || context.metadata.startTime < oldestConversation) {
          oldestConversation = context.metadata.startTime;
        }
        if (!newestConversation || context.metadata.lastUpdateTime > newestConversation) {
          newestConversation = context.metadata.lastUpdateTime;
        }
      } else if (entry.key[2] === 'messages') {
        totalMessages++;
      }
    }

    return {
      conversationCount,
      totalMessages,
      storageSize: 0, // KV doesn't provide size info
      oldestConversation,
      newestConversation
    };
  }

  async cleanup(options?: PruneOptions): Promise<CleanupResult> {
    const startTime = Date.now();
    let conversationsDeleted = 0;
    let messagesDeleted = 0;

    // For now, just return empty result
    // In a real implementation, this would clean up based on options

    return {
      conversationsDeleted,
      messagesDeleted,
      spaceFree: 0,
      duration: Date.now() - startTime
    };
  }

  async queryConversations(options: ContextQueryOptions): Promise<ConversationContext[]> {
    if (!this.kv) throw new Error('Storage not initialized');

    const conversations: ConversationContext[] = [];
    const iter = this.kv.list<ConversationContext>({ prefix: ['chat'] });

    for await (const entry of iter) {
      if (entry.key[2] === 'context' && entry.value) {
        const context = entry.value;

        // Apply filter by user if specified
        if (options.filterByUser && context.userId !== options.filterByUser) continue;

        conversations.push(context);
      }
    }

    return conversations;
  }

  async close(): Promise<void> {
    if (this.kv) {
      this.kv.close();
      this.kv = null;
    }
  }
}