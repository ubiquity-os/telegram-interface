/**
 * Decision Engine types and interfaces
 */

import {
  TelegramMessage,
  ConversationContext,
  MessageAnalysis,
  InlineKeyboard,
  InternalMessage
} from '../../interfaces/message-types.ts';

import {
  DecisionState,
  DecisionContext,
  Decision,
  ResponseStrategy,
  ToolDefinition,
  ToolCall,
  ToolResult
} from '../../interfaces/component-interfaces.ts';

// Re-export for convenience
export type {
  DecisionState,
  DecisionContext,
  Decision,
  ResponseStrategy,
  ToolDefinition,
  ToolCall,
  ToolResult
};

/**
 * State machine context for decision tracking
 */
export interface StateMachineContext {
  chatId: number;
  currentState: DecisionState;
  previousState?: DecisionState;
  stateData: Record<string, any>;
  lastTransition: Date;
  transitionHistory: StateTransition[];
}

/**
 * State transition record
 */
export interface StateTransition {
  from: DecisionState;
  to: DecisionState;
  timestamp: Date;
  trigger: string;
  metadata?: Record<string, any>;
}

// DecisionEvent moved to state-machine.ts to avoid circular import issues

/**
 * Decision engine configuration
 */
export interface DecisionEngineConfig {
  maxStateRetention: number; // Max states to keep in memory
  defaultTimeout: number; // Default timeout for operations
  enableStatePersistence: boolean; // Whether to persist state
  debugMode: boolean; // Enable debug logging
  confidenceThreshold: number; // Minimum confidence for decision making
}

/**
 * Tool execution context
 */
export interface ToolExecutionContext {
  originalMessage: TelegramMessage;
  analysis: MessageAnalysis;
  selectedTools: ToolCall[];
  timeout: number;
}

/**
 * Decision metrics for monitoring
 */
export interface DecisionMetrics {
  totalDecisions: number;
  averageDecisionTime: number;
  toolUsageRate: number;
  errorRate: number;
  stateDistribution: Record<DecisionState, number>;
}