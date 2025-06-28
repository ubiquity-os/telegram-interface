/**
 * Simplified State machine implementation for the Decision Engine
 * Phase 1.1: Reduce states to READY, PROCESSING, COMPLETED, ERROR
 * Replace intermediate states with phase metadata
 */

import {
  StateMachineContext,
  StateTransition,
  ProcessingPhase
} from './types.ts';

import {
  DecisionState
} from '../../interfaces/component-interfaces.ts';

/**
 * Decision events for simplified state machine transitions
 */
export enum DecisionEvent {
  MESSAGE_RECEIVED = 'message_received',
  PHASE_COMPLETE = 'phase_complete',
  PROCESSING_COMPLETE = 'processing_complete',
  ERROR_OCCURRED = 'error_occurred',
  RESET = 'reset'
}

/**
 * Simplified state machine for managing decision flow
 */
export class DecisionStateMachine {
  private contexts = new Map<number, StateMachineContext>();

  /**
   * Valid state transitions for simplified state machine
   */
  private static readonly transitions: Record<DecisionState, Partial<Record<DecisionEvent, DecisionState>>> = {
    [DecisionState.READY]: {
      [DecisionEvent.MESSAGE_RECEIVED]: DecisionState.PROCESSING,
      [DecisionEvent.RESET]: DecisionState.READY
    },
    [DecisionState.PROCESSING]: {
      [DecisionEvent.PHASE_COMPLETE]: DecisionState.PROCESSING, // Stay in processing, change phase
      [DecisionEvent.PROCESSING_COMPLETE]: DecisionState.COMPLETED,
      [DecisionEvent.ERROR_OCCURRED]: DecisionState.ERROR,
      [DecisionEvent.RESET]: DecisionState.READY
    },
    [DecisionState.COMPLETED]: {
      [DecisionEvent.MESSAGE_RECEIVED]: DecisionState.PROCESSING,
      [DecisionEvent.RESET]: DecisionState.READY,
      [DecisionEvent.ERROR_OCCURRED]: DecisionState.ERROR
    },
    [DecisionState.ERROR]: {
      [DecisionEvent.RESET]: DecisionState.READY,
      [DecisionEvent.MESSAGE_RECEIVED]: DecisionState.PROCESSING,
      [DecisionEvent.ERROR_OCCURRED]: DecisionState.ERROR  // Allow error->error for multiple errors
    }
  };

  /**
   * Valid phase transitions within PROCESSING state
   */
  private static readonly phaseTransitions: Record<ProcessingPhase, ProcessingPhase[]> = {
    'analysis': ['decision', 'generation'], // Can skip decision for simple responses
    'decision': ['tool_execution', 'generation'],
    'tool_execution': ['generation'],
    'generation': [] // Final phase
  };

  /**
   * Get current state for a chat
   */
  getCurrentState(chatId: number): DecisionState {
    const context = this.contexts.get(chatId);
    return context?.currentState ?? DecisionState.READY;
  }

  /**
   * Get current processing phase for a chat (if in PROCESSING state)
   */
  getCurrentPhase(chatId: number): ProcessingPhase | null {
    const context = this.contexts.get(chatId);
    if (context?.currentState === DecisionState.PROCESSING) {
      return context.currentPhase ?? null;
    }
    return null;
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

    // Clear phase when leaving PROCESSING state
    if (nextState !== DecisionState.PROCESSING) {
      context.currentPhase = undefined;
    }

    // Keep only last 10 transitions
    if (context.transitionHistory.length > 10) {
      context.transitionHistory = context.transitionHistory.slice(-10);
    }

    this.contexts.set(chatId, context);
    return nextState;
  }

  /**
   * Transition to a new processing phase (only valid when in PROCESSING state)
   */
  transitionToPhase(chatId: number, newPhase: ProcessingPhase, metadata?: Record<string, any>): void {
    const context = this.contexts.get(chatId);

    if (!context || context.currentState !== DecisionState.PROCESSING) {
      throw new Error(`Cannot transition to phase ${newPhase}: not in PROCESSING state`);
    }

    const currentPhase = context.currentPhase;

    // If no current phase, allow setting initial phase
    if (!currentPhase) {
      console.log(`[StateMachine] PHASE TRANSITION: ChatId=${chatId}, InitialPhase=${newPhase}`);
      context.currentPhase = newPhase;
      context.stateData = { ...context.stateData, ...metadata };
      this.contexts.set(chatId, context);
      return;
    }

    // Validate phase transition
    const validPhases = DecisionStateMachine.phaseTransitions[currentPhase];
    if (!validPhases.includes(newPhase)) {
      throw new Error(
        `Invalid phase transition: ${currentPhase} -> ${newPhase}. Valid transitions: ${validPhases.join(', ')}`
      );
    }

    console.log(`[StateMachine] PHASE TRANSITION: ChatId=${chatId}, ${currentPhase} -> ${newPhase}`);

    context.currentPhase = newPhase;
    context.stateData = { ...context.stateData, ...metadata };
    context.lastTransition = new Date();

    // Add phase transition to history
    const phaseTransition: StateTransition = {
      from: DecisionState.PROCESSING,
      to: DecisionState.PROCESSING,
      timestamp: new Date(),
      trigger: `phase_${newPhase}`,
      metadata: { ...metadata, phase: newPhase, previousPhase: currentPhase }
    };
    context.transitionHistory.push(phaseTransition);

    this.contexts.set(chatId, context);
  }

  /**
   * Start processing with initial phase
   */
  startProcessing(chatId: number, initialPhase: ProcessingPhase = 'analysis', metadata?: Record<string, any>): void {
    // First transition to PROCESSING state
    this.transition(chatId, DecisionEvent.MESSAGE_RECEIVED, metadata);

    // Then set the initial phase
    this.transitionToPhase(chatId, initialPhase, metadata);
  }

  /**
   * Complete processing and transition to COMPLETED
   */
  completeProcessing(chatId: number, metadata?: Record<string, any>): void {
    this.transition(chatId, DecisionEvent.PROCESSING_COMPLETE, metadata);
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

    // Clear phase if not in PROCESSING
    if (state !== DecisionState.PROCESSING) {
      context.currentPhase = undefined;
    }

    this.contexts.set(chatId, context);
  }

  /**
   * Reset state to READY
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
   * Check if phase transition is valid
   */
  canTransitionToPhase(chatId: number, newPhase: ProcessingPhase): boolean {
    const context = this.contexts.get(chatId);

    if (!context || context.currentState !== DecisionState.PROCESSING) {
      return false;
    }

    const currentPhase = context.currentPhase;
    if (!currentPhase) {
      return true; // Can set initial phase
    }

    const validPhases = DecisionStateMachine.phaseTransitions[currentPhase];
    return validPhases.includes(newPhase);
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
   * Get phase distribution for monitoring (only for PROCESSING state)
   */
  getPhaseDistribution(): Record<ProcessingPhase, number> {
    const distribution = {} as Record<ProcessingPhase, number>;

    // Initialize all phases to 0
    const phases: ProcessingPhase[] = ['analysis', 'decision', 'tool_execution', 'generation'];
    for (const phase of phases) {
      distribution[phase] = 0;
    }

    // Count current phases in PROCESSING state
    for (const context of this.contexts.values()) {
      if (context.currentState === DecisionState.PROCESSING && context.currentPhase) {
        distribution[context.currentPhase]++;
      }
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
   * Initialize chat state to READY
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
      currentState: DecisionState.READY,
      stateData: {},
      lastTransition: new Date(),
      transitionHistory: []
    };
  }
}