/**
 * Interface Registry - Manage multiple interface instances
 *
 * Central registry for managing different platform interface modules
 */

import {
  Platform,
  UniversalMessage,
  UniversalResponse,
  UMPError,
  UMPErrorType
} from '../../core/protocol/ump-types.ts';

import {
  InterfaceModule,
  InterfaceModuleStatus,
  InterfaceModuleConfig,
  InterfaceModuleMetrics,
  MessageProcessingResult,
  ConnectionInfo
} from './interface-module.ts';

/**
 * Registry configuration
 */
export interface InterfaceRegistryConfig {
  // Module management
  autoStartModules: boolean;
  maxModulesPerPlatform: number;

  // Load balancing
  enableLoadBalancing: boolean;
  loadBalancingStrategy: 'round_robin' | 'priority' | 'least_connections';

  // Health monitoring
  healthCheckInterval: number;
  unhealthyModuleTimeout: number;

  // Failover
  enableFailover: boolean;
  failoverRetryAttempts: number;

  // Logging
  enableLogging: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Registry statistics
 */
export interface RegistryStats {
  totalModules: number;
  activeModules: number;
  modulesByPlatform: Record<Platform, number>;
  modulesByStatus: Record<InterfaceModuleStatus, number>;
  totalConnections: number;
  totalMessages: number;
  averageResponseTime: number;
}

/**
 * Module registration info
 */
interface RegisteredModule {
  module: InterfaceModule;
  registeredAt: Date;
  lastHealthCheck: Date;
  consecutiveFailures: number;
  isHealthy: boolean;
}

/**
 * Main Interface Registry class
 */
export class InterfaceRegistry {
  private config: InterfaceRegistryConfig;
  private modules = new Map<string, RegisteredModule>();
  private platformModules = new Map<Platform, RegisteredModule[]>();
  private healthCheckTimer?: number;
  private loadBalancingCounters = new Map<Platform, number>();

  constructor(config: InterfaceRegistryConfig) {
    this.config = config;
  }

  /**
   * Initialize the registry
   */
  async initialize(): Promise<void> {
    // Start health check timer
    if (this.config.healthCheckInterval > 0) {
      this.startHealthCheckTimer();
    }

    this.log('info', 'Interface Registry initialized');
  }

  /**
   * Shutdown the registry
   */
  async shutdown(): Promise<void> {
    // Stop health check timer
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    // Shutdown all modules
    const shutdownPromises: Promise<void>[] = [];
    for (const registered of this.modules.values()) {
      shutdownPromises.push(registered.module.shutdown());
    }

    await Promise.all(shutdownPromises);

    this.log('info', 'Interface Registry shutdown completed');
  }

  /**
   * Register a new interface module
   */
  async registerModule(module: InterfaceModule): Promise<void> {
    const moduleInfo = module.getModuleInfo();
    const moduleId = `${moduleInfo.platform}_${moduleInfo.name}`;

    // Check if module is already registered
    if (this.modules.has(moduleId)) {
      throw new UMPError(
        `Module ${moduleId} is already registered`,
        UMPErrorType.VALIDATION_ERROR
      );
    }

    // Check platform module limit
    const platformModules = this.platformModules.get(moduleInfo.platform) || [];
    if (platformModules.length >= this.config.maxModulesPerPlatform) {
      throw new UMPError(
        `Maximum modules reached for platform ${moduleInfo.platform}`,
        UMPErrorType.VALIDATION_ERROR
      );
    }

    // Validate module configuration
    const isValid = await module.validateConfig();
    if (!isValid) {
      throw new UMPError(
        `Invalid configuration for module ${moduleId}`,
        UMPErrorType.VALIDATION_ERROR
      );
    }

    // Register module
    const registered: RegisteredModule = {
      module,
      registeredAt: new Date(),
      lastHealthCheck: new Date(),
      consecutiveFailures: 0,
      isHealthy: true
    };

    this.modules.set(moduleId, registered);

    // Add to platform modules
    if (!this.platformModules.has(moduleInfo.platform)) {
      this.platformModules.set(moduleInfo.platform, []);
    }
    this.platformModules.get(moduleInfo.platform)!.push(registered);

    // Auto-start if configured
    if (this.config.autoStartModules && module.isEnabled()) {
      try {
        await module.startListening();
        this.log('info', `Auto-started module ${moduleId}`);
      } catch (error) {
        this.log('error', `Failed to auto-start module ${moduleId}: ${error.message}`);
      }
    }

    this.log('info', `Module ${moduleId} registered successfully`);
  }

  /**
   * Unregister a module
   */
  async unregisterModule(platform: Platform, name: string): Promise<void> {
    const moduleId = `${platform}_${name}`;
    const registered = this.modules.get(moduleId);

    if (!registered) {
      throw new UMPError(
        `Module ${moduleId} not found`,
        UMPErrorType.NOT_FOUND
      );
    }

    // Shutdown module
    await registered.module.shutdown();

    // Remove from registry
    this.modules.delete(moduleId);

    // Remove from platform modules
    const platformModules = this.platformModules.get(platform);
    if (platformModules) {
      const index = platformModules.indexOf(registered);
      if (index > -1) {
        platformModules.splice(index, 1);
      }
    }

    this.log('info', `Module ${moduleId} unregistered`);
  }

  /**
   * Get a module for processing a message
   */
  getModuleForMessage(platform: Platform): InterfaceModule | null {
    const platformModules = this.getHealthyModules(platform);

    if (platformModules.length === 0) {
      return null;
    }

    if (!this.config.enableLoadBalancing || platformModules.length === 1) {
      return platformModules[0];
    }

    // Apply load balancing strategy
    switch (this.config.loadBalancingStrategy) {
      case 'round_robin':
        return this.selectRoundRobin(platform, platformModules);
      case 'priority':
        return this.selectByPriority(platformModules);
      case 'least_connections':
        return this.selectLeastConnections(platformModules);
      default:
        return platformModules[0];
    }
  }

  /**
   * Get all modules for a platform
   */
  getModulesByPlatform(platform: Platform): InterfaceModule[] {
    const platformModules = this.platformModules.get(platform) || [];
    return platformModules.map(registered => registered.module);
  }

  /**
   * Get all registered modules
   */
  getAllModules(): InterfaceModule[] {
    return Array.from(this.modules.values()).map(registered => registered.module);
  }

  /**
   * Get healthy modules for a platform
   */
  getHealthyModules(platform: Platform): InterfaceModule[] {
    const platformModules = this.platformModules.get(platform) || [];
    return platformModules
      .filter(registered =>
        registered.isHealthy &&
        registered.module.isEnabled() &&
        registered.module.getStatus() === InterfaceModuleStatus.ACTIVE
      )
      .map(registered => registered.module);
  }

  /**
   * Enable all modules for a platform
   */
  async enablePlatform(platform: Platform): Promise<void> {
    const modules = this.getModulesByPlatform(platform);
    const enablePromises = modules.map(module => module.enable());
    await Promise.all(enablePromises);
    this.log('info', `Enabled all modules for platform ${platform}`);
  }

  /**
   * Disable all modules for a platform
   */
  async disablePlatform(platform: Platform): Promise<void> {
    const modules = this.getModulesByPlatform(platform);
    const disablePromises = modules.map(module => module.disable());
    await Promise.all(disablePromises);
    this.log('info', `Disabled all modules for platform ${platform}`);
  }

  /**
   * Get registry statistics
   */
  getStats(): RegistryStats {
    const modulesByPlatform: Record<Platform, number> = {} as Record<Platform, number>;
    const modulesByStatus: Record<InterfaceModuleStatus, number> = {} as Record<InterfaceModuleStatus, number>;

    let totalConnections = 0;
    let totalMessages = 0;
    let totalResponseTime = 0;
    let activeModules = 0;

    // Initialize counters
    Object.values(Platform).forEach(platform => {
      modulesByPlatform[platform] = 0;
    });
    Object.values(InterfaceModuleStatus).forEach(status => {
      modulesByStatus[status] = 0;
    });

    // Collect statistics
    for (const registered of this.modules.values()) {
      const module = registered.module;
      const moduleInfo = module.getModuleInfo();
      const metrics = module.getMetrics();

      modulesByPlatform[moduleInfo.platform]++;
      modulesByStatus[moduleInfo.status]++;

      if (moduleInfo.status === InterfaceModuleStatus.ACTIVE) {
        activeModules++;
      }

      totalConnections += metrics.activeConnections;
      totalMessages += metrics.totalMessages;
      totalResponseTime += metrics.averageResponseTime;
    }

    const averageResponseTime = this.modules.size > 0 ? totalResponseTime / this.modules.size : 0;

    return {
      totalModules: this.modules.size,
      activeModules,
      modulesByPlatform,
      modulesByStatus,
      totalConnections,
      totalMessages,
      averageResponseTime
    };
  }

  /**
   * Perform health checks on all modules
   */
  async performHealthChecks(): Promise<void> {
    const healthCheckPromises: Promise<void>[] = [];

    for (const [moduleId, registered] of this.modules.entries()) {
      healthCheckPromises.push(this.checkModuleHealth(moduleId, registered));
    }

    await Promise.all(healthCheckPromises);
  }

  /**
   * Check health of a specific module
   */
  private async checkModuleHealth(moduleId: string, registered: RegisteredModule): Promise<void> {
    try {
      const healthStatus = await registered.module.getHealthStatus();
      const isHealthy = healthStatus.status === 'healthy';

      if (isHealthy) {
        registered.consecutiveFailures = 0;
        registered.isHealthy = true;
      } else {
        registered.consecutiveFailures++;

        if (registered.consecutiveFailures >= this.config.failoverRetryAttempts) {
          registered.isHealthy = false;
          this.log('warn', `Module ${moduleId} marked as unhealthy after ${registered.consecutiveFailures} failures`);
        }
      }

      registered.lastHealthCheck = new Date();

    } catch (error) {
      registered.consecutiveFailures++;
      this.log('error', `Health check failed for module ${moduleId}: ${error.message}`);

      if (registered.consecutiveFailures >= this.config.failoverRetryAttempts) {
        registered.isHealthy = false;
      }
    }
  }

  /**
   * Round robin selection
   */
  private selectRoundRobin(platform: Platform, modules: InterfaceModule[]): InterfaceModule {
    const counter = this.loadBalancingCounters.get(platform) || 0;
    const selectedIndex = counter % modules.length;
    this.loadBalancingCounters.set(platform, counter + 1);
    return modules[selectedIndex];
  }

  /**
   * Priority-based selection (highest priority first)
   */
  private selectByPriority(modules: InterfaceModule[]): InterfaceModule {
    return modules.sort((a, b) => b.getModuleInfo().priority - a.getModuleInfo().priority)[0];
  }

  /**
   * Least connections selection
   */
  private selectLeastConnections(modules: InterfaceModule[]): InterfaceModule {
    return modules.sort((a, b) =>
      a.getMetrics().activeConnections - b.getMetrics().activeConnections
    )[0];
  }

  /**
   * Start health check timer
   */
  private startHealthCheckTimer(): void {
    this.healthCheckTimer = setInterval(async () => {
      try {
        await this.performHealthChecks();
      } catch (error) {
        this.log('error', `Health check timer error: ${error.message}`);
      }
    }, this.config.healthCheckInterval);

    this.log('info', `Started health check timer with interval ${this.config.healthCheckInterval}ms`);
  }

  /**
   * Log message
   */
  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
    if (!this.config.enableLogging) {
      return;
    }

    const levels = ['debug', 'info', 'warn', 'error'];
    const configLevelIndex = levels.indexOf(this.config.logLevel);
    const messageLevelIndex = levels.indexOf(level);

    if (messageLevelIndex >= configLevelIndex) {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] [${level.toUpperCase()}] [InterfaceRegistry] ${message}`);
    }
  }
}

/**
 * Create default configuration for Interface Registry
 */
export function createDefaultInterfaceRegistryConfig(): InterfaceRegistryConfig {
  return {
    autoStartModules: true,
    maxModulesPerPlatform: 5,
    enableLoadBalancing: true,
    loadBalancingStrategy: 'round_robin',
    healthCheckInterval: 30000, // 30 seconds
    unhealthyModuleTimeout: 60000, // 1 minute
    enableFailover: true,
    failoverRetryAttempts: 3,
    enableLogging: true,
    logLevel: 'info'
  };
}

/**
 * Interface Registry factory
 */
export class InterfaceRegistryFactory {
  /**
   * Create Interface Registry with default configuration
   */
  static create(config?: Partial<InterfaceRegistryConfig>): InterfaceRegistry {
    const defaultConfig = createDefaultInterfaceRegistryConfig();
    const finalConfig = { ...defaultConfig, ...config };

    return new InterfaceRegistry(finalConfig);
  }
}