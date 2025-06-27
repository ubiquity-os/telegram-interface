/**
 * Interface Module Base - Abstract base interface contract
 *
 * Defines the contract that all platform interface modules must implement
 */

import {
  UniversalMessage,
  UniversalResponse,
  Platform,
  Session,
  UMPError,
  UMPErrorType
} from '../../core/protocol/ump-types.ts';

/**
 * Interface module status
 */
export enum InterfaceModuleStatus {
  INITIALIZING = 'initializing',
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  ERROR = 'error'
}

/**
 * Interface module configuration
 */
export interface InterfaceModuleConfig {
  platform: Platform;
  name: string;
  enabled: boolean;
  priority: number; // Higher number = higher priority
  maxConcurrentConnections: number;
  timeout: number;
  retryAttempts: number;
  authentication?: {
    required: boolean;
    type: 'api_key' | 'oauth' | 'webhook_signature';
    config: Record<string, any>;
  };
  rateLimit?: {
    enabled: boolean;
    requestsPerMinute: number;
    burstLimit: number;
  };
  logging?: {
    enabled: boolean;
    level: 'debug' | 'info' | 'warn' | 'error';
  };
}

/**
 * Interface module metrics
 */
export interface InterfaceModuleMetrics {
  totalMessages: number;
  successfulMessages: number;
  failedMessages: number;
  averageResponseTime: number;
  activeConnections: number;
  errorRate: number;
  lastActivity: Date;
}

/**
 * Message processing result
 */
export interface MessageProcessingResult {
  success: boolean;
  response?: UniversalResponse;
  error?: UMPError;
  processingTime: number;
  metadata: Record<string, any>;
}

/**
 * Connection info for tracking active connections
 */
export interface ConnectionInfo {
  id: string;
  sessionId: string;
  userId: string;
  platform: Platform;
  connectedAt: Date;
  lastActivity: Date;
  metadata: Record<string, any>;
}

/**
 * Abstract base class for all interface modules
 */
export abstract class InterfaceModule {
  protected config: InterfaceModuleConfig;
  protected status: InterfaceModuleStatus = InterfaceModuleStatus.INITIALIZING;
  protected metrics: InterfaceModuleMetrics;
  protected activeConnections = new Map<string, ConnectionInfo>();
  protected startTime = Date.now();

  constructor(config: InterfaceModuleConfig) {
    this.config = config;
    this.metrics = {
      totalMessages: 0,
      successfulMessages: 0,
      failedMessages: 0,
      averageResponseTime: 0,
      activeConnections: 0,
      errorRate: 0,
      lastActivity: new Date()
    };
  }

  /**
   * Initialize the interface module
   */
  abstract initialize(): Promise<void>;

  /**
   * Shutdown the interface module
   */
  abstract shutdown(): Promise<void>;

  /**
   * Process an incoming message
   */
  abstract processMessage(
    rawMessage: any,
    connectionInfo?: ConnectionInfo
  ): Promise<MessageProcessingResult>;

  /**
   * Send a response back through this interface
   */
  abstract sendResponse(
    response: UniversalResponse,
    connectionInfo: ConnectionInfo
  ): Promise<void>;

  /**
   * Start listening for incoming messages
   */
  abstract startListening(): Promise<void>;

  /**
   * Stop listening for incoming messages
   */
  abstract stopListening(): Promise<void>;

  /**
   * Validate configuration
   */
  abstract validateConfig(): Promise<boolean>;

  /**
   * Get platform-specific health status
   */
  abstract getHealthStatus(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    details: Record<string, any>;
  }>;

  /**
   * Get module information
   */
  getModuleInfo(): {
    platform: Platform;
    name: string;
    status: InterfaceModuleStatus;
    enabled: boolean;
    priority: number;
    uptime: number;
  } {
    return {
      platform: this.config.platform,
      name: this.config.name,
      status: this.status,
      enabled: this.config.enabled,
      priority: this.config.priority,
      uptime: Date.now() - this.startTime
    };
  }

  /**
   * Get current metrics
   */
  getMetrics(): InterfaceModuleMetrics {
    this.metrics.activeConnections = this.activeConnections.size;
    this.metrics.errorRate = this.metrics.totalMessages > 0
      ? (this.metrics.failedMessages / this.metrics.totalMessages) * 100
      : 0;

    return { ...this.metrics };
  }

  /**
   * Get active connections
   */
  getActiveConnections(): ConnectionInfo[] {
    return Array.from(this.activeConnections.values());
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<InterfaceModuleConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.log('info', `Configuration updated for ${this.config.name}`);
  }

  /**
   * Enable the module
   */
  async enable(): Promise<void> {
    this.config.enabled = true;
    if (this.status === InterfaceModuleStatus.INACTIVE) {
      await this.startListening();
    }
    this.log('info', `Module ${this.config.name} enabled`);
  }

  /**
   * Disable the module
   */
  async disable(): Promise<void> {
    this.config.enabled = false;
    if (this.status === InterfaceModuleStatus.ACTIVE) {
      await this.stopListening();
    }
    this.log('info', `Module ${this.config.name} disabled`);
  }

  /**
   * Check if module is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get current status
   */
  getStatus(): InterfaceModuleStatus {
    return this.status;
  }

  /**
   * Set module status
   */
  protected setStatus(status: InterfaceModuleStatus): void {
    const oldStatus = this.status;
    this.status = status;

    if (oldStatus !== status) {
      this.log('info', `Status changed from ${oldStatus} to ${status}`);
    }
  }

  /**
   * Register a new connection
   */
  protected registerConnection(connectionInfo: ConnectionInfo): void {
    this.activeConnections.set(connectionInfo.id, connectionInfo);
    this.metrics.activeConnections = this.activeConnections.size;
    this.log('debug', `Connection registered: ${connectionInfo.id}`);
  }

  /**
   * Unregister a connection
   */
  protected unregisterConnection(connectionId: string): void {
    this.activeConnections.delete(connectionId);
    this.metrics.activeConnections = this.activeConnections.size;
    this.log('debug', `Connection unregistered: ${connectionId}`);
  }

  /**
   * Update connection activity
   */
  protected updateConnectionActivity(connectionId: string): void {
    const connection = this.activeConnections.get(connectionId);
    if (connection) {
      connection.lastActivity = new Date();
    }
  }

  /**
   * Update processing metrics
   */
  protected updateMetrics(success: boolean, processingTime: number): void {
    this.metrics.totalMessages++;
    this.metrics.lastActivity = new Date();

    if (success) {
      this.metrics.successfulMessages++;
      this.updateAverageResponseTime(processingTime);
    } else {
      this.metrics.failedMessages++;
    }
  }

  /**
   * Update average response time
   */
  private updateAverageResponseTime(newTime: number): void {
    const totalSuccessful = this.metrics.successfulMessages;
    if (totalSuccessful === 1) {
      this.metrics.averageResponseTime = newTime;
    } else {
      this.metrics.averageResponseTime =
        ((this.metrics.averageResponseTime * (totalSuccessful - 1)) + newTime) / totalSuccessful;
    }
  }

  /**
   * Check rate limits
   */
  protected checkRateLimit(connectionId: string): boolean {
    if (!this.config.rateLimit?.enabled) {
      return true;
    }

    // Simplified rate limiting - in production, you'd want more sophisticated tracking
    return true; // Always allow for now
  }

  /**
   * Authenticate request
   */
  protected authenticateRequest(request: any): Promise<boolean> {
    if (!this.config.authentication?.required) {
      return Promise.resolve(true);
    }

    // Implementation depends on authentication type
    // This is a placeholder that should be overridden by concrete implementations
    return Promise.resolve(false);
  }

  /**
   * Log message
   */
  protected log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
    if (!this.config.logging?.enabled) {
      return;
    }

    const levels = ['debug', 'info', 'warn', 'error'];
    const configLevel = this.config.logging.level || 'info';
    const configLevelIndex = levels.indexOf(configLevel);
    const messageLevelIndex = levels.indexOf(level);

    if (messageLevelIndex >= configLevelIndex) {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] [${level.toUpperCase()}] [${this.config.name}] ${message}`);
    }
  }

  /**
   * Create error result
   */
  protected createErrorResult(
    error: Error | UMPError,
    processingTime: number
  ): MessageProcessingResult {
    const umpError = error instanceof UMPError ? error : new UMPError(
      error.message,
      UMPErrorType.CONVERSION_FAILED,
      this.config.platform,
      error
    );

    return {
      success: false,
      error: umpError,
      processingTime,
      metadata: {
        platform: this.config.platform,
        module: this.config.name,
        timestamp: new Date().toISOString()
      }
    };
  }

  /**
   * Create success result
   */
  protected createSuccessResult(
    response: UniversalResponse,
    processingTime: number
  ): MessageProcessingResult {
    return {
      success: true,
      response,
      processingTime,
      metadata: {
        platform: this.config.platform,
        module: this.config.name,
        timestamp: new Date().toISOString()
      }
    };
  }
}

/**
 * Default configuration for interface modules
 */
export function createDefaultInterfaceConfig(
  platform: Platform,
  name: string
): InterfaceModuleConfig {
  return {
    platform,
    name,
    enabled: true,
    priority: 1,
    maxConcurrentConnections: 100,
    timeout: 30000,
    retryAttempts: 3,
    authentication: {
      required: false,
      type: 'api_key',
      config: {}
    },
    rateLimit: {
      enabled: true,
      requestsPerMinute: 100,
      burstLimit: 10
    },
    logging: {
      enabled: true,
      level: 'info'
    }
  };
}