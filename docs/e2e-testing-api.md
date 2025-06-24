# End-to-End Testing API

This document describes the testing API that allows you to test the Telegram bot messaging capabilities without requiring actual Telegram integration.

## Overview

The testing API provides a `/test/message` endpoint that simulates the complete Telegram message flow:
- Receives a message via HTTP POST
- Processes it through the same handlers as real Telegram messages
- Returns the bot's response along with detailed metadata

## Endpoint

### POST /test/message

Test the bot's messaging capabilities by sending a simulated message.

**Request Body:**
```json
{
  "message": "Hello, what's the weather in Tokyo?",
  "chatId": 12345,
  "userId": 67890,
  "username": "testuser",
  "firstName": "Test User"
}
```

**Required Fields:**
- `message` (string): The message text to send to the bot
- `chatId` (number): Chat ID for conversation context

**Optional Fields:**
- `userId` (number): User ID (defaults to random)
- `username` (string): Username (defaults to "testuser")
- `firstName` (string): First name (defaults to "Test User")

**Response:**
```json
{
  "success": true,
  "response": "The weather in Tokyo is currently 22°C with clear skies...",
  "metadata": {
    "processingTime": 1234,
    "chatId": 12345,
    "userId": 67890,
    "hasInlineKeyboard": false,
    "timestamp": "2024-01-01T12:00:00.000Z"
  },
  "inlineKeyboard": {
    "options": ["Option A", "Option B"]
  }
}
```

**Error Response:**
```json
{
  "success": false,
  "error": "Missing or invalid 'message' field",
  "metadata": {
    "processingTime": 50,
    "chatId": 12345,
    "userId": 67890,
    "hasInlineKeyboard": false,
    "timestamp": "2024-01-01T12:00:00.000Z"
  }
}
```

## Features Tested

The testing API exercises the complete bot functionality:

### ✅ AI Integration
- OpenRouter API calls
- Response generation
- Error handling

### ✅ Tool Calling
- MCP tool execution
- Weather API integration
- Tool result processing

### ✅ Conversation History
- Message storage in Deno KV
- Context building
- Multi-turn conversations

### ✅ Inline Keyboards
- Button generation
- Option capture
- UI interaction simulation

### ✅ Error Handling
- Invalid requests
- API failures
- Graceful degradation

## Usage Examples

### Basic Test with curl

```bash
# Simple greeting
curl -X POST http://localhost:8000/test/message \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello!", "chatId": 999}'

# Weather query (tests tool calling)
curl -X POST http://localhost:8000/test/message \
  -H "Content-Type: application/json" \
  -d '{"message": "What is the weather in San Francisco?", "chatId": 999}'

# Follow-up question (tests conversation context)
curl -X POST http://localhost:8000/test/message \
  -H "Content-Type: application/json" \
  -d '{"message": "What about tomorrow?", "chatId": 999}'
```

### Automated Testing

Run the comprehensive test suite:

```bash
# Run all tests
deno run --allow-net tests/test-e2e-api.ts

# Or use the task
deno task test:e2e
```

### CI/CD Integration

The testing API is perfect for automated testing in CI/CD pipelines:

```yaml
# Example GitHub Actions step
- name: Test Bot API
  run: |
    # Start the server
    deno run --allow-net --allow-env src/main.ts &
    sleep 5

    # Run tests
    deno run --allow-net tests/test-e2e-api.ts

    # Kill server
    pkill -f "deno run"
```

## Test Cases

The included test suite covers:

1. **Basic Greeting** - Simple AI conversation
2. **Weather Query** - Tool calling functionality
3. **Follow-up Question** - Conversation context
4. **Complex Question** - AI reasoning
5. **Tool Selection** - Inline keyboard generation
6. **Invalid Requests** - Error handling
7. **Health Check** - System status
8. **Conversation History** - Data persistence

## Benefits

### 🚀 Fast Development
- No Telegram setup required
- Instant feedback
- Easy debugging

### 🔧 Comprehensive Testing
- Tests entire message flow
- Validates AI integration
- Checks tool execution

### 📊 Detailed Metrics
- Processing times
- Token usage
- Error rates

### 🤖 CI/CD Ready
- Automated testing
- No external dependencies
- Reliable results

## Comparison with Real Telegram

| Feature | Real Telegram | Testing API |
|---------|---------------|-------------|
| Message Processing | ✅ | ✅ |
| AI Integration | ✅ | ✅ |
| Tool Calling | ✅ | ✅ |
| Conversation History | ✅ | ✅ |
| Inline Keyboards | ✅ | ✅ (simulated) |
| Network Latency | Variable | Minimal |
| Rate Limits | Yes | No |
| Setup Complexity | High | None |

## Limitations

- **No Real User Interaction**: Simulates but doesn't test actual Telegram UI
- **No Network Conditions**: Doesn't test network failures or timeouts
- **No Rate Limiting**: Doesn't simulate Telegram's rate limits
- **No Media Support**: Only supports text messages

## Related Endpoints

- `GET /health` - System health check
- `GET /conversations` - View conversation history
- `GET /conversations?chatId=123` - View specific conversation

## Security Notes

The testing API:
- ✅ Uses the same validation as production
- ✅ Processes messages through identical handlers
- ✅ Stores data in the same KV storage
- ⚠️ Should not be exposed in production environments
- ⚠️ Consider adding authentication for staging environments

## Troubleshooting

### Common Issues

1. **"Missing BOT_TOKEN"**
   - Ensure `.env` file has `BOT_TOKEN` set
   - Check environment variables

2. **"OpenRouter API Error"**
   - Verify `OPENROUTER_API_KEY` is set
   - Check API quota and billing

3. **"Tool execution failed"**
   - Verify MCP servers are configured
   - Check `mcp-settings.json`

4. **"Conversation history empty"**
   - Deno KV might not be initialized
   - Check file permissions

### Debug Mode

Enable detailed logging:
```bash
LOG_LEVEL=debug deno run --allow-net --allow-env src/main.ts
```

This will show:
- Detailed request processing
- AI API calls and responses
- Tool execution steps
- Conversation history operations
