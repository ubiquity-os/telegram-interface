/**
 * Decision Engine implementation
 */

import { injectable, inject } from 'npm:inversify@7.5.4';
import { TYPES } from '../../core/types.ts';
import { DecisionStateMachine, DecisionEvent } from './state-machine.ts';
import {
  DecisionEngineConfig,
  ToolExecutionContext,
  DecisionMetrics
} from './types.ts';
import { StatePersistence, RedisStatePersistence, MemoryStatePersistence } from './state-persistence.ts';

import type {
  IDecisionEngine,
  IContextManager,
  IErrorHandler,
  ComponentStatus,
  DecisionContext,
  Decision,
  ToolCall,
  ToolResult
} from '../../interfaces/component-interfaces.ts';

// Import DecisionState as runtime value (not type-only)
import { DecisionState } from '../../interfaces/component-interfaces.ts';

import {
  TelegramMessage,
  MessageAnalysis,
  SystemEvent,
  EventType
} from '../../interfaces/message-types.ts';

import { createEventEmitter, SystemEventType } from '../../services/event-bus/index.ts';

/**
 * Central orchestrator for request handling and decision flow
 */
@injectable()
export class DecisionEngine implements IDecisionEngine {
  public readonly name = 'DecisionEngine';

  private stateMachine: DecisionStateMachine;
  private config: DecisionEngineConfig;
  private contextManager: IContextManager;
  private errorHandler: IErrorHandler;
  private metrics: DecisionMetrics;
  private isInitialized = false;
  private eventEmitter: ReturnType<typeof createEventEmitter>;
  private statePersistence?: StatePersistence;

  constructor(
    @inject(TYPES.ContextManager) contextManager: IContextManager,
    @inject(TYPES.ErrorHandler) errorHandler: IErrorHandler,
    config?: Partial<DecisionEngineConfig>
  ) {
    this.contextManager = contextManager;
    this.errorHandler = errorHandler;
    this.config = {
      maxStateRetention: 1000,
      defaultTimeout: 30000,
      enableStatePersistence: true,
      debugMode: false,
      confidenceThreshold: 0.6,
      ...config
    };

    this.stateMachine = new DecisionStateMachine();
    this.metrics = {
      totalDecisions: 0,
      averageDecisionTime: 0,
      toolUsageRate: 0,
      errorRate: 0,
      stateDistribution: {} as Record<DecisionState, number>
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
        // Try to use Redis persistence with Deno KV
        const kv = await Deno.openKv();
        this.statePersistence = new RedisStatePersistence(kv);
        console.log('[DecisionEngine] Using Redis state persistence');
      } catch (error) {
        // Fall back to memory persistence if KV is not available
        console.warn('[DecisionEngine] Failed to initialize Redis persistence, falling back to memory:', error);
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
        timestamp: new Date()
      }
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

    return {
      name: this.name,
      status: this.isInitialized ? 'healthy' : 'unhealthy',
      lastHealthCheck: new Date(),
      metadata: {
        activeChats,
        stateDistribution,
        metrics: this.metrics
      }
    };
  }

  /**
   * Make a decision based on the context
   */
  async makeDecision(context: DecisionContext): Promise<Decision> {
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


      // Transition to MESSAGE_RECEIVED state
      this.stateMachine.transition(chatId, DecisionEvent.MESSAGE_RECEIVED, {
        messageId: context.message.messageId,
        userId: context.message.userId
      });

      // Save state after transition
      if (this.statePersistence) {
        await this.saveCurrentState(chatId);
      }

      // Store the decision context in state data
      this.stateMachine.setStateData(chatId, 'decisionContext', context);

      // Transition to PREPROCESSING
      this.stateMachine.transition(chatId, DecisionEvent.ANALYSIS_COMPLETE);

      // Save state after transition
      if (this.statePersistence) {
        await this.saveCurrentState(chatId);
      }

      // Make the actual decision
      console.log(`[DecisionEngine] About to analyze and decide - Current state: ${this.stateMachine.getCurrentState(chatId)}`);
      const decision = await this.analyzeAndDecide(context);
      console.log(`[DecisionEngine] Decision made:`, {
        action: decision.action,
        toolCallsCount: decision.toolCalls?.length ?? 0,
        responseStrategy: decision.responseStrategy?.type,
        currentState: this.stateMachine.getCurrentState(chatId)
      });

      // The analyzeAndDecide method should have already handled the state transitions
      // No additional transitions needed here since analyzeAndDecide handles the flow
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
          requestId: context.message.messageId.toString()
        }
      });

      return decision;

    } catch (error) {
      // DIAGNOSTIC: Log error transition attempt
      const currentState = this.stateMachine.getCurrentState(chatId);
      console.log(`[DecisionEngine] DIAGNOSTIC - Error occurred in state: ${currentState}`);
      console.log(`[DecisionEngine] DIAGNOSTIC - Attempting to transition ERROR_OCCURRED from ${currentState}`);

      // FIX: Only transition to error if not already in error state
      if (currentState !== DecisionState.ERROR) {
        console.log(`[DecisionEngine] Transitioning to ERROR state due to: ${error.message}`);
        this.stateMachine.transition(chatId, DecisionEvent.ERROR_OCCURRED, {
          error: error.message
        });
      } else {
        console.log(`[DecisionEngine] Already in ERROR state, resetting to IDLE instead`);
        this.stateMachine.transition(chatId, DecisionEvent.RESET);
      }

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
          error: error as Error
        },
        metadata: {
          operation: 'makeDecision',
          chatId,
          messageId: context.message.messageId
        }
      });

      if (this.errorHandler) {
        const errorResult = await this.errorHandler.handleError(error as Error, {
          operation: 'makeDecision',
          component: this.name,
          chatId,
          metadata: { context }
        });

        if (errorResult.handled) {
          return {
            action: 'error',
            metadata: {
              error: error.message,
              userMessage: errorResult.userMessage
            }
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
   * Process tool execution results
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
      // Transition to response generation
      this.stateMachine.transition(chatId, DecisionEvent.TOOLS_COMPLETE, {
        resultCount: results.length,
        successCount: results.filter(r => r.success).length
      });

      // Save state after transition
      if (this.statePersistence) {
        await this.saveCurrentState(chatId);
      }

      // Get the original decision context
      const originalContext = this.stateMachine.getStateData(chatId, 'decisionContext') as DecisionContext;

      if (!originalContext) {
        throw new Error('No original decision context found');
      }

      // Create decision with tool results
      const decision: Decision = {
        action: 'respond',
        responseStrategy: {
          type: 'tool_based',
          tone: 'technical',
          includeKeyboard: false
        },
        metadata: {
          toolResults: results,
          originalAnalysis: originalContext.analysis
        }
      };

      return decision;

    } catch (error) {
      this.stateMachine.transition(chatId, DecisionEvent.ERROR_OCCURRED, {
        error: error.message,
        phase: 'tool_processing'
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
      context: context.message.messageId
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
        metadata: { context }
      });

      return {
        action: 'error',
        metadata: {
          error: error.message,
          userMessage: errorResult.userMessage,
          retry: errorResult.retry
        }
      };
    }

    // Default error response
    return {
      action: 'error',
      metadata: {
        error: error.message,
        userMessage: 'An error occurred while processing your request. Please try again.'
      }
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
      stateDistribution: this.stateMachine.getStateDistribution()
    };
  }

  /**
   * Analyze context and make decision
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
        availableTools: availableToolNames
      });
    }

    // Check confidence threshold first
    if (analysis.confidence < this.config.confidenceThreshold) {
      return this.createClarificationDecision(analysis);
    }

    // Transition to DECISION_POINT state
    console.log(`[DecisionEngine] TRANSITIONING: ${this.stateMachine.getCurrentState(chatId)} -> DECISION_POINT`);
    this.stateMachine.transition(chatId, DecisionEvent.ANALYSIS_COMPLETE);
    console.log(`[DecisionEngine] Successfully transitioned to: ${this.stateMachine.getCurrentState(chatId)}`);

    // Save state after transition
    if (this.statePersistence) {
      await this.saveCurrentState(chatId);
    }

    // Apply decision rules based on intent
    console.log(`[DecisionEngine] Processing intent: ${analysis.intent} with confidence: ${analysis.confidence}`);

    try {
      switch (analysis.intent) {
        case 'tool_request':
          return await this.handleToolRequestIntent(context, analysis, availableToolNames, chatId);

        case 'command':
          return await this.handleCommandIntent(analysis, availableToolNames, chatId);

        case 'question':
          return await this.handleQuestionIntent(analysis, availableToolNames, chatId);

        case 'conversation':
          return await this.handleConversationIntent(analysis, chatId);

        default:
          // Fallback for unknown intents - transition to direct response
          console.log(`[DecisionEngine] Unknown intent: ${analysis.intent}, using direct response`);
          this.stateMachine.transition(chatId, DecisionEvent.DIRECT_RESPONSE);

          // Save state after transition
          if (this.statePersistence) {
            await this.saveCurrentState(chatId);
          }

          return this.createDirectResponseDecision(analysis, 'casual');
      }
    } catch (error) {
      console.error(`[DecisionEngine] Error in intent handling:`, error);
      this.stateMachine.transition(chatId, DecisionEvent.ERROR_OCCURRED, {
        error: error.message,
        intent: analysis.intent
      });

      // Save state after transition
      if (this.statePersistence) {
        await this.saveCurrentState(chatId);
      }

      throw error;
    }
  }

  /**
   * Handle tool_request intent
   */
  private async handleToolRequestIntent(
    context: DecisionContext,
    analysis: MessageAnalysis,
    availableTools: string[],
    chatId: number
  ): Promise<Decision> {
    // Check if suggested tools are available
    const matchingTools = this.findMatchingTools(analysis.suggestedTools || [], availableTools);

    if (matchingTools.length > 0) {
      this.stateMachine.transition(chatId, DecisionEvent.TOOLS_REQUIRED, {
        toolCount: matchingTools.length
      });

      // Save state after transition
      if (this.statePersistence) {
        await this.saveCurrentState(chatId);
      }

      // Emit decision made event for tool execution
      await this.eventEmitter.emit({
        type: SystemEventType.DECISION_MADE,
        payload: {
          message: context.message,
          decision: {
            action: 'execute_tools',
            toolCalls: matchingTools.map(toolId => ({
              toolId,
              serverId: 'default',
              arguments: {}
            })),
            metadata: {}
          } as Decision,
          requestId: context.message.messageId.toString()
        }
      });

      return {
        action: 'execute_tools',
        toolCalls: matchingTools.map(toolId => ({
          toolId,
          serverId: 'default', // Will be determined by MCP integration
          arguments: {} // Will be populated by tool executor
        })),
        responseStrategy: {
          type: 'tool_based',
          tone: 'technical',
          includeKeyboard: true
        },
        metadata: {
          intent: analysis.intent,
          confidence: analysis.confidence,
          suggestedTools: matchingTools
        }
      };
    }

    // No matching tools found - respond with available options
    this.stateMachine.transition(chatId, DecisionEvent.DIRECT_RESPONSE);

    // Save state after transition
    if (this.statePersistence) {
      await this.saveCurrentState(chatId);
    }

    return {
      action: 'respond',
      responseStrategy: {
        type: 'direct',
        tone: 'formal',
        includeKeyboard: true
      },
      metadata: {
        intent: analysis.intent,
        confidence: analysis.confidence,
        message: 'No matching tools found for your request',
        availableTools
      }
    };
  }

  /**
   * Handle command intent
   */
  private async handleCommandIntent(
    analysis: MessageAnalysis,
    availableTools: string[],
    chatId: number
  ): Promise<Decision> {
    // Commands might require tools
    if (analysis.suggestedTools && analysis.suggestedTools.length > 0) {
      const matchingTools = this.findMatchingTools(analysis.suggestedTools, availableTools);

      if (matchingTools.length > 0) {
        this.stateMachine.transition(chatId, DecisionEvent.TOOLS_REQUIRED, {
          toolCount: matchingTools.length
        });

        // Save state after transition
        if (this.statePersistence) {
          await this.saveCurrentState(chatId);
        }

        return {
          action: 'execute_tools',
          toolCalls: matchingTools.map(toolId => ({
            toolId,
            serverId: 'default',
            arguments: {}
          })),
          responseStrategy: {
            type: 'tool_based',
            tone: 'technical',
            includeKeyboard: false
          },
          metadata: {
            intent: analysis.intent,
            confidence: analysis.confidence
          }
        };
      }
    }

    // Direct command execution without tools
    this.stateMachine.transition(chatId, DecisionEvent.DIRECT_RESPONSE);

    // Save state after transition
    if (this.statePersistence) {
      await this.saveCurrentState(chatId);
    }

    return {
      action: 'respond',
      responseStrategy: {
        type: 'direct',
        tone: 'technical',
        includeKeyboard: true
      },
      metadata: {
        intent: analysis.intent,
        confidence: analysis.confidence,
        command: analysis.entities?.command || 'unknown'
      }
    };
  }

  /**
   * Handle question intent
   */
  private async handleQuestionIntent(
    analysis: MessageAnalysis,
    availableTools: string[],
    chatId: number
  ): Promise<Decision> {
    // Check if question requires tools (e.g., data lookup, calculations)
    if (analysis.suggestedTools && analysis.suggestedTools.length > 0) {
      const relevance = this.calculateToolRelevance(analysis);

      if (relevance > 0.7) { // High tool relevance threshold
        const matchingTools = this.findMatchingTools(analysis.suggestedTools, availableTools);

        if (matchingTools.length > 0) {
          this.stateMachine.transition(chatId, DecisionEvent.TOOLS_REQUIRED, {
            toolCount: matchingTools.length,
            relevance
          });

          // Save state after transition
          if (this.statePersistence) {
            await this.saveCurrentState(chatId);
          }

          return {
            action: 'execute_tools',
            toolCalls: matchingTools.map(toolId => ({
              toolId,
              serverId: 'default',
              arguments: {}
            })),
            responseStrategy: {
              type: 'tool_based',
              tone: 'formal',
              includeKeyboard: false
            },
            metadata: {
              intent: analysis.intent,
              confidence: analysis.confidence,
              toolRelevance: relevance
            }
          };
        }
      }
    }

    // Answer question directly
    this.stateMachine.transition(chatId, DecisionEvent.DIRECT_RESPONSE);

    // Save state after transition
    if (this.statePersistence) {
      await this.saveCurrentState(chatId);
    }

    return {
      action: 'respond',
      responseStrategy: {
        type: 'direct',
        tone: analysis.requiresContext ? 'formal' : 'casual',
        includeKeyboard: false
      },
      metadata: {
        intent: analysis.intent,
        confidence: analysis.confidence,
        requiresContext: analysis.requiresContext
      }
    };
  }

  /**
   * Handle conversation intent
   */
  private async handleConversationIntent(
    analysis: MessageAnalysis,
    chatId: number
  ): Promise<Decision> {
    this.stateMachine.transition(chatId, DecisionEvent.DIRECT_RESPONSE);

    // Save state after transition
    if (this.statePersistence) {
      await this.saveCurrentState(chatId);
    }

    return {
      action: 'respond',
      responseStrategy: {
        type: 'direct',
        tone: 'casual',
        includeKeyboard: false
      },
      metadata: {
        intent: analysis.intent,
        confidence: analysis.confidence,
        contextual: analysis.requiresContext
      }
    };
  }

  /**
   * Create clarification decision for low confidence
   */
  private createClarificationDecision(analysis: MessageAnalysis): Decision {
    return {
      action: 'ask_clarification',
      responseStrategy: {
        type: 'clarification',
        tone: 'formal',
        includeKeyboard: true
      },
      metadata: {
        originalIntent: analysis.intent,
        confidence: analysis.confidence,
        reason: 'low_confidence',
        suggestedQuestions: [
          'Could you please rephrase your request?',
          'What would you like me to help you with?',
          'Can you provide more details?'
        ]
      }
    };
  }

  /**
   * Create direct response decision
   */
  private createDirectResponseDecision(
    analysis: MessageAnalysis,
    tone: 'formal' | 'casual' | 'technical'
  ): Decision {
    return {
      action: 'respond',
      responseStrategy: {
        type: 'direct',
        tone,
        includeKeyboard: this.shouldIncludeKeyboard(analysis)
      },
      metadata: {
        intent: analysis.intent,
        confidence: analysis.confidence
      }
    };
  }

  /**
   * Find matching tools between suggested and available
   */
  private findMatchingTools(suggested: string[], available: string[]): string[] {
    if (!suggested || suggested.length === 0) return [];

    return suggested.filter(tool => available.includes(tool));
  }

  /**
   * Calculate tool relevance based on analysis
   */
  private calculateToolRelevance(analysis: MessageAnalysis): number {
    // Base relevance on confidence and number of suggested tools
    let relevance = analysis.confidence;

    if (analysis.suggestedTools && analysis.suggestedTools.length > 0) {
      // Increase relevance based on number of suggested tools
      relevance *= (1 + (analysis.suggestedTools.length * 0.1));
    }

    // Cap at 1.0
    return Math.min(relevance, 1.0);
  }

  /**
   * Determine appropriate tone based on analysis
   */
  private determineTone(analysis: MessageAnalysis): 'formal' | 'casual' | 'technical' {
    if (analysis.intent === 'command' || analysis.suggestedTools?.length) {
      return 'technical';
    }
    if (analysis.intent === 'question') {
      return 'formal';
    }
    return 'casual';
  }

  /**
   * Determine if inline keyboard should be included
   */
  private shouldIncludeKeyboard(analysis: MessageAnalysis): boolean {
    return analysis.intent === 'command' || (analysis.suggestedTools?.length ?? 0) > 0;
  }

  /**
   * Update average decision time
   */
  private updateAverageDecisionTime(duration: number): void {
    const total = this.metrics.averageDecisionTime * (this.metrics.totalDecisions - 1);
    this.metrics.averageDecisionTime = (total + duration) / this.metrics.totalDecisions;
  }

  /**
   * Calculate tool usage rate
   */
  private calculateToolUsageRate(): number {
    // Simplified calculation - in real implementation, track tool usage over time
    return Math.min(this.metrics.toolUsageRate + 0.1, 1.0);
  }

  /**
   * Calculate error rate
   */
  private calculateErrorRate(): number {
    // Simplified calculation - in real implementation, track errors over time
    return Math.min(this.metrics.errorRate + 0.05, 1.0);
  }

  /**
   * Reset metrics
   */
  private resetMetrics(): void {
    this.metrics = {
      totalDecisions: 0,
      averageDecisionTime: 0,
      toolUsageRate: 0,
      errorRate: 0,
      stateDistribution: {} as Record<DecisionState, number>
    };
  }
}
