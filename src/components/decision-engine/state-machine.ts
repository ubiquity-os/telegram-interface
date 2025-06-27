/**
 * State machine implementation for the Decision Engine
 */

import {
  StateMachineContext,
  StateTransition
} from './types.ts';

import {
  DecisionState
} from '../../interfaces/component-interfaces.ts';

/**
 * Decision events for state machine transitions
 */
export enum DecisionEvent {
  MESSAGE_RECEIVED = 'message_received',
  ANALYSIS_COMPLETE = 'analysis_complete',
  TOOLS_REQUIRED = 'tools_required',
  DIRECT_RESPONSE = 'direct_response',
  TOOLS_COMPLETE = 'tools_complete',
  RESPONSE_GENERATED = 'response_generated',
  VALIDATION_PASSED = 'validation_passed',
  VALIDATION_FAILED = 'validation_failed',
  ERROR_OCCURRED = 'error_occurred',
  RESET = 'reset'
}

/**
 * State machine for managing decision flow
 */
export class DecisionStateMachine {
  private contexts = new Map<number, StateMachineContext>();

  /**
   * Valid state transitions
   */
  private static readonly transitions: Record<DecisionState, Partial<Record<DecisionEvent, DecisionState>>> = {
    [DecisionState.IDLE]: {
      [DecisionEvent.MESSAGE_RECEIVED]: DecisionState.MESSAGE_RECEIVED,
      [DecisionEvent.RESET]: DecisionState.IDLE
    },
    [DecisionState.MESSAGE_RECEIVED]: {
      [DecisionEvent.ANALYSIS_COMPLETE]: DecisionState.PREPROCESSING,
      [DecisionEvent.ERROR_OCCURRED]: DecisionState.ERROR,
      [DecisionEvent.RESET]: DecisionState.IDLE
    },
    [DecisionState.PREPROCESSING]: {
      [DecisionEvent.ANALYSIS_COMPLETE]: DecisionState.DECISION_POINT,
      [DecisionEvent.ERROR_OCCURRED]: DecisionState.ERROR,
      [DecisionEvent.RESET]: DecisionState.IDLE
    },
    [DecisionState.DECISION_POINT]: {
      [DecisionEvent.TOOLS_REQUIRED]: DecisionState.TOOL_REQUIRED,
      [DecisionEvent.DIRECT_RESPONSE]: DecisionState.DIRECT_RESPONSE,
      [DecisionEvent.ERROR_OCCURRED]: DecisionState.ERROR,
      [DecisionEvent.RESET]: DecisionState.IDLE
    },
    [DecisionState.TOOL_REQUIRED]: {
      [DecisionEvent.TOOLS_COMPLETE]: DecisionState.RESPONSE_GENERATION,
      [DecisionEvent.ERROR_OCCURRED]: DecisionState.ERROR,
      [DecisionEvent.RESET]: DecisionState.IDLE
    },
    [DecisionState.DIRECT_RESPONSE]: {
      [DecisionEvent.RESPONSE_GENERATED]: DecisionState.RESPONSE_GENERATION,
      [DecisionEvent.ERROR_OCCURRED]: DecisionState.ERROR,
      [DecisionEvent.RESET]: DecisionState.IDLE
    },
    [DecisionState.RESPONSE_GENERATION]: {
      [DecisionEvent.VALIDATION_PASSED]: DecisionState.VALIDATION,
      [DecisionEvent.VALIDATION_FAILED]: DecisionState.RESPONSE_GENERATION,
      [DecisionEvent.ERROR_OCCURRED]: DecisionState.ERROR,
      [DecisionEvent.RESET]: DecisionState.IDLE
    },
    [DecisionState.VALIDATION]: {
      [DecisionEvent.VALIDATION_PASSED]: DecisionState.SEND_RESPONSE,
      [DecisionEvent.VALIDATION_FAILED]: DecisionState.RESPONSE_GENERATION,
      [DecisionEvent.ERROR_OCCURRED]: DecisionState.ERROR,
      [DecisionEvent.RESET]: DecisionState.IDLE
    },
    [DecisionState.SEND_RESPONSE]: {
      [DecisionEvent.RESET]: DecisionState.IDLE,
      [DecisionEvent.ERROR_OCCURRED]: DecisionState.ERROR
    },
    [DecisionState.ERROR]: {
      [DecisionEvent.RESET]: DecisionState.IDLE
    }
  };

  /**
   * Get current state for a chat
   */
  getCurrentState(chatId: number): DecisionState {
    const context = this.contexts.get(chatId);
    return context?.currentState ?? DecisionState.IDLE;
  }

  /**
   * Get full context for a chat
   */
  getContext(chatId: number): StateMachineContext | null {
    return this.contexts.get(chatId) ?? null;
  }

  /**
   * Transition to a new state
   */
  transition(chatId: number, event: DecisionEvent, metadata?: Record<string, any>): DecisionState {
    const currentState = this.getCurrentState(chatId);
    const validTransitions = DecisionStateMachine.transitions[currentState];
    const nextState = validTransitions?.[event];

    console.log(`[StateMachine] TRANSITION ATTEMPT: ChatId=${chatId}, CurrentState=${currentState}, Event=${event}`);
    console.log(`[StateMachine] Valid transitions from ${currentState}:`, Object.keys(validTransitions || {}));

    if (!nextState) {
      console.log(`[StateMachine] INVALID TRANSITION: ${currentState} -> ${event}. Valid transitions: ${Object.keys(validTransitions || {}).join(', ')}`);
      throw new Error(
        `Invalid transition: ${currentState} -> ${event}. Valid transitions: ${Object.keys(validTransitions || {}).join(', ')}`
      );
    }

    console.log(`[StateMachine] VALID TRANSITION: ${currentState} -> ${event} -> ${nextState}`);

    const context = this.contexts.get(chatId) ?? this.createContext(chatId);
    const transition: StateTransition = {
      from: currentState,
      to: nextState,
      timestamp: new Date(),
      trigger: event,
      metadata
    };

    // Update context
    context.previousState = currentState;
    context.currentState = nextState;
    context.lastTransition = new Date();
    context.transitionHistory.push(transition);

    // Keep only last 10 transitions
    if (context.transitionHistory.length > 10) {
      context.transitionHistory = context.transitionHistory.slice(-10);
    }

    this.contexts.set(chatId, context);
    return nextState;
  }

  /**
   * Force set state (for error recovery)
   */
  setState(chatId: number, state: DecisionState, metadata?: Record<string, any>): void {
    const context = this.contexts.get(chatId) ?? this.createContext(chatId);
    context.previousState = context.currentState;
    context.currentState = state;
    context.lastTransition = new Date();
    context.stateData = { ...context.stateData, ...metadata };
    this.contexts.set(chatId, context);
  }

  /**
   * Reset state to IDLE
   */
  reset(chatId: number): void {
    this.transition(chatId, DecisionEvent.RESET);
  }

  /**
   * Set state data
   */
  setStateData(chatId: number, key: string, value: any): void {
    const context = this.contexts.get(chatId) ?? this.createContext(chatId);
    context.stateData[key] = value;
    this.contexts.set(chatId, context);
  }

  /**
   * Get state data
   */
  getStateData(chatId: number, key: string): any {
    const context = this.contexts.get(chatId);
    return context?.stateData[key];
  }

  /**
   * Check if transition is valid
   */
  canTransition(chatId: number, event: DecisionEvent): boolean {
    const currentState = this.getCurrentState(chatId);
    const validTransitions = DecisionStateMachine.transitions[currentState];
    return validTransitions?.[event] !== undefined;
  }

  /**
   * Clean up old contexts
   */
  cleanup(maxAge: number = 3600000): number { // 1 hour default
    const cutoff = Date.now() - maxAge;
    let cleaned = 0;

    for (const [chatId, context] of this.contexts.entries()) {
      if (context.lastTransition.getTime() < cutoff) {
        this.contexts.delete(chatId);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Get all active chats
   */
  getActiveChats(): number[] {
    return Array.from(this.contexts.keys());
  }

  /**
   * Get state distribution for monitoring
   */
  getStateDistribution(): Record<DecisionState, number> {
    const distribution = {} as Record<DecisionState, number>;

    // Initialize all states to 0
    for (const state of Object.values(DecisionState)) {
      distribution[state] = 0;
    }

    // Count current states
    for (const context of this.contexts.values()) {
      distribution[context.currentState]++;
    }

    return distribution;
  }

  /**
   * Check if state exists for a chat
   */
  hasState(chatId: number): boolean {
    return this.contexts.has(chatId);
  }

  /**
   * Initialize chat state to IDLE
   */
  initializeChatState(chatId: number): void {
    const context = this.createContext(chatId);
    this.contexts.set(chatId, context);
  }

  /**
   * Restore state from persisted context
   */
  restoreState(chatId: number, context: StateMachineContext): void {
    this.contexts.set(chatId, context);
  }

  /**
   * Create a new context for a chat
   */
  private createContext(chatId: number): StateMachineContext {
    return {
      chatId,
      currentState: DecisionState.IDLE,
      stateData: {},
      lastTransition: new Date(),
      transitionHistory: []
    };
  }
}