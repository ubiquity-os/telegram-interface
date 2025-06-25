/**
 * Message Queue Types and Interfaces
 *
 * Provides priority-based message queuing for scalable message processing
 */

import { TelegramUpdate } from '../../interfaces/component-interfaces.ts';

/**
 * Message priority levels
 */
export enum MessagePriority {
  CRITICAL = 0,    // System messages, errors
  HIGH = 1,        // Commands, admin messages
  NORMAL = 2,      // Regular user messages
  LOW = 3          // Background tasks, non-urgent
}

/**
 * Queued message with metadata
 */
export interface QueuedMessage {
  id: string;
  update: TelegramUpdate;
  priority: MessagePriority;
  timestamp: Date;
  retryCount: number;
  metadata: {
    chatId: number;
    userId: number;
    messageType: string;
    estimatedProcessingTime?: number;
  };
}

/**
 * Queue statistics
 */
export interface QueueStats {
  totalMessages: number;
  messagesByPriority: Record<MessagePriority, number>;
  processingRate: number;  // messages per second
  averageWaitTime: number; // milliseconds
  activeWorkers: number;
  queueDepth: number;
}

/**
 * Worker pool configuration
 */
export interface WorkerPoolConfig {
  minWorkers: number;
  maxWorkers: number;
  workerIdleTimeout: number; // milliseconds
  autoscale: boolean;
  scalingThreshold: number; // queue depth to trigger scaling
}

/**
 * Message queue configuration
 */
export interface MessageQueueConfig {
  maxQueueSize: number;
  workerPool: WorkerPoolConfig;
  priorityBoost: {
    commands: boolean;
    adminUsers: number[];
    keywords: string[];
  };
  deadLetterQueue: {
    enabled: boolean;
    maxRetries: number;
  };
}

/**
 * Worker status
 */
export interface WorkerStatus {
  id: string;
  status: 'idle' | 'processing' | 'error';
  currentMessage?: QueuedMessage;
  processedCount: number;
  startTime: Date;
  lastActivityTime: Date;
}

/**
 * Message processor function type
 */
export type MessageProcessor = (message: QueuedMessage) => Promise<void>;

/**
 * Queue event types
 */
export enum QueueEventType {
  MESSAGE_ENQUEUED = 'message.enqueued',
  MESSAGE_PROCESSING = 'message.processing',
  MESSAGE_COMPLETED = 'message.completed',
  MESSAGE_FAILED = 'message.failed',
  WORKER_STARTED = 'worker.started',
  WORKER_STOPPED = 'worker.stopped',
  QUEUE_FULL = 'queue.full'
}

/**
 * Queue events
 */
export interface QueueEvent {
  type: QueueEventType;
  timestamp: Date;
  data: any;
}

/**
 * Message queue interface
 */
export interface IMessageQueue {
  /**
   * Enqueue a message for processing
   */
  enqueue(update: TelegramUpdate, priority?: MessagePriority): Promise<string>;

  /**
   * Get current queue statistics
   */
  getStats(): QueueStats;

  /**
   * Get worker pool status
   */
  getWorkerStatus(): WorkerStatus[];

  /**
   * Start the queue processor
   */
  start(processor: MessageProcessor): Promise<void>;

  /**
   * Stop the queue processor
   */
  stop(): Promise<void>;

  /**
   * Clear the queue
   */
  clear(): Promise<void>;

  /**
   * Subscribe to queue events
   */
  on(event: QueueEventType, handler: (event: QueueEvent) => void): void;
}