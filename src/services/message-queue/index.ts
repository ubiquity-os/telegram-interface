/**
 * Message Queue Module Exports
 */

export { MessageQueue } from './message-queue.ts';
export { PriorityQueue } from './priority-queue.ts';
export { WorkerPool } from './worker-pool.ts';

export type {
  IMessageQueue,
  MessageQueueConfig,
  QueuedMessage,
  MessagePriority,
  QueueStats,
  WorkerPoolConfig,
  WorkerStatus,
  MessageProcessor,
  QueueEventType,
  QueueEvent
} from './types.ts';

export { MessagePriority as MessagePriorityEnum, QueueEventType as QueueEventTypeEnum } from './types.ts';