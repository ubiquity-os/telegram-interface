# MCP Tool Calling Architecture for Telegram Bot

## Overview

This document describes the Model Context Protocol (MCP) tool calling implementation for the Telegram bot. The system allows the LLM to extend its capabilities by calling external tools provided by MCP servers.

## Architecture Components

### 1. Tool Parser (`src/services/tool-parser.ts`)

The tool parser extracts XML-style tool calls from the LLM's responses. It follows Cline's format:

```xml
<tool_name>
<parameter1>value1</parameter1>
<parameter2>value2</parameter2>
</tool_name>
```

Key features:
- Parses both complete and partial tool calls
- Separates text content from tool calls
- Validates tool names against known tools
- Formats tool results for the LLM

### 2. MCP Hub (`src/services/mcp-hub.ts`)

The MCP Hub manages connections to MCP servers and provides tool discovery:

- Loads server configurations from `mcp-settings.json`
- Manages server lifecycle (connect/disconnect)
- Provides tool discovery and execution
- Generates tool definitions for the system prompt

**Note**: Current implementation is a simplified mock. In production, you would:
- Use the actual MCP SDK
- Spawn server processes and communicate via stdio
- Handle real-time tool discovery and execution

### 3. System Prompt Generator (`src/services/system-prompt.ts`)

Generates dynamic system prompts that include:
- Base instructions for the AI assistant
- Core tool definitions (ask_followup_question, attempt_completion)
- MCP tool definitions from connected servers
- Tool use guidelines

### 4. Tool Executor (`src/services/tool-executor.ts`)

Executes parsed tool calls:
- Routes tool calls to appropriate handlers
- Handles MCP tool execution via the MCP Hub
- Manages tool-specific logic (e.g., follow-up questions)
- Formats execution results

### 5. Enhanced AI Response Handler (`src/services/get-ai-response.ts`)

The main orchestrator that:
- Initializes MCP connections
- Manages the tool calling loop
- Handles multi-turn tool interactions
- Stores conversation history with tool calls

## Communication Protocol

### 1. Tool Call Format

Tools are called using XML-style tags:

```xml
<use_mcp_tool>
<server_name>weather</server_name>
<tool_name>get_weather</tool_name>
<arguments>
{
  "city": "San Francisco"
}
</arguments>
</use_mcp_tool>
```

### 2. Tool Result Format

Tool results are returned in a structured format:

```xml
<tool_result>
<tool_name>get_weather</tool_name>
<status>success</status>
<output>Weather in San Francisco: Sunny, 22°C</output>
</tool_result>
```

Error results include error information:

```xml
<tool_result>
<tool_name>get_weather</tool_name>
<status>error</status>
<error>City not found</error>
</tool_result>
```

### 3. Conversation Flow

1. User sends message to bot
2. Bot generates system prompt with available tools
3. LLM responds, potentially with tool calls
4. Bot parses and executes tool calls
5. Tool results are fed back to LLM
6. Process repeats until no more tool calls
7. Final response sent to user

## Configuration

### MCP Settings (`mcp-settings.json`)

```json
{
  "mcpServers": {
    "weather": {
      "command": "node",
      "args": ["./mcp-servers/weather/index.js"],
      "env": {
        "OPENWEATHER_API_KEY": "your-api-key"
      },
      "disabled": false
    }
  }
}
```

## Core Tools

### 1. ask_followup_question

Allows the LLM to ask clarifying questions:

```xml
<ask_followup_question>
<question>Which city would you like the weather for?</question>
<options>["San Francisco", "New York", "London"]</options>
</ask_followup_question>
```

### 2. attempt_completion

Marks task completion:

```xml
<attempt_completion>
<result>
I've retrieved the weather information for you. San Francisco is currently sunny with a temperature of 22°C.
</result>
</attempt_completion>
```

### 3. use_mcp_tool

Executes tools from MCP servers:

```xml
<use_mcp_tool>
<server_name>weather</server_name>
<tool_name>get_forecast</tool_name>
<arguments>
{
  "city": "San Francisco",
  "days": 5
}
</arguments>
</use_mcp_tool>
```

## Implementation Notes

### Current Limitations

1. **Mock MCP Implementation**: The current implementation mocks MCP server connections. In production, you would need to:
   - Implement proper stdio communication
   - Handle server process management
   - Implement the full MCP protocol

2. **Limited Tool Set**: Only basic tools are implemented. Additional tools can be added by:
   - Creating new MCP servers
   - Adding tool handlers in the executor
   - Updating the system prompt

3. **Error Handling**: Basic error handling is implemented. Production systems should:
   - Implement retry logic
   - Handle server disconnections
   - Provide better error messages

### Security Considerations

1. **Tool Validation**: Always validate tool inputs
2. **Sandboxing**: MCP servers should run in isolated environments
3. **Rate Limiting**: Implement rate limits for tool calls
4. **Authentication**: Secure API keys and credentials

## Future Enhancements

1. **Real MCP SDK Integration**: Replace mock implementation with actual MCP SDK
2. **Tool Discovery**: Dynamic tool discovery from MCP servers
3. **Resource Support**: Implement MCP resource access
4. **Streaming**: Support streaming responses from tools
5. **Caching**: Cache tool results where appropriate
6. **Monitoring**: Add telemetry and monitoring for tool usage

## Example Usage

### Weather Query

User: "What's the weather in San Francisco?"

LLM Response:
```
I'll check the weather in San Francisco for you.

<use_mcp_tool>
<server_name>weather</server_name>
<tool_name>get_weather</tool_name>
<arguments>
{
  "city": "San Francisco"
}
</arguments>
</use_mcp_tool>
```

Tool Result:
```xml
<tool_result>
<tool_name>get_weather</tool_name>
<status>success</status>
<output>Weather in San Francisco: Sunny, 22°C</output>
</tool_result>
```

Final Response: "The weather in San Francisco is currently sunny with a temperature of 22°C."

## Testing

To test the tool calling system:

1. Ensure `mcp-settings.json` is configured
2. Start the bot with `deno task dev`
3. Send messages that would trigger tool use
4. Monitor logs for tool execution

## Conclusion

This architecture provides a flexible foundation for extending the Telegram bot's capabilities through MCP tools. The XML-based protocol ensures compatibility with existing LLM tool-calling patterns while the modular design allows for easy extension and maintenance.
