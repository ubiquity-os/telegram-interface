/**
 * Component interfaces for the new architecture
 */

import {
  TelegramMessage,
  TelegramResponse,
  InternalMessage,
  ConversationContext,
  UserPreferences,
  SystemEvent,
  MessageAnalysis,
  GeneratedResponse,
  InlineKeyboard
} from './message-types.ts';

// Re-export types from message-types for convenience
export type { EventType, SystemEvent } from './message-types.ts';

// Telegram Update type (from Grammy)
export interface TelegramUpdate {
  update_id: number;
  message?: any;
  callback_query?: any;
  [key: string]: any;
}

/**
 * Telegram Interface Adapter interface
 */
export interface ITelegramInterfaceAdapter {
  // Initialize the adapter
  initialize(): Promise<void>;

  // Receive and process Telegram updates
  receiveUpdate(update: TelegramUpdate): Promise<TelegramMessage>;

  // Send response back to Telegram
  sendResponse(response: TelegramResponse): Promise<void>;

  // Send typing indicator
  sendTypingIndicator(chatId: number): Promise<void>;

  // Get adapter status
  getStatus(): ComponentStatus;
}

/**
 * Context Manager interface
 */
export interface IContextManager {
  // Initialize the context manager
  initialize(): Promise<void>;

  // Store a message in the conversation history
  addMessage(message: InternalMessage): Promise<void>;

  // Retrieve conversation context
  getContext(chatId: number, maxMessages?: number): Promise<ConversationContext>;

  // Clear conversation history
  clearContext(chatId: number): Promise<void>;

  // Get user preferences
  getUserPreferences(userId: number): Promise<UserPreferences>;

  // Update user preferences
  updateUserPreferences(userId: number, preferences: Partial<UserPreferences>): Promise<void>;

  // Get context statistics
  getContextStats(chatId: number): Promise<ContextStats>;

  // Prune old conversations
  pruneOldConversations(maxAge: number): Promise<number>;
}

/**
 * Error Handler interface
 */
export interface IErrorHandler {
  // Initialize the error handler
  initialize(): Promise<void>;

  // Handle an error with context
  handleError(error: Error, context: ErrorContext): Promise<ErrorHandlingResult>;

  // Check if error is retryable
  isRetryableError(error: Error): boolean;

  // Get retry strategy for error
  getRetryStrategy(error: Error, operation: string): RetryStrategy;

  // Generate user-friendly error message
  getUserFriendlyMessage(error: Error): string;

  // Report error to monitoring
  reportError(error: Error, context: ErrorContext): Promise<void>;

  // Get circuit breaker status
  getCircuitBreakerStatus(serviceId: string): CircuitBreakerStatus;

  // Trip circuit breaker
  tripCircuitBreaker(serviceId: string, error: Error): void;
}

/**
 * Error types and categories
 */
export enum ErrorCategory {
  NETWORK_TIMEOUT = 'network_timeout',
  NETWORK_ERROR = 'network_error',
  RATE_LIMIT = 'rate_limit',
  INVALID_INPUT = 'invalid_input',
  AUTHENTICATION = 'authentication',
  PERMISSION_DENIED = 'permission_denied',
  NOT_FOUND = 'not_found',
  INTERNAL_ERROR = 'internal_error',
  TEMPORARY_FAILURE = 'temporary_failure',
  PERMANENT_FAILURE = 'permanent_failure',
  UNKNOWN = 'unknown'
}

export class CategorizedError extends Error {
  constructor(
    message: string,
    public category: ErrorCategory,
    public originalError?: Error,
    public metadata?: Record<string, any>
  ) {
    super(message);
    this.name = 'CategorizedError';
  }
}

/**
 * Error context for handling
 */
export interface ErrorContext {
  operation: string;
  component: string;
  userId?: number;
  chatId?: number;
  metadata?: Record<string, any>;
}

/**
 * Error handling result
 */
export interface ErrorHandlingResult {
  handled: boolean;
  retry: boolean;
  userMessage?: string;
  loggedError: boolean;
  circuitBreakerTripped?: boolean;
}

/**
 * Retry strategy configuration
 */
export interface RetryStrategy {
  maxAttempts: number;
  backoffType: 'exponential' | 'linear' | 'fixed';
  initialDelay: number;
  maxDelay: number;
  retryableErrors: ErrorCategory[];
}

/**
 * Circuit breaker status
 */
export interface CircuitBreakerStatus {
  serviceId: string;
  state: 'closed' | 'open' | 'half-open';
  failureCount: number;
  lastFailureTime?: Date;
  nextRetryTime?: Date;
}

/**
 * Component status
 */
export interface ComponentStatus {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  lastHealthCheck: Date;
  metadata?: Record<string, any>;
}

/**
 * Context statistics
 */
export interface ContextStats {
  messageCount: number;
  firstMessageTime?: Date;
  lastMessageTime?: Date;
  totalTokens?: number;
  averageResponseTime?: number;
}

/**
 * Event emitter interface for components
 */
export interface IEventEmitter {
  emit(event: SystemEvent): void;
  on(eventType: string, handler: (event: SystemEvent) => void): void;
  off(eventType: string, handler: (event: SystemEvent) => void): void;
}

/**
 * Decision Engine interface
 */
export interface IDecisionEngine extends IComponent {
  // Core decision making
  makeDecision(context: DecisionContext): Promise<Decision>;
  processToolResults(results: ToolResult[]): Promise<Decision>;
  handleError(error: Error, context: DecisionContext): Promise<Decision>;

  // State management
  getCurrentState(chatId: number): Promise<DecisionState>;
  transitionTo(chatId: number, state: DecisionState): Promise<void>;
  resetChatState(chatId: number): void;
}

/**
 * Message Pre-Processor interface
 */
export interface IMessagePreProcessor extends IComponent {
  analyzeMessage(
    message: string,
    context?: ConversationContext
  ): Promise<MessageAnalysis>;

  // Caching for similar messages
  getCachedAnalysis(messageHash: string): Promise<MessageAnalysis | null>;
  cacheAnalysis(messageHash: string, analysis: MessageAnalysis): Promise<void>;
}

/**
 * Response Generator interface
 */
export interface IResponseGenerator extends IComponent {
  generateResponse(context: ResponseContext): Promise<GeneratedResponse>;
  formatToolResults(results: ToolResult[]): string;
  createInlineKeyboard(options: string[]): InlineKeyboard;

  // Response validation
  validateResponse(response: GeneratedResponse): Promise<boolean>;
}

/**
 * Decision Engine types - Simplified State Machine
 */
export enum DecisionState {
  READY = 'ready',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  ERROR = 'error'
}

export interface DecisionContext {
  message: TelegramMessage;
  analysis: MessageAnalysis;
  conversationState: ConversationContext;
  availableTools: ToolDefinition[];
}

export interface Decision {
  action: 'respond' | 'execute_tools' | 'ask_clarification' | 'error';
  toolCalls?: ToolCall[];
  responseStrategy?: ResponseStrategy;
  metadata: Record<string, any>;
}

export interface ResponseStrategy {
  type: 'direct' | 'tool_based' | 'clarification';
  tone?: 'formal' | 'casual' | 'technical';
  includeKeyboard?: boolean;
  maxLength?: number;
}

/**
 * Tool execution types
 */
export interface ToolDefinition {
  serverId: string;
  name: string;
  description: string;
  inputSchema: any;
  outputSchema?: any;
}

export interface ToolCall {
  toolId: string;
  serverId: string;
  arguments: Record<string, any>;
}

export interface ToolResult {
  toolId: string;
  success: boolean;
  output?: any;
  error?: string;
}

/**
 * Response generation types
 */
export interface ResponseContext {
  originalMessage: string;
  analysis: MessageAnalysis;
  toolResults?: ToolResult[];
  conversationHistory: InternalMessage[];
  constraints: ResponseConstraints;
  moderationFeedback?: string;
}

export interface ResponseConstraints {
  maxLength: number;
  allowMarkdown: boolean;
  requireInlineKeyboard: boolean;
  tone?: 'formal' | 'casual' | 'technical';
}

/**
 * Base component interface
 */
export interface IComponent {
  name: string;
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  getStatus(): ComponentStatus;
}