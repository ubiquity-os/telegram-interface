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
  private clientInstances = new Map<string, MCPStdioClient>();

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
    if (this.isInitialized) {
      throw new Error('MCPToolManager is already initialized');
    }

    console.log('[MCPToolManager] Initializing...');

    try {
      this.isInitialized = true;
      this.lastHealthCheck = new Date();

      console.log('[MCPToolManager] Initialized successfully');
    } catch (error) {
      throw new Error(`Failed to initialize MCPToolManager: ${error.message}`);
    }
  }

  /**
   * Shutdown the component (IComponent interface)
   */
  async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    console.log('[MCPToolManager] Shutting down...');

    try {
      // Shutdown all client instances
      for (const client of this.clientInstances.values()) {
        await client.disconnect();
      }
      this.clientInstances.clear();

      // Shutdown connection pool
      await this.connectionPool.closeAll();

      this.isInitialized = false;

      console.log('[MCPToolManager] Shutdown complete');
    } catch (error) {
      console.error('[MCPToolManager] Error during shutdown:', error);
    }
  }

  /**
   * Get component status (IComponent interface)
   */
  getStatus(): ComponentStatus {
    return {
      name: this.name,
      status: this.isInitialized ? 'healthy' : 'unhealthy',
      lastHealthCheck: this.lastHealthCheck,
      metadata: {
        serverCount: this.configs.length,
        toolCount: this.toolRegistry.getAllTools().length,
        poolStats: Object.fromEntries(this.connectionPool.getAllStats()),
        circuitBreakerStates: Object.fromEntries(
          Array.from(this.clientInstances.entries()).map(([serverId, client]) => [
            serverId,
            client.getCircuitBreakerStatus()
          ])
        )
      }
    };
  }

  /**
   * Initialize with server configurations (IMCPToolManager interface)
   */
  async initializeWithConfigs(configs: MCPServerConfig[]): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('MCPToolManager not initialized');
    }

    console.log(`[MCPToolManager] Initializing with ${configs.length} servers...`);

    this.configs = [...configs];

    for (const config of configs) {
      try {
        // Create client instance for this server
        const client = new MCPStdioClient(config);
        this.clientInstances.set(config.name, client);

        // Initialize server in connection pool
        await this.connectionPool.initializeServer(config);

        // Connect and get available tools
        await client.connect();
        const tools = await client.listTools();

        // Register tools in our registry
        for (const tool of tools) {
          this.toolRegistry.registerTool({
            serverId: config.name,
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema || {}
          });
        }

        console.log(`[MCPToolManager] Initialized server '${config.name}' with ${tools.length} tools`);

      } catch (error) {
        console.error(`[MCPToolManager] Failed to initialize server '${config.name}':`, error);

        // Handle error but don't fail the entire initialization
        if (this.errorHandler) {
          await this.errorHandler.handleError(error as Error, {
            component: this.name,
            operation: 'initializeWithConfigs',
            serverId: config.name
          } as ErrorContext);
        }
      }
    }

    console.log('[MCPToolManager] Server initialization complete');
  }

  /**
   * Register server configurations (backward compatibility)
   */
  async registerServers(configs: MCPServerConfig[]): Promise<void> {
    return this.initializeWithConfigs(configs);
  }

  /**
   * Get available tools
   */
  async getAvailableTools(): Promise<ToolDefinition[]> {
    if (!this.isInitialized) {
      throw new Error('MCPToolManager not initialized');
    }

    return this.toolRegistry.getAllTools();
  }

  /**
   * Get tool definition by ID
   */
  async getToolDefinition(toolId: string): Promise<ToolDefinition | null> {
    if (!this.isInitialized) {
      throw new Error('MCPToolManager not initialized');
    }

    return this.toolRegistry.getToolDefinition(toolId);
  }

  /**
   * Refresh tool registry
   */
  async refreshToolRegistry(): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('MCPToolManager not initialized');
    }

    console.log('[MCPToolManager] Refreshing tool registry...');

    for (const [serverId, client] of this.clientInstances) {
      try {
        if (client.isConnected()) {
          const tools = await client.listTools();

          // Remove existing tools for this server
          this.toolRegistry.removeServerTools(serverId);

          // Re-register tools
          for (const tool of tools) {
            this.toolRegistry.registerTool({
              serverId,
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema || {}
            });
          }
        }
      } catch (error) {
        console.error(`[MCPToolManager] Failed to refresh tools for server '${serverId}':`, error);
      }
    }

    console.log('[MCPToolManager] Tool registry refresh complete');
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

    // Check circuit breaker before executing
    const circuitBreakerStatus = this.getCircuitBreakerStatus(call.serverId);
    if (circuitBreakerStatus.state === CircuitBreakerState.OPEN) {
      throw new Error(`Circuit breaker is open for server ${call.serverId}`);
    }

    const startTime = Date.now();

    try {
      // Get client instance for this server
      const client = this.clientInstances.get(call.serverId);
      if (!client) {
        throw new Error(`No client instance found for server: ${call.serverId}`);
      }

      // Execute the tool through the client
      const result = await client.callTool(tool.name, call.arguments);

      const executionTime = Date.now() - startTime;
      console.log(`[MCPToolManager] Tool execution completed in ${executionTime}ms`);

      // Update tool usage statistics
      this.toolRegistry.updateToolUsage(call.toolId, executionTime);

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
    }
  }

  /**
   * Execute multiple tools in parallel
   */
  async executeMultipleTools(calls: ToolCall[]): Promise<ToolResult[]> {
    if (!this.isInitialized) {
      throw new Error('MCP Tool Manager not initialized');
    }

    console.log(`[MCPToolManager] Executing ${calls.length} tools in parallel`);

    const promises = calls.map(call => this.executeTool(call));
    return Promise.all(promises);
  }

  /**
   * Get server status
   */
  async getServerStatus(serverId: string): Promise<ServerStatus> {
    if (!this.isInitialized) {
      throw new Error('MCPToolManager not initialized');
    }

    const client = this.clientInstances.get(serverId);
    if (!client) {
      throw new Error(`Server '${serverId}' not found`);
    }

    return client.getStatus();
  }

  /**
   * Get all server statuses
   */
  async getAllServerStatuses(): Promise<ServerStatus[]> {
    if (!this.isInitialized) {
      throw new Error('MCPToolManager not initialized');
    }

    const statuses: ServerStatus[] = [];

    for (const [serverId, client] of this.clientInstances) {
      try {
        statuses.push(await client.getStatus());
      } catch (error) {
        console.error(`[MCPToolManager] Failed to get status for server '${serverId}':`, error);
        // Set a default failed status
        statuses.push({
          serverId,
          status: 'error',
          lastConnected: undefined,
          lastError: error instanceof Error ? error.message : 'Unknown error',
          toolCount: 0
        });
      }
    }

    return statuses;
  }

  /**
   * Get circuit breaker status for a server - REAL IMPLEMENTATION
   */
  getCircuitBreakerStatus(serverId: string): CircuitBreakerStatus {
    const client = this.clientInstances.get(serverId);
    if (!client) {
      throw new Error(`Server '${serverId}' not found`);
    }

    // Get real circuit breaker status from the client
    return client.getCircuitBreakerStatus();
  }

  /**
   * Generate system prompt tools
   */
  generateSystemPromptTools(): string {
    if (!this.isInitialized) {
      return 'MCP Tool Manager not initialized.';
    }

    return this.toolRegistry.generateSystemPromptTools();
  }

  /**
   * Health check for all servers
   */
  async performHealthCheck(): Promise<Map<string, boolean>> {
    if (!this.isInitialized) {
      throw new Error('MCPToolManager not initialized');
    }

    const healthResults = new Map<string, boolean>();

    for (const [serverId, client] of this.clientInstances) {
      try {
        const status = await client.getStatus();
        healthResults.set(serverId, status.status === 'connected');
      } catch (error) {
        console.error(`[MCPToolManager] Health check failed for server '${serverId}':`, error);
        healthResults.set(serverId, false);
      }
    }

    this.lastHealthCheck = new Date();
    return healthResults;
  }
}