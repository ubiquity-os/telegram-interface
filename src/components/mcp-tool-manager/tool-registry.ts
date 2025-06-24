/**
 * Tool Registry
 *
 * Manages tool definitions and their metadata
 */

import {
  ToolDefinition,
  ToolRegistryEntry,
  MCPRequest,
  MCPResponse
} from './types.ts';

/**
 * Tool registry for managing available tools
 */
export class ToolRegistry {
  private tools = new Map<string, ToolRegistryEntry>();

  /**
   * Register a tool from an MCP server
   */
  registerTool(definition: ToolDefinition): void {
    const toolId = `${definition.serverId}/${definition.name}`;

    const existing = this.tools.get(toolId);
    this.tools.set(toolId, {
      definition,
      lastUsed: existing?.lastUsed,
      usageCount: existing?.usageCount || 0,
      averageExecutionTime: existing?.averageExecutionTime
    });
  }

  /**
   * Get tool definition by ID
   */
  getToolDefinition(toolId: string): ToolDefinition | null {
    const entry = this.tools.get(toolId);
    return entry ? entry.definition : null;
  }

  /**
   * Get all available tools
   */
  getAllTools(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(entry => entry.definition);
  }

  /**
   * Get tools for a specific server
   */
  getToolsForServer(serverId: string): ToolDefinition[] {
    return Array.from(this.tools.values())
      .filter(entry => entry.definition.serverId === serverId)
      .map(entry => entry.definition);
  }

  /**
   * Update tool usage statistics
   */
  updateToolUsage(toolId: string, executionTime: number): void {
    const entry = this.tools.get(toolId);
    if (entry) {
      entry.lastUsed = new Date();
      entry.usageCount++;

      // Update average execution time
      if (entry.averageExecutionTime) {
        entry.averageExecutionTime = (entry.averageExecutionTime + executionTime) / 2;
      } else {
        entry.averageExecutionTime = executionTime;
      }
    }
  }

  /**
   * Remove all tools for a server
   */
  removeServerTools(serverId: string): void {
    for (const [toolId, entry] of this.tools) {
      if (entry.definition.serverId === serverId) {
        this.tools.delete(toolId);
      }
    }
  }

  /**
   * Clear all tools
   */
  clear(): void {
    this.tools.clear();
  }

  /**
   * Generate system prompt format for tools
   * This implements the DIRECT XML format to fix the tool format mismatch
   */
  generateSystemPromptTools(): string {
    const tools = this.getAllTools();
    if (tools.length === 0) {
      return "## External Tools\n\nNo external tools are currently available.";
    }

    let prompt = "## External Tools\n\n";
    prompt += "You have access to the following external tools. Use them directly with XML format:\n\n";

    for (const tool of tools) {
      const toolName = `${tool.serverId}_${tool.name}`;
      prompt += `### ${toolName}\n`;
      if (tool.description) {
        prompt += `Description: ${tool.description}\n`;
      }

      prompt += `Usage:\n`;
      prompt += `<${toolName}>\n`;

      // Generate parameters from schema
      if (tool.inputSchema?.properties) {
        for (const [paramName, paramDef] of Object.entries(tool.inputSchema.properties)) {
          const isRequired = tool.inputSchema.required?.includes(paramName);
          const paramSchema = paramDef as any;
          prompt += `<${paramName}>${this.getExampleValue(paramSchema)}${isRequired ? '' : ' (optional)'}</${paramName}>\n`;
        }
      }

      prompt += `</${toolName}>\n\n`;
    }

    return prompt;
  }

  /**
   * Parse direct XML tool call to internal format
   */
  parseDirectToolCall(toolName: string, params: Record<string, string>): {
    serverId: string;
    toolName: string;
    arguments: Record<string, any>;
  } | null {
    // Extract server and tool name from combined name
    const parts = toolName.split('_');
    if (parts.length < 2) return null;

    const serverId = parts[0];
    const actualToolName = parts.slice(1).join('_');

    // Find the tool definition
    const toolId = `${serverId}/${actualToolName}`;
    const definition = this.getToolDefinition(toolId);
    if (!definition) return null;

    // Convert string parameters to proper types based on schema
    const arguments_: Record<string, any> = {};
    if (definition.inputSchema?.properties) {
      for (const [paramName, value] of Object.entries(params)) {
        const paramSchema = definition.inputSchema.properties[paramName] as any;
        arguments_[paramName] = this.convertParameter(value, paramSchema);
      }
    } else {
      // No schema, use as-is
      Object.assign(arguments_, params);
    }

    return {
      serverId,
      toolName: actualToolName,
      arguments: arguments_
    };
  }

  /**
   * Convert parameter value based on schema type
   */
  private convertParameter(value: string, schema: any): any {
    if (!schema?.type) return value;

    switch (schema.type) {
      case 'number':
        const num = Number(value);
        return isNaN(num) ? value : num;
      case 'integer':
        const int = parseInt(value, 10);
        return isNaN(int) ? value : int;
      case 'boolean':
        return value.toLowerCase() === 'true';
      case 'array':
        try {
          return JSON.parse(value);
        } catch {
          return [value];
        }
      case 'object':
        try {
          return JSON.parse(value);
        } catch {
          return { value };
        }
      default:
        return value;
    }
  }

  /**
   * Get example value for parameter based on schema
   */
  private getExampleValue(schema: any): string {
    if (!schema?.type) return 'value';

    switch (schema.type) {
      case 'string':
        if (schema.enum) return schema.enum[0];
        return schema.description ? `"${schema.description.toLowerCase().replace(/\s+/g, '_')}"` : '"example"';
      case 'number':
      case 'integer':
        return '42';
      case 'boolean':
        return 'true';
      case 'array':
        return '["item1", "item2"]';
      case 'object':
        return '{"key": "value"}';
      default:
        return 'value';
    }
  }

  /**
   * Get registry statistics
   */
  getStatistics() {
    const totalTools = this.tools.size;
    const servers = new Set(Array.from(this.tools.values()).map(entry => entry.definition.serverId));
    const totalUsage = Array.from(this.tools.values()).reduce((sum, entry) => sum + entry.usageCount, 0);
    const avgExecutionTime = Array.from(this.tools.values())
      .filter(entry => entry.averageExecutionTime)
      .reduce((sum, entry, _, arr) => sum + (entry.averageExecutionTime! / arr.length), 0);

    return {
      totalTools,
      totalServers: servers.size,
      totalUsage,
      averageExecutionTime: avgExecutionTime || 0
    };
  }
}