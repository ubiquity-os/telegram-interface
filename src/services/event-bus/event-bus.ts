/**
 * Event Bus Implementation
 *
 * Provides pub/sub functionality for component communication
 * with typed events, async handlers, error isolation, and filtering
 */

import {
  IEventBus,
  SystemEvent,
  SystemEventType,
  EventHandler,
  EventFilter,
  SubscriptionOptions,
  Subscription,
  EventBusStats
} from './types.ts';

/**
 * Event Bus implementation
 */
export class EventBus implements IEventBus {
  private subscriptions: Map<SystemEventType, Set<Subscription>>;
  private subscriptionById: Map<string, Subscription>;
  private stats: EventBusStats;
  private isShuttingDown: boolean;

  constructor() {
    this.subscriptions = new Map();
    this.subscriptionById = new Map();
    this.isShuttingDown = false;
    this.stats = {
      totalEvents: 0,
      eventCounts: {} as Record<SystemEventType, number>,
      subscriptionCount: 0,
      errorCount: 0,
      averageHandlerTime: 0
    };

    // Initialize event counts
    Object.values(SystemEventType).forEach(type => {
      this.stats.eventCounts[type] = 0;
    });
  }

  /**
   * Subscribe to an event
   */
  on<T extends SystemEvent>(
    eventType: T['type'],
    handler: EventHandler<T>,
    options: SubscriptionOptions = {}
  ): string {
    if (this.isShuttingDown) {
      throw new Error('EventBus is shutting down');
    }

    const subscriptionId = this.generateSubscriptionId();
    const subscription: Subscription = {
      id: subscriptionId,
      eventType,
      handler: handler as EventHandler,
      options: {
        priority: options.priority || 0,
        filter: options.filter,
        namespace: options.namespace,
        once: options.once || false
      },
      createdAt: new Date()
    };

    // Get or create subscription set for this event type
    let typeSubscriptions = this.subscriptions.get(eventType);
    if (!typeSubscriptions) {
      typeSubscriptions = new Set();
      this.subscriptions.set(eventType, typeSubscriptions);
    }

    typeSubscriptions.add(subscription);
    this.subscriptionById.set(subscriptionId, subscription);
    this.stats.subscriptionCount++;

    return subscriptionId;
  }

  /**
   * Unsubscribe from an event
   */
  off(subscriptionId: string): boolean {
    const subscription = this.subscriptionById.get(subscriptionId);
    if (!subscription) {
      return false;
    }

    const typeSubscriptions = this.subscriptions.get(subscription.eventType);
    if (typeSubscriptions) {
      typeSubscriptions.delete(subscription);
      if (typeSubscriptions.size === 0) {
        this.subscriptions.delete(subscription.eventType);
      }
    }

    this.subscriptionById.delete(subscriptionId);
    this.stats.subscriptionCount--;
    return true;
  }

  /**
   * Subscribe to an event once
   */
  once<T extends SystemEvent>(
    eventType: T['type'],
    handler: EventHandler<T>,
    options: Omit<SubscriptionOptions, 'once'> = {}
  ): string {
    return this.on(eventType, handler, { ...options, once: true });
  }

  /**
   * Subscribe to an event (alias for on method)
   */
  subscribe<T extends SystemEvent>(
    eventType: T['type'],
    handler: EventHandler<T>,
    options: SubscriptionOptions = {}
  ): string {
    return this.on(eventType, handler, options);
  }

  /**
   * Emit an event
   */
  async emit<T extends SystemEvent>(event: T): Promise<void> {
    if (this.isShuttingDown) {
      console.warn('[EventBus] Ignoring event during shutdown:', event.type);
      return;
    }

    const startTime = Date.now();
    this.stats.totalEvents++;
    this.stats.eventCounts[event.type]++;

    const typeSubscriptions = this.subscriptions.get(event.type);
    if (!typeSubscriptions || typeSubscriptions.size === 0) {
      return;
    }

    // Sort subscriptions by priority
    const sortedSubscriptions = Array.from(typeSubscriptions).sort(
      (a, b) => (b.options.priority || 0) - (a.options.priority || 0)
    );

    const handlersToRemove: string[] = [];
    const handlerTimes: number[] = [];

    // Execute handlers
    for (const subscription of sortedSubscriptions) {
      // Apply filters
      if (subscription.options.filter && !subscription.options.filter(event)) {
        continue;
      }

      // Apply namespace filter
      if (subscription.options.namespace &&
          event.metadata?.namespace !== subscription.options.namespace) {
        continue;
      }

      try {
        const handlerStartTime = Date.now();
        await this.executeHandler(subscription.handler, event);
        const handlerTime = Date.now() - handlerStartTime;
        handlerTimes.push(handlerTime);

        // Mark for removal if this was a one-time subscription
        if (subscription.options.once) {
          handlersToRemove.push(subscription.id);
        }
      } catch (error) {
        this.stats.errorCount++;
        console.error(
          `[EventBus] Error in handler for ${event.type}:`,
          error
        );
        // Continue with other handlers - error isolation
      }
    }

    // Remove one-time subscriptions
    handlersToRemove.forEach(id => this.off(id));

    // Update average handler time
    if (handlerTimes.length > 0) {
      const totalTime = handlerTimes.reduce((sum, time) => sum + time, 0);
      const avgTime = totalTime / handlerTimes.length;

      // Moving average calculation
      this.stats.averageHandlerTime =
        (this.stats.averageHandlerTime * (this.stats.totalEvents - 1) + avgTime) /
        this.stats.totalEvents;
    }

    const totalTime = Date.now() - startTime;
    if (totalTime > 100) {
      console.warn(
        `[EventBus] Slow event processing for ${event.type}: ${totalTime}ms`
      );
    }
  }

  /**
   * Clear all subscriptions for a namespace
   */
  clearNamespace(namespace: string): number {
    let removedCount = 0;

    for (const [subscriptionId, subscription] of this.subscriptionById) {
      if (subscription.options.namespace === namespace) {
        if (this.off(subscriptionId)) {
          removedCount++;
        }
      }
    }

    return removedCount;
  }

  /**
   * Clear all subscriptions
   */
  clearAll(): void {
    this.subscriptions.clear();
    this.subscriptionById.clear();
    this.stats.subscriptionCount = 0;
  }

  /**
   * Get subscriptions for an event type
   */
  getSubscriptions(eventType?: SystemEventType): Subscription[] {
    if (eventType) {
      const typeSubscriptions = this.subscriptions.get(eventType);
      return typeSubscriptions ? Array.from(typeSubscriptions) : [];
    }

    return Array.from(this.subscriptionById.values());
  }

  /**
   * Get event bus statistics
   */
  getStats(): EventBusStats {
    return { ...this.stats };
  }

  /**
   * Shutdown the event bus
   */
  shutdown(): void {
    console.log('[EventBus] Shutting down...');
    this.isShuttingDown = true;
    this.clearAll();
  }

  /**
   * Execute a handler with error isolation
   */
  private async executeHandler(
    handler: EventHandler,
    event: SystemEvent
  ): Promise<void> {
    try {
      const result = handler(event);
      if (result instanceof Promise) {
        await result;
      }
    } catch (error) {
      // Re-throw to be caught by caller
      throw error;
    }
  }

  /**
   * Generate unique subscription ID
   */
  private generateSubscriptionId(): string {
    return `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * Create a singleton instance
 */
export const eventBus = new EventBus();

/**
 * Event emitter mixin
 */
export function createEventEmitter(
  source: string,
  bus: IEventBus = eventBus
) {
  return {
    emit: async <T extends SystemEvent>(
      event: Omit<T, 'id' | 'timestamp' | 'source'>
    ): Promise<void> => {
      const fullEvent = {
        ...event,
        id: `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date(),
        source
      } as T;

      await bus.emit(fullEvent);
    }
  };
}