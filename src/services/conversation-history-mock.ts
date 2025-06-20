import { OpenRouterMessage } from "./openrouter-types.ts";

interface ConversationEntry {
  timestamp: number;
  message: OpenRouterMessage;
}

class MockConversationHistoryService {
  private conversations: Map<number, ConversationEntry[]> = new Map();
  private maxConversationAge: number;
  private maxEntriesPerConversation: number;

  constructor(
    maxConversationAge = 24 * 60 * 60 * 1000, // 24 hours
    maxEntriesPerConversation = 1000
  ) {
    this.maxConversationAge = maxConversationAge;
    this.maxEntriesPerConversation = maxEntriesPerConversation;
  }

  async addMessage(chatId: number, message: OpenRouterMessage): Promise<void> {
    const conversation = this.conversations.get(chatId) || [];
    conversation.push({
      timestamp: Date.now(),
      message,
    });
    
    const cleaned = this.cleanupConversationSync(conversation);
    this.conversations.set(chatId, cleaned);
  }

  async getHistory(chatId: number): Promise<OpenRouterMessage[]> {
    const conversation = this.conversations.get(chatId) || [];
    const cleaned = this.cleanupConversationSync(conversation);
    
    if (cleaned.length !== conversation.length) {
      this.conversations.set(chatId, cleaned);
    }
    
    return cleaned.map(entry => entry.message);
  }

  async buildContext(
    chatId: number,
    currentMessage: OpenRouterMessage,
    systemPrompt: OpenRouterMessage,
    maxTokens: number,
    tokenCounter: (text: string) => number
  ): Promise<OpenRouterMessage[]> {
    const history = await this.getHistory(chatId);
    const messages: OpenRouterMessage[] = [];
    
    let totalTokens = tokenCounter(systemPrompt.content) + tokenCounter(currentMessage.content);
    
    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i];
      const msgTokens = tokenCounter(msg.content);
      
      if (totalTokens + msgTokens > maxTokens) {
        break;
      }
      
      messages.unshift(msg);
      totalTokens += msgTokens;
    }
    
    return [systemPrompt, ...messages, currentMessage];
  }

  private cleanupConversationSync(conversation: ConversationEntry[]): ConversationEntry[] {
    const now = Date.now();
    const cutoffTime = now - this.maxConversationAge;

    let filtered = conversation.filter(entry => entry.timestamp > cutoffTime);

    if (filtered.length > this.maxEntriesPerConversation) {
      filtered = filtered.slice(-this.maxEntriesPerConversation);
    }

    return filtered;
  }

  async clearHistory(chatId: number): Promise<void> {
    this.conversations.delete(chatId);
  }

  async clearAll(): Promise<void> {
    this.conversations.clear();
  }

  async getStats(): Promise<{ totalChats: number; totalMessages: number }> {
    let totalMessages = 0;
    for (const conversation of this.conversations.values()) {
      totalMessages += conversation.length;
    }
    
    return {
      totalChats: this.conversations.size,
      totalMessages,
    };
  }

  async close(): Promise<void> {
    // No-op for mock
  }
}

// Export mock instance for local testing
export const conversationHistory = new MockConversationHistoryService();
