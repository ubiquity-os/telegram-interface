import { test, expect, describe, beforeEach } from "bun:test";
import { ContextManager } from "../../src/components/context-manager/context-manager.ts";
import type { ContextManagerConfig, IContextStorage, StorageStats, CleanupResult } from "../../src/components/context-manager/types.ts";
import type { ConversationContext, UserPreferences, InternalMessage } from "../../src/interfaces/message-types.ts";

// Mock storage implementation
class MockStorage implements IContextStorage {
  private conversations = new Map<number, ConversationContext>();
  private messages = new Map<number, InternalMessage[]>();
  private preferences = new Map<number, UserPreferences>();

  async getConversation(chatId: number): Promise<ConversationContext | null> {
    return this.conversations.get(chatId) || null;
  }

  async saveConversation(context: ConversationContext): Promise<void> {
    this.conversations.set(context.chatId, context);
  }

  async deleteConversation(chatId: number): Promise<void> {
    this.conversations.delete(chatId);
    this.messages.delete(chatId);
  }

  async addMessage(chatId: number, message: InternalMessage): Promise<void> {
    if (!this.messages.has(chatId)) {
      this.messages.set(chatId, []);
    }
    this.messages.get(chatId)!.push(message);
  }

  async getMessages(chatId: number, limit?: number): Promise<InternalMessage[]> {
    const messages = this.messages.get(chatId) || [];
    return limit ? messages.slice(-limit) : messages;
  }

  async deleteOldMessages(chatId: number, keepCount: number): Promise<number> {
    const messages = this.messages.get(chatId) || [];
    if (messages.length <= keepCount) return 0;

    const toDelete = messages.length - keepCount;
    this.messages.set(chatId, messages.slice(-keepCount));
    return toDelete;
  }

  async getUserPreferences(userId: number): Promise<UserPreferences | null> {
    return this.preferences.get(userId) || null;
  }

  async saveUserPreferences(preferences: UserPreferences): Promise<void> {
    this.preferences.set(preferences.userId, preferences);
  }

  async getExpiredConversations(maxAge: number): Promise<number[]> {
    const cutoff = new Date(Date.now() - maxAge);
    const expired: number[] = [];

    for (const [chatId, context] of this.conversations.entries()) {
      if (context.metadata.lastUpdateTime < cutoff) {
        expired.push(chatId);
      }
    }

    return expired;
  }

  async getStorageStats(): Promise<StorageStats> {
    let totalMessages = 0;
    for (const messages of this.messages.values()) {
      totalMessages += messages.length;
    }

    return {
      conversationCount: this.conversations.size,
      totalMessages,
      storageSize: JSON.stringify([...this.conversations.entries()]).length,
      oldestConversation: this.conversations.size > 0 ? new Date() : undefined,
      newestConversation: this.conversations.size > 0 ? new Date() : undefined
    };
  }

  async cleanup(): Promise<CleanupResult> {
    const beforeConversations = this.conversations.size;
    let deletedMessages = 0;

    // Mock cleanup - remove old conversations
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
    for (const [chatId, context] of this.conversations.entries()) {
      if (context.metadata.lastUpdateTime < cutoff) {
        const messages = this.messages.get(chatId) || [];
        deletedMessages += messages.length;
        this.conversations.delete(chatId);
        this.messages.delete(chatId);
      }
    }

    const afterConversations = this.conversations.size;

    return {
      conversationsDeleted: beforeConversations - afterConversations,
      messagesDeleted: deletedMessages,
      spaceFree: 1024, // mock value
      duration: 100 // mock value
    };
  }
}

describe("ContextManager", () => {
  let contextManager: ContextManager;
  let mockStorage: MockStorage;
  let config: ContextManagerConfig;

  beforeEach(() => {
    mockStorage = new MockStorage();
    config = {
      storage: {
        type: 'memory'
      },
      limits: {
        maxConversationAge: 3600000, // 1 hour
        maxMessagesPerChat: 100,
        maxStorageSize: 1024000 // 1MB
      },
      cleanup: {
        enabled: true,
        interval: 60000, // 1 minute
        batchSize: 10
      }
    };
    contextManager = new ContextManager(config, mockStorage);
  });

  test("should create context manager with valid config", () => {
    expect(contextManager).toBeDefined();
  });

  test("should get status", () => {
    const status = contextManager.getStatus();
    expect(status).toBeDefined();
    expect(status.name).toBe("ContextManager");
    expect(['healthy', 'degraded', 'unhealthy']).toContain(status.status);
    expect(status.lastHealthCheck).toBeInstanceOf(Date);
  });

  test("should initialize successfully", async () => {
    await expect(contextManager.initialize()).resolves.toBeUndefined();
  });

  test("should add message to conversation", async () => {
    await contextManager.initialize();

    const message: InternalMessage = {
      id: "test-msg-1",
      chatId: 12345,
      userId: 67890,
      content: "Hello, world!",
      timestamp: new Date(),
      metadata: {
        source: 'telegram' as const,
        originalMessageId: 1
      }
    };

    await contextManager.addMessage(message);

    // Check that message was added
    const messages = await mockStorage.getMessages(12345);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("Hello, world!");
  });

  test("should get conversation context", async () => {
    await contextManager.initialize();

    // First add a message to create a conversation
    const message: InternalMessage = {
      id: "test-msg-1",
      chatId: 12345,
      userId: 67890,
      content: "Hello",
      timestamp: new Date(),
      metadata: {
        source: 'telegram' as const,
        originalMessageId: 1
      }
    };

    await contextManager.addMessage(message);

    const context = await contextManager.getContext(12345);
    expect(context).toBeDefined();
    expect(context.chatId).toBe(12345);
    expect(context.userId).toBe(67890);
  });

  test("should update user preferences", async () => {
    await contextManager.initialize();

    const preferences: UserPreferences = {
      userId: 67890,
      language: "en",
      timezone: "UTC",
      settings: {
        notifications: true,
        theme: "light"
      }
    };

    await contextManager.updateUserPreferences(67890, preferences);

    const savedPrefs = await mockStorage.getUserPreferences(67890);
    expect(savedPrefs).toBeDefined();
    expect(savedPrefs!.language).toBe("en");
    expect(savedPrefs!.timezone).toBe("UTC");
  });

  test("should clear conversation", async () => {
    await contextManager.initialize();

    // Add a message first
    const message: InternalMessage = {
      id: "test-msg-1",
      chatId: 12345,
      userId: 67890,
      content: "Hello",
      timestamp: new Date(),
      metadata: {
        source: 'telegram' as const,
        originalMessageId: 1
      }
    };

    await contextManager.addMessage(message);

    // Verify message exists
    let messages = await mockStorage.getMessages(12345);
    expect(messages).toHaveLength(1);

    // Clear conversation
    await contextManager.clearContext(12345);

    // Verify conversation is cleared
    const context = await mockStorage.getConversation(12345);
    expect(context).toBeNull();
  });

  test("should get context statistics", async () => {
    await contextManager.initialize();

    const stats = await contextManager.getContextStats(12345);
    expect(stats).toBeDefined();
    expect(typeof stats.messageCount).toBe("number");
  });
});