/**
 * MCP Tool Manager Implementation
 *
 * Main component for managing external MCP tools and servers
 */

import { IComponent, ComponentStatus } from '../../interfaces/component-interfaces.ts';
import { IErrorHandler, ErrorContext } from '../../interfaces/component-interfaces.ts';
import {
  IMCPToolManager,
  MCPServerConfig,
  ToolDefinition,
  ToolCall,
  ToolResult,
  ServerStatus,
  MCPRequest,
  MCPToolRequest,
  CircuitBreakerStatus
} from './types.ts';
import { MCPStdioClient } from './mcp-client.ts';
import { ToolRegistry } from './tool-registry.ts';

/**
 * MCP Tool Manager implementation
 */
export class MCPToolManager implements IMCPToolManager, IComponent {
  public readonly name = 'MCPToolManager';

  private clients = new Map<string, MCPStdioClient>();
  private toolRegistry = new ToolRegistry();
  private isInitialized = false;
  private configs: MCPServerConfig[] = [];

  constructor(private errorHandler?: IErrorHandler) {
    console.log(`[MCPToolManager] Constructor called`);
  }

  /**
   * Initialize the component (IComponent interface)
   */
  async initialize(): Promise<void> {
    console.log(`[MCPToolManager] Initialize called`);
    this.isInitialized = true;
  }

  /**
   * Initialize the MCP Tool Manager with server configurations
   */
  async initializeWithConfigs(configs: MCPServerConfig[]): Promise<void> {
    console.log(`[MCPToolManager] Initializing with ${configs.length} configs`);

    this.configs = configs;

    // Clear existing clients
    await this.shutdown();

    // Create clients for enabled servers
    for (const config of configs) {
      if (config.enabled) {
        console.log(`[MCPToolManager] Creating client for ${config.name}`);
        const client = new MCPStdioClient(config);
        this.clients.set(config.name, client);
      }
    }

    // Connect to all servers
    await this.connectAllServers();

    // Refresh tool registry
    await this.refreshToolRegistry();

    this.isInitialized = true;
    console.log(`[MCPToolManager] Initialization completed`);
  }

  /**
   * Shutdown all MCP connections
   */
  async shutdown(): Promise<void> {
    console.log(`[MCPToolManager] Shutting down`);

    const disconnectPromises = Array.from(this.clients.entries()).map(async ([serverId, client]) => {
      try {
        console.log(`[MCPToolManager] Disconnecting from ${serverId}`);
        await client.disconnect();
      } catch (error) {
        console.error(`[MCPToolManager] Error disconnecting from ${serverId}:`, error);
      }
    });

    await Promise.all(disconnectPromises);

    this.clients.clear();
    this.toolRegistry.clear();
    this.isInitialized = false;

    console.log(`[MCPToolManager] Shutdown completed`);
  }

  /**
   * Get component status (IComponent interface)
   */
  getStatus(): ComponentStatus {
    const connectedServers = Array.from(this.clients.values())
      .filter(client => client.isConnected())
      .length;

    return {
      name: this.name,
      status: connectedServers > 0 || this.clients.size === 0 ? 'healthy' : 'unhealthy',
      lastHealthCheck: new Date(),
      metadata: {
        totalServers: this.clients.size,
        connectedServers,
        totalTools: this.toolRegistry.getAllTools().length
      }
    };
  }

  /**
   * Refresh tool registry by discovering tools from all servers
   */
  async refreshToolRegistry(): Promise<void> {
    console.log(`[MCPToolManager] Refreshing tool registry`);

    this.toolRegistry.clear();

    const discoveryPromises = Array.from(this.clients.entries()).map(async ([serverId, client]) => {
      if (!client.isConnected()) {
        console.log(`[MCPToolManager] Skipping disconnected server ${serverId}`);
        return;
      }

      try {
        const tools = await this.discoverServerTools(serverId);
        for (const tool of tools) {
          this.toolRegistry.registerTool(tool);
        }
        console.log(`[MCPToolManager] Registered ${tools.length} tools from ${serverId}`);
      } catch (error) {
        this.handleError('refresh_tool_registry', error, { serverId });
      }
    });

    await Promise.all(discoveryPromises);
  }

  /**
   * Get all available tools
   */
  async getAvailableTools(): Promise<ToolDefinition[]> {
    return this.toolRegistry.getAllTools();
  }

  /**
   * Get specific tool definition
   */
  async getToolDefinition(toolId: string): Promise<ToolDefinition | null> {
    return this.toolRegistry.getToolDefinition(toolId);
  }

  /**
   * Execute a tool
   */
  async executeTool(call: ToolCall): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      const client = this.clients.get(call.serverId);
      if (!client) {
        throw new Error(`Server '${call.serverId}' not found`);
      }

      if (!client.isConnected()) {
        throw new Error(`Server '${call.serverId}' is not connected`);
      }

      // Check if the tool exists in the registry
      const toolKey = `${call.serverId}/${call.toolId}`;
      const tool = this.toolRegistry.getToolDefinition(toolKey);
      if (!tool) {
        throw new Error(`Tool '${call.toolId}' not found on server '${call.serverId}'`);
      }

      const result = await this.executeToolInternal(client, call);

      // Update tool usage statistics
      this.toolRegistry.updateToolUsage(toolKey, result.executionTime || 0);

      return result;

    } catch (error) {
      this.handleError('execute_tool', error, { toolId: call.toolId, serverId: call.serverId });
      return {
        toolId: call.toolId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTime: Date.now() - startTime
      };
    }
  }

  /**
   * Execute multiple tools in parallel
   */
  async executeMultipleTools(calls: ToolCall[]): Promise<ToolResult[]> {
    return Promise.all(calls.map(call => this.executeTool(call)));
  }

  /**
   * Get server status
   */
  async getServerStatus(serverId: string): Promise<ServerStatus> {
    const client = this.clients.get(serverId);
    if (!client) {
      return {
        serverId,
        status: 'disconnected',
        toolCount: 0
      };
    }

    const status = client.getStatus();
    const tools = this.toolRegistry.getToolsForServer(serverId);
    return {
      ...status,
      toolCount: tools.length
    };
  }

  /**
   * Get all server statuses
   */
  async getAllServerStatuses(): Promise<ServerStatus[]> {
    const statuses: ServerStatus[] = [];
    for (const serverId of this.clients.keys()) {
      statuses.push(await this.getServerStatus(serverId));
    }
    return statuses;
  }

  /**
   * Get circuit breaker status for a server
   */
  getCircuitBreakerStatus(serverId: string): CircuitBreakerStatus {
    const client = this.clients.get(serverId);
    if (!client) {
      throw new Error(`Server '${serverId}' not found`);
    }
    return client.getCircuitBreakerStatus();
  }

  /**
   * Generate system prompt with available tools
   */
  generateSystemPromptTools(): string {
    return this.toolRegistry.generateSystemPromptTools();
  }

  /**
   * Connect to all configured servers
   */
  private async connectAllServers(): Promise<void> {
    console.log(`[MCPToolManager] Connecting to all servers`);

    const connectionPromises = Array.from(this.clients.entries()).map(async ([serverId, client]) => {
      try {
        console.log(`[MCPToolManager] Connecting to ${serverId}`);
        await client.connect();
        console.log(`[MCPToolManager] Successfully connected to ${serverId}`);
      } catch (error) {
        this.handleError('connect_server', error, { serverId });
      }
    });

    await Promise.all(connectionPromises);
  }

  /**
   * Discover tools from a specific server
   */
  private async discoverServerTools(serverId: string): Promise<ToolDefinition[]> {
    console.log(`[MCPToolManager] Discovering tools from ${serverId}`);

    const client = this.clients.get(serverId);
    if (!client || !client.isConnected()) {
      return [];
    }

    try {
      const tools = await client.listTools();

      return tools.map((tool: any) => ({
        serverId,
        name: tool.name,
        description: tool.description || '',
        inputSchema: tool.inputSchema || {},
        outputSchema: tool.outputSchema
      }));

    } catch (error) {
      console.error(`[MCPToolManager] Failed to discover tools from ${serverId}:`, error);
      throw error;
    }
  }

  /**
   * Execute tool using MCP protocol
   */
  private async executeToolInternal(client: MCPStdioClient, call: ToolCall): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      console.log(`[MCPToolManager] Executing tool ${call.toolId} on ${call.serverId}`);

      const result = await client.callTool(call.toolId, call.arguments);

      console.log(`[MCPToolManager] Tool execution completed in ${Date.now() - startTime}ms`);

      return {
        toolId: call.toolId,
        success: true,
        output: result,
        executionTime: Date.now() - startTime
      };

    } catch (error) {
      console.error(`[MCPToolManager] Tool execution failed:`, error);
      throw error;
    }
  }

  /**
   * Handle errors with optional error handler
   */
  private handleError(operation: string, error: unknown, contextData?: Record<string, any>): void {
    console.error(`[MCPToolManager] Error in ${operation}:`, error, contextData);

    if (this.errorHandler) {
      this.errorHandler.handleError(
        error instanceof Error ? error : new Error(String(error)),
        {
          component: this.name,
          operation,
          ...contextData
        }
      );
    }
  }
}