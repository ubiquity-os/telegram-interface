/**
 * Message Queue Implementation
 *
 * High-performance priority-based message queue with worker pool
 */

import { PriorityQueue } from './priority-queue.ts';
import { WorkerPool } from './worker-pool.ts';
import {
  IMessageQueue,
  MessageQueueConfig,
  QueuedMessage,
  MessagePriority,
  QueueStats,
  WorkerStatus,
  MessageProcessor,
  QueueEventType,
  QueueEvent
} from './types.ts';
import { TelegramUpdate } from '../../interfaces/component-interfaces.ts';

export class MessageQueue implements IMessageQueue {
  private queue: PriorityQueue<QueuedMessage>;
  private workerPool: WorkerPool;
  private config: MessageQueueConfig;
  private isRunning = false;
  private processor?: MessageProcessor;
  private eventHandlers: Map<QueueEventType, Set<(event: QueueEvent) => void>> = new Map();
  private stats = {
    totalEnqueued: 0,
    totalProcessed: 0,
    totalFailed: 0,
    processingStartTime: new Date()
  };
  private deadLetterQueue: QueuedMessage[] = [];
  private processingLoop?: Promise<void>;

  constructor(config: MessageQueueConfig) {
    this.config = config;
    this.queue = new PriorityQueue<QueuedMessage>();
    this.workerPool = new WorkerPool(config.workerPool);

    // Forward worker pool events
    this.setupWorkerPoolEvents();
  }

  /**
   * Enqueue a message for processing
   */
  async enqueue(update: TelegramUpdate, priority?: MessagePriority): Promise<string> {
    // Check queue capacity
    if (this.queue.size >= this.config.maxQueueSize) {
      this.emitEvent({
        type: QueueEventType.QUEUE_FULL,
        timestamp: new Date(),
        data: { queueSize: this.queue.size, maxSize: this.config.maxQueueSize }
      });
      throw new Error('Message queue is full');
    }

    // Determine priority
    const messagePriority = priority ?? this.calculatePriority(update);

    // Create queued message
    const queuedMessage: QueuedMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      update,
      priority: messagePriority,
      timestamp: new Date(),
      retryCount: 0,
      metadata: {
        chatId: this.extractChatId(update),
        userId: this.extractUserId(update),
        messageType: this.extractMessageType(update),
        estimatedProcessingTime: this.estimateProcessingTime(update)
      }
    };

    // Add to queue
    this.queue.enqueue(queuedMessage);
    this.stats.totalEnqueued++;

    // Emit event
    this.emitEvent({
      type: QueueEventType.MESSAGE_ENQUEUED,
      timestamp: new Date(),
      data: { message: queuedMessage }
    });

    return queuedMessage.id;
  }

  /**
   * Get current queue statistics
   */
  getStats(): QueueStats {
    const now = new Date();
    const elapsedSeconds = (now.getTime() - this.stats.processingStartTime.getTime()) / 1000;
    const processingRate = elapsedSeconds > 0 ? this.stats.totalProcessed / elapsedSeconds : 0;

    return {
      totalMessages: this.queue.size,
      messagesByPriority: this.queue.getCountByPriority(),
      processingRate,
      averageWaitTime: this.calculateAverageWaitTime(),
      activeWorkers: this.workerPool.getActiveWorkerCount(),
      queueDepth: this.queue.size
    };
  }

  /**
   * Get worker pool status
   */
  getWorkerStatus(): WorkerStatus[] {
    return this.workerPool.getWorkerStatus();
  }

  /**
   * Start the queue processor
   */
  async start(processor: MessageProcessor): Promise<void> {
    if (this.isRunning) {
      throw new Error('Message queue is already running');
    }

    this.processor = processor;
    this.isRunning = true;
    this.stats.processingStartTime = new Date();

    // Start worker pool
    await this.workerPool.start(processor);

    // Start processing loop
    this.processingLoop = this.runProcessingLoop();
  }

  /**
   * Stop the queue processor
   */
  async stop(): Promise<void> {
    this.isRunning = false;

    // Wait for processing loop to finish
    if (this.processingLoop) {
      await this.processingLoop;
    }

    // Stop worker pool
    await this.workerPool.stop();
  }

  /**
   * Clear the queue
   */
  async clear(): Promise<void> {
    this.queue.clear();
    this.deadLetterQueue = [];
  }

  /**
   * Subscribe to queue events
   */
  on(event: QueueEventType, handler: (event: QueueEvent) => void): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  /**
   * Get dead letter queue messages
   */
  getDeadLetterQueue(): QueuedMessage[] {
    return [...this.deadLetterQueue];
  }

  /**
   * Main processing loop
   */
  private async runProcessingLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        // Get next message
        const message = this.queue.dequeue();

        if (!message) {
          // No messages, wait a bit
          await new Promise(resolve => setTimeout(resolve, 100));
          continue;
        }

        // Check if worker is available
        if (this.workerPool.getBusyWorkerCount() >= this.workerPool.getActiveWorkerCount()) {
          // All workers busy, put message back
          this.queue.enqueue(message);
          await new Promise(resolve => setTimeout(resolve, 50));
          continue;
        }

        // Process message
        this.processMessage(message);

      } catch (error) {
        console.error('[MessageQueue] Processing loop error:', error);
      }
    }
  }

  /**
   * Process a single message
   */
  private async processMessage(message: QueuedMessage): Promise<void> {
    try {
      await this.workerPool.processMessage(message);
      this.stats.totalProcessed++;
    } catch (error) {
      console.error(`[MessageQueue] Failed to process message ${message.id}:`, error);
      this.stats.totalFailed++;

      // Handle retry logic
      if (this.config.deadLetterQueue.enabled) {
        message.retryCount++;

        if (message.retryCount < this.config.deadLetterQueue.maxRetries) {
          // Re-queue with lower priority
          message.priority = Math.min(message.priority + 1, MessagePriority.LOW);
          this.queue.enqueue(message);
        } else {
          // Move to dead letter queue
          this.deadLetterQueue.push(message);
          console.error(`[MessageQueue] Message ${message.id} moved to dead letter queue after ${message.retryCount} retries`);
        }
      }
    }
  }

  /**
   * Calculate message priority based on content
   */
  private calculatePriority(update: TelegramUpdate): MessagePriority {
    // Admin users get high priority
    if (this.config.priorityBoost.adminUsers.includes(this.extractUserId(update))) {
      return MessagePriority.HIGH;
    }

    // Commands get high priority
    if (this.config.priorityBoost.commands && this.isCommand(update)) {
      return MessagePriority.HIGH;
    }

    // Check for priority keywords
    const text = this.extractText(update);
    if (text && this.config.priorityBoost.keywords.some(keyword =>
      text.toLowerCase().includes(keyword.toLowerCase())
    )) {
      return MessagePriority.HIGH;
    }

    // Default priority
    return MessagePriority.NORMAL;
  }

  /**
   * Extract chat ID from update
   */
  private extractChatId(update: TelegramUpdate): number {
    if (update.message) return update.message.chat.id;
    if (update.callback_query) return update.callback_query.message.chat.id;
    return 0;
  }

  /**
   * Extract user ID from update
   */
  private extractUserId(update: TelegramUpdate): number {
    if (update.message) return update.message.from.id;
    if (update.callback_query) return update.callback_query.from.id;
    return 0;
  }

  /**
   * Extract message type from update
   */
  private extractMessageType(update: TelegramUpdate): string {
    if (update.message) return 'message';
    if (update.callback_query) return 'callback_query';
    return 'unknown';
  }

  /**
   * Extract text from update
   */
  private extractText(update: TelegramUpdate): string | undefined {
    if (update.message?.text) return update.message.text;
    if (update.callback_query?.data) return update.callback_query.data;
    return undefined;
  }

  /**
   * Check if update is a command
   */
  private isCommand(update: TelegramUpdate): boolean {
    const text = this.extractText(update);
    return text ? text.startsWith('/') : false;
  }

  /**
   * Estimate processing time for a message
   */
  private estimateProcessingTime(update: TelegramUpdate): number {
    // Base estimate
    let estimate = 1000; // 1 second

    // Commands typically take longer
    if (this.isCommand(update)) {
      estimate += 2000;
    }

    // Longer messages take more time
    const text = this.extractText(update);
    if (text) {
      estimate += text.length * 10; // 10ms per character
    }

    return estimate;
  }

  /**
   * Calculate average wait time
   */
  private calculateAverageWaitTime(): number {
    const messages = this.queue.toArray();
    if (messages.length === 0) return 0;

    const now = new Date();
    const totalWait = messages.reduce((sum, msg) =>
      sum + (now.getTime() - msg.timestamp.getTime()), 0
    );

    return totalWait / messages.length;
  }

  /**
   * Setup worker pool event forwarding
   */
  private setupWorkerPoolEvents(): void {
    const eventsToForward = [
      QueueEventType.MESSAGE_PROCESSING,
      QueueEventType.MESSAGE_COMPLETED,
      QueueEventType.MESSAGE_FAILED,
      QueueEventType.WORKER_STARTED,
      QueueEventType.WORKER_STOPPED
    ];

    eventsToForward.forEach(eventType => {
      this.workerPool.on(eventType, (event) => {
        this.emitEvent(event);
      });
    });
  }

  /**
   * Emit an event
   */
  private emitEvent(event: QueueEvent): void {
    const handlers = this.eventHandlers.get(event.type);
    if (handlers) {
      handlers.forEach(handler => handler(event));
    }
  }
}