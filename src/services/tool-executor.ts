import { ToolCall } from "./tool-parser.ts";
import { MCPToolManager } from "../components/mcp-tool-manager/index.ts";
import { formatToolResult } from "./tool-parser.ts";

export interface ToolExecutionResult {
  success: boolean;
  result?: any;
  error?: string;
  requiresUserResponse?: boolean;
}

// Global MTM instance
let mtmInstance: MCPToolManager | null = null;

async function getMTMInstance(): Promise<MCPToolManager> {
  if (!mtmInstance) {
    mtmInstance = new MCPToolManager();
    await mtmInstance.initialize();
  }
  return mtmInstance;
}

/**
 * Executes a parsed tool call and returns the result
 */
export async function executeTool(tool: ToolCall): Promise<ToolExecutionResult> {
  try {
    // Check if it's a direct MCP tool (serverId_toolName format)
    if (tool.name.includes('_')) {
      const parts = tool.name.split('_', 2);
      if (parts.length === 2) {
        return await executeDirectMcpTool(parts[0], parts[1], tool.params);
      }
    }

    // Handle core tools
    switch (tool.name) {
      case "ask_followup_question":
        return executeAskFollowupQuestion(tool.params);

      case "attempt_completion":
        return executeAttemptCompletion(tool.params);

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
 * Execute direct MCP tool call using new MTM component
 */
async function executeDirectMcpTool(serverId: string, toolName: string, params: Record<string, string>): Promise<ToolExecutionResult> {
  if (!serverId || !toolName) {
    return {
      success: false,
      error: "Missing required parameters: serverId and toolName",
    };
  }

  try {
    const mtm = await getMTMInstance();

    // Create ToolCall object for MTM
    const toolCall = {
      toolId: `${serverId}_${toolName}_${Date.now()}`,
      serverId,
      toolName,
      arguments: params
    };

    const result = await mtm.executeTool(toolCall);
    return {
      success: result.success,
      result: result.success ? result.output : undefined,
      error: result.success ? undefined : result.error,
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
