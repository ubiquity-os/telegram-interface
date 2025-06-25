/**
 * Conversation History Service
 * Manages conversation persistence using Deno KV
 */

export interface ConversationEntry {
  timestamp: number;
  message: {
    role: 'user' | 'assistant' | 'system';
    content: string;
  };
}

export interface ConversationStats {
  totalChats: number;
  totalMessages: number;
}

class ConversationHistoryService {
  private kv: Deno.Kv | null = null;
  private readonly MAX_MESSAGES_PER_CHAT = 100;
  private readonly MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

  async getKv(): Promise<Deno.Kv> {
    if (!this.kv) {
      this.kv = await Deno.openKv();
    }
    return this.kv;
  }

  async addMessage(chatId: number, message: ConversationEntry['message']): Promise<void> {
    const kv = await this.getKv();
    const key = ["chat", chatId, "messages"];

    const result = await kv.get(key);
    const messages = (result.value as ConversationEntry[]) || [];

    // Add new message
    messages.push({
      timestamp: Date.now(),
      message
    });

    // Keep only recent messages
    const recentMessages = messages
      .filter(entry => Date.now() - entry.timestamp < this.MAX_AGE_MS)
      .slice(-this.MAX_MESSAGES_PER_CHAT);

    await kv.set(key, recentMessages);
  }

  async getHistory(chatId: number): Promise<ConversationEntry['message'][]> {
    const kv = await this.getKv();
    const key = ["chat", chatId, "messages"];

    const result = await kv.get(key);
    const messages = (result.value as ConversationEntry[]) || [];

    // Filter out old messages and return just the message content
    return messages
      .filter(entry => Date.now() - entry.timestamp < this.MAX_AGE_MS)
      .map(entry => entry.message);
  }

  async clearHistory(chatId: number): Promise<void> {
    const kv = await this.getKv();
    const key = ["chat", chatId, "messages"];
    await kv.delete(key);
  }

  async getStats(): Promise<ConversationStats> {
    const kv = await this.getKv();
    let totalChats = 0;
    let totalMessages = 0;

    const iter = kv.list({ prefix: ["chat"] });
    for await (const entry of iter) {
      if (entry.key[2] === "messages" && entry.value) {
        totalChats++;
        const messages = entry.value as ConversationEntry[];
        totalMessages += messages.length;
      }
    }

    return { totalChats, totalMessages };
  }

  async cleanup(): Promise<number> {
    const kv = await this.getKv();
    let cleaned = 0;
    const cutoff = Date.now() - this.MAX_AGE_MS;

    const iter = kv.list({ prefix: ["chat"] });
    for await (const entry of iter) {
      if (entry.key[2] === "messages" && entry.value) {
        const messages = entry.value as ConversationEntry[];
        const recentMessages = messages.filter(msg => msg.timestamp > cutoff);

        if (recentMessages.length !== messages.length) {
          if (recentMessages.length === 0) {
            await kv.delete(entry.key);
          } else {
            await kv.set(entry.key, recentMessages);
          }
          cleaned++;
        }
      }
    }

    return cleaned;
  }

  async close(): Promise<void> {
    if (this.kv) {
      this.kv.close();
      this.kv = null;
    }
  }
}

export const conversationHistory = new ConversationHistoryService();