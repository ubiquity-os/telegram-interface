/**
 * MCP Tool Manager Implementation
 *
 * Main component for managing external MCP tools and servers
 */

import { IComponent, ComponentStatus } from '../../interfaces/component-interfaces.ts';
import { IErrorHandler, ErrorContext } from '../../interfaces/component-interfaces.ts';
import { createErrorRecoveryService, RetryStrategy } from '../../services/error-recovery-service.ts';
import { TelemetryService, LogLevel } from '../../services/telemetry/index.ts';
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
  CircuitBreakerState,
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
  private telemetry?: TelemetryService;

  constructor(private errorHandler?: IErrorHandler) {
    console.log(`[MCPToolManager] Constructor called`);
    this.connectionPool = new ConnectionPool({
      minConnections: 1,
      maxConnections: 3,
      idleTimeout: 300000, // 5 minutes
      connectionTimeout: 30000, // 30 seconds
      healthCheckInterval: 60000, // 1 minute
      maxRetries: 3,
    });
  }

  /**
   * Set telemetry service for structured logging
   */
  setTelemetry(telemetry: TelemetryService): void {
    this.telemetry = telemetry;
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

      this.telemetry?.logStructured({
        level: LogLevel.INFO,
        component: 'MCPToolManager',
        phase: 'initialization',
        message: 'MCP Tool Manager initialized successfully',
        metadata: {
          connectionPoolConfig: {
            minConnections: 1,
            maxConnections: 3,
            idleTimeout: 300000,
            connectionTimeout: 30000,
          },
        },
      });

      console.log('[MCPToolManager] Initialized successfully');
    } catch (error) {
      this.telemetry?.logStructured({
        level: LogLevel.ERROR,
        component: 'MCPToolManager',
        phase: 'initialization_error',
        message: 'Failed to initialize MCP Tool Manager',
        metadata: { errorMessage: error.message },
        error: error as Error,
      });

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
      this.telemetry?.logStructured({
        level: LogLevel.INFO,
        component: 'MCPToolManager',
        phase: 'shutdown_start',
        message: 'Starting MCP Tool Manager shutdown',
        metadata: {
          activeClients: this.clientInstances.size,
          registeredTools: this.toolRegistry.getAllTools().length,
        },
      });

      // Shutdown all client instances
      for (const [serverId, client] of this.clientInstances) {
        try {
          await client.disconnect();
          this.telemetry?.logStructured({
            level: LogLevel.INFO,
            component: 'MCPToolManager',
            phase: 'client_disconnect',
            message: 'Client disconnected successfully',
            metadata: { serverId },
          });
        } catch (error) {
          this.telemetry?.logStructured({
            level: LogLevel.WARN,
            component: 'MCPToolManager',
            phase: 'client_disconnect_error',
            message: 'Error disconnecting client',
            metadata: { serverId, errorMessage: error.message },
            error: error as Error,
          });
        }
      }
      this.clientInstances.clear();

      // Shutdown connection pool
      await this.connectionPool.closeAll();

      this.isInitialized = false;

      this.telemetry?.logStructured({
        level: LogLevel.INFO,
        component: 'MCPToolManager',
        phase: 'shutdown_complete',
        message: 'MCP Tool Manager shutdown completed',
        metadata: {},
      });

      console.log('[MCPToolManager] Shutdown complete');
    } catch (error) {
      console.error('[MCPToolManager] Error during shutdown:', error);

      this.telemetry?.logStructured({
        level: LogLevel.ERROR,
        component: 'MCPToolManager',
        phase: 'shutdown_error',
        message: 'Error during MCP Tool Manager shutdown',
        metadata: { errorMessage: error.message },
        error: error as Error,
      });
    }
  }

  /**
   * Get component status (IComponent interface)
   */
  getStatus(): ComponentStatus {
    const status: ComponentStatus = {
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
            client.getCircuitBreakerStatus(),
          ]),
        ),
      },
    };

    this.telemetry?.logStructured({
      level: LogLevel.DEBUG,
      component: 'MCPToolManager',
      phase: 'status_check',
      message: 'Component status checked',
      metadata: {
        status: status.status,
        serverCount: status.metadata?.serverCount,
        toolCount: status.metadata?.toolCount,
      },
    });

    return status;
  }

  /**
   * Initialize with server configurations (IMCPToolManager interface)
   */
  async initializeWithConfigs(configs: MCPServerConfig[]): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('MCPToolManager not initialized');
    }

    // Use telemetry wrapper if available
    if (this.telemetry) {
      return await this.telemetry.withTrace(
        'MCPToolManager',
        'initializeWithConfigs',
        async () => await this.initializeWithConfigsWithTelemetry(configs),
      );
    }

    // Fallback without telemetry
    return await this.initializeWithConfigsWithoutTelemetry(configs);
  }

  /**
   * Initialize with server configurations with telemetry tracking
   */
  private async initializeWithConfigsWithTelemetry(configs: MCPServerConfig[]): Promise<void> {
    console.log(`[MCPToolManager] Initializing with ${configs.length} servers...`);

    this.telemetry?.logStructured({
      level: LogLevel.INFO,
      component: 'MCPToolManager',
      phase: 'server_initialization_start',
      message: 'Starting server initialization',
      metadata: {
        serverCount: configs.length,
        servers: configs.map(c => ({ name: c.name, type: c.command ? 'stdio' : 'sse' })),
      },
    });

    this.configs = [...configs];
    let successCount = 0;
    let errorCount = 0;

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
            inputSchema: tool.inputSchema || {},
          });
        }

        this.telemetry?.logStructured({
          level: LogLevel.INFO,
          component: 'MCPToolManager',
          phase: 'server_initialized',
          message: 'Server initialized successfully',
          metadata: {
            serverId: config.name,
            toolCount: tools.length,
            tools: tools.map(t => ({ name: t.name, description: t.description?.substring(0, 100) })),
          },
        });

        console.log(`[MCPToolManager] Initialized server '${config.name}' with ${tools.length} tools`);
        successCount++;

      } catch (error) {
        console.error(`[MCPToolManager] Failed to initialize server '${config.name}':`, error);
        errorCount++;

        this.telemetry?.logStructured({
          level: LogLevel.ERROR,
          component: 'MCPToolManager',
          phase: 'server_initialization_error',
          message: 'Failed to initialize server',
          metadata: {
            serverId: config.name,
            errorMessage: error.message,
            errorType: error.constructor.name,
          },
          error: error as Error,
        });

        // Handle error but don't fail the entire initialization
        if (this.errorHandler) {
          await this.errorHandler.handleError(error as Error, {
            component: this.name,
            operation: 'initializeWithConfigs',
            serverId: config.name,
          } as ErrorContext);
        }
      }
    }

    this.telemetry?.logStructured({
      level: LogLevel.INFO,
      component: 'MCPToolManager',
      phase: 'server_initialization_complete',
      message: 'Server initialization completed',
      metadata: {
        totalServers: configs.length,
        successCount,
        errorCount,
        totalTools: this.toolRegistry.getAllTools().length,
      },
    });

    console.log('[MCPToolManager] Server initialization complete');
  }

  /**
   * Initialize with server configurations without telemetry (fallback)
   */
  private async initializeWithConfigsWithoutTelemetry(configs: MCPServerConfig[]): Promise<void> {
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
            inputSchema: tool.inputSchema || {},
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
            serverId: config.name,
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

    const tools = this.toolRegistry.getAllTools();

    this.telemetry?.logStructured({
      level: LogLevel.DEBUG,
      component: 'MCPToolManager',
      phase: 'tools_list',
      message: 'Available tools requested',
      metadata: {
        toolCount: tools.length,
        serverBreakdown: Object.entries(
          tools.reduce((acc, tool) => {
            acc[tool.serverId] = (acc[tool.serverId] || 0) + 1;
            return acc;
          }, {} as Record<string, number>),
        ),
      },
    });

    return tools;
  }

  /**
   * Get tool definition by ID
   */
  async getToolDefinition(toolId: string): Promise<ToolDefinition | null> {
    if (!this.isInitialized) {
      throw new Error('MCPToolManager not initialized');
    }

    const tool = this.toolRegistry.getToolDefinition(toolId);

    this.telemetry?.logStructured({
      level: LogLevel.DEBUG,
      component: 'MCPToolManager',
      phase: 'tool_definition_lookup',
      message: 'Tool definition lookup',
      metadata: {
        toolId,
        found: !!tool,
        serverId: tool?.serverId,
      },
    });

    return tool;
  }

  /**
   * Refresh tool registry
   */
  async refreshToolRegistry(): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('MCPToolManager not initialized');
    }

    console.log('[MCPToolManager] Refreshing tool registry...');

    this.telemetry?.logStructured({
      level: LogLevel.INFO,
      component: 'MCPToolManager',
      phase: 'registry_refresh_start',
      message: 'Starting tool registry refresh',
      metadata: {
        currentToolCount: this.toolRegistry.getAllTools().length,
        activeServers: this.clientInstances.size,
      },
    });

    let refreshedServers = 0;
    let totalToolsRefreshed = 0;

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
              inputSchema: tool.inputSchema || {},
            });
          }

          this.telemetry?.logStructured({
            level: LogLevel.INFO,
            component: 'MCPToolManager',
            phase: 'server_tools_refreshed',
            message: 'Server tools refreshed successfully',
            metadata: {
              serverId,
              toolCount: tools.length,
            },
          });

          refreshedServers++;
          totalToolsRefreshed += tools.length;
        }
      } catch (error) {
        console.error(`[MCPToolManager] Failed to refresh tools for server '${serverId}':`, error);

        this.telemetry?.logStructured({
          level: LogLevel.ERROR,
          component: 'MCPToolManager',
          phase: 'server_refresh_error',
          message: 'Failed to refresh server tools',
          metadata: {
            serverId,
            errorMessage: error.message,
          },
          error: error as Error,
        });
      }
    }

    this.telemetry?.logStructured({
      level: LogLevel.INFO,
      component: 'MCPToolManager',
      phase: 'registry_refresh_complete',
      message: 'Tool registry refresh completed',
      metadata: {
        refreshedServers,
        totalServers: this.clientInstances.size,
        totalToolsRefreshed,
        finalToolCount: this.toolRegistry.getAllTools().length,
      },
    });

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

    // Use telemetry wrapper if available
    if (this.telemetry) {
      return await this.telemetry.withTrace(
        'MCPToolManager',
        'executeTool',
        async () => await this.executeToolWithTelemetry(call),
      );
    }

    // Fallback without telemetry
    return await this.executeToolWithoutTelemetry(call);
  }

  /**
   * Execute tool with telemetry tracking
   */
  private async executeToolWithTelemetry(call: ToolCall): Promise<ToolResult> {
    const tool = this.toolRegistry.getToolDefinition(call.toolId);
    if (!tool) {
      const error = new Error(`Tool not found: ${call.toolId}`);

      this.telemetry?.logStructured({
        level: LogLevel.ERROR,
        component: 'MCPToolManager',
        phase: 'tool_not_found',
        message: 'Tool not found in registry',
        metadata: {
          toolId: call.toolId,
          serverId: call.serverId,
          availableTools: this.toolRegistry.getAllTools().map(t => t.name),
        },
        error,
      });

      throw error;
    }

    if (tool.serverId !== call.serverId) {
      const error = new Error(`Tool ${call.toolId} does not belong to server ${call.serverId}`);

      this.telemetry?.logStructured({
        level: LogLevel.ERROR,
        component: 'MCPToolManager',
        phase: 'tool_server_mismatch',
        message: 'Tool does not belong to specified server',
        metadata: {
          toolId: call.toolId,
          requestedServerId: call.serverId,
          actualServerId: tool.serverId,
        },
        error,
      });

      throw error;
    }

    // Check circuit breaker before executing
    const circuitBreakerStatus = this.getCircuitBreakerStatus(call.serverId);
    if (circuitBreakerStatus.state === CircuitBreakerState.OPEN) {
      const error = new Error(`Circuit breaker is open for server ${call.serverId}`);

      this.telemetry?.logStructured({
        level: LogLevel.WARN,
        component: 'MCPToolManager',
        phase: 'circuit_breaker_open',
        message: 'Circuit breaker is open, tool execution blocked',
        metadata: {
          toolId: call.toolId,
          serverId: call.serverId,
          circuitBreakerStatus,
        },
        error,
      });

      throw error;
    }

    const startTime = Date.now();

    this.telemetry?.logStructured({
      level: LogLevel.INFO,
      component: 'MCPToolManager',
      phase: 'tool_execution_start',
      message: 'Starting tool execution',
      metadata: {
        toolId: call.toolId,
        serverId: call.serverId,
        toolName: tool.name,
        argumentKeys: Object.keys(call.arguments || {}),
        circuitBreakerState: circuitBreakerStatus.state,
      },
    });

    try {
      // Get client instance for this server
      const client = this.clientInstances.get(call.serverId);
      if (!client) {
        throw new Error(`No client instance found for server: ${call.serverId}`);
      }

      // Execute the tool through the client with error recovery
      const recoveryService = createErrorRecoveryService();
      const result = await recoveryService.executeWithRetry(async () => {
        return await client.callTool(tool.name, call.arguments);
      }, {
        strategy: RetryStrategy.EXPONENTIAL_BACKOFF,
        maxAttempts: 3,
        onRetry: (error: Error, attempt: number, delay: number) => {
          console.log(`[MCPToolManager] Retry attempt ${attempt} for tool ${call.toolId}: ${error.message} (delay: ${delay}ms)`);

          this.telemetry?.logStructured({
            level: LogLevel.WARN,
            component: 'MCPToolManager',
            phase: 'tool_execution_retry',
            message: 'Retrying tool execution',
            metadata: {
              toolId: call.toolId,
              serverId: call.serverId,
              attempt,
              maxAttempts: 3,
              delay,
              errorMessage: error.message,
            },
          });
        },
        onFailure: (error: Error, attempts: number) => {
          console.error(`[MCPToolManager] Tool execution failed after ${attempts} attempts: ${error.message}`);

          this.telemetry?.logStructured({
            level: LogLevel.ERROR,
            component: 'MCPToolManager',
            phase: 'tool_execution_final_failure',
            message: 'Tool execution failed after all retries',
            metadata: {
              toolId: call.toolId,
              serverId: call.serverId,
              totalAttempts: attempts,
              finalError: error.message,
            },
            error,
          });
        },
      });

      const executionTime = Date.now() - startTime;
      console.log(`[MCPToolManager] Tool execution completed in ${executionTime}ms`);

      this.telemetry?.logStructured({
        level: LogLevel.INFO,
        component: 'MCPToolManager',
        phase: 'tool_execution_success',
        message: 'Tool execution completed successfully',
        metadata: {
          toolId: call.toolId,
          serverId: call.serverId,
          executionTime,
          resultLength: typeof result === 'string' ? result.length : JSON.stringify(result).length,
        },
        duration: executionTime,
      });

      // Update tool usage statistics
      this.toolRegistry.updateToolUsage(call.toolId, executionTime);

      return {
        toolId: call.toolId,
        success: true,
        output: result,
        executionTime,
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      console.error(`[MCPToolManager] Tool execution failed:`, error);

      this.telemetry?.logStructured({
        level: LogLevel.ERROR,
        component: 'MCPToolManager',
        phase: 'tool_execution_error',
        message: 'Tool execution failed',
        metadata: {
          toolId: call.toolId,
          serverId: call.serverId,
          executionTime,
          errorMessage: error.message,
          errorType: error.constructor.name,
        },
        duration: executionTime,
        error: error as Error,
      });

      return {
        toolId: call.toolId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTime,
      };
    }
  }

  /**
   * Execute tool without telemetry (fallback)
   */
  private async executeToolWithoutTelemetry(call: ToolCall): Promise<ToolResult> {
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

      // Execute the tool through the client with error recovery
      const recoveryService = createErrorRecoveryService();
      const result = await recoveryService.executeWithRetry(async () => {
        return await client.callTool(tool.name, call.arguments);
      }, {
        strategy: RetryStrategy.EXPONENTIAL_BACKOFF,
        maxAttempts: 3,
        onRetry: (error: Error, attempt: number, delay: number) => {
          console.log(`[MCPToolManager] Retry attempt ${attempt} for tool ${call.toolId}: ${error.message} (delay: ${delay}ms)`);
        },
        onFailure: (error: Error, attempts: number) => {
          console.error(`[MCPToolManager] Tool execution failed after ${attempts} attempts: ${error.message}`);
        },
      });

      const executionTime = Date.now() - startTime;
      console.log(`[MCPToolManager] Tool execution completed in ${executionTime}ms`);

      // Update tool usage statistics
      this.toolRegistry.updateToolUsage(call.toolId, executionTime);

      return {
        toolId: call.toolId,
        success: true,
        output: result,
        executionTime,
      };
    } catch (error) {
      console.error(`[MCPToolManager] Tool execution failed:`, error);

      return {
        toolId: call.toolId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTime: Date.now() - startTime,
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

    this.telemetry?.logStructured({
      level: LogLevel.INFO,
      component: 'MCPToolManager',
      phase: 'batch_execution_start',
      message: 'Starting batch tool execution',
      metadata: {
        toolCount: calls.length,
        tools: calls.map(c => ({ toolId: c.toolId, serverId: c.serverId })),
        uniqueServers: [...new Set(calls.map(c => c.serverId))],
      },
    });

    const startTime = Date.now();

    try {
      const promises = calls.map(call => this.executeTool(call));
      const results = await Promise.all(promises);

      const executionTime = Date.now() - startTime;
      const successCount = results.filter(r => r.success).length;
      const errorCount = results.length - successCount;

      this.telemetry?.logStructured({
        level: LogLevel.INFO,
        component: 'MCPToolManager',
        phase: 'batch_execution_complete',
        message: 'Batch tool execution completed',
        metadata: {
          totalTools: calls.length,
          successCount,
          errorCount,
          executionTime,
          averageTimePerTool: executionTime / calls.length,
        },
        duration: executionTime,
      });

      return results;
    } catch (error) {
      const executionTime = Date.now() - startTime;

      this.telemetry?.logStructured({
        level: LogLevel.ERROR,
        component: 'MCPToolManager',
        phase: 'batch_execution_error',
        message: 'Batch tool execution failed',
        metadata: {
          toolCount: calls.length,
          executionTime,
          errorMessage: error.message,
        },
        duration: executionTime,
        error: error as Error,
      });

      throw error;
    }
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

    const status = await client.getStatus();

    this.telemetry?.logStructured({
      level: LogLevel.DEBUG,
      component: 'MCPToolManager',
      phase: 'server_status_check',
      message: 'Server status checked',
      metadata: {
        serverId,
        status: status.status,
        toolCount: status.toolCount,
        lastConnected: status.lastConnected?.toISOString(),
      },
    });

    return status;
  }

  /**
   * Get all server statuses
   */
  async getAllServerStatuses(): Promise<ServerStatus[]> {
    if (!this.isInitialized) {
      throw new Error('MCPToolManager not initialized');
    }

    const statuses: ServerStatus[] = [];
    let healthyCount = 0;
    let errorCount = 0;

    for (const [serverId, client] of this.clientInstances) {
      try {
        const status = await client.getStatus();
        statuses.push(status);
        if (status.status === 'connected') healthyCount++;
      } catch (error) {
        console.error(`[MCPToolManager] Failed to get status for server '${serverId}':`, error);
        errorCount++;
        // Set a default failed status
        statuses.push({
          serverId,
          status: 'error',
          lastConnected: undefined,
          lastError: error instanceof Error ? error.message : 'Unknown error',
          toolCount: 0,
        });
      }
    }

    this.telemetry?.logStructured({
      level: LogLevel.INFO,
      component: 'MCPToolManager',
      phase: 'all_server_status_check',
      message: 'All server statuses checked',
      metadata: {
        totalServers: this.clientInstances.size,
        healthyCount,
        errorCount,
        serverBreakdown: statuses.map(s => ({ serverId: s.serverId, status: s.status })),
      },
    });

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
    const status = client.getCircuitBreakerStatus();

    this.telemetry?.logStructured({
      level: LogLevel.DEBUG,
      component: 'MCPToolManager',
      phase: 'circuit_breaker_status_check',
      message: 'Circuit breaker status checked',
      metadata: {
        serverId,
        state: status.state,
        failureCount: status.failureCount,
        lastFailureTime: status.lastFailureTime?.toISOString(),
      },
    });

    return status;
  }

  /**
   * Generate system prompt tools
   */
  generateSystemPromptTools(): string {
    if (!this.isInitialized) {
      return 'MCP Tool Manager not initialized.';
    }

    const prompt = this.toolRegistry.generateSystemPromptTools();

    this.telemetry?.logStructured({
      level: LogLevel.DEBUG,
      component: 'MCPToolManager',
      phase: 'system_prompt_generated',
      message: 'System prompt tools generated',
      metadata: {
        toolCount: this.toolRegistry.getAllTools().length,
        promptLength: prompt.length,
      },
    });

    return prompt;
  }

  /**
   * Health check for all servers
   */
  async performHealthCheck(): Promise<Map<string, boolean>> {
    if (!this.isInitialized) {
      throw new Error('MCPToolManager not initialized');
    }

    this.telemetry?.logStructured({
      level: LogLevel.INFO,
      component: 'MCPToolManager',
      phase: 'health_check_start',
      message: 'Starting health check for all servers',
      metadata: {
        serverCount: this.clientInstances.size,
      },
    });

    const healthResults = new Map<string, boolean>();
    let healthyCount = 0;
    let unhealthyCount = 0;

    for (const [serverId, client] of this.clientInstances) {
      try {
        const status = await client.getStatus();
        const isHealthy = status.status === 'connected';
        healthResults.set(serverId, isHealthy);

        if (isHealthy) {
          healthyCount++;
        } else {
          unhealthyCount++;
        }

        this.telemetry?.logStructured({
          level: isHealthy ? LogLevel.DEBUG : LogLevel.WARN,
          component: 'MCPToolManager',
          phase: 'server_health_check',
          message: `Server health check: ${isHealthy ? 'healthy' : 'unhealthy'}`,
          metadata: {
            serverId,
            status: status.status,
            isHealthy,
            toolCount: status.toolCount,
          },
        });

      } catch (error) {
        console.error(`[MCPToolManager] Health check failed for server '${serverId}':`, error);
        healthResults.set(serverId, false);
        unhealthyCount++;

        this.telemetry?.logStructured({
          level: LogLevel.ERROR,
          component: 'MCPToolManager',
          phase: 'server_health_check_error',
          message: 'Server health check failed',
          metadata: {
            serverId,
            errorMessage: error.message,
          },
          error: error as Error,
        });
      }
    }

    this.lastHealthCheck = new Date();

    this.telemetry?.logStructured({
      level: LogLevel.INFO,
      component: 'MCPToolManager',
      phase: 'health_check_complete',
      message: 'Health check completed for all servers',
      metadata: {
        totalServers: this.clientInstances.size,
        healthyCount,
        unhealthyCount,
        healthCheckTime: this.lastHealthCheck.toISOString(),
      },
    });

    return healthResults;
  }
}