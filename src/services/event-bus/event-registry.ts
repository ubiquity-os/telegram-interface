/**
 * Event Registry
 *
 * Central registry of all system events with their descriptions
 * and metadata for documentation and validation
 */

import { SystemEventType } from './types.ts';

/**
 * Event definition with metadata
 */
export interface EventDefinition {
  type: SystemEventType;
  name: string;
  description: string;
  payload: Record<string, string>;
  emittedBy: string[];
  consumedBy: string[];
}

/**
 * System event registry
 */
export const EVENT_REGISTRY: Record<SystemEventType, EventDefinition> = {
  [SystemEventType.MESSAGE_RECEIVED]: {
    type: SystemEventType.MESSAGE_RECEIVED,
    name: 'Message Received',
    description: 'Emitted when TelegramInterfaceAdapter receives a message from Telegram',
    payload: {
      message: 'TelegramMessage - The received message',
      requestId: 'string - Unique request identifier'
    },
    emittedBy: ['TelegramInterfaceAdapter'],
    consumedBy: ['SystemOrchestrator', 'ContextManager']
  },

  [SystemEventType.MESSAGE_ANALYZED]: {
    type: SystemEventType.MESSAGE_ANALYZED,
    name: 'Message Analyzed',
    description: 'Emitted when MessagePreProcessor completes message analysis',
    payload: {
      message: 'TelegramMessage - The original message',
      analysis: 'MessageAnalysis - Analysis results',
      requestId: 'string - Request identifier'
    },
    emittedBy: ['MessagePreProcessor'],
    consumedBy: ['DecisionEngine', 'SystemOrchestrator']
  },

  [SystemEventType.DECISION_MADE]: {
    type: SystemEventType.DECISION_MADE,
    name: 'Decision Made',
    description: 'Emitted when DecisionEngine makes a decision on how to handle a message',
    payload: {
      decision: 'Decision - The decision made',
      context: 'DecisionContext - Context used for decision',
      requestId: 'string - Request identifier'
    },
    emittedBy: ['DecisionEngine'],
    consumedBy: ['SystemOrchestrator', 'MCPToolManager']
  },

  [SystemEventType.TOOL_EXECUTED]: {
    type: SystemEventType.TOOL_EXECUTED,
    name: 'Tool Executed',
    description: 'Emitted when MCPToolManager executes a tool',
    payload: {
      toolId: 'string - Tool identifier',
      result: 'ToolResult - Execution result',
      requestId: 'string - Request identifier'
    },
    emittedBy: ['MCPToolManager'],
    consumedBy: ['DecisionEngine', 'ResponseGenerator']
  },

  [SystemEventType.RESPONSE_GENERATED]: {
    type: SystemEventType.RESPONSE_GENERATED,
    name: 'Response Generated',
    description: 'Emitted when ResponseGenerator creates a response',
    payload: {
      response: 'GeneratedResponse - The generated response',
      originalMessage: 'string - Original message text',
      requestId: 'string - Request identifier'
    },
    emittedBy: ['ResponseGenerator'],
    consumedBy: ['SelfModerationEngine', 'SystemOrchestrator']
  },

  [SystemEventType.MODERATION_COMPLETE]: {
    type: SystemEventType.MODERATION_COMPLETE,
    name: 'Moderation Complete',
    description: 'Emitted when SelfModerationEngine completes moderation',
    payload: {
      originalResponse: 'GeneratedResponse - Original response',
      moderatedResponse: 'GeneratedResponse - Moderated response',
      passed: 'boolean - Whether moderation passed',
      requestId: 'string - Request identifier'
    },
    emittedBy: ['SelfModerationEngine'],
    consumedBy: ['SystemOrchestrator', 'TelegramInterfaceAdapter']
  },

  [SystemEventType.ERROR_OCCURRED]: {
    type: SystemEventType.ERROR_OCCURRED,
    name: 'Error Occurred',
    description: 'Emitted when any component encounters an error',
    payload: {
      error: 'Error - The error object',
      context: 'ErrorContext - Error context',
      requestId: 'string - Request identifier (optional)'
    },
    emittedBy: ['*'],
    consumedBy: ['ErrorHandler', 'SystemOrchestrator']
  },

  [SystemEventType.ERROR_RECOVERED]: {
    type: SystemEventType.ERROR_RECOVERED,
    name: 'Error Recovered',
    description: 'Emitted when the system recovers from a transient error',
    payload: {
      component: 'string - The component that recovered',
      error: 'Error - The original error object',
      requestId: 'string - Request identifier (optional)'
    },
    emittedBy: ['ErrorRecoveryService'],
    consumedBy: ['SystemOrchestrator', 'TelemetryService']
  },

  [SystemEventType.COMPONENT_INITIALIZED]: {
    type: SystemEventType.COMPONENT_INITIALIZED,
    name: 'Component Initialized',
    description: 'Emitted when a component successfully initializes',
    payload: {
      componentName: 'string - Name of the component'
    },
    emittedBy: ['*'],
    consumedBy: ['SystemOrchestrator']
  },

  [SystemEventType.COMPONENT_SHUTDOWN]: {
    type: SystemEventType.COMPONENT_SHUTDOWN,
    name: 'Component Shutdown',
    description: 'Emitted when a component shuts down',
    payload: {
      componentName: 'string - Name of the component'
    },
    emittedBy: ['*'],
    consumedBy: ['SystemOrchestrator']
  },

  [SystemEventType.COMPONENT_ERROR]: {
    type: SystemEventType.COMPONENT_ERROR,
    name: 'Component Error',
    description: 'Emitted when a component encounters a critical error',
    payload: {
      componentName: 'string - Name of the component',
      error: 'Error - The error object'
    },
    emittedBy: ['*'],
    consumedBy: ['SystemOrchestrator', 'ErrorHandler']
  },

  [SystemEventType.SYSTEM_READY]: {
    type: SystemEventType.SYSTEM_READY,
    name: 'System Ready',
    description: 'Emitted when the entire system is initialized and ready',
    payload: {
      components: 'string[] - List of initialized components'
    },
    emittedBy: ['SystemOrchestrator'],
    consumedBy: ['*']
  },

  [SystemEventType.MODERATION_STARTED]: {
    type: SystemEventType.MODERATION_STARTED,
    name: 'Moderation Started',
    description: 'Emitted when SelfModerationEngine starts moderating a response',
    payload: {
      response: 'GeneratedResponse - The response being moderated',
      requestId: 'string - Request identifier'
    },
    emittedBy: ['SelfModerationEngine'],
    consumedBy: ['SystemOrchestrator']
  },

  [SystemEventType.MODERATION_APPROVED]: {
    type: SystemEventType.MODERATION_APPROVED,
    name: 'Moderation Approved',
    description: 'Emitted when a response passes moderation without changes',
    payload: {
      response: 'GeneratedResponse - The approved response',
      confidence: 'number - Confidence score',
      requestId: 'string - Request identifier'
    },
    emittedBy: ['SelfModerationEngine'],
    consumedBy: ['SystemOrchestrator']
  },

  [SystemEventType.MODERATION_REJECTED]: {
    type: SystemEventType.MODERATION_REJECTED,
    name: 'Moderation Rejected',
    description: 'Emitted when a response is rejected by moderation',
    payload: {
      response: 'GeneratedResponse - The rejected response',
      reasons: 'Array<{type, severity, description}> - Rejection reasons',
      requestId: 'string - Request identifier'
    },
    emittedBy: ['SelfModerationEngine'],
    consumedBy: ['SystemOrchestrator', 'ResponseGenerator']
  },

  [SystemEventType.MODERATION_MODIFIED]: {
    type: SystemEventType.MODERATION_MODIFIED,
    name: 'Moderation Modified',
    description: 'Emitted when a response is modified during moderation',
    payload: {
      originalResponse: 'GeneratedResponse - Original response',
      modifiedResponse: 'GeneratedResponse - Modified response',
      requestId: 'string - Request identifier'
    },
    emittedBy: ['SelfModerationEngine'],
    consumedBy: ['SystemOrchestrator']
  },

  [SystemEventType.MODERATION_FAILED]: {
    type: SystemEventType.MODERATION_FAILED,
    name: 'Moderation Failed',
    description: 'Emitted when moderation process encounters an error',
    payload: {
      response: 'GeneratedResponse - The response that failed moderation',
      error: 'Error - The error that occurred',
      requestId: 'string - Request identifier'
    },
    emittedBy: ['SelfModerationEngine'],
    consumedBy: ['SystemOrchestrator', 'ErrorHandler']
  },

  [SystemEventType.SYSTEM_SHUTDOWN]: {
    type: SystemEventType.SYSTEM_SHUTDOWN,
    name: 'System Shutdown',
    description: 'Emitted when the system is shutting down',
    payload: {
      reason: 'string - Reason for shutdown'
    },
    emittedBy: ['SystemOrchestrator'],
    consumedBy: ['*']
  },

  [SystemEventType.TOOL_CHANGE]: {
    type: SystemEventType.TOOL_CHANGE,
    name: 'Tool Change',
    description: 'Emitted when a tool is added, updated, or removed from the registry',
    payload: {
      toolId: 'string - Tool identifier',
      changeType: 'string - Type of change (added/updated/removed)',
      tool: 'RegisteredTool - Tool information (optional for removals)',
      timestamp: 'string - ISO timestamp of the change'
    },
    emittedBy: ['ToolDiscoveryService', 'MCPToolManager'],
    consumedBy: ['SystemOrchestrator', 'DecisionEngine']
  },

  [SystemEventType.TOOL_AVAILABILITY_CHANGE]: {
    type: SystemEventType.TOOL_AVAILABILITY_CHANGE,
    name: 'Tool Availability Change',
    description: 'Emitted when a tool becomes available or unavailable',
    payload: {
      toolId: 'string - Tool identifier',
      isAvailable: 'string - Tool availability status (true/false)',
      reason: 'string - Reason for availability change',
      timestamp: 'string - ISO timestamp of the change'
    },
    emittedBy: ['ToolDiscoveryService', 'MCPToolManager'],
    consumedBy: ['SystemOrchestrator', 'DecisionEngine']
  }
};

/**
 * Get event definition by type
 */
export function getEventDefinition(type: SystemEventType): EventDefinition {
  const definition = EVENT_REGISTRY[type];
  if (!definition) {
    throw new Error(`Unknown event type: ${type}`);
  }
  return definition;
}

/**
 * Get all events emitted by a component
 */
export function getEventsEmittedBy(componentName: string): EventDefinition[] {
  return Object.values(EVENT_REGISTRY).filter(
    def => def.emittedBy.includes(componentName) || def.emittedBy.includes('*')
  );
}

/**
 * Get all events consumed by a component
 */
export function getEventsConsumedBy(componentName: string): EventDefinition[] {
  return Object.values(EVENT_REGISTRY).filter(
    def => def.consumedBy.includes(componentName) || def.consumedBy.includes('*')
  );
}

/**
 * Validate event type exists
 */
export function isValidEventType(type: string): type is SystemEventType {
  return Object.values(SystemEventType).includes(type as SystemEventType);
}

/**
 * Get event flow for a component
 */
export function getComponentEventFlow(componentName: string): {
  emits: EventDefinition[];
  consumes: EventDefinition[];
} {
  return {
    emits: getEventsEmittedBy(componentName),
    consumes: getEventsConsumedBy(componentName)
  };
}
