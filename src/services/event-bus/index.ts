/**
 * Event Bus Service Exports
 *
 * Main exports for the event bus system
 */

export {
  // Main EventBus class and singleton
  EventBus,
  eventBus,
  createEventEmitter
} from './event-bus.ts';

// Export enum as value (enums are both types and values)
export { SystemEventType } from './types.ts';

export type {
  // Types
  BaseEvent,
  MessageReceivedEvent,
  MessageAnalyzedEvent,
  DecisionMadeEvent,
  ToolExecutedEvent,
  ResponseGeneratedEvent,
  ModerationStartedEvent,
  ModerationApprovedEvent,
  ModerationRejectedEvent,
  ModerationModifiedEvent,
  ModerationFailedEvent,
  ModerationCompleteEvent,
  ErrorOccurredEvent,
  ComponentInitializedEvent,
  ComponentShutdownEvent,
  ComponentErrorEvent,
  SystemReadyEvent,
  SystemShutdownEvent,
  SystemEvent,
  EventHandler,
  EventFilter,
  SubscriptionOptions,
  Subscription,
  IEventBus,
  EventBusStats,
  IEventEmitter
} from './types.ts';

export {
  // Registry
  EVENT_REGISTRY,
  getEventDefinition,
  getEventsEmittedBy,
  getEventsConsumedBy,
  isValidEventType,
  getComponentEventFlow
} from './event-registry.ts';

export type {
  EventDefinition
} from './event-registry.ts';