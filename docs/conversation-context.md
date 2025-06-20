# Conversation Context Implementation

## Overview

The Telegram bot now maintains conversation history for each chat, providing context to the AI when generating responses. This enables more coherent and contextually relevant conversations.

## Architecture

### Components

1. **Conversation History Service** (`src/services/conversation-history.ts`)
   - In-memory storage of conversation history per chat ID
   - Automatic cleanup of old messages (24-hour default)
   - Token-aware context building

2. **Token Counter** (`src/utils/token-counter.ts`)
   - Approximates token count (1 token ≈ 4 characters)
   - Used to ensure context stays within 64k token limit

3. **Updated Message Flow**
   - Message handler passes chat ID to AI service
   - AI service builds context from conversation history
   - Response and user message are stored for future context

### Memory Management

- Conversations older than 24 hours are automatically cleaned up
- Maximum 1000 messages per conversation
- Context building works backwards from newest messages
- 64k token limit for context (leaving room for response)

## Implementation Details

### Conversation Storage

```typescript
interface ConversationEntry {
  timestamp: number;
  message: OpenRouterMessage;
}
```

Messages are stored with timestamps to enable:
- Automatic cleanup of old conversations
- Chronological context building
- Memory-efficient storage

### Context Building

The system builds context by:
1. Starting with system prompt
2. Adding messages from newest to oldest
3. Stopping when token limit is reached
4. Including current user message

### Token Counting

Simple approximation formula:
- English text: ~4 characters per token
- Includes role metadata overhead (~4 tokens per message)

## Deployment Considerations

### Memory Usage

- In-memory storage means conversations are lost on restart
- Memory usage scales with active conversations
- Automatic cleanup prevents unbounded growth

### Scaling

For production scaling, consider:
- Persistent storage (Redis, Database)
- Distributed caching for multiple instances
- More sophisticated token counting

### Environment Variables

No new environment variables required. The feature works with existing configuration.

## Testing

To test conversation context:
1. Send multiple messages to the bot
2. Observe how responses consider previous messages
3. Check logs for context building information

## Future Enhancements

1. **Persistent Storage**: Store conversations in database
2. **User Preferences**: Allow users to clear their history
3. **Advanced Token Counting**: Use actual tokenizer for accuracy
4. **Context Summarization**: Summarize old messages to fit more context