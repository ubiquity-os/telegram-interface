# Universal Retry Mechanism Implementation

## Overview
Implemented a universal retry mechanism that validates EVERY LLM response to ensure proper formatting. This ensures all messages from end users are properly handled by our middleware, and the LLM can either call tools OR send messages to users in the expected format.

## Key Changes

### 1. Response Validation Service (`src/services/response-validation.ts`)
- `isValidResponse()`: Validates that every LLM response has either:
  - Valid text content (not just XML tags or whitespace)
  - Valid tool calls with proper XML formatting
- `generateInvalidResponseError()`: Generates error message when LLM response is invalid

### 2. Updated AI Response Service (`src/services/get-ai-response.ts`)
- Applies retry logic to **EVERY message**, not just tool-related queries
- Validates all LLM responses for proper format
- If response is invalid (empty, only whitespace, only non-content XML):
  - Adds error message explaining proper format
  - Retries up to 3 times with full conversation context
- Maintains conversation history throughout retries

### 3. Mock Conversation History (`src/services/conversation-history-mock.ts`)
- Created for local testing when Deno KV is not available
- Implements same interface as production conversation history
- Uses in-memory Map for storage

## How It Works

1. User sends ANY message
2. System sends to LLM with system prompt
3. LLM response is parsed and validated
4. If response is invalid:
   - Error message added: `[ERROR] Your previous response was not properly formatted...`
   - Includes examples of valid text responses and tool usage
   - Retries with full context
5. Process repeats up to 3 times or until valid response

## Valid Response Criteria

A response is considered valid if it contains:
- **Text content**: Actual message text (not just XML tags)
- **Tool calls**: Properly formatted XML tool usage

Invalid responses include:
- Empty responses
- Only whitespace
- Only non-content XML tags (like HTML comments)
- No actual content for the user

## Error Message Format
```
[ERROR] Your previous response was not properly formatted. You must either:

1. Provide a text response to the user, OR
2. Use a tool with proper XML formatting

For text responses, simply write your message.

For tool usage, use XML format like:
<tool_name>
<parameter1>value1</parameter1>
<parameter2>value2</parameter2>
</tool_name>

Available tools:
- ask_followup_question: Ask clarifying questions
- attempt_completion: Present final results
- use_mcp_tool: Access MCP servers (e.g., weather/get_weather)

Please retry with a properly formatted response.
```

## Testing
- Created comprehensive validation tests
- Tests verify that all response types are properly validated
- Confirms retry mechanism works for all messages
- All tests passing

## Benefits
- Ensures EVERY message goes through proper validation
- Forces consistent response format from LLMs
- Prevents empty or malformed responses
- Maintains conversation context for better retry responses
- Works universally, not just for specific query types
