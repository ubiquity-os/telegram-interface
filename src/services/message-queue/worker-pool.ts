/**
 * Worker Pool Implementation
 *
 * Manages a pool of workers for parallel message processing
 */

import {
  WorkerPoolConfig,
  WorkerStatus,
  QueuedMessage,
  MessageProcessor,
  QueueEventType,
  QueueEvent
} from './types.ts';

export class WorkerPool {
  private workers: Map<string, Worker> = new Map();
  private config: WorkerPoolConfig;
  private processor?: MessageProcessor;
  private isRunning = false;
  private eventHandlers: Map<QueueEventType, Set<(event: QueueEvent) => void>> = new Map();

  constructor(config: WorkerPoolConfig) {
    this.config = config;
  }

  /**
   * Start the worker pool
   */
  async start(processor: MessageProcessor): Promise<void> {
    if (this.isRunning) {
      throw new Error('Worker pool is already running');
    }

    this.processor = processor;
    this.isRunning = true;

    // Start minimum workers
    for (let i = 0; i < this.config.minWorkers; i++) {
      await this.spawnWorker();
    }
  }

  /**
   * Stop the worker pool
   */
  async stop(): Promise<void> {
    this.isRunning = false;

    // Stop all workers
    const stopPromises = Array.from(this.workers.values()).map(worker =>
      this.stopWorker(worker.id)
    );

    await Promise.all(stopPromises);
    this.workers.clear();
  }

  /**
   * Process a message with an available worker
   */
  async processMessage(message: QueuedMessage): Promise<void> {
    if (!this.isRunning || !this.processor) {
      throw new Error('Worker pool is not running');
    }

    // Find idle worker or spawn new one if needed
    let worker = this.findIdleWorker();

    if (!worker && this.shouldScaleUp()) {
      worker = await this.spawnWorker();
    }

    if (!worker) {
      throw new Error('No available workers');
    }

    // Process message
    worker.status = 'processing';
    worker.currentMessage = message;
    worker.lastActivityTime = new Date();

    this.emitEvent({
      type: QueueEventType.MESSAGE_PROCESSING,
      timestamp: new Date(),
      data: { message, workerId: worker.id }
    });

    try {
      await this.processor(message);

      worker.processedCount++;
      worker.status = 'idle';
      worker.currentMessage = undefined;

      this.emitEvent({
        type: QueueEventType.MESSAGE_COMPLETED,
        timestamp: new Date(),
        data: { message, workerId: worker.id }
      });

      // Check if we should scale down
      if (this.shouldScaleDown()) {
        await this.stopIdleWorker();
      }
    } catch (error) {
      worker.status = 'error';

      this.emitEvent({
        type: QueueEventType.MESSAGE_FAILED,
        timestamp: new Date(),
        data: { message, workerId: worker.id, error: error.message }
      });

      throw error;
    } finally {
      worker.lastActivityTime = new Date();
    }
  }

  /**
   * Get worker status information
   */
  getWorkerStatus(): WorkerStatus[] {
    return Array.from(this.workers.values()).map(worker => ({
      id: worker.id,
      status: worker.status,
      currentMessage: worker.currentMessage,
      processedCount: worker.processedCount,
      startTime: worker.startTime,
      lastActivityTime: worker.lastActivityTime
    }));
  }

  /**
   * Get number of active workers
   */
  getActiveWorkerCount(): number {
    return this.workers.size;
  }

  /**
   * Get number of busy workers
   */
  getBusyWorkerCount(): number {
    return Array.from(this.workers.values())
      .filter(w => w.status === 'processing').length;
  }

  /**
   * Subscribe to worker pool events
   */
  on(event: QueueEventType, handler: (event: QueueEvent) => void): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  /**
   * Find an idle worker
   */
  private findIdleWorker(): Worker | undefined {
    return Array.from(this.workers.values())
      .find(w => w.status === 'idle');
  }

  /**
   * Check if we should scale up
   */
  private shouldScaleUp(): boolean {
    if (!this.config.autoscale) return false;

    const activeCount = this.workers.size;
    const busyCount = this.getBusyWorkerCount();

    return activeCount < this.config.maxWorkers &&
           busyCount === activeCount;
  }

  /**
   * Check if we should scale down
   */
  private shouldScaleDown(): boolean {
    if (!this.config.autoscale) return false;

    const activeCount = this.workers.size;
    const idleCount = activeCount - this.getBusyWorkerCount();

    return activeCount > this.config.minWorkers &&
           idleCount > 1;
  }

  /**
   * Spawn a new worker
   */
  private async spawnWorker(): Promise<Worker> {
    const workerId = `worker-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    const worker: Worker = {
      id: workerId,
      status: 'idle',
      processedCount: 0,
      startTime: new Date(),
      lastActivityTime: new Date()
    };

    this.workers.set(workerId, worker);

    this.emitEvent({
      type: QueueEventType.WORKER_STARTED,
      timestamp: new Date(),
      data: { workerId }
    });

    return worker;
  }

  /**
   * Stop a specific worker
   */
  private async stopWorker(workerId: string): Promise<void> {
    const worker = this.workers.get(workerId);
    if (!worker) return;

    // Wait for current processing to complete
    if (worker.status === 'processing') {
      // In a real implementation, we'd wait for the task to complete
      // For now, we'll just mark it as stopped
    }

    this.workers.delete(workerId);

    this.emitEvent({
      type: QueueEventType.WORKER_STOPPED,
      timestamp: new Date(),
      data: { workerId }
    });
  }

  /**
   * Stop an idle worker
   */
  private async stopIdleWorker(): Promise<void> {
    const idleWorker = this.findIdleWorker();
    if (idleWorker) {
      await this.stopWorker(idleWorker.id);
    }
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

/**
 * Internal worker representation
 */
interface Worker extends WorkerStatus {
  // Additional internal properties can be added here
}