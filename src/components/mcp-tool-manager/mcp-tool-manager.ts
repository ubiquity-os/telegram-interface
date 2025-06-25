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
  CircuitBreakerStatus,
  CircuitBreakerState
} from './types.ts';
import { MCPStdioClient } from './mcp-client.ts';
import { ToolRegistry } from './tool-registry.ts';
import { ConnectionPool, IConnectionPool, PooledConnection } from '../../services/mcp-connection-pool/index.ts';

/**
 * MCP Tool Manager implementation
 */
export class MCPToolManager implements IMCPToolManager, IComponent {
  public readonly name = 'MCPToolManager';

  private connectionPool: IConnectionPool;
  private toolRegistry = new ToolRegistry();
  private isInitialized = false;
  private configs: MCPServerConfig[] = [];
  private lastHealthCheck = new Date();

  constructor(private errorHandler?: IErrorHandler) {
    console.log(`[MCPToolManager] Constructor called`);
    this.connectionPool = new ConnectionPool({
      minConnections: 1,
      maxConnections: 3,
      idleTimeout: 300000, // 5 minutes
      connectionTimeout: 30000, // 30 seconds
      healthCheckInterval: 60000, // 1 minute
      maxRetries: 3
    });
  }

  /**
   * Initialize the component (IComponent interface)
   */
  async initialize(): Promise<void> {
    console.log('[MCPToolManager] Initialize called with no configs');
    this.lastHealthCheck = new Date();
  }

  /**
   * Initialize with configs (IMCPToolManager interface)
   */
  async initializeWithConfigs(configs: MCPServerConfig[]): Promise<void> {
    console.log(`[MCPToolManager] Initializing with ${configs.length} server configs`);

    if (this.isInitialized) {
      console.log('[MCPToolManager] Already initialized');
      return;
    }

    this.configs = configs;

    // Initialize connection pool for each server
    for (const config of configs) {
      if (!config.enabled) {
        console.log(`[MCPToolManager] Skipping disabled server: ${config.name}`);
        continue;
      }

      try {
        console.log(`[MCPToolManager] Initializing server: ${config.name}`);
        await this.connectionPool.initializeServer(config);

        // Get a connection to discover tools
        const connection = await this.connectionPool.acquire(config.name);
        try {
          // Initialize the client with config
          const client = new MCPStdioClient(config);
          await client.connect();

          // Get tools from the client
          const tools = await client.listTools();
          console.log(`[MCPToolManager] Discovered ${tools.length} tools from ${config.name}`);

          // Register tools
          for (const tool of tools) {
            const toolDef: ToolDefinition = {
              serverId: config.name,
              name: tool.name,
              description: tool.description || '',
              inputSchema: tool.inputSchema
            };
            this.toolRegistry.registerTool(toolDef);
          }

          // Disconnect the temporary client
          await client.disconnect();
        } finally {
          await this.connectionPool.release(connection.id);
        }
      } catch (error) {
        console.error(`[MCPToolManager] Failed to initialize server ${config.name}:`, error);
        if (this.errorHandler) {
          await this.errorHandler.handleError(error as Error, {
            component: this.name,
            operation: 'initializeWithConfigs',
            metadata: { server: config.name }
          });
        }
      }
    }

    this.isInitialized = true;
    this.lastHealthCheck = new Date();
    console.log('[MCPToolManager] Initialization complete');
  }

  /**
   * Get component status
   */
  getStatus(): ComponentStatus {
    const allStats = this.connectionPool.getAllStats();
    const serverCount = allStats.size;
    const connectedCount = Array.from(allStats.values())
      .filter(stats => stats.activeConnections > 0).length;

    const isHealthy = this.isInitialized && connectedCount > 0;

    return {
      name: this.name,
      status: isHealthy ? 'healthy' : this.isInitialized ? 'degraded' : 'unhealthy',
      lastHealthCheck: this.lastHealthCheck,
      metadata: {
        initialized: this.isInitialized,
        totalServers: serverCount,
        connectedServers: connectedCount,
        registeredTools: this.toolRegistry.getAllTools().length
      }
    };
  }

  /**
   * Execute a tool
   */
  async executeTool(call: ToolCall): Promise<ToolResult> {
    console.log(`[MCPToolManager] Executing tool: ${call.toolId} on server: ${call.serverId}`);

    if (!this.isInitialized) {
      throw new Error('MCP Tool Manager not initialized');
    }

    const tool = this.toolRegistry.getToolDefinition(call.toolId);
    if (!tool) {
      throw new Error(`Tool not found: ${call.toolId}`);
    }

    if (tool.serverId !== call.serverId) {
      throw new Error(`Tool ${call.toolId} does not belong to server ${call.serverId}`);
    }

    const startTime = Date.now();
    const connection = await this.connectionPool.acquire(call.serverId);

    try {
      // Create a temporary client for this connection
      const config = this.configs.find(c => c.name === call.serverId);
      if (!config) {
        throw new Error(`Server configuration not found: ${call.serverId}`);
      }

      const client = new MCPStdioClient(config);
      await client.connect();

      const result = await client.callTool(tool.name, call.arguments);

      await client.disconnect();

      const executionTime = Date.now() - startTime;
      console.log(`[MCPToolManager] Tool execution completed in ${executionTime}ms`);

      return {
        toolId: call.toolId,
        success: true,
        output: result,
        executionTime
      };
    } catch (error) {
      console.error(`[MCPToolManager] Tool execution failed:`, error);
      return {
        toolId: call.toolId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTime: Date.now() - startTime
      };
    } finally {
      await this.connectionPool.release(connection.id);
    }
  }

  /**
   * Execute multiple tools
   */
  async executeMultipleTools(calls: ToolCall[]): Promise<ToolResult[]> {
    return Promise.all(calls.map(call => this.executeTool(call)));
  }

  /**
   * Get available tools
   */
  async getAvailableTools(): Promise<ToolDefinition[]> {
    return this.toolRegistry.getAllTools();
  }

  /**
   * Get tool definition
   */
  async getToolDefinition(toolId: string): Promise<ToolDefinition | null> {
    return this.toolRegistry.getToolDefinition(toolId);
  }

  /**
   * Refresh tool registry
   */
  async refreshToolRegistry(): Promise<void> {
    console.log('[MCPToolManager] Refreshing tool registry');

    // Clear existing tools
    this.toolRegistry = new ToolRegistry();

    // Re-initialize with current configs
    await this.initializeWithConfigs(this.configs);
  }

  /**
   * Get server status
   */
  async getServerStatus(serverId: string): Promise<ServerStatus> {
    const stats = this.connectionPool.getStats(serverId);
    if (!stats) {
      throw new Error(`Server '${serverId}' not found`);
    }

    const toolCount = this.toolRegistry.getAllTools()
      .filter(tool => tool.serverId === serverId).length;

    return {
      serverId,
      status: stats.activeConnections > 0 ? 'connected' : 'disconnected',
      toolCount,
      responseTime: stats.averageWaitTime
    };
  }

  /**
   * Get all server statuses
   */
  async getAllServerStatuses(): Promise<ServerStatus[]> {
    const allStats = this.connectionPool.getAllStats();
    const results: ServerStatus[] = [];

    for (const [serverId, stats] of allStats) {
      const toolCount = this.toolRegistry.getAllTools()
        .filter(tool => tool.serverId === serverId).length;

      results.push({
        serverId,
        status: stats.activeConnections > 0 ? 'connected' : 'disconnected',
        toolCount,
        responseTime: stats.averageWaitTime
      });
    }

    return results;
  }

  /**
   * Get circuit breaker status for a server
   */
  getCircuitBreakerStatus(serverId: string): CircuitBreakerStatus {
    // For now, return a default status since we can't easily get the circuit breaker
    // status without holding a connection reference
    // This would need to be refactored to track circuit breaker state at the pool level
    const stats = this.connectionPool.getStats(serverId);
    if (!stats) {
      throw new Error(`Server '${serverId}' not found`);
    }

    // Return a synthesized status based on pool statistics
    const hasFailures = stats.failedRequests > 0;
    const failureRate = stats.totalRequests > 0
      ? stats.failedRequests / stats.totalRequests
      : 0;

    return {
      state: failureRate > 0.5 ? CircuitBreakerState.OPEN : CircuitBreakerState.CLOSED,
      failureCount: stats.failedRequests,
      lastFailureTime: hasFailures ? new Date() : undefined
    };
  }

  /**
   * Generate system prompt tools
   */
  generateSystemPromptTools(): string {
    const tools = this.toolRegistry.getAllTools();
    if (tools.length === 0) {
      return 'No external tools available.';
    }

    let prompt = 'Available external tools:\n\n';
    for (const tool of tools) {
      prompt += `- ${tool.name} (${tool.serverId}): ${tool.description}\n`;
      if (tool.inputSchema) {
        prompt += `  Input: ${JSON.stringify(tool.inputSchema, null, 2)}\n`;
      }
      prompt += '\n';
    }

    return prompt;
  }

  /**
   * Shutdown the component
   */
  async shutdown(): Promise<void> {
    console.log('[MCPToolManager] Shutting down');

    if (!this.isInitialized) {
      return;
    }

    await this.connectionPool.closeAll();
    this.toolRegistry = new ToolRegistry();
    this.isInitialized = false;

    console.log('[MCPToolManager] Shutdown complete');
  }
}