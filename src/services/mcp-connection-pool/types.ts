/**
 * MCP Connection Pool Types
 */

import { MCPStdioClient } from '../../components/mcp-tool-manager/mcp-client.ts';
import { MCPServerConfig } from '../../components/mcp-tool-manager/types.ts';

/**
 * Connection pool configuration
 */
export interface ConnectionPoolConfig {
  minConnections: number;
  maxConnections: number;
  idleTimeout: number; // ms
  connectionTimeout: number; // ms
  healthCheckInterval: number; // ms
  maxRetries: number;
}

/**
 * Pooled connection wrapper
 */
export interface PooledConnection {
  id: string;
  client: MCPStdioClient;
  serverConfig: MCPServerConfig;
  inUse: boolean;
  lastUsed: Date;
  created: Date;
  healthCheckFailures: number;
}

/**
 * Connection pool statistics
 */
export interface PoolStats {
  serverId: string;
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  waitingRequests: number;
  totalRequests: number;
  failedRequests: number;
  averageWaitTime: number;
}

/**
 * Connection request context
 */
export interface ConnectionRequest {
  id: string;
  serverId: string;
  priority: number;
  timestamp: Date;
  timeout: number;
  resolve: (connection: PooledConnection) => void;
  reject: (error: Error) => void;
}

/**
 * Connection pool events
 */
export enum ConnectionPoolEvent {
  CONNECTION_CREATED = 'connection.created',
  CONNECTION_ACQUIRED = 'connection.acquired',
  CONNECTION_RELEASED = 'connection.released',
  CONNECTION_FAILED = 'connection.failed',
  CONNECTION_CLOSED = 'connection.closed',
  POOL_FULL = 'pool.full',
  HEALTH_CHECK_FAILED = 'health.check.failed',
  HEALTH_CHECK_PASSED = 'health.check.passed'
}

/**
 * Circuit breaker states
 */
export enum CircuitBreakerState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half_open'
}

/**
 * Connection pool interface
 */
export interface IConnectionPool {
  /**
   * Initialize pool for a server
   */
  initializeServer(serverConfig: MCPServerConfig): Promise<void>;

  /**
   * Acquire a connection from the pool
   */
  acquire(serverId: string, timeout?: number): Promise<PooledConnection>;

  /**
   * Release a connection back to the pool
   */
  release(connectionId: string): Promise<void>;

  /**
   * Get pool statistics
   */
  getStats(serverId: string): PoolStats | undefined;

  /**
   * Get all pool statistics
   */
  getAllStats(): Map<string, PoolStats>;

  /**
   * Close all connections for a server
   */
  closeServer(serverId: string): Promise<void>;

  /**
   * Close all connections
   */
  closeAll(): Promise<void>;

  /**
   * Check if server has available connections
   */
  hasAvailableConnection(serverId: string): boolean;

  /**
   * Get connection count for server
   */
  getConnectionCount(serverId: string): number;
}