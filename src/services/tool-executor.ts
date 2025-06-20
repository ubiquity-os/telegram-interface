import { ToolCall } from "./tool-parser.ts";
import { mcpHub } from "./mcp-hub.ts";
import { formatToolResult } from "./tool-parser.ts";

export interface ToolExecutionResult {
  success: boolean;
  result?: any;
  error?: string;
  requiresUserResponse?: boolean;
}

/**
 * Executes a parsed tool call and returns the result
 */
export async function executeTool(tool: ToolCall): Promise<ToolExecutionResult> {
  try {
    switch (tool.name) {
      case "use_mcp_tool":
        return await executeUseMcpTool(tool.params);
      
      case "ask_followup_question":
        return executeAskFollowupQuestion(tool.params);
      
      case "attempt_completion":
        return executeAttemptCompletion(tool.params);
      
      case "access_mcp_resource":
        return executeAccessMcpResource(tool.params);
      
      default:
        return {
          success: false,
          error: `Unknown tool: ${tool.name}`,
        };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Execute MCP tool call
 */
async function executeUseMcpTool(params: Record<string, string>): Promise<ToolExecutionResult> {
  const serverName = params.server_name;
  const toolName = params.tool_name;
  const argumentsStr = params.arguments;

  if (!serverName || !toolName) {
    return {
      success: false,
      error: "Missing required parameters: server_name and tool_name",
    };
  }

  let args: any;
  try {
    args = argumentsStr ? JSON.parse(argumentsStr) : {};
  } catch (error) {
    return {
      success: false,
      error: "Invalid JSON in arguments parameter",
    };
  }

  try {
    const result = await mcpHub.executeTool(serverName, toolName, args);
    return {
      success: true,
      result,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Execute ask_followup_question tool
 */
function executeAskFollowupQuestion(params: Record<string, string>): ToolExecutionResult {
  const question = params.question;
  
  if (!question) {
    return {
      success: false,
      error: "Missing required parameter: question",
    };
  }

  let options: string[] | undefined;
  if (params.options) {
    try {
      options = JSON.parse(params.options);
      if (!Array.isArray(options)) {
        throw new Error("Options must be an array");
      }
    } catch (error) {
      return {
        success: false,
        error: "Invalid JSON in options parameter",
      };
    }
  }

  return {
    success: true,
    result: {
      type: "followup_question",
      question,
      options,
    },
    requiresUserResponse: true,
  };
}

/**
 * Execute attempt_completion tool
 */
function executeAttemptCompletion(params: Record<string, string>): ToolExecutionResult {
  const result = params.result;
  
  if (!result) {
    return {
      success: false,
      error: "Missing required parameter: result",
    };
  }

  return {
    success: true,
    result: {
      type: "completion",
      message: result,
    },
  };
}

/**
 * Execute access_mcp_resource tool
 */
function executeAccessMcpResource(params: Record<string, string>): ToolExecutionResult {
  const serverName = params.server_name;
  const uri = params.uri;

  if (!serverName || !uri) {
    return {
      success: false,
      error: "Missing required parameters: server_name and uri",
    };
  }

  // This is a placeholder - real implementation would access MCP resources
  return {
    success: false,
    error: "MCP resource access not yet implemented",
  };
}

/**
 * Formats a tool execution result for the LLM
 */
export function formatExecutionResult(toolName: string, result: ToolExecutionResult): string {
  if (!result.success) {
    return formatToolResult(toolName, null, result.error);
  }
  
  // Include requiresUserResponse flag if present
  if (result.requiresUserResponse) {
    return formatToolResult(toolName, result.result, undefined, result.requiresUserResponse);
  }
  
  return formatToolResult(toolName, result.result);
}
