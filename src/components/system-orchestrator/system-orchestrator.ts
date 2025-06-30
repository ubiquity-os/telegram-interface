/**
 * System Orchestrator Implementation
 *
 * Central orchestration system that manages message flow and component lifecycle
 */

import { injectable, inject } from 'inversify';
import type { interfaces } from 'inversify';
import { TYPES } from '../../core/types.ts';
import { Platform } from '../../core/protocol/ump-types.ts';
import {
  SystemOrchestratorConfig,
  ComponentDependencies,
  SystemHealthStatus,
  SystemMetrics,
  RequestContext,
  ISystemOrchestrator,
  ComponentState,
  ManagedComponent,
  MessageFlowStage,
  FlowTracker
} from './types.ts';

import type {
  TelegramUpdate,
  ComponentStatus,
  ITelegramInterfaceAdapter,
  IDecisionEngine,
  IContextManager,
  IErrorHandler,
  IMessagePreProcessor,
  IResponseGenerator,
  ErrorContext,
  DecisionContext,
  Decision,
  ToolResult,
  ResponseContext
} from '../../interfaces/component-interfaces.ts';

import type { IMessageInterface, GenericResponse } from '../../interfaces/message-interface.ts';

import {
  TelegramMessage,
  TelegramResponse,
  InternalMessage,
  GeneratedResponse,
  ConversationContext,
  MessageAnalysis,
  EventType,
  SystemEvent,
  UserPreferences
} from '../../interfaces/message-types.ts';

import type { TelemetryService } from '../../services/telemetry/telemetry-service.ts';
import { LogLevel } from '../../services/telemetry/telemetry-service.ts';
import type { EventBus } from '../../services/event-bus/event-bus.ts';

@injectable()
export class SystemOrchestrator implements ISystemOrchestrator {
  private components = new Map<string, ManagedComponent>();
  private metrics: SystemMetrics;
  private config: SystemOrchestratorConfig;
  private activeRequests = new Map<string, RequestContext>();
  private flowTrackers = new Map<string, FlowTracker>();
  private startTime: Date;
  private isInitialized = false;
  private isShuttingDown = false;

  // Interface required properties
  public enableMCPTools: boolean = false;
  public enableSelfModeration: boolean = false;
  public enableErrorRecovery: boolean = true;
  public requestTimeout: number = 30000;
  public maxRetries: number = 3;
  public messageQueue: any = null; // Will be initialized in initialize()
  public logLevel: "debug" | "info" | "warn" | "error" = "info";

  constructor(
    @inject(TYPES.TelemetryService) private telemetryService: TelemetryService,
    @inject(TYPES.EventBus) private eventBus: EventBus,
    @inject(TYPES.MessageInterfaceFactory) private messageInterfaceFactory: interfaces.Factory<IMessageInterface>
  ) {
    this.startTime = new Date();
    this.metrics = this.initializeMetrics();
    this.config = {} as SystemOrchestratorConfig;
  }

  async initialize(config: SystemOrchestratorConfig): Promise<void> {
    await this.telemetryService.logStructured({
      level: LogLevel.INFO,
      component: 'SystemOrchestrator',
      phase: 'initialization',
      message: 'Starting system orchestrator initialization',
      metadata: { configProvided: !!config }
    });

    this.config = config;
    this.isInitialized = true;

    await this.telemetryService.logStructured({
      level: LogLevel.INFO,
      component: 'SystemOrchestrator',
      phase: 'initialization',
      message: 'System orchestrator initialized successfully'
    });
  }

  async start(): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('SystemOrchestrator must be initialized before starting');
    }

    await this.telemetryService.logStructured({
      level: LogLevel.INFO,
      component: 'SystemOrchestrator',
      phase: 'startup',
      message: 'Starting system orchestrator'
    });

    // Start all components in dependency order
    const componentsToStart = Array.from(this.components.values())
      .sort((a, b) => a.initOrder - b.initOrder);

    for (const managedComponent of componentsToStart) {
      if (managedComponent.component?.initialize) {
        try {
          managedComponent.state = ComponentState.INITIALIZING;
          await managedComponent.component.initialize();
          managedComponent.state = ComponentState.READY;

          await this.telemetryService.logStructured({
            level: LogLevel.INFO,
            component: 'SystemOrchestrator',
            phase: 'startup',
            message: `Component ${managedComponent.name} started successfully`
          });
        } catch (error) {
          managedComponent.state = ComponentState.ERROR;
          managedComponent.lastError = error as Error;

          await this.telemetryService.logStructured({
            level: LogLevel.ERROR,
            component: 'SystemOrchestrator',
            phase: 'startup',
            message: `Failed to start component ${managedComponent.name}`,
            metadata: { error: (error as Error).message }
          });

          if (managedComponent.required) {
            throw new Error(`Required component ${managedComponent.name} failed to start: ${(error as Error).message}`);
          }
        }
      }
    }
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    await this.telemetryService.logStructured({
      level: LogLevel.INFO,
      component: 'SystemOrchestrator',
      phase: 'shutdown',
      message: 'Starting system orchestrator shutdown'
    });

    // Stop components in reverse order
    const componentsToStop = Array.from(this.components.values())
      .sort((a, b) => b.initOrder - a.initOrder);

    for (const managedComponent of componentsToStop) {
      if (managedComponent.component?.shutdown) {
        try {
          managedComponent.state = ComponentState.STOPPING;
          await managedComponent.component.shutdown();
          managedComponent.state = ComponentState.STOPPED;
        } catch (error) {
          await this.telemetryService.logStructured({
            level: LogLevel.ERROR,
            component: 'SystemOrchestrator',
            phase: 'shutdown',
            message: `Error stopping component ${managedComponent.name}`,
            metadata: { error: (error as Error).message }
          });
        }
      }
    }

    this.isShuttingDown = false;
  }

  async restart(): Promise<void> {
    await this.shutdown();
    await this.start();
  }

  async handleUpdate(update: TelegramUpdate): Promise<string> {
    const requestId = this.generateRequestId();
    const requestContext: RequestContext = {
      requestId,
      startTime: new Date(),
      update,
      metadata: {}
    };

    this.activeRequests.set(requestId, requestContext);
    this.metrics.totalRequests++;
    this.metrics.activeRequests++;

    try {
      const result = await this.processUpdateWithTelemetry(update, requestId);
      this.metrics.successfulRequests++;
      return result;
    } catch (error) {
      this.metrics.failedRequests++;
      await this.telemetryService.logStructured({
        level: LogLevel.ERROR,
        component: 'SystemOrchestrator',
        phase: 'error',
        message: 'Error processing update',
        metadata: {
          error: (error as Error).message,
          requestId,
          updateId: update.update_id
        }
      });
      throw error;
    } finally {
      requestContext.endTime = new Date();
      this.activeRequests.delete(requestId);
      this.metrics.activeRequests--;

      // Update average response time
      const responseTime = requestContext.endTime.getTime() - requestContext.startTime.getTime();
      this.updateAverageResponseTime(responseTime);
    }
  }

  async getHealthStatus(): Promise<SystemHealthStatus> {
    const componentStatuses = new Map<string, ComponentStatus>();

    for (const [name, managedComponent] of this.components) {
      const status: ComponentStatus = {
        name,
        status: this.getComponentHealthStatus(managedComponent),
        lastHealthCheck: new Date(),
        metadata: {
          state: managedComponent.state,
          restartCount: managedComponent.restartCount,
          lastError: managedComponent.lastError?.message
        }
      };
      componentStatuses.set(name, status);
    }

    const overall = this.determineOverallHealth(componentStatuses);

    return {
      overall,
      components: componentStatuses,
      timestamp: new Date(),
      systemLoad: await this.getSystemLoad(),
      activeRequests: this.metrics.activeRequests,
      uptime: Date.now() - this.startTime.getTime(),
      metrics: this.metrics
    };
  }

  // Method overloads to match interface
  async checkComponentHealth(): Promise<Map<string, ComponentStatus>>;
  async checkComponentHealth(componentName: string): Promise<ComponentStatus>;
  async checkComponentHealth(componentName?: string): Promise<Map<string, ComponentStatus> | ComponentStatus> {
    const healthStatus = await this.getHealthStatus();

    if (componentName) {
      // Return specific component status
      const componentStatus = healthStatus.components.get(componentName);
      if (!componentStatus) {
        throw new Error(`Component '${componentName}' not found`);
      }
      return componentStatus;
    } else {
      // Return all component statuses
      return healthStatus.components;
    }
  }

  getComponent<T>(componentName: string): T | undefined {
    const managedComponent = this.components.get(componentName);
    return managedComponent?.component as T;
  }

  registerComponent(name: string, component: any): void {
    const managedComponent: ManagedComponent = {
      name,
      component,
      state: ComponentState.UNINITIALIZED,
      required: true,
      initOrder: this.components.size + 1,
      restartCount: 0
    };

    this.components.set(name, managedComponent);

    this.telemetryService.logStructured({
      level: LogLevel.INFO,
      component: 'SystemOrchestrator',
      phase: 'registration',
      message: `Component ${name} registered`,
      metadata: { componentType: typeof component }
    });
  }

  async restartComponent(componentName: string): Promise<void> {
    const managedComponent = this.components.get(componentName);
    if (!managedComponent) {
      throw new Error(`Component ${componentName} not found`);
    }

    await this.telemetryService.logStructured({
      level: LogLevel.INFO,
      component: 'SystemOrchestrator',
      phase: 'restart',
      message: `Restarting component ${componentName}`
    });

    try {
      if (managedComponent.component?.shutdown) {
        await managedComponent.component.shutdown();
      }

      if (managedComponent.component?.initialize) {
        managedComponent.state = ComponentState.INITIALIZING;
        await managedComponent.component.initialize();
        managedComponent.state = ComponentState.READY;
      }

      managedComponent.restartCount++;

      await this.telemetryService.logStructured({
        level: LogLevel.INFO,
        component: 'SystemOrchestrator',
        phase: 'restart',
        message: `Component ${componentName} restarted successfully`,
        metadata: { restartCount: managedComponent.restartCount }
      });
    } catch (error) {
      managedComponent.state = ComponentState.ERROR;
      managedComponent.lastError = error as Error;
      throw error;
    }
  }

  getMetrics(): SystemMetrics {
    return { ...this.metrics };
  }

  resetMetrics(): void {
    this.metrics = this.initializeMetrics();
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private async processUpdateWithTelemetry(update: TelegramUpdate, requestId: string): Promise<string> {
    // CRITICAL FIX: Check for gateway metadata or HTTP/CLI user first names
    const gatewayMeta = (update as any)._gateway;
    const firstName = update.message?.from?.first_name || '';
    const isRestApiMessage = gatewayMeta?.source === 'http' ||
                             gatewayMeta?.source === 'cli' ||
                             firstName === 'Http User' ||
                             firstName === 'Cli User' ||
                             firstName === 'API User';

    console.log(`[SystemOrchestrator] 🔍 PLATFORM DETECTION DEBUG:`);
    console.log(`[SystemOrchestrator] 🔍 Gateway metadata:`, gatewayMeta);
    console.log(`[SystemOrchestrator] 🔍 First name: "${firstName}"`);
    console.log(`[SystemOrchestrator] 🔍 isRestApiMessage: ${isRestApiMessage}`);

    try {
      const messagePreProcessor = this.getComponent<IMessagePreProcessor>('MessagePreProcessor');
      const contextManager = this.getComponent<IContextManager>('ContextManager');
      const decisionEngine = this.getComponent<IDecisionEngine>('DecisionEngine');
      const responseGenerator = this.getComponent<IResponseGenerator>('ResponseGenerator');
      const telegramAdapter = this.getComponent<ITelegramInterfaceAdapter>('TelegramAdapter');

      if (!messagePreProcessor || !contextManager || !decisionEngine || !responseGenerator || !telegramAdapter) {
        throw new Error('A required component is not available for message processing.');
      }

      const messageText = update.message?.text || '';
      const userId = update.message?.from?.id?.toString() || 'unknown_user';
      const chatId = update.message?.chat?.id?.toString() || 'unknown_chat';

      const conversationContext = await contextManager.getContext(parseInt(chatId));
      const analysis = await messagePreProcessor.analyzeMessage(messageText, conversationContext);

      const telegramMessage: TelegramMessage = {
        chatId: parseInt(chatId),
        userId: parseInt(userId),
        messageId: update.message?.message_id || Date.now(),
        text: messageText,
        timestamp: new Date(update.message?.date ? update.message.date * 1000 : Date.now())
      };

      const decisionContext: DecisionContext = {
        message: telegramMessage,
        analysis,
        conversationState: conversationContext,
        availableTools: []
      };

      const decision = await decisionEngine.makeDecision(decisionContext);

      const responseContext: ResponseContext = {
        originalMessage: messageText,
        analysis,
        conversationHistory: conversationContext.messages || [],
        toolResults: [],
        constraints: {
          maxLength: 4000,
          allowMarkdown: true,
          requireInlineKeyboard: false,
          tone: 'casual'
        }
      };

      const generatedResponse = await responseGenerator.generateResponse(responseContext);

      const userMessage: InternalMessage = {
        id: `msg_${Date.now()}_user`,
        chatId: parseInt(chatId),
        userId: parseInt(userId),
        content: messageText,
        timestamp: new Date(),
        metadata: { source: isRestApiMessage ? 'rest_api' : 'telegram', originalMessageId: update.message?.message_id }
      };

      const systemMessage: InternalMessage = {
        id: `msg_${Date.now()}_system`,
        chatId: parseInt(chatId),
        userId: parseInt(userId),
        content: generatedResponse.content,
        timestamp: new Date(),
        metadata: { source: 'system', requestId: requestId }
      };

      await contextManager.addMessage(userMessage);
      await contextManager.addMessage(systemMessage);

      // CRITICAL FIX: Use MessageInterfaceFactory for proper platform routing
      console.log(`[SystemOrchestrator] 🔄 PLATFORM-AWARE RESPONSE ROUTING`);
      console.log(`[SystemOrchestrator] 🔍 isRestApiMessage: ${isRestApiMessage}`);
      console.log(`[SystemOrchestrator] 🔍 Chat ID: ${chatId}, User ID: ${userId}`);
      console.log(`[SystemOrchestrator] 🔍 Generated response: "${generatedResponse.content}"`);

      // Use the factory to get the correct adapter based on platform
      const platform = isRestApiMessage ? Platform.REST_API : Platform.TELEGRAM;
      console.log(`[SystemOrchestrator] 🔍 Selected platform: ${platform}`);

      const messageInterface = this.messageInterfaceFactory(platform);
      console.log(`[SystemOrchestrator] ✅ ADAPTER SELECTED: ${messageInterface.constructor.name}`);

      if (isRestApiMessage) {
        // For REST API, return the content directly (ApiResponseAdapter handles this)
        console.log(`[SystemOrchestrator] 📡 REST API: Returning response content directly`);
        return generatedResponse.content;
      } else {
        // For Telegram, send the response via the TelegramInterfaceAdapter
        console.log(`[SystemOrchestrator] 📱 TELEGRAM: Sending via TelegramInterfaceAdapter`);
        const telegramResponse: TelegramResponse = {
          chatId: parseInt(chatId),
          text: generatedResponse.content,
          replyToMessageId: update.message?.message_id
        };

        // Use the factory-selected adapter (should be TelegramInterfaceAdapter for Telegram platform)
        const selectedAdapter = messageInterface as ITelegramInterfaceAdapter;
        await selectedAdapter.sendResponse(telegramResponse);
        console.log(`[SystemOrchestrator] ✅ TELEGRAM: Response sent via ${selectedAdapter.constructor.name}`);
        return JSON.stringify({ success: true, message: "Response sent via Telegram." });
      }
    } catch (error) {
       this.telemetryService.logStructured({
        level: LogLevel.ERROR,
        component: 'SystemOrchestrator',
        phase: 'error_handling',
        message: `Error during message processing: ${(error as Error).message}`,
        metadata: {
          error,
          update,
          isRestApiMessage
        }
       });
      // Let the error bubble up to the MessageRouter for proper handling.
      throw error;
    }
  }

  private initializeMetrics(): SystemMetrics {
    return {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      activeRequests: 0,
      errorRate: 0
    };
  }

  private updateAverageResponseTime(responseTime: number): void {
    const totalProcessed = this.metrics.successfulRequests + this.metrics.failedRequests;
    if (totalProcessed === 1) {
      this.metrics.averageResponseTime = responseTime;
    } else {
      this.metrics.averageResponseTime =
        (this.metrics.averageResponseTime * (totalProcessed - 1) + responseTime) / totalProcessed;
    }
  }

  private getComponentHealthStatus(component: ManagedComponent): 'healthy' | 'degraded' | 'unhealthy' {
    switch (component.state) {
      case ComponentState.READY:
        return 'healthy';
      case ComponentState.INITIALIZING:
      case ComponentState.STOPPING:
        return 'degraded';
      case ComponentState.ERROR:
      case ComponentState.STOPPED:
        return 'unhealthy';
      default:
        return 'unhealthy';
    }
  }

  private determineOverallHealth(components: Map<string, ComponentStatus>): 'healthy' | 'degraded' | 'unhealthy' {
    const statuses = Array.from(components.values()).map(c => c.status);

    if (statuses.some(s => s === 'unhealthy')) {
      return 'unhealthy';
    }
    if (statuses.some(s => s === 'degraded')) {
      return 'degraded';
    }
    return 'healthy';
  }

  private async getSystemLoad(): Promise<number> {
    // Placeholder for actual system load calculation (e.g., CPU, memory)
    return 0.5;
  }

  getComponentDependencies(componentName: string): string[] {
    // Placeholder for dependency resolution logic
    return [];
  }

  getSystemStatus(): any {
    return {
      health: this.getHealthStatus(),
      metrics: this.getMetrics(),
    };
  }

  updateConfiguration(config: Partial<SystemOrchestratorConfig>): void {
    this.config = { ...this.config, ...config };
    this.eventBus.publish(EventType.CONFIGURATION_UPDATED, { component: 'SystemOrchestrator', config });
  }
}
