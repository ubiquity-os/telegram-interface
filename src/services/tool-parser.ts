export interface ToolCall {
  type: "tool_use";
  name: string;
  params: Record<string, string>;
  partial?: boolean;
}

export interface AssistantMessageContent {
  type: "text" | "tool_use";
  content?: string;
  tool?: ToolCall;
}

/**
 * Parses assistant messages to extract text content and tool calls
 * Based on Cline's XML-style tool calling format
 */
export function parseAssistantMessage(message: string): AssistantMessageContent[] {
  const contentBlocks: AssistantMessageContent[] = [];
  let currentTextStart = 0;
  let currentToolUse: ToolCall | undefined = undefined;
  let currentToolStart = 0;
  let currentParamName: string | undefined = undefined;
  let currentParamValueStart = 0;

  // Track accumulator for detecting tags
  let accumulator = "";

  for (let i = 0; i < message.length; i++) {
    const char = message[i];
    accumulator += char;

    // State: Parsing a parameter value
    if (currentToolUse && currentParamName) {
      const closeTag = `</${currentParamName}>`;
      if (accumulator.endsWith(closeTag)) {
        const value = message
          .slice(currentParamValueStart, i - closeTag.length + 1)
          .trim();
        currentToolUse.params[currentParamName] = value;
        currentParamName = undefined;
        continue;
      }
    }

    // State: Inside a tool use (looking for parameters or closing tag)
    if (currentToolUse && !currentParamName) {
      const toolCloseTag = `</${currentToolUse.name}>`;
      if (accumulator.endsWith(toolCloseTag)) {
        // Tool use complete
        currentToolUse.partial = false;
        contentBlocks.push({
          type: "tool_use",
          tool: currentToolUse,
        });
        currentToolUse = undefined;
        currentTextStart = i + 1;
        continue;
      }

      // Check for parameter start tags
      const paramMatch = accumulator.match(/<(\w+)>$/);
      if (paramMatch) {
        currentParamName = paramMatch[1];
        currentParamValueStart = i + 1;
        continue;
      }
    }

    // State: Looking for tool start or accumulating text
    if (!currentToolUse) {
      // Check for tool start tags
      const toolMatch = accumulator.match(/<(\w+)>$/);
      if (toolMatch && isValidToolName(toolMatch[1])) {
        // Save any accumulated text
        if (i - toolMatch[0].length > currentTextStart) {
          const textContent = message.slice(currentTextStart, i - toolMatch[0].length + 1);
          if (textContent.trim()) {
            contentBlocks.push({
              type: "text",
              content: textContent,
            });
          }
        }

        // Start new tool use
        currentToolUse = {
          type: "tool_use",
          name: toolMatch[1],
          params: {},
          partial: true,
        };
        currentToolStart = i + 1;
      }
    }
  }

  // Handle any remaining content
  if (currentToolUse) {
    // Partial tool use
    if (currentParamName) {
      currentToolUse.params[currentParamName] = message.slice(currentParamValueStart).trim();
    }
    contentBlocks.push({
      type: "tool_use",
      tool: currentToolUse,
    });
  } else if (currentTextStart < message.length) {
    // Remaining text
    const textContent = message.slice(currentTextStart);
    if (textContent.trim()) {
      contentBlocks.push({
        type: "text",
        content: textContent,
      });
    }
  }

  return contentBlocks;
}

/**
 * Validates if a string is a known tool name
 * This will be populated dynamically from MCP servers
 */
function isValidToolName(name: string): boolean {
  // Core tool names that are always valid
  const coreTools = [
    "use_mcp_tool",
    "access_mcp_resource",
    "ask_followup_question",
    "attempt_completion",
  ];
  
  if (coreTools.includes(name)) {
    return true;
  }
  
  // For now, we'll accept any tool name that matches MCP naming conventions
  // This will be enhanced when we integrate with the MCP hub
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

/**
 * Formats a tool result back into a message format the LLM can understand
 */
export function formatToolResult(toolName: string, result: any, error?: string): string {
  if (error) {
    return `<tool_result>
<tool_name>${toolName}</tool_name>
<status>error</status>
<error>${error}</error>
</tool_result>`;
  }

  return `<tool_result>
<tool_name>${toolName}</tool_name>
<status>success</status>
<output>${typeof result === 'string' ? result : JSON.stringify(result, null, 2)}</output>
</tool_result>`;
}
