/**
 * MCP Connection Pool Implementation
 */

import { EventEmitter } from './event-emitter.ts';
import { MCPStdioClient } from '../../components/mcp-tool-manager/mcp-client.ts';
import { MCPServerConfig } from '../../components/mcp-tool-manager/types.ts';
import {
  IConnectionPool,
  PooledConnection,
  ConnectionPoolConfig,
  ConnectionRequest,
  PoolStats,
  ConnectionPoolEvent
} from './types.ts';

/**
 * Default connection pool configuration
 */
const DEFAULT_CONFIG: ConnectionPoolConfig = {
  minConnections: 1,
  maxConnections: 5,
  idleTimeout: 300000, // 5 minutes
  connectionTimeout: 30000, // 30 seconds
  healthCheckInterval: 60000, // 1 minute
  maxRetries: 3
};

/**
 * Connection pool for MCP servers
 */
export class ConnectionPool implements IConnectionPool {
  private eventEmitter = new EventEmitter<ConnectionPoolEvent>();
  private pools = new Map<string, Set<PooledConnection>>();
  private serverConfigs = new Map<string, MCPServerConfig>();
  private waitQueues = new Map<string, ConnectionRequest[]>();
  private healthCheckTimers = new Map<string, number>();
  private idleTimers = new Map<string, number>();
  private stats = new Map<string, PoolStats>();
  private config: ConnectionPoolConfig;
  private connectionCounter = 0;

  constructor(config: Partial<ConnectionPoolConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    console.log('[ConnectionPool] Created with config:', this.config);
  }

  /**
   * Initialize pool for a server
   */
  async initializeServer(serverConfig: MCPServerConfig): Promise<void> {
    console.log(`[ConnectionPool] Initializing pool for ${serverConfig.name}`);

    this.serverConfigs.set(serverConfig.name, serverConfig);
    this.pools.set(serverConfig.name, new Set());
    this.waitQueues.set(serverConfig.name, []);
    this.stats.set(serverConfig.name, {
      serverId: serverConfig.name,
      totalConnections: 0,
      activeConnections: 0,
      idleConnections: 0,
      waitingRequests: 0,
      totalRequests: 0,
      failedRequests: 0,
      averageWaitTime: 0
    });

    // Create minimum connections
    const createPromises: Promise<void>[] = [];
    for (let i = 0; i < this.config.minConnections; i++) {
      createPromises.push(this.createConnection(serverConfig));
    }
    await Promise.all(createPromises);

    // Start health check timer
    this.startHealthCheck(serverConfig.name);
  }

  /**
   * Acquire a connection from the pool
   */
  async acquire(serverId: string, timeout?: number): Promise<PooledConnection> {
    const stats = this.stats.get(serverId);
    if (!stats) {
      throw new Error(`Server ${serverId} not initialized`);
    }

    stats.totalRequests++;
    const startTime = Date.now();

    // Try to get an idle connection
    const connection = await this.getIdleConnection(serverId);
    if (connection) {
      connection.inUse = true;
      connection.lastUsed = new Date();
      stats.activeConnections++;
      stats.idleConnections--;

      const waitTime = Date.now() - startTime;
      stats.averageWaitTime = (stats.averageWaitTime + waitTime) / 2;

      this.eventEmitter.emit(ConnectionPoolEvent.CONNECTION_ACQUIRED, {
        connectionId: connection.id,
        serverId
      });

      return connection;
    }

    // Try to create a new connection if under limit
    const pool = this.pools.get(serverId)!;
    if (pool.size < this.config.maxConnections) {
      try {
        const serverConfig = this.serverConfigs.get(serverId)!;
        await this.createConnection(serverConfig);

        // Retry acquisition
        return this.acquire(serverId, timeout);
      } catch (error) {
        console.error(`[ConnectionPool] Failed to create connection for ${serverId}:`, error);
        stats.failedRequests++;
        throw error;
      }
    }

    // Pool is full, add to wait queue
    return this.waitForConnection(serverId, timeout || this.config.connectionTimeout);
  }

  /**
   * Release a connection back to the pool
   */
  async release(connectionId: string): Promise<void> {
    let found = false;

    for (const [serverId, pool] of this.pools) {
      for (const connection of pool) {
        if (connection.id === connectionId) {
          connection.inUse = false;
          connection.lastUsed = new Date();

          const stats = this.stats.get(serverId)!;
          stats.activeConnections--;
          stats.idleConnections++;

          this.eventEmitter.emit(ConnectionPoolEvent.CONNECTION_RELEASED, {
            connectionId,
            serverId
          });

          // Process wait queue
          this.processWaitQueue(serverId);

          // Start idle timer
          this.startIdleTimer(connection);

          found = true;
          break;
        }
      }
      if (found) break;
    }

    if (!found) {
      console.warn(`[ConnectionPool] Connection ${connectionId} not found`);
    }
  }

  /**
   * Get pool statistics
   */
  getStats(serverId: string): PoolStats | undefined {
    return this.stats.get(serverId);
  }

  /**
   * Get all pool statistics
   */
  getAllStats(): Map<string, PoolStats> {
    return new Map(this.stats);
  }

  /**
   * Close all connections for a server
   */
  async closeServer(serverId: string): Promise<void> {
    console.log(`[ConnectionPool] Closing all connections for ${serverId}`);

    // Stop health check
    const healthTimer = this.healthCheckTimers.get(serverId);
    if (healthTimer) {
      clearInterval(healthTimer);
      this.healthCheckTimers.delete(serverId);
    }

    // Close all connections
    const pool = this.pools.get(serverId);
    if (pool) {
      const closePromises: Promise<void>[] = [];
      for (const connection of pool) {
        closePromises.push(this.closeConnection(connection));
      }
      await Promise.all(closePromises);
      pool.clear();
    }

    // Clear wait queue
    const waitQueue = this.waitQueues.get(serverId);
    if (waitQueue) {
      for (const request of waitQueue) {
        request.reject(new Error('Server closing'));
      }
      waitQueue.length = 0;
    }

    // Clean up
    this.pools.delete(serverId);
    this.serverConfigs.delete(serverId);
    this.waitQueues.delete(serverId);
    this.stats.delete(serverId);
  }

  /**
   * Close all connections
   */
  async closeAll(): Promise<void> {
    console.log('[ConnectionPool] Closing all connections');

    const closePromises: Promise<void>[] = [];
    for (const serverId of this.pools.keys()) {
      closePromises.push(this.closeServer(serverId));
    }
    await Promise.all(closePromises);
  }

  /**
   * Check if server has available connections
   */
  hasAvailableConnection(serverId: string): boolean {
    const pool = this.pools.get(serverId);
    if (!pool) return false;

    for (const connection of pool) {
      if (!connection.inUse && connection.client.isConnected()) {
        return true;
      }
    }

    return pool.size < this.config.maxConnections;
  }

  /**
   * Get connection count for server
   */
  getConnectionCount(serverId: string): number {
    const pool = this.pools.get(serverId);
    return pool ? pool.size : 0;
  }

  /**
   * Create a new connection
   */
  private async createConnection(serverConfig: MCPServerConfig): Promise<void> {
    console.log(`[ConnectionPool] Creating connection for ${serverConfig.name}`);

    const client = new MCPStdioClient(serverConfig);
    await client.connect();

    const connection: PooledConnection = {
      id: `${serverConfig.name}-${++this.connectionCounter}`,
      client,
      serverConfig,
      inUse: false,
      lastUsed: new Date(),
      created: new Date(),
      healthCheckFailures: 0
    };

    const pool = this.pools.get(serverConfig.name)!;
    pool.add(connection);

    const stats = this.stats.get(serverConfig.name)!;
    stats.totalConnections++;
    stats.idleConnections++;

    this.eventEmitter.emit(ConnectionPoolEvent.CONNECTION_CREATED, {
      connectionId: connection.id,
      serverId: serverConfig.name
    });
  }

  /**
   * Close a connection
   */
  private async closeConnection(connection: PooledConnection): Promise<void> {
    console.log(`[ConnectionPool] Closing connection ${connection.id}`);

    try {
      await connection.client.disconnect();
    } catch (error) {
      console.error(`[ConnectionPool] Error closing connection ${connection.id}:`, error);
    }

    // Clear idle timer
    const idleTimer = this.idleTimers.get(connection.id);
    if (idleTimer) {
      clearTimeout(idleTimer);
      this.idleTimers.delete(connection.id);
    }

    const stats = this.stats.get(connection.serverConfig.name);
    if (stats) {
      stats.totalConnections--;
      if (connection.inUse) {
        stats.activeConnections--;
      } else {
        stats.idleConnections--;
      }
    }

    this.eventEmitter.emit(ConnectionPoolEvent.CONNECTION_CLOSED, {
      connectionId: connection.id,
      serverId: connection.serverConfig.name
    });
  }

  /**
   * Get an idle connection from the pool
   */
  private async getIdleConnection(serverId: string): Promise<PooledConnection | null> {
    const pool = this.pools.get(serverId);
    if (!pool) return null;

    for (const connection of pool) {
      if (!connection.inUse && connection.client.isConnected()) {
        // Clear idle timer
        const idleTimer = this.idleTimers.get(connection.id);
        if (idleTimer) {
          clearTimeout(idleTimer);
          this.idleTimers.delete(connection.id);
        }

        return connection;
      }
    }

    return null;
  }

  /**
   * Wait for a connection to become available
   */
  private async waitForConnection(serverId: string, timeout: number): Promise<PooledConnection> {
    const stats = this.stats.get(serverId)!;
    stats.waitingRequests++;

    this.eventEmitter.emit(ConnectionPoolEvent.POOL_FULL, { serverId });

    return new Promise((resolve, reject) => {
      const request: ConnectionRequest = {
        id: `req-${Date.now()}-${Math.random()}`,
        serverId,
        priority: 0,
        timestamp: new Date(),
        timeout,
        resolve,
        reject
      };

      const waitQueue = this.waitQueues.get(serverId)!;
      waitQueue.push(request);

      // Set timeout
      setTimeout(() => {
        const index = waitQueue.indexOf(request);
        if (index !== -1) {
          waitQueue.splice(index, 1);
          stats.waitingRequests--;
          stats.failedRequests++;
          reject(new Error(`Connection timeout after ${timeout}ms`));
        }
      }, timeout);
    });
  }

  /**
   * Process wait queue for a server
   */
  private processWaitQueue(serverId: string): void {
    const waitQueue = this.waitQueues.get(serverId);
    if (!waitQueue || waitQueue.length === 0) return;

    const connection = this.getIdleConnectionSync(serverId);
    if (!connection) return;

    const request = waitQueue.shift()!;
    const stats = this.stats.get(serverId)!;
    stats.waitingRequests--;

    connection.inUse = true;
    connection.lastUsed = new Date();
    stats.activeConnections++;
    stats.idleConnections--;

    const waitTime = Date.now() - request.timestamp.getTime();
    stats.averageWaitTime = (stats.averageWaitTime + waitTime) / 2;

    request.resolve(connection);
  }

  /**
   * Get idle connection synchronously
   */
  private getIdleConnectionSync(serverId: string): PooledConnection | null {
    const pool = this.pools.get(serverId);
    if (!pool) return null;

    for (const connection of pool) {
      if (!connection.inUse && connection.client.isConnected()) {
        return connection;
      }
    }

    return null;
  }

  /**
   * Start health check for a server
   */
  private startHealthCheck(serverId: string): void {
    const timer = setInterval(() => {
      this.performHealthCheck(serverId);
    }, this.config.healthCheckInterval);

    this.healthCheckTimers.set(serverId, timer);
  }

  /**
   * Perform health check on all connections
   */
  private async performHealthCheck(serverId: string): Promise<void> {
    const pool = this.pools.get(serverId);
    if (!pool) return;

    for (const connection of pool) {
      if (!connection.inUse) {
        try {
          // Simple health check - verify connection is alive
          if (!connection.client.isConnected()) {
            connection.healthCheckFailures++;

            if (connection.healthCheckFailures >= this.config.maxRetries) {
              // Remove unhealthy connection
              pool.delete(connection);
              await this.closeConnection(connection);

              this.eventEmitter.emit(ConnectionPoolEvent.HEALTH_CHECK_FAILED, {
                connectionId: connection.id,
                serverId
              });

              // Create replacement if below minimum
              const stats = this.stats.get(serverId)!;
              if (pool.size < this.config.minConnections) {
                const serverConfig = this.serverConfigs.get(serverId)!;
                await this.createConnection(serverConfig);
              }
            }
          } else {
            connection.healthCheckFailures = 0;
            this.eventEmitter.emit(ConnectionPoolEvent.HEALTH_CHECK_PASSED, {
              connectionId: connection.id,
              serverId
            });
          }
        } catch (error) {
          console.error(`[ConnectionPool] Health check error for ${connection.id}:`, error);
          connection.healthCheckFailures++;
        }
      }
    }
  }

  /**
   * Start idle timer for a connection
   */
  private startIdleTimer(connection: PooledConnection): void {
    const timer = setTimeout(() => {
      // Check if still idle and above minimum connections
      if (!connection.inUse) {
        const pool = this.pools.get(connection.serverConfig.name);
        if (pool && pool.size > this.config.minConnections) {
          pool.delete(connection);
          this.closeConnection(connection);
        }
      }
    }, this.config.idleTimeout);

    this.idleTimers.set(connection.id, timer);
  }

  /**
   * Subscribe to connection pool events
   */
  on(event: ConnectionPoolEvent, handler: (data: any) => void): void {
    this.eventEmitter.on(event, handler);
  }

  /**
   * Unsubscribe from connection pool events
   */
  off(event: ConnectionPoolEvent, handler: (data: any) => void): void {
    this.eventEmitter.off(event, handler);
  }
}