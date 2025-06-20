// Approximate token counting
// Rule of thumb: 1 token ≈ 4 characters for English text
// This is a simple approximation; actual tokenization varies by model

export function countTokens(text: string): number {
  // Basic approximation: 1 token ≈ 4 characters
  // This is reasonable for English text but may vary for other languages
  return Math.ceil(text.length / 4);
}

// Count tokens for a message object
export function countMessageTokens(content: string, role: string): number {
  // Account for role metadata (approximately 4 tokens per message for formatting)
  const roleTokens = 4;
  const contentTokens = countTokens(content);
  return roleTokens + contentTokens;
}

// Count total tokens for an array of messages
export function countTotalTokens(messages: Array<{ role: string; content: string }>): number {
  return messages.reduce((total, msg) => {
    return total + countMessageTokens(msg.content, msg.role);
  }, 0);
}

// Check if adding a message would exceed token limit
export function wouldExceedLimit(
  currentTokens: number,
  newMessageContent: string,
  newMessageRole: string,
  maxTokens: number
): boolean {
  const newMessageTokens = countMessageTokens(newMessageContent, newMessageRole);
  return currentTokens + newMessageTokens > maxTokens;
}