# Conversation Context Implementation

## Overview

The Telegram bot maintains conversation history for each chat using Deno KV, providing persistent context to the AI when generating responses. This enables more coherent and contextually relevant conversations that persist across serverless invocations.

## Architecture

### Components

1. **Conversation History Service** (`src/services/conversation-history.ts`)
   - Uses Deno KV for persistent storage
   - Automatic cleanup of old messages (24-hour default)
   - Token-aware context building
   - Serverless-friendly with data persistence

2. **Token Counter** (`src/utils/token-counter.ts`)
   - Approximates token count (1 token ≈ 4 characters)
   - Used to ensure context stays within 64k token limit

3. **Updated Message Flow**
   - Message handler passes chat ID to AI service
   - AI service builds context from conversation history
   - Response and user message are stored for future context
   - All data persists across serverless invocations

### Deno KV Storage

- **Key Structure**: `["chat", chatId, "messages"]`
- **Value**: Array of `ConversationEntry` objects with timestamps
- **Persistence**: Data survives across serverless invocations
- **No Configuration**: Deno KV works out-of-the-box on Deno Deploy

### Memory Management

- Conversations older than 24 hours are automatically cleaned up
- Maximum 1000 messages per conversation
- Context building works backwards from newest messages
- 64k token limit for context (leaving room for response)
- Cleanup happens during read operations to ensure data freshness

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

### Deno KV Operations

The service uses async operations for all KV interactions:
- `await Deno.openKv()` - Opens KV connection (cached)
- `await kv.get()` - Retrieves conversation data
- `await kv.set()` - Stores updated conversations
- `await kv.delete()` - Removes conversations
- `await kv.list()` - Iterates over stored conversations

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

### Deno Deploy Advantages

- **Zero Configuration**: Deno KV is available by default
- **Global Distribution**: Data is replicated across regions
- **Automatic Persistence**: No need for external databases
- **Serverless Compatible**: Works seamlessly with stateless functions

### Scaling

The Deno KV implementation provides:
- Persistent storage across invocations
- No memory limitations from serverless environment
- Automatic data replication
- Built-in consistency guarantees

### Environment Variables

No new environment variables required. Deno KV works automatically on Deno Deploy.

## Testing

To test conversation context:
1. Send multiple messages to the bot
2. Observe how responses consider previous messages
3. Check logs for context building information
4. Verify conversations persist after redeployment

## Migration from In-Memory

The previous in-memory implementation has been replaced with Deno KV:
- **Before**: Used `Map` storage (lost on each invocation)
- **After**: Uses Deno KV (persists across invocations)
- **API**: All methods now return Promises due to async KV operations

## Key Benefits

1. **Persistence**: Conversations survive serverless cold starts
2. **No Configuration**: Works out-of-the-box on Deno Deploy
3. **Scalability**: No memory constraints from serverless environment
4. **Reliability**: Built-in replication and consistency

## Future Enhancements

1. **User Preferences**: Allow users to clear their history
2. **Advanced Token Counting**: Use actual tokenizer for accuracy
3. **Context Summarization**: Summarize old messages to fit more context
4. **Analytics**: Track conversation metrics using KV data