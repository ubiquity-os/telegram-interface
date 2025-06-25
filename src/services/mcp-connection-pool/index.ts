/**
 * MCP Connection Pool Module Exports
 */

export { ConnectionPool } from './connection-pool.ts';
export type {
  IConnectionPool,
  ConnectionPoolConfig,
  PooledConnection,
  PoolStats,
  ConnectionRequest,
  ConnectionPoolEvent,
  CircuitBreakerState
} from './types.ts';
export { ConnectionPoolEvent as ConnectionPoolEventEnum } from './types.ts';