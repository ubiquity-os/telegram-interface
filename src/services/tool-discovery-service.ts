/**
 * Tool Discovery Service Implementation
 *
 * Provides automatic tool discovery and monitoring capabilities for MCP tools
 */

import { IComponent, ComponentStatus } from '../interfaces/component-interfaces.ts';
import {
  IToolDiscoveryService,
  ToolChangeEvent,
  ToolAvailabilityEvent,
  ToolDiscoveryConfig,
  MCPServerConfig,
  ToolDefinition,
  IMCPToolManager,
  ServerStatus,
} from '../components/mcp-tool-manager/types.ts';
import { EventBus, SystemEventType } from '../services/event-bus/index.ts';
import { TelemetryService, LogLevel } from '../services/telemetry/index.ts';
import { ToolRegistry } from '../components/mcp-tool-manager/tool-registry.ts';

/**
 * Tool Discovery Service implementation
 */
export class ToolDiscoveryService implements IComponent, IToolDiscoveryService {
  public readonly name = 'ToolDiscoveryService';

  private mcpToolManager: IMCPToolManager;
  private toolRegistry: ToolRegistry;
  private eventBus: EventBus;
  private telemetry: TelemetryService;

  private config: ToolDiscoveryConfig = {
    discoveryInterval: 60000, // 1 minute
    availabilityCheckInterval: 30000, // 30 seconds
    enableRealTimeEvents: true,
    maxRetries: 3,
    retryDelay: 5000,
  };

  private discoveryTimer?: number;
  private availabilityTimer?: number;
  private isInitialized = false;
  private previousToolStates = new Map<string, ToolDefinition>();
  private previousServerStates = new Map<string, boolean>();

  // Event callbacks
  private toolChangeCallbacks: Array<(change: ToolChangeEvent) => void> = [];
  private availabilityChangeCallbacks: Array<(event: ToolAvailabilityEvent) => void> = [];

  constructor(
    mcpToolManager: IMCPToolManager,
    toolRegistry: ToolRegistry,
    eventBus: EventBus,
    telemetry: TelemetryService,
  ) {
    this.mcpToolManager = mcpToolManager;
    this.toolRegistry = toolRegistry;
    this.eventBus = eventBus;
    this.telemetry = telemetry;
  }

  /**
   * Initialize the service (IComponent interface)
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    const correlationId = await this.telemetry.startTrace('ToolDiscoveryService', 'initialization');

    try {
      await this.telemetry.logStructured({
        level: LogLevel.INFO,
        component: 'ToolDiscoveryService',
        phase: 'initialization',
        message: 'Initializing Tool Discovery Service',
        metadata: { config: this.config },
      });

      // Start periodic discovery if enabled
      if (this.config.discoveryInterval > 0) {
        this.startPeriodicDiscovery(this.config.discoveryInterval);
      }

      // Start availability monitoring if enabled
      if (this.config.availabilityCheckInterval > 0) {
        this.startAvailabilityMonitoring();
      }

      this.isInitialized = true;

      await this.telemetry.logStructured({
        level: LogLevel.INFO,
        component: 'ToolDiscoveryService',
        phase: 'initialization',
        message: 'Tool Discovery Service initialized successfully',
      });

      await this.telemetry.endTrace({ traceId: correlationId, data: { initialized: true } });
    } catch (error) {
      await this.telemetry.endTrace({ traceId: correlationId, error });
      throw error;
    }
  }

  /**
   * Shutdown the service (IComponent interface)
   */
  async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    const correlationId = await this.telemetry.startTrace('ToolDiscoveryService', 'shutdown');

    try {
      await this.telemetry.logStructured({
        level: LogLevel.INFO,
        component: 'ToolDiscoveryService',
        phase: 'shutdown',
        message: 'Shutting down Tool Discovery Service',
      });

      this.stopPeriodicDiscovery();
      this.stopAvailabilityMonitoring();

      // Clear callbacks
      this.toolChangeCallbacks = [];
      this.availabilityChangeCallbacks = [];

      this.isInitialized = false;

      await this.telemetry.logStructured({
        level: LogLevel.INFO,
        component: 'ToolDiscoveryService',
        phase: 'shutdown',
        message: 'Tool Discovery Service shutdown complete',
      });

      await this.telemetry.endTrace({ traceId: correlationId, data: { shutdown: true } });
    } catch (error) {
      await this.telemetry.endTrace({ traceId: correlationId, error });
      throw error;
    }
  }

  /**
   * Get service status (IComponent interface)
   */
  getStatus(): ComponentStatus {
    return {
      name: this.name,
      status: this.isInitialized ? 'healthy' : 'unhealthy',
      lastHealthCheck: new Date(),
      metadata: {
        discoveryActive: !!this.discoveryTimer,
        availabilityMonitoringActive: !!this.availabilityTimer,
        toolChangeCallbacks: this.toolChangeCallbacks.length,
        availabilityCallbacks: this.availabilityChangeCallbacks.length,
        config: this.config,
      },
    };
  }

  /**
   * Start periodic tool discovery (IToolDiscoveryService interface)
   */
  startPeriodicDiscovery(interval: number): void {
    this.stopPeriodicDiscovery();

    this.telemetry.logStructured({
      level: LogLevel.INFO,
      component: 'ToolDiscoveryService',
      phase: 'periodic-discovery',
      message: 'Starting periodic tool discovery',
      metadata: { interval },
    });

    this.discoveryTimer = setInterval(async () => {
      try {
        const changes = await this.discoverToolsNow();
        if (changes.length > 0) {
          this.telemetry.logStructured({
            level: LogLevel.INFO,
            component: 'ToolDiscoveryService',
            phase: 'periodic-discovery',
            message: 'Periodic discovery found changes',
            metadata: { changeCount: changes.length },
          });
        }
      } catch (error) {
        this.telemetry.logStructured({
          level: LogLevel.ERROR,
          component: 'ToolDiscoveryService',
          phase: 'periodic-discovery',
          message: 'Error during periodic discovery',
          metadata: { errorMessage: error instanceof Error ? error.message : String(error) },
          error: error instanceof Error ? error : undefined,
        });
      }
    }, interval) as unknown as number;
  }

  /**
   * Stop periodic tool discovery (IToolDiscoveryService interface)
   */
  stopPeriodicDiscovery(): void {
    if (this.discoveryTimer) {
      clearInterval(this.discoveryTimer);
      this.discoveryTimer = undefined;
      this.telemetry.logStructured({
        level: LogLevel.INFO,
        component: 'ToolDiscoveryService',
        phase: 'periodic-discovery',
        message: 'Stopped periodic tool discovery',
      });
    }
  }

  /**
   * Discover tools now and return changes (IToolDiscoveryService interface)
   */
  async discoverToolsNow(): Promise<ToolChangeEvent[]> {
    const correlationId = await this.telemetry.startTrace('ToolDiscoveryService', 'discovery');

    try {
      await this.telemetry.logStructured({
        level: LogLevel.INFO,
        component: 'ToolDiscoveryService',
        phase: 'discovery',
        message: 'Starting tool discovery',
      });

      // Get current tools from MCP Tool Manager
      const currentTools = await this.mcpToolManager.getAvailableTools();
      const changes: ToolChangeEvent[] = [];
      const currentToolMap = new Map<string, ToolDefinition>();

      // Build current tool map
      for (const tool of currentTools) {
        const toolKey = `${tool.serverId}:${tool.name}`;
        currentToolMap.set(toolKey, tool);
      }

      // Check for new or updated tools
      for (const [toolKey, currentTool] of currentToolMap) {
        const previousTool = this.previousToolStates.get(toolKey);

        if (!previousTool) {
          // New tool added
          const change: ToolChangeEvent = {
            type: 'added',
            toolId: currentTool.name,
            serverId: currentTool.serverId,
            newDefinition: currentTool,
            timestamp: new Date(),
          };
          changes.push(change);
          this.emitToolChange(change);
        } else if (this.hasToolChanged(previousTool, currentTool)) {
          // Tool updated
          const change: ToolChangeEvent = {
            type: currentTool.version !== previousTool.version ? 'version_changed' : 'updated',
            toolId: currentTool.name,
            serverId: currentTool.serverId,
            oldDefinition: previousTool,
            newDefinition: currentTool,
            timestamp: new Date(),
          };
          changes.push(change);
          this.emitToolChange(change);
        }
      }

      // Check for removed tools
      for (const [toolKey, previousTool] of this.previousToolStates) {
        if (!currentToolMap.has(toolKey)) {
          // Tool removed
          const change: ToolChangeEvent = {
            type: 'removed',
            toolId: previousTool.name,
            serverId: previousTool.serverId,
            oldDefinition: previousTool,
            timestamp: new Date(),
          };
          changes.push(change);
          this.emitToolChange(change);
        }
      }

      // Update previous state
      this.previousToolStates = currentToolMap;

      await this.telemetry.logStructured({
        level: LogLevel.INFO,
        component: 'ToolDiscoveryService',
        phase: 'discovery',
        message: 'Tool discovery completed',
        metadata: {
          totalTools: currentTools.length,
          changes: changes.length,
          changeTypes: changes.reduce((acc, change) => {
            acc[change.type] = (acc[change.type] || 0) + 1;
            return acc;
          }, {} as Record<string, number>),
        },
      });

      await this.telemetry.endTrace({ traceId: correlationId, data: changes });
      return changes;
    } catch (error) {
      await this.telemetry.logStructured({
        level: LogLevel.ERROR,
        component: 'ToolDiscoveryService',
        phase: 'discovery',
        message: 'Tool discovery failed',
        metadata: { errorMessage: error instanceof Error ? error.message : String(error) },
        error: error instanceof Error ? error : undefined,
      });
      await this.telemetry.endTrace({ traceId: correlationId, error: error instanceof Error ? error : undefined });
      throw error;
    }
  }

  /**
   * Register tool change callback (IToolDiscoveryService interface)
   */
  onToolChange(callback: (change: ToolChangeEvent) => void): void {
    this.toolChangeCallbacks.push(callback);
  }

  /**
   * Register tool availability change callback (IToolDiscoveryService interface)
   */
  onToolAvailabilityChange(callback: (event: ToolAvailabilityEvent) => void): void {
    this.availabilityChangeCallbacks.push(callback);
  }

  /**
   * Discover new servers (IToolDiscoveryService interface)
   */
  async discoverNewServers(): Promise<MCPServerConfig[]> {
    const correlationId = await this.telemetry.startTrace('ToolDiscoveryService', 'server-discovery');

    try {
      await this.telemetry.logStructured({
        level: LogLevel.INFO,
        component: 'ToolDiscoveryService',
        phase: 'server-discovery',
        message: 'Starting server discovery',
      });

      // For now, return empty array as server discovery would typically
      // involve scanning file system, configuration files, or external APIs
      // This can be extended based on specific discovery requirements
      const newServers: MCPServerConfig[] = [];

      await this.telemetry.logStructured({
        level: LogLevel.INFO,
        component: 'ToolDiscoveryService',
        phase: 'server-discovery',
        message: 'Server discovery completed',
        metadata: { newServers: newServers.length },
      });

      await this.telemetry.endTrace({ traceId: correlationId, data: newServers });
      return newServers;
    } catch (error) {
      await this.telemetry.endTrace({ traceId: correlationId, error: error instanceof Error ? error : undefined });
      throw error;
    }
  }

  /**
   * Monitor server availability (IToolDiscoveryService interface)
   */
  async monitorServerAvailability(): Promise<Map<string, boolean>> {
    const correlationId = await this.telemetry.startTrace('ToolDiscoveryService', 'availability-check');

    try {
      await this.telemetry.logStructured({
        level: LogLevel.INFO,
        component: 'ToolDiscoveryService',
        phase: 'availability-check',
        message: 'Checking server availability',
      });

      const serverStatuses = await this.mcpToolManager.getAllServerStatuses();
      const availabilityMap = new Map<string, boolean>();
      const events: ToolAvailabilityEvent[] = [];

      for (const status of serverStatuses) {
        const isAvailable = status.status === 'connected';
        const previousState = this.previousServerStates.get(status.serverId) ?? false;

        availabilityMap.set(status.serverId, isAvailable);

        // Check if availability changed
        if (isAvailable !== previousState) {
          const event: ToolAvailabilityEvent = {
            serverId: status.serverId,
            available: isAvailable,
            previousState,
            timestamp: new Date(),
            error: status.lastError,
          };
          events.push(event);
          this.emitAvailabilityChange(event);
        }
      }

      // Update previous state
      this.previousServerStates = availabilityMap;

      await this.telemetry.logStructured({
        level: LogLevel.INFO,
        component: 'ToolDiscoveryService',
        phase: 'availability-check',
        message: 'Server availability check completed',
        metadata: {
          totalServers: serverStatuses.length,
          availableServers: Array.from(availabilityMap.values()).filter(Boolean).length,
          changes: events.length,
        },
      });

      await this.telemetry.endTrace({ traceId: correlationId, data: availabilityMap });
      return availabilityMap;
    } catch (error) {
      await this.telemetry.logStructured({
        level: LogLevel.ERROR,
        component: 'ToolDiscoveryService',
        phase: 'availability-check',
        message: 'Server availability check failed',
        metadata: { errorMessage: error instanceof Error ? error.message : String(error) },
        error: error instanceof Error ? error : undefined,
      });
      await this.telemetry.endTrace({ traceId: correlationId, error: error instanceof Error ? error : undefined });
      throw error;
    }
  }

  /**
   * Configure the service (IToolDiscoveryService interface)
   */
  configure(config: ToolDiscoveryConfig): void {
    this.telemetry.logStructured({
      level: LogLevel.INFO,
      component: 'ToolDiscoveryService',
      phase: 'configuration',
      message: 'Updating tool discovery configuration',
      metadata: {
        oldConfig: this.config,
        newConfig: config,
      },
    });

    this.config = { ...config };

    // Restart discovery if interval changed
    if (this.discoveryTimer) {
      this.startPeriodicDiscovery(this.config.discoveryInterval);
    }

    // Restart availability monitoring if interval changed
    if (this.availabilityTimer) {
      this.startAvailabilityMonitoring();
    }
  }

  /**
   * Get current configuration (IToolDiscoveryService interface)
   */
  getConfiguration(): ToolDiscoveryConfig {
    return { ...this.config };
  }

  /**
   * Start availability monitoring
   */
  private async startAvailabilityMonitoring(): Promise<void> {
    this.stopAvailabilityMonitoring();

    await this.telemetry.logStructured({
      level: LogLevel.INFO,
      component: 'ToolDiscoveryService',
      phase: 'availability-monitoring',
      message: 'Starting availability monitoring',
      metadata: { interval: this.config.availabilityCheckInterval },
    });

    this.availabilityTimer = setInterval(async () => {
      try {
        await this.monitorServerAvailability();
      } catch (error) {
        this.telemetry.logStructured({
          level: LogLevel.ERROR,
          component: 'ToolDiscoveryService',
          phase: 'availability-monitoring',
          message: 'Error during availability monitoring',
          metadata: { errorMessage: error instanceof Error ? error.message : String(error) },
          error: error instanceof Error ? error : undefined,
        });
      }
    }, this.config.availabilityCheckInterval) as unknown as number;
  }

  /**
   * Stop availability monitoring
   */
  private stopAvailabilityMonitoring(): void {
    if (this.availabilityTimer) {
      clearInterval(this.availabilityTimer);
      this.availabilityTimer = undefined;
      this.telemetry.logStructured({
        level: LogLevel.INFO,
        component: 'ToolDiscoveryService',
        phase: 'availability-monitoring',
        message: 'Stopped availability monitoring',
      });
    }
  }

  /**
   * Check if tool definition has changed
   */
  private hasToolChanged(previous: ToolDefinition, current: ToolDefinition): boolean {
    return (
      previous.description !== current.description ||
      previous.version !== current.version ||
      JSON.stringify(previous.inputSchema) !== JSON.stringify(current.inputSchema) ||
      previous.healthStatus !== current.healthStatus ||
      previous.deprecationNotice !== current.deprecationNotice
    );
  }

  /**
   * Emit tool change event
   */
  private emitToolChange(change: ToolChangeEvent): void {
    // Call registered callbacks
    this.toolChangeCallbacks.forEach((callback) => {
      try {
        callback(change);
      } catch (error) {
        this.telemetry.logStructured({
          level: LogLevel.ERROR,
          component: 'ToolDiscoveryService',
          phase: 'event-emission',
          message: 'Error in tool change callback',
          metadata: { errorMessage: error instanceof Error ? error.message : String(error) },
          error: error instanceof Error ? error : undefined,
        });
      }
    });

    // Emit to event bus if real-time events are enabled
    if (this.config.enableRealTimeEvents) {
      try {
        // Create a generic event that will work with the event bus
        const systemEvent = {
          id: `tool-change-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          type: SystemEventType.TOOL_CHANGE,
          timestamp: new Date(),
          source: this.name,
          data: change,
          metadata: {
            changeType: change.type,
            toolId: change.toolId,
            serverId: change.serverId,
          },
        };
        this.eventBus.emit(systemEvent as any);
      } catch (error) {
        this.telemetry.logStructured({
          level: LogLevel.ERROR,
          component: 'ToolDiscoveryService',
          phase: 'event-emission',
          message: 'Error emitting tool change event',
          metadata: { errorMessage: error instanceof Error ? error.message : String(error) },
          error: error instanceof Error ? error : undefined,
        });
      }
    }
  }

  /**
   * Emit availability change event
   */
  private emitAvailabilityChange(event: ToolAvailabilityEvent): void {
    // Call registered callbacks
    this.availabilityChangeCallbacks.forEach((callback) => {
      try {
        callback(event);
      } catch (error) {
        this.telemetry.logStructured({
          level: LogLevel.ERROR,
          component: 'ToolDiscoveryService',
          phase: 'event-emission',
          message: 'Error in availability change callback',
          metadata: { errorMessage: error instanceof Error ? error.message : String(error) },
          error: error instanceof Error ? error : undefined,
        });
      }
    });

    // Emit to event bus if real-time events are enabled
    if (this.config.enableRealTimeEvents) {
      try {
        // Create a generic event that will work with the event bus
        const systemEvent = {
          id: `availability-change-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          type: SystemEventType.TOOL_AVAILABILITY_CHANGE,
          timestamp: new Date(),
          source: this.name,
          data: event,
          metadata: {
            serverId: event.serverId,
            available: event.available,
            previousState: event.previousState,
          },
        };
        this.eventBus.emit(systemEvent as any);
      } catch (error) {
        this.telemetry.logStructured({
          level: LogLevel.ERROR,
          component: 'ToolDiscoveryService',
          phase: 'event-emission',
          message: 'Error emitting availability change event',
          metadata: { errorMessage: error instanceof Error ? error.message : String(error) },
          error: error instanceof Error ? error : undefined,
        });
      }
    }
  }
}

/**
 * Factory function to create a Tool Discovery Service
 */
export function createToolDiscoveryService(
  mcpToolManager: IMCPToolManager,
  toolRegistry: ToolRegistry,
  eventBus: EventBus,
  telemetryService: TelemetryService,
): ToolDiscoveryService {
  return new ToolDiscoveryService(mcpToolManager, toolRegistry, eventBus, telemetryService);
}
