/**
 * MCP Client Implementation
 *
 * Handles communication with external MCP servers using stdio transport
 */

import {
  IMCPClient,
  MCPRequest,
  MCPResponse,
  MCPServerConfig,
  ServerStatus,
  CircuitBreakerState,
  CircuitBreakerStatus,
  CircuitBreakerConfig
} from './types.ts';
import { ProcessManager, ProcessHandle } from './process-manager.ts';
import { StdioTransport } from './stdio-transport.ts';
import { ProtocolHandler } from './protocol-handler.ts';

/**
 * MCP Client for stdio transport
 */
export class MCPStdioClient implements IMCPClient {
  private processManager = new ProcessManager();
  private protocolHandler: ProtocolHandler | null = null;
  private transport: StdioTransport | null = null;
  private processHandle: ProcessHandle | null = null;
  private requestId = 0;
  private circuitBreaker: CircuitBreakerStatus;
  private readonly circuitBreakerConfig: CircuitBreakerConfig = {
    failureThreshold: 5,
    resetTimeout: 30000, // 30 seconds
    halfOpenMaxCalls: 3
  };
  private lastResponseTime = 0;
  private connectedAt: Date | null = null;

  constructor(private config: MCPServerConfig) {
    console.log(`[MCPStdioClient] Creating client for ${this.config.name}`);
    this.circuitBreaker = {
      state: CircuitBreakerState.CLOSED,
      failureCount: 0
    };
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

    if (this.circuitBreaker.state === CircuitBreakerState.OPEN) {
      if (this.circuitBreaker.nextRetryTime && Date.now() < this.circuitBreaker.nextRetryTime.getTime()) {
        throw new Error(`Circuit breaker is open. Next retry at ${this.circuitBreaker.nextRetryTime}`);
      }
      // Transition to half-open state
      this.circuitBreaker.state = CircuitBreakerState.HALF_OPEN;
    }

    try {
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

      // Reset circuit breaker on successful connection
      this.circuitBreaker.state = CircuitBreakerState.CLOSED;
      this.circuitBreaker.failureCount = 0;
      delete this.circuitBreaker.lastFailureTime;
      delete this.circuitBreaker.nextRetryTime;

      this.connectedAt = new Date();

    } catch (error) {
      console.error(`[MCPStdioClient] Failed to connect to ${this.config.name}:`, error);
      this.handleCircuitBreakerFailure();
      await this.cleanup();
      throw error;
    }
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

    if (this.circuitBreaker.state === CircuitBreakerState.OPEN) {
      throw new Error('Circuit breaker is open');
    }

    try {
      const startTime = Date.now();
      const response = await this.protocolHandler.sendRequest(request, this.config.timeout);
      this.lastResponseTime = Date.now() - startTime;

      // Reset circuit breaker on successful request
      if (this.circuitBreaker.state === CircuitBreakerState.HALF_OPEN) {
        this.circuitBreaker.state = CircuitBreakerState.CLOSED;
        this.circuitBreaker.failureCount = 0;
      }

      return response;

    } catch (error) {
      this.handleCircuitBreakerFailure();
      throw error;
    }
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
    return {
      serverId: this.config.name,
      status: this.isConnected() ? 'connected' : 'disconnected',
      lastConnected: this.connectedAt || undefined,
      lastError: this.circuitBreaker.lastFailureTime ? 'Circuit breaker failure' : undefined,
      toolCount: 0, // Will be updated by tool manager
      responseTime: this.lastResponseTime
    };
  }

  /**
   * Get circuit breaker status
   */
  getCircuitBreakerStatus(): CircuitBreakerStatus {
    return { ...this.circuitBreaker };
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
    return await this.protocolHandler.listTools();
  }

  /**
   * Call a tool on the server
   */
  async callTool(name: string, arguments_: any): Promise<any> {
    if (!this.protocolHandler) {
      throw new Error('Not connected to MCP server');
    }
    return await this.protocolHandler.callTool(name, arguments_);
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

  /**
   * Handle circuit breaker failure
   */
  private handleCircuitBreakerFailure(): void {
    this.circuitBreaker.failureCount++;
    this.circuitBreaker.lastFailureTime = new Date();

    if (this.circuitBreaker.failureCount >= this.circuitBreakerConfig.failureThreshold) {
      this.circuitBreaker.state = CircuitBreakerState.OPEN;
      this.circuitBreaker.nextRetryTime = new Date(Date.now() + this.circuitBreakerConfig.resetTimeout);
      console.log(`[MCPStdioClient] Circuit breaker opened for ${this.config.name}, will retry at ${this.circuitBreaker.nextRetryTime}`);
    }
  }
}