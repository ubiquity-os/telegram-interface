/**
 * Admin Service - Health checks and metrics
 *
 * Provides administrative functionality for monitoring and managing the system
 */

import {
  Platform,
  Session,
  SessionState,
  UMPError,
  UMPErrorType
} from '../core/protocol/ump-types.ts';

import { MessageService } from './message-service.ts';
import { ToolService } from './tool-service.ts';
import { SessionManager } from '../core/session-manager.ts';

/**
 * System health status
 */
export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  components: ComponentHealth[];
  metrics: SystemMetrics;
}

/**
 * Component health status
 */
export interface ComponentHealth {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  lastCheck: string;
  responseTime?: number;
  errorCount?: number;
  details?: Record<string, any>;
}

/**
 * System metrics
 */
export interface SystemMetrics {
  messages: {
    total: number;
    successful: number;
    failed: number;
    averageProcessingTime: number;
    byPlatform: Record<string, number>;
  };
  sessions: {
    total: number;
    active: number;
    byPlatform: Record<string, number>;
    averageSessionAge: number;
  };
  tools: {
    totalExecutions: number;
    activeExecutions: number;
    executionsByUser: Record<string, number>;
  };
  system: {
    memoryUsage?: number;
    cpuUsage?: number;
    diskUsage?: number;
  };
}

/**
 * Admin Service Configuration
 */
export interface AdminServiceConfig {
  healthCheckInterval: number;
  metricsRetentionHours: number;
  enableAlerts: boolean;
  alertThresholds: {
    errorRate: number; // Percentage
    responseTime: number; // Milliseconds
    memoryUsage: number; // Percentage
  };
  enableLogging: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Main Admin Service class
 */
export class AdminService {
  private config: AdminServiceConfig;
  private messageService: MessageService;
  private toolService: ToolService;
  private sessionManager: SessionManager;
  private startTime = Date.now();
  private healthCheckTimer?: number;
  private lastHealthCheck?: SystemHealth;

  constructor(
    config: AdminServiceConfig,
    messageService: MessageService,
    toolService: ToolService,
    sessionManager: SessionManager
  ) {
    this.config = config;
    this.messageService = messageService;
    this.toolService = toolService;
    this.sessionManager = sessionManager;
  }

  /**
   * Initialize the admin service
   */
  async initialize(): Promise<void> {
    // Start periodic health checks
    if (this.config.healthCheckInterval > 0) {
      this.startHealthCheckTimer();
    }

    // Perform initial health check
    this.lastHealthCheck = await this.performHealthCheck();

    this.log('info', 'Admin Service initialized');
  }

  /**
   * Shutdown the admin service
   */
  async shutdown(): Promise<void> {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
    this.log('info', 'Admin Service shutdown');
  }

  /**
   * Get current system health
   */
  async getSystemHealth(): Promise<SystemHealth> {
    if (!this.lastHealthCheck || this.shouldRefreshHealthCheck()) {
      this.lastHealthCheck = await this.performHealthCheck();
    }
    return this.lastHealthCheck;
  }

  /**
   * Get system metrics
   */
  async getSystemMetrics(): Promise<SystemMetrics> {
    const messageStats = this.messageService.getStats();
    const toolStats = this.toolService.getExecutionStats();
    const sessionStats = await this.sessionManager.getSessionStats();

    return {
      messages: {
        total: messageStats.totalMessages,
        successful: messageStats.successfulMessages,
        failed: messageStats.failedMessages,
        averageProcessingTime: messageStats.averageProcessingTime,
        byPlatform: messageStats.messagesByPlatform
      },
      sessions: {
        total: sessionStats.totalSessions,
        active: sessionStats.activeSessions,
        byPlatform: sessionStats.sessionsByPlatform,
        averageSessionAge: sessionStats.averageSessionAge
      },
      tools: {
        totalExecutions: toolStats.totalExecutions,
        activeExecutions: toolStats.activeExecutions,
        executionsByUser: toolStats.executionsByUser
      },
      system: {
        memoryUsage: await this.getMemoryUsage(),
        cpuUsage: await this.getCpuUsage(),
        diskUsage: await this.getDiskUsage()
      }
    };
  }

  /**
   * Get available tools summary
   */
  async getToolsSummary(): Promise<{
    totalTools: number;
    availableTools: string[];
    toolCategories: Record<string, string[]>;
  }> {
    try {
      const tools = await this.toolService.getAvailableTools();

      // Group tools by category (based on serverId)
      const toolCategories: Record<string, string[]> = {};
      const availableTools: string[] = [];

      for (const tool of tools) {
        availableTools.push(tool.name);

        if (!toolCategories[tool.serverId]) {
          toolCategories[tool.serverId] = [];
        }
        toolCategories[tool.serverId].push(tool.name);
      }

      return {
        totalTools: tools.length,
        availableTools,
        toolCategories
      };
    } catch (error) {
      this.log('error', `Failed to get tools summary: ${error.message}`);
      return {
        totalTools: 0,
        availableTools: [],
        toolCategories: {}
      };
    }
  }

  /**
   * Reset system statistics
   */
  async resetStatistics(): Promise<void> {
    this.messageService.resetStats();
    // Note: ToolService and SessionManager don't have reset methods in current implementation
    this.log('info', 'System statistics reset');
  }

  /**
   * Perform comprehensive health check
   */
  private async performHealthCheck(): Promise<SystemHealth> {
    const startTime = Date.now();
    const components: ComponentHealth[] = [];

    // Check message service
    try {
      const messageStats = this.messageService.getStats();
      const errorRate = messageStats.totalMessages > 0 ?
        (messageStats.failedMessages / messageStats.totalMessages) * 100 : 0;

      components.push({
        name: 'MessageService',
        status: errorRate > this.config.alertThresholds.errorRate ? 'degraded' : 'healthy',
        lastCheck: new Date().toISOString(),
        responseTime: messageStats.averageProcessingTime,
        errorCount: messageStats.failedMessages,
        details: {
          totalMessages: messageStats.totalMessages,
          errorRate: Math.round(errorRate * 100) / 100
        }
      });
    } catch (error) {
      components.push({
        name: 'MessageService',
        status: 'unhealthy',
        lastCheck: new Date().toISOString(),
        details: { error: error.message }
      });
    }

    // Check tool service
    try {
      const toolStats = this.toolService.getExecutionStats();
      components.push({
        name: 'ToolService',
        status: 'healthy',
        lastCheck: new Date().toISOString(),
        details: {
          totalExecutions: toolStats.totalExecutions,
          activeExecutions: toolStats.activeExecutions
        }
      });
    } catch (error) {
      components.push({
        name: 'ToolService',
        status: 'unhealthy',
        lastCheck: new Date().toISOString(),
        details: { error: error.message }
      });
    }

    // Check session manager
    try {
      const sessionStats = await this.sessionManager.getSessionStats();
      components.push({
        name: 'SessionManager',
        status: 'healthy',
        lastCheck: new Date().toISOString(),
        details: {
          totalSessions: sessionStats.totalSessions,
          activeSessions: sessionStats.activeSessions
        }
      });
    } catch (error) {
      components.push({
        name: 'SessionManager',
        status: 'unhealthy',
        lastCheck: new Date().toISOString(),
        details: { error: error.message }
      });
    }

    // Determine overall system status
    const unhealthyComponents = components.filter(c => c.status === 'unhealthy').length;
    const degradedComponents = components.filter(c => c.status === 'degraded').length;

    let overallStatus: 'healthy' | 'degraded' | 'unhealthy';
    if (unhealthyComponents > 0) {
      overallStatus = 'unhealthy';
    } else if (degradedComponents > 0) {
      overallStatus = 'degraded';
    } else {
      overallStatus = 'healthy';
    }

    const metrics = await this.getSystemMetrics();
    const healthCheckTime = Date.now() - startTime;

    const health: SystemHealth = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.startTime,
      version: '1.0.0',
      components,
      metrics
    };

    this.log('debug', `Health check completed in ${healthCheckTime}ms - Status: ${overallStatus}`);

    return health;
  }

  /**
   * Check if health check should be refreshed
   */
  private shouldRefreshHealthCheck(): boolean {
    if (!this.lastHealthCheck) {
      return true;
    }

    const lastCheckTime = new Date(this.lastHealthCheck.timestamp).getTime();
    const timeSinceLastCheck = Date.now() - lastCheckTime;

    // Refresh if more than 30 seconds have passed
    return timeSinceLastCheck > 30000;
  }

  /**
   * Start health check timer
   */
  private startHealthCheckTimer(): void {
    this.healthCheckTimer = setInterval(async () => {
      try {
        this.lastHealthCheck = await this.performHealthCheck();

        // Check for alerts
        if (this.config.enableAlerts) {
          await this.checkAlerts(this.lastHealthCheck);
        }
      } catch (error) {
        this.log('error', `Health check timer error: ${error.message}`);
      }
    }, this.config.healthCheckInterval);

    this.log('info', `Started health check timer with interval ${this.config.healthCheckInterval}ms`);
  }

  /**
   * Check for system alerts
   */
  private async checkAlerts(health: SystemHealth): Promise<void> {
    const alerts: string[] = [];

    // Check error rate
    const errorRate = health.metrics.messages.total > 0 ?
      (health.metrics.messages.failed / health.metrics.messages.total) * 100 : 0;

    if (errorRate > this.config.alertThresholds.errorRate) {
      alerts.push(`High error rate: ${errorRate.toFixed(2)}%`);
    }

    // Check response time
    if (health.metrics.messages.averageProcessingTime > this.config.alertThresholds.responseTime) {
      alerts.push(`High response time: ${health.metrics.messages.averageProcessingTime}ms`);
    }

    // Check memory usage
    if (health.metrics.system.memoryUsage &&
        health.metrics.system.memoryUsage > this.config.alertThresholds.memoryUsage) {
      alerts.push(`High memory usage: ${health.metrics.system.memoryUsage}%`);
    }

    // Log alerts
    if (alerts.length > 0) {
      this.log('warn', `System alerts: ${alerts.join(', ')}`);
    }
  }

  /**
   * Get memory usage (simplified for Deno)
   */
  private async getMemoryUsage(): Promise<number | undefined> {
    try {
      // In Deno, we can get memory usage from Deno.memoryUsage()
      if (typeof Deno !== 'undefined' && Deno.memoryUsage) {
        const memory = Deno.memoryUsage();
        // Return as percentage (simplified calculation)
        return Math.round((memory.heapUsed / memory.heapTotal) * 100);
      }
    } catch (error) {
      this.log('debug', `Could not get memory usage: ${error.message}`);
    }
    return undefined;
  }

  /**
   * Get CPU usage (placeholder - not easily available in Deno)
   */
  private async getCpuUsage(): Promise<number | undefined> {
    // CPU usage is not easily available in Deno without external tools
    return undefined;
  }

  /**
   * Get disk usage (placeholder - not easily available in Deno)
   */
  private async getDiskUsage(): Promise<number | undefined> {
    // Disk usage is not easily available in Deno without external tools
    return undefined;
  }

  /**
   * Logging utility
   */
  private log(level: string, message: string): void {
    if (!this.config.enableLogging) {
      return;
    }

    const levels = ['debug', 'info', 'warn', 'error'];
    const configLevelIndex = levels.indexOf(this.config.logLevel);
    const messageLevelIndex = levels.indexOf(level);

    if (messageLevelIndex >= configLevelIndex) {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] [${level.toUpperCase()}] [AdminService] ${message}`);
    }
  }
}

/**
 * Create default configuration for Admin Service
 */
export function createDefaultAdminServiceConfig(): AdminServiceConfig {
  return {
    healthCheckInterval: 60000, // 1 minute
    metricsRetentionHours: 24,
    enableAlerts: true,
    alertThresholds: {
      errorRate: 5, // 5%
      responseTime: 5000, // 5 seconds
      memoryUsage: 80 // 80%
    },
    enableLogging: true,
    logLevel: 'info'
  };
}

/**
 * Admin Service factory
 */
export class AdminServiceFactory {
  /**
   * Create Admin Service with dependencies
   */
  static create(
    messageService: MessageService,
    toolService: ToolService,
    sessionManager: SessionManager,
    config?: Partial<AdminServiceConfig>
  ): AdminService {
    const defaultConfig = createDefaultAdminServiceConfig();
    const finalConfig = { ...defaultConfig, ...config };

    return new AdminService(finalConfig, messageService, toolService, sessionManager);
  }
}