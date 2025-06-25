/**
 * Priority Queue Implementation
 *
 * Efficient min-heap based priority queue for message ordering
 */

import { QueuedMessage, MessagePriority } from './types.ts';

export class PriorityQueue<T extends QueuedMessage> {
  private heap: T[] = [];

  /**
   * Get the current size of the queue
   */
  get size(): number {
    return this.heap.length;
  }

  /**
   * Check if queue is empty
   */
  isEmpty(): boolean {
    return this.heap.length === 0;
  }

  /**
   * Add an item to the queue
   */
  enqueue(item: T): void {
    this.heap.push(item);
    this.bubbleUp(this.heap.length - 1);
  }

  /**
   * Remove and return the highest priority item
   */
  dequeue(): T | undefined {
    if (this.isEmpty()) {
      return undefined;
    }

    const top = this.heap[0];
    const last = this.heap.pop();

    if (this.heap.length > 0 && last) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }

    return top;
  }

  /**
   * Peek at the highest priority item without removing it
   */
  peek(): T | undefined {
    return this.heap[0];
  }

  /**
   * Clear all items from the queue
   */
  clear(): void {
    this.heap = [];
  }

  /**
   * Get all items in priority order (does not modify queue)
   */
  toArray(): T[] {
    const result: T[] = [];
    const tempHeap = [...this.heap];

    // Create temporary queue to extract in order
    const temp = new PriorityQueue<T>();
    temp.heap = tempHeap;

    while (!temp.isEmpty()) {
      const item = temp.dequeue();
      if (item) result.push(item);
    }

    return result;
  }

  /**
   * Get count by priority level
   */
  getCountByPriority(): Record<MessagePriority, number> {
    const counts: Record<MessagePriority, number> = {
      [MessagePriority.CRITICAL]: 0,
      [MessagePriority.HIGH]: 0,
      [MessagePriority.NORMAL]: 0,
      [MessagePriority.LOW]: 0
    };

    for (const item of this.heap) {
      counts[item.priority]++;
    }

    return counts;
  }

  /**
   * Move element up the heap
   */
  private bubbleUp(index: number): void {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);

      if (this.compare(this.heap[index], this.heap[parentIndex]) >= 0) {
        break;
      }

      this.swap(index, parentIndex);
      index = parentIndex;
    }
  }

  /**
   * Move element down the heap
   */
  private bubbleDown(index: number): void {
    while (true) {
      let smallestIndex = index;
      const leftChild = 2 * index + 1;
      const rightChild = 2 * index + 2;

      if (leftChild < this.heap.length &&
          this.compare(this.heap[leftChild], this.heap[smallestIndex]) < 0) {
        smallestIndex = leftChild;
      }

      if (rightChild < this.heap.length &&
          this.compare(this.heap[rightChild], this.heap[smallestIndex]) < 0) {
        smallestIndex = rightChild;
      }

      if (smallestIndex === index) {
        break;
      }

      this.swap(index, smallestIndex);
      index = smallestIndex;
    }
  }

  /**
   * Compare two queue items
   * Returns negative if a should come before b
   */
  private compare(a: T, b: T): number {
    // First compare by priority (lower value = higher priority)
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }

    // If same priority, compare by timestamp (older first)
    return a.timestamp.getTime() - b.timestamp.getTime();
  }

  /**
   * Swap two elements in the heap
   */
  private swap(i: number, j: number): void {
    const temp = this.heap[i];
    this.heap[i] = this.heap[j];
    this.heap[j] = temp;
  }
}