/**
 * Decision Engine implementation with Simplified State Machine
 * Phase 1.1: Uses READY/PROCESSING/COMPLETED/ERROR states with phase metadata
 */

import { injectable, inject } from 'inversify';
import { TYPES } from '../../core/types.ts';
import { DecisionStateMachine, DecisionEvent } from './state-machine.ts';
import type {
  DecisionEngineConfig,
  ToolExecutionContext,
  DecisionMetrics,
  ProcessingPhase,
} from './types.ts';
import { StatePersistence, DenoKvStatePersistence, MemoryStatePersistence } from './state-persistence.ts';
import { ErrorRecoveryService, createErrorRecoveryService, RetryStrategy } from '../../services/error-recovery-service.ts';

import type {
  IDecisionEngine,
  IContextManager,
  IErrorHandler,
  ComponentStatus,
  DecisionContext,
  Decision,
  ToolCall,
  ToolResult,
} from '../../interfaces/component-interfaces.ts';

// Import DecisionState as runtime value (not type-only)
import { DecisionState } from '../../interfaces/component-interfaces.ts';

import {
  TelegramMessage,
  MessageAnalysis,
  SystemEvent,
  EventType,
} from '../../interfaces/message-types.ts';

import { createEventEmitter, SystemEventType } from '../../services/event-bus/index.ts';
import { TelemetryService, LogLevel, getTelemetry } from '../../services/telemetry/index.ts';

/**
 * Central orchestrator for request handling and decision flow with simplified state machine
 */
@injectable()
export class DecisionEngine implements IDecisionEngine {
  public readonly name = 'DecisionEngine';

  private stateMachine: DecisionStateMachine;
  private config: DecisionEngineConfig;
  private contextManager: IContextManager;
  private errorHandler: IErrorHandler;
  private errorRecoveryService: ErrorRecoveryService;
  private metrics: DecisionMetrics;
  private isInitialized = false;
  private eventEmitter: ReturnType<typeof createEventEmitter>;
  private statePersistence?: StatePersistence;
  private telemetry?: TelemetryService;

  constructor(
    @inject(TYPES.ContextManager) contextManager: IContextManager,
    @inject(TYPES.ErrorHandler) errorHandler: IErrorHandler,
    @inject(TYPES.DecisionEngineConfig) config: DecisionEngineConfig,
  ) {
    this.contextManager = contextManager;
    this.errorHandler = errorHandler;
    this.errorRecoveryService = createErrorRecoveryService();
    this.config = config;

    this.stateMachine = new DecisionStateMachine();
    this.metrics = {
      totalDecisions: 0,
      averageDecisionTime: 0,
      toolUsageRate: 0,
      errorRate: 0,
      stateDistribution: {} as Record<DecisionState, number>,
    };
    this.eventEmitter = createEventEmitter('DecisionEngine');
  }

  /**
   * Initialize the Decision Engine
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    // Initialize state machine
    this.stateMachine = new DecisionStateMachine();

    // Initialize state persistence if enabled
    if (this.config.enableStatePersistence) {
      try {
        // Try to use Deno KV persistence
        const kv = await Deno.openKv();
        this.statePersistence = new DenoKvStatePersistence(kv);
        console.log('[DecisionEngine] Using Deno.kv state persistence');
      } catch (error) {
        // Fall back to memory persistence if KV is not available
        console.warn('[DecisionEngine] Failed to initialize Deno KV persistence, falling back to memory:', error);
        this.statePersistence = new MemoryStatePersistence();
      }
    }

    // Reset metrics
    this.resetMetrics();

    this.isInitialized = true;

    // Emit initialization event
    await this.eventEmitter.emit({
      type: SystemEventType.COMPONENT_INITIALIZED,
      payload: {
        componentName: this.name,
        timestamp: new Date(),
      },
    });

    if (this.config.debugMode) {
      console.log('[DecisionEngine] Initialized successfully');
    }
  }

  /**
   * Shutdown the Decision Engine
   */
  async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    // Clean up state machine
    this.stateMachine.cleanup(0); // Clean all

    this.isInitialized = false;

    if (this.config.debugMode) {
      console.log('[DecisionEngine] Shutdown completed');
    }
  }

  /**
   * Get component status
   */
  getStatus(): ComponentStatus {
    const activeChats = this.stateMachine.getActiveChats().length;
    const stateDistribution = this.stateMachine.getStateDistribution();
    const phaseDistribution = this.stateMachine.getPhaseDistribution();

    return {
      name: this.name,
      status: this.isInitialized ? 'healthy' : 'unhealthy',
      lastHealthCheck: new Date(),
      metadata: {
        activeChats,
        stateDistribution,
        phaseDistribution,
        metrics: this.metrics,
      },
    };
  }

  /**
   * Set telemetry service for structured logging
   */
  setTelemetry(telemetry: TelemetryService): void {
    this.telemetry = telemetry;
  }

  /**
   * Make a decision based on the context using simplified state machine
   */
  async makeDecision(context: DecisionContext): Promise<Decision> {
    // Use telemetry wrapper if available
    if (this.telemetry) {
      return await this.telemetry.withTrace(
        'DecisionEngine',
        'makeDecision',
        async () => await this.makeDecisionWithTelemetry(context),
      );
    }

    // Fallback to original method without telemetry
    return await this.makeDecisionWithoutTelemetry(context);
  }

  /**
   * Make decision with telemetry tracking
   */
  private async makeDecisionWithTelemetry(context: DecisionContext): Promise<Decision> {
    const startTime = Date.now();
    const chatId = context.message.chatId;

    try {
      this.telemetry?.logStructured({
        level: LogLevel.INFO,
        component: 'DecisionEngine',
        phase: 'decision_start',
        message: 'Starting decision process',
        metadata: {
          chatId: chatId.toString(),
          messageId: context.message.messageId?.toString(),
          intent: context.analysis.intent,
          confidence: context.analysis.confidence,
          currentState: this.stateMachine.getCurrentState(chatId),
          platform: context.platform,
        },
      });

      console.log(`[ROO_DEBUG] [DecisionEngine] makeDecision() STARTED - ChatId: ${chatId}, Platform: ${context.platform}, Initial state: ${this.stateMachine.getCurrentState(chatId)}`);

      // Load persisted state if available
      if (this.statePersistence && !this.stateMachine.hasState(chatId)) {
        console.log(`[ROO_DEBUG] [DecisionEngine] Attempting to load persisted state for ChatId: ${chatId}`);
        const persistedState = await this.statePersistence.loadState(chatId);
        if (persistedState) {
          console.log(`[ROO_DEBUG] [DecisionEngine] Successfully loaded persisted state for ChatId: ${chatId}`, persistedState);
          // Restore state to state machine
          this.stateMachine.restoreState(chatId, persistedState);
          this.telemetry?.logStructured({
            level: LogLevel.INFO,
            component: 'DecisionEngine',
            phase: 'state_restoration',
            message: 'Restored persisted state',
            metadata: { chatId: chatId.toString(), restoredState: persistedState },
          });
          if (this.config.debugMode) {
            console.log(`[DecisionEngine] Restored persisted state for chat ${chatId}`);
          }
        } else {
          console.log(`[ROO_DEBUG] [DecisionEngine] No persisted state found for ChatId: ${chatId}.`);
        }
      }

      // Ensure this chat has an active state
      if (!this.stateMachine.hasState(chatId)) {
        console.log(`[ROO_DEBUG] [DecisionEngine] No active state for ChatId: ${chatId}. Initializing new state.`);
        this.stateMachine.initializeChatState(chatId);
        this.telemetry?.logStructured({
          level: LogLevel.INFO,
          component: 'DecisionEngine',
          phase: 'state_initialization',
          message: 'Initialized new chat state',
          metadata: { chatId: chatId.toString() },
        });
      }

      // Update metrics
      this.metrics.totalDecisions++;

      // Store the decision context in state data
      this.stateMachine.setStateData(chatId, 'decisionContext', context);

      // Start processing with analysis phase
      this.stateMachine.startProcessing(chatId, 'analysis', {
        messageId: context.message.messageId,
        userId: context.message.userId,
      });

      this.telemetry?.logStructured({
        level: LogLevel.INFO,
        component: 'DecisionEngine',
        phase: 'state_transition',
        message: 'Transitioned to analysis phase',
        metadata: {
          chatId: chatId.toString(),
          currentState: this.stateMachine.getCurrentState(chatId),
          currentPhase: this.stateMachine.getCurrentPhase(chatId),
        },
      });

      // Save state after transition
      if (this.statePersistence) {
        await this.saveCurrentState(chatId);
      }

      // Perform analysis and decision making with error recovery
      console.log(`[ROO_DEBUG] [DecisionEngine] Starting analysis phase - Current state: ${this.stateMachine.getCurrentState(chatId)}, Phase: ${this.stateMachine.getCurrentPhase(chatId)}`);
      const decision = await this.errorRecoveryService.executeWithRetry(
        async () => await this.analyzeAndDecide(context),
        {
          strategy: RetryStrategy.EXPONENTIAL_BACKOFF,
          maxAttempts: 3,
          onRetry: (error: Error, attempt: number, delay: number) => {
            console.log(`[DecisionEngine] Retrying analysis phase (attempt ${attempt}/${3}): ${error.message}`);
            this.telemetry?.logStructured({
              level: LogLevel.WARN,
              component: 'DecisionEngine',
              phase: 'retry_attempt',
              message: 'Retrying analysis phase',
              metadata: {
                chatId: chatId.toString(),
                attempt,
                maxAttempts: 3,
                error: error.message,
              },
            });
          },
        },
      );

      this.telemetry?.logStructured({
        level: LogLevel.INFO,
        component: 'DecisionEngine',
        phase: 'decision_complete',
        message: 'Decision made successfully',
        metadata: {
          chatId: chatId.toString(),
          action: decision.action,
          toolCallsCount: decision.toolCalls?.length ?? 0,
          responseStrategy: decision.responseStrategy?.type,
          currentState: this.stateMachine.getCurrentState(chatId),
          currentPhase: this.stateMachine.getCurrentPhase(chatId),
        },
      });

      console.log(`[ROO_DEBUG] [DecisionEngine] Decision made:`, {
        action: decision.action,
        toolCallsCount: decision.toolCalls?.length ?? 0,
        responseStrategy: decision.responseStrategy?.type,
        currentState: this.stateMachine.getCurrentState(chatId),
        currentPhase: this.stateMachine.getCurrentPhase(chatId),
      });

      // Complete processing
      console.log(`[ROO_DEBUG] [DecisionEngine] Completing processing for ChatId: ${chatId}`);
      this.stateMachine.completeProcessing(chatId, {
        decision: decision.action,
        hasToolCalls: !!decision.toolCalls?.length,
      });

      // Save final state
      if (this.statePersistence) {
        await this.saveCurrentState(chatId);
      }

      console.log(`[DecisionEngine] Final state after decision: ${this.stateMachine.getCurrentState(chatId)}`);

      // Update metrics
      const duration = Date.now() - startTime;
      this.updateAverageDecisionTime(duration);

      this.telemetry?.logStructured({
        level: LogLevel.INFO,
        component: 'DecisionEngine',
        phase: 'decision_end',
        message: 'Decision process completed',
        metadata: {
          chatId: chatId.toString(),
          duration,
          finalState: this.stateMachine.getCurrentState(chatId),
        },
        duration,
      });

      if (decision.toolCalls && decision.toolCalls.length > 0) {
        this.metrics.toolUsageRate = this.calculateToolUsageRate();
      }

      // Emit decision made event
      await this.eventEmitter.emit({
        type: SystemEventType.DECISION_MADE,
        payload: {
          message: context.message,
          decision,
          requestId: context.message.messageId.toString(),
        },
      });

      return decision;

    } catch (error) {
      // Handle error with simplified state machine
      const currentState = this.stateMachine.getCurrentState(chatId);
      console.error(`[ROO_DEBUG] [DecisionEngine] CRITICAL ERROR occurred in state: ${currentState}, Phase: ${this.stateMachine.getCurrentPhase(chatId)}`, error);

      this.telemetry?.logStructured({
        level: LogLevel.ERROR,
        component: 'DecisionEngine',
        phase: 'error_occurred',
        message: 'Error in decision process',
        metadata: {
          chatId: chatId.toString(),
          currentState,
          currentPhase: this.stateMachine.getCurrentPhase(chatId),
          error: error.message,
        },
        error: error as Error,
      });

      // Transition to ERROR state
      console.log(`[ROO_DEBUG] [DecisionEngine] Transitioning to ERROR state due to: ${error.message}`);
      this.stateMachine.transition(chatId, DecisionEvent.ERROR_OCCURRED, {
        error: error.message,
        errorPhase: this.stateMachine.getCurrentPhase(chatId),
      });

      // Save state after transition
      if (this.statePersistence) {
        await this.saveCurrentState(chatId);
      }

      this.metrics.errorRate = this.calculateErrorRate();

      // Emit component error event
      console.log(`[ROO_DEBUG] [DecisionEngine] Emitting COMPONENT_ERROR event.`);
      await this.eventEmitter.emit({
        type: SystemEventType.COMPONENT_ERROR,
        payload: {
          componentName: this.name,
          error: error as Error,
        },
        metadata: {
          operation: 'makeDecision',
          chatId,
          messageId: context.message.messageId,
        },
      });

      if (this.errorHandler) {
        const platform = context.platform || Platform.TELEGRAM; // Default to Telegram for safety
        console.log(`[ROO_DEBUG] [DecisionEngine] Forwarding error to ErrorHandler for platform: ${platform}`);
        const errorResult = await this.errorHandler.handleError(
          error as Error,
          {
            operation: 'makeDecision',
            component: this.name,
            chatId,
            messageId: context.message.messageId,
            metadata: { context },
          },
          platform
        );
        console.log(`[ROO_DEBUG] [DecisionEngine] ErrorHandler result: `, errorResult);

        if (errorResult.handled) {
          console.log(`[ROO_DEBUG] [DecisionEngine] Error was handled by ErrorHandler. Returning error action.`);
          return {
            action: 'error',
            metadata: {
              error: error.message,
              userMessage: errorResult.userMessage,
            },
          };
        }
      }

      console.error(`[ROO_DEBUG] [DecisionEngine] Error was not handled. Rethrowing.`);
      throw error;
    }
  }

  /**
   * Make decision without telemetry (fallback)
   */
  private async makeDecisionWithoutTelemetry(context: DecisionContext): Promise<Decision> {
    const startTime = Date.now();
    const chatId = context.message.chatId;

    try {
      console.log(`[DecisionEngine] makeDecision() STARTED - ChatId: ${chatId}, Initial state: ${this.stateMachine.getCurrentState(chatId)}`);

      // Load persisted state if available
      if (this.statePersistence && !this.stateMachine.hasState(chatId)) {
        const persistedState = await this.statePersistence.loadState(chatId);
        if (persistedState) {
          // Restore state to state machine
          this.stateMachine.restoreState(chatId, persistedState);
          if (this.config.debugMode) {
            console.log(`[DecisionEngine] Restored persisted state for chat ${chatId}`);
          }
        }
      }

      // Ensure this chat has an active state
      if (!this.stateMachine.hasState(chatId)) {
        this.stateMachine.initializeChatState(chatId);
      }

      // Update metrics
      this.metrics.totalDecisions++;

      // Store the decision context in state data
      this.stateMachine.setStateData(chatId, 'decisionContext', context);

      // Start processing with analysis phase
      this.stateMachine.startProcessing(chatId, 'analysis', {
        messageId: context.message.messageId,
        userId: context.message.userId,
      });

      // Save state after transition
      if (this.statePersistence) {
        await this.saveCurrentState(chatId);
      }

      // Perform analysis and decision making with error recovery
      console.log(`[DecisionEngine] Starting analysis phase - Current state: ${this.stateMachine.getCurrentState(chatId)}, Phase: ${this.stateMachine.getCurrentPhase(chatId)}`);
      const decision = await this.errorRecoveryService.executeWithRetry(
        async () => await this.analyzeAndDecide(context),
        {
          strategy: RetryStrategy.EXPONENTIAL_BACKOFF,
          maxAttempts: 3,
          onRetry: (error: Error, attempt: number, delay: number) => {
            console.log(`[DecisionEngine] Retrying analysis phase (attempt ${attempt}/${3}): ${error.message}`);
          },
        },
      );
      console.log(`[DecisionEngine] Decision made:`, {
        action: decision.action,
        toolCallsCount: decision.toolCalls?.length ?? 0,
        responseStrategy: decision.responseStrategy?.type,
        currentState: this.stateMachine.getCurrentState(chatId),
        currentPhase: this.stateMachine.getCurrentPhase(chatId),
      });

      // Complete processing
      this.stateMachine.completeProcessing(chatId, {
        decision: decision.action,
        hasToolCalls: !!decision.toolCalls?.length,
      });

      // Save final state
      if (this.statePersistence) {
        await this.saveCurrentState(chatId);
      }

      console.log(`[DecisionEngine] Final state after decision: ${this.stateMachine.getCurrentState(chatId)}`);

      // Update metrics
      const duration = Date.now() - startTime;
      this.updateAverageDecisionTime(duration);

      if (decision.toolCalls && decision.toolCalls.length > 0) {
        this.metrics.toolUsageRate = this.calculateToolUsageRate();
      }

      // Emit decision made event
      await this.eventEmitter.emit({
        type: SystemEventType.DECISION_MADE,
        payload: {
          message: context.message,
          decision,
          requestId: context.message.messageId.toString(),
        },
      });

      return decision;

    } catch (error) {
      // Handle error with simplified state machine
      const currentState = this.stateMachine.getCurrentState(chatId);
      console.log(`[DecisionEngine] Error occurred in state: ${currentState}, Phase: ${this.stateMachine.getCurrentPhase(chatId)}`);

      // Transition to ERROR state
      console.log(`[DecisionEngine] Transitioning to ERROR state due to: ${error.message}`);
      this.stateMachine.transition(chatId, DecisionEvent.ERROR_OCCURRED, {
        error: error.message,
        errorPhase: this.stateMachine.getCurrentPhase(chatId),
      });

      // Save state after transition
      if (this.statePersistence) {
        await this.saveCurrentState(chatId);
      }

      this.metrics.errorRate = this.calculateErrorRate();

      // Emit component error event
      await this.eventEmitter.emit({
        type: SystemEventType.COMPONENT_ERROR,
        payload: {
          componentName: this.name,
          error: error as Error,
        },
        metadata: {
          operation: 'makeDecision',
          chatId,
          messageId: context.message.messageId,
        },
      });

      if (this.errorHandler) {
        const errorResult = await this.errorHandler.handleError(error as Error, {
          operation: 'makeDecision',
          component: this.name,
          chatId,
          metadata: { context },
        });

        if (errorResult.handled) {
          return {
            action: 'error',
            metadata: {
              error: error.message,
              userMessage: errorResult.userMessage,
            },
          };
        }
      }

      throw error;
    }
  }

  /**
   * Save current state to persistence
   */
  private async saveCurrentState(chatId: number): Promise<void> {
    if (this.statePersistence) {
      const context = this.stateMachine.getContext(chatId);
      if (context) {
        await this.statePersistence.saveState(chatId, context);
      }
    }
  }

  /**
   * Process tool execution results using simplified state machine
   */
  async processToolResults(results: ToolResult[]): Promise<Decision> {
    const activeChats = this.stateMachine.getActiveChats();

    if (activeChats.length === 0) {
      throw new Error('No active chat context for tool results');
    }

    // For simplicity, use the first active chat
    // In a real implementation, you'd track which chat the tools belong to
    const chatId = activeChats[0];

    try {
      // Get the original decision context
      const originalContext = this.stateMachine.getStateData(chatId, 'decisionContext') as DecisionContext;

      if (!originalContext) {
        throw new Error('No original decision context found');
      }

      // Transition to generation phase to process tool results
      if (this.stateMachine.getCurrentState(chatId) === DecisionState.PROCESSING) {
        this.stateMachine.transitionToPhase(chatId, 'generation', {
          resultCount: results.length,
          successCount: results.filter(r => r.success).length,
        });
      }

      // Save state after transition
      if (this.statePersistence) {
        await this.saveCurrentState(chatId);
      }

      // Create decision with tool results
      const decision: Decision = {
        action: 'respond',
        responseStrategy: {
          type: 'tool_based',
          tone: 'technical',
          includeKeyboard: false,
        },
        metadata: {
          toolResults: results,
          originalAnalysis: originalContext.analysis,
        },
      };

      return decision;

    } catch (error) {
      // Check if error is retryable using centralized service
      const isRetryable = this.errorRecoveryService.isRetryableError(error as Error);

      this.stateMachine.transition(chatId, DecisionEvent.ERROR_OCCURRED, {
        error: error.message,
        phase: 'tool_processing',
        retryable: isRetryable,
      });

      // Save state after transition
      if (this.statePersistence) {
        await this.saveCurrentState(chatId);
      }

      throw error;
    }
  }

  /**
   * Handle errors in the decision flow
   */
  async handleError(error: Error, context: DecisionContext): Promise<Decision> {
    const chatId = context.message.chatId;

    // Transition to error state
    this.stateMachine.transition(chatId, DecisionEvent.ERROR_OCCURRED, {
      error: error.message,
      context: context.message.messageId,
    });

    // Save state after transition
    if (this.statePersistence) {
      await this.saveCurrentState(chatId);
    }

    // Use error handler if available
    if (this.errorHandler) {
      const errorResult = await this.errorHandler.handleError(error, {
        operation: 'decision_flow',
        component: this.name,
        chatId,
        metadata: { context },
      });

      return {
        action: 'error',
        metadata: {
          error: error.message,
          userMessage: errorResult.userMessage,
          retry: errorResult.retry,
        },
      };
    }

    // Default error response
    return {
      action: 'error',
      metadata: {
        error: error.message,
        userMessage: 'An error occurred while processing your request. Please try again.',
      },
    };
  }

  /**
   * Get current state for a chat
   */
  async getCurrentState(chatId: number): Promise<DecisionState> {
    return this.stateMachine.getCurrentState(chatId);
  }

  /**
   * Transition to a specific state
   */
  async transitionTo(chatId: number, state: DecisionState): Promise<void> {
    this.stateMachine.setState(chatId, state);
  }

  /**
   * Reset chat state
   */
  resetChatState(chatId: number): void {
    this.stateMachine.reset(chatId);
  }

  /**
   * Get decision metrics
   */
  getMetrics(): DecisionMetrics {
    return {
      ...this.metrics,
      stateDistribution: this.stateMachine.getStateDistribution(),
    };
  }

  /**
   * Analyze context and make decision using phase-based approach
   */
  private async analyzeAndDecide(context: DecisionContext): Promise<Decision> {
    const { analysis, availableTools, conversationState } = context;
    const chatId = context.message.chatId;

    // Extract tool names from ToolDefinition[]
    const availableToolNames = availableTools.map(tool => tool.name);

    // Log decision process in debug mode
    if (this.config.debugMode) {
      console.log('[DecisionEngine] Making decision:', {
        intent: analysis.intent,
        confidence: analysis.confidence,
        suggestedTools: analysis.suggestedTools,
        availableTools: availableToolNames,
      });
    }

    // Check confidence threshold first
    if (analysis.confidence < this.config.confidenceThreshold) {
      return this.createClarificationDecision(analysis);
    }

    // Transition to decision phase
    console.log(`[DecisionEngine] TRANSITIONING TO DECISION PHASE`);
    this.stateMachine.transitionToPhase(chatId, 'decision', {
      intent: analysis.intent,
      confidence: analysis.confidence,
    });

    this.telemetry?.logStructured({
      level: LogLevel.INFO,
      component: 'DecisionEngine',
      phase: 'decision_phase',
      message: 'Transitioned to decision phase',
      metadata: {
        chatId: chatId.toString(),
        intent: analysis.intent,
        confidence: analysis.confidence,
        availableTools: availableToolNames,
      },
    });

    // Save state after transition
    if (this.statePersistence) {
      await this.saveCurrentState(chatId);
    }

    // Apply decision rules based on intent
    console.log(`[DecisionEngine] Processing intent: ${analysis.intent} with confidence: ${analysis.confidence}`);

    try {
      switch (analysis.intent) {
        case 'tool_request':
          return await this.handleToolRequestIntent(analysis, availableToolNames, chatId);

        case 'command':
          return await this.handleCommandIntent(analysis, availableToolNames, chatId);

        case 'question':
          return await this.handleQuestionIntent(analysis, availableToolNames, chatId);

        case 'conversation':
          return await this.handleConversationIntent(analysis, chatId);

        default:
          // Direct response for unknown intents
          return this.createDirectResponseDecision(analysis, 'casual');
      }
    } catch (error) {
      console.error('[DecisionEngine] Error in analyzeAndDecide:', error);
      throw error;
    }
  }

  /**
   * Handle tool request intent with phase tracking
   */
  private async handleToolRequestIntent(
    analysis: MessageAnalysis,
    availableTools: string[],
    chatId: number,
  ): Promise<Decision> {
    const suggestedTools = analysis.suggestedTools || [];
    const matchingTools = this.findMatchingTools(suggestedTools, availableTools);

    if (matchingTools.length > 0) {
      // Transition to tool_execution phase
      this.stateMachine.transitionToPhase(chatId, 'tool_execution', {
        toolCount: matchingTools.length,
        tools: matchingTools,
      });

      this.telemetry?.logStructured({
        level: LogLevel.INFO,
        component: 'DecisionEngine',
        phase: 'tool_execution_phase',
        message: 'Transitioned to tool execution phase',
        metadata: {
          chatId: chatId.toString(),
          toolCount: matchingTools.length,
          tools: matchingTools,
          intent: analysis.intent,
        },
      });

      if (this.statePersistence) {
        await this.saveCurrentState(chatId);
      }

      return {
        action: 'execute_tools',
        toolCalls: matchingTools.map(toolId => ({
          toolId,
          serverId: 'default',
          name: toolId,
          arguments: {},
        })),
        responseStrategy: {
          type: 'tool_based',
          tone: 'technical',
          includeKeyboard: false,
        },
        metadata: {
          intent: analysis.intent,
          confidence: analysis.confidence,
          suggestedTools,
          matchingTools,
        },
      };
    } else {
      // No matching tools, transition to generation phase for direct response
      this.stateMachine.transitionToPhase(chatId, 'generation', {
        noMatchingTools: true,
      });

      this.telemetry?.logStructured({
        level: LogLevel.WARN,
        component: 'DecisionEngine',
        phase: 'no_matching_tools',
        message: 'No matching tools found for request',
        metadata: {
          chatId: chatId.toString(),
          suggestedTools,
          availableTools,
          intent: analysis.intent,
        },
      });

      if (this.statePersistence) {
        await this.saveCurrentState(chatId);
      }

      return this.createDirectResponseDecision(analysis, 'technical');
    }
  }

  /**
   * Handle command intent with phase tracking
   */
  private async handleCommandIntent(
    analysis: MessageAnalysis,
    availableTools: string[],
    chatId: number,
  ): Promise<Decision> {
    const suggestedTools = analysis.suggestedTools || [];
    const matchingTools = this.findMatchingTools(suggestedTools, availableTools);

    if (matchingTools.length > 0) {
      // Transition to tool_execution phase
      this.stateMachine.transitionToPhase(chatId, 'tool_execution', {
        commandType: 'tool_command',
        toolCount: matchingTools.length,
      });

      if (this.statePersistence) {
        await this.saveCurrentState(chatId);
      }

      return {
        action: 'execute_tools',
        toolCalls: matchingTools.map(toolId => ({
          toolId,
          serverId: 'default',
          name: toolId,
          arguments: {},
        })),
        responseStrategy: {
          type: 'tool_based',
          tone: 'formal',
          includeKeyboard: true,
        },
        metadata: {
          intent: analysis.intent,
          confidence: analysis.confidence,
          commandType: 'tool_execution',
        },
      };
    } else {
      // Direct command response, transition to generation phase
      this.stateMachine.transitionToPhase(chatId, 'generation', {
        commandType: 'direct_command',
      });

      if (this.statePersistence) {
        await this.saveCurrentState(chatId);
      }

      return this.createDirectResponseDecision(analysis, 'formal');
    }
  }

  /**
   * Handle question intent with phase tracking
   */
  private async handleQuestionIntent(
    analysis: MessageAnalysis,
    availableTools: string[],
    chatId: number,
  ): Promise<Decision> {
    const suggestedTools = analysis.suggestedTools || [];
    const matchingTools = this.findMatchingTools(suggestedTools, availableTools);
    const toolRelevance = this.calculateToolRelevance(analysis);

    if (matchingTools.length > 0 && toolRelevance > 0.5) {
      // Transition to tool_execution phase
      this.stateMachine.transitionToPhase(chatId, 'tool_execution', {
        questionType: 'tool_assisted',
        toolRelevance,
        toolCount: matchingTools.length,
      });

      if (this.statePersistence) {
        await this.saveCurrentState(chatId);
      }

      return {
        action: 'execute_tools',
        toolCalls: matchingTools.map(toolId => ({
          toolId,
          serverId: 'default',
          name: toolId,
          arguments: {},
        })),
        responseStrategy: {
          type: 'tool_based',
          tone: this.determineTone(analysis),
          includeKeyboard: false,
        },
        metadata: {
          intent: analysis.intent,
          confidence: analysis.confidence,
          toolRelevance,
          questionType: 'research',
        },
      };
    } else {
      // Direct answer, transition to generation phase
      this.stateMachine.transitionToPhase(chatId, 'generation', {
        questionType: 'direct_answer',
      });

      if (this.statePersistence) {
        await this.saveCurrentState(chatId);
      }

      return this.createDirectResponseDecision(analysis, this.determineTone(analysis));
    }
  }

  /**
   * Handle conversation intent with phase tracking
   */
  private async handleConversationIntent(analysis: MessageAnalysis, chatId: number): Promise<Decision> {
    // Transition to generation phase for conversational response
    this.stateMachine.transitionToPhase(chatId, 'generation', {
      conversationType: 'casual_chat',
    });

    if (this.statePersistence) {
      await this.saveCurrentState(chatId);
    }

    return this.createDirectResponseDecision(analysis, 'casual');
  }

  /**
   * Create clarification decision
   */
  private createClarificationDecision(analysis: MessageAnalysis): Decision {
    return {
      action: 'ask_clarification',
      responseStrategy: {
        type: 'clarification',
        tone: 'casual',
        includeKeyboard: true,
      },
      metadata: {
        intent: analysis.intent,
        confidence: analysis.confidence,
        reason: 'low_confidence',
      },
    };
  }

  /**
   * Create direct response decision
   */
  private createDirectResponseDecision(
    analysis: MessageAnalysis,
    tone: 'formal' | 'casual' | 'technical',
  ): Decision {
    return {
      action: 'respond',
      responseStrategy: {
        type: 'direct',
        tone,
        includeKeyboard: false,
      },
      metadata: {
        intent: analysis.intent,
        confidence: analysis.confidence,
      },
    };
  }

  private findMatchingTools(suggested: string[], available: string[]): string[] {
    return suggested.filter(tool => available.includes(tool));
  }

  private calculateToolRelevance(analysis: MessageAnalysis): number {
    // Simple heuristic: tool relevance based on keywords and confidence
    const toolKeywords = ['search', 'find', 'get', 'fetch', 'calculate', 'analyze'];
    const messageWords = analysis.intent.toLowerCase().split(' ');
    const matches = messageWords.filter(word => toolKeywords.includes(word));
    return Math.min(matches.length / messageWords.length + analysis.confidence * 0.3, 1.0);
  }

  private determineTone(analysis: MessageAnalysis): 'formal' | 'casual' | 'technical' {
    if (analysis.intent.includes('question') || analysis.intent.includes('help')) {
      return analysis.confidence > 0.8 ? 'technical' : 'formal';
    }
    return 'casual';
  }

  // Metrics methods
  private updateAverageDecisionTime(duration: number): void {
    const totalTime = this.metrics.averageDecisionTime * (this.metrics.totalDecisions - 1) + duration;
    this.metrics.averageDecisionTime = totalTime / this.metrics.totalDecisions;
  }

  private calculateToolUsageRate(): number {
    // Implementation depends on tracking tool usage vs direct responses
    return 0.7; // Placeholder
  }

  private calculateErrorRate(): number {
    // Implementation depends on tracking errors vs successful decisions
    return 0.05; // Placeholder
  }

  private resetMetrics(): void {
    this.metrics = {
      totalDecisions: 0,
      averageDecisionTime: 0,
      toolUsageRate: 0,
      errorRate: 0,
      stateDistribution: {} as Record<DecisionState, number>,
    };
  }
}
