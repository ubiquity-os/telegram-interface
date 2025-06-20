import { OpenRouterMessage } from "./openrouter-types.ts";

interface ConversationEntry {
  timestamp: number;
  message: OpenRouterMessage;
}

class ConversationHistoryService {
  private conversations: Map<number, ConversationEntry[]>;
  private maxConversationAge: number; // in milliseconds
  private maxEntriesPerConversation: number;

  constructor(
    maxConversationAge = 24 * 60 * 60 * 1000, // 24 hours
    maxEntriesPerConversation = 1000
  ) {
    this.conversations = new Map();
    this.maxConversationAge = maxConversationAge;
    this.maxEntriesPerConversation = maxEntriesPerConversation;
  }

  // Add a message to conversation history
  addMessage(chatId: number, message: OpenRouterMessage): void {
    const now = Date.now();
    
    if (!this.conversations.has(chatId)) {
      this.conversations.set(chatId, []);
    }

    const conversation = this.conversations.get(chatId)!;
    conversation.push({
      timestamp: now,
      message,
    });

    // Clean up old messages and limit size
    this.cleanupConversation(chatId);
  }

  // Get conversation history for a chat
  getHistory(chatId: number): OpenRouterMessage[] {
    const conversation = this.conversations.get(chatId);
    if (!conversation) {
      return [];
    }

    // Clean up old messages before returning
    this.cleanupConversation(chatId);

    return conversation.map(entry => entry.message);
  }

  // Build context with token limit (newest messages first)
  buildContext(
    chatId: number,
    currentMessage: OpenRouterMessage,
    systemPrompt: OpenRouterMessage,
    maxTokens: number,
    tokenCounter: (text: string) => number
  ): OpenRouterMessage[] {
    const history = this.getHistory(chatId);
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

  // Clean up old messages from a conversation
  private cleanupConversation(chatId: number): void {
    const conversation = this.conversations.get(chatId);
    if (!conversation) return;

    const now = Date.now();
    const cutoffTime = now - this.maxConversationAge;

    // Remove messages older than maxConversationAge
    const filtered = conversation.filter(entry => entry.timestamp > cutoffTime);

    // If we still have too many messages, keep only the most recent ones
    if (filtered.length > this.maxEntriesPerConversation) {
      const kept = filtered.slice(-this.maxEntriesPerConversation);
      this.conversations.set(chatId, kept);
    } else {
      this.conversations.set(chatId, filtered);
    }

    // Remove empty conversations
    if (filtered.length === 0) {
      this.conversations.delete(chatId);
    }
  }

  // Clear conversation history for a specific chat
  clearHistory(chatId: number): void {
    this.conversations.delete(chatId);
  }

  // Clear all conversation histories
  clearAll(): void {
    this.conversations.clear();
  }

  // Get statistics about stored conversations
  getStats(): { totalChats: number; totalMessages: number } {
    let totalMessages = 0;
    for (const conversation of this.conversations.values()) {
      totalMessages += conversation.length;
    }
    
    return {
      totalChats: this.conversations.size,
      totalMessages,
    };
  }
}

// Export singleton instance
export const conversationHistory = new ConversationHistoryService();