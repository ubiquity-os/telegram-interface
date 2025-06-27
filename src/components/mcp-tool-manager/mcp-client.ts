/**
 * MCP Client Implementation
 *
 * Handles communication with external MCP servers using stdio transport
 * Now includes unified circuit breaker protection
 */

import {
  IMCPClient,
  MCPRequest,
  MCPResponse,
  MCPServerConfig,
  ServerStatus,
  CircuitBreakerState,
  CircuitBreakerStatus
} from './types.ts';
import { ProcessManager, ProcessHandle } from './process-manager.ts';
import { StdioTransport } from './stdio-transport.ts';
import { ProtocolHandler } from './protocol-handler.ts';
import { CircuitBreaker } from '../../reliability/circuit-breaker.ts';
import { getCircuitBreakerConfig } from '../../reliability/circuit-breaker-configs.ts';

/**
 * MCP Client for stdio transport
 */
export class MCPStdioClient implements IMCPClient {
  private processManager = new ProcessManager();
  private protocolHandler: ProtocolHandler | null = null;
  private transport: StdioTransport | null = null;
  private processHandle: ProcessHandle | null = null;
  private requestId = 0;
  private readonly circuitBreaker: CircuitBreaker<any>;
  private lastResponseTime = 0;
  private connectedAt: Date | null = null;

  constructor(private config: MCPServerConfig) {
    console.log(`[MCPStdioClient] Creating client for ${this.config.name}`);

    // Initialize circuit breaker with MCP-specific configuration
    this.circuitBreaker = new CircuitBreaker(
      `mcp-${this.config.name}`,
      getCircuitBreakerConfig('mcp')
    );

    console.log(`[MCPStdioClient] Circuit breaker initialized for MCP server ${this.config.name}`);
  }

  /**
   * Connect to MCP server
   */
  async connect(): Promise<void> {
    console.log(`[MCPStdioClient] Connecting to ${this.config.name}`);

    if (this.isConnected()) {
      console.log(`[MCPStdioClient] Already connected to ${this.config.name}`);
      return;
    }

    // Wrap connection logic in circuit breaker
    await this.circuitBreaker.call(async () => {
      // Spawn the process
      this.processHandle = await this.processManager.spawnProcess(
        this.config.name,
        this.config
      );

      // Create transport
      this.transport = new StdioTransport(
        this.processHandle.stdout,
        this.processHandle.stdin
      );

      // Create protocol handler
      this.protocolHandler = new ProtocolHandler();

      // Start the protocol handler with transport
      await this.protocolHandler.start(this.transport);

      // Initialize the connection
      const protocolInfo = await this.protocolHandler.initialize();
      console.log(`[MCPStdioClient] Connected to ${this.config.name}, protocol version: ${protocolInfo.protocolVersion}`);

      this.connectedAt = new Date();
      return protocolInfo;
    }).catch(async (error) => {
      console.error(`[MCPStdioClient] Failed to connect to ${this.config.name}:`, error);
      await this.cleanup();
      throw error;
    });
  }

  /**
   * Disconnect from MCP server
   */
  async disconnect(): Promise<void> {
    console.log(`[MCPStdioClient] Disconnecting from ${this.config.name}`);
    await this.cleanup();
    this.connectedAt = null;
  }

  /**
   * Send request to MCP server
   */
  async sendRequest(request: MCPRequest): Promise<MCPResponse> {
    console.log(`[MCPStdioClient] Sending request to ${this.config.name}, method: ${request.method}`);

    if (!this.isConnected() || !this.protocolHandler) {
      throw new Error('Not connected to MCP server');
    }

    // Wrap request in circuit breaker
    return await this.circuitBreaker.call(async () => {
      const startTime = Date.now();
      const response = await this.protocolHandler!.sendRequest(request, this.config.timeout);
      this.lastResponseTime = Date.now() - startTime;
      return response;
    });
  }

  /**
   * Check if connected to server
   */
  isConnected(): boolean {
    return this.protocolHandler !== null &&
           this.protocolHandler.isActive() &&
           this.processManager.isProcessRunning(this.config.name);
  }

  /**
   * Get server status
   */
  getStatus(): ServerStatus {
    const circuitBreakerStatus = this.circuitBreaker.getStatus();

    return {
      serverId: this.config.name,
      status: this.isConnected() ? 'connected' : 'disconnected',
      lastConnected: this.connectedAt || undefined,
      lastError: circuitBreakerStatus.state === 'open' ? 'Circuit breaker is open' : undefined,
      toolCount: 0, // Will be updated by tool manager
      responseTime: this.lastResponseTime
    };
  }

  /**
   * Get circuit breaker status - Convert to legacy format for compatibility
   */
  getCircuitBreakerStatus(): CircuitBreakerStatus {
    const status = this.circuitBreaker.getStatus();

    // Convert our CircuitBreakerStatus to the legacy format expected by MCP types
    return {
      state: status.state === 'open' ? CircuitBreakerState.OPEN :
             status.state === 'half-open' ? CircuitBreakerState.HALF_OPEN :
             CircuitBreakerState.CLOSED,
      failureCount: status.metrics.failedCalls,
      lastFailureTime: status.metrics.lastFailureTime,
      nextRetryTime: status.nextRetryTime
    };
  }

  /**
   * Generate next request ID
   */
  generateRequestId(): string | number {
    return ++this.requestId;
  }

  /**
   * List available tools from the server
   */
  async listTools(): Promise<any[]> {
    if (!this.protocolHandler) {
      throw new Error('Not connected to MCP server');
    }

    // Wrap in circuit breaker
    return await this.circuitBreaker.call(async () => {
      return await this.protocolHandler!.listTools();
    });
  }

  /**
   * Call a tool on the server
   */
  async callTool(name: string, arguments_: any): Promise<any> {
    if (!this.protocolHandler) {
      throw new Error('Not connected to MCP server');
    }

    // Wrap in circuit breaker
    return await this.circuitBreaker.call(async () => {
      return await this.protocolHandler!.callTool(name, arguments_);
    });
  }

  /**
   * Reset circuit breaker
   */
  resetCircuitBreaker(): void {
    this.circuitBreaker.reset();
    console.log(`[MCPStdioClient] Circuit breaker reset for ${this.config.name}`);
  }

  /**
   * Clean up resources
   */
  private async cleanup(): Promise<void> {
    try {
      if (this.protocolHandler) {
        await this.protocolHandler.stop();
        this.protocolHandler = null;
      }

      if (this.transport) {
        this.transport = null;
      }

      if (this.processHandle) {
        await this.processManager.killProcess(this.config.name);
        this.processHandle = null;
      }
    } catch (error) {
      console.error(`[MCPStdioClient] Error during cleanup:`, error);
    }
  }
}