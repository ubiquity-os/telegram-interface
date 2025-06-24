/**
 * Decision Engine implementation
 */

import { DecisionStateMachine, DecisionEvent } from './state-machine.ts';
import {
  DecisionEngineConfig,
  ToolExecutionContext,
  DecisionMetrics
} from './types.ts';

import {
  IDecisionEngine,
  IContextManager,
  IErrorHandler,
  ComponentStatus,
  DecisionState,
  DecisionContext,
  Decision,
  ToolCall,
  ToolResult
} from '../../interfaces/component-interfaces.ts';

import {
  TelegramMessage,
  MessageAnalysis,
  SystemEvent,
  EventType
} from '../../interfaces/message-types.ts';

/**
 * Central orchestrator for request handling and decision flow
 */
export class DecisionEngine implements IDecisionEngine {
  public readonly name = 'DecisionEngine';

  private stateMachine: DecisionStateMachine;
  private config: DecisionEngineConfig;
  private contextManager?: IContextManager;
  private errorHandler?: IErrorHandler;
  private metrics: DecisionMetrics;
  private isInitialized = false;

  constructor(config?: Partial<DecisionEngineConfig>) {
    this.config = {
      maxStateRetention: 1000,
      defaultTimeout: 30000,
      enableStatePersistence: true,
      debugMode: false,
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

    // Reset metrics
    this.resetMetrics();

    this.isInitialized = true;

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
   * Set dependencies
   */
  setContextManager(contextManager: IContextManager): void {
    this.contextManager = contextManager;
  }

  setErrorHandler(errorHandler: IErrorHandler): void {
    this.errorHandler = errorHandler;
  }

  /**
   * Make a decision based on the context
   */
  async makeDecision(context: DecisionContext): Promise<Decision> {
    const startTime = Date.now();
    const chatId = context.message.chatId;

    try {
      // Update metrics
      this.metrics.totalDecisions++;

      // Transition to MESSAGE_RECEIVED state
      this.stateMachine.transition(chatId, DecisionEvent.MESSAGE_RECEIVED, {
        messageId: context.message.messageId,
        userId: context.message.userId
      });

      // Store the decision context in state data
      this.stateMachine.setStateData(chatId, 'decisionContext', context);

      // Transition to PREPROCESSING
      this.stateMachine.transition(chatId, DecisionEvent.ANALYSIS_COMPLETE);

      // Make the actual decision
      const decision = await this.analyzeAndDecide(context);

      // Transition based on decision
      if (decision.action === 'execute_tools') {
        this.stateMachine.transition(chatId, DecisionEvent.TOOLS_REQUIRED, {
          toolCount: decision.toolCalls?.length ?? 0
        });
      } else {
        this.stateMachine.transition(chatId, DecisionEvent.DIRECT_RESPONSE);
      }

      // Update metrics
      const duration = Date.now() - startTime;
      this.updateAverageDecisionTime(duration);

      if (decision.toolCalls && decision.toolCalls.length > 0) {
        this.metrics.toolUsageRate = this.calculateToolUsageRate();
      }

      return decision;

    } catch (error) {
      // Handle error and transition to error state
      this.stateMachine.transition(chatId, DecisionEvent.ERROR_OCCURRED, {
        error: error.message
      });

      this.metrics.errorRate = this.calculateErrorRate();

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
    const { analysis, availableTools } = context;

    // Simple decision logic for Phase 2 (no MCP integration yet)

    // If analysis suggests tools are needed and tools are available
    if (analysis.suggestedTools && analysis.suggestedTools.length > 0 && availableTools.length > 0) {
      // For Phase 2, we'll not actually execute tools - just indicate they're needed
      return {
        action: 'execute_tools',
        toolCalls: [], // Empty for Phase 2
        responseStrategy: {
          type: 'tool_based',
          tone: 'technical'
        },
        metadata: {
          suggestedTools: analysis.suggestedTools,
          phase: 'phase_2_placeholder'
        }
      };
    }

    // Default to direct response
    return {
      action: 'respond',
      responseStrategy: {
        type: 'direct',
        tone: this.determineTone(analysis),
        includeKeyboard: this.shouldIncludeKeyboard(analysis)
      },
      metadata: {
        intent: analysis.intent,
        confidence: analysis.confidence
      }
    };
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