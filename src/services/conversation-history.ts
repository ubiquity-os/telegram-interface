import { OpenRouterMessage } from "./openrouter-types.ts";

interface ConversationEntry {
  timestamp: number;
  message: OpenRouterMessage;
}

class ConversationHistoryService {
  private maxConversationAge: number; // in milliseconds
  private maxEntriesPerConversation: number;
  private kv: Deno.Kv | null = null;

  constructor(
    maxConversationAge = 24 * 60 * 60 * 1000, // 24 hours
    maxEntriesPerConversation = 1000
  ) {
    this.maxConversationAge = maxConversationAge;
    this.maxEntriesPerConversation = maxEntriesPerConversation;
  }

  // Initialize KV connection
  private async getKv(): Promise<Deno.Kv> {
    if (!this.kv) {
      this.kv = await Deno.openKv();
    }
    return this.kv;
  }

  // Generate KV key for a chat's messages
  private getChatKey(chatId: number): string[] {
    return ["chat", chatId.toString(), "messages"];
  }

  // Add a message to conversation history
  async addMessage(chatId: number, message: OpenRouterMessage): Promise<void> {
    const kv = await this.getKv();
    const key = this.getChatKey(chatId);
    const now = Date.now();

    // Get existing conversation
    const result = await kv.get<ConversationEntry[]>(key);
    const conversation = result.value || [];

    // Add new message
    conversation.push({
      timestamp: now,
      message,
    });

    // Clean up old messages and limit size
    const cleaned = this.cleanupConversationSync(conversation);

    // Store updated conversation
    await kv.set(key, cleaned);
  }

  // Get conversation history for a chat
  async getHistory(chatId: number): Promise<OpenRouterMessage[]> {
    const kv = await this.getKv();
    const key = this.getChatKey(chatId);

    const result = await kv.get<ConversationEntry[]>(key);
    if (!result.value) {
      return [];
    }

    // Clean up old messages before returning
    const cleaned = this.cleanupConversationSync(result.value);
    
    // Update KV if we cleaned any messages
    if (cleaned.length !== result.value.length) {
      await kv.set(key, cleaned);
    }

    return cleaned.map(entry => entry.message);
  }

  // Build context with token limit (newest messages first)
  async buildContext(
    chatId: number,
    currentMessage: OpenRouterMessage,
    systemPrompt: OpenRouterMessage,
    maxTokens: number,
    tokenCounter: (text: string) => number
  ): Promise<OpenRouterMessage[]> {
    const history = await this.getHistory(chatId);
    const messages: OpenRouterMessage[] = [];
    
    // Calculate tokens for system prompt and current message
    let totalTokens = tokenCounter(systemPrompt.content) + tokenCounter(currentMessage.content);
    
    // Add messages from newest to oldest until we hit the token limit
    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i];
      const msgTokens = tokenCounter(msg.content);
      
      if (totalTokens + msgTokens > maxTokens) {
        break;
      }
      
      messages.unshift(msg); // Add to beginning to maintain order
      totalTokens += msgTokens;
    }
    
    // Build final message array: system prompt, history, current message
    return [systemPrompt, ...messages, currentMessage];
  }

  // Clean up old messages from a conversation (synchronous helper)
  private cleanupConversationSync(conversation: ConversationEntry[]): ConversationEntry[] {
    const now = Date.now();
    const cutoffTime = now - this.maxConversationAge;

    // Remove messages older than maxConversationAge
    let filtered = conversation.filter(entry => entry.timestamp > cutoffTime);

    // If we still have too many messages, keep only the most recent ones
    if (filtered.length > this.maxEntriesPerConversation) {
      filtered = filtered.slice(-this.maxEntriesPerConversation);
    }

    return filtered;
  }

  // Clear conversation history for a specific chat
  async clearHistory(chatId: number): Promise<void> {
    const kv = await this.getKv();
    const key = this.getChatKey(chatId);
    await kv.delete(key);
  }

  // Clear all conversation histories (use with caution)
  async clearAll(): Promise<void> {
    const kv = await this.getKv();
    
    // List all chat keys and delete them
    const iter = kv.list({ prefix: ["chat"] });
    for await (const entry of iter) {
      await kv.delete(entry.key);
    }
  }

  // Get statistics about stored conversations
  async getStats(): Promise<{ totalChats: number; totalMessages: number }> {
    const kv = await this.getKv();
    let totalChats = 0;
    let totalMessages = 0;

    const iter = kv.list<ConversationEntry[]>({ prefix: ["chat"] });
    for await (const entry of iter) {
      if (entry.value && entry.key[2] === "messages") {
        totalChats++;
        totalMessages += entry.value.length;
      }
    }
    
    return {
      totalChats,
      totalMessages,
    };
  }

  // Close KV connection (for cleanup)
  async close(): Promise<void> {
    if (this.kv) {
      this.kv.close();
      this.kv = null;
    }
  }
}

// Export singleton instance
export const conversationHistory = new ConversationHistoryService();