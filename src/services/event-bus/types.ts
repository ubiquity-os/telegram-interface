/**
 * Event Bus Types and Interfaces
 *
 * Defines the structure of events and the event bus system
 */

import {
  TelegramMessage,
  MessageAnalysis,
  GeneratedResponse
} from '../../interfaces/message-types.ts';

import {
  ToolResult,
  Decision,
  DecisionContext,
  ErrorContext
} from '../../interfaces/component-interfaces.ts';

/**
 * Core system event types
 */
export enum SystemEventType {
  // Message flow events
  MESSAGE_RECEIVED = 'message.received',
  MESSAGE_ANALYZED = 'message.analyzed',
  DECISION_MADE = 'decision.made',
  TOOL_EXECUTED = 'tool.executed',
  RESPONSE_GENERATED = 'response.generated',
  MODERATION_STARTED = 'moderation.started',
  MODERATION_APPROVED = 'moderation.approved',
  MODERATION_REJECTED = 'moderation.rejected',
  MODERATION_MODIFIED = 'moderation.modified',
  MODERATION_FAILED = 'moderation.failed',
  MODERATION_COMPLETE = 'moderation.complete',

  // Error events
  ERROR_RECOVERED = 'error.recovered',
  ERROR_OCCURRED = 'error.occurred',

  // Component lifecycle events
  COMPONENT_INITIALIZED = 'component.initialized',
  COMPONENT_SHUTDOWN = 'component.shutdown',
  COMPONENT_ERROR = 'component.error',

  // System events
  SYSTEM_READY = 'system.ready',
  SYSTEM_SHUTDOWN = 'system.shutdown',

  // Tool discovery events
  TOOL_CHANGE = 'tool.change',
  TOOL_AVAILABILITY_CHANGE = 'tool.availability.change'
}

/**
 * Base event interface
 */
export interface BaseEvent {
  id: string;
  type: SystemEventType;
  timestamp: Date;
  source: string;
  metadata?: Record<string, any>;
  priority?: number;
  attachments?: any[];
}

/**
 * Message received event
 */
export interface MessageReceivedEvent extends BaseEvent {
  type: SystemEventType.MESSAGE_RECEIVED;
  payload: {
    message: TelegramMessage;
    requestId: string;
  };
}

/**
 * Message analyzed event
 */
export interface MessageAnalyzedEvent extends BaseEvent {
  type: SystemEventType.MESSAGE_ANALYZED;
  payload: {
    message: TelegramMessage;
    analysis: MessageAnalysis;
    requestId: string;
  };
}

/**
 * Decision made event
 */
export interface DecisionMadeEvent extends BaseEvent {
  type: SystemEventType.DECISION_MADE;
  payload: {
    decision: Decision;
    context: DecisionContext;
    requestId: string;
  };
}

/**
 * Tool executed event
 */
export interface ToolExecutedEvent extends BaseEvent {
  type: SystemEventType.TOOL_EXECUTED;
  payload: {
    toolId: string;
    result: ToolResult;
    requestId: string;
  };
}

/**
 * Response generated event
 */
export interface ResponseGeneratedEvent extends BaseEvent {
  type: SystemEventType.RESPONSE_GENERATED;
  payload: {
    response: GeneratedResponse;
    originalMessage: string;
    requestId: string;
  };
}

/**
 * Moderation started event
 */
export interface ModerationStartedEvent extends BaseEvent {
  type: SystemEventType.MODERATION_STARTED;
  payload: {
    response: GeneratedResponse;
    requestId: string;
  };
}

/**
 * Moderation approved event
 */
export interface ModerationApprovedEvent extends BaseEvent {
  type: SystemEventType.MODERATION_APPROVED;
  payload: {
    response: GeneratedResponse;
    confidence: number;
    requestId: string;
  };
}

/**
 * Moderation rejected event
 */
export interface ModerationRejectedEvent extends BaseEvent {
  type: SystemEventType.MODERATION_REJECTED;
  payload: {
    response: GeneratedResponse;
    reasons: Array<{
      type: string;
      severity: 'low' | 'medium' | 'high';
      description: string;
    }>;
    requestId: string;
  };
}

/**
 * Moderation modified event
 */
export interface ModerationModifiedEvent extends BaseEvent {
  type: SystemEventType.MODERATION_MODIFIED;
  payload: {
    originalResponse: GeneratedResponse;
    modifiedResponse: GeneratedResponse;
    requestId: string;
  };
}

/**
 * Moderation failed event
 */
export interface ModerationFailedEvent extends BaseEvent {
  type: SystemEventType.MODERATION_FAILED;
  payload: {
    response: GeneratedResponse;
    error: Error;
    requestId: string;
  };
}

/**
 * Moderation complete event
 */
export interface ModerationCompleteEvent extends BaseEvent {
  type: SystemEventType.MODERATION_COMPLETE;
  payload: {
    originalResponse: GeneratedResponse;
    moderatedResponse: GeneratedResponse;
    passed: boolean;
    requestId: string;
  };
}

/**
 * Error occurred event
 */
export interface ErrorRecoveredEvent extends BaseEvent {
  type: SystemEventType.ERROR_RECOVERED;
  payload: {
    error: Error;
    recoveryStrategy: string;
    component: string;
  };
}

export interface ErrorOccurredEvent extends BaseEvent {
  type: SystemEventType.ERROR_OCCURRED;
  payload: {
    error: Error;
    context: ErrorContext;
    requestId?: string;
  };
}

/**
 * Component lifecycle events
 */
export interface ComponentInitializedEvent extends BaseEvent {
  type: SystemEventType.COMPONENT_INITIALIZED;
  payload: {
    componentName: string;
    timestamp: Date;
  };
}

export interface ComponentShutdownEvent extends BaseEvent {
  type: SystemEventType.COMPONENT_SHUTDOWN;
  payload: {
    componentName: string;
  };
}

export interface ComponentErrorEvent extends BaseEvent {
  type: SystemEventType.COMPONENT_ERROR;
  payload: {
    componentName: string;
    error: Error;
  };
}

/**
 * System events
 */
export interface SystemReadyEvent extends BaseEvent {
  type: SystemEventType.SYSTEM_READY;
  payload: {
    components: string[];
    timestamp: Date;
  };
}

export interface SystemShutdownEvent extends BaseEvent {
  type: SystemEventType.SYSTEM_SHUTDOWN;
  payload: {
    reason: string;
  };
}

/**
 * Union type of all events
 */
export type SystemEvent =
  | MessageReceivedEvent
  | MessageAnalyzedEvent
  | DecisionMadeEvent
  | ToolExecutedEvent
  | ResponseGeneratedEvent
  | ModerationStartedEvent
  | ModerationApprovedEvent
  | ModerationRejectedEvent
  | ModerationModifiedEvent
  | ModerationFailedEvent
  | ModerationCompleteEvent
  | ErrorRecoveredEvent
  | ErrorOccurredEvent
  | ComponentInitializedEvent
  | ComponentShutdownEvent
  | ComponentErrorEvent
  | SystemReadyEvent
  | SystemShutdownEvent;

/**
 * Event handler type
 */
export type EventHandler<T extends SystemEvent = SystemEvent> = (event: T) => void | Promise<void>;

/**
 * Event filter function
 */
export type EventFilter<T extends SystemEvent = SystemEvent> = (event: T) => boolean;

/**
 * Subscription options
 */
export interface SubscriptionOptions {
  filter?: EventFilter;
  namespace?: string;
  priority?: number;
  once?: boolean;
}

/**
 * Subscription interface
 */
export interface Subscription {
  id: string;
  eventType: SystemEventType;
  handler: EventHandler;
  options: SubscriptionOptions;
  createdAt: Date;
}

/**
 * Event Bus interface
 */
export interface IEventBus {
  // Core pub/sub methods
  on<T extends SystemEvent>(
    eventType: T['type'],
    handler: EventHandler<T>,
    options?: SubscriptionOptions
  ): string;

  off(subscriptionId: string): boolean;

  once<T extends SystemEvent>(
    eventType: T['type'],
    handler: EventHandler<T>,
    options?: Omit<SubscriptionOptions, 'once'>
  ): string;

  subscribe<T extends SystemEvent>(
    eventType: T['type'],
    handler: EventHandler<T>,
    options?: SubscriptionOptions
  ): string;

  emit<T extends SystemEvent>(event: T): Promise<void>;

  // Utility methods
  clearNamespace(namespace: string): number;
  clearAll(): void;
  getSubscriptions(eventType?: SystemEventType): Subscription[];

  // Statistics
  getStats(): EventBusStats;
}

/**
 * Event Bus statistics
 */
export interface EventBusStats {
  totalEvents: number;
  eventCounts: Record<SystemEventType, number>;
  subscriptionCount: number;
  errorCount: number;
  averageHandlerTime: number;
}

/**
 * Event emitter mixin interface
 */
export interface IEventEmitter {
  eventBus: IEventBus;
  emit<T extends SystemEvent>(event: Omit<T, 'id' | 'timestamp' | 'source'>): Promise<void>;
}