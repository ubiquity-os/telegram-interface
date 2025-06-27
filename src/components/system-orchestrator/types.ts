/**
 * System Orchestrator Types
 *
 * Defines interfaces and types for the central orchestration system
 * that wires together all components
 */

import { TelegramUpdate } from '../../interfaces/component-interfaces.ts';
import { ITelegramInterfaceAdapter } from '../../interfaces/component-interfaces.ts';
import { IDecisionEngine } from '../../interfaces/component-interfaces.ts';
import { IContextManager } from '../../interfaces/component-interfaces.ts';
import { IErrorHandler } from '../../interfaces/component-interfaces.ts';
import { IMCPToolManager } from '../mcp-tool-manager/types.ts';
import { ISelfModerationEngine } from '../self-moderation-engine/types.ts';
import { IMessagePreProcessor, IResponseGenerator } from '../../interfaces/component-interfaces.ts';
import { ComponentStatus } from '../../interfaces/component-interfaces.ts';

/**
 * System Orchestrator Configuration
 */
export interface SystemOrchestratorConfig {
  // Component configurations
  telegramConfig: {
    botToken: string;
    webhookSecret?: string;
  };
  telegramAdapterConfig?: any;
  errorHandlerConfig?: any;
  contextManagerConfig?: any;
  decisionEngineConfig?: any;
  llmServiceConfig?: any;
  mcpToolManagerConfig?: any;
  selfModerationConfig?: any;

  // Message queue configuration
  messageQueue?: {
    workerConfig: {
      minWorkers: number;
      maxWorkers: number;
      idleTimeout: number;
    };
    retryConfig: {
      maxRetries: number;
      initialDelay: number;
      maxDelay: number;
      multiplier: number;
    };
  };

  // Feature flags
  enableMCPTools: boolean;
  enableSelfModeration: boolean;
  enableErrorRecovery: boolean;

  // Performance settings
  requestTimeout: number;
  maxRetries: number;

  // Logging
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Component dependencies for initialization
 */
export interface ComponentDependencies {
  telegramAdapter: ITelegramInterfaceAdapter;
  decisionEngine: IDecisionEngine;
  contextManager: IContextManager;
  errorHandler: IErrorHandler;
  messagePreProcessor: IMessagePreProcessor;
  responseGenerator: IResponseGenerator;
  mcpToolManager?: IMCPToolManager;
  selfModerationEngine?: ISelfModerationEngine;
}

/**
 * System health status
 */
export interface SystemHealthStatus {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  components: Map<string, ComponentStatus>;
  lastHealthCheck: Date;
  uptime: number;
  metrics: SystemMetrics;
}

/**
 * System metrics for monitoring
 */
export interface SystemMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  activeRequests: number;
  errorRate: number;
  // Message queue metrics
  queueStats?: {
    totalMessages: number;
    queueDepth: number;
    processingRate: number;
    averageWaitTime: number;
    activeWorkers: number;
    messagesByPriority: Record<string, number>;
  };
}

/**
 * Request context for tracking
 */
export interface RequestContext {
  requestId: string;
  startTime: Date;
  update: TelegramUpdate;
  metadata: Record<string, any>;
  endTime?: Date;
}

/**
 * System Orchestrator interface
 */
export interface ISystemOrchestrator {
  // Lifecycle management
  initialize(config: SystemOrchestratorConfig): Promise<void>;
  shutdown(): Promise<void>;
  restart(): Promise<void>;

  // Request handling
  handleUpdate(update: TelegramUpdate): Promise<string>;

  // Health monitoring
  getHealthStatus(): Promise<SystemHealthStatus>;
  checkComponentHealth(): Promise<Map<string, ComponentStatus>>;

  // Component management
  getComponent<T>(componentName: string): T | undefined;
  restartComponent(componentName: string): Promise<void>;

  // Metrics
  getMetrics(): SystemMetrics;
  resetMetrics(): void;
}

/**
 * Component lifecycle states
 */
export enum ComponentState {
  UNINITIALIZED = 'uninitialized',
  INITIALIZING = 'initializing',
  READY = 'ready',
  STOPPING = 'stopping',
  STOPPED = 'stopped',
  ERROR = 'error'
}

/**
 * Component wrapper for lifecycle management
 */
export interface ManagedComponent {
  name: string;
  component: any; // Allow any component type
  state: ComponentState;
  required: boolean;
  initOrder: number;
  dependencies?: string[];
  lastError?: Error;
  restartCount: number;
}

/**
 * Message flow stages for tracking
 */
export enum MessageFlowStage {
  RECEIVING = 'receiving',
  RECEIVED = 'received',
  STORING_CONTEXT = 'storing_context',
  PREPROCESSING = 'preprocessing',
  DECISION_MAKING = 'decision_making',
  TOOL_EXECUTION = 'tool_execution',
  RESPONSE_GENERATION = 'response_generation',
  MODERATION = 'moderation',
  SENDING_RESPONSE = 'sending_response',
  SENDING = 'sending',
  COMPLETED = 'completed',
  ERROR = 'error'
}

/**
 * Flow tracking for debugging
 */
export interface FlowTracker {
  requestId: string;
  startTime: Date;
  stages: Array<{
    stage: MessageFlowStage;
    timestamp: Date;
    duration?: number;
    metadata?: Record<string, any>;
  }>;
  currentStage: MessageFlowStage;
  error?: Error;
}