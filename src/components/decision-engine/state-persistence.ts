/**
 * State persistence interface and implementations for DecisionEngine
 */

import { DecisionState, DecisionContext } from '../../interfaces/component-interfaces.ts';
import { StateMachineContext } from './types.ts';

/**
 * Interface for state persistence implementations
 */
export interface StatePersistence {
  /**
   * Save state for a specific chat
   */
  saveState(chatId: number, state: StateMachineContext): Promise<void>;

  /**
   * Load state for a specific chat
   */
  loadState(chatId: number): Promise<StateMachineContext | null>;

  /**
   * Delete state for a specific chat
   */
  deleteState(chatId: number): Promise<void>;

  /**
   * Check if state exists for a chat
   */
  hasState(chatId: number): Promise<boolean>;

  /**
   * Clean up old states
   */
  cleanup(ttlSeconds: number): Promise<void>;
}

/**
 * Deno.kv-based state persistence implementation
 */
export class DenoKvStatePersistence implements StatePersistence {
  private kv: Deno.Kv;
  private keyPrefix = 'decision_engine_state';

  constructor(kv: Deno.Kv) {
    this.kv = kv;
  }

  async saveState(chatId: number, state: StateMachineContext): Promise<void> {
    const key = [this.keyPrefix, chatId.toString()];

    // Serialize state with metadata
    const serializedState = {
      ...state,
      lastUpdated: new Date().toISOString(),
      version: '1.0' // For future migration support
    };

    // Save with TTL of 24 hours by default
    await this.kv.set(key, serializedState, {
      expireIn: 24 * 60 * 60 * 1000 // 24 hours in milliseconds
    });
  }

  async loadState(chatId: number): Promise<StateMachineContext | null> {
    const key = [this.keyPrefix, chatId.toString()];
    const result = await this.kv.get(key);

    if (!result.value) {
      return null;
    }

    // Deserialize and restore Date objects
    const savedState = result.value as any;
    return {
      chatId: savedState.chatId,
      currentState: savedState.currentState,
      previousState: savedState.previousState,
      currentPhase: savedState.currentPhase, // Add support for phase
      stateData: savedState.stateData,
      lastTransition: new Date(savedState.lastTransition),
      transitionHistory: savedState.transitionHistory.map((t: any) => ({
        ...t,
        timestamp: new Date(t.timestamp)
      }))
    };
  }

  async deleteState(chatId: number): Promise<void> {
    const key = [this.keyPrefix, chatId.toString()];
    await this.kv.delete(key);
  }

  async hasState(chatId: number): Promise<boolean> {
    const key = [this.keyPrefix, chatId.toString()];
    const result = await this.kv.get(key);
    return result.value !== null;
  }

  async cleanup(ttlSeconds: number): Promise<void> {
    // List all state keys
    const entries = this.kv.list({ prefix: [this.keyPrefix] });
    const now = Date.now();
    const ttlMs = ttlSeconds * 1000;

    for await (const entry of entries) {
      const state = entry.value as any;
      if (state.lastUpdated) {
        const lastUpdated = new Date(state.lastUpdated).getTime();
        if (now - lastUpdated > ttlMs) {
          await this.kv.delete(entry.key);
        }
      }
    }
  }
}

/**
 * In-memory state persistence for testing
 */
export class MemoryStatePersistence implements StatePersistence {
  private states = new Map<number, StateMachineContext>();
  private timestamps = new Map<number, Date>();

  async saveState(chatId: number, state: StateMachineContext): Promise<void> {
    this.states.set(chatId, { ...state });
    this.timestamps.set(chatId, new Date());
  }

  async loadState(chatId: number): Promise<StateMachineContext | null> {
    const state = this.states.get(chatId);
    return state ? { ...state } : null;
  }

  async deleteState(chatId: number): Promise<void> {
    this.states.delete(chatId);
    this.timestamps.delete(chatId);
  }

  async hasState(chatId: number): Promise<boolean> {
    return this.states.has(chatId);
  }

  async cleanup(ttlSeconds: number): Promise<void> {
    const now = Date.now();
    const ttlMs = ttlSeconds * 1000;

    for (const [chatId, timestamp] of this.timestamps.entries()) {
      if (now - timestamp.getTime() > ttlMs) {
        this.states.delete(chatId);
        this.timestamps.delete(chatId);
      }
    }
  }
}