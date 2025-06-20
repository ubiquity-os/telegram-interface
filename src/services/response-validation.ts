/**
 * Validates if the LLM response is properly formatted
 * Returns true if the response contains valid content (either text or tool calls)
 */
export function isValidResponse(contentBlocks: Array<{ type: string; content?: string; tool?: any }>): boolean {
  // A valid response must have at least one content block
  if (contentBlocks.length === 0) {
    return false;
  }
  
  // Check if there's at least one valid text block or tool use
  const hasValidContent = contentBlocks.some(block => {
    if (block.type === "tool_use" && block.tool) {
      return true;
    }
    
    if (block.type === "text" && block.content) {
      // Check if the content is just XML tags without actual text
      const strippedContent = block.content
        .replace(/<[^>]+>/g, '') // Remove all XML tags
        .trim();
      
      return strippedContent.length > 0;
    }
    
    return false;
  });
  
  return hasValidContent;
}

/**
 * Generates an error message when the LLM doesn't produce a valid response
 */
export function generateInvalidResponseError(): string {
  return `[ERROR] Your previous response was not properly formatted. You must either:

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

Please retry with a properly formatted response.`;
}
