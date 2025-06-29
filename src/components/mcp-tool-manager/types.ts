/**
 * MCP Tool Manager Types
 *
 * Defines interfaces and types for the external MCP tool management system
 */

/**
 * MCP Server configuration
 */
export interface MCPServerConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  transport: 'stdio' | 'http';
  enabled: boolean;
  timeout?: number;
  maxRetries?: number;
}

/**
 * Tool definition from MCP server
 */
export interface ToolDefinition {
  serverId: string;
  name: string;
  description: string;
  inputSchema: any;
  outputSchema?: any;
  version?: string;
  lastModified?: Date;
  healthStatus?: 'healthy' | 'degraded' | 'unhealthy';
  deprecationNotice?: string;
}

/**
 * Tool call request
 */
export interface ToolCall {
  toolId: string;
  serverId: string;
  arguments: Record<string, any>;
  requestId?: string;
}

/**
 * Tool execution result
 */
export interface ToolResult {
  toolId: string;
  success: boolean;
  output?: any;
  error?: string;
  executionTime?: number;
}

/**
 * MCP Protocol message types
 */
export interface MCPRequest {
  jsonrpc: "2.0";
  method: string;
  params?: any;
  id: string | number;
}

export interface MCPResponse {
  jsonrpc: "2.0";
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
  id: string | number;
}

/**
 * MCP Tool request/response
 */
export interface MCPToolRequest extends MCPRequest {
  method: "tools/call";
  params: {
    name: string;
    arguments: any;
  };
}

export interface MCPToolResponse extends MCPResponse {
  result?: {
    content: Array<{
      type: "text" | "image" | "resource";
      text?: string;
      data?: any;
    }>;
  };
}

/**
 * Server status information
 */
export interface ServerStatus {
  serverId: string;
  status: 'connected' | 'disconnected' | 'error' | 'connecting';
  lastConnected?: Date;
  lastError?: string;
  toolCount: number;
  responseTime?: number;
}

/**
 * Tool registry entry
 */
export interface ToolRegistryEntry {
  definition: ToolDefinition;
  lastUsed?: Date;
  usageCount: number;
  averageExecutionTime?: number;
  healthCheckHistory?: HealthCheckResult[];
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  timestamp: Date;
  status: 'healthy' | 'degraded' | 'unhealthy';
  responseTime?: number;
  error?: string;
  details?: Record<string, any>;
}

/**
 * Tool registry refresh configuration
 */
export interface RegistryRefreshConfig {
  intervalMs: number;
  enableAutoRefresh: boolean;
  healthCheckIntervalMs: number;
  maxHealthCheckHistory: number;
  deprecationWarningDays: number;
}

/**
 * Tool version comparison result
 */
export interface VersionComparisonResult {
  toolId: string;
  currentVersion?: string;
  newVersion?: string;
  isNewer: boolean;
  isCompatible: boolean;
  changeType: 'major' | 'minor' | 'patch' | 'unknown';
}

/**
 * Registry health status
 */
export interface RegistryHealthStatus {
  overallHealth: 'healthy' | 'degraded' | 'unhealthy';
  totalTools: number;
  healthyTools: number;
  degradedTools: number;
  unhealthyTools: number;
  lastHealthCheck: Date;
  healthTrends: {
    improving: number;
    stable: number;
    degrading: number;
  };
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
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeout: number;
  halfOpenMaxCalls: number;
}

/**
 * Circuit breaker status
 */
export interface CircuitBreakerStatus {
  state: CircuitBreakerState;
  failureCount: number;
  lastFailureTime?: Date;
  nextRetryTime?: Date;
}

/**
 * MCP client interface for different transports
 */
export interface IMCPClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendRequest(request: MCPRequest): Promise<MCPResponse>;
  isConnected(): boolean;
  getStatus(): ServerStatus;
}

/**
 * Tool change event
 */
export interface ToolChangeEvent {
  type: 'added' | 'updated' | 'removed' | 'version_changed';
  toolId: string;
  serverId: string;
  oldDefinition?: ToolDefinition;
  newDefinition?: ToolDefinition;
  timestamp: Date;
}

/**
 * Tool availability event
 */
export interface ToolAvailabilityEvent {
  serverId: string;
  available: boolean;
  previousState: boolean;
  timestamp: Date;
  error?: string;
}

/**
 * Tool discovery configuration
 */
export interface ToolDiscoveryConfig {
  discoveryInterval: number; // milliseconds, default 60000 (1 minute)
  availabilityCheckInterval: number; // milliseconds, default 30000 (30 seconds)
  enableRealTimeEvents: boolean; // default true
  maxRetries: number; // default 3
  retryDelay: number; // milliseconds, default 5000
}

/**
 * Tool Discovery Service interface
 */
export interface IToolDiscoveryService {
  // Discovery operations
  startPeriodicDiscovery(interval: number): void;
  stopPeriodicDiscovery(): void;
  discoverToolsNow(): Promise<ToolChangeEvent[]>;

  // Event system
  onToolChange(callback: (change: ToolChangeEvent) => void): void;
  onToolAvailabilityChange(callback: (event: ToolAvailabilityEvent) => void): void;

  // Server discovery
  discoverNewServers(): Promise<MCPServerConfig[]>;
  monitorServerAvailability(): Promise<Map<string, boolean>>;

  // Configuration
  configure(config: ToolDiscoveryConfig): void;
  getConfiguration(): ToolDiscoveryConfig;
}

/**
 * MCP Tool Manager interface
 */
export interface IMCPToolManager {
  // Lifecycle
  initializeWithConfigs(configs: MCPServerConfig[]): Promise<void>;
  shutdown(): Promise<void>;

  // Discovery
  getAvailableTools(): Promise<ToolDefinition[]>;
  getToolDefinition(toolId: string): Promise<ToolDefinition | null>;
  refreshToolRegistry(): Promise<void>;

  // Execution
  executeTool(call: ToolCall): Promise<ToolResult>;
  executeMultipleTools(calls: ToolCall[]): Promise<ToolResult[]>;

  // Health monitoring
  getServerStatus(serverId: string): Promise<ServerStatus>;
  getAllServerStatuses(): Promise<ServerStatus[]>;

  // Circuit breaker
  getCircuitBreakerStatus(serverId: string): CircuitBreakerStatus;

  // Tool format conversion
  generateSystemPromptTools(): string;
}